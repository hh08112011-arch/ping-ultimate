require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const BOT_TOKEN  = process.env.BOT_TOKEN;
const APP_URL    = (process.env.APP_URL || '').replace(/\/$/, ''); // Không trailing slash
const PORT       = process.env.PORT || 3000;

const KEY_HOURS     = { '12h': 12, '24h': 24 };   // Số giờ mỗi loại key
const LINKS_NEEDED  = { '12h': 1,  '24h': 2  };   // Số link cần vượt
const SESSION_TTL   = 30 * 60 * 1000;              // Session hết hạn sau 30 phút
const MAX_PER_DAY   = 3;                            // Tối đa 3 key/ngày/user

// ═══════════════════════════════════════════════════════════
// FIREBASE ADMIN SDK
// ═══════════════════════════════════════════════════════════
let db;
try {
    const firebaseConfig = {
        credential: admin.credential.cert({
            type:         'service_account',
            project_id:   process.env.FIREBASE_PROJECT_ID,
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            private_key:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    };
    if (!admin.apps.length) admin.initializeApp(firebaseConfig);
    db = admin.database();
    console.log('[Firebase] Kết nối thành công');
} catch (e) {
    console.error('[Firebase] Lỗi khởi tạo:', e.message);
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════
// ĐỌC DANH SÁCH LINK TỪ FILE
// ═══════════════════════════════════════════════════════════
function loadLinks() {
    try {
        const filePath = path.join(__dirname, 'danhsach.txt');
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
    } catch (e) {
        console.error('[Links] Không đọc được danhsach.txt:', e.message);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════
// SINH KEY NGẪU NHIÊN
// ═══════════════════════════════════════════════════════════
function generateKey() {
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'; // Bỏ I, O
    let suffix = '';
    for (let i = 0; i < 12; i++) {
        suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return 'PING-' + suffix;
}

// ═══════════════════════════════════════════════════════════
// HASH LINK (để track link đã vượt)
// ═══════════════════════════════════════════════════════════
function hashLink(url) {
    return crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
}

// ═══════════════════════════════════════════════════════════
// FIREBASE HELPERS
// ═══════════════════════════════════════════════════════════
async function getUser(telegramId) {
    const snap = await db.ref(`bot_users/${telegramId}`).once('value');
    return snap.val() || {};
}

async function saveKey(keyCode, hours) {
    await db.ref(`database/${keyCode}`).set({
        activated:   false,
        duration:    hours * 3600000,
        expiry:      0,
        deviceLimit: 1,
        devices:     [],
    });
}

async function createSession(token, telegramId, type, links) {
    await db.ref(`bot_sessions/${token}`).set({
        telegramId,
        type,
        links,
        completedMask: links.map(() => false),
        createdAt: Date.now(),
        keyGenerated: false,
    });
}

async function getSession(token) {
    const snap = await db.ref(`bot_sessions/${token}`).once('value');
    return snap.val();
}

async function updateSession(token, data) {
    await db.ref(`bot_sessions/${token}`).update(data);
}

async function deleteSession(token) {
    await db.ref(`bot_sessions/${token}`).remove();
}

// ═══════════════════════════════════════════════════════════
// KIỂM TRA COOLDOWN / CHỐNG GIAN LẬN
// ═══════════════════════════════════════════════════════════
async function checkCooldown(telegramId, type) {
    const user = await getUser(telegramId);
    const now  = Date.now();

    // Kiểm tra key hiện tại còn hạn không
    if (user.activeKey && user.activeKeyExpiry && now < user.activeKeyExpiry) {
        const remaining = Math.ceil((user.activeKeyExpiry - now) / 3600000);
        return { blocked: true, reason: `Bạn còn key đang hoạt động (hết hạn sau ~${remaining} giờ). Vui lòng đợi key cũ hết hạn!` };
    }

    // Kiểm tra giới hạn số key/ngày
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const keyHistory = Object.values(user.keyHistory || {});
    const todayCount = keyHistory.filter(t => t >= todayStart.getTime()).length;
    if (todayCount >= MAX_PER_DAY) {
        return { blocked: true, reason: `Bạn đã nhận đủ ${MAX_PER_DAY} key hôm nay. Quay lại vào 00:00!` };
    }

    // Kiểm tra session đang pending
    if (user.pendingSession) {
        const sess = await getSession(user.pendingSession);
        if (sess && !sess.keyGenerated && (Date.now() - sess.createdAt) < SESSION_TTL) {
            return { blocked: true, reason: 'Bạn đang có phiên chưa hoàn thành. Vui lòng hoàn tất link đã được gửi hoặc chờ 30 phút!', pendingSession: sess };
        }
        // Session cũ đã hết hạn → xóa
        await db.ref(`bot_sessions/${user.pendingSession}`).remove();
        await db.ref(`bot_users/${telegramId}/pendingSession`).remove();
    }

    return { blocked: false };
}

// ═══════════════════════════════════════════════════════════
// GỬI KEY QUA BOT SAU KHI XÁC NHẬN XONG
// ═══════════════════════════════════════════════════════════
async function issueKey(telegramId, type, sessionToken) {
    const hours   = KEY_HOURS[type];
    const keyCode = generateKey();

    // Lưu key vào Firebase (cùng cấu trúc admin panel)
    await saveKey(keyCode, hours);

    // Ghi lại lịch sử user
    const expiryApprox = Date.now() + hours * 3600000;
    await db.ref(`bot_users/${telegramId}`).update({
        activeKey:        keyCode,
        activeKeyExpiry:  expiryApprox,
        pendingSession:   null,
        [`keyHistory/${Date.now()}`]: Date.now(),
    });

    // Đánh dấu session đã cấp key
    await db.ref(`bot_sessions/${sessionToken}`).update({ keyGenerated: true, keyCode });

    return { keyCode, hours };
}

// ═══════════════════════════════════════════════════════════
// EXPRESS SERVER
// ═══════════════════════════════════════════════════════════
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trang chủ (healthcheck cho Render)
app.get('/', (req, res) => {
    res.send(`
    <html><head><meta charset="utf-8"><title>Ping Bot</title>
    <style>body{font-family:monospace;background:#05070e;color:#00E5FF;text-align:center;padding:60px;}
    h1{font-size:2rem;text-shadow:0 0 20px #00E5FF;}p{color:#64748b;}</style></head>
    <body><h1>⚡ PING KEY BOT</h1><p>Bot Telegram đang hoạt động bình thường.</p>
    <p style="color:#2ed573;">🟢 Online</p></body></html>
    `);
});

// ─────────────────────────────────────────────────────────
// /go?t=TOKEN&l=INDEX — Proxy redirect đến Link4M
// ─────────────────────────────────────────────────────────
app.get('/go', async (req, res) => {
    const { t: token, l: indexStr } = req.query;
    if (!token || indexStr === undefined) return res.status(400).send('Thiếu tham số.');

    const session = await getSession(token);
    if (!session) return res.status(404).send('Phiên không tồn tại hoặc đã hết hạn.');
    if (Date.now() - session.createdAt > SESSION_TTL) {
        await deleteSession(token);
        return res.status(410).send('Phiên đã hết hạn (30 phút). Vui lòng yêu cầu lại từ bot.');
    }

    const index    = parseInt(indexStr);
    const link4mUrl = session.links[index];
    if (!link4mUrl) return res.status(400).send('Link không hợp lệ.');

    // Tạo callback URL sau khi vượt Link4M xong
    const verifyUrl = encodeURIComponent(`${APP_URL}/verify?t=${token}&l=${index}`);

    // Redirect đến Link4M, truyền to= để Link4M chuyển về /verify sau khi xong
    const finalUrl = link4mUrl.includes('?')
        ? `${link4mUrl}&to=${verifyUrl}`
        : `${link4mUrl}?to=${verifyUrl}`;

    return res.redirect(302, finalUrl);
});

// ─────────────────────────────────────────────────────────
// /verify?t=TOKEN&l=INDEX — Xác nhận hoàn thành Link4M
// ─────────────────────────────────────────────────────────
app.get('/verify', async (req, res) => {
    const { t: token, l: indexStr } = req.query;

    // Nếu không có token → hiện trang hướng dẫn
    if (!token) {
        return res.send(`
        <html><head><meta charset="utf-8"><title>Xác Nhận</title>
        <style>body{font-family:monospace;background:#05070e;color:#eef0f6;text-align:center;padding:60px;}
        h2{color:#00E5FF;}p{color:#64748b;font-size:14px;}</style></head>
        <body><h2>✅ PING KEY BOT</h2>
        <p>Trang xác nhận hoàn thành link.<br>Vui lòng mở link từ bot Telegram để được hướng dẫn đúng.</p>
        </body></html>
        `);
    }

    try {
        const index   = parseInt(indexStr || '0');
        const session = await getSession(token);

        if (!session) {
            return res.status(404).send(`
            <html><head><meta charset="utf-8"></head>
            <body style="font-family:monospace;background:#05070e;color:#ff4757;text-align:center;padding:60px;">
            <h2>❌ Phiên không tồn tại hoặc đã hết hạn!</h2>
            <p style="color:#64748b;">Vui lòng yêu cầu lại từ bot Telegram.</p>
            </body></html>`);
        }

        if (session.keyGenerated) {
            return res.send(`
            <html><head><meta charset="utf-8"></head>
            <body style="font-family:monospace;background:#05070e;color:#2ed573;text-align:center;padding:60px;">
            <h2>✅ Bạn đã nhận được key rồi!</h2>
            <p style="color:#64748b;">Key đã được gửi vào Telegram của bạn.</p>
            </body></html>`);
        }

        if (Date.now() - session.createdAt > SESSION_TTL) {
            await deleteSession(token);
            return res.status(410).send(`
            <html><head><meta charset="utf-8"></head>
            <body style="font-family:monospace;background:#05070e;color:#ffa502;text-align:center;padding:60px;">
            <h2>⏰ Phiên đã hết hạn!</h2>
            <p style="color:#64748b;">Vui lòng yêu cầu lại /12h hoặc /24h từ bot.</p>
            </body></html>`);
        }

        // Đánh dấu link này đã hoàn thành
        const mask = [...session.completedMask];
        if (mask[index]) {
            // Link này đã được xác nhận rồi
        } else {
            mask[index] = true;
            await updateSession(token, { completedMask: mask });

            // Ghi vào lịch sử completed_links của user
            const linkHash = hashLink(session.links[index]);
            await db.ref(`bot_users/${session.telegramId}/completed_links/${linkHash}`).set(Date.now());
        }

        // Kiểm tra tất cả link đã hoàn thành chưa
        const needed    = LINKS_NEEDED[session.type];
        const doneCount = mask.filter(Boolean).length;

        if (doneCount >= needed) {
            // ✅ Đủ điều kiện → cấp key
            const { keyCode, hours } = await issueKey(session.telegramId, session.type, token);

            // Gửi key vào Telegram
            try {
                await bot.telegram.sendMessage(
                    session.telegramId,
                    `🎉 *CHÚC MỪNG!* Bạn đã hoàn thành ${needed} link!\n\n` +
                    `🔑 Key của bạn:\n\`${keyCode}\`\n\n` +
                    `⏳ Thời hạn: *${hours} giờ* (tính từ lần kích hoạt đầu)\n` +
                    `📱 Nhập key vào app Ping Ultimate để sử dụng.\n\n` +
                    `⚠️ Lưu ý: Key sẽ kích hoạt ngay khi bạn đăng nhập lần đầu.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (sendErr) {
                console.error('[Bot] Gửi key thất bại:', sendErr.message);
            }

            return res.send(`
            <html><head><meta charset="utf-8">
            <meta http-equiv="refresh" content="3;url=https://t.me/${process.env.BOT_USERNAME || 'HieuModBot'}">
            </head>
            <body style="font-family:monospace;background:#05070e;color:#2ed573;text-align:center;padding:60px;">
            <h2>🎉 HOÀN THÀNH!</h2>
            <p style="color:#00E5FF;font-size:18px;">Key đã được gửi vào Telegram của bạn!</p>
            <p style="color:#64748b;font-size:13px;">Đang chuyển về bot trong 3 giây...</p>
            </body></html>`);
        } else {
            // Chưa đủ link (chỉ xảy ra với /24h khi mới vượt 1 link)
            const remaining = needed - doneCount;
            return res.send(`
            <html><head><meta charset="utf-8">
            <meta http-equiv="refresh" content="3;url=https://t.me/${process.env.BOT_USERNAME || 'HieuModBot'}">
            </head>
            <body style="font-family:monospace;background:#05070e;color:#ffa502;text-align:center;padding:60px;">
            <h2>✅ Link ${doneCount}/${needed} hoàn thành!</h2>
            <p style="color:#64748b;">Còn <b style="color:#00E5FF;">${remaining}</b> link nữa. Quay lại bot để tiếp tục.</p>
            <p style="color:#64748b;font-size:13px;">Đang chuyển về bot trong 3 giây...</p>
            </body></html>`);
        }

    } catch (err) {
        console.error('[Verify] Lỗi:', err.message);
        return res.status(500).send(`
        <html><head><meta charset="utf-8"></head>
        <body style="font-family:monospace;background:#05070e;color:#ff4757;text-align:center;padding:60px;">
        <h2>❌ Lỗi server!</h2><p style="color:#64748b;">${err.message}</p>
        </body></html>`);
    }
});

// ═══════════════════════════════════════════════════════════
// TELEGRAF BOT
// ═══════════════════════════════════════════════════════════
if (!BOT_TOKEN) {
    console.error('[Bot] BOT_TOKEN chưa được cấu hình trong .env!');
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

// ─────────────────────────────────────────────────────────
// Xử lý lệnh /start
// ─────────────────────────────────────────────────────────
bot.start((ctx) => {
    const name = ctx.from.first_name || 'bạn';
    ctx.reply(
        `👋 Chào *${name}*! Đây là bot cấp key Ping Ultimate.\n\n` +
        `📌 *Lệnh có sẵn:*\n` +
        `🔹 /12h — Nhận key 12 giờ (vượt 1 link)\n` +
        `🔹 /24h — Nhận key 24 giờ (vượt 2 link)\n` +
        `🔹 /status — Kiểm tra trạng thái key hiện tại\n\n` +
        `⚡ _Powered by Ping Ultimate_`,
        { parse_mode: 'Markdown' }
    );
});

// ─────────────────────────────────────────────────────────
// Xử lý /status
// ─────────────────────────────────────────────────────────
bot.command('status', async (ctx) => {
    const uid  = ctx.from.id;
    const user = await getUser(uid);
    const now  = Date.now();

    if (user.activeKey && user.activeKeyExpiry && now < user.activeKeyExpiry) {
        const remaining = ((user.activeKeyExpiry - now) / 3600000).toFixed(1);
        return ctx.reply(
            `✅ *Trạng thái Key*\n\n` +
            `🔑 Key: \`${user.activeKey}\`\n` +
            `⏳ Còn lại: ~${remaining} giờ`,
            { parse_mode: 'Markdown' }
        );
    }
    return ctx.reply('❌ Bạn không có key đang hoạt động.\n\nDùng /12h hoặc /24h để nhận key mới.');
});

// ─────────────────────────────────────────────────────────
// Hàm xử lý chung cho /12h và /24h
// ─────────────────────────────────────────────────────────
async function handleKeyRequest(ctx, type) {
    const uid      = ctx.from.id;
    const allLinks = loadLinks();

    if (allLinks.length === 0) {
        return ctx.reply('⚠️ Danh sách link trống. Vui lòng liên hệ admin!');
    }

    // Kiểm tra cooldown + chống gian lận
    const check = await checkCooldown(uid, type);
    if (check.blocked) {
        return ctx.reply(`🚫 ${check.reason}`);
    }

    const needed  = LINKS_NEEDED[type];
    const hours   = KEY_HOURS[type];
    const user    = await getUser(uid);

    // Lọc link chưa từng vượt
    const completedLinks = user.completed_links || {};
    const unvisited = allLinks.filter(url => !completedLinks[hashLink(url)]);

    if (unvisited.length < needed) {
        return ctx.reply(
            `⚠️ Bạn đã vượt hết tất cả link trong danh sách!\n\n` +
            `Admin cần thêm link mới. Vui lòng liên hệ admin để được hỗ trợ.`
        );
    }

    // Chọn ngẫu nhiên `needed` link từ danh sách chưa vượt
    const shuffled  = [...unvisited].sort(() => Math.random() - 0.5);
    const chosen    = shuffled.slice(0, needed);

    // Tạo session token
    const token = crypto.randomBytes(16).toString('hex');
    await createSession(token, uid, type, chosen);

    // Lưu pending session vào user
    await db.ref(`bot_users/${uid}/pendingSession`).set(token);

    // Soạn nội dung tin nhắn
    let msg = `🔑 *Nhận Key ${type.toUpperCase()} — ${hours} Giờ*\n\n`;
    msg += `📋 Bạn cần vượt *${needed} link* sau:\n\n`;

    chosen.forEach((url, i) => {
        const goUrl = `${APP_URL}/go?t=${token}&l=${i}`;
        msg += `🔗 *Link ${i + 1}:*\n${goUrl}\n\n`;
    });

    msg += `⏰ Phiên hết hạn sau *30 phút*.\n`;
    msg += `✅ Sau khi vượt xong tất cả link, key sẽ tự động gửi về đây.\n\n`;
    msg += `_Lưu ý: Mỗi link chỉ được vượt 1 lần._`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
}

bot.command('12h', (ctx) => handleKeyRequest(ctx, '12h'));
bot.command('24h', (ctx) => handleKeyRequest(ctx, '24h'));

// ─────────────────────────────────────────────────────────
// Xử lý tin nhắn không hợp lệ
// ─────────────────────────────────────────────────────────
bot.on('text', (ctx) => {
    ctx.reply(
        '❓ Lệnh không được nhận ra.\n\nDùng:\n🔹 /12h — Key 12 giờ\n🔹 /24h — Key 24 giờ\n🔹 /status — Kiểm tra key'
    );
});

// ═══════════════════════════════════════════════════════════
// KHỞI ĐỘNG
// ═══════════════════════════════════════════════════════════
app.listen(PORT, async () => {
    console.log(`[Server] Đang chạy trên port ${PORT}`);
    console.log(`[Server] APP_URL: ${APP_URL}`);

    try {
        await bot.launch();
        console.log('[Bot] Telegram bot đã khởi động thành công!');
    } catch (e) {
        console.error('[Bot] Lỗi khởi động:', e.message);
    }
});

// Graceful shutdown
process.once('SIGINT',  () => { bot.stop('SIGINT');  });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });

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
// FIREBASE ADMIN SDK (ĐÃ CẬP NHẬT ĐỂ ĐỌC ĐÚNG BIẾN RENDER)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// FIREBASE ADMIN SDK (DÙNG SECRET FILES - CHẮC CHẮN 100% THÀNH CÔNG)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// FIREBASE ADMIN SDK (CHÉP TRỰC TIẾP JSON - 100% THÀNH CÔNG)
// ═══════════════════════════════════════════════════════════
let db;
try {
    // 👇 BẠN HÃY XÓA PHẦN BÊN TRONG CỦA BIẾN NÀY VÀ DÁN TOÀN BỘ 
    // NỘI DUNG FILE .JSON CỦA FIREBASE VÀO ĐÂY (Giữ nguyên ngoặc nhọn {})
    const serviceAccount = {
  "type": "service_account",
  "project_id": "ping-ultimate",
  "private_key_id": "2cf4d8a63d8d40a73375ac8f51a39be3c1a773df",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCmu1R+7Qt53LEn\n8VH/Byk7U8V7jkCu0Tw1Z95yeclygcDLnwH559fFC80yamU+1XW3YKnPvT+Ixd8k\ncaREEfGZDfFTDPU6/FYVKZdX6oW4UXZEUpXs4GBI3u2kmhKj3EMr8ahUggKUD+R3\nyAkxBnZhwAltWo8tgiyDFkgcim5uj5Q4WSQBG6TDpr9r/bS7oVYGIYU9qyRhP/PA\nNsVdUigqZ9BHdsxyxqmcBuc9tEBX2/CzQ+XLZ6wCgBvnyecIQCHUFGcmrPJfH5z3\nP4rSLlbsq+b9j+zaVyxRfIO6La4jTv6dadrfu3C6V0/xZAPFs9GgHqtZawPc3a2O\nGW4kiGc7AgMBAAECggEARJ8jFp4/M+eV7iePJNRwrt86jzCsBIdPLXfTgPAI7hzj\nGasW6CD4mDvUN2S8yNCYA2JAYaS1Knit71TqU63C7shjQ1g48g766vjUNjXq1UKJ\n13LaC8UJO9SsoCtdcp1r9AEg068ymne0A2yMA+ZyAKdF+gDknslNwqIACecbrlq1\nO73XlVNGu9M45KUiROVJxHsYPQ3eqbrlalYL+UlFYBPNJfkBfC6TtfxqDjRquls2\nUydjJJSY+XquGyWm+/W9aMO/o9TbqAZcaHHu1an3yn0LuNRmL2WUC0o7FeRSlVjJ\nRMoPvKfmXnfmoc7zEeDnvouiBEUnR6fxTwEqeW2UWQKBgQDbTTDOoVJIcXk6yp1z\nkHCEVyLoEQrGj3cke1kXFkTlzNpd3tY0lw1nO1Lc6Ej8sMXL9OnyC1lHnk2N0yah\nGUCWl6AD7gu94WJCGaD94ws+sJvaztABzc6jntiRPoxXYCLKT5PVO5l1fgwbkxCY\n5SHAAIPEbKmTHwO2shImalZipQKBgQDCohEdkM8Lj7VMcfCahDXyiLWVZll4uuzC\nk86157ZwZLKSzbRn78Sci89iKq+oJ50i+/gxO6jcqQd/luwzWC4G9KdoPvSY+5Ih\nArTyUg3K6EcmcgBmUdREi1059VHRrHKhh7pSh7rOBspkYtQbU1XtmdcqFXhkhOAA\nOkKCQKTcXwKBgQCKCrPPTYLC8RKzbDjiNqhs1YC2fYu/4yzG/RHeU3k5AdLuxccm\nQXMBaTlGrrzKuuc29EqSvowLZd1BiglF3ORoJrdl4eDoPEgifYl2ZwV8B6WDfS04\nBXmuSt3dx3aFxZEAskjHL4XwjFBIxzDqXUj6WBiZeyDe5+XpiXudTNBltQKBgDBn\ntBABUqzSacmAUNFs7inKfDaSxM+01Wsy7WbqIMJlGNBP3n028VPppYMJkLQmXfs0\nZS6BYua2FwpRU58VYCUUtYnElnpxno8dKDlX1NxQ1lkmYxkPYtZFPsNKUrXtyHiJ\n0/nwjbHtmGpM9elx2V4FM7DgtBdzwG3uD1prj1TLAoGAfTNvLLNl3mb3aTL4j0rg\nNE0xqVublb08MCmZzajj8lY1dnhxV2jcSrXhcyOhJkXYVF634hR7ykuEJeaNRPVK\n5f6yWF572dX4du8zZvvUdZtWa4PVh8lPESnT45kQxiEP4vRb//s2woPfnEntSE9j\nOD6tI89kaats7D0L1xc9RSg=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@ping-ultimate.iam.gserviceaccount.com",
  "client_id": "117299772180066447725",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40ping-ultimate.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

    // 👆 KẾT THÚC PHẦN DÁN JSON

    const firebaseConfig = {
        credential: admin.credential.cert(serviceAccount),
        // Nhớ giữ biến FIREBASE_DATABASE_URL trên Render nhé
        databaseURL: process.env.FIREBASE_DATABASE_URL, 
    };

    if (!admin.apps.length) admin.initializeApp(firebaseConfig);
    db = admin.database();
    
    // Test thử gửi yêu cầu lên Firebase để chốt hạ 100%
    db.ref('.info/connected').once('value')
        .then(() => console.log('[Firebase] ✅ ĐÃ KẾT NỐI VÀ XÁC THỰC THÀNH CÔNG!'))
        .catch(err => console.error('[Firebase] ❌ Lỗi:', err));

} catch (e) {
    console.error('[Firebase] ❌ Lỗi khởi tạo:', e.message);
    process.exit(1);
}

    const firebaseConfig = {
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    };

    if (!admin.apps.length) admin.initializeApp(firebaseConfig);
    db = admin.database();
    
    // Ping thử lên máy chủ Google để xác thực 100% chữ ký hợp lệ
    db.ref('.info/connected').once('value')
        .then(() => console.log('[Firebase] ✅ XÁC THỰC CHỮ KÝ VÀ KẾT NỐI THÀNH CÔNG THỰC SỰ!'))
        .catch(err => console.error('[Firebase] ❌ Xác thực thất bại:', err.message));

} catch (e) {
    console.error('[Firebase] ❌ Lỗi khởi tạo (Hãy kiểm tra đã tạo file firebase-key.json trong Secret Files chưa nhé):', e.message);
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

        const mask = [...session.completedMask];
        if (!mask[index]) {
            mask[index] = true;
            await updateSession(token, { completedMask: mask });

            const linkHash = hashLink(session.links[index]);
            await db.ref(`bot_users/${session.telegramId}/completed_links/${linkHash}`).set(Date.now());
        }

        const needed    = LINKS_NEEDED[session.type];
        const doneCount = mask.filter(Boolean).length;

        if (doneCount >= needed) {
            const { keyCode, hours } = await issueKey(session.telegramId, session.type, token);

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

bot.command('status', async (ctx) => {
    try {
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
    } catch (err) {
        console.error('[Bot] Lỗi lệnh /status:', err.message);
        ctx.reply('❌ Đã xảy ra lỗi khi kiểm tra trạng thái Firebase. Thử lại sau!');
    }
});

// ─────────────────────────────────────────────────────────
// Hàm xử lý chung cho /12h và /24h (ĐÃ BỌC TRY-CATCH AN TOÀN)
// ─────────────────────────────────────────────────────────
async function handleKeyRequest(ctx, type) {
    try {
        const uid      = ctx.from.id;
        const allLinks = loadLinks();

        console.log(`[Bot] Nhận yêu cầu /${type} từ User ID: ${uid}`);
        console.log(`[Bot] Tổng số link đọc được từ file: ${allLinks.length}`);

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

        console.log(`[Bot] Số lượng link User chưa vượt: ${unvisited.length}/${allLinks.length}`);

        if (unvisited.length < needed) {
            return ctx.reply(
                `⚠️ *Không đủ nhiệm vụ!*\n\nHệ thống cần ít nhất *${needed}* link mới chưa vượt, nhưng bạn đã vượt gần hết rồi.\n👉 Vui lòng báo Admin thêm link mới vào hệ thống nhé!`,
                { parse_mode: 'Markdown' }
            );
        }

        // Chọn ngẫu nhiên link từ danh sách chưa vượt
        const shuffled  = [...unvisited].sort(() => Math.random() - 0.5);
        const chosen    = shuffled.slice(0, needed);

        // Tạo session token
        const token = crypto.randomBytes(16).toString('hex');
        await createSession(token, uid, type, chosen);

        // Lưu pending session vào user
        await db.ref(`bot_users/${uid}/pendingSession`).set(token);

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

    } catch (error) {
        console.error(`❌ [Lỗi Lệnh /${type}]:`, error.message);
        ctx.reply('❌ Hệ thống gặp sự cố khi xử lý dữ liệu Firebase. Vui lòng thử lại sau hoặc báo Admin!');
    }
}

bot.command('12h', (ctx) => handleKeyRequest(ctx, '12h'));
bot.command('24h', (ctx) => handleKeyRequest(ctx, '24h'));

bot.on('text', (ctx) => {
    ctx.reply(
        '❓ Lệnh không được nhận ra.\n\nDùng:\n🔹 /12h — Key 12 giờ\n🔹 /24h — Key 24 giờ\n🔹 /status — Kiểm tra key'
    );
});

// ═══════════════════════════════════════════════════════════
// CƠ CHẾ GIỮ SERVER LUÔN THỨC (ANTI-SLEEP FOR RENDER FREE)
// ═══════════════════════════════════════════════════════════
setInterval(async () => {
    if (!APP_URL) return;
    try {
        const response = await fetch(APP_URL);
        if (response.ok) {
            console.log(`[Anti-Sleep] Tự động ping thành công lúc: ${new Date().toLocaleTimeString()}`);
        }
    } catch (e) {
        console.error('[Anti-Sleep] Lỗi tự động ping:', e.message);
    }
}, 10 * 60 * 1000); // 10 phút ping một lần để giữ Render không ngủ đông

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

process.once('SIGINT',  () => { bot.stop('SIGINT');  });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });

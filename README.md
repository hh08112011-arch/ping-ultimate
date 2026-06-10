# 🤖 Ping Key Bot — Telegram Bot Cấp Key Qua Link4M

Bot Telegram nhận key Ping Ultimate tự động thông qua việc vượt quảng cáo Link4M.

---

## 📁 Cấu Trúc Thư Mục

```
ping-key-bot/
├── index.js          ← Toàn bộ logic (Bot + Express server)
├── danhsach.txt      ← Danh sách link Link4M (1 link/dòng)
├── package.json
├── .env              ← Biến môi trường (KHÔNG commit lên GitHub)
├── .env.example      ← Mẫu cấu hình
└── README.md
```

---

## ⚙️ Cơ Chế Hoạt Động

```
User /12h  →  Bot sinh token  →  Gửi link /go?t=TOKEN&l=0
     ↓
User click link  →  /go redirect đến Link4M?to=/verify?t=TOKEN&l=0
     ↓
User vượt quảng cáo  →  Link4M redirect về /verify?t=TOKEN&l=0
     ↓
/verify xác nhận  →  Sinh key  →  Bot gửi key vào Telegram
```

---

## 🔧 Cấu Hình Firebase

### Bước 1 — Lấy thông tin Firebase Service Account
1. Vào [Firebase Console](https://console.firebase.google.com)
2. Chọn project **ping-ultimate** → ⚙️ Cài đặt → **Tài khoản dịch vụ**
3. Nhấn **Tạo khóa riêng tư mới** → Tải file JSON
4. Lấy các giá trị: `project_id`, `client_email`, `private_key`

### Bước 2 — Cấu hình `.env`
```env
BOT_TOKEN=8419778796:AAGUXrIuwJ7j1tSo67HZMUMKD6eXk-7C2Nc
BOT_USERNAME=HieuModBot
APP_URL=https://TEN-APP-CUA-BAN.onrender.com

FIREBASE_DATABASE_URL=https://ping-ultimate-default-rtdb.asia-southeast1.firebasedatabase.app
FIREBASE_PROJECT_ID=ping-ultimate
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@ping-ultimate.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

> ⚠️ `FIREBASE_PRIVATE_KEY`: Dán nguyên chuỗi, giữ `\n` bên trong (không xuống dòng thật).

---

## 🚀 Deploy Lên Render

### Bước 1 — Đưa code lên GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/ping-key-bot.git
git push -u origin main
```

### Bước 2 — Tạo Web Service trên Render
1. Vào [render.com](https://render.com) → **New → Web Service**
2. Chọn repo GitHub vừa tạo
3. Cấu hình:
   - **Name**: `ping-key-bot` (tên này = domain: `ping-key-bot.onrender.com`)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Plan**: Free

### Bước 3 — Thêm Environment Variables
Trong tab **Environment** của Render, thêm tất cả biến từ `.env`:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Token bot Telegram |
| `BOT_USERNAME` | `HieuModBot` |
| `APP_URL` | `https://ping-key-bot.onrender.com` |
| `FIREBASE_DATABASE_URL` | URL Firebase của bạn |
| `FIREBASE_PROJECT_ID` | Project ID Firebase |
| `FIREBASE_CLIENT_EMAIL` | Client email service account |
| `FIREBASE_PRIVATE_KEY` | Private key (nguyên chuỗi) |

### Bước 4 — Deploy!
Nhấn **Deploy Web Service**. Render sẽ tự build và chạy.

---

## 🔗 Cấu Hình Link4M

Bot sử dụng cơ chế **truyền tham số `?to=`** vào Link4M URL:

```
Link4M URL gốc:    https://link4m.co/XXXXXXX
Bot gửi user:      https://TEN-APP.onrender.com/go?t=TOKEN&l=0
Khi user click:    Redirect → https://link4m.co/XXXXXXX?to=https://TEN-APP.onrender.com/verify?t=TOKEN&l=0
Sau khi vượt xong: Link4M redirect → https://TEN-APP.onrender.com/verify?t=TOKEN&l=0
```

### Thêm Link Vào danhsach.txt
```
# Mỗi dòng 1 link Link4M
https://link4m.co/abc123
https://link4m.co/def456
https://link4m.co/ghi789
```

---

## 🛡️ Chống Gian Lận

| Biện pháp | Mô tả |
|-----------|-------|
| **Cooldown** | Không nhận key mới khi key cũ chưa hết hạn |
| **Giới hạn ngày** | Tối đa 3 key/ngày/tài khoản Telegram |
| **Track link** | Mỗi link chỉ được vượt 1 lần/user |
| **Session TTL** | Phiên hết hạn sau 30 phút |
| **Session lock** | Chỉ có 1 phiên đang chờ tại 1 thời điểm |

---

## 🗄️ Cấu Trúc Firebase

```
Firebase Realtime Database
│
├── database/                   ← Keys (đọc được bởi app + admin panel)
│   └── PING-XXXXXXXXXXXX/
│       ├── activated: false
│       ├── duration: 43200000  (ms)
│       ├── expiry: 0
│       ├── deviceLimit: 1
│       └── devices: []
│
├── bot_sessions/               ← Phiên đang chờ xác nhận
│   └── {token}/
│       ├── telegramId
│       ├── type: "12h"|"24h"
│       ├── links: [...]
│       ├── completedMask: [false, false]
│       ├── createdAt
│       └── keyGenerated: false
│
└── bot_users/                  ← Lịch sử người dùng
    └── {telegramId}/
        ├── activeKey
        ├── activeKeyExpiry
        ├── pendingSession
        ├── completed_links/    ← Hash của link đã vượt
        └── keyHistory/         ← Lịch sử nhận key
```

---

## 🤖 Lệnh Bot

| Lệnh | Mô tả |
|------|-------|
| `/start` | Hiển thị hướng dẫn |
| `/12h` | Nhận key 12 giờ (vượt 1 link Link4M) |
| `/24h` | Nhận key 24 giờ (vượt 2 link Link4M) |
| `/status` | Kiểm tra trạng thái key hiện tại |

---

## 🔄 Keep-Alive (Tránh Render Sleep)

Render Free tier sẽ sleep sau 15 phút không có request.
Dùng [UptimeRobot](https://uptimerobot.com) để ping `https://TEN-APP.onrender.com/` mỗi 5 phút.

---

## 📝 Lưu Ý

- **BOT_TOKEN** trong `.env.example` là token thật — đừng commit file `.env` lên GitHub
- Thêm `.env` vào `.gitignore`
- Firebase `FIREBASE_PRIVATE_KEY` phải giữ nguyên ký tự `\n` (không xuống dòng thật)

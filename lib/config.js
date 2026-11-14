// تنظیمات از متغیرهای محیطی (و فایل .env اختیاری). هیچ کلید یا توکنی داخل کد نیست.
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const e = process.env;
const strip = (s) => (s || '').replace(/^@/, '').trim();

module.exports = {
  port: +e.PORT || 8765,
  baseUrl: (e.BASE_URL || `http://localhost:${+e.PORT || 8765}`).replace(/\/$/, ''),
  dbFile: e.DB_FILE || path.join(__dirname, '..', 'data', 'app.db'),
  trustProxy: e.TRUST_PROXY === '1',
  adminToken: e.ADMIN_TOKEN || '',
  // لینک‌های دنبال‌کردن؛ اگر خالی باشند دکمه‌شان در سایت نمایش داده نمی‌شود
  xHandle: strip(e.X_HANDLE),
  tgBot: strip(e.TG_BOT),              // نام کاربری ربات، بدون @
  tgChannel: strip(e.TG_CHANNEL),      // نام کاربری کانال، بدون @
  // ربات و کانال تلگرام
  tgToken: e.TELEGRAM_BOT_TOKEN || '',
  tgChannelId: e.TELEGRAM_CHANNEL_ID || '', // مثلاً @mychannel یا -100123…
  // انتشار در ایکس (OAuth 1.0a، سطح کاربر)
  x: {
    key: e.X_API_KEY || '', secret: e.X_API_SECRET || '',
    token: e.X_ACCESS_TOKEN || '', tokenSecret: e.X_ACCESS_SECRET || '',
  },
  minPercentileSample: 30, // زیر این تعداد، درصد نمایش داده نمی‌شود (داده‌ی ساختگی نداریم)
};

// تصویر پیش‌نمایش لینک (۱۲۰۰×۶۳۰) که هنگام اشتراک در ایکس و تلگرام نمایش داده می‌شود.
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { fa } = require('./fmt');

const dir = path.join(__dirname, '..', 'node_modules', 'vazirmatn', 'fonts', 'ttf');
GlobalFonts.registerFromPath(path.join(dir, 'Vazirmatn-ExtraBold.ttf'), 'Vazir');
GlobalFonts.registerFromPath(path.join(dir, 'Vazirmatn-Medium.ttf'), 'Vazir');

const LIME = '#c8f169', BG = '#101211', INK = '#f1f3ee', MUTED = '#8c938a';
const lru = new Map();

function draw({ usd, title, sub, host }) {
  const W = 1200, H = 630, c = createCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = BG; x.fillRect(0, 0, W, H);
  x.direction = 'rtl'; x.textAlign = 'right';
  x.fillStyle = MUTED; x.font = '500 34px Vazir'; x.fillText('حقوق‌سنج', 1100, 90);

  if (usd == null) { // صفحه‌ی اصلی
    x.fillStyle = INK; x.font = '800 92px Vazir'; x.fillText('حقوقت چقدر می‌ارزه؟', 1100, 290);
    x.fillStyle = MUTED; x.font = '500 40px Vazir'; x.fillText('با نرخ زنده‌ی دلار بسنج، خرجش کن، آینده‌ات رو ببین', 1100, 380);
  } else {
    x.fillStyle = MUTED; x.font = '500 40px Vazir'; x.fillText('حقوق ماهانه‌ی دوستت در بازار آزاد می‌ارزه', 1100, 210);
    x.fillStyle = LIME; x.font = '800 220px Vazir'; x.fillText(fa(usd, 0), 1100, 420);
    x.fillStyle = INK; x.font = '800 64px Vazir'; x.fillText('دلار در ماه', 1100, 500);
    if (title) { x.fillStyle = MUTED; x.font = '500 36px Vazir'; x.fillText(`رتبه‌ی مالی: ${title}${sub ? ' · ' + sub : ''}`, 1100, 560); }
  }
  // نوار پایین
  x.fillStyle = LIME; x.fillRect(0, 590, W, 40);
  x.fillStyle = BG; x.font = '800 26px Vazir'; x.textAlign = 'center';
  x.fillText(usd == null ? host : `تو چقدر؟ حقوقت رو بسنج · ${host}`, W / 2, 620);
  return c.toBuffer('image/png');
}

function render(opts) {
  const key = JSON.stringify([opts.usd == null ? null : Math.round(opts.usd), opts.title, opts.sub, opts.host]);
  if (lru.has(key)) { const v = lru.get(key); lru.delete(key); lru.set(key, v); return v; }
  const buf = draw(opts);
  lru.set(key, buf);
  if (lru.size > 200) lru.delete(lru.keys().next().value);
  return buf;
}

module.exports = { render };

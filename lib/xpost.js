// انتشار گزارش هفتگی در ایکس (X API v2، OAuth 1.0a سطح کاربر).
// اجرا:  node lib/xpost.js          فقط متن را چاپ می‌کند (پیش‌نمایش)
//        node lib/xpost.js --send   اگر کلیدها تنظیم باشند، پست می‌کند
// هر هفته با cron یا Task Scheduler اجرا کن. بدون کلید هیچ‌چیز ارسال نمی‌شود.
const crypto = require('crypto');
const cfg = require('./config');
const digest = require('./digest');

const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(method, url, k) {
  const oauth = {
    oauth_consumer_key: k.key, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: k.token, oauth_version: '1.0',
  };
  // بدنه‌ی JSON در امضا نمی‌آید
  const paramStr = Object.keys(oauth).sort().map((p) => `${enc(p)}=${enc(oauth[p])}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join('&');
  oauth.oauth_signature = crypto.createHmac('sha1', `${enc(k.secret)}&${enc(k.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map((p) => `${enc(p)}="${enc(oauth[p])}"`).join(', ');
}

async function postTweet(text, k = cfg.x) {
  if (!k.key || !k.secret || !k.token || !k.tokenSecret) throw new Error('کلیدهای X_API_* تنظیم نشده‌اند');
  const url = 'https://api.x.com/2/tweets';
  const r = await fetch(url, {
    method: 'POST', headers: { authorization: authHeader('POST', url, k), 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X API ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const db = require('./db').open(cfg.dbFile);
  const rates = require('./rates').create(db);
  const r = await rates.get();
  if (!r || !r.usd) throw new Error('نرخی در دسترس نیست');
  const text = digest.publicText(r, db.get('x_prev'), cfg.baseUrl);
  console.log('--- متن پست ---\n' + text + '\n---');
  if (!process.argv.includes('--send')) { console.log('پیش‌نمایش بود. برای ارسال: node lib/xpost.js --send'); return; }
  const res = await postTweet(text);
  db.set('x_prev', digest.snapshot(r));
  console.log('ارسال شد:', res.data && res.data.id);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { postTweet, authHeader };

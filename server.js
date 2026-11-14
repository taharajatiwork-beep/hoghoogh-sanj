// سرور حقوق‌سنج: فایل‌های استاتیک + API + صفحه‌ی چالش با پیش‌نمایش لینک + ربات تلگرام (اختیاری).
// اجرا: node server.js   (تنظیمات: متغیرهای محیطی، مثال در .env.example)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const baseCfg = require('./lib/config');
const dbLib = require('./lib/db');
const ratesLib = require('./lib/rates');
const og = require('./lib/og');
const digest = require('./lib/digest');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://api.coingecko.com; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n = 40) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);

function createApp(overrides = {}) {
  const cfg = { ...baseCfg, ...overrides };
  const db = dbLib.open(cfg.dbFile);
  const rates = ratesLib.create(db);
  const hits = new Map(); // محدودکننده‌ی ساده‌ی نرخ درخواست

  const ipOf = (req) => (cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  function limited(req, bucket, max) {
    const k = `${bucket}:${ipOf(req)}`, now = Date.now(), h = hits.get(k);
    if (!h || now - h.t > 60000) { hits.set(k, { t: now, n: 1 }); return false; }
    return ++h.n > max;
  }
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > 60000) hits.delete(k); }, 60000);
  sweep.unref();
  const pruner = setInterval(() => db.prune(), 24 * 36e5); pruner.unref();

  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...headers });
    res.end(body);
  };
  const json = (res, code, obj, extra = {}) => send(res, code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });

  function readBody(req, limit = 4096) {
    return new Promise((resolve, reject) => {
      let size = 0, dead = false; const chunks = [];
      req.on('data', (c) => {
        if (dead) return;
        size += c.length;
        if (size > limit) { dead = true; chunks.length = 0; reject(Object.assign(new Error('too large'), { code: 413 })); } else chunks.push(c);
      });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
      req.on('error', reject);
    });
  }

  // صفحه‌ی اصلی با متای اشتراک‌گذاری (و داده‌ی چالش، اگر باشد)
  let indexCache = { m: 0, html: '' };
  function indexHtml() {
    const f = path.join(PUBLIC, 'index.html'), m = fs.statSync(f).mtimeMs;
    if (m !== indexCache.m) indexCache = { m, html: fs.readFileSync(f, 'utf8') };
    return indexCache.html;
  }
  function page({ title, desc, image, url, challenge }) {
    const meta = [
      `<meta property="og:type" content="website">`, `<meta property="og:locale" content="fa_IR">`,
      `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:image" content="${esc(image)}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(desc)}">`, `<meta name="twitter:image" content="${esc(image)}">`,
      cfg.xHandle ? `<meta name="twitter:site" content="@${esc(cfg.xHandle)}">` : '',
      challenge ? `<script>window.__CHALLENGE__=${JSON.stringify(challenge).replace(/</g, '\\u003c')}</script>` : '',
    ].join('\n');
    return indexHtml().replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`).replace('</head>', `${meta}\n</head>`);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x'), p = url.pathname, method = req.method;
    const host = cfg.baseUrl.replace(/^https?:\/\//, '');

    if (p === '/healthz') return json(res, 200, { ok: true });

    // ----- API -----
    if (p === '/api/config' && method === 'GET')
      return json(res, 200, { x: cfg.xHandle, tgBot: cfg.tgBot, tgChannel: cfg.tgChannel, baseUrl: cfg.baseUrl });

    if (p === '/api/rates' && method === 'GET') {
      const r = await rates.get();
      if (!r || !r.usd) return json(res, 503, { error: 'rates unavailable' });
      return json(res, 200, r, { 'cache-control': 'public, max-age=300' });
    }
    if (p.startsWith('/api/history/') && method === 'GET') {
      try {
        const body = await rates.history(p.slice('/api/history/'.length));
        if (!body) return json(res, 404, { error: 'unknown series' });
        return send(res, 200, body, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=43200' });
      } catch (e) { return json(res, 502, { error: 'history unavailable' }); }
    }

    if (p === '/api/submit' && method === 'POST') {
      if (limited(req, 'post', 30)) return json(res, 429, { error: 'slow down' });
      const b = await readBody(req);
      const salary = +b.salary, cid = String(b.cid || '');
      if (!(salary >= 0.5 && salary <= 5000) || !/^[A-Za-z0-9_-]{16,64}$/.test(cid)) return json(res, 400, { error: 'invalid' });
      db.saveSubmission(cid, salary, ['tight', 'normal', 'comfy'].includes(b.life) ? b.life : null);
      const { count, percentile } = db.percentile(salary);
      return json(res, 200, { count, percentile: count >= cfg.minPercentileSample ? percentile : null });
    }

    if (p === '/api/challenge' && method === 'POST') {
      if (limited(req, 'chal', 10)) return json(res, 429, { error: 'slow down' });
      const b = await readBody(req), usd = +b.usd;
      if (!(usd > 0 && usd < 1e7)) return json(res, 400, { error: 'invalid' });
      const id = db.createChallenge(usd, clean(b.title), clean(b.sub));
      return json(res, 200, { id, url: `${cfg.baseUrl}/c/${id}` });
    }
    if (p.startsWith('/api/challenge/') && method === 'GET') {
      const c = db.getChallenge(p.slice('/api/challenge/'.length));
      return c ? json(res, 200, c) : json(res, 404, { error: 'not found' });
    }

    if (p === '/api/event' && method === 'POST') {
      if (limited(req, 'evt', 60)) return json(res, 429, { error: 'slow down' });
      const step = (await readBody(req)).step;
      if (Number.isInteger(step) && step >= 0 && step <= 6) db.bumpEvent(step);
      return send(res, 204, '');
    }

    if (p.startsWith('/api/admin/') || p === '/api/weekly-post') {
      const tok = Buffer.from(url.searchParams.get('token') || ''), want = Buffer.from(cfg.adminToken || '');
      if (!cfg.adminToken || tok.length !== want.length || !crypto.timingSafeEqual(tok, want)) return json(res, 404, { error: 'not found' });
      if (p === '/api/admin/stats') {
        const f = db.funnel(+url.searchParams.get('days') || 14);
        return json(res, 200, { ...f, submissions30d: db.percentile(0).count, medianSalary: db.median(), subscribers: db.subscriberCount() });
      }
      if (p === '/api/weekly-post') {
        const r = await rates.get(), text = digest.publicText(r, db.get('x_prev'), cfg.baseUrl);
        return json(res, 200, { text, intent: 'https://x.com/intent/post?text=' + encodeURIComponent(text) });
      }
      return json(res, 404, { error: 'not found' });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    // ----- تصویر پیش‌نمایش لینک -----
    if (method === 'GET' && p === '/og/default.png') {
      if (limited(req, 'og', 60)) return send(res, 429, 'slow down');
      return send(res, 200, og.render({ host }), { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    }
    let m;
    if (method === 'GET' && (m = p.match(/^\/og\/c\/([A-Za-z0-9]{3,12})\.png$/))) {
      if (limited(req, 'og', 60)) return send(res, 429, 'slow down');
      const c = db.getChallenge(m[1]);
      if (!c) return send(res, 404, 'not found');
      return send(res, 200, og.render({ usd: c.usd, title: c.title, sub: c.sub, host }), { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' });
    }

    // ----- صفحه‌ها -----
    if (method === 'GET' && (m = p.match(/^\/c\/([A-Za-z0-9]{3,12})$/))) {
      const c = db.getChallenge(m[1]);
      if (!c) return send(res, 302, '', { location: '/' });
      const usd = Math.round(c.usd);
      return send(res, 200, page({
        title: `حقوق دوستت ماهی ${usd.toLocaleString('fa-IR')} دلار می‌ارزه. تو چقدر؟`,
        desc: 'حقوقت رو با نرخ زنده‌ی دلار بسنج، خرجش کن و ببین چند سال تا رویاهات مونده.',
        image: `${cfg.baseUrl}/og/c/${c.id}.png`, url: `${cfg.baseUrl}/c/${c.id}`, challenge: { id: c.id, usd: c.usd, title: c.title, sub: c.sub },
      }), { 'content-type': TYPES['.html'], 'cache-control': 'no-cache', 'content-security-policy': CSP });
    }
    if (method === 'GET' && (p === '/' || p === '/index.html')) {
      return send(res, 200, page({
        title: 'حقوق‌سنج: حقوقت چقدر می‌ارزه؟',
        desc: 'با نرخ زنده‌ی دلار بسنج، خرجش کن و ببین چند سال تا رویاهات مونده.',
        image: `${cfg.baseUrl}/og/default.png`, url: cfg.baseUrl + '/',
      }), { 'content-type': TYPES['.html'], 'cache-control': 'no-cache', 'content-security-policy': CSP });
    }

    // فایل‌های استاتیک
    if (method === 'GET' || method === 'HEAD') {
      const f = path.normalize(path.join(PUBLIC, decodeURIComponent(p)));
      if (!f.startsWith(PUBLIC + path.sep) || path.basename(f).startsWith('.')) return send(res, 404, 'not found');
      try {
        const body = fs.readFileSync(f);
        return send(res, 200, method === 'HEAD' ? '' : body, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
      } catch (e) { return send(res, 404, 'not found'); }
    }
    return send(res, 405, 'method not allowed');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e && e.code === 413) { // اول پاسخ، بعد قطع اتصال (قطع زودهنگام، کلاینت را بدون پاسخ می‌گذارد)
        res.once('finish', () => req.destroy());
        return json(res, 413, { error: 'too large' }, { connection: 'close' });
      }
      if (e && e.code === 400) return json(res, 400, { error: 'bad request' });
      console.error('[server]', req.method, req.url, e);
      if (!res.headersSent) json(res, 500, { error: 'server error' });
    });
  });
  server.on('close', () => { clearInterval(sweep); clearInterval(pruner); });
  return { server, db, rates, cfg };
}

if (require.main === module) {
  const app = createApp();
  app.server.listen(app.cfg.port, () => console.log(`حقوق‌سنج روی ${app.cfg.baseUrl} (پورت ${app.cfg.port})`));
  app.rates.get().catch(() => {}); // گرم‌کردن کش نرخ
  if (app.cfg.tgToken) require('./lib/telegram').create({ cfg: app.cfg, db: app.db, rates: app.rates }).start();
  else console.log('[tg] TELEGRAM_BOT_TOKEN تنظیم نشده؛ ربات تلگرام اجرا نمی‌شود.');
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.server.close(); app.db.close(); process.exit(0); });
}

module.exports = { createApp };

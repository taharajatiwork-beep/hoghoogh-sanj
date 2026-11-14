// آزمون‌های سرور: بدون شبکه‌ی بیرونی (نرخ‌ها با داده‌ی نمونه پر می‌شوند) و با دیتابیس موقت در حافظه.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const digest = require('../lib/digest');
const { authHeader } = require('../lib/xpost');
const { parseNum, T, arrow } = require('../lib/fmt');

const RATES = { date: '2026/11/07', usd: 266000, eur: 296600, coin: 260000000, btcUsd: 75000, btcChg: 1, usd30: [260000, 266000], coin30: [250e6, 260e6], live: true };

async function boot(over = {}) {
  const app = createApp({ dbFile: ':memory:', baseUrl: 'http://localhost', adminToken: 'sekret', xHandle: 'me', tgBot: 'mybot', tgChannel: 'mych', ...over });
  app.rates._seed(RATES);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, init) => fetch(base + path, init);
  const post = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { app, base, call, post, close: () => new Promise((r) => { app.server.close(r); app.db.close(); }) };
}

test('config exposes only public follow targets', async () => {
  const t = await boot();
  const c = await (await t.call('/api/config')).json();
  assert.deepEqual(Object.keys(c).sort(), ['baseUrl', 'tgBot', 'tgChannel', 'x']);
  assert.equal(c.x, 'me');
  await t.close();
});

test('rates come from cache with security headers', async () => {
  const t = await boot();
  const r = await t.call('/api/rates');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await r.json()).usd, 266000);
  await t.close();
});

test('submit validates input and hides percentile until enough samples', async () => {
  const t = await boot({ minPercentileSample: 3 });
  const ok = (cid, salary) => t.post('/api/submit', { cid, salary, life: 'normal' });
  assert.equal((await t.post('/api/submit', { cid: 'short', salary: 25 })).status, 400);
  assert.equal((await t.post('/api/submit', { cid: 'a'.repeat(20), salary: -5 })).status, 400);
  assert.equal((await t.post('/api/submit', { cid: 'a'.repeat(20), salary: 99999 })).status, 400);
  let j = await (await ok('a'.repeat(20), 10)).json();
  assert.equal(j.percentile, null); // فقط یک نمونه
  await ok('b'.repeat(20), 20); await ok('c'.repeat(20), 30);
  j = await (await ok('d'.repeat(20), 40)).json();
  assert.equal(j.count, 4);
  assert.equal(j.percentile, 88); // (۳ کمتر + ۰٫۵ برابر) / ۴
  // یک مرورگر = یک ردیف: ارسال دوباره، شمارش را زیاد نمی‌کند
  j = await (await ok('d'.repeat(20), 5)).json();
  assert.equal(j.count, 4);
  assert.equal(j.percentile, 13);
  await t.close();
});

test('challenge create / read / page meta / og image', async () => {
  const t = await boot();
  assert.equal((await t.post('/api/challenge', { usd: -1 })).status, 400);
  const made = await (await t.post('/api/challenge', { usd: 94.4, title: '<b>قهرمان</b>', sub: 'استاد' })).json();
  assert.match(made.id, /^[A-Za-z0-9]{7}$/);
  const got = await (await t.call(`/api/challenge/${made.id}`)).json();
  assert.equal(got.usd, 94.4);
  assert.ok(!got.title.includes('<'), 'تگ باید پاک شود');
  const html = await (await t.call(`/c/${made.id}`)).text();
  assert.match(html, /og:image" content="http:\/\/localhost\/og\/c\//);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.match(html, /window\.__CHALLENGE__=/);
  assert.ok(!html.includes('<b>قهرمان'), 'خروجی باید escape شود');
  const png = await t.call(`/og/c/${made.id}.png`);
  const buf = Buffer.from(await png.arrayBuffer());
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.equal((await t.call('/og/c/zzzzzzz.png')).status, 404);
  assert.equal((await t.call('/c/nope123', { redirect: 'manual' })).status, 302);
  await t.close();
});

test('home page injects share meta and CSP', async () => {
  const t = await boot();
  const r = await t.call('/');
  const html = await r.text();
  assert.match(html, /og:image" content="http:\/\/localhost\/og\/default\.png"/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await t.call('/og/default.png')).status, 200);
  await t.close();
});

test('events: only steps 0..6 counted; admin stats need token', async () => {
  const t = await boot();
  await t.post('/api/event', { step: 0 }); await t.post('/api/event', { step: 0 }); await t.post('/api/event', { step: 3 });
  await t.post('/api/event', { step: 99 });
  assert.equal((await t.call('/api/admin/stats')).status, 404);
  assert.equal((await t.call('/api/admin/stats?token=wrong')).status, 404);
  const s = await (await t.call('/api/admin/stats?token=sekret')).json();
  assert.deepEqual(s.steps.map((x) => [x.step, x.n]), [[0, 2], [3, 1]]);
  const w = await (await t.call('/api/weekly-post?token=sekret')).json();
  assert.match(w.text, /نرخ این هفته/);
  assert.match(w.intent, /^https:\/\/x\.com\/intent\/post\?text=/);
  await t.close();
});

test('body limit and bad json are rejected, path traversal blocked', async () => {
  const t = await boot();
  assert.equal((await t.post('/api/submit', { cid: 'x'.repeat(5000), salary: 1 })).status, 413);
  const bad = await t.call('/api/submit', { method: 'POST', body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await t.call('/..%2f..%2fserver.js')).status, 404);
  assert.equal((await t.call('/.env')).status, 404);
  await t.close();
});

test('rate limit kicks in on repeated writes', async () => {
  const t = await boot();
  let last;
  for (let i = 0; i < 12; i++) last = await t.post('/api/challenge', { usd: 50 });
  assert.equal(last.status, 429);
  await t.close();
});

test('digest text: arrows, no minus sign, fits a tweet', () => {
  const prev = { usd: 260000, coin: 265e6 };
  const text = digest.publicText(RATES, prev, 'https://example.com');
  assert.match(text, /دلار .* ▲ /);
  assert.match(text, /سکه .* ▼ /);
  assert.ok(!text.includes('−'));
  assert.ok(text.length <= 280, `طول ${text.length}`);
  const first = digest.publicText(RATES, null, 'https://example.com');
  assert.ok(!/[▲▼]/.test(first), 'بدون هفته‌ی قبل، درصدی نیست');
  const personal = digest.personalText(RATES, prev, 40);
  assert.match(personal, /۴۰ میلیونی/);
  assert.match(personal, /\/stop/);
});

test('formatting helpers', () => {
  assert.equal(parseNum('۲۵٫۵'), 25.5);
  assert.equal(parseNum('۱٬۲۰۰'), 1200);
  assert.equal(T(266000), '۲۶۶ هزار');
  assert.equal(arrow(null), '');
});

test('X oauth header has all required fields and a stable-format signature', () => {
  const h = authHeader('POST', 'https://api.x.com/2/tweets', { key: 'ck', secret: 'cs', token: 'tk', tokenSecret: 'ts' });
  for (const f of ['oauth_consumer_key="ck"', 'oauth_token="tk"', 'oauth_signature_method="HMAC-SHA1"', 'oauth_version="1.0"', 'oauth_signature="'])
    assert.ok(h.includes(f), f);
  assert.ok(h.startsWith('OAuth '));
});

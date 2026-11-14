// دریافت و کش نرخ‌ها در سرور: سایت از اینجا می‌خواند، نه مستقیم از جیت‌هاب/کوین‌گکو.
// اگر منبع قطع شد، آخرین نرخ ذخیره‌شده برمی‌گردد.
const CDN = 'https://cdn.jsdelivr.net/gh/SamadiPour/rial-exchange-rates-archive@data/';
const TTL = 30 * 60 * 1000;
const HIST_TTL = 12 * 60 * 60 * 1000;

async function getJSON(url, ms = 15000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': 'hoghoogh-sanj/1.0' } });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const pick = (o, k) => o && (o[k] ?? o[k.toUpperCase()] ?? o[k.toLowerCase()]);
const price = (o, k) => { const v = pick(o, k); return v ? (v.sell || v.buy) : null; };

function create(db) {
  let cache = db.get('rates') || null, cacheAt = cache ? cache.fetchedAt : 0, inflight = null;
  const hist = new Map();

  async function refresh() {
    const next = { ...(cache || {}) };
    let ok = false;
    try {
      const days = await getJSON(CDN + 'gregorian_31days.min.json');
      const keys = Object.keys(days).sort(), last = days[keys[keys.length - 1]];
      Object.assign(next, {
        date: keys[keys.length - 1], usd: price(last, 'usd'), eur: price(last, 'eur'), coin: price(last, 'emami1'),
        usd30: keys.map((k) => price(days[k], 'usd')).filter(Boolean),
        eur30: keys.map((k) => price(days[k], 'eur')).filter(Boolean),
        coin30: keys.map((k) => price(days[k], 'emami1')).filter(Boolean),
      });
      ok = true;
    } catch (e) { console.warn('[rates] archive failed:', e.message); }
    try {
      const g = await getJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true', 10000);
      next.btcUsd = g.bitcoin.usd; next.btcChg = g.bitcoin.usd_24h_change || 0;
    } catch (e) { console.warn('[rates] coingecko failed:', e.message); }
    if (ok) { next.fetchedAt = Date.now(); next.live = true; cache = next; cacheAt = next.fetchedAt; db.set('rates', cache); }
    else if (cache) { cache = { ...cache, live: false }; }
    return cache;
  }

  return {
    // آخرین نرخ؛ اگر کهنه بود تازه می‌کند (یک درخواست هم‌زمان)
    async get() {
      if (!cache || Date.now() - cacheAt > TTL) {
        inflight = inflight || refresh().finally(() => { inflight = null; });
        await inflight;
      }
      return cache;
    },
    // تاریخچه‌ی کامل یک ارز (usd | emami1) به همان شکل فایل منبع
    async history(name) {
      if (!/^(usd|emami1)$/.test(name)) return null;
      const h = hist.get(name);
      if (h && Date.now() - h.at < HIST_TTL) return h.body;
      try {
        const body = JSON.stringify(await getJSON(CDN + `currency/${name}.json`, 30000));
        hist.set(name, { at: Date.now(), body });
        return body;
      } catch (e) { if (h) return h.body; throw e; }
    },
    _seed(r) { cache = { ...r, fetchedAt: Date.now() }; cacheAt = cache.fetchedAt; }, // برای تست
  };
}

module.exports = { create };

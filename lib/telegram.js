// ربات تلگرام (long polling، بدون وابستگی). فقط وقتی TELEGRAM_BOT_TOKEN تنظیم باشد اجرا می‌شود.
// کاربر با لینک t.me/<bot>?start=s25 یا فرستادن یک عدد، مشترک گزارش هفتگی می‌شود.
const { fa, T, parseNum } = require('./fmt');
const digest = require('./digest');

const WEEK = 7 * 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function create({ cfg, db, rates, log = console }) {
  const base = `https://api.telegram.org/bot${cfg.tgToken}/`;
  let running = false;

  async function api(method, body, ms = 35000) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(base + method, { method: 'POST', signal: c.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const send = (chat_id, text) => api('sendMessage', { chat_id, text, disable_web_page_preview: true }, 15000);

  const WELCOME = 'سلام! اینجا هر هفته می‌گم حقوقت چند دلار می‌ارزه.\nحقوق ماهانه‌ات رو به میلیون تومان بفرست، مثلاً: ۲۵';
  const BAD = 'یه عدد بفرست، به میلیون تومان. مثلاً ۲۵ یا ۴۰٫۵';

  async function setSalary(chatId, salary) {
    if (!(salary >= 0.5 && salary <= 5000)) return send(chatId, BAD);
    db.subscribe(chatId, salary);
    const r = await rates.get();
    await send(chatId, `ثبت شد. حقوق ${fa(salary, 1)} میلیونی‌ت الان ${fa((salary * 1e6) / r.usd, 0)} دلار می‌ارزه (دلار ${T(r.usd)} تومان).\nهر هفته برات می‌فرستم. /stop برای لغو.`);
  }

  async function handle(update) {
    const m = update.message;
    if (!m || !m.text || !m.chat || m.chat.type !== 'private') return;
    const chatId = m.chat.id, text = m.text.trim();
    if (text.startsWith('/start')) {
      // پارامتر start فقط حروف و عدد و _ را می‌پذیرد: s25 یا s25_5 (= ۲۵٫۵)
      const p = (text.split(/\s+/)[1] || '').match(/^s(\d+)(?:_(\d+))?$/);
      return p ? setSalary(chatId, parseFloat(p[2] ? `${p[1]}.${p[2]}` : p[1])) : send(chatId, WELCOME);
    }
    if (text.startsWith('/stop')) { db.unsubscribe(chatId); return send(chatId, 'گزارش هفتگی متوقف شد. هر وقت خواستی یه عدد بفرست تا دوباره فعال بشه.'); }
    if (text.startsWith('/rate')) {
      const r = await rates.get();
      return send(chatId, `دلار ${T(r.usd)} · یورو ${T(r.eur)} · سکه ${T(r.coin)} تومان\n${digest.faDate(r.date)}`);
    }
    if (text.startsWith('/')) return send(chatId, WELCOME);
    const n = parseNum(text);
    return Number.isFinite(n) ? setSalary(chatId, n) : send(chatId, BAD);
  }

  async function poll() {
    let offset = db.get('tg_offset') || 0, backoff = 1000;
    while (running) {
      try {
        const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        if (!res.ok) throw new Error(res.description || 'getUpdates failed');
        backoff = 1000;
        for (const u of res.result) {
          offset = u.update_id + 1;
          try { await handle(u); } catch (e) { log.warn('[tg] handler error:', e.message); }
        }
        if (res.result.length) db.set('tg_offset', offset);
      } catch (e) {
        if (!running) break;
        log.warn('[tg] poll error:', e.message);
        await sleep(backoff); backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  // انتشار هفتگی: پیام شخصی به مشترک‌ها و (اگر تنظیم باشد) پست عمومی در کانال
  async function sendDigest() {
    const r = await rates.get(), prev = db.get('tg_prev');
    let sent = 0;
    for (const s of db.subscribers()) {
      const res = await send(s.chat_id, digest.personalText(r, prev, s.salary || digest.REF_SALARY)).catch(() => null);
      if (res && res.ok) sent++;
      else if (res && res.error_code === 403) db.unsubscribe(s.chat_id); // ربات را بلاک کرده
      await sleep(40); // زیر سقف ۳۰ پیام در ثانیه
    }
    if (cfg.tgChannelId) {
      await send(cfg.tgChannelId, digest.publicText(r, prev, cfg.baseUrl)).catch((e) => log.warn('[tg] channel post failed:', e.message));
    }
    db.set('tg_prev', digest.snapshot(r));
    db.set('tg_digest_ts', Date.now());
    log.log(`[tg] weekly digest sent to ${sent} subscribers`);
    return sent;
  }

  async function tick() {
    const last = db.get('tg_digest_ts') || 0;
    if (Date.now() - last >= WEEK) await sendDigest().catch((e) => log.warn('[tg] digest failed:', e.message));
  }

  let timer;
  return {
    start() {
      if (running) return; running = true;
      poll();
      timer = setInterval(tick, 60 * 60 * 1000); setTimeout(tick, 15000);
      log.log('[tg] bot started');
    },
    stop() { running = false; clearInterval(timer); },
    sendDigest, handle, // برای تست و اجرای دستی
  };
}

module.exports = { create };

// ذخیره‌سازی با SQLite داخلی Node (بدون وابستگی). همه‌چیز ناشناس است: شناسه‌ی تصادفیِ مرورگر، نه IP.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS submissions (cid TEXT PRIMARY KEY, ts INTEGER NOT NULL, salary REAL NOT NULL, life TEXT);
    CREATE INDEX IF NOT EXISTS sub_salary ON submissions(salary);
    CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, usd REAL NOT NULL, title TEXT, sub TEXT);
    CREATE TABLE IF NOT EXISTS events (day TEXT NOT NULL, step INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, step));
    CREATE TABLE IF NOT EXISTS subscribers (chat_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, salary REAL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  `);

  const q = (sql) => db.prepare(sql);
  const st = {
    upsertSub: q(`INSERT INTO submissions(cid,ts,salary,life) VALUES(?,?,?,?)
                  ON CONFLICT(cid) DO UPDATE SET ts=excluded.ts, salary=excluded.salary, life=excluded.life`),
    count: q(`SELECT COUNT(*) AS n FROM submissions WHERE ts >= ?`),
    below: q(`SELECT COUNT(*) AS n FROM submissions WHERE ts >= ? AND salary < ?`),
    equal: q(`SELECT COUNT(*) AS n FROM submissions WHERE ts >= ? AND salary = ?`),
    salaries: q(`SELECT salary FROM submissions WHERE ts >= ? ORDER BY salary`),
    addCh: q(`INSERT INTO challenges(id,ts,usd,title,sub) VALUES(?,?,?,?,?)`),
    getCh: q(`SELECT id,usd,title,sub FROM challenges WHERE id = ?`),
    bump: q(`INSERT INTO events(day,step,n) VALUES(?,?,1) ON CONFLICT(day,step) DO UPDATE SET n = n + 1`),
    funnel: q(`SELECT step, SUM(n) AS n FROM events WHERE day >= ? GROUP BY step ORDER BY step`),
    byDay: q(`SELECT day, n FROM events WHERE step = 0 AND day >= ? ORDER BY day`),
    subUp: q(`INSERT INTO subscribers(chat_id,ts,salary,active) VALUES(?,?,?,1)
              ON CONFLICT(chat_id) DO UPDATE SET salary = COALESCE(excluded.salary, salary), active = 1`),
    subOff: q(`UPDATE subscribers SET active = 0 WHERE chat_id = ?`),
    subs: q(`SELECT chat_id, salary FROM subscribers WHERE active = 1`),
    subCount: q(`SELECT COUNT(*) AS n FROM subscribers WHERE active = 1`),
    kvGet: q(`SELECT v FROM kv WHERE k = ?`),
    kvSet: q(`INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`),
    prune: q(`DELETE FROM submissions WHERE ts < ?`),
  };
  const DAY = 864e5;
  const window = () => Date.now() - 30 * DAY;

  return {
    raw: db,
    saveSubmission(cid, salary, life) { st.upsertSub.run(cid, Date.now(), salary, life || null); },
    percentile(salary) {
      const w = window(), n = st.count.get(w).n;
      if (!n) return { count: 0, percentile: null };
      const below = st.below.get(w, salary).n, equal = st.equal.get(w, salary).n;
      return { count: n, percentile: Math.round(((below + equal / 2) / n) * 100) };
    },
    median() {
      const rows = st.salaries.all(window());
      if (!rows.length) return null;
      const m = rows.length >> 1;
      return rows.length % 2 ? rows[m].salary : (rows[m - 1].salary + rows[m].salary) / 2;
    },
    createChallenge(usd, title, sub) {
      for (let i = 0; i < 5; i++) {
        const id = crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 7);
        try { st.addCh.run(id, Date.now(), usd, title || '', sub || ''); return id; } catch (e) { /* برخورد شناسه: دوباره */ }
      }
      throw new Error('could not create challenge id');
    },
    getChallenge(id) { return st.getCh.get(id) || null; },
    bumpEvent(step) { st.bump.run(new Date().toISOString().slice(0, 10), step); },
    funnel(days = 14) {
      const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
      return { steps: st.funnel.all(since), visitsByDay: st.byDay.all(since) };
    },
    subscribe(chatId, salary) { st.subUp.run(String(chatId), Date.now(), salary ?? null); },
    unsubscribe(chatId) { st.subOff.run(String(chatId)); },
    subscribers() { return st.subs.all(); },
    subscriberCount() { return st.subCount.get().n; },
    get(k) { const r = st.kvGet.get(k); return r ? JSON.parse(r.v) : null; },
    set(k, v) { st.kvSet.run(k, JSON.stringify(v)); },
    prune() { st.prune.run(Date.now() - 90 * DAY); },
    close() { db.close(); },
  };
}

module.exports = { open };

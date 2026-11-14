// آزمون ربات تلگرام با api جعلی: هیچ درخواستی به تلگرام نمی‌رود.
const test = require('node:test');
const assert = require('node:assert/strict');
const dbLib = require('../lib/db');
const ratesLib = require('../lib/rates');
const telegram = require('../lib/telegram');

const RATES = { date: '2026/11/07', usd: 266000, eur: 296600, coin: 260000000 };

function setup() {
  const db = dbLib.open(':memory:'), rates = ratesLib.create(db);
  rates._seed(RATES);
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const method = String(url).split('/').pop(), body = JSON.parse(init.body);
    if (method === 'sendMessage') { sent.push(body); return { json: async () => ({ ok: true }) }; }
    return { json: async () => ({ ok: true, result: [] }) };
  };
  const bot = telegram.create({ cfg: { tgToken: 'T', tgChannelId: '@ch', baseUrl: 'https://x.test' }, db, rates, log: { log() {}, warn() {} } });
  return { db, bot, sent, restore: () => { global.fetch = realFetch; db.close(); } };
}
const msg = (text, id = 1) => ({ message: { text, chat: { id, type: 'private' } } });

test('deep link /start s25 subscribes with salary', async () => {
  const t = setup();
  await t.bot.handle(msg('/start s25'));
  const subs = t.db.subscribers();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].chat_id, '1');
  assert.equal(subs[0].salary, 25);
  assert.match(t.sent[0].text, /۹۴ دلار/);
  t.restore();
});

test('deep link with decimal salary: s25_5 means 25.5', async () => {
  const t = setup();
  await t.bot.handle(msg('/start s25_5', 9));
  assert.equal(t.db.subscribers()[0].salary, 25.5);
  t.restore();
});

test('plain number subscribes, junk is rejected, /stop unsubscribes', async () => {
  const t = setup();
  await t.bot.handle(msg('۴۰', 7));
  assert.equal(t.db.subscribers()[0].salary, 40);
  await t.bot.handle(msg('سلام چطوری', 7));
  assert.match(t.sent.at(-1).text, /یه عدد بفرست/);
  await t.bot.handle(msg('0.1', 7));
  assert.match(t.sent.at(-1).text, /یه عدد بفرست/);
  await t.bot.handle(msg('/stop', 7));
  assert.equal(t.db.subscribers().length, 0);
  t.restore();
});

test('groups are ignored', async () => {
  const t = setup();
  await t.bot.handle({ message: { text: '/start', chat: { id: 5, type: 'group' } } });
  assert.equal(t.sent.length, 0);
  t.restore();
});

test('weekly digest messages subscribers and the channel, then stores the snapshot', async () => {
  const t = setup();
  await t.bot.handle(msg('25', 1)); await t.bot.handle(msg('50', 2));
  t.sent.length = 0;
  const n = await t.bot.sendDigest();
  assert.equal(n, 2);
  assert.equal(t.sent.filter((s) => s.chat_id === '@ch').length, 1);
  assert.equal(t.db.get('tg_prev').usd, 266000);
  t.restore();
});

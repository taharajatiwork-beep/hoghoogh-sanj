// گزارش هفتگی نرخ‌ها: متن آماده برای ایکس، کانال تلگرام و پیام شخصی ربات.
// مقایسه با «عکس هفته‌ی قبل» انجام می‌شود که هر کانال جدا نگه می‌دارد تا انتشار یکی روی دیگری اثر نگذارد.
const { fa, T, arrow, change } = require('./fmt');

const REF_SALARY = 25; // میلیون تومان، حقوق مرجع در پست عمومی

function faDate(g) {
  const [y, m, d] = String(g).split('/').map(Number);
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// snap: { date, usd, coin } یا null
function snapshot(r) { return { date: r.date, usd: r.usd, coin: r.coin, eur: r.eur }; }

function publicText(r, prev, url) {
  const du = change(r.usd, prev && prev.usd), dc = change(r.coin, prev && prev.coin);
  const salaryUsd = (REF_SALARY * 1e6) / r.usd;
  const prevUsd = prev ? (REF_SALARY * 1e6) / prev.usd : null;
  const lines = [
    `نرخ این هفته · ${faDate(r.date)}`,
    `دلار ${T(r.usd)} ${arrow(du)}`.trim(),
    `سکه ${T(r.coin)} ${arrow(dc)}`.trim(),
    `حقوق ${fa(REF_SALARY)} میلیونی = ${fa(salaryUsd, 0)} دلار${prevUsd ? ` (هفته‌ی قبل ${fa(prevUsd, 0)})` : ''}`,
    `حقوق خودت چقدر می‌ارزه؟ ${url}`,
  ];
  return lines.join('\n');
}

function personalText(r, prev, salary) {
  const usd = (salary * 1e6) / r.usd, prevUsd = prev ? (salary * 1e6) / prev.usd : null;
  const d = change(usd, prevUsd);
  return `حقوق ${fa(salary, 1)} میلیونی‌ت این هفته ${fa(usd, 0)} دلار می‌ارزه${d == null ? '' : ` (${arrow(d)} نسبت به هفته‌ی قبل)`}.\n` +
    `معادل ${fa((salary * 1e6) / r.coin, 2)} سکه‌ی امامی. دلار ${T(r.usd)} تومان.\n/stop برای لغو گزارش هفتگی`;
}

module.exports = { publicText, personalText, snapshot, faDate, REF_SALARY };

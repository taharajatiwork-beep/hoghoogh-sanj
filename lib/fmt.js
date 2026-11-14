// قالب‌بندی فارسی مشترک بین سرور، ربات و ایکس (همان منطق سایت)
const fa = (n, d = 0) => Number(n).toLocaleString('fa-IR', { maximumFractionDigits: d });
function T(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return fa(n / 1e9, a >= 1e10 ? 1 : 2) + ' میلیارد';
  if (a >= 1e6) return fa(n / 1e6, a >= 1e8 ? 0 : 1) + ' میلیون';
  if (a >= 1e3) return fa(n / 1e3, 0) + ' هزار';
  return fa(n, 0);
}
// فلش به‌جای علامت منفی: مشکل جهت متن (bidi) پیش نمی‌آید
const arrow = (pct) => (pct == null ? '' : pct >= 0 ? `▲ ${fa(Math.abs(pct), 1)}٪` : `▼ ${fa(Math.abs(pct), 1)}٪`);
const change = (now, prev) => (prev ? (now / prev - 1) * 100 : null);
const parseNum = (s) => {
  const D = '۰۱۲۳۴۵۶۷۸۹', A = '٠١٢٣٤٥٦٧٨٩';
  return parseFloat(String(s).replace(/[۰-۹]/g, (c) => D.indexOf(c)).replace(/[٠-٩]/g, (c) => A.indexOf(c))
    .replace(/[٬,،\s]/g, '').replace('٫', '.'));
};
module.exports = { fa, T, arrow, change, parseNum };

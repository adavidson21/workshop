/* Prioritizer: Small helpers: DOM lookup, escaping, ids, dates. */
/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-5);
const pad = n => String(n).padStart(2,'0');
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => dateStr(new Date());
const today = todayStr;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parseD = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dateStr(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtMD = d => d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
function fmtDay(s){
  const d = daysBetween(today(), s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const dt = parseD(s);
  if (d > 1 && d < 7) return dt.toLocaleDateString(undefined, {weekday: 'short'});
  const o = {month: 'short', day: 'numeric'};
  if (dt.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return dt.toLocaleDateString(undefined, o);
}
const fmtLong = s => parseD(s).toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});

export { $, addDays, dateStr, daysBetween, esc, fmtDay, fmtLong, fmtMD, isDate, parseD, plural, today, todayStr, uid };

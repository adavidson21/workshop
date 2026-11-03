/* Dates and time scales. No DOM, so Node tests drive it.

   A date is a 'YYYY-MM-DD' string (a calendar day, no time zone). Math is done on day numbers: whole days
   since 1970-01-01 (UTC), so daylight saving never shifts a bar.

   Scales: week (starts Monday), sprint (from an anchor date, `weeks` long), month and quarter.
   An item's end date is inclusive: a bar covers start..end, both days drawn. */

export const SCALES = ['week', 'sprint', 'month', 'quarter'];
const DAY = 86400000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True for a real calendar date in YYYY-MM-DD form. */
export function isDate(s) {
  const m = ISO.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export const toDay = (s) => { const m = ISO.exec(s); return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY); };
export const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (s, n) => fromDay(toDay(s) + n);
export const diffDays = (a, b) => toDay(b) - toDay(a);
export const ymd = (y, m, d) => fromDay(Math.round(Date.UTC(y, m - 1, d) / DAY));
export const parts = (s) => { const m = ISO.exec(s); return { y: +m[1], m: +m[2], d: +m[3] }; };

/** Today in the local time zone, as YYYY-MM-DD. */
export function today(now = new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 0 = Monday ... 6 = Sunday. */
export const weekday = (s) => (toDay(s) + 3) % 7;

export const monthStart = (s) => { const p = parts(s); return ymd(p.y, p.m, 1); };
export const monthEnd = (s) => { const p = parts(s); return ymd(p.y, p.m + 1, 0); };
export const addMonths = (s, n) => { const p = parts(s); return ymd(p.y, p.m + n, 1); };
export const quarterOf = (s) => Math.floor((parts(s).m - 1) / 3) + 1;
export const quarterStart = (s) => { const p = parts(s); return ymd(p.y, (quarterOf(s) - 1) * 3 + 1, 1); };

/** The sprint setup a map uses: its own, or two-week sprints starting at the map's origin. */
export function sprintOf(meta = {}) {
  const s = meta.sprint || {};
  const weeks = Number.isInteger(s.weeks) && s.weeks >= 1 && s.weeks <= 8 ? s.weeks : 2;
  const anchor = isDate(s.anchor) ? s.anchor : (isDate(meta.origin) ? meta.origin : '2026-01-05');
  return { anchor, weeks };
}

/** Start of the period of `scale` that contains `date`. */
export function periodStart(scale, date, sprint) {
  switch (scale) {
    case 'week': return addDays(date, -weekday(date));
    case 'sprint': {
      const len = sprint.weeks * 7;
      const k = Math.floor(diffDays(sprint.anchor, date) / len);
      return addDays(sprint.anchor, k * len);
    }
    case 'quarter': return quarterStart(date);
    default: return monthStart(date);
  }
}

/** Start of the period `n` periods after the one starting at `start` (n may be negative). */
export function periodAdd(scale, start, n, sprint) {
  switch (scale) {
    case 'week': return addDays(start, 7 * n);
    case 'sprint': return addDays(start, sprint.weeks * 7 * n);
    case 'quarter': return addMonths(start, 3 * n);
    default: return addMonths(start, n);
  }
}

/** Last day of the period starting at `start`. */
export const periodEnd = (scale, start, sprint) => addDays(periodAdd(scale, start, 1, sprint), -1);

/** Periods of `scale` covering from..to: [{start, end}]. */
export function periods(scale, from, to, sprint, max = 600) {
  const out = [];
  let p = periodStart(scale, from, sprint);
  while (p <= to && out.length < max) {
    const next = periodAdd(scale, p, 1, sprint);
    out.push({ start: p, end: addDays(next, -1) });
    p = next;
  }
  return out;
}

/** The first period of `scale` that starts on or after `origin`: period 1 for S1 and W1. */
export function firstPeriod(scale, origin, sprint) {
  const p = periodStart(scale, origin, sprint);
  return p < origin ? periodAdd(scale, p, 1, sprint) : p;
}

/** Sprint number: 1 is the first sprint that starts on or after `origin`. Earlier sprints count 0, -1 and so on. */
export function sprintNumber(date, origin, sprint) {
  const len = sprint.weeks * 7;
  return Math.floor(diffDays(firstPeriod('sprint', origin, sprint), periodStart('sprint', date, sprint)) / len) + 1;
}

/** A short label for a period, used in the timeline header. */
export function periodLabel(scale, start, ctx = {}) {
  const p = parts(start);
  switch (scale) {
    case 'week': return `${MONTHS[p.m - 1]} ${p.d}`;
    case 'sprint': return `S${sprintNumber(start, ctx.origin || start, ctx.sprint)}`;
    case 'quarter': return `Q${quarterOf(start)}`;
    default: return MONTHS[p.m - 1];
  }
}

/** Human date: "Mar 4, 2027". */
export function fmt(s) {
  if (!isDate(s)) return '';
  const p = parts(s);
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** A length in days, added to a start date to get an inclusive end, for a size like {n: 3, unit: 'sprint'}. */
export function sizeEnd(start, size, sprint) {
  const n = Math.max(1, Math.min(500, Math.round(size.n)));
  switch (size.unit) {
    case 'day': return addDays(start, n - 1);
    case 'week': return addDays(start, 7 * n - 1);
    case 'sprint': return addDays(start, sprint.weeks * 7 * n - 1);
    case 'quarter': { const p = parts(start); return addDays(ymd(p.y, p.m + 3 * n, p.d), -1); }
    default: { const p = parts(start); return addDays(ymd(p.y, p.m + n, p.d), -1); }
  }
}

/** Days a drag or arrow key moves by on each scale. */
export const SNAP = { week: 1, sprint: 1, month: 7, quarter: 7 };
/** Pixels per day on each scale. */
export const PX = { week: 22, sprint: 9, month: 3.4, quarter: 1.5 };

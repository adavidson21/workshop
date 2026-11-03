/* Roadmap: the rules, with no DOM or SDK, so Node tests can import them.
   Items come from the ADO connector's roadmap action (connectors/ado/README.md): Epics and Features,
   {id, rev, type, title, state, area, iteration, parentId, targetDate, startDate, changed, url}, and on a Feature
   {storiesTotal, storiesDone}. Epics are versions; Features are what ships in them.

   Sprint math is a copy of Docket's rules (Docket's js/dayplan-model.js: sprintInfo, sprintDayDate), not an
   import: apps never import from other apps. Keep the two in step. */

export const APP = 'pm';
export const VERSION = 1;
export const DOCKET = 'prioritizer';
export const DOCKET_VERSION = 1;    // prioritizer.dayplan/settings and dayplan/recurring
export const QUEUE_VERSION = 1;     // queue.settings
export const HANDOFF_VERSION = 1;
export const HANDOFF_DAYS = 60;

export const DEFAULT_SETTINGS = {
  connection: '',       // empty: Queue's connection, else the ADO connector's connection for my work items
  useQueueAreas: true,  // also show Queue's area paths
  staleDays: 14,
  refreshMinutes: 30
};

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lower = s => String(s || '').toLowerCase();
const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
const uniq = list => [...new Set(list)];

/* ---------- versions ---------- */

/** True when an envelope is the given schema at a version this app reads. A newer one is unreadable, not empty. */
export function readable(env, schema, version) {
  return !!env && env.schema === schema && env.version === version && Array.isArray(env.items);
}

/* ---------- settings and products ---------- */

export function cleanSettings(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return {
    connection: str(m.connection, 40),
    useQueueAreas: m.useQueueAreas !== false,
    staleDays: int(m.staleDays, 1, 180, DEFAULT_SETTINGS.staleDays),
    refreshMinutes: int(m.refreshMinutes, 5, 240, DEFAULT_SETTINGS.refreshMinutes)
  };
}

const cleanAreas = v => uniq((Array.isArray(v) ? v : []).map(a => str(a, 400)).filter(Boolean)).slice(0, 20);

/** A product: {id, name, areas[]}. Null when it has no name or no area path. */
export function cleanProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const name = str(p.name, 80);
  const areas = cleanAreas(p.areas);
  if (!name || !areas.length) return null;
  return { id: str(p.id, 60) || slugId('p', name), name, areas };
}

export const slugId = (prefix, name) => `${prefix}_${lower(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'}`;

/** "Product A: Project\Team A, Project\Team B" lines to products. Lines without a colon or areas are skipped. */
export function parseProducts(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    const p = cleanProduct({ name: line.slice(0, at), areas: line.slice(at + 1).split(',') });
    if (p && !out.some(x => x.id === p.id)) out.push(p);
  }
  return out.slice(0, 40);
}

export const productsText = products => products.map(p => `${p.name}: ${p.areas.join(', ')}`).join('\n');

/** Area paths to ask ADO for: every product's, plus Queue's when that is on. */
export function areasToFetch(products, queueAreas, settings) {
  const all = [...products.flatMap(p => p.areas), ...(settings.useQueueAreas ? queueAreas : [])];
  const out = [];
  for (const a of all) if (!out.some(x => lower(x) === lower(a))) out.push(a);
  return out.slice(0, 50);
}

/** Queue's area paths and connection from its settings envelope, or none when it is missing or unreadable. */
export function queueInfo(env) {
  if (!readable(env, 'queue.settings', QUEUE_VERSION)) return { areas: [], connection: '' };
  const m = env.meta || {};
  return { areas: cleanAreas(Array.isArray(m.areas) ? m.areas : []).slice(0, 50), connection: str(m.connection, 40) };
}

/** True when `area` is `path` or under it. ADO paths ignore case. */
export const under = (area, path) => { const a = lower(area), p = lower(path); return a === p || a.startsWith(p + '\\'); };

export const leaf = p => String(p || '').split('\\').pop();
export const projectOf = p => String(p || '').split('\\')[0];

/* ---------- lanes ---------- */

/**
 * The lanes, one per product (or per Queue area path when there are no products), in settings order, then
 * "Other" for anything no lane claims. The longest matching area path wins. Each lane is
 * {key, name, epics: [{epic, features[]}], loose: [features whose Epic is not in the roadmap]}.
 */
export function buildLanes(items, { products, queueAreas }) {
  const defs = products.length
    ? products.map(p => ({ key: p.id, name: p.name, areas: p.areas }))
    : queueAreas.map(a => ({ key: 'a:' + lower(a), name: leaf(a) || a, areas: [a] }));
  const lanes = defs.map(d => ({ key: d.key, name: d.name, epics: [], loose: [] }));
  const other = { key: '_other', name: 'Other', epics: [], loose: [] };
  const laneOf = area => {
    let best = null, len = -1;
    defs.forEach((d, i) => { for (const a of d.areas) if (under(area, a) && a.length > len) { best = lanes[i]; len = a.length; } });
    return best || other;
  };
  const epics = new Map();
  for (const e of items.filter(i => i.type === 'Epic')) {
    const row = { epic: e, features: [] };
    epics.set(e.id, row);
    laneOf(e.area).epics.push(row);
  }
  for (const f of items.filter(i => i.type === 'Feature')) {
    const parent = f.parentId != null ? epics.get(f.parentId) : null;
    if (parent) parent.features.push(f); else laneOf(f.area).loose.push(f);
  }
  return [...lanes, other].filter(l => l.epics.length || l.loose.length || l.key !== '_other');
}

/* ---------- dates ---------- */

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(pd(s));
export const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return dstr(d); };
export const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
export const todayOf = (now = Date.now()) => dstr(new Date(now));
const MIN_SPAN = 14; // days a bar spans when only one end is known

/** Sprint dates by iteration path, from iterations.list results ({project: [{path, start, finish}]}). Lower case keys. */
export function iterationIndex(iterations) {
  const out = new Map();
  for (const list of Object.values(iterations || {})) for (const x of Array.isArray(list) ? list : []) {
    if (x && x.path && isDate(x.start) && isDate(x.finish)) out.set(lower(x.path), { start: x.start, end: x.finish });
  }
  return out;
}

/**
 * Where an item goes on the time axis: {start, end, from}. `from` is 'dates' (its own start or target date),
 * 'sprint' (its iteration's dates) or null (no dates: it goes on the Now, Next, Later board).
 * With only one of its own dates, the other end comes from its sprint, else is MIN_SPAN days away.
 */
export function placeItem(item, iters) {
  const sprint = iters.get(lower(item.iteration)) || null;
  const s = isDate(item.startDate) ? item.startDate : null;
  const t = isDate(item.targetDate) ? item.targetDate : null;
  if (s && t) return s <= t ? { start: s, end: t, from: 'dates' } : { start: t, end: s, from: 'dates' };
  if (t) return { start: sprint && sprint.start <= t ? sprint.start : addDays(t, -MIN_SPAN), end: t, from: 'dates' };
  if (s) return { start: s, end: sprint && sprint.end >= s ? sprint.end : addDays(s, MIN_SPAN), from: 'dates' };
  if (sprint) return { start: sprint.start, end: sprint.end, from: 'sprint' };
  return { start: null, end: null, from: null };
}

/** An Epic's place: its own, else the span of its placed Features ('features'), else none. */
export function placeEpic(row, iters) {
  const own = placeItem(row.epic, iters);
  if (own.from) return own;
  const spans = row.features.map(f => placeItem(f, iters)).filter(p => p.from);
  if (!spans.length) return own;
  return { start: spans.map(p => p.start).sort()[0], end: spans.map(p => p.end).sort().pop(), from: 'features' };
}

const NOT_STARTED = new Set(['new', 'proposed', 'to do', 'approved', 'open']);

/** Board column for an item with no dates: 'now' (work started), 'next' (in a sprint), 'later' (neither). */
export function bucketOf(item) {
  if (!NOT_STARTED.has(lower(item.state))) return 'now';
  return String(item.iteration || '').includes('\\') ? 'next' : 'later';
}

/** The window the axis shows: whole months around every span and today, 3 to 24 months long. */
export function axisRange(spans, today) {
  const dates = [today, ...spans.flatMap(s => [s.start, s.end])].filter(isDate).sort();
  let start = dates[0].slice(0, 8) + '01';
  let endD = pd(dates[dates.length - 1]);
  let end = dstr(new Date(endD.getFullYear(), endD.getMonth() + 1, 1));
  const months = (a, b) => (pd(b).getFullYear() - pd(a).getFullYear()) * 12 + pd(b).getMonth() - pd(a).getMonth();
  if (months(start, end) < 3) { const e = pd(start); end = dstr(new Date(e.getFullYear(), e.getMonth() + 3, 1)); }
  if (months(start, end) > 24) {
    const t = pd(today);
    start = dstr(new Date(t.getFullYear(), t.getMonth() - 6, 1));
    end = dstr(new Date(t.getFullYear(), t.getMonth() + 18, 1));
  }
  return { start, end, days: daysBetween(start, end) };
}

/** Month ticks for the axis: [{date, label, left}] with left in percent. */
export function monthTicks(range) {
  const out = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let d = pd(range.start); dstr(d) < range.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const date = dstr(d);
    out.push({ date, label: d.getMonth() === 0 || !out.length ? `${names[d.getMonth()]} ${d.getFullYear()}` : names[d.getMonth()], left: pct(daysBetween(range.start, date), range.days) });
  }
  return out;
}

const pct = (n, total) => Math.round((n / total) * 10000) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** A span's left and width in percent of the axis, clipped to it. Ends are inclusive. Null when outside. */
export function barPos(span, range) {
  if (!span || !span.from) return null;
  const a = clamp(daysBetween(range.start, span.start), 0, range.days);
  const b = clamp(daysBetween(range.start, span.end) + 1, 0, range.days);
  if (b <= 0 || a >= range.days || b <= a) return null;
  return { left: pct(a, range.days), width: Math.max(0.6, pct(b - a, range.days)), clipped: daysBetween(range.start, span.start) < 0 || daysBetween(range.start, span.end) + 1 > range.days };
}

/* ---------- progress, stale, changed ---------- */

/** Story progress: {done, total, pct}. pct is null when there are no stories. */
export function progress(features) {
  const list = Array.isArray(features) ? features : [features];
  let done = 0, total = 0;
  for (const f of list) {
    const t = Number.isInteger(f && f.storiesTotal) ? Math.max(0, f.storiesTotal) : 0;
    total += t;
    done += Number.isInteger(f && f.storiesDone) ? clamp(f.storiesDone, 0, t) : 0;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : null };
}

const DAY = 864e5;
export function ageDays(iso, now) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.floor((now - t) / DAY) : null;
}
/** Stale: no change in ADO for staleDays or more. */
export function isStale(item, staleDays, now) {
  const a = ageDays(item.changed, now);
  return a !== null && a >= staleDays;
}

/** Ids whose ADO revision moved since you last looked. `seen` is {id: rev}; items never seen are not "changed". */
export function changedSinceSeen(items, seen) {
  return new Set(items.filter(i => seen[i.id] !== undefined && seen[i.id] < i.rev).map(i => i.id));
}

/** Release health for one Epic row: its Features with state, progress, stale and changed, and the totals. */
export function releaseHealth(row, { seen, staleDays, now }) {
  const changed = changedSinceSeen([row.epic, ...row.features], seen);
  const features = row.features.map(f => ({ ...f, progress: progress(f), stale: isStale(f, staleDays, now), changedSince: changed.has(f.id) }))
    .sort((a, b) => Number(b.changedSince) - Number(a.changedSince) || Number(b.stale) - Number(a.stale) || a.title.localeCompare(b.title));
  return {
    epic: row.epic,
    epicChanged: changed.has(row.epic.id),
    features,
    progress: progress(row.features),
    stale: features.filter(f => f.stale).length,
    changed: changed.size
  };
}

/** "2 hours ago" style age. */
export function ago(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/* ---------- sprint math (a copy of Docket's rules) ---------- */

const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Docket's sprint settings, cleaned the way Docket cleans them. */
export function cleanSprint(s) {
  const o = Object.assign({}, s && typeof s === 'object' ? JSON.parse(JSON.stringify(s)) : {});
  o.anchor = isDate(o.anchor) ? o.anchor : null;
  o.lengthWeeks = Number.isInteger(+o.lengthWeeks) && +o.lengthWeeks >= 1 && +o.lengthWeeks <= 8 ? +o.lengthWeeks : 2;
  o.workdays = Array.isArray(o.workdays) ? [...new Set(o.workdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [1, 2, 3, 4, 5];
  if (!o.workdays.length) o.workdays = [1, 2, 3, 4, 5];
  o.holidays = Array.isArray(o.holidays) ? [...new Set(o.holidays.filter(isDate))].sort() : [];
  o.dayStart = isTime(o.dayStart) ? o.dayStart : '09:00';
  o.dayEnd = isTime(o.dayEnd) ? o.dayEnd : '17:00';
  return o;
}

export const isWorkday = (sp, date) => sp.workdays.includes(pd(date).getDay()) && !sp.holidays.includes(date);
const sprintLen = sp => sp.lengthWeeks * 7;
const sprintIndex = (sp, date) => Math.floor(daysBetween(sp.anchor, date) / sprintLen(sp));
const sprintStartOf = (sp, idx) => addDays(sp.anchor, idx * sprintLen(sp));
function sprintId(sp, idx) {
  const start = sprintStartOf(sp, idx), y = start.slice(0, 4);
  let first = sprintIndex(sp, `${y}-01-01`);
  if (sprintStartOf(sp, first) < `${y}-01-01`) first++;
  return `${y}-${idx - first + 1}`;
}

/** Where a date sits in its sprint, as Docket says it. Null when there is no anchor. day is null on a day off. */
export function sprintInfo(sp, date) {
  if (!sp || !sp.anchor || !isDate(date)) return null;
  const idx = sprintIndex(sp, date), start = sprintStartOf(sp, idx), end = addDays(start, sprintLen(sp) - 1);
  let total = 0, day = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWorkday(sp, d)) continue;
    total++;
    if (d === date) day = total;
  }
  return { index: idx, id: sprintId(sp, idx), start, end, day, total, off: day == null, last: day != null && day === total, holiday: sp.holidays.includes(date) };
}

/** The date of sprint day n in the sprint starting at start (the last working day if the sprint is shorter). */
export function sprintDayDate(sp, start, n, last = false) {
  const end = addDays(start, sprintLen(sp) - 1);
  let k = 0, lastDay = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWorkday(sp, d)) continue;
    k++; lastDay = d;
    if (!last && k === n) return d;
  }
  return lastDay;
}

/**
 * The current sprint as a strip of days, with each ceremony on the day it falls. Null without a sprint.
 * {info, days: [{date, weekday, day, off, holiday, today, ceremonies[]}]}. Off days (weekends, holidays) have day null.
 */
export function sprintStrip(sp, today, ceremonies = []) {
  const s = cleanSprint(sp);
  const info = sprintInfo(s, today);
  if (!info) return null;
  const on = new Map();
  for (const c of ceremonies) {
    const d = sprintDayDate(s, info.start, c.dueDay, c.last);
    if (d) on.set(d, [...(on.get(d) || []), c]);
  }
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [];
  let n = 0;
  for (let d = info.start; d <= info.end; d = addDays(d, 1)) {
    const work = isWorkday(s, d);
    if (work) n++;
    days.push({ date: d, weekday: names[pd(d).getDay()], day: work ? n : null, off: !work, holiday: s.holidays.includes(d), today: d === today, ceremonies: on.get(d) || [] });
  }
  return { info, days };
}

/** Docket's sprint from its dayplan/settings envelope: {state: 'ok' | 'unset' | 'newer', sprint}. */
export function docketSprint(env) {
  if (!env) return { state: 'unset', sprint: cleanSprint({}) };
  if (env.schema !== 'prioritizer.dayplan/settings' || env.version !== DOCKET_VERSION) return { state: 'newer', sprint: cleanSprint({}) };
  const sprint = cleanSprint(env.meta && env.meta.sprint);
  return { state: sprint.anchor ? 'ok' : 'unset', sprint };
}

/* ---------- ceremonies and the handoff to Docket ---------- */

const EFFORT_BY_MINUTES = [[15, 'XS'], [30, 'S'], [60, 'M'], [120, 'L']];
export const effortFor = minutes => (EFFORT_BY_MINUTES.find(([m]) => (minutes || 0) <= m) || [0, 'XL'])[1];

/** A ceremony: {id, name, dueDay, last, minutes, planKind, role}. Null without a name. */
export function cleanCeremony(c) {
  if (!c || typeof c !== 'object') return null;
  const name = str(c.name, 300);
  if (!name) return null;
  const minutes = Number.isInteger(+c.minutes) && c.minutes !== '' && c.minutes !== null && +c.minutes >= 0 && +c.minutes <= 1440 ? +c.minutes : null;
  return {
    id: str(c.id, 40) || slugId('cer', name).slice(0, 40),
    name,
    dueDay: int(+c.dueDay, 1, 60, 1),
    last: c.last === true,
    minutes,
    planKind: lower(str(c.planKind, 40)),
    role: str(c.role, 80)
  };
}

/** Ceremonies in sprint order: by due day, Last day at the end. */
export const sortCeremonies = list => [...list].sort((a, b) => (a.last - b.last) || (a.last ? 0 : a.dueDay - b.dueDay) || a.name.localeCompare(b.name));

export const offerId = c => `h_${c.id}`;

/** The every-sprint offer for a ceremony, as an item of pm.handoffs (workshop docs/handoffs.md, Receivers). */
export function ceremonyOffer(c, { date, createdAt }) {
  const notes = [c.role ? `Role: ${c.role}.` : '', c.minutes ? `${c.minutes} minutes.` : ''].filter(Boolean).join(' ');
  const payload = { kind: 'every-sprint', title: c.name, ...(c.last ? { last: true } : { dueDay: c.dueDay }), value: 2, effort: effortFor(c.minutes) };
  if (c.planKind) payload.planKind = c.planKind;
  if (notes) payload.notes = notes;
  return { id: offerId(c), to: DOCKET, date, createdAt, text: c.name, payload, source: { app: APP, id: c.id } };
}

const sameOffer = (a, b) => a.text === b.text && JSON.stringify(a.payload) === JSON.stringify(b.payload);

/**
 * The handoffs items after "Send to Docket": one offer per ceremony (kept as is when nothing changed, so Docket
 * does not see it again), offers for removed ceremonies withdrawn, offers older than HANDOFF_DAYS dropped.
 * Items for other receivers are kept.
 */
export function syncOffers(existing, ceremonies, { today, createdAt }) {
  const byId = new Map((existing || []).map(h => [h.id, h]));
  const fresh = h => (pd(today) - pd(h.date)) / 864e5 <= HANDOFF_DAYS;
  const out = (existing || []).filter(h => !(h.to === DOCKET && h.source && h.source.app === APP) && isDate(h.date) && fresh(h));
  for (const c of ceremonies) {
    const next = ceremonyOffer(c, { date: today, createdAt });
    const old = byId.get(next.id);
    const keep = old && isDate(old.date) && fresh(old) && sameOffer(old, next);
    out.push(keep ? old : next);
  }
  return out;
}

/** Where a ceremony stands with Docket: 'accepted' (an every-sprint task from it), 'offered', 'changed' or 'new'. */
export function ceremonyStatus(c, offers, recurring) {
  if ((recurring || []).some(r => r && r.from && r.from.app === APP && r.from.id === c.id)) {
    const o = (offers || []).find(h => h.id === offerId(c));
    if (o && !sameOffer(o, ceremonyOffer(c, { date: o.date, createdAt: o.createdAt }))) return 'changed';
    return 'accepted';
  }
  const o = (offers || []).find(h => h.id === offerId(c));
  if (!o) return 'new';
  return sameOffer(o, ceremonyOffer(c, { date: o.date, createdAt: o.createdAt })) ? 'offered' : 'changed';
}

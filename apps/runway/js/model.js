/* Runway's roadmap model. No DOM, so Node tests drive it.

   A roadmap (doc) is {meta, lanes, items}:
     meta   {title, scale, origin, sprint: {anchor, weeks} | null, range: {from, to} | null, hidden: [laneId]}
     lanes  [{id, kind: 'lane', title, order}]
     items  [{id, kind: 'item', lane, order, title, start, end, size, milestone, status, color, notes,
              dependsOn, afterMissing, ado?}]
            and [{id, kind: 'text', lane, order, raw}] for outline lines that are not items (kept, never dropped)
   On disk it is one collection, maps/<id>: lanes and items are the envelope's items, meta is its meta. */
import { addDays, firstPeriod, fromDay, isDate, monthStart, periodAdd, periodStart, sizeEnd, sprintOf, toDay, today } from './dates.js';

export const APP = 'runway';
export const VERSION = 1;
export const STATUSES = ['planned', 'active', 'done', 'at risk', 'cut'];
export const COLORS = ['slate', 'teal', 'green', 'amber', 'red', 'purple', 'gray'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function newId(prefix) {
  const r = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}-${Date.now().toString(36)}${r}`;
}

/** A new map id: a collection name segment (maps/<id>). */
export const newMapId = () => newId('m').toLowerCase();
export const validMapId = (id) => ID.test(String(id || ''));

export function blankDoc(title = 'Untitled roadmap', now = new Date()) {
  return { meta: { title, scale: 'month', origin: monthStart(today(now)), sprint: null, range: null, hidden: [] }, lanes: [], items: [] };
}

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

/** Read a map envelope into a doc, cleaning anything malformed. Unknown fields stay on items. */
export function fromEnvelope(env, now = new Date()) {
  const base = blankDoc(undefined, now);
  const m = (env && env.meta) || {};
  const meta = {
    ...m,
    title: clip(m.title || base.meta.title, 120),
    scale: ['week', 'sprint', 'month', 'quarter'].includes(m.scale) ? m.scale : 'month',
    origin: isDate(m.origin) ? m.origin : base.meta.origin,
    sprint: m.sprint && isDate(m.sprint.anchor) ? { anchor: m.sprint.anchor, weeks: sprintOf(m).weeks } : null,
    range: m.range && isDate(m.range.from) && isDate(m.range.to) && m.range.from <= m.range.to ? { from: m.range.from, to: m.range.to } : null,
    hidden: Array.isArray(m.hidden) ? m.hidden.filter(x => typeof x === 'string') : []
  };
  delete meta.updatedAt;
  const lanes = [], items = [];
  for (const x of (env && env.items) || []) {
    const { updatedAt, ...rest } = x;
    if (x.kind === 'lane') lanes.push({ ...rest, title: clip(x.title || 'Lane', 80), order: Number(x.order) || 0 });
    else if (x.kind === 'text') items.push({ ...rest, lane: x.lane || null, order: Number(x.order) || 0, raw: String(x.raw || '') });
    else if (x.kind === 'item') items.push(cleanItem(rest));
  }
  const laneIds = new Set(lanes.map(l => l.id));
  for (const it of items) if (it.lane && !laneIds.has(it.lane)) it.lane = null;
  return { meta, lanes, items };
}

export function cleanItem(x) {
  const start = isDate(x.start) ? x.start : null;
  let end = isDate(x.end) ? x.end : null;
  if (start && (!end || end < start)) end = start;
  const size = x.size && Number(x.size.n) >= 1 && ['day', 'week', 'sprint', 'month', 'quarter'].includes(x.size.unit)
    ? { n: Math.min(500, Math.round(Number(x.size.n))), unit: x.size.unit } : null;
  return {
    ...x,
    kind: 'item',
    lane: x.lane || null,
    order: Number(x.order) || 0,
    title: clip(x.title || 'Untitled', 200),
    start, end: start ? end : null,
    size: start ? null : size,
    milestone: !!x.milestone,
    status: STATUSES.includes(x.status) ? x.status : 'planned',
    color: COLORS.includes(x.color) ? x.color : '',
    notes: clip(x.notes, 4000),
    dependsOn: Array.isArray(x.dependsOn) ? x.dependsOn.filter(d => typeof d === 'string' && d !== x.id) : [],
    afterMissing: Array.isArray(x.afterMissing) ? x.afterMissing.map(s => clip(s, 200)) : []
  };
}

/** A doc as envelope parts: {items, meta}. Deterministic, so stamping sees only real changes. */
export function toEnvelopeParts(doc) {
  return {
    items: [...doc.lanes.map(l => ({ ...l, kind: 'lane' })), ...doc.items],
    meta: { ...doc.meta }
  };
}

/** When each item runs: Map id -> {start, end} (null when it is unscheduled). Sizes chain after dependencies. */
export function schedule(doc) {
  const sprint = sprintOf(doc.meta);
  const byId = new Map(doc.items.filter(x => x.kind === 'item').map(x => [x.id, x]));
  const out = new Map();
  const visiting = new Set();
  const resolve = (it) => {
    if (out.has(it.id)) return out.get(it.id);
    if (visiting.has(it.id)) return null; // a loop of "after"
    visiting.add(it.id);
    let r = null;
    if (it.start) r = { start: it.start, end: it.milestone ? it.start : (it.end || it.start) };
    else if (it.size) {
      let start = firstPeriod(doc.meta.scale, doc.meta.origin, sprint);
      const ends = it.dependsOn.map(id => byId.get(id)).filter(Boolean).map(resolve).filter(Boolean).map(d => d.end);
      if (ends.length) start = addDays(ends.sort().at(-1), 1);
      r = { start, end: sizeEnd(start, it.size, sprint) };
    }
    visiting.delete(it.id);
    out.set(it.id, r);
    return r;
  };
  for (const it of byId.values()) resolve(it);
  return out;
}

/** Items that start before something they depend on ends: [{id, dep}]. */
export function depWarnings(doc, sched = schedule(doc)) {
  const out = [];
  for (const it of doc.items) {
    if (it.kind !== 'item') continue;
    const s = sched.get(it.id);
    if (!s) continue;
    for (const d of it.dependsOn) {
      const ds = sched.get(d);
      if (ds && s.start <= ds.end) out.push({ id: it.id, dep: d });
    }
  }
  return out;
}

/** The dates the timeline shows: the map's own range, or every scheduled item padded by one period. */
export function viewRange(doc, sched = schedule(doc), now = new Date()) {
  if (doc.meta.range) return { ...doc.meta.range };
  const sprint = sprintOf(doc.meta);
  const scale = doc.meta.scale;
  const spans = [...sched.values()].filter(Boolean);
  if (!spans.length) {
    const from = periodStart(scale, today(now), sprint);
    return { from, to: addDays(periodAdd(scale, from, scale === 'quarter' ? 4 : 6, sprint), -1) };
  }
  const min = fromDay(Math.min(...spans.map(s => toDay(s.start))));
  const max = fromDay(Math.max(...spans.map(s => toDay(s.end))));
  const from = periodAdd(scale, periodStart(scale, min, sprint), -1, sprint);
  const to = addDays(periodAdd(scale, periodStart(scale, max, sprint), 2, sprint), -1);
  return { from, to };
}

/** Next order number at the end of a lane. */
export const nextOrder = (doc, lane) => Math.max(-1, ...doc.items.filter(x => (x.lane || null) === lane).map(x => x.order)) + 1;

/** Remove an item and every dependency on it. */
export function removeItem(doc, id) {
  doc.items = doc.items.filter(x => x.id !== id);
  for (const x of doc.items) if (x.kind === 'item' && x.dependsOn.includes(id)) x.dependsOn = x.dependsOn.filter(d => d !== id);
}

/** Move an item to start on `start`, keeping its length. Sized items become dated. */
export function moveItem(doc, id, start, sched = schedule(doc)) {
  const it = doc.items.find(x => x.id === id);
  const s = sched.get(id);
  if (!it || !isDate(start)) return;
  const len = s ? toDay(s.end) - toDay(s.start) : 0;
  it.start = start;
  it.end = it.milestone ? start : addDays(start, len);
  it.size = null;
}

/** Change an item's end (or start, with `edge: 'start'`), never past its other edge. */
export function resizeItem(doc, id, date, edge = 'end', sched = schedule(doc)) {
  const it = doc.items.find(x => x.id === id);
  const s = sched.get(id);
  if (!it || !s || it.milestone || !isDate(date)) return;
  it.start = s.start; it.end = s.end; it.size = null;
  if (edge === 'start') it.start = date > it.end ? it.end : date;
  else it.end = date < it.start ? it.start : date;
}

/** Plain-text links in notes that are safe to make clickable. */
export function linksIn(text) {
  return [...String(text || '').matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)].map(m => m[0]);
}

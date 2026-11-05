/* The outline: a roadmap as plain text, one item per line. No DOM, so Node tests drive it.

     # Platform Q1 2027
     scale: sprint
     start: 2027-01-04
     sprint: 2027-01-06, 2 weeks

     ## Docs Portal
     - Content migration | S1-S3
     - Search cutover | S4 | after: Content migration
     - * Launch | S5
     - Alerting rework | 3 sprints | status: at risk | color: amber | who: @sam, @leadership
       Notes are the indented lines under an item.
       - Pager routing | S5
         An indented "- " line is a child item (epic > feature > story > task).

   `goal: S3 | text` is a goal for a period (a sprint, month or quarter, in the map's scale).
   `#` is the title, `##` a lane, `-` an item, `- *` a milestone. After the title, `|` separates the parts
   of an item: when it happens (a date range, a period or a size), `after:` (items it depends on), `status:`,
   `color:` and `who:` (owners: @handles of people and groups in Workshop's people directory). A line that cannot be read stays as text with a warning; nothing is dropped. A note line that
   starts with "- " is written "\- " so it stays a note.

   parse(text) reads it; serialize(doc, {mention}) writes a roadmap back in the same format, so text, timeline
   and Markdown are one thing. reconcile(doc, parsed, {resolve}) applies an edited outline to a roadmap and
   keeps the ids, so other windows merge item by item. `mention` (id to @handle) and `resolve` (tokens to
   {ids, missing}) come from js/people.js; without them owners are written and read as ids. */
import {
  MONTHS, SCALES, addDays, firstPeriod, isDate, monthEnd, monthStart, parts, periodAdd, periodEnd, periodStart,
  quarterOf, quarterStart, sprintNumber, sprintOf, ymd
} from './dates.js';
import { COLORS, MAX_DEPTH, STATUSES, newId } from './model.js';

export const TABLE_MARK = '<!-- runway:table -->';
const UNITS = { d: 'day', day: 'day', days: 'day', w: 'week', wk: 'week', wks: 'week', week: 'week', weeks: 'week',
  sprint: 'sprint', sprints: 'sprint', mo: 'month', month: 'month', months: 'month', q: 'quarter', quarter: 'quarter', quarters: 'quarter' };
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const monthIdx = (s) => MONTHS.findIndex(m => m.toLowerCase() === s.slice(0, 3).toLowerCase()) + 1;

/* ---------- when ---------- */

/** One period token: {start, end, yearless?} or null. ctx: {origin, sprint, year}. */
function period(tok, ctx) {
  const t = tok.trim().toLowerCase().replace(/\s+/g, ' ');
  let m;
  if (isDate(t)) return { start: t, end: t };
  if ((m = /^(\d{4})-(\d{2})$/.exec(t)) && +m[2] >= 1 && +m[2] <= 12) { const s = ymd(+m[1], +m[2], 1); return { start: s, end: monthEnd(s) }; }
  if ((m = /^(\d{4})$/.exec(t))) return { start: ymd(+m[1], 1, 1), end: ymd(+m[1], 12, 31) };
  if ((m = /^q([1-4])(?: (\d{4}))?$/.exec(t)) || (m = /^(\d{4})[ -]q([1-4])$/.exec(t))) {
    const [q, y] = /^q/.test(t) ? [+m[1], m[2] ? +m[2] : null] : [+m[2], +m[1]];
    const s = ymd(y || ctx.year, (q - 1) * 3 + 1, 1);
    return { start: s, end: addDays(ymd(y || ctx.year, q * 3 + 1, 1), -1), yearless: !y };
  }
  if ((m = new RegExp(`^${MONTH_RE}(?: (\\d{4}))?$`).exec(t))) {
    const y = m[2] ? +m[2] : null;
    const s = ymd(y || ctx.year, monthIdx(m[1]), 1);
    return { start: s, end: monthEnd(s), yearless: !y };
  }
  if ((m = /^([sw])(\d{1,3})$/.exec(t))) {
    const n = +m[2];
    if (n < 1) return null;
    const scale = m[1] === 's' ? 'sprint' : 'week';
    const first = firstPeriod(scale, ctx.origin, ctx.sprint);
    const s = periodAdd(scale, first, n - 1, ctx.sprint);
    return { start: s, end: periodEnd(scale, s, ctx.sprint) };
  }
  return null;
}

// A year-less month or quarter moved to year `y` (its end is always the end of a month).
function yearOn(p, y) {
  const a = parts(p.start), b = parts(p.end);
  return { start: ymd(y, a.m, 1), end: monthEnd(ymd(y + (b.y - a.y), b.m, 1)) };
}

/** A range "A..B", "A to B", or a short form like "Jan-Mar 2027", "Q1-Q2", "S1-S3". */
export function parseWhen(text, ctx) {
  const t = String(text).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let m;
  if ((m = /^(\d{1,3}) ?([a-z]+)$/i.exec(t)) && UNITS[m[2].toLowerCase()] && +m[1] >= 1) return { size: { n: +m[1], unit: UNITS[m[2].toLowerCase()] } };
  const sep = /\s*\.\.\s*|\s+to\s+/i;
  let pair = null;
  if (sep.test(t)) pair = t.split(sep);
  else if ((m = new RegExp(`^(${MONTH_RE})\\s*-\\s*(${MONTH_RE})(?: (\\d{4}))?$`, 'i').exec(t))) pair = [m[1] + (m[5] ? ' ' + m[5] : ''), m[3] + (m[5] ? ' ' + m[5] : '')];
  else if ((m = /^q([1-4])\s*-\s*q([1-4])(?: (\d{4}))?$/i.exec(t))) pair = [`q${m[1]}${m[3] ? ' ' + m[3] : ''}`, `q${m[2]}${m[3] ? ' ' + m[3] : ''}`];
  else if ((m = /^([sw])(\d{1,3})\s*-\s*\1?(\d{1,3})$/i.exec(t))) pair = [m[1] + m[2], m[1] + m[3]];
  if (!pair) { const p = period(t, ctx); return p ? { start: p.start, end: p.end } : null; }
  if (pair.length !== 2) return null;
  const a = period(pair[0], ctx), b0 = period(pair[1], ctx);
  if (!a || !b0) return null;
  let b = b0;
  // "Nov..Feb" or "Nov 2026..Feb": a year-less end that falls before the start is the next year.
  if (b0.yearless && b0.start < a.start) b = yearOn(b0, parts(a.start).y + (parts(b0.start).m < parts(a.start).m ? 1 : 0));
  if (b.end < a.start) return null;
  return { start: a.start, end: b.end };
}

/** The shortest outline text for a date range, in the map's own scale. */
export function formatWhen(start, end, meta) {
  const scale = meta.scale || 'month';
  const sprint = sprintOf(meta);
  const origin = meta.origin || start;
  if (start === end) return start;
  const wholeMonths = start === monthStart(start) && end === monthEnd(end);
  if (wholeMonths && scale === 'quarter' && start === quarterStart(start) && end === monthEnd(addDays(quarterStart(end), 62))) {
    const a = parts(start).y, b = parts(end).y;
    if (quarterStart(start) === quarterStart(end)) return `Q${quarterOf(start)} ${a}`;
    return a === b ? `Q${quarterOf(start)}-Q${quarterOf(end)} ${a}` : `Q${quarterOf(start)} ${a}..Q${quarterOf(end)} ${b}`;
  }
  if (wholeMonths && (scale === 'month' || scale === 'quarter')) {
    const a = parts(start), b = parts(end);
    if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.y}`;
    return a.y === b.y ? `${MONTHS[a.m - 1]}-${MONTHS[b.m - 1]} ${a.y}` : `${MONTHS[a.m - 1]} ${a.y}..${MONTHS[b.m - 1]} ${b.y}`;
  }
  if (scale === 'sprint' || scale === 'week') {
    const k = scale === 'sprint' ? 'S' : 'W';
    if (periodStart(scale, start, sprint) === start && periodEnd(scale, periodStart(scale, end, sprint), sprint) === end) {
      const first = firstPeriod(scale, origin, sprint);
      const num = (d) => scale === 'sprint' ? sprintNumber(d, origin, sprint) : Math.round((Date.parse(d) - Date.parse(first)) / (7 * 86400000)) + 1;
      const a = num(start), b = num(periodStart(scale, end, sprint));
      if (a >= 1) return a === b ? `${k}${a}` : `${k}${a}-${k}${b}`;
    }
  }
  return `${start}..${end}`;
}

const sizeText = (s) => `${s.n} ${s.unit}${s.n === 1 ? '' : 's'}`;

/* ---------- parse ---------- */

const splitBars = (s) => {
  const out = []; let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out.map(x => x.trim());
};
const escTitle = (s) => String(s).replace(/\|/g, '\\|');
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function header(line) {
  const m = /^(scale|start|sprint|goal)\s*:\s*(.*)$/i.exec(line.trim());
  return m ? { key: m[1].toLowerCase(), value: m[2].trim() } : null;
}

/** Reads the header lines first, since relative dates (S1, W1, Jan) depend on them. */
function readHeaders(lines, todayStr) {
  const meta = {};
  const bad = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === TABLE_MARK) break;
    if (/^\s/.test(lines[i]) || /^\s*[-*+#]/.test(lines[i])) continue;
    const h = header(lines[i]);
    if (!h) continue;
    if (h.key === 'scale') {
      const v = h.value.toLowerCase().replace(/s$/, '');
      if (SCALES.includes(v)) meta.scale = v; else bad.set(i, `Scale is week, sprint, month or quarter, not "${h.value}".`);
    }
    if (h.key === 'start') {
      const p = period(h.value, { year: parts(todayStr).y, origin: todayStr, sprint: sprintOf({}) });
      if (p) meta.origin = p.start; else bad.set(i, `Couldn't read the start date "${h.value}". Try 2027-01-04.`);
    }
    if (h.key === 'sprint') {
      const m = /^(\d{4}-\d{2}-\d{2})(?:\s*,?\s*(\d)\s*(?:w|wk|wks|weeks?)?)?$/i.exec(h.value);
      if (m && isDate(m[1])) meta.sprint = { anchor: m[1], weeks: m[2] ? Math.max(1, Math.min(8, +m[2])) : 2 };
      else bad.set(i, `Couldn't read "${h.value}". Write the first day of any sprint, then its length: 2027-01-06, 2 weeks.`);
    }
  }
  return { meta, bad };
}

/**
 * Read an outline. Returns {meta, lanes: [{title}], entries, warnings: [{line, message}]}, where each entry is
 * {kind: 'item', lane (index or -1), parent (index of its parent entry, or -1), title, start?, end?, size?,
 * milestone, status, color, after: [titles], notes} or {kind: 'text', lane, raw}. `defaults` fills what the text leaves out (the map's current meta).
 */
export function parse(text, { today: todayStr = '2026-01-01', defaults = {} } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const { meta: hm, bad } = readHeaders(lines, todayStr);
  const meta = { ...hm };
  const full = { ...defaults, ...meta };
  const origin = full.origin || monthStart(todayStr);
  const ctx = { origin, sprint: sprintOf({ ...full, origin }), year: parts(origin).y };
  const lanes = [];
  const entries = [];
  const warnings = [];
  const goals = [];
  let lane = -1;
  let last = null;      // the item notes attach to
  let stack = [];       // [{indent, entry}]: the items the next indented "- " line can sit under
  const asText = (i, raw, message) => { entries.push({ kind: 'text', lane, raw }); if (message) warnings.push({ line: i + 1, message }); last = null; stack = []; };
  const indentOf = (raw) => /^[ \t]*/.exec(raw)[0].replace(/\t/g, '  ').length;
  let parentFor = -1;   // the entry index the item on this line sits under

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === TABLE_MARK) break;
    if (!line) { last = null; stack = []; continue; }
    parentFor = -1;
    if (/^\s/.test(raw) && stack.length && /^[-*+]\s+/.test(line)) {
      // An indented "- " line under an item is its child.
      const ind = indentOf(raw);
      while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
      if (stack.length) {
        if (stack.length > MAX_DEPTH) { asText(i, raw, `Line ${i + 1} is nested more than ${MAX_DEPTH + 1} levels deep.`); continue; }
        parentFor = entries.indexOf(stack[stack.length - 1].entry);
      }
    } else if (/^\s/.test(raw) && last) {
      // Other indented lines under an item are its notes. "\- " keeps a bullet in the notes.
      const note = line.replace(/^\\([-*+]\s)/, '$1');
      last.notes = last.notes ? last.notes + '\n' + note : note;
      continue;
    }
    if (/^<!--.*-->$/.test(line)) continue;
    if (/^#\s+/.test(line)) { meta.title = line.replace(/^#\s+/, '').trim().slice(0, 120); last = null; continue; }
    if (/^##\s+/.test(line)) { lanes.push({ title: line.replace(/^##\s+/, '').trim().slice(0, 80) || 'Lane' }); lane = lanes.length - 1; last = null; stack = []; continue; }
    const h = header(line);
    if (h && h.key === 'goal') {
      const [when, ...rest] = splitBars(h.value);
      const text = rest.join(' | ').trim().slice(0, 300);
      const w = parseWhen(when, ctx);
      if (!w || !w.start || !text) { asText(i, raw, `Write a goal as "goal: S3 | What this sprint delivers" (a period, then the goal).`); continue; }
      goals.push({ date: w.start, text });
      last = null;
      continue;
    }
    if (h) { if (bad.has(i)) asText(i, raw, bad.get(i)); else last = null; continue; }
    const b = /^[-*+]\s+(.*)$/.exec(line);
    if (!b) { asText(i, raw, `Line ${i + 1} isn't an item. Start items with "- ", lanes with "## ".`); continue; }
    let body = b[1];
    const milestone = /^\*\s+/.test(body);
    if (milestone) body = body.replace(/^\*\s+/, '');
    const segs = splitBars(body);
    const title = segs.shift().slice(0, 200);
    if (!title) { asText(i, raw, `Line ${i + 1} has no title.`); continue; }
    const it = { kind: 'item', lane, parent: parentFor, title, milestone, status: 'planned', color: '', after: [], who: [], notes: '' };
    let problem = '';
    for (const seg of segs) {
      if (!seg) continue;
      const kv = /^(after|status|color|colour|who)\s*:\s*(.*)$/i.exec(seg);
      if (kv) {
        const k = kv[1].toLowerCase(), v = kv[2].trim();
        if (k === 'after') it.after.push(...v.split(',').map(s => s.trim()).filter(Boolean));
        else if (k === 'who') it.who.push(...v.split(',').map(s => s.trim()).filter(Boolean));
        else if (k === 'status') { const s = norm(v).replace(/-/g, ' '); if (STATUSES.includes(s)) it.status = s; else { problem = `Status is planned, active, done, at risk or cut, not "${v}".`; break; } }
        else { const c = norm(v); if (COLORS.includes(c)) it.color = c; else { problem = `Color is one of ${COLORS.join(', ')}, not "${v}".`; break; } }
        continue;
      }
      if (it.start || it.size) { problem = `"${seg}" is a second date on line ${i + 1}.`; break; }
      const w = parseWhen(seg, ctx);
      if (!w) { problem = `Couldn't read "${seg}" as a date. Try Jan-Mar 2027, Q2, S3-S4, 2027-03-01..2027-03-15 or 3 sprints.`; break; }
      if (w.size && milestone) { problem = `A milestone is one date, not a length ("${seg}").`; break; }
      Object.assign(it, w);
    }
    if (problem) { asText(i, raw, problem); continue; }
    if (milestone && it.start) it.end = it.start;
    entries.push(it);
    last = it;
    if (parentFor < 0) stack = [];
    stack.push({ indent: indentOf(raw), entry: it });
  }
  // One goal per period: a later line for the same period wins.
  meta.goals = [...new Map(goals.map(g => [g.date, g])).values()].sort((a, b) => a.date.localeCompare(b.date));
  return { meta, lanes, entries, warnings };
}

/* ---------- serialize ---------- */

function itemLine(it, doc, byId, depth = 0, mention = id => id) {
  const segs = [escTitle(it.title)];
  if (it.milestone && it.start) segs.push(it.start);
  else if (it.start && it.end) segs.push(formatWhen(it.start, it.end, doc.meta));
  else if (it.size) segs.push(sizeText(it.size));
  const after = [...(it.dependsOn || []).map(id => byId.get(id)).filter(Boolean).map(x => x.title), ...(it.afterMissing || [])];
  if (after.length) segs.push('after: ' + after.map(escTitle).join(', '));
  if (it.status && it.status !== 'planned') segs.push('status: ' + it.status);
  if (it.color) segs.push('color: ' + it.color);
  if (it.who && it.who.length) segs.push('who: ' + it.who.map(mention).join(', '));
  const pad = '  '.repeat(depth);
  const notes = (it.notes || '').split('\n').filter(l => l.trim()).map(l => pad + '  ' + l.trim().replace(/^([-*+]\s)/, '\\$1'));
  return [`${pad}- ${it.milestone ? '* ' : ''}${segs.join(' | ')}`, ...notes].join('\n');
}

/** A roadmap as outline text. mention: an owner id as written (an @handle); ids as they are by default. */
export function serialize(doc, { mention = id => id } = {}) {
  const m = doc.meta;
  const out = [`# ${m.title || 'Untitled roadmap'}`, `scale: ${m.scale || 'month'}`];
  if (m.origin) out.push(`start: ${m.origin}`);
  if (m.sprint && isDate(m.sprint.anchor)) out.push(`sprint: ${m.sprint.anchor}, ${m.sprint.weeks} weeks`);
  const sp = sprintOf(m);
  for (const g of [...(m.goals || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const start = periodStart(m.scale || 'month', g.date, sp);
    out.push(`goal: ${formatWhen(start, periodEnd(m.scale || 'month', start, sp), m)} | ${g.text}`);
  }
  const byId = new Map(doc.items.filter(x => x.kind === 'item').map(x => [x.id, x]));
  const inLane = (laneId) => doc.items.filter(x => (x.lane || null) === laneId).sort((a, b) => a.order - b.order);
  const block = (list) => {
    const here = new Set(list.map(x => x.id));
    const out = [];
    const add = (x, depth) => {
      out.push(x.kind === 'text' ? x.raw : itemLine(x, doc, byId, depth, mention));
      if (x.kind === 'item') for (const c of list.filter(c => c.kind === 'item' && c.parent === x.id)) add(c, depth + 1);
    };
    for (const x of list) if (x.kind === 'text' || !x.parent || !here.has(x.parent)) add(x, 0);
    return out;
  };
  const loose = inLane(null);
  if (loose.length) out.push('', ...block(loose));
  for (const lane of [...doc.lanes].sort((a, b) => a.order - b.order)) {
    out.push('', `## ${lane.title}`);
    const list = inLane(lane.id);
    if (list.length) out.push(...block(list));
  }
  return out.join('\n') + '\n';
}

/* ---------- reconcile ---------- */

/** Apply a parsed outline to a roadmap, keeping ids, colors and links of items it can match by title.
    resolve: owner tokens to {ids, missing}; by default only ids are kept. Returns {doc, warnings, newPeople}:
    newPeople is [{id, names}], owners the directory does not have yet, for the caller to add and assign. */
export function reconcile(doc, parsed, { resolve = toks => ({ ids: toks.filter(t => /^[pg]_[A-Za-z0-9_-]+$/.test(t)), missing: [] }) } = {}) {
  const newPeople = [];
  const meta = { ...doc.meta, ...parsed.meta };
  const freeLanes = [...doc.lanes];
  const lanes = parsed.lanes.map((l, i) => {
    const k = freeLanes.findIndex(x => norm(x.title) === norm(l.title));
    const old = k >= 0 ? freeLanes.splice(k, 1)[0] : null;
    return { ...(old || {}), id: old ? old.id : newId('l'), kind: 'lane', title: l.title, order: i };
  });
  const laneOf = (idx) => (idx >= 0 ? lanes[idx].id : null);
  const oldItems = doc.items.filter(x => x.kind === 'item');
  const oldText = doc.items.filter(x => x.kind === 'text');
  const used = new Set();
  const counters = new Map();
  const items = parsed.entries.map((e, ei) => {
    const lane = laneOf(e.lane);
    const order = counters.get(lane) || 0;
    counters.set(lane, order + 1);
    if (e.kind === 'text') {
      const old = oldText.find(x => !used.has(x.id) && x.raw === e.raw);
      if (old) used.add(old.id);
      return { id: old ? old.id : newId('t'), kind: 'text', lane, order, raw: e.raw };
    }
    const old = oldItems.find(x => !used.has(x.id) && norm(x.title) === norm(e.title) && (x.lane || null) === lane)
      || oldItems.find(x => !used.has(x.id) && norm(x.title) === norm(e.title));
    if (old) used.add(old.id);
    const it = {
      ...(old || {}), id: old ? old.id : newId('i'), kind: 'item', lane, order, title: e.title,
      start: e.start || null, end: e.end || null, size: e.size || null, milestone: !!e.milestone,
      status: e.status, color: e.color, notes: e.notes || '', dependsOn: [], afterMissing: [], _after: e.after, _parent: e.parent
    };
    const owners = resolve(e.who || []);
    it.who = owners.ids;
    if (owners.missing.length) newPeople.push({ id: it.id, names: owners.missing });
    return it;
  });
  for (const it of items) {
    if (it.kind !== 'item') continue;
    const p = Number.isInteger(it._parent) && it._parent >= 0 ? items[it._parent] : null;
    it.parent = p && p.kind === 'item' ? p.id : null;
    delete it._parent;
  }
  const warnings = [...parsed.warnings];
  const real = items.filter(x => x.kind === 'item');
  for (const it of real) {
    for (const name of it._after) {
      const dep = real.find(x => x !== it && x.title === name) || real.find(x => x !== it && norm(x.title) === norm(name));
      if (dep) { if (!it.dependsOn.includes(dep.id)) it.dependsOn.push(dep.id); }
      else { it.afterMissing.push(name); warnings.push({ line: 0, message: `"${it.title}" is after "${name}", which isn't in this roadmap.` }); }
    }
    delete it._after;
  }
  return { doc: { meta, lanes, items }, warnings, newPeople };
}

/* Workshop: focus hours and lunch (docs/focus.md). Weekly focus hours and the lunch block live in Settings'
   `focus` collection (settings.focus v1); Docket's Day plan can replace them for a day (its `day` summary card).
   This module is pure where it can be, so Node tests drive it with a fake clock (shared/test/focus.test.mjs):

     resolveFocus({settings, day, dayplan, now})  what is focused now: {state, until, source, span, ...}
     day item changes                              startNow, endEarly, skipToday, undoSkip, pushLunch, ...
     createActivity()                              active minutes in this tab, shared with other tabs
     lunch rules                                   lunchOutcome, workingThrough, pushedMissed, missedOffer
     watchFocus(ws, onChange)                      reads Settings and Docket's summary, follows the clock
     createHolder(ws, {label, route})              an app's held toasts and its `held` summary card

   With focus hours off (no collection, or meta.enabled false) resolveFocus always says off, so nothing is held
   and every app behaves as without this module. */

import { cardDay, readCards } from './summary.js';

export const APP = 'settings';
export const COLLECTION = 'focus';
export const VERSION = 1;
export const SCHEMA = `${APP}.${COLLECTION}`;
export const CHANNEL = 'workshop-focus';

// Lunch detection thresholds (docs/focus.md, Lunch detection). Constants for version 1, not settings.
export const ACTIVE_BAR = 10;          // active minutes in lunch that show "Still working through lunch?"
export const ACTIVE_MISSED = 30;       // active minutes in lunch that make it missed
export const MISSED_PUSH = '14:30';    // a lunch pushed to this or later, and not taken, is missed
export const MISSED_UNTIL = '15:00';   // the missed lunch offer shows until then
export const PAUSE_MINUTES = 5;        // "Just a minute" hides the lunch cover this long
export const LATE_MINUTES = 60;        // Take lunch now
export const OVERRIDE_DAYS = 14;       // overrides are dropped from a day item after this
export const LOG_DAYS = 90;            // a day item (with its log) is tombstoned after this

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const BY_JS_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LUNCH_STATUS = ['taken', 'late', 'partial', 'missed', 'skipped'];

/* ---------- time helpers: local wall-clock HH:MM and minutes of the day ---------- */
const pad = n => String(n).padStart(2, '0');
export const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const toMin = s => isTime(s) ? +s.slice(0, 2) * 60 + +s.slice(3) : null;
export const fromMin = m => { m = Math.max(0, Math.min(1439, Math.round(m))); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const minuteOf = d => d.getHours() * 60 + d.getMinutes();
export const weekdayOf = d => BY_JS_DAY[d.getDay()];
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
/** "13:00" as the bar shows it: "1:00". */
export function fmtTime(s) { if (!isTime(s)) return ''; const h = +s.slice(0, 2); return `${h % 12 || 12}:${s.slice(3)}`; }
/** A Date for HH:MM on the day of `d` (in a DST gap the browser moves it to the first valid minute). */
export function atTime(d, hhmm) { const m = toMin(hhmm); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60, 0, 0); }
const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);

/* ---------- settings ---------- */
/** The defaults the Settings page fills on first open: Monday to Friday 09:00 to 12:00, lunch 12:00 for 60 minutes. */
export function defaults() {
  const week = Object.fromEntries(WEEKDAYS.map(d => [d, ['sat', 'sun'].includes(d) ? [] : [{ start: '09:00', end: '12:00' }]]));
  return { enabled: true, dayplanOverride: true, week, lunch: { enabled: true, start: '12:00', minutes: 60, days: ['mon', 'tue', 'wed', 'thu', 'fri'] } };
}

const cleanBlock = b => b && isTime(b.start) && isTime(b.end) && toMin(b.end) > toMin(b.start) ? { start: b.start, end: b.end } : null;
const cleanBlocks = a => Array.isArray(a) ? a.map(cleanBlock).filter(Boolean).sort((x, y) => toMin(x.start) - toMin(y.start)) : [];

/** meta as resolveFocus uses it, or null when there is none. Bad blocks are dropped, missing parts defaulted off. */
export function cleanSettings(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const week = {};
  for (const d of WEEKDAYS) week[d] = cleanBlocks(meta.week && meta.week[d]);
  const l = meta.lunch && typeof meta.lunch === 'object' ? meta.lunch : {};
  const minutes = Number.isInteger(l.minutes) && l.minutes >= 5 && l.minutes <= 240 ? l.minutes : 60;
  return {
    enabled: meta.enabled === true,
    dayplanOverride: meta.dayplanOverride !== false,
    week,
    lunch: { enabled: l.enabled === true && isTime(l.start), start: isTime(l.start) ? l.start : '12:00', minutes, days: Array.isArray(l.days) ? WEEKDAYS.filter(d => l.days.includes(d)) : [] }
  };
}

/**
 * Checks the Settings form. {errors: [{day, i, text}], warnings: [{day, i, text}]}. Errors stop Save: an end not
 * after its start, blocks in a day that overlap. Warnings do not: a focus block that overlaps lunch (lunch wins).
 */
export function validateSettings(meta) {
  const errors = [], warnings = [];
  const week = (meta && meta.week) || {};
  const l = (meta && meta.lunch) || {};
  const ls = toMin(l.start), le = ls == null ? null : ls + (+l.minutes || 0);
  if (l.enabled) {
    if (ls == null) errors.push({ day: 'lunch', i: -1, text: 'Lunch needs a start time.' });
    else if (!Number.isInteger(+l.minutes) || +l.minutes < 5 || +l.minutes > 240) errors.push({ day: 'lunch', i: -1, text: 'Lunch is 5 to 240 minutes.' });
    else if (le > 1440) errors.push({ day: 'lunch', i: -1, text: 'Lunch has to end before midnight.' });
  }
  for (const d of WEEKDAYS) {
    const blocks = Array.isArray(week[d]) ? week[d] : [];
    blocks.forEach((b, i) => {
      const s = toMin(b && b.start), e = toMin(b && b.end);
      if (s == null || e == null) { errors.push({ day: d, i, text: 'Give each block a start and an end.' }); return; }
      if (e <= s) { errors.push({ day: d, i, text: 'End after start (blocks never cross midnight).' }); return; }
      for (let j = 0; j < i; j++) {
        const o = blocks[j], os = toMin(o && o.start), oe = toMin(o && o.end);
        if (os != null && oe != null && s < oe && os < e) { errors.push({ day: d, i, text: 'Blocks on the same day overlap.' }); return; }
      }
      if (l.enabled && ls != null && (l.days || []).includes(d) && s < le && ls < e) warnings.push({ day: d, i, text: 'Overlaps lunch. Lunch wins.' });
    });
  }
  return { errors, warnings };
}

/* ---------- what is focused now ---------- */
const OFF = Object.freeze({ state: 'off', until: null, source: null, nextStart: null, nextBoundary: null, lunchStatus: null, span: null, spans: [], blocks: [], lunchBlocks: [], date: null, enabled: false });

/** Today's Day plan blocks from Docket's `day` summary card entry, or null when the day has no Day plan. */
export function dayplanOf(entry) {
  if (!entry || typeof entry !== 'object' || (!('focus' in entry) && !('lunch' in entry))) return null;
  const out = {};
  if (Array.isArray(entry.focus)) out.focus = cleanBlocks(entry.focus);
  const l = cleanBlock(entry.lunch);
  if (l) out.lunch = l;
  return out;
}

// Intervals as minutes [{s, e, source}], merged when they overlap; the merged one is manual if any part is.
function mergeIntervals(list) {
  const sorted = list.slice().sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.s < last.e) { last.e = Math.max(last.e, iv.e); if (iv.source === 'manual') last.source = 'manual'; }
    else out.push(Object.assign({}, iv));
  }
  return out;
}
// Focus never runs into lunch: the part before lunch stays; the part after it stays too for a scheduled
// block (it resumes after lunch), but a manual block simply ends when lunch starts.
function clipByLunch(focus, lunch) {
  let out = focus;
  for (const L of lunch) {
    const next = [];
    for (const f of out) {
      if (f.e <= L.s || f.s >= L.e) { next.push(f); continue; }
      if (f.s < L.s) next.push(Object.assign({}, f, { e: L.s }));
      if (f.e > L.e && f.source !== 'manual') next.push(Object.assign({}, f, { s: L.e }));
    }
    out = next;
  }
  return out;
}

/** The planned lunch for the day (before late lunches), as minutes {s, e, source}, or null. */
function plannedLunch(s, day, dp, wd) {
  let main = null;
  if (dp && dp.lunch) main = { s: toMin(dp.lunch.start), e: toMin(dp.lunch.end), source: 'dayplan' };
  else if (s.lunch.enabled && s.lunch.days.includes(wd)) { const st = toMin(s.lunch.start); main = { s: st, e: Math.min(1439, st + s.lunch.minutes), source: 'schedule' }; }
  if (!main) return null;
  const L = (day && day.lunch) || {};
  if (isTime(L.pushedTo)) { const len = main.e - main.s; main.s = toMin(L.pushedTo); main.e = Math.min(1439, main.s + len); }
  if (isTime(L.endedAt) && toMin(L.endedAt) >= main.s) main.e = Math.min(main.e, toMin(L.endedAt));
  return main.e > main.s ? main : null;
}

/**
 * What is focused now (docs/focus.md, What is focused now). settings: the collection's meta. day: today's day
 * item (another date's is ignored). dayplan: dayplanOf(Docket's day entry for today), or null. now: a Date.
 * Returns {state, until, source, nextStart, nextBoundary, lunchStatus, span, blocks, lunchBlocks, date, enabled}:
 *   state       off | focus | lunch | skipped
 *   until       HH:MM the current block ends (focus, lunch)
 *   source      schedule | dayplan | manual (focus), schedule | dayplan | late (lunch)
 *   nextStart   HH:MM the next block today starts, or null
 *   nextBoundary HH:MM of the next start or end today (when the state may change), or null
 *   span        {key, start, end, focus} for the held span now (touching focus and lunch blocks are one), or null
 *   spans       every held span today [{key, start, end, focus}]; focus: it has a focus block, not only lunch
 *   blocks      today's focus blocks [{start, end, source}] (after lunch clipping, without ended ones)
 *   lunchBlocks today's lunch blocks [{start, end, source}]
 */
export function resolveFocus({ settings, day = null, dayplan = null, now = new Date() } = {}) {
  const s = cleanSettings(settings);
  if (!s || !s.enabled) return OFF;
  const date = dateStr(now), wd = weekdayOf(now), nowMin = minuteOf(now);
  const d = day && day.id === date ? day : {};
  const dp = s.dayplanOverride ? dayplan : null;
  const L = d.lunch && typeof d.lunch === 'object' ? d.lunch : {};

  // Lunch: the planned one (unless skipped), and late lunches.
  const lunch = [];
  const main = L.skipped ? null : plannedLunch(s, d, dp, wd);
  if (main) lunch.push(main);
  for (const b of cleanBlocks(L.late)) lunch.push({ s: toMin(b.start), e: toMin(b.end), source: 'late' });
  lunch.sort((a, b) => a.s - b.s);

  // Focus: Day plan or weekly hours, plus Start focus now; merged, clipped by lunch, minus the ones ended early.
  const base = dp && Array.isArray(dp.focus) ? dp.focus.map(b => ({ s: toMin(b.start), e: toMin(b.end), source: 'dayplan' }))
    : s.week[wd].map(b => ({ s: toMin(b.start), e: toMin(b.end), source: 'schedule' }));
  const manual = cleanBlocks(d.manual).map(b => ({ s: toMin(b.start), e: toMin(b.end), source: 'manual' }));
  const ended = new Set(Array.isArray(d.endedEarly) ? d.endedEarly.filter(isTime).map(toMin) : []);
  const baseLeft = base.filter(b => !ended.has(b.s));
  let focus = clipByLunch(mergeIntervals(baseLeft.concat(manual)), lunch).filter(f => f.e > f.s && !ended.has(f.s));
  const skip = d.skip === true;

  const inside = list => list.find(iv => nowMin >= iv.s && nowMin < iv.e) || null;
  const lunchNow = inside(lunch);
  const focusNow = skip ? null : inside(focus);
  let state = 'off', cur = null;
  if (lunchNow) { state = 'lunch'; cur = lunchNow; }
  else if (skip) state = 'skipped';
  else if (focusNow) { state = 'focus'; cur = focusNow; }

  const active = lunch.concat(skip ? [] : focus);
  const starts = active.map(iv => iv.s).filter(m => m > nowMin).sort((a, b) => a - b);
  const bounds = active.flatMap(iv => [iv.s, iv.e]).filter(m => m > nowMin).sort((a, b) => a - b);

  // The held span: touching or overlapping held blocks are one, so focus straight into lunch releases once.
  const spans = [];
  for (const iv of active.slice().sort((a, b) => a.s - b.s)) {
    const last = spans[spans.length - 1];
    if (last && iv.s <= last.e) { last.e = Math.max(last.e, iv.e); if (iv.source !== 'late' && lunch.indexOf(iv) < 0) last.focus = true; }
    else spans.push({ s: iv.s, e: iv.e, focus: lunch.indexOf(iv) < 0 });
  }
  const spanOut = sp => ({ key: `${date}T${fromMin(sp.s)}`, start: fromMin(sp.s), end: fromMin(sp.e), focus: sp.focus });
  let span = null;
  if (cur) { const sp = spans.find(x => nowMin >= x.s && nowMin < x.e); if (sp) span = spanOut(sp); }
  const out = iv => ({ start: fromMin(iv.s), end: fromMin(iv.e), source: iv.source });
  return {
    state, until: cur ? fromMin(cur.e) : null, source: cur ? cur.source : null,
    nextStart: starts.length ? fromMin(starts[0]) : null, nextBoundary: bounds.length ? fromMin(bounds[0]) : null,
    lunchStatus: LUNCH_STATUS.includes(L.status) ? L.status : L.skipped ? 'skipped' : null,
    span, spans: spans.map(spanOut), blocks: focus.map(out), lunchBlocks: lunch.map(out), date, enabled: true,
    baseBlocks: base.map(out)
  };
}

export const isHeldNow = f => !!f && (f.state === 'focus' || f.state === 'lunch');
/** True only for a blocking pull request, and only during focus (never during lunch). item: {blocking} or
    {breakThrough}, or a Docket task with pr.tier "blocking" that is not waiting on its author. */
export function isBreakThrough(item, f) {
  if (!f || f.state !== 'focus' || !item) return false;
  if (item.blocking === true || item.breakThrough === true) return true;
  return !!(item.pr && item.pr.tier === 'blocking' && !item.pr.waiting && !item.done);
}

/* ---------- day items: what the bar's buttons change (pure; return a new item) ---------- */
/** A fresh or copied day item for `date`. */
export function dayItem(item, date) {
  const o = item && item.id === date ? clone(item) : { id: date };
  delete o.updatedAt;
  return o;
}
const lunchOf = o => (o.lunch = Object.assign({ pushedTo: null, skipped: false, late: [], endedAt: null, status: null }, o.lunch || {}));
const logOf = o => (o.log = Object.assign({ focus: [], lunch: null, released: 0 }, o.log || {}));
function logFocus(o, entry) {
  const log = logOf(o);
  log.focus = (log.focus || []).filter(x => x.start !== entry.start).concat([entry]).sort((a, b) => toMin(a.start) - toMin(b.start)).slice(-20);
}

/** Start focus now for `minutes`, or 'next' (until the next focus block ends). Never runs into lunch. */
export function startNow(item, f, now, minutes) {
  const date = dateStr(now), nowMin = minuteOf(now);
  const o = dayItem(item, date);
  let end;
  if (minutes === 'next') {
    const next = (f.blocks || []).find(b => toMin(b.end) > nowMin);
    end = next ? toMin(next.end) : nowMin + 50;
  } else end = nowMin + (+minutes || 25);
  const lunchNext = (f.lunchBlocks || []).map(b => toMin(b.start)).filter(m => m > nowMin).sort((a, b) => a - b)[0];
  if (lunchNext != null) end = Math.min(end, lunchNext);
  end = Math.min(1439, end);
  if (end <= nowMin) return o;
  o.manual = cleanBlocks((o.manual || []).concat([{ start: fromMin(nowMin), end: fromMin(end) }])).slice(-20);
  if (Array.isArray(o.endedEarly)) o.endedEarly = o.endedEarly.filter(t => t !== fromMin(nowMin));   // ended and restarted in the same minute
  o.skip = false;
  return o;
}
/** Where Start focus now would stop: HH:MM, and true when lunch stops it. */
export function startNowEnd(f, now, minutes) {
  const o = startNow({ id: dateStr(now) }, f, now, minutes);
  const b = (o.manual || [])[0];
  if (!b) return null;
  const lunch = (f.lunchBlocks || []).some(l => l.start === b.end);
  return { end: b.end, lunch };
}
/** End early: the current focus block ends now; the log keeps the minutes it ran. */
export function endEarly(item, f, now) {
  const o = dayItem(item, dateStr(now));
  if (!f || f.state !== 'focus') return o;
  const nowMin = minuteOf(now);
  const block = (f.blocks || []).find(b => toMin(b.start) <= nowMin && toMin(b.end) > nowMin);
  if (!block) return o;
  // The block as shown, and the scheduled or Day plan blocks inside it, so a later Start focus now does not bring them
  // back; a Start focus now block running now ends now.
  const bs = toMin(block.start), be = toMin(block.end);
  const starts = [block.start].concat((f.baseBlocks || []).filter(b => toMin(b.start) < be && toMin(b.end) > bs).map(b => b.start));
  o.endedEarly = [...new Set((o.endedEarly || []).concat(starts))].slice(-20);
  if (Array.isArray(o.manual)) o.manual = o.manual.map(b => toMin(b.start) <= nowMin && toMin(b.end) > nowMin ? { start: b.start, end: fromMin(nowMin) } : b).filter(b => toMin(b.end) > toMin(b.start));
  logFocus(o, { start: block.start, end: block.end, outcome: 'endedEarly', minutes: Math.max(0, nowMin - toMin(block.start)) });
  return o;
}
/** Skip today: focus off for the rest of the day (a running block ends now). Lunch is untouched. */
export function skipToday(item, f, now) {
  let o = f && f.state === 'focus' ? endEarly(item, f, now) : dayItem(item, dateStr(now));
  const nowMin = minuteOf(now);
  o.skip = true;
  for (const b of (f && f.blocks) || []) if (toMin(b.start) > nowMin) logFocus(o, { start: b.start, end: b.end, outcome: 'skipped', minutes: 0 });
  return o;
}
/** Undo skip: the rest of the day's blocks are back. */
export function undoSkip(item, now) {
  const o = dayItem(item, dateStr(now));
  const nowMin = minuteOf(now);
  o.skip = false;
  if (o.log && Array.isArray(o.log.focus)) o.log.focus = o.log.focus.filter(x => !(x.outcome === 'skipped' && toMin(x.start) > nowMin));
  return o;
}
/** A focus block ended on time: logged as kept. */
export function logKept(item, block, date) {
  const o = dayItem(item, date);
  const prev = o.log && (o.log.focus || []).find(x => x.start === block.start);
  if (prev && prev.outcome !== 'kept') return o;
  logFocus(o, { start: block.start, end: block.end, outcome: 'kept', minutes: Math.max(0, toMin(block.end) - toMin(block.start)) });
  return o;
}
/** Push lunch by `minutes`: from now during lunch, else from the planned start. */
export function pushLunch(item, f, now, minutes) {
  const o = dayItem(item, dateStr(now));
  const L = lunchOf(o);
  const nowMin = minuteOf(now);
  const planned = (f.lunchBlocks || []).find(b => b.source !== 'late');
  const from = f.state === 'lunch' && f.source !== 'late' ? nowMin : planned ? toMin(planned.start) : nowMin;
  L.pushedTo = fromMin(Math.min(1380, from + (+minutes || 15)));
  L.endedAt = null; L.skipped = false;
  if (L.status === 'missed' || L.status === 'skipped') L.status = null;
  return o;
}
/** End lunch now (back early). */
export function endLunch(item, f, now) {
  const o = dayItem(item, dateStr(now));
  if (!f || f.state !== 'lunch') return o;
  const L = lunchOf(o), at = fromMin(minuteOf(now));
  if (f.source === 'late') L.late = (L.late || []).map(b => b.end === f.until && toMin(b.start) <= minuteOf(now) ? { start: b.start, end: at } : b).filter(b => toMin(b.end) > toMin(b.start));
  else L.endedAt = at;
  return o;
}
/** Skip lunch today. */
export function skipLunch(item, now) {
  const o = dayItem(item, dateStr(now));
  const L = lunchOf(o);
  L.skipped = true; L.status = 'skipped';
  logOf(o).lunch = 'skipped';
  return o;
}
/** Take a late lunch now, for `minutes` (default 60). It replaces the planned lunch: one running now ends now, one
    still to come today is skipped (its status is then set by how the late lunch goes). */
export function takeLunch(item, now, minutes = LATE_MINUTES, f = null) {
  const o = dayItem(item, dateStr(now));
  const L = lunchOf(o), nowMin = minuteOf(now);
  const planned = f && (f.lunchBlocks || []).find(b => b.source !== 'late' && toMin(b.end) > nowMin);
  if (planned) { if (toMin(planned.start) <= nowMin) L.endedAt = fromMin(nowMin); else L.skipped = true; }
  const end = Math.min(1439, nowMin + (+minutes || LATE_MINUTES));
  if (end <= nowMin) return o;
  L.late = cleanBlocks((L.late || []).concat([{ start: fromMin(nowMin), end: fromMin(end) }])).slice(-6);
  L.notToday = false;
  return o;
}
/** Not today, on the missed lunch offer. */
export function notToday(item, now) { const o = dayItem(item, dateStr(now)); lunchOf(o).notToday = true; return o; }
/** Records how lunch went (status and log). */
export function setLunchStatus(item, date, status) {
  const o = dayItem(item, date);
  if (!LUNCH_STATUS.includes(status)) return o;
  lunchOf(o).status = status;
  logOf(o).lunch = status;
  return o;
}
/** Adds `n` released items to the day's log. */
export function addReleased(item, date, n) {
  const o = dayItem(item, date);
  const log = logOf(o);
  log.released = (Number.isInteger(log.released) ? log.released : 0) + Math.max(0, n | 0);
  return o;
}

/* ---------- the collection ---------- */
/** settings.focus with the day item replaced (stamped `now`), for ws.data.put. */
export function withDay(env, item, now = Date.now()) {
  const base = env && env.schema === SCHEMA ? env : { schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} };
  const items = (base.items || []).filter(i => i && i.id !== item.id).concat([Object.assign({}, item, { updatedAt: now })]);
  const deleted = Object.assign({}, base.deleted || {}); delete deleted[item.id];
  return Object.assign({}, base, { items, deleted });
}
/** The day item for `date` in the envelope, or null. */
export const dayOf = (env, date) => (env && Array.isArray(env.items) && env.items.find(i => i && i.id === date)) || null;

/**
 * Cleanup (docs/focus.md): overrides older than 14 days are dropped from their item, items older than 90 days are
 * tombstoned. Returns the new envelope, or null when nothing changed.
 */
export function cleanupEnvelope(env, today, now = Date.now()) {
  if (!env || env.schema !== SCHEMA || !Array.isArray(env.items)) return null;
  let changed = false;
  const deleted = Object.assign({}, env.deleted || {});
  const items = [];
  for (const it of env.items) {
    if (!it || typeof it.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(it.id)) { items.push(it); continue; }
    const age = daysBetween(it.id, today);
    if (age > LOG_DAYS) { deleted[it.id] = now; changed = true; continue; }
    if (age > OVERRIDE_DAYS && ['skip', 'manual', 'endedEarly', 'lunch'].some(k => k in it)) {
      const o = { id: it.id, updatedAt: now };
      if (it.log) o.log = it.log;
      items.push(o); changed = true; continue;
    }
    items.push(it);
  }
  return changed ? Object.assign({}, env, { items, deleted }) : null;
}

/** History rows for Settings, newest first: [{date, planned, kept, lunch, released}] for the last `days` days. */
export function historyRows(env, today, days = 28) {
  const rows = [];
  for (const it of (env && env.items) || []) {
    if (!it || !it.log || !/^\d{4}-\d{2}-\d{2}$/.test(it.id)) continue;
    const age = daysBetween(it.id, today);
    if (age < 0 || age >= days) continue;
    const f = Array.isArray(it.log.focus) ? it.log.focus : [];
    const planned = f.reduce((n, x) => n + Math.max(0, (toMin(x.end) || 0) - (toMin(x.start) || 0)), 0);
    const kept = f.reduce((n, x) => n + (x.outcome === 'skipped' ? 0 : Math.max(0, x.minutes | 0)), 0);
    rows.push({ date: it.id, planned, kept, lunch: LUNCH_STATUS.includes(it.log.lunch) ? it.log.lunch : '', released: Number.isInteger(it.log.released) ? it.log.released : 0 });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------- lunch detection (pure rules; the shell keeps the counts) ---------- */
/** How a lunch block went, from its active minutes. source 'late' for a late lunch. */
export function lunchOutcome(active, source) {
  if (active >= ACTIVE_MISSED) return 'missed';
  if (active < ACTIVE_BAR) return source === 'late' ? 'late' : 'taken';
  return 'partial';
}
/** Show "Still working through lunch?" now: during lunch, 10 or more active minutes, not shown yet this lunch. */
export const workingThrough = (f, active, shown) => !!f && f.state === 'lunch' && !shown && active >= ACTIVE_BAR;
/** A lunch pushed to 14:30 or later and not taken by then is missed. */
export function pushedMissed(f, day, now) {
  const L = (day && day.lunch) || {};
  if (!isTime(L.pushedTo) || toMin(L.pushedTo) < toMin(MISSED_PUSH) || minuteOf(now) < toMin(MISSED_PUSH)) return false;
  return !['taken', 'late', 'missed', 'skipped'].includes(L.status);
}
/** Show "Lunch missed. Take a late lunch?" now. */
export function missedOffer(f, day, now) {
  const L = (day && day.lunch) || {};
  return !!f && f.enabled && f.state !== 'lunch' && L.status === 'missed' && !L.notToday && minuteOf(now) < toMin(MISSED_UNTIL);
}

/**
 * Active minutes in this tab (docs/focus.md, Lunch detection): a visible tab with a key press, pointer down or
 * scroll in a minute. Shared with other tabs over the `workshop-focus` channel, so a minute counts once. In
 * memory only; never what was typed or clicked.
 */
export function createActivity({ now = () => Date.now(), channel = null, visible = () => true } = {}) {
  const minutes = new Set();
  const ch = channel === null && typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : channel || null;
  const prune = () => { const cut = Math.floor(now() / 60000) - 24 * 60; for (const m of minutes) if (m < cut) minutes.delete(m); };
  const api = {
    record() {
      if (!visible()) return false;
      const m = Math.floor(now() / 60000);
      if (minutes.has(m)) return false;
      minutes.add(m); prune();
      if (ch) try { ch.postMessage({ kind: 'active', m }); } catch (e) { /* closed */ }
      return true;
    },
    receive(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'active' && Number.isInteger(msg.m)) minutes.add(msg.m);
      else if (msg.kind === 'active-sync' && Array.isArray(msg.ms)) for (const m of msg.ms) if (Number.isInteger(m)) minutes.add(m);
      else if (msg.kind === 'active-hello' && ch && minutes.size) try { ch.postMessage({ kind: 'active-sync', ms: [...minutes] }); } catch (e) { /* closed */ }
    },
    /** Active minutes in [fromMs, toMs), leaving out minutes inside `pauses` ([[fromMs, toMs]]). */
    countIn(fromMs, toMs, pauses = []) {
      let n = 0;
      for (const m of minutes) {
        const t = m * 60000;
        if (t < fromMs || t >= toMs) continue;
        if (pauses.some(([a, b]) => t >= a && t < b)) continue;
        n++;
      }
      return n;
    },
    /** Listens on a window (the shell, and each same-origin app frame). */
    attach(win) {
      if (!win || win.__workshopActivity) return;
      try { win.__workshopActivity = true; } catch (e) { return; }
      const on = () => api.record();
      for (const ev of ['keydown', 'pointerdown']) win.addEventListener(ev, on, true);
      win.addEventListener('scroll', on, true);
    },
    get size() { return minutes.size; }
  };
  if (ch && channel === null) { ch.addEventListener('message', e => api.receive(e.data)); try { ch.postMessage({ kind: 'active-hello' }); } catch (e) { /* closed */ } }
  return api;
}

/* ---------- held cards and the release ---------- */
/** Held cards for a span across apps: [{app, name, count, label, route}] with count above 0. */
export function heldFor(byApp, key) {
  const out = [];
  for (const a of byApp) {
    const c = a.cards && a.cards.get('held');
    if (!c || c.kind !== 'held' || c.block !== key || !Number.isInteger(c.count) || c.count <= 0) continue;
    out.push({ app: a.app, name: a.name || a.app, count: c.count, label: typeof c.label === 'string' && c.label ? c.label.slice(0, 120) : `${c.count} from ${a.name || a.app}`, route: typeof c.route === 'string' ? c.route : '' });
  }
  return out;
}
/** The latest span today that ended by `now` and had focus in it (for Dispatch's digest), or null. */
export function lastEndedFocusSpan(f, now) {
  const m = minuteOf(now);
  const done = ((f && f.spans) || []).filter(sp => sp.focus && toMin(sp.end) <= m);
  return done.length ? done[done.length - 1] : null;
}

/** The release toast's words: "Focus done. 7 held: 3 new ADO items, 2 captures picked up." */
export function releaseText(parts, kind = 'focus') {
  const head = kind === 'lunch' ? 'Lunch done.' : 'Focus done.';
  const n = parts.reduce((x, p) => x + p.count, 0);
  if (!n) return `${head} Nothing was held.`;
  return `${head} ${n} held: ${parts.map(p => p.label).join(', ')}.`;
}

/* ---------- watching: settings, Docket's Day plan and the clock ---------- */
/**
 * Follows focus for an app or the shell. Reads settings.focus and Docket's `day` summary card, re-checks at the
 * next boundary, at midnight, on window focus and every 60 seconds, and calls onChange(f, w) only when the
 * result changes. Returns {current, settings, day, env, refresh(), stop()}.
 */
export function watchFocus(ws, onChange = () => {}, { now = () => new Date(), timers = globalThis, win = typeof window !== 'undefined' ? window : null } = {}) {
  let env = null, dpEntry = null, current = OFF, last = '', stopped = false, boundaryTimer = null, interval = null;
  const w = {
    get current() { return current; },
    get env() { return env; },
    get settings() { return env && env.schema === SCHEMA ? env.meta || null : null; },
    get day() { return dayOf(env, dateStr(now())); },
    get dayplan() { return dayplanOf(dpEntry); },
    refresh: () => Promise.all([readSettings(), readDayplan()]).then(compute),
    recompute: () => compute(),
    stop() { stopped = true; unsubs.forEach(u => { try { u(); } catch (e) { /* gone */ } }); if (boundaryTimer) timers.clearTimeout(boundaryTimer); if (interval) timers.clearInterval(interval); if (win) win.removeEventListener('focus', onWinFocus); }
  };
  async function readSettings() {
    try { const e = await ws.data.get(COLLECTION, { app: APP }); env = e && e.schema === SCHEMA && e.version === VERSION ? e : null; } catch (e) { /* keep what we had */ }
  }
  async function readDayplan() {
    try {
      const cards = readCards(await ws.data.get('summary', { app: 'prioritizer' }), 'prioritizer');
      dpEntry = cards ? cardDay(cards.get('day'), dateStr(now())) : null;
    } catch (e) { dpEntry = null; }
  }
  function compute() {
    if (stopped) return current;
    const d = now();
    current = resolveFocus({ settings: w.settings, day: dayOf(env, dateStr(d)), dayplan: dayplanOf(dpEntry), now: d });
    const key = JSON.stringify([current.state, current.until, current.source, current.span && current.span.key, current.nextStart, current.lunchStatus, current.blocks, current.lunchBlocks, current.date, env && env.rev]);
    schedule(d);
    if (key !== last) { last = key; try { onChange(current, w); } catch (e) { /* the caller's problem */ } }
    return current;
  }
  function schedule(d) {
    if (boundaryTimer) timers.clearTimeout(boundaryTimer);
    const next = current.nextBoundary ? atTime(d, current.nextBoundary) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 1);
    const ms = Math.max(1000, Math.min(next - d + 500, 6 * 3600e3));
    boundaryTimer = timers.setTimeout(() => { readDayplanIfNewDay(); compute(); }, ms);
  }
  let lastDate = dateStr(now());
  function readDayplanIfNewDay() { const t = dateStr(now()); if (t !== lastDate) { lastDate = t; readDayplan().then(compute); } }
  const onWinFocus = () => compute();
  const unsubs = [];
  try { unsubs.push(ws.data.subscribe(COLLECTION, () => readSettings().then(compute), { app: APP })); } catch (e) { /* no events */ }
  try { unsubs.push(ws.data.subscribe('summary', () => readDayplan().then(compute), { app: 'prioritizer' })); } catch (e) { /* no events */ }
  if (win) win.addEventListener('focus', onWinFocus);
  interval = timers.setInterval(() => { readDayplanIfNewDay(); compute(); }, 60000);
  w.ready = w.refresh();
  return w;
}

/**
 * An app's held interruptions (docs/focus.md, Holding a toast). label(n, kinds): what was held, "2 captures
 * picked up"; kinds counts them by the kind given to add() or toast() ({ado: 3, pickup: 2}), for an app that holds
 * more than one sort of thing. route: where they live in this app. onChange(): the held card changed (call your
 * summary writer's schedule).
 *   holder.toast(text, opts)  shows it now, or counts it during a span (blocking PRs break through focus);
 *                             opts.heldAs names its kind
 *   holder.add(n, kind)       counts n held items with no toast
 *   holder.card()             the `held` summary card to include, or null
 *   holder.resume(card)       picks the count up again from this app's own stored card after a reload
 */
export function createHolder(ws, { label = n => `${n} held`, route = '', onChange = () => {}, watch = null, now } = {}) {
  let key = null, count = 0, kinds = {};
  const w = watch || watchFocus(ws, f => sync(f), now ? { now } : {});
  function sync(f) {
    if (f && f.span && f.span.key !== key) { key = f.span.key; count = 0; kinds = {}; onChange(); }
  }
  const bump = (n, kind) => { count += n; if (kind) kinds[kind] = (kinds[kind] || 0) + n; };
  if (watch) sync(watch.current);
  const holder = {
    get focus() { return w.current; },
    get held() { return isHeldNow(w.current); },
    get count() { return count; },
    get kinds() { return Object.assign({}, kinds); },
    get key() { return key; },
    watch: w,
    sync,
    toast(text, opts = {}) {
      const f = w.current;
      if (isHeldNow(f) && !(opts.breakThrough && f.state === 'focus')) { sync(f); bump(1, opts.heldAs); onChange(); return Promise.resolve(null); }
      const o = Object.assign({}, opts, { hold: true }); delete o.heldAs;
      return ws.toast(text, o);
    },
    add(n = 1, kind = '') { const f = w.current; if (!isHeldNow(f) || n <= 0) return false; sync(f); bump(n, kind); onChange(); return true; },
    card() { return key ? { id: 'held', kind: 'held', block: key, count, label: String(label(count, Object.assign({}, kinds)) || `${count} held`).slice(0, 120), route } : null; },
    resume(card) { if (card && card.kind === 'held' && typeof card.block === 'string' && (!key || card.block === key) && Number.isInteger(card.count)) { key = card.block; count = Math.max(count, card.count); } }
  };
  return holder;
}

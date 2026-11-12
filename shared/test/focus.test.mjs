process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../focus.js';

const MON = '2026-11-09';
const at = (hhmm, date = MON) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, +hhmm.slice(0, 2), +hhmm.slice(3), 0); };
const S = (over = {}) => Object.assign(F.defaults(), over);
const R = (hhmm, { settings = S(), day = null, dayplan = null, date = MON } = {}) => F.resolveFocus({ settings, day, dayplan, now: at(hhmm, date) });

test('settings hours only: focus 09:00 to 12:00 on a weekday, off after', () => {
  const f = R('10:00');
  assert.equal(f.state, 'focus'); assert.equal(f.until, '12:00'); assert.equal(f.source, 'schedule');
  assert.equal(f.span.key, `${MON}T09:00`);
  assert.equal(R('08:59').state, 'off');
  assert.equal(R('08:59').nextStart, '09:00');
});

test('a weekday with no blocks, disabled, and no settings are all off', () => {
  assert.equal(R('10:00', { date: '2026-11-08' }).state, 'off');   // Sunday
  assert.equal(R('10:00', { settings: S({ enabled: false }) }).state, 'off');
  assert.equal(F.resolveFocus({ settings: null, now: at('10:00') }).state, 'off');
  assert.equal(F.resolveFocus({}).enabled, false);
});

test('Day plan focus replaces Settings hours; an empty array turns focus off; dayplanOverride false ignores it', () => {
  const dayplan = F.dayplanOf({ blocks: [], focus: [{ start: '14:00', end: '16:00' }] });
  assert.equal(R('10:00', { dayplan }).state, 'off');
  const f = R('14:30', { dayplan });
  assert.equal(f.state, 'focus'); assert.equal(f.source, 'dayplan');
  assert.equal(R('10:00', { dayplan: F.dayplanOf({ focus: [] }) }).state, 'off');
  assert.equal(R('10:00', { dayplan, settings: S({ dayplanOverride: false }) }).state, 'focus');
  assert.equal(F.dayplanOf({ blocks: [] }), null, 'no Day plan fields: no Day plan');
});

test('Day plan lunch replaces the Settings lunch; no Day plan lunch keeps Settings lunch', () => {
  const dayplan = F.dayplanOf({ focus: [{ start: '09:00', end: '11:00' }], lunch: { start: '11:30', end: '12:15' } });
  const f = R('11:45', { dayplan });
  assert.equal(f.state, 'lunch'); assert.equal(f.source, 'dayplan'); assert.equal(f.until, '12:15');
  assert.equal(R('12:30', { dayplan }).state, 'off');
  assert.equal(R('12:30', { dayplan: F.dayplanOf({ focus: [] }) }).state, 'lunch');
  assert.equal(R('11:45', { dayplan, settings: S({ dayplanOverride: false }) }).state, 'focus');
});

test('Start focus now: alone, overlapping a block (later end wins), stopping at lunch, expiring', () => {
  const settings = S();
  let f = R('13:30', { settings });
  let day = F.startNow(null, f, at('13:30'), 25);
  assert.deepEqual(day.manual, [{ start: '13:30', end: '13:55' }]);
  f = R('13:40', { settings, day });
  assert.equal(f.state, 'focus'); assert.equal(f.source, 'manual'); assert.equal(f.until, '13:55');
  assert.equal(R('13:56', { settings, day }).state, 'off', 'expired');
  // Overlapping 09:00 to 12:00 from 08:30 for 90 minutes: merged, ends at 12:00 (the later end).
  day = F.startNow(null, R('08:30'), at('08:30'), 90);
  f = R('08:45', { day });
  assert.equal(f.until, '12:00'); assert.equal(f.source, 'manual');
  // From 11:30 for 90 minutes stops at lunch.
  day = F.startNow(null, R('11:30', { settings: S({ week: Object.assign(F.defaults().week, { mon: [] }) }) }), at('11:30'), 90);
  assert.deepEqual(day.manual, [{ start: '11:30', end: '12:00' }]);
  assert.deepEqual(F.startNowEnd(R('11:30'), at('11:30'), 90), { end: '12:00', lunch: true });
  assert.equal(R('12:10', { day }).state, 'lunch');
  // Until the next block ends.
  day = F.startNow(null, R('08:00'), at('08:00'), 'next');
  assert.deepEqual(day.manual, [{ start: '08:00', end: '12:00' }]);
});

test('End early, Skip today (does not skip lunch), Undo skip', () => {
  let f = R('10:00');
  let day = F.endEarly(null, f, at('10:00'));
  assert.deepEqual(day.endedEarly, ['09:00']);
  assert.deepEqual(day.log.focus, [{ start: '09:00', end: '12:00', outcome: 'endedEarly', minutes: 60 }]);
  assert.equal(R('10:01', { day }).state, 'off');
  assert.equal(R('12:30', { day }).state, 'lunch');
  // Skip today before the block: skipped all day, lunch still applies, block logged as skipped.
  day = F.skipToday(null, R('08:00'), at('08:00'));
  assert.equal(R('10:00', { day }).state, 'skipped');
  assert.equal(R('12:15', { day }).state, 'lunch');
  assert.equal(day.log.focus[0].outcome, 'skipped');
  day = F.undoSkip(day, at('08:30'));
  assert.equal(R('10:00', { day }).state, 'focus');
  assert.equal(day.log.focus.length, 0);
});

test('Lunch wins over focus; Push, End and Skip lunch; late lunch', () => {
  const settings = S({ week: Object.assign(F.defaults().week, { mon: [{ start: '09:00', end: '13:30' }] }) });
  let f = R('12:10', { settings });
  assert.equal(f.state, 'lunch'); assert.equal(f.until, '13:00');
  assert.equal(R('11:00', { settings }).until, '12:00', 'focus ends when lunch starts');
  assert.equal(R('13:10', { settings }).state, 'focus', 'a scheduled block resumes after lunch');
  // Push 30 from the planned start (before lunch).
  let day = F.pushLunch(null, R('11:00', { settings }), at('11:00'), 30);
  assert.equal(day.lunch.pushedTo, '12:30');
  assert.equal(R('12:10', { settings, day }).state, 'focus');
  assert.equal(R('12:10', { settings, day }).until, '12:30');
  assert.equal(R('12:45', { settings, day }).until, '13:30');
  // Push during lunch: from now.
  day = F.pushLunch(null, R('12:10'), at('12:10'), 15);
  assert.equal(day.lunch.pushedTo, '12:25');
  // End lunch.
  day = F.endLunch(null, R('12:20'), at('12:20'));
  assert.equal(day.lunch.endedAt, '12:20');
  assert.equal(R('12:21', { day }).state, 'off');
  // Skip lunch.
  day = F.skipLunch(null, at('11:00'));
  assert.equal(R('12:10', { day }).state, 'off');
  assert.equal(R('12:10', { day }).lunchStatus, 'skipped');
  // Late lunch, and ending it early.
  day = F.takeLunch(null, at('14:10'));
  f = R('14:20', { day });
  assert.equal(f.state, 'lunch'); assert.equal(f.source, 'late'); assert.equal(f.until, '15:10');
  day = F.endLunch(day, f, at('14:40'));
  assert.deepEqual(day.lunch.late, [{ start: '14:10', end: '14:40' }]);
  assert.equal(R('14:41', { day }).state, 'off');
});

test('focus straight into lunch is one held span', () => {
  const f = R('11:00'), l = R('12:30');
  assert.equal(f.span.key, `${MON}T09:00`);
  assert.equal(l.span.key, `${MON}T09:00`);
  assert.equal(l.span.end, '13:00');
  assert.equal(R('13:00').span, null);
});

test('lunch detection with a fake clock and fake activity', () => {
  let t = at('12:00').getTime();
  const act = F.createActivity({ now: () => t, channel: false });
  for (let i = 0; i < 9; i++) { act.record(); t += 60000; }
  const from = at('12:00').getTime(), to = at('13:00').getTime();
  assert.equal(act.countIn(from, to), 9);
  assert.equal(F.lunchOutcome(9), 'taken');
  assert.equal(F.workingThrough(R('12:10'), 9, false), false);
  act.record();
  assert.equal(F.workingThrough(R('12:10'), act.countIn(from, to), false), true, '10 shows the bar');
  assert.equal(F.workingThrough(R('12:10'), 10, true), false, 'once per lunch');
  assert.equal(F.lunchOutcome(29), 'partial');
  assert.equal(F.lunchOutcome(30), 'missed');
  assert.equal(F.lunchOutcome(5, 'late'), 'late');
  // Minutes inside a Just a minute pause do not count.
  assert.equal(act.countIn(from, to, [[from, from + 5 * 60000]]), 5);
  // Missed offer until 15:00; Not today hides it; a taken late lunch clears missed.
  let day = F.setLunchStatus(null, MON, 'missed');
  assert.equal(F.missedOffer(R('14:59', { day }), day, at('14:59')), true);
  assert.equal(F.missedOffer(R('15:00', { day }), day, at('15:00')), false);
  assert.equal(F.missedOffer(R('14:00', { day: F.notToday(day, at('14:00')) }), F.notToday(day, at('14:00')), at('14:00')), false);
  day = F.setLunchStatus(F.takeLunch(day, at('14:00'), 30), MON, F.lunchOutcome(2, 'late'));
  assert.equal(day.lunch.status, 'late');
  assert.equal(F.missedOffer(R('14:40', { day }), day, at('14:40')), false);
  // Pushed past 14:30 and not taken: missed.
  day = F.pushLunch(null, R('11:00'), at('11:00'), 60);
  day = F.pushLunch(day, R('11:00', { day }), at('11:00'), 60);
  day = F.pushLunch(day, R('11:00', { day }), at('11:00'), 60);
  assert.equal(day.lunch.pushedTo, '15:00');
  assert.equal(F.pushedMissed(R('14:29', { day }), day, at('14:29')), false);
  assert.equal(F.pushedMissed(R('14:30', { day }), day, at('14:30')), true);
});

test('activity merge across two fake tabs counts a minute once', () => {
  const t = at('12:05').getTime();
  const listeners = [];
  const bus = { postMessage(m) { listeners.forEach(fn => fn(m)); } };
  const a = F.createActivity({ now: () => t, channel: { postMessage: m => bus.postMessage(m) } });
  const b = F.createActivity({ now: () => t, channel: { postMessage: () => {} } });
  listeners.push(m => b.receive(m));
  a.record(); b.record();
  assert.equal(b.countIn(at('12:00').getTime(), at('13:00').getTime()), 1);
  assert.equal(F.createActivity({ now: () => t, channel: false, visible: () => false }).record(), false, 'a hidden tab records nothing');
});

test('boundaries: exactly at start and end, midnight', () => {
  assert.equal(R('09:00').state, 'focus');
  assert.equal(R('12:00').state, 'lunch');
  assert.equal(R('13:00').state, 'off');
  assert.equal(R('11:59').until, '12:00');
  assert.equal(R('00:00').state, 'off');
  assert.equal(R('23:59').nextStart, null);
  const late = S({ week: Object.assign(F.defaults().week, { mon: [{ start: '22:00', end: '23:59' }] }) });
  assert.equal(R('23:58', { settings: late }).state, 'focus');
  assert.equal(R('00:30', { settings: late, date: '2026-11-10' }).state, 'off', 'never crosses midnight');
});

test('DST: a block starting in the gap starts at the first valid minute', () => {
  const sun = '2026-03-08';   // 02:00 to 03:00 does not exist in New York
  const settings = S({ week: Object.assign(F.defaults().week, { sun: [{ start: '02:30', end: '04:00' }] }) });
  const first = new Date(2026, 2, 8, 3, 0);   // the first valid minute
  assert.equal(first.getHours(), 3);
  assert.equal(F.resolveFocus({ settings, now: first }).state, 'focus');
  assert.equal(F.atTime(first, '02:30').getHours(), 3, 'a timer for 02:30 lands at 03:30 or later, never before');
  // Fall back: 01:30 happens twice; the block covers both.
  const fb = S({ week: Object.assign(F.defaults().week, { sun: [{ start: '01:00', end: '02:00' }] }) });
  assert.equal(F.resolveFocus({ settings: fb, now: new Date(2026, 10, 1, 1, 30) }).state, 'focus');
  assert.equal(sun.length, 10);
});

test('isBreakThrough: blocking PRs during focus only', () => {
  const pr = { pr: { tier: 'blocking', waiting: false } };
  assert.equal(F.isBreakThrough(pr, R('10:00')), true);
  assert.equal(F.isBreakThrough(pr, R('12:10')), false, 'never during lunch');
  assert.equal(F.isBreakThrough({ pr: { tier: 'asked' } }, R('10:00')), false);
  assert.equal(F.isBreakThrough({ pr: { tier: 'blocking', waiting: true } }, R('10:00')), false);
  assert.equal(F.isBreakThrough({ blocking: true }, R('10:00')), true);
  assert.equal(F.isHeldNow(R('10:00')), true);
  assert.equal(F.isHeldNow(R('14:00')), false);
});

test('history log outcomes and the 14 and 90 day cleanup', () => {
  let day = F.logKept(null, { start: '09:00', end: '12:00' }, MON);
  day = F.setLunchStatus(day, MON, 'taken');
  day = F.addReleased(day, MON, 4);
  day = F.addReleased(day, MON, 3);
  assert.deepEqual(day.log, { focus: [{ start: '09:00', end: '12:00', outcome: 'kept', minutes: 180 }], lunch: 'taken', released: 7 });
  const kept = F.logKept(F.endEarly(null, R('10:00'), at('10:00')), { start: '09:00', end: '12:00' }, MON);
  assert.equal(kept.log.focus[0].outcome, 'endedEarly', 'kept never overwrites ended early');
  let env = F.withDay(null, day, 1);
  env = F.withDay(env, { id: '2026-10-20', skip: true, log: { focus: [], lunch: 'missed', released: 0 } }, 1);
  env = F.withDay(env, { id: '2026-08-01', log: { focus: [], lunch: 'taken', released: 0 } }, 1);
  const rows = F.historyRows(env, MON);
  assert.deepEqual(rows.map(r => r.date), [MON, '2026-10-20']);
  assert.deepEqual(rows[0], { date: MON, planned: 180, kept: 180, lunch: 'taken', released: 7, late: false });
  const clean = F.cleanupEnvelope(env, MON, 99);
  assert.deepEqual(clean.items.find(i => i.id === '2026-10-20'), { id: '2026-10-20', updatedAt: 99, log: { focus: [], lunch: 'missed', released: 0 } });
  assert.equal(clean.items.some(i => i.id === '2026-08-01'), false);
  assert.equal(clean.deleted['2026-08-01'], 99);
  assert.equal(F.cleanupEnvelope(clean, MON, 100), null, 'nothing left to clean');
});

test('validateSettings: end after start, no overlaps, focus overlapping lunch warns', () => {
  const m = F.defaults();
  assert.deepEqual(F.validateSettings(m), { errors: [], warnings: [] });
  m.week.mon = [{ start: '10:00', end: '09:00' }];
  assert.equal(F.validateSettings(m).errors.length, 1);
  m.week.mon = [{ start: '09:00', end: '11:00' }, { start: '10:30', end: '11:30' }];
  assert.equal(F.validateSettings(m).errors[0].text, 'Blocks on the same day overlap.');
  m.week.mon = [{ start: '11:00', end: '12:30' }];
  const v = F.validateSettings(m);
  assert.equal(v.errors.length, 0); assert.equal(v.warnings[0].text, 'Overlaps lunch. Lunch wins.');
});

test('holder: counts during a span, shows otherwise, breaks through focus for blocking PRs, card per span', async () => {
  const shown = [];
  const ws = { toast: (t, o) => { shown.push([t, o]); return Promise.resolve(null); } };
  let cur = R('10:00');
  const watch = { get current() { return cur; } };
  let changes = 0;
  const h = F.createHolder(ws, { label: n => `${n} captures picked up`, route: 'inbox', watch, onChange: () => changes++ });
  await h.toast('Added a note');
  assert.equal(shown.length, 0); assert.equal(h.count, 1);
  await h.toast('PR 7 blocked on you', { breakThrough: true });
  assert.equal(shown.length, 1); assert.equal(shown[0][1].hold, true);
  assert.deepEqual(h.card(), { id: 'held', kind: 'held', block: `${MON}T09:00`, count: 1, label: '1 captures picked up', route: 'inbox' });
  cur = R('12:10'); h.sync(cur);
  await h.toast('PR 8 blocked on you', { breakThrough: true });
  assert.equal(shown.length, 1, 'nothing breaks through lunch');
  assert.equal(h.count, 2, 'same span through lunch');
  cur = R('14:00'); h.sync(cur);
  await h.toast('Added another');
  assert.equal(shown.length, 2);
  assert.equal(h.card().count, 2, 'the card stays after the span for the release');
  assert.ok(changes >= 3);
});

test('holder kinds: one card says each sort of thing held', async () => {
  const ws = { toast: () => Promise.resolve(null) };
  const cur = R('10:00');
  const h = F.createHolder(ws, { watch: { get current() { return cur; } }, label: (n, k) => [k.ado && `${k.ado} new ADO items`, k.pickup && `${k.pickup} captures picked up`].filter(Boolean).join(', ') });
  h.add(3, 'ado');
  await h.toast('Added a task from Folio', { heldAs: 'pickup' });
  assert.equal(h.card().count, 4);
  assert.equal(h.card().label, '3 new ADO items, 1 captures picked up');
});

test('heldFor and releaseText', () => {
  const key = `${MON}T09:00`;
  const card = (count, label, block = key) => new Map([['held', { id: 'held', kind: 'held', block, count, label }]]);
  const parts = F.heldFor([
    { app: 'prioritizer', name: 'Docket', cards: card(3, '3 new ADO items') },
    { app: 'notes', name: 'Folio', cards: card(2, '2 captures picked up') },
    { app: 'agents', name: 'Dispatch', cards: card(5, 'old', `${MON}T14:00`) },
    { app: 'slate', name: 'Slate', cards: card(0, 'none') },
    { app: 'runway', name: 'Runway', cards: null }
  ], key);
  assert.deepEqual(parts.map(p => p.app), ['prioritizer', 'notes']);
  assert.equal(F.releaseText(parts), 'Focus done. 5 held: 3 new ADO items, 2 captures picked up.');
  assert.equal(F.releaseText([], 'lunch'), 'Lunch done. Nothing was held.');
  assert.equal(F.fmtTime('13:00'), '1:00');
  assert.equal(F.fmtTime('00:30'), '12:30');
});

test('watchFocus: reads settings and the Day plan, calls onChange only on change', async () => {
  let t = at('08:59');
  const timers = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} };
  const env = { schema: 'settings.focus', version: 1, rev: 1, items: [], deleted: {}, meta: F.defaults() };
  const subs = {};
  const ws = {
    data: {
      get: async (c, o) => c === 'focus' && o.app === 'settings' ? env : null,
      subscribe: (c, fn, o) => { subs[o.app + '.' + c] = fn; return () => {}; }
    }
  };
  const seen = [];
  const w = F.watchFocus(ws, f => seen.push(f.state), { now: () => t, timers, win: null });
  await w.ready;
  assert.deepEqual(seen, ['off']);
  w.recompute();
  assert.deepEqual(seen, ['off'], 'no change, no call');
  t = at('09:00'); w.recompute();
  assert.deepEqual(seen, ['off', 'focus']);
  assert.equal(w.current.until, '12:00');
  w.stop();
});

/* ---------- Day's done (docs/focus.md, Day's done) ---------- */
const TUE = '2026-11-10';
const B = (start = '09:00', end = '17:00') => ({ start, end });
const RD = (hhmm, { settings = S(), day = null, prevDay = null, dayplan = null, bounds = B(), date = MON } = {}) =>
  F.resolveFocus({ settings, day, prevDay, dayplan, bounds, now: at(hhmm, date) });

test("Day's done: boundaries of the evening, keyed by the next morning", () => {
  assert.equal(RD('16:59').state, 'off');
  const f = RD('17:00');
  assert.equal(f.state, 'dayDone'); assert.equal(f.source, 'end'); assert.equal(f.until, null);
  assert.equal(f.span.key, `${TUE}T00:00`, "the morning's date at 00:00");
  assert.equal(f.span.end, null, 'the evening goes on into the morning');
  assert.equal(f.span.night, true);
  assert.equal(RD('23:59').state, 'dayDone');
  assert.equal(RD('16:59').nextBoundary, '17:00', 'the watcher wakes at the end');
  assert.equal(f.dayEnd, '17:00'); assert.equal(f.dayStart, '09:00');
  assert.equal(F.isHeldNow(f), true); assert.equal(F.holdsAll(f), true);
  assert.equal(F.isBreakThrough({ blocking: true }, f), false, 'nothing breaks through');
});

test("Day's done: midnight and the morning hold until the day starts", () => {
  const m = RD('00:00', { date: TUE });
  assert.equal(m.state, 'dayDone'); assert.equal(m.source, 'morning');
  assert.equal(m.span.key, `${TUE}T00:00`, 'the same span as last evening');
  assert.equal(m.until, '09:00');
  assert.equal(RD('08:59', { date: TUE }).state, 'dayDone');
  assert.equal(RD('09:00', { date: TUE }).state, 'focus', 'released at the start, straight into focus');
  // The first focus block comes first: the morning ends there.
  const early = { focus: [{ start: '08:00', end: '10:00' }] };
  assert.equal(RD('07:59', { date: TUE, dayplan: early }).until, '08:00');
  assert.equal(RD('08:00', { date: TUE, dayplan: early }).state, 'focus');
  // A start before the first focus block: off between them.
  const s = S(); s.week.tue = [{ start: '10:00', end: '12:00' }];
  assert.equal(RD('08:30', { date: TUE, settings: s, bounds: B('08:30') }).state, 'off');
  // Spans list the night for Peek and the digest; the digest only reads focus spans.
  assert.ok(RD('12:30', { date: TUE }).spans.some(sp => sp.night && sp.key === `${TUE}T00:00`));
  assert.equal(F.lastEndedFocusSpan(RD('17:30'), at('17:30')).key, `${MON}T09:00`);
});

test("Day's done: wins over focus and lunch inside it", () => {
  const s = S(); s.week.mon = [{ start: '16:00', end: '18:00' }];
  const f = RD('16:30', { settings: s });
  assert.equal(f.state, 'focus'); assert.equal(f.until, '17:00', 'the focus block ends at the day end');
  assert.equal(RD('17:30', { settings: s }).state, 'dayDone');
  const lunch = Object.assign(S(), { lunch: { enabled: true, start: '08:00', minutes: 60, days: ['tue'] } });
  assert.equal(RD('08:30', { date: TUE, settings: lunch }).state, 'dayDone', 'a lunch before the day starts is dropped');
});

test("Day's done: no day.end means no dayDone; afterEnd off means none either", () => {
  assert.equal(RD('20:00', { bounds: { start: '09:00', end: null } }).state, 'off');
  assert.equal(RD('20:00', { bounds: null }).state, 'off');
  assert.equal(RD('07:00', { bounds: { start: null, end: '17:00' }, date: TUE }).state, 'off', 'no start: no morning hold');
  const off = S({ afterEnd: false });
  assert.equal(RD('20:00', { settings: off }).state, 'off');
  assert.equal(RD('07:00', { settings: off, date: TUE }).state, 'off');
  assert.equal(F.cleanSettings({ enabled: true }).afterEnd, true, 'missing means on');
  assert.equal(RD('20:00', { settings: S({ enabled: false }) }).state, 'off');
  assert.equal(F.dayBoundsOf({ start: 'nine', end: '17:00' }).start, null);
});

test("Day's done: Keep working tonight lifts it until midnight and skips the next morning", () => {
  assert.equal(RD('17:40').state, 'dayDone');
  const day = F.keepWorking(null, at('17:40'));
  assert.equal(day.late, '17:40'); assert.equal(day.log.workedLate, true);
  const after = RD('17:40', { day });
  assert.equal(after.state, 'off'); assert.equal(after.late, true);
  assert.equal(RD('23:00', { day }).state, 'off');
  const morning = RD('07:00', { date: TUE, prevDay: Object.assign({ id: MON }, day) });
  assert.equal(morning.state, 'off', 'no morning hold after working late');
  assert.equal(RD('07:00', { date: TUE, prevDay: Object.assign({}, day, { id: '2026-11-01' }) }).state, 'dayDone', "another day's item is ignored");
  // The span the evening ran under was released at 17:40; the history shows it.
  let env = F.withDay(null, Object.assign({}, day, { id: MON }), 1);
  assert.equal(F.historyRows(env, MON)[0].late, true);
});

test("Day's done: Start my day now ends the morning hold", () => {
  const day = F.startDay(null, at('07:15', TUE));
  assert.equal(day.early, '07:15');
  assert.equal(RD('07:15', { date: TUE, day }).state, 'off');
  assert.equal(RD('07:14', { date: TUE, day }).state, 'dayDone');
  const clean = F.cleanupEnvelope(F.withDay(null, Object.assign({ id: '2026-10-20', log: { workedLate: true } }, { late: '18:00' }), 1), MON, 9);
  assert.deepEqual(clean.items[0], { id: '2026-10-20', updatedAt: 9, log: { workedLate: true } }, 'late and early are overrides, dropped after 14 days');
});

test("release words for Day's done; nothing held means no toast", () => {
  const parts = [{ count: 2, label: '2 captures picked up' }];
  assert.equal(F.releaseText(parts, 'morning'), 'Good morning. 2 held: 2 captures picked up.');
  assert.equal(F.releaseText(parts, 'late'), 'Working late. 2 held: 2 captures picked up.');
  assert.equal(F.releaseText([], 'morning'), null);
  assert.equal(F.releaseText([], 'focus'), 'Focus done. Nothing was held.');
});

/* ---------- heads-up (docs/focus.md, Heads-up) ---------- */
test('heads-up: 5 minutes before focus ends, lunch starts and the day ends', () => {
  const s = S(); s.week.mon = [{ start: '09:00', end: '11:00' }, { start: '14:00', end: '16:00' }];
  const h = (hhmm, o = {}) => F.headsUp(RD(hhmm, Object.assign({ settings: s }, o)), at(hhmm));
  assert.equal(h('10:54'), null);
  assert.deepEqual(h('10:55'), { kind: 'focus', at: '11:00', key: `focus:${MON}T11:00`, minutes: 5, text: 'Focus ends in 5 min' });
  assert.equal(h('10:59').text, 'Focus ends in 1 min');
  assert.equal(h('11:00'), null, 'gone at the transition');
  assert.equal(h('11:55').text, 'Lunch in 5 min');
  assert.equal(h('16:55').text, 'Day ends in 5 min');
  assert.equal(h('16:55').key, `end:${MON}T17:00`);
  assert.equal(h('17:00'), null, "no heads-up during Day's done");
});

test('heads-up: focus straight into lunch says lunch; off with focus hours off, after Keep working, without afterEnd', () => {
  assert.equal(F.headsUp(RD('11:56'), at('11:56')).text, 'Lunch in 4 min', 'focus 9 to 12 then lunch at 12');
  const s = S(); s.week.mon = [{ start: '15:00', end: '17:00' }];
  assert.equal(F.headsUp(RD('16:57', { settings: s }), at('16:57')).kind, 'end', 'focus into the day end says the day end');
  assert.equal(F.headsUp(RD('16:57', { settings: S({ enabled: false }) }), at('16:57')), null);
  assert.equal(F.headsUp(RD('16:57', { settings: S({ afterEnd: false }) }), at('16:57')), null);
  assert.equal(F.headsUp(RD('16:57', { day: { id: MON, late: '16:50' } }), at('16:57')), null);
  const late = { id: MON, lunch: { late: [{ start: '15:00', end: '16:00' }] } };
  assert.equal(F.headsUp(RD('14:57', { day: late }), at('14:57')), null, 'a late lunch starts when you take it');
});

test('heads-up: once per event across two tabs, and after a reload', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  const tabs = [];
  const bus = { postMessage: m => tabs.forEach(t => t !== sender && t.receive(m)) };
  let sender = null, changed = 0;
  const a = F.createSeen({ storage, channel: bus });
  const b = F.createSeen({ storage: { getItem: () => null, setItem() {} }, channel: bus, onChange: () => changed++ });
  tabs.push(a, b);
  const key = `focus:${MON}T11:00`;
  assert.equal(a.has(key), false); assert.equal(b.has(key), false);
  sender = a; a.dismiss(key);
  assert.equal(b.has(key), true, 'the other tab hears it'); assert.equal(changed, 1);
  a.dismiss(key); assert.equal(changed, 1, 'once');
  const reloaded = F.createSeen({ storage });
  assert.equal(reloaded.has(key), true, 'a reload remembers it');
  assert.equal(reloaded.has(`lunch:${MON}T12:00`), false, 'another event is new');
});

test('watchFocus: passes the day bounds and yesterday from the stores', async () => {
  let t = at('16:59');
  const timers = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} };
  const env = { schema: 'settings.focus', version: 1, rev: 1, items: [], deleted: {}, meta: F.defaults() };
  const summary = { schema: 'prioritizer.summary', version: 1, rev: 1, deleted: {}, items: [{ id: 'day', kind: 'day', updatedAt: 1, days: { [MON]: { blocks: [], wrapAt: '16:00', wrapped: false, offered: 0, start: '09:00', end: '17:00' } } }] };
  const ws = { data: { get: async (c, o) => c === 'focus' ? env : c === 'summary' && o.app === 'prioritizer' ? summary : null, subscribe: () => () => {} } };
  const w = F.watchFocus(ws, () => {}, { now: () => t, timers, win: null });
  await w.ready;
  assert.equal(w.current.state, 'off'); assert.equal(w.current.dayEnd, '17:00');
  assert.equal(w.entry.wrapped, false);
  t = at('17:00'); w.recompute();
  assert.equal(w.current.state, 'dayDone');
  w.stop();
});

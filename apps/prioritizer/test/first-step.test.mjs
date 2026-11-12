// One breadcrumb system (focus-model.js: the old left-off note copied in, when focus hours ask, one prompt per
// event) and a task's first step and Split (first-step-model.js). Runs in Node; the browser side is in
// test/e2e.py and test/focus-e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/focus-model.js';
import { FIRST_STEP_LEN, cleanFirstStep, clearFirstStep, setFirstStep, splitTask } from '../js/first-step-model.js';

const clone = v => JSON.parse(JSON.stringify(v));

test('left-off copy: the note becomes a breadcrumb at its own time, and leftOff is left as it was', () => {
  const lo = {text: '  tokens done,   next the grammar ', at: '2026-11-09T17:00:00.000Z'};
  const t = {id: 'a', title: 'Parser', leftOff: clone(lo)};
  assert.equal(F.copyLeftOff(t, '2026-11-12T12:00:00.000Z'), true);
  assert.deepEqual(t.crumbs, [{at: '2026-11-09T17:00:00.000Z', text: 'tokens done, next the grammar'}]);
  assert.deepEqual(t.leftOff, lo, 'leftOff is never changed');
  assert.equal(F.lastCrumb(t).text, 'tokens done, next the grammar');
});

test('left-off copy runs once: loading again adds nothing', () => {
  const t = {id: 'a', leftOff: {text: 'halfway', at: '2026-11-09T17:00:00.000Z'}};
  F.copyLeftOff(t);
  const after = clone(t);
  for (let i = 0; i < 3; i++) assert.equal(F.copyLeftOff(t), false);
  assert.deepEqual(t, after);
});

test('left-off copy on a task with both: no second copy of a note already saved as a breadcrumb', () => {
  // Saving the note always left a breadcrumb too, a moment later.
  const t = {id: 'a', leftOff: {text: 'halfway through', at: '2026-11-09T17:00:00.000Z'},
    crumbs: [{at: '2026-11-09T16:00:00.000Z', text: 'older one'}, {at: '2026-11-09T17:00:00.020Z', text: 'halfway through'}]};
  assert.equal(F.copyLeftOff(t), false);
  assert.equal(t.crumbs.length, 2);
  // A note with its own text joins the breadcrumbs by its time; the newest stays the last one.
  const u = {id: 'b', leftOff: {text: 'the note', at: '2026-11-10T09:00:00.000Z'}, crumbs: [{at: '2026-11-09T16:00:00.000Z', text: 'older one'}]};
  assert.equal(F.copyLeftOff(u), true);
  assert.deepEqual(u.crumbs.map(c => c.text), ['older one', 'the note']);
  assert.equal(F.lastCrumb(u).at, '2026-11-10T09:00:00.000Z', 'keeps at');
});

test('left-off copy: nothing to copy, a blank note, a note without a time', () => {
  const none = {id: 'a', crumbs: [{at: '2026-11-09T16:00:00.000Z', text: 'x'}]};
  assert.equal(F.copyLeftOff(none), false);
  assert.equal(F.copyLeftOff({id: 'b', leftOff: {text: '   ', at: '2026-11-09T16:00:00.000Z'}}), false);
  assert.equal(F.copyLeftOff({id: 'c', leftOff: 'junk'}), false);
  const noAt = {id: 'd', leftOff: {text: 'x', at: ''}};
  assert.equal(F.copyLeftOff(noAt, '2026-11-12T12:00:00.000Z'), true);
  assert.equal(noAt.crumbs[0].at, '2026-11-12T12:00:00.000Z');
});

test('focus hours ask on lunch, block end and focus now: one reason per change', () => {
  const st = (state, extra = {}) => Object.assign({enabled: true, state, source: 'settings'}, extra);
  assert.equal(F.crumbTrigger(st('focus'), st('lunch')), 'Lunch', 'focus running into lunch is one ask, not two');
  assert.equal(F.crumbTrigger(st('focus'), st('free')), 'Focus ended');
  assert.equal(F.crumbTrigger(st('free'), st('focus', {source: 'manual'})), 'Focus started');
  assert.equal(F.crumbTrigger(st('free'), st('focus')), null, 'a scheduled block starting does not ask');
  assert.equal(F.crumbTrigger(st('lunch'), st('lunch')), null);
  assert.equal(F.crumbTrigger(st('focus', {enabled: false}), st('lunch')), null, 'focus hours off: never');
  assert.equal(F.crumbTrigger(null, st('lunch')), null);
});

test('one prompt per event: the gate skips a second ask for the same moment', () => {
  const g = F.createAskGate();
  const t0 = Date.UTC(2026, 10, 9, 17);
  assert.equal(g.ask('a', t0), true, 'focus ends: ask');
  assert.equal(g.ask('a', t0 + 1000), false, 'lunch starts a second later: no second prompt');
  assert.equal(g.ask('a', t0 + F.ASK_QUIET_MS + 1), true, 'a later moment asks again');
  assert.equal(g.ask('b', t0 + F.ASK_QUIET_MS + 2), true, 'another task is its own event');
  assert.equal(g.ask('c', t0 + F.ASK_QUIET_MS + 3, true), false, 'never over an open prompt');
  // Pause asked already: a block end right after it does not ask again.
  const p = F.createAskGate();
  p.note('a', t0);
  assert.equal(p.ask('a', t0 + 30000), false);
  assert.equal(p.ask(null, t0), false);
});

test('first step: one clean line, capped, blank removes it', () => {
  assert.equal(FIRST_STEP_LEN, 120);
  assert.equal(cleanFirstStep('  open   the <b>file</b>\n'), 'open the <b>file</b>');
  assert.equal(cleanFirstStep('x'.repeat(200)).length, 120);
  assert.equal(cleanFirstStep(7), '');
  const t = {id: 'a'};
  assert.equal(setFirstStep(t, '  Open the doc '), true);
  assert.equal(t.firstStep, 'Open the doc');
  assert.equal(setFirstStep(t, 'Open the doc'), false, 'same text: no change');
  assert.equal(setFirstStep(t, '   '), true);
  assert.equal('firstStep' in t, false);
});

test('first step: done clears it, starting does not', () => {
  const t = {id: 'a', firstStep: 'Open the doc'};
  // Starting is focus-model's startTask; it never touches the task's fields.
  const log = F.freshLog();
  F.startTask(log, '2026-11-09', 'a', '2026-11-09T14:00:00.000Z', () => true);
  assert.equal(t.firstStep, 'Open the doc');
  assert.equal(clearFirstStep(t), true);
  assert.equal('firstStep' in t, false);
  assert.equal(clearFirstStep(t), false);
});

test('Split copies list, people, due date and the rest, right below the task; the first stays on Today', () => {
  const t = {id: 'a', title: 'Write the parser', rank: 2, listId: 'L2', who: ['p1', 'g:team'], due: '2026-11-20', value: 3, effort: 'M',
    color: 'sky', urgentFlag: true, product: 'pr_1', firstStep: 'Open the grammar', crumbs: [{at: '2026-11-09T14:00:00.000Z', text: 'x'}],
    focusOn: null, done: false, notes: 'notes stay'};
  const tasks = [{id: 'z', rank: 1}, t, {id: 'y', rank: 3}];
  const n = splitTask(tasks, t, '  Error   messages ', {id: 'b', today: '2026-11-09'});
  assert.equal(n.title, 'Error messages');
  for (const k of ['listId', 'due', 'value', 'effort', 'color', 'urgentFlag', 'product']) assert.deepEqual(n[k], t[k], k);
  assert.deepEqual(n.who, ['p1', 'g:team']);
  assert.notEqual(n.who, t.who, 'its own people array');
  assert.equal(n.rank, 3);
  assert.equal(tasks.find(x => x.id === 'y').rank, 4, 'tasks below move down one');
  assert.deepEqual([n.done, n.waiting, n.focusOn, n.notes, n.createdAt], [false, false, null, '', '2026-11-09']);
  assert.equal('firstStep' in n || 'crumbs' in n, false, 'the rest starts fresh');
  assert.equal(t.focusOn, '2026-11-09', 'the first part goes on Today');
  assert.equal(tasks.length, 4);
  assert.equal(splitTask(tasks, t, '  ', {id: 'c', today: '2026-11-09'}), null);
  assert.equal(splitTask(tasks, Object.assign({}, t, {done: true}), 'x', {id: 'c', today: '2026-11-09'}), null);
  assert.equal(tasks.length, 4);
});

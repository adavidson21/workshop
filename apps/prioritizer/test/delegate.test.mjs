// Delegating (js/delegate-model.js): follow-up dates in working days, delegate, Nudged, Got it back, the one-time
// fill for waiting tasks without a date, hand-off text and the Assign picker's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/delegate-model.js';

const task = (extra = {}) => ({id: 't1', title: 'Fix the login bug', notes: '', who: [], waiting: false, nudgeOn: null, done: false, ...extra});

test('cleanFollow: 2 working days by default, a sane range, filled is a date', () => {
  assert.deepEqual(M.cleanFollow(), {days: 2, filled: null});
  assert.deepEqual(M.cleanFollow({days: '5', filled: '2026-11-06'}), {days: 5, filled: '2026-11-06'});
  assert.deepEqual(M.cleanFollow({days: 0, filled: 'soon'}), {days: 2, filled: null});
  assert.deepEqual(M.cleanFollow({days: 99}), {days: 2, filled: null});
});

test('addWorkdays: Monday to Friday without a sprint, skipping the weekend', () => {
  assert.equal(M.addWorkdays('2026-11-06', 2), '2026-11-10', 'Friday plus 2 is Tuesday');
  assert.equal(M.addWorkdays('2026-11-04', 2), '2026-11-06', 'Wednesday plus 2 is Friday');
  assert.equal(M.addWorkdays('2026-11-07', 1), '2026-11-09', 'from a Saturday, the next Monday');
});

test("addWorkdays: the Day view's workdays and holidays", () => {
  const sp = {workdays: [1, 2, 3, 4], holidays: ['2026-11-10']};
  assert.equal(M.addWorkdays('2026-11-06', 2, sp), '2026-11-11', 'Friday off, Monday, holiday Tuesday, Wednesday');
});

test('delegate: waiting with a follow-up date; an existing date stays; came back clears', () => {
  const t = task({who: ['p_one'], cameBack: '2026-11-01'});
  M.delegate(t, '2026-11-10');
  assert.equal(t.waiting, true);
  assert.equal(t.nudgeOn, '2026-11-10');
  assert.equal('cameBack' in t, false);
  M.delegate(t, '2026-11-20');
  assert.equal(t.nudgeOn, '2026-11-10', 'already waiting with a date: kept');
});

test('nudged: moves the date and leaves a breadcrumb naming them', () => {
  const t = task({who: ['p_one'], waiting: true, nudgeOn: '2026-11-04'});
  M.nudged(t, '2026-11-10', '2026-11-06T15:00:00.000Z', '@sam');
  assert.equal(t.nudgeOn, '2026-11-10');
  assert.deepEqual(t.crumbs, [{at: '2026-11-06T15:00:00.000Z', text: 'Nudged @sam'}]);
});

test('gotBack: stops waiting, keeps the people, marks it came back', () => {
  const t = task({who: ['p_one'], waiting: true, nudgeOn: '2026-11-04'});
  M.gotBack(t, '2026-11-06');
  assert.deepEqual([t.waiting, t.nudgeOn, t.cameBack, t.who], [false, null, '2026-11-06', ['p_one']]);
  assert.equal(M.cameBackOpen(t), true);
  t.done = true;
  assert.equal(M.cameBackOpen(t), false, 'done tasks are not shown as came back');
});

test('snapshot and restore undo a change', () => {
  const t = task({who: ['p_one']});
  const before = M.snapshot(t);
  M.delegate(t, '2026-11-10');
  M.restore(t, before);
  assert.deepEqual([t.waiting, t.nudgeOn, 'cameBack' in t], [false, null, false]);
});

test('fillFollowUps: only open waiting tasks without a date', () => {
  const ts = [task({id: 'a', waiting: true}), task({id: 'b', waiting: true, nudgeOn: '2026-11-01'}), task({id: 'c'}), task({id: 'd', waiting: true, done: true})];
  assert.equal(M.fillFollowUps(ts, '2026-11-10'), 1);
  assert.deepEqual(ts.map(t => t.nudgeOn), ['2026-11-10', '2026-11-01', null, null]);
});

test('handoffText: who, title, notes, the ADO link and the due date', () => {
  const t = task({notes: 'Repro in staging.', ado: {id: 12, url: 'https://ado.example.com/12'}, due: '2026-11-12'});
  assert.equal(M.handoffText(t, ['Sam Lee'], d => `on ${d}`), 'Sam Lee: Fix the login bug\n\nRepro in staging.\n\nhttps://ado.example.com/12\n\nDue on 2026-11-12');
  assert.equal(M.handoffText(task()), 'Fix the login bug');
});

test('pickerOrder: on the task, team, used most, then everyone; a query filters by name or handle', () => {
  const items = [
    {id: 'p_c', kind: 'person', name: 'Casey Contact', handle: 'casey', team: false},
    {id: 'p_r', kind: 'person', name: 'Riley Report', handle: 'riley', team: true},
    {id: 'g_l', kind: 'group', name: 'Leadership', handle: 'leadership'},
    {id: 'p_u', kind: 'person', name: 'Uma Used', handle: 'uma', team: false}
  ];
  const onTeam = it => it.team === true;
  const counts = new Map([['p_u', 3]]);
  assert.deepEqual(M.pickerOrder(items, ['g_l'], onTeam, counts).map(i => i.id), ['g_l', 'p_r', 'p_u', 'p_c']);
  assert.deepEqual(M.pickerOrder(items, [], onTeam, counts, '@le').map(i => i.id), ['g_l', 'p_r'], 'starts with it first');
  assert.deepEqual(M.pickerOrder(items, [], onTeam, counts, '>@ri').map(i => i.id), ['p_r']);
  assert.deepEqual(M.pickerOrder(items, [], onTeam, counts, 'a').map(i => i.id), ['p_u', 'p_c', 'g_l'], 'name or handle contains it');
});

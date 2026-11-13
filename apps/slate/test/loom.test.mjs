// Loom (js/loom.js): the seam between the board half and the runs half. Routes go to the half that owns them;
// the two halves' summary cards merge into one summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRoute, mergeCards, TABS, BOARD_TABS } from '../js/loom.js';

test('five tabs; Board and Health are the board half', () => {
  assert.deepEqual(TABS.map(t => t[0]), ['inbox', 'board', 'health', 'chat', 'reviews']);
  assert.deepEqual(BOARD_TABS, ['board', 'health']);
});

test('routes: the board half owns items, Health, Sprints, Board and Runway links; the rest are runs', () => {
  assert.deepEqual(splitRoute('item/w_1'), { half: 'board', tab: 'board', path: 'item/w_1' });
  assert.deepEqual(splitRoute('board'), { half: 'board', tab: 'board', path: '' });
  assert.deepEqual(splitRoute('health'), { half: 'board', tab: 'health', path: 'health' });
  assert.deepEqual(splitRoute('sprints'), { half: 'board', tab: 'health', path: 'sprints' });
  assert.equal(splitRoute('runway/m1/i2').half, 'board');
  assert.equal(splitRoute('roadmaps').half, 'board', 'Slate\'s old roadmaps address');
  for (const p of ['', 'inbox', 'chat', 'chat/ses_1', 'hub/hello', 'reviews', 'work', 'work/41207', '41610', 'pr-12'])
    assert.equal(splitRoute(p).half, 'runs', p);
});

test('summary: needs rows join (runs first, each id once), counts add up, other cards pass through', () => {
  const board = [{ id: 'needs', kind: 'list', title: 'Needs you in Slate', rows: [{ id: 'w1', title: 'Decide' }, { id: 'shared', title: 'B' }], count: 2 },
    { id: 'runs', kind: 'list', title: 'Runs in Slate', rows: [] }];
  const runs = [{ id: 'needs', kind: 'list', title: 'Needs you in Dispatch', rows: [{ id: 'f1', title: 'Asking' }, { id: 'shared', title: 'R' }], count: 2, updatedAt: 5 },
    { id: 'done-week', kind: 'list', title: 'Shipped', rows: [{ id: 'x' }] }];
  const out = mergeCards(board, runs);
  const needs = out.find(c => c.id === 'needs');
  assert.equal(needs.title, 'Needs you in Loom');
  assert.deepEqual(needs.rows.map(r => [r.id, r.title]), [['f1', 'Asking'], ['shared', 'R'], ['w1', 'Decide']]);
  assert.equal(needs.count, 4);
  assert.equal(needs.updatedAt, 5);
  assert.deepEqual(out.map(c => c.id), ['needs', 'runs', 'done-week']);
});

test('summary: held cards add up', () => {
  const out = mergeCards([{ id: 'held', kind: 'held', block: 'k', count: 1, label: '1 Slate item' }], [{ id: 'held', kind: 'held', block: 'k', count: 2, label: '2 Dispatch' }]);
  assert.deepEqual(out, [{ id: 'held', kind: 'held', block: 'k', count: 3, label: '3 updates waiting in Loom' }]);
});

test('summary: a waiting run that has a card opens the card from Needs you, once', () => {
  const board = [{ id: 'needs', kind: 'list', rows: [] }, { id: 'runs', kind: 'list', rows: [{ id: '41207', folder: '41207-fix', route: 'item/w_7' }] }];
  const runs = [{ id: 'needs', kind: 'list', rows: [{ id: '41207-fix', title: '#41207 Fix', route: '41207', flag: 'urgent' }, { id: 'spike-x', title: 'Spike', route: 'spike-x' }] }];
  const needs = mergeCards(board, runs).find(c => c.id === 'needs');
  assert.deepEqual(needs.rows.map(r => [r.id, r.route]), [['41207-fix', 'item/w_7'], ['spike-x', 'spike-x']]);
});

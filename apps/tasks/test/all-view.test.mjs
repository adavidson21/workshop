// All tasks (Tasks 12.5.0, js/all-model.js): every open task in the picked lists, nothing off a day lost. Synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allCounts, allGroups, cleanFilter, hiddenOf } from '../js/all-model.js';

const today = '2026-11-23';
const lists = [{ id: 'a', name: 'Main' }, { id: 'b', name: 'ADO' }];
const T = (id, o) => ({ id, listId: 'b', rank: 0, done: false, value: 2, effort: 2, focusOn: null, waiting: false, ...o });
const tasks = [
  T('1', { rank: 3 }), T('2', { rank: 1, value: null }), T('3', { rank: 2, focusOn: today }),
  T('4', { waiting: true }), T('5', { done: true }), T('6', { listId: 'a' }), T('7', { listId: 'gone' })
];

test('every open task in the picked lists shows, grouped in list order and by rank', () => {
  const g = allGroups(tasks, lists, ['a', 'b'], { today });
  assert.deepEqual(g.map(x => [x.list.name, x.tasks.map(t => t.id)]), [['Main', ['6']], ['ADO', ['4', '2', '3', '1']]]);
  assert.deepEqual(allGroups(tasks, lists, ['b'], { today }).map(x => x.list.id), ['b']);
});

test('filters: not on a day, to sort, waiting; counts match', () => {
  const ids = (f) => allGroups(tasks, lists, ['b'], { today, filter: f }).flatMap(x => x.tasks.map(t => t.id)).sort();
  assert.deepEqual(ids('noday'), ['1', '2']);
  assert.deepEqual(ids('sort'), ['2']);
  assert.deepEqual(ids('waiting'), ['4']);
  assert.deepEqual(allCounts(tasks, ['b'], { today }), { all: 4, noday: 2, sort: 1, waiting: 1 });
  assert.equal(cleanFilter('nope'), 'all');
});

test('hidden tasks are counted, split by the Personal tasks switch and the other filters', () => {
  const shown = t => t.id !== '1' && t.id !== '2';
  const personalShown = t => t.id !== '1';
  assert.deepEqual(hiddenOf(tasks, ['b'], { shown, personalShown }), { n: 2, personal: 1, other: 1 });
  assert.equal(allCounts(tasks, ['b'], { today, shown }).all, 2);
});

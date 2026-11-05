import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, horizon, wrapAt, HORIZON } from '../js/summary.js';
import { freshDayplan, cleanDayplan } from '../js/dayplan-model.js';
import { SchemaSet } from './workshop/schema.mjs';

const TODAY = '2026-11-04'; // a Wednesday
const board = () => ({
  lists: [{id: 'l1', name: 'Inbox'}, {id: 'l2', name: 'Team'}],
  people: ['Person One', 'Person Two'],
  tasks: [
    {id: 't1', listId: 'l1', title: 'Write the guide', rank: 2, value: 3, effort: 'S', ageFrom: TODAY, due: '2026-11-03', people: ['Person One']},
    {id: 't2', listId: 'l1', title: 'Wait for review', rank: 1, waiting: true, people: ['person one'], nudgeOn: '2026-11-05', ageFrom: TODAY},
    {id: 't3', listId: 'l2', title: 'Plan the sprint', rank: 3, focusOn: TODAY, due: '2026-11-09', ageFrom: TODAY},
    {id: 't4', listId: 'l2', title: 'Done today', rank: 4, done: true, doneAt: TODAY, focusOn: TODAY, value: 2, effort: 'M', ageFrom: TODAY},
    {id: 't5', listId: 'gone', title: 'Orphan', rank: 5}
  ]
});
const plan = () => cleanDayplan(Object.assign(freshDayplan(), {
  sprint: {anchor: '2026-10-28', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], dayStart: '09:00', dayEnd: '17:00'},
  days: {[TODAY]: {id: TODAY, template: null, shift: 0, sections: [
    {id: 's1', name: 'Deep work', around: '09:00', minutes: 120},
    {id: 's2', name: 'Meetings', around: '13:00'},
    {id: 's3', name: 'Gone', around: '15:00', lost: true}
  ], slots: [{taskId: 't3', sectionId: 's1'}, {taskId: 't1', sectionId: 's1'}]}}
}));
const log = {days: {[TODAY]: {id: TODAY, events: [{at: 'x', type: 'shutdown'}]}}, handoffs: [{id: 'h1', to: 'receipts', date: TODAY}, {id: 'h2', to: 'notes', date: TODAY}]};

test('summary: every card matches docs/summaries.md (summary-card schema)', () => {
  const schemas = SchemaSet.fromDir(new URL('./workshop/schemas/', import.meta.url).pathname);
  for (const c of buildSummary({board: board(), dp: plan(), log, today: TODAY})){
    assert.deepEqual(schemas.validate('summary-card', Object.assign({updatedAt: 1}, c)), [], c.id);
  }
});

test('summary: board counts per day, Up next and the team', () => {
  const [b] = buildSummary({board: board(), dp: plan(), log, today: TODAY});
  assert.deepEqual(Object.keys(b.days), horizon(TODAY));
  assert.equal(Object.keys(b.days).length, HORIZON);
  assert.deepEqual(b.days[TODAY], {total: 4, open: 3, focus: {total: 2, done: 1}, triage: 2, overdue: 1, dueWeek: 1});
  assert.equal(b.days['2026-11-10'].overdue, 2, 'the 11-09 task is overdue by then');
  assert.deepEqual(b.upNext.map(t => t.id), ['t1', 't3'], 'waiting and done tasks are not up next');
  assert.equal(b.upNext[0].list, 'Inbox');
  assert.deepEqual(b.team[0], {name: 'Person One', open: 2, waiting: 1});
});

test('summary: day blocks with tasks, Wrap up time, wrapped and offers', () => {
  const [, d] = buildSummary({board: board(), dp: plan(), log, today: TODAY});
  const today = d.days[TODAY];
  assert.deepEqual(today.blocks.map(b => [b.name, b.at, b.until]), [['Deep work', '09:00', '11:00'], ['Meetings', '13:00', '14:00']]);
  assert.deepEqual(today.blocks[0].tasks.map(t => t.id).sort(), ['t1', 't3']);
  assert.equal(today.wrapAt, '16:00');
  assert.equal(today.wrapped, true);
  assert.equal(today.offered, 1);
  assert.equal(d.days['2026-11-07'].wrapAt, null, 'Saturday is a day off');
  assert.equal(wrapAt(freshDayplan(), TODAY), '15:00', 'no sprint: from 3 PM');
  assert.deepEqual(buildSummary({board: board(), dp: freshDayplan(), log: null, today: TODAY})[1].days[TODAY].blocks, []);
});

test('summary: lists as capture targets, and people with open and waiting tasks', () => {
  const [, , lists, people] = buildSummary({board: board(), dp: plan(), log, today: TODAY});
  assert.deepEqual(lists, {id: 'lists', kind: 'targets', title: 'Lists', capture: 'task', rows: [{id: 'l1', title: 'Inbox'}, {id: 'l2', title: 'Team'}]});
  const one = people.rows.find(r => r.name === 'Person One');
  assert.deepEqual(one.open.map(t => t.id), ['t1']);
  assert.deepEqual(one.waiting, [{id: 't2', title: 'Wait for review', due: '', nudgeOn: '2026-11-05'}]);
});

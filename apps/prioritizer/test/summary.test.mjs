import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, horizon, wrapAt, HORIZON } from '../js/summary.js';
import { freshDayplan, cleanDayplan } from '../js/dayplan-model.js';
import { SchemaSet } from './workshop/schema.mjs';
import { directory } from '../shared/people.js';

const dir = directory({schema: 'settings.people', version: 2, rev: 1, items: [
  {id: 'p_one', kind: 'person', name: 'Person One', handle: 'person', relation: 'report'},
  {id: 'p_two', kind: 'person', name: 'Person Two', handle: 'two', relation: 'manager'},
  {id: 'g_lead', kind: 'group', name: 'Leadership', handle: 'leadership', members: ['p_one', 'p_two']}]});

const TODAY = '2026-11-04'; // a Wednesday
const board = () => ({
  lists: [{id: 'l1', name: 'Inbox'}, {id: 'l2', name: 'Team'}],
  tasks: [
    {id: 't1', listId: 'l1', title: 'Write the guide', rank: 2, value: 3, effort: 'S', ageFrom: TODAY, due: '2026-11-03', who: ['p_one']},
    {id: 't2', listId: 'l1', title: 'Wait for review', rank: 1, waiting: true, who: ['p_one'], nudgeOn: '2026-11-05', ageFrom: TODAY},
    {id: 't3', listId: 'l2', title: 'Plan the sprint', rank: 3, focusOn: TODAY, due: '2026-11-09', ageFrom: TODAY, who: ['g_lead']},
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
  for (const c of buildSummary({board: board(), dir, dp: plan(), log, today: TODAY})){
    assert.deepEqual(schemas.validate('summary-card', Object.assign({updatedAt: 1}, c)), [], c.id);
  }
});

test('summary: board counts per day, Up next and the team', () => {
  const [b] = buildSummary({board: board(), dir, dp: plan(), log, today: TODAY});
  assert.deepEqual(Object.keys(b.days), horizon(TODAY));
  assert.equal(Object.keys(b.days).length, HORIZON);
  assert.deepEqual(b.days[TODAY], {total: 4, open: 3, triage: 2, overdue: 1, dueWeek: 1, nudges: 0, cameBack: 0,
    focus: {total: 2, done: 1, tasks: [{id: 't3', title: 'Plan the sprint', done: false}, {id: 't4', title: 'Done today', done: true}]}},
    "Today's tasks by rank, titles and ids only (Notes' daily note)");
  assert.equal(b.days['2026-11-10'].overdue, 2, 'the 11-09 task is overdue by then');
  assert.equal(b.days['2026-11-05'].nudges, 1, 'the follow-up on 11-05 is due that day');
  assert.deepEqual(b.upNext.map(t => t.id), ['t1', 't3'], 'waiting and done tasks are not up next');
  assert.equal(b.upNext[0].list, 'Inbox');
  assert.deepEqual(b.upNext[0].who, ['p_one']);
  assert.deepEqual(b.team, [{id: 'p_one', name: 'Person One', open: 3, waiting: 1}, {id: 'p_two', name: 'Person Two', open: 1, waiting: 0}], 'people through their groups too; groups are not team rows');
});

test('summary: day blocks with tasks, Wrap up time, wrapped and offers', () => {
  const [, d] = buildSummary({board: board(), dir, dp: plan(), log, today: TODAY});
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
  const [, , lists, people] = buildSummary({board: board(), dir, dp: plan(), log, today: TODAY});
  assert.deepEqual(lists, {id: 'lists', kind: 'targets', title: 'Lists', capture: 'task', rows: [{id: 'l1', title: 'Inbox'}, {id: 'l2', title: 'Team'}]});
  const one = people.rows.find(r => r.id === 'p_one');
  assert.deepEqual(one.open.map(t => [t.id, t.via]), [['t1', ''], ['t3', 'g_lead']]);
  assert.deepEqual(one.waiting, [{id: 't2', title: 'Wait for review', due: '', nudgeOn: '2026-11-05', via: ''}]);
  assert.deepEqual(people.rows.find(r => r.id === 'g_lead').open.map(t => [t.id, t.via]), [['t3', '']]);
  assert.deepEqual(people.rows.map(r => r.id).sort(), ['g_lead', 'p_one', 'p_two']);
});

test('done-week: tasks finished in the last 7 days, newest first, never won\'t do', async () => {
  const { doneWeekCard } = await import('../js/summary.js');
  const b = board();
  b.tasks.push({id: 't6', listId: 'l1', title: 'Last week', done: true, doneAt: '2026-10-28'},
    {id: 't7', listId: 'l1', title: 'Skipped', done: true, wontDo: true, doneAt: TODAY},
    {id: 't8', listId: 'l1', title: 'Six days ago', done: true, doneAt: '2026-10-29'.replace('29', '30')});
  const c = doneWeekCard(b, TODAY);
  assert.equal(c.kind, 'list');
  assert.deepEqual(c.rows.map(r => [r.title, r.due, r.note, r.route]), [['Done today', TODAY, 'Team', 'task/t4'], ['Six days ago', '2026-10-30', 'Inbox', 'task/t8']]);
  assert.equal(c.count, 2);
});

test('summary: tasks that came back count until handled', () => {
  const bd = board();
  bd.tasks[0].cameBack = TODAY;
  const [b] = buildSummary({board: bd, dir, dp: plan(), log, today: TODAY});
  assert.equal(b.days[TODAY].cameBack, 1);
});

test('needs (Docket 7.0.0): one row per kind with its count, most pressing first, each opening Today', async () => {
  const { needsCard } = await import('../js/summary.js');
  const bd = board();
  bd.tasks.push(
    {id: 'p1', listId: 'l1', title: 'Review: a', rank: 6, pr: {key: 'k|1', id: 1, tier: 'blocking'}, due: '2026-11-01'},
    {id: 'p2', listId: 'l1', title: 'Review: b', rank: 7, pr: {key: 'k|2', id: 2, tier: 'blocking', waiting: true}},
    {id: 'p3', listId: 'l1', title: 'Review: c', rank: 8, pr: {key: 'k|3', id: 3, tier: 'asked'}},
    {id: 'n1', listId: 'l2', title: 'Ask about it', rank: 9, waiting: true, nudgeOn: '2026-11-04'},
    {id: 'c1', listId: 'l2', title: 'Came back', rank: 10, cameBack: TODAY});
  bd.ado = {pending: [{id: 5}, {id: 6}]};
  const c = needsCard(bd, TODAY);
  assert.equal(c.id, 'needs'); assert.equal(c.kind, 'list');
  assert.deepEqual(c.rows.map(r => [r.id, r.title, r.flag || '', r.route]), [
    ['prs', '1 PR blocked on you', 'urgent', 'today'],
    ['nudges', '1 follow-up due', 'waiting', 'today'],
    ['cameback', '1 task came back', 'waiting', 'today'],
    ['ado', '2 new ADO items', '', 'today'],
    ['overdue', '1 overdue task', '', 'today']]);   // the overdue PR is a review, not an overdue task
  assert.deepEqual(needsCard(board(), '2026-10-01').rows, [], 'nothing waiting: no rows');
});

test('triage counts only tasks to sort: a stale task stays in Ranked (Docket 7.0.0)', () => {
  const bd = board();
  bd.tasks[0].ageFrom = '2026-09-01'; bd.tasks[0].due = null;   // value 3: stale after 8 days
  const [b] = buildSummary({board: bd, dir, dp: plan(), log, today: TODAY});
  assert.equal(b.days[TODAY].triage, 2, 't2 and t3 (no value or effort), not the stale t1');
});

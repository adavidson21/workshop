// Tasks and its agents (Builds 6.23.0, js/runs/task-runs.js): runs linked to the task they came from, and where each
// one is for Tasks. A task can send several parts; nothing here completes a task. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blank, cleanTask, folderOf, linksOf, readable, taskRows, withRun } from '../js/runs/task-runs.js';

const DAY = 864e5;

test('a run started from a task is linked by what the start answered; a bad task id links nothing', () => {
  let env = withRun(blank(), { task: 't_1', part: 'Write the CSV writer\nmore', res: { id: 'L12', folder: 'L12-csv' }, now: 10 });
  env = withRun(env, { task: 't_1', part: 'Which encodings?', res: { session: 'ses_9' }, now: 20 });
  assert.ok(readable(env));
  assert.deepEqual(linksOf(env).map(l => [l.id, l.task, l.part]), [['session:ses_9', 't_1', 'Which encodings?'], ['L12-csv', 't_1', 'Write the CSV writer']]);
  assert.equal(withRun(blank(), { task: '../x', part: 'p', res: {} }), null);
  assert.equal(cleanTask('t_1'), 't_1');
  assert.equal(cleanTask('a b'), '');
});

test('a link finds its folder: its own, its session\'s, or the item with its id', () => {
  assert.equal(folderOf({ folder: 'f' }), 'f');
  assert.equal(folderOf({ session: 's' }, { sessions: { s: { folder: 'g' } } }), 'g');
  assert.equal(folderOf({ itemId: '7' }, { items: [{ id: 7, folder: 'h' }] }), 'h');
  assert.equal(folderOf({ session: 's' }), '');
});

test('rows say where each run is; a gate is urgent; a finished run says Done; a lost one drops after a day', () => {
  const links = [
    { task: 't_1', part: 'Write it', folder: 'f1', at: 5 },
    { task: 't_1', part: 'Ask', session: 's2', at: 4 },
    { task: 't_2', part: 'Old', folder: 'gone', at: 0 },
    { task: 't_3', part: 'Shipped', folder: 'f3', at: 3 }
  ];
  const where = new Map([['f1', { station: 'Plan desk', state: 'gate', file: 'plan.md' }], ['session:s2', { station: 'Plan desk', state: 'run', file: '' }]]);
  const rows = taskRows(links, { where, done: new Set(['f3']), now: 2 * DAY });
  assert.deepEqual(rows.map(r => [r.id, r.title, r.note, r.state, r.flag || '']), [
    ['t_1', 'Write it', 'Plan desk · Waiting on you', 'gate', 'urgent'],
    ['t_1', 'Ask', 'Plan desk · Working', 'run', ''],
    ['t_3', 'Shipped', 'Done', 'done', '']
  ]);
  assert.equal(rows[0].file, 'plan.md');
  assert.equal(rows[0].route, 'f1');
});

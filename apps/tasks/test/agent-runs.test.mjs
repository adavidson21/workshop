// A task's agent work (Tasks 13.0.0, js/agent-runs.js): Builds' `tasks` card read into runs per task. Synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipOf, runsOf } from '../js/agent-runs.js';

const env = rows => ({ schema: 'builds.summary', items: [{ id: 'tasks', kind: 'list', rows }] });

test('runs per task, newest first; bad rows and files are dropped', () => {
  const m = runsOf(env([
    { id: 't1', title: 'Write the CSV writer', station: 'Plan desk', state: 'gate', folder: 'f1', file: 'plan.md', route: 'f1', at: 2 },
    { id: 't1', title: 'Ask about encodings', station: 'Out tray', state: 'done', folder: 'f2', file: '../x.md', at: 5 },
    { id: '', title: 'no task' }, null, { id: 't2', state: 'weird', at: 1 }
  ]));
  assert.deepEqual([...m.keys()], ['t1', 't2']);
  assert.deepEqual(m.get('t1').map(r => r.title), ['Ask about encodings', 'Write the CSV writer']);
  assert.equal(m.get('t1')[0].file, '', 'only a plain .md name');
  assert.equal(m.get('t2')[0].state, 'idle');
  assert.equal(runsOf(null).size, 0);
  assert.equal(runsOf({ schema: 'other' }).size, 0);
});

test('the row chip shows the run that needs you first', () => {
  const m = runsOf(env([
    { id: 't1', title: 'A', station: 'Build bay', state: 'run', at: 9 },
    { id: 't1', title: 'B', station: 'Plan desk', state: 'gate', note: 'Plan desk · Waiting on you', at: 1 }
  ]));
  const c = chipOf(m.get('t1'));
  assert.equal(c.state, 'gate');
  assert.equal(c.text, 'Plan desk');
  assert.match(c.tip, /^B: Plan desk · Waiting on you \(and 1 more run\)$/);
  assert.equal(chipOf([]), null);
});

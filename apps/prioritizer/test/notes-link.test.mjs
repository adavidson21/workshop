// Plan 1: Copy link and the notes about a task (js/notes-link.js), and the open tasks card for Notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notesAbout, shown, taskLink } from '../js/notes-link.js';
import { tasksCard } from '../js/summary.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';

const schemas = SchemaSet.fromDir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'schemas'));

test('Copy link: a Markdown ws: link with safe link text', () => {
  assert.equal(taskLink({id: 't_k2f9', title: 'Fix the [login] timeout'}), '[Fix the (login) timeout](ws:prioritizer/task/t_k2f9)');
  assert.equal(taskLink({id: 't_1', title: '  '}), '[Task](ws:prioritizer/task/t_1)');
});

test('notes about a task: rows of Notes\' mentions card for that task, each note once', () => {
  const env = {schema: 'notes.summary', version: 1, rev: 1, deleted: {}, items: [{id: 'mentions', kind: 'list', updatedAt: 1, rows: [
    {id: 'a', title: 'Deploy runbook', route: 'runbooks/deploy.md', note: 'prioritizer/task/t_1'},
    {id: 'b', title: 'Other', route: 'b.md', note: 'prioritizer/task/t_2'},
    {id: 'c', title: 'Deploy runbook', route: 'runbooks/deploy.md', note: 'prioritizer/task/t_1'},
    {id: 'd', title: 'Q4 sync', route: 'q4.md', note: 'prioritizer/task/t_1'}]}]};
  assert.deepEqual(notesAbout(env, 't_1'), [{title: 'Deploy runbook', route: 'runbooks/deploy.md'}, {title: 'Q4 sync', route: 'q4.md'}]);
  assert.deepEqual(notesAbout(env, 't_9'), []);
  assert.deepEqual(notesAbout(null, 't_1'), []);
  assert.deepEqual(notesAbout({...env, schema: 'other.summary'}, 't_1'), []);
  assert.deepEqual(shown([1, 2, 3, 4, 5]), {list: [1, 2, 3], more: 2});
  assert.deepEqual(shown([1]), {list: [1], more: 0});
});

test('the tasks card: open tasks by rank, up to 50, ids, titles and routes only', () => {
  const lists = [{id: 'l1', name: 'Inbox'}];
  const tasks = Array.from({length: 55}, (_, i) => ({id: `t${i}`, listId: 'l1', title: `Task ${i}`, rank: 55 - i, done: i === 54, notes: 'secret'}));
  const c = tasksCard({lists, tasks});
  assert.equal(c.count, 54);
  assert.equal(c.rows.length, 50);
  assert.deepEqual(c.rows[0], {id: 't53', title: 'Task 53', route: 'task/t53'}, 'highest rank first; done tasks left out');
  assert.equal(JSON.stringify(c).includes('secret'), false);
  assert.deepEqual(schemas.validate('summary-card', {...c, updatedAt: 1}), []);
});

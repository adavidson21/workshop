// Plan 1: other apps' records in the [[ picker, and the mentions card each record can rely on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECORDS, matchRecords, recordLink, recordsFrom } from '../js/records.js';
import { notesCards } from '../js/summary-cards.js';
import { buildIndex, search } from '../js/model.js';

const sum = (app, cards) => ({ schema: `${app}.summary`, version: 1, rev: 1, deleted: {}, items: cards.map(c => ({ updatedAt: 1, ...c })) });
const ENVS = {
  tasks: sum('tasks', [{ id: 'tasks', kind: 'list', rows: [{ id: 't_1', title: 'Fix the login timeout', route: 'task/t_1' }, { id: 't_2', title: 'Write [login] docs', route: 'task/t_2' }, { id: 'x', title: 'Bad', route: '../x' }] }]),
  roadmaps: sum('roadmaps', [{ id: 'roadmaps', kind: 'targets', capture: 'idea', rows: [{ id: 'r_1', title: 'Login redesign' }] }])
};

test('records: tasks from Tasks and Roadmaps roadmaps as ws: links; bad routes left out', () => {
  const r = recordsFrom(ENVS);
  assert.deepEqual(r.map(x => [x.name, x.href]), [['Tasks', 'ws:tasks/task/t_1'], ['Tasks', 'ws:tasks/task/t_2'], ['Roadmaps', 'ws:roadmaps/r_1']]);
  assert.deepEqual(recordsFrom({ tasks: { ...ENVS.tasks, schema: 'other.summary' } }), []);
  assert.deepEqual(recordsFrom({}), []);
});

test('the picker: records only after two letters, starts-with first, at most five', () => {
  const r = recordsFrom(ENVS);
  assert.deepEqual(matchRecords(r, 'l'), []);
  assert.deepEqual(matchRecords(r, 'login').map(x => x.title), ['Login redesign', 'Fix the login timeout', 'Write [login] docs']);
  assert.equal(recordLink(r[1]), '[Write (login) docs](ws:tasks/task/t_2)');
  const many = Array.from({ length: 9 }, (_, i) => ({ app: 'tasks', name: 'Tasks', title: `Login ${i}`, href: `ws:tasks/task/t${i}` }));
  assert.equal(matchRecords(many, 'lo').length, MAX_RECORDS);
});

test('mentions: each record keeps its newest 3 notes, even when other records have many newer ones', () => {
  const docs = [{ path: 'old.md', content: '# Old\n\n[t](ws:tasks/task/t_old)', mtime: 1 }];
  for (let i = 0; i < 60; i++) docs.push({ path: `n${i}.md`, content: `# N${i}\n\n[t](ws:tasks/task/t_busy)`, mtime: 100 + i });
  const card = notesCards(buildIndex(docs)).find(c => c.id === 'mentions');
  assert.equal(card.rows.length, 50);
  assert.ok(card.rows.some(r => r.note === 'tasks/task/t_old' && r.route === 'old.md'), 'the old record is still there');
  assert.equal(card.count, 61);
});

test('search finds the notes that link to a record (Tasks\' +N opens this search)', () => {
  const ix = buildIndex([{ path: 'a.md', content: '# A\n\n[t](ws:tasks/task/t_1)', mtime: 1 }, { path: 'b.md', content: '# B', mtime: 1 }]);
  const found = search(ix, new Map([['a.md', '# A\n\n[t](ws:tasks/task/t_1)'], ['b.md', '# B']]), 'ws:tasks/task/t_1');
  assert.deepEqual(found.map(f => f.path), ['a.md']);
});

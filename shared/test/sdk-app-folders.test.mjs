// The browser's folder store keeps each app in the folder named by its id, like the agent (shared/app-folders.js,
// docs/data-format.md App folders), and keeps using an old folder while it is the only one, reading what it
// holds under the app's id now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals } from '../workshop-sdk.js';
import { FakeFolder } from './fake-dir.mjs';

const { makeFolderStore } = _internals;
const store = (fs) => makeFolderStore({ clientId: 'w-a' }, fs.root, { timers: false, channel: null, now: () => Date.UTC(2026, 10, 16, 12) });
const env = (schema, items) => ({ schema, version: 1, rev: 0, items });
const saved = (schema, id, rev = 2) => `${JSON.stringify({ schema, version: 1, rev, updatedAt: '2026-11-01T00:00:00.000Z', items: [{ id, updatedAt: 1 }] }, null, 2)}\n`;

test('a new folder: collections, files and the trash use the app ids', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('tasks', 'tasks', env('tasks.tasks', [{ id: 't1', updatedAt: 1 }]));
  await s.files.write('people', 'summaries/a.md', '# A\n', { create: true });
  await s.files.write('notes', 'one.md', '# One\n', { create: true });
  const f = await s.files.read('notes', 'one.md');
  await s.files.trash('notes', 'one.md', { mtime: f.mtime });
  assert.ok(fs.exists('tasks/tasks.json'));
  assert.ok(fs.exists('people/summaries/a.md'));
  assert.ok(fs.paths().some(p => p.startsWith('.trash/notes/one.')), fs.paths().join(', '));
  assert.deepEqual((await s.allCollections()).map(c => `${c.app}/${c.collection}`), ['tasks/tasks']);
});

test('an old folder is used while it is the only one, and what it holds reads under the app id now', async () => {
  const fs = new FakeFolder();
  fs.write('docket/tasks.json', saved('prioritizer.tasks', 'old'));
  const s = store(fs);
  const got = await s.get('tasks', 'tasks');
  assert.equal(got.schema, 'tasks.tasks');
  assert.deepEqual(got.items.map(i => i.id), ['old']);
  await s.put('tasks', 'tasks', { ...got, items: [...got.items, { id: 'new', updatedAt: 2 }] });
  assert.ok(fs.exists('docket/tasks.json') && !fs.exists('tasks'), 'written back where it is');
  assert.equal(JSON.parse(fs.read('docket/tasks.json')).schema, 'tasks.tasks');
  assert.deepEqual((await s.allCollections()).map(c => c.app), ['tasks']);
});

test('the newest old folder is used first; once the app\'s folder exists that one is, and leftovers are ignored', async () => {
  const fs = new FakeFolder();
  fs.write('prioritizer/tasks.json', saved('prioritizer.tasks', 'oldest'));
  fs.write('docket/tasks.json', saved('prioritizer.tasks', 'docket'));
  assert.deepEqual((await store(fs).get('tasks', 'tasks')).items.map(i => i.id), ['docket']);
  fs.write('tasks/tasks.json', saved('tasks.tasks', 'renamed'));
  const s = store(fs);
  assert.deepEqual((await s.get('tasks', 'tasks')).items.map(i => i.id), ['renamed']);
  assert.deepEqual((await s.allCollections()).map(c => c.envelope.items[0].id), ['renamed']);
});

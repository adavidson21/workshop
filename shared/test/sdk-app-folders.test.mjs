// The browser's folder store uses the same app folder names as the agent (shared/app-folders.js,
// docs/data-format.md App folders), and keeps using a folder under its old name while it is the only one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals } from '../workshop-sdk.js';
import { FakeFolder } from './fake-dir.mjs';

const { makeFolderStore } = _internals;
const store = (fs) => makeFolderStore({ clientId: 'w-a' }, fs.root, { timers: false, channel: null, now: () => Date.UTC(2026, 10, 16, 12) });
const env = (schema, items) => ({ schema, version: 1, rev: 0, items });

test('a new folder: collections, files and the trash use the folder names people see', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('prioritizer', 'tasks', env('prioritizer.tasks', [{ id: 't1', updatedAt: 1 }]));
  await s.files.write('receipts', 'summaries/a.md', '# A\n', { create: true });
  await s.files.write('notes', 'one.md', '# One\n', { create: true });
  const f = await s.files.read('notes', 'one.md');
  await s.files.trash('notes', 'one.md', { mtime: f.mtime });
  assert.ok(fs.exists('docket/tasks.json'));
  assert.ok(fs.exists('rapport/summaries/a.md'));
  assert.ok(!fs.exists('prioritizer') && !fs.exists('receipts') && !fs.exists('notes'));
  assert.ok(fs.paths().some(p => p.startsWith('.trash/folio/one.')), fs.paths().join(', '));
  assert.deepEqual((await s.allCollections()).map(c => `${c.app}/${c.collection}`), ['prioritizer/tasks']);
});

test('a folder only the browser used keeps its old name while it is the only one, so nothing goes missing', async () => {
  const fs = new FakeFolder();
  fs.write('prioritizer/tasks.json', `${JSON.stringify({ schema: 'prioritizer.tasks', version: 1, rev: 2, updatedAt: '2026-11-01T00:00:00.000Z', items: [{ id: 'old', updatedAt: 1 }] }, null, 2)}\n`);
  const s = store(fs);
  const got = await s.get('prioritizer', 'tasks');
  assert.deepEqual(got.items.map(i => i.id), ['old']);
  await s.put('prioritizer', 'tasks', { ...got, items: [...got.items, { id: 'new', updatedAt: 2 }] });
  assert.ok(fs.exists('prioritizer/tasks.json') && !fs.exists('docket'));
  assert.deepEqual((await s.allCollections()).map(c => c.app), ['prioritizer']);
});

test('once the new folder exists (the agent renamed it) that one is used, and a leftover old one is ignored', async () => {
  const fs = new FakeFolder();
  const mk = (p, id) => fs.write(p, `${JSON.stringify({ schema: 'prioritizer.tasks', version: 1, rev: 1, updatedAt: '2026-11-01T00:00:00.000Z', items: [{ id, updatedAt: 1 }] }, null, 2)}\n`);
  mk('docket/tasks.json', 'renamed');
  mk('prioritizer/tasks.json', 'leftover');
  const s = store(fs);
  assert.deepEqual((await s.get('prioritizer', 'tasks')).items.map(i => i.id), ['renamed']);
  assert.deepEqual((await s.allCollections()).map(c => c.envelope.items[0].id), ['renamed']);
});

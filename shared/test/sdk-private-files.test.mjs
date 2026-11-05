// Private files (docs/app-manifest.md, privateFiles): another app's private files can't be listed, read or watched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals, appsFromRegistry, isPrivatePath, privateFilesOf, privateFilesSpec } from '../workshop-sdk.js';
import { FakeFolder } from './fake-dir.mjs';

test('privateFiles: true, a list of top folders, or nothing', () => {
  assert.equal(privateFilesSpec(true), true);
  assert.deepEqual(privateFilesSpec(['goals', 'Bad Name', 3, 'oneonones']), ['goals', 'oneonones']);
  assert.equal(privateFilesSpec([]), null);
  assert.equal(privateFilesSpec('yes'), null);
  assert.equal(isPrivatePath(true, 'anything.md'), true);
  assert.equal(isPrivatePath(['oneonones'], 'oneonones/notes/a.md'), true);
  assert.equal(isPrivatePath(['oneonones'], 'oneonones'), true);
  assert.equal(isPrivatePath(['oneonones'], 'summaries/a.md'), false);
  assert.equal(isPrivatePath(null, 'a.md'), false);
});

test('the manifest decides; Rapport (receipts) is private when its manifest is unknown', () => {
  assert.equal(privateFilesOf('receipts', null), true);
  assert.equal(privateFilesOf('receipts', new Map()), true);
  assert.equal(privateFilesOf('notes', null), null);
  assert.deepEqual(privateFilesOf('runway', new Map([['runway', ['secret']]])), ['secret']);
  assert.equal(privateFilesOf('receipts', new Map([['receipts', true]])), true);
  const [m] = appsFromRegistry({ apps: [{ manifest: { id: 'receipts', name: 'Rapport', privateFiles: true } }] });
  assert.equal(m.privateFiles, true);
});

function setup() {
  const fs = new FakeFolder();
  fs.write('receipts/oneonones/notes/person-one.md', '# 1:1');
  fs.write('runway/exports/q4.md', '# Roadmap');
  fs.write('runway/secret/plan.md', '# Secret');
  fs.write('notes/a.md', '# A');
  const store = _internals.makeFolderStore({ clientId: 'w-a' }, fs.root, { timers: false, channel: null });
  const rules = { receipts: privateFilesOf('receipts', null), runway: ['secret'] };
  return { fs, store, filesFor: (app) => _internals.filesApi(app, store.files, async (owner) => rules[owner] || null) };
}

test('another app: private files reject with forbidden; listings leave them out', async () => {
  const { filesFor } = setup();
  const notes = filesFor('notes');
  await assert.rejects(notes.read('oneonones/notes/person-one.md', { app: 'receipts' }), e => e.code === 'forbidden');
  await assert.rejects(notes.list(undefined, { app: 'receipts' }), e => e.code === 'forbidden');
  await assert.rejects(notes.list('secret', { app: 'runway' }), e => e.code === 'forbidden');
  await assert.rejects(notes.read('secret/plan.md', { app: 'runway' }), e => e.code === 'forbidden');
  assert.deepEqual((await notes.list(undefined, { app: 'runway' })).map(f => f.path), ['exports/q4.md']);
  assert.equal((await notes.read('exports/q4.md', { app: 'runway' })).content, '# Roadmap');
});

test('the owner reads its own private files as before', async () => {
  const { filesFor } = setup();
  const rapport = filesFor('receipts');
  assert.deepEqual((await rapport.list()).map(f => f.path), ['oneonones/notes/person-one.md']);
  assert.equal((await rapport.read('oneonones/notes/person-one.md')).content, '# 1:1');
});

test('change events for another app\'s private files are not delivered', async () => {
  const seen = [];
  const handlers = [];
  const fake = { subscribe: (_app, _t, h) => { handlers.push(h); return () => {}; } };
  const files = _internals.filesApi('notes', fake, async (owner) => (owner === 'runway' ? ['secret'] : null));
  files.subscribe('', (ev) => seen.push(ev.path), { app: 'runway' });
  handlers[0]({ app: 'runway', path: 'secret/plan.md', mtime: 1 });
  handlers[0]({ app: 'runway', path: 'exports/q4.md', mtime: 2 });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(seen, ['exports/q4.md']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP, SPACING_MS, historyFolder, historyKey, planSnapshot, snapshotsOf, stampName, stampTime } from '../js/history.js';
import { SEG, isNote, tree } from '../js/model.js';
import { _internals } from '../shared/workshop-sdk.js';
import { FakeFolder } from './workshop/fake-dir.mjs';
import { createNotes } from '../js/data.js';

test('keys and stamps follow the name rules and round-trip', () => {
  for (const p of ['a.md', 'runbooks/deploy.md', 'a/b/c/a-very-long-note-name-that-goes-on-and-on.md']) {
    assert.ok(SEG.test(historyKey(p)), historyKey(p));
  }
  assert.notEqual(historyKey('a/b-c.md'), historyKey('a-b/c.md'));
  const t = Date.UTC(2026, 10, 5, 17, 12, 30, 123);
  assert.equal(stampName(t), '20261105t171230123z.md');
  assert.equal(stampTime(stampName(t)), t);
  assert.ok(SEG.test(stampName(t).replace(/\.md$/, '')));
});

test('history/ is not a note folder', () => {
  assert.equal(isNote('history/a-1/20261105t171230123z.md'), false);
  assert.deepEqual(tree(['a.md', 'history/x/y.md']).folders, []);
});

test('planSnapshot: keeps the old text, at most one per window, trims to KEEP', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  assert.equal(planSnapshot('a.md', '', [], now).write, null);
  const first = planSnapshot('a.md', 'old', [], now);
  assert.equal(first.write, `${historyFolder('a.md')}/${stampName(now)}`);
  const soon = planSnapshot('a.md', 'older', [{ path: first.write, at: now }], now + SPACING_MS - 1);
  assert.equal(soon.write, null);
  const many = Array.from({ length: KEEP }, (_, k) => ({ path: `${historyFolder('a.md')}/${stampName(now - (k + 1) * 3.6e6)}`, at: now - (k + 1) * 3.6e6 }));
  const plan = planSnapshot('a.md', 'x', many, now);
  assert.equal(plan.trash.length, 1);
  assert.equal(plan.trash[0], many[KEEP - 1].path);
  const listing = many.map(s => ({ path: s.path, mtime: 1 })).concat([{ path: 'a.md', mtime: 1 }]);
  assert.deepEqual(snapshotsOf('a.md', listing).map(s => s.at), many.map(s => s.at));
});

test('saving a note keeps the text it replaced in history/', async () => {
  const fs = new FakeFolder();
  fs.write('notes/a.md', '# A\n\nfirst');
  const s = _internals.makeFolderStore({ clientId: 'w-a' }, fs.root, { timers: false, channel: null });
  const ws = { files: {
    list: (folder) => s.files.list('notes', folder), read: (p) => s.files.read('notes', p),
    write: (p, c, o) => s.files.write('notes', p, c, o), trash: (p, o) => s.files.trash('notes', p, o), subscribe: () => () => {} } };
  const n = createNotes(ws);
  await n.load();
  const m = n.texts.get('a.md').mtime;
  await n.save('a.md', '# A\n\nsecond', m);
  const versions = n.history('a.md');
  assert.equal(versions.length, 1);
  assert.equal(await n.readSnapshot(versions[0].path), '# A\n\nfirst');
  assert.deepEqual([...n.texts.keys()], ['a.md']);
  assert.equal(n.index.notes.size, 1);
});

test('a restore keeps the text it replaces even inside the spacing window', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  const snaps = [{ path: `${historyFolder('a.md')}/${stampName(now - 1000)}`, at: now - 1000 }];
  assert.equal(planSnapshot('a.md', 'current', snaps, now).write, null);
  assert.equal(planSnapshot('a.md', 'current', snaps, now, { force: true }).write, `${historyFolder('a.md')}/${stampName(now)}`);
});

test("planSnapshot: a new note's blank start (a bare #) is not kept", () => {
  const now = Date.UTC(2026, 10, 6, 12);
  assert.equal(planSnapshot('untitled.md', '# \n\n', [], now).write, null);
  assert.equal(planSnapshot('untitled.md', '#\n', [], now).write, null);
  assert.ok(planSnapshot('untitled.md', '# Title\n\n', [], now).write);
});

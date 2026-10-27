// The SDK's browser backend on a folder (docs/run-modes.md, Folder store) against an in-memory directory
// handle (fake-dir.mjs): the same rev, conflict, tombstone, trash and backup rules as the agent, nested names,
// the files API, lastModified checks, change events, folder access, and the move from IndexedDB.
// The real IndexedDB and Chrome's handles are covered by tests/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals, data as sdkData } from '../workshop-sdk.js';
import { FakeFolder } from './fake-dir.mjs';

const { makeFolderStore, moveIntoFolder, openBrowserStore } = _internals;

// BroadcastChannel stand-in: every channel made by one bus hears the others, never itself.
function bus() {
  const members = new Set();
  const make = () => {
    const ch = {
      listeners: [], sent: [],
      addEventListener(type, fn) { this.listeners.push(fn); },
      postMessage(m) { this.sent.push(m); for (const o of members) if (o !== ch) queueMicrotask(() => o.listeners.forEach(fn => fn({ data: structuredClone(m) }))); },
      close() { members.delete(ch); }
    };
    members.add(ch);
    return ch;
  };
  return make;
}
const tick = () => new Promise(r => setTimeout(r, 5));
const store = (fs, client = 'w-a', opts = {}) => makeFolderStore({ clientId: client }, fs.root, Object.assign({ timers: false, channel: null, now: () => Date.UTC(2026, 9, 25, 14, 5, 0, 123) }, opts));
const envelope = (items, extra = {}) => Object.assign({ schema: 'notes.pages', version: 1, rev: 0, items }, extra);
const codeOf = async (p) => p.then(() => 'ok', e => e.code);

test('collections: create, read back, stored as the agent stores them', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  assert.equal(await s.get('notes', 'pages'), null, 'never written');
  const res = await s.put('notes', 'pages', envelope([{ id: 'p1', updatedAt: 1, title: 'One' }], { rev: 0, updatedAt: 'ignored' }));
  assert.equal(res.rev, 1);
  assert.equal(res.updatedAt, '2026-10-25T14:05:00.123Z');
  const text = fs.read('notes/pages.json');
  assert.ok(text.endsWith('\n') && text.includes('\n  "schema"'), 'pretty-printed with 2 spaces and a final newline');
  const back = await s.get('notes', 'pages');
  assert.deepEqual(back, { schema: 'notes.pages', version: 1, rev: 1, updatedAt: '2026-10-25T14:05:00.123Z', items: [{ id: 'p1', updatedAt: 1, title: 'One' }] });
  assert.equal(s.storage, 'folder');
  assert.equal(s.online, true);
});

test('collections: a stale rev is a conflict carrying the stored copy; a missing one carries rev 0', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  const missing = await s.put('notes', 'pages', envelope([], { rev: 3 })).catch(e => e);
  assert.equal(missing.code, 'conflict');
  assert.deepEqual(missing.current, { schema: 'notes.pages', version: 1, rev: 0, items: [] });
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  const stale = await s.put('notes', 'pages', envelope([{ id: 'b', updatedAt: 2 }])).catch(e => e);
  assert.equal(stale.code, 'conflict');
  assert.equal(stale.status, 409);
  assert.equal(stale.current.rev, 1);
  assert.deepEqual(stale.current.items.map(i => i.id), ['a']);
});

test('collections: two tabs, write loop with merge, tombstones keep a deletion', async () => {
  const fs = new FakeFolder();
  const a = store(fs, 'w-a'), b = store(fs, 'w-b');
  const first = sdkData.stamp(null, envelope([{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }]));
  await a.put('notes', 'pages', first);
  const readA = await a.get('notes', 'pages'), readB = await b.get('notes', 'pages');

  // b deletes p2; a edits p1 from its older copy.
  const editB = sdkData.stamp(readB, { ...structuredClone(readB), items: readB.items.filter(i => i.id !== 'p2') });
  assert.equal((await b.put('notes', 'pages', editB)).rev, 2);
  const onDisk = JSON.parse(fs.read('notes/pages.json'));
  assert.ok(onDisk.deleted && onDisk.deleted.p2, 'the deletion is a tombstone in the file');

  const editA = sdkData.stamp(readA, { ...structuredClone(readA), items: readA.items.map(i => (i.id === 'p1' ? { ...i, title: 'One, edited' } : i)) });
  const err = await a.put('notes', 'pages', editA).catch(e => e);
  assert.equal(err.code, 'conflict');
  const merged = sdkData.merge(editA, err.current);
  assert.equal((await a.put('notes', 'pages', merged)).rev, 3);
  const final = await a.get('notes', 'pages');
  assert.deepEqual(final.items.map(i => [i.id, i.title]), [['p1', 'One, edited']], 'p2 stays deleted, the edit is kept');
});

test('collections: a lower version is refused; a higher one keeps a backup that is never overwritten', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }], { version: 2 }));
  assert.equal(await codeOf(s.put('notes', 'pages', envelope([], { version: 1, rev: 1 }))), 'downgrade');
  const v2 = fs.read('notes/pages.json');
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 2 }], { version: 3, rev: 1 }));
  assert.equal(fs.read('.backups/2026-10-25/notes/pages.v2.json'), v2, 'the old file is kept before the first write at a higher version');
  fs.write('.backups/2026-10-25/notes/pages.v3.json', 'kept by hand');
  await s.put('notes', 'pages', envelope([], { version: 4, rev: 2 }));
  assert.equal(fs.read('.backups/2026-10-25/notes/pages.v3.json'), 'kept by hand', 'an existing backup is not overwritten');
  assert.ok(!fs.paths().some(p => /^notes\/pages\.v\d/.test(p)), 'no version copies next to the collection');
});

test('names: bad names and bad envelopes are refused before anything is written', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  for (const name of ['Pages', '../x', 'a//b', 'a/b/c/d/e', '-x', '']) {
    assert.equal(await codeOf(s.get('notes', name)), 'bad_request', name);
    assert.equal(await codeOf(s.put('notes', name, envelope([]))), 'bad_request', name);
  }
  assert.equal(await codeOf(s.get('Notes', 'pages')), 'bad_request');
  assert.equal(await codeOf(s.get('1notes', 'pages')), 'bad_request', 'app ids start with a letter');
  assert.equal(await codeOf(s.put('notes', 'pages', envelope([], { schema: 'notes.other' }))), 'bad_request');
  assert.equal(await codeOf(s.put('notes', 'pages', envelope([{ id: 'a' }, { id: 'a' }]))), 'bad_request');
  assert.equal(await codeOf(s.put('notes', 'pages', envelope([], { version: 0 }))), 'bad_request');
  assert.equal(fs.writes, 0);
  assert.deepEqual(fs.paths(), []);
});

test('nested names: subfolders, digits first, listed with their full name', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  const env = { schema: 'receipts.entries/jordan-lee/2026', version: 1, rev: 0, items: [{ id: 'e1', updatedAt: 1 }] };
  await s.put('receipts', 'entries/jordan-lee/2026', env);
  await s.put('receipts', 'config', { schema: 'receipts.config', version: 1, rev: 0, items: [] });
  assert.ok(fs.exists('receipts/entries/jordan-lee/2026.json'));
  assert.equal((await s.get('receipts', 'entries/jordan-lee/2026')).rev, 1);
  fs.write('receipts/entries/jordan-lee/notes.md', '# not a collection');
  fs.write('receipts/.git/config.json', '{}');
  const listed = await s.list('receipts');
  assert.deepEqual(listed.collections.map(c => c.collection), ['config', 'entries/jordan-lee/2026']);
  const all = await s.allCollections();
  assert.deepEqual(all.map(r => `${r.app}/${r.collection}`), ['receipts/config', 'receipts/entries/jordan-lee/2026']);
});

test('a damaged collection file is never written over', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  fs.write('notes/pages.json', '{not json');
  assert.equal(await codeOf(s.get('notes', 'pages')), 'internal');
  assert.equal(await codeOf(s.put('notes', 'pages', envelope([]))), 'internal');
  fs.write('notes/other.json', JSON.stringify({ schema: 'notes.wrong', version: 1, rev: 1, items: [] }));
  assert.equal(await codeOf(s.put('notes', 'other', { schema: 'notes.other', version: 1, rev: 0, items: [] })), 'internal');
  assert.equal(fs.read('notes/pages.json'), '{not json');
  assert.equal(JSON.parse(fs.read('notes/other.json')).schema, 'notes.wrong');
  assert.deepEqual((await s.list('notes')).collections, [], 'damaged files are left out of the list');
});

test('lastModified: a change between the read and the write starts over, so nothing is lost', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  // Another program (the agent, a tab on another origin) saves right after this write reads the file.
  let raced = false;
  fs.onGetFile = (path) => {
    if (path !== 'notes/pages.json' || raced) return;
    raced = true;
    const theirs = JSON.parse(fs.read(path));
    fs.write(path, JSON.stringify({ ...theirs, rev: theirs.rev + 1, items: [...theirs.items, { id: 'theirs', updatedAt: 5 }] }, null, 2) + '\n');
  };
  const writesBefore = fs.writes;
  const err = await s.put('notes', 'pages', envelope([{ id: 'mine', updatedAt: 9 }], { rev: 1 })).catch(e => e);
  assert.equal(err.code, 'conflict', 'starts over, sees the new rev, and reports a normal conflict');
  assert.equal(err.current.rev, 2);
  assert.equal(fs.writes, writesBefore, 'nothing was written over their change');
  assert.ok(JSON.parse(fs.read('notes/pages.json')).items.some(i => i.id === 'theirs'));
});

test('lastModified: a change that keeps rev also restarts, and the write then lands', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  let reads = 0;
  fs.onGetFile = (path) => { if (path === 'notes/pages.json' && ++reads === 1) fs.write(path, fs.read(path)); };
  const res = await s.put('notes', 'pages', envelope([{ id: 'b', updatedAt: 2 }], { rev: 1 }));
  assert.equal(res.rev, 2);
  assert.ok(reads >= 3, 'read, re-check (changed), then read and re-check again');
});

test('files: create, read, replace with mtime, and every kind of conflict', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  const made = await s.files.write('receipts', 'summaries/jordan-lee/2026-h2.md', '# Jordan\n', { create: true });
  assert.deepEqual(Object.keys(made).sort(), ['app', 'mtime', 'path', 'size']);
  assert.equal(made.size, 9);
  assert.equal(fs.read('receipts/summaries/jordan-lee/2026-h2.md'), '# Jordan\n');
  const read = await s.files.read('receipts', 'summaries/jordan-lee/2026-h2.md');
  assert.deepEqual(read, { app: 'receipts', path: 'summaries/jordan-lee/2026-h2.md', mtime: made.mtime, size: 9, content: '# Jordan\n' });
  assert.equal(await s.files.read('receipts', 'summaries/none.md'), null);

  const again = await s.files.write('receipts', 'summaries/jordan-lee/2026-h2.md', '# Jordan Lee\n', { mtime: read.mtime });
  assert.ok(again.mtime !== read.mtime, 'a new mtime names the new version');

  const stale = await s.files.write('receipts', 'summaries/jordan-lee/2026-h2.md', 'x', { mtime: read.mtime }).catch(e => e);
  assert.equal(stale.code, 'conflict');
  assert.equal(stale.current.content, '# Jordan Lee\n');
  assert.equal(stale.current.mtime, again.mtime);
  const exists = await s.files.write('receipts', 'summaries/jordan-lee/2026-h2.md', 'x', { create: true }).catch(e => e);
  assert.equal(exists.code, 'conflict');
  assert.equal(exists.current.mtime, again.mtime);
  const gone = await s.files.write('receipts', 'summaries/gone.md', 'x', { mtime: 5 }).catch(e => e);
  assert.equal(gone.code, 'conflict');
  assert.equal(gone.current, null);
});

test('files: what may be written, and what the files API never touches', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  assert.equal(await codeOf(s.files.write('receipts', 'notes.txt', 'x', { create: true })), 'bad_request');
  assert.equal(await codeOf(s.files.write('receipts', 'a.json', '{bad', { create: true })), 'bad_request');
  assert.equal(await codeOf(s.files.write('receipts', 'config.json', JSON.stringify({ schema: 'receipts.config', version: 1, rev: 0, items: [] }), { create: true })), 'bad_request');
  assert.equal(await codeOf(s.files.write('receipts', 'a.md', 'x', {})), 'bad_request', 'needs mtime or create');
  assert.equal(await codeOf(s.files.write('receipts', 'a.md', 'x', { create: true, mtime: 1 })), 'bad_request');
  assert.equal(await codeOf(s.files.write('receipts', 'a/b/c/d/e.md', 'x', { create: true })), 'bad_request');
  assert.equal(await codeOf(s.files.write('receipts', 'big.md', 'x'.repeat(10 * 1024 * 1024 + 1), { create: true })), 'too_large');
  assert.equal(fs.writes, 0);

  await s.put('receipts', 'summaries/jordan-lee/2026-h2', { schema: 'receipts.summaries/jordan-lee/2026-h2', version: 1, rev: 0, items: [] });
  await s.files.write('receipts', 'summaries/jordan-lee/2026-h2.md', '# H2', { create: true });
  await s.files.write('receipts', 'a.json', '{"plain": true}', { create: true });
  fs.write('receipts/Notes.md', 'bad name');
  fs.write('receipts/.obsidian/x.md', 'dot folder');
  fs.write('receipts/a/b/c/d/deep.md', 'too deep');
  fs.write('receipts/readme.txt', 'other extension');
  const listed = await s.files.list('receipts');
  assert.deepEqual(listed.map(f => f.path), ['a.json', 'summaries/jordan-lee/2026-h2.md'], 'sorted, collections and ignored names left out');
  assert.deepEqual((await s.files.list('receipts', 'summaries')).map(f => f.path), ['summaries/jordan-lee/2026-h2.md']);
  assert.deepEqual(await s.files.list('receipts', 'nothing'), []);
  assert.deepEqual(await s.files.list('nobody'), []);
  assert.equal(await codeOf(s.files.read('receipts', 'summaries/jordan-lee/2026-h2.json')), 'bad_request', 'a collection is not a file');
  fs.write('receipts/huge.md', 'x'.repeat(10 * 1024 * 1024 + 1));
  assert.equal(await codeOf(s.files.read('receipts', 'huge.md')), 'too_large');
  assert.ok((await s.files.list('receipts')).some(f => f.path === 'huge.md'), 'a file too large to read is still listed');
});

test('files: trash moves the file, never removes it', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  const a = await s.files.write('receipts', 'summaries/jordan-lee/2026-h1.md', 'first', { create: true });
  assert.equal(await codeOf(s.files.trash('receipts', 'summaries/jordan-lee/2026-h1.md', { mtime: a.mtime - 1 })), 'conflict');
  const t1 = await s.files.trash('receipts', 'summaries/jordan-lee/2026-h1.md', { mtime: a.mtime });
  assert.deepEqual(t1, { app: 'receipts', path: 'summaries/jordan-lee/2026-h1.md', trash: '.trash/receipts/summaries/jordan-lee/2026-h1.20261025T140500123Z.md' });
  assert.equal(fs.read(t1.trash), 'first');
  assert.equal(fs.exists('receipts/summaries/jordan-lee/2026-h1.md'), false);
  await s.files.write('receipts', 'summaries/jordan-lee/2026-h1.md', 'second', { create: true });
  const t2 = await s.files.trash('receipts', 'summaries/jordan-lee/2026-h1.md');
  assert.equal(t2.trash, '.trash/receipts/summaries/jordan-lee/2026-h1.20261025T140500123Z-1.md', 'a taken name gets -1');
  assert.equal(fs.read(t2.trash), 'second');
  assert.equal(fs.read(t1.trash), 'first');
  assert.equal(await codeOf(s.files.trash('receipts', 'summaries/jordan-lee/2026-h1.md')), 'not_found');
  assert.deepEqual(await s.files.list('receipts'), [], 'the trash is not listed');
});

test('files: a file system that keeps the old modified time is written again until the mtime differs', async () => {
  const fs = new FakeFolder('Workshop', { step: 0 });
  const waits = [];
  const s = store(fs, 'w-a', { sleep: async (ms) => { waits.push(ms); if (waits.length === 2) fs.step = 1; } });
  const a = await s.files.write('notes', 'a.md', 'one', { create: true });
  const b = await s.files.write('notes', 'a.md', 'two', { mtime: a.mtime });
  assert.notEqual(b.mtime, a.mtime);
  assert.deepEqual(waits, [2, 20]);
  assert.equal(fs.read('notes/a.md'), 'two');
});

test('events: other tabs hear writes over the channel, the writer does not', async () => {
  const fs = new FakeFolder();
  const make = bus();
  const a = store(fs, 'w-a', { channel: make() }), b = store(fs, 'w-b', { channel: make() });
  const heardB = [], heardA = [], filesB = [];
  b.subscribe('notes', 'pages', e => heardB.push(e));
  a.subscribe('notes', 'pages', e => heardA.push(e));
  b.files.subscribe('notes', 'summaries', e => filesB.push(e));
  await a.put('notes', 'pages', envelope([{ id: 'x', updatedAt: 1 }]));
  const f = await a.files.write('notes', 'summaries/q4.md', '# Q4', { create: true });
  await a.files.write('notes', 'elsewhere.md', 'not in summaries', { create: true });
  await tick();
  assert.deepEqual(heardB.map(e => [e.app, e.collection, e.rev, e.client]), [['notes', 'pages', 1, 'w-a']]);
  assert.equal(typeof heardB[0].updatedAt, 'string');
  assert.deepEqual(heardA, []);
  assert.deepEqual(filesB, [{ app: 'notes', path: 'summaries/q4.md', mtime: f.mtime, client: 'w-a' }]);
  await a.files.trash('notes', 'summaries/q4.md');
  await tick();
  assert.deepEqual(filesB.at(-1), { app: 'notes', path: 'summaries/q4.md', mtime: null, client: 'w-a' });
  // b checks for outside changes: these were tab writes it already heard about.
  await tick();
  const before = heardB.length + filesB.length;
  await b.poll();
  assert.equal(heardB.length + filesB.length, before, 'no second report for writes heard over the channel');
});

test('events: changes made outside Workshop are found by lastModified and say "re-read"', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('notes', 'pages', envelope([{ id: 'x', updatedAt: 1 }]));
  await s.files.write('notes', 'summaries/q4.md', '# Q4', { create: true });
  const heard = [], files = [], single = [];
  s.subscribe('notes', 'pages', e => heard.push(e));
  s.files.subscribe('notes', 'summaries', e => files.push(e));
  s.files.subscribe('notes', 'summaries/q4.md', e => single.push(e));
  await tick();
  await s.poll();
  assert.deepEqual([heard, files, single], [[], [], []], 'nothing changed yet');

  // The writer's own saves are not reported.
  const cur = await s.get('notes', 'pages');
  await s.put('notes', 'pages', { ...cur, items: [] });
  await s.poll();
  assert.deepEqual(heard, []);

  fs.write('notes/pages.json', JSON.stringify({ ...JSON.parse(fs.read('notes/pages.json')), rev: 3 }));
  fs.write('notes/summaries/q4.md', '# Q4, edited in another editor');
  fs.write('notes/summaries/new.md', 'added');
  await s.poll();
  assert.deepEqual(heard, [{ app: 'notes', collection: 'pages', rev: null, updatedAt: null, client: null }]);
  assert.deepEqual(files.map(e => [e.path, typeof e.mtime, e.client]), [['summaries/new.md', 'number', null], ['summaries/q4.md', 'number', null]]);
  assert.equal(single.length, 1);
  fs.delete('notes/summaries/new.md');
  await s.poll();
  assert.deepEqual(files.at(-1), { app: 'notes', path: 'summaries/new.md', mtime: null, client: null });
  await s.poll();
  assert.equal(files.length, 3, 'each change is reported once');
});

test('access: without permission calls say unavailable; allow() brings it back and tells other tabs', async () => {
  const fs = new FakeFolder();
  fs.permission = 'prompt';
  const make = bus();
  const a = store(fs, 'w-a', { channel: make(), permission: 'prompt' });
  const b = store(fs, 'w-b', { channel: make(), permission: 'prompt' });
  assert.equal(a.online, false);
  assert.equal(a.permission, 'prompt');
  assert.equal(await codeOf(a.get('notes', 'pages')), 'unavailable');
  assert.equal(await codeOf(a.files.list('notes')), 'unavailable');
  const onlineA = [], onlineB = [];
  a.onOnline(e => onlineA.push(e.online));
  b.onOnline(e => onlineB.push(e.online));

  fs.requestAnswer = 'denied';
  assert.equal(await a.allow(), false);
  assert.equal(a.permission, 'denied');
  fs.requestAnswer = 'granted';
  assert.equal(await a.allow(), true);
  await tick(); await tick();
  assert.deepEqual(onlineA, [true]);
  assert.deepEqual(onlineB, [true], 'the other tab rechecked when it heard the folder was allowed');
  assert.equal((await b.put('notes', 'pages', envelope([]))).rev, 1);

  // Chrome takes the permission away while the page is open.
  fs.permission = 'prompt';
  assert.equal(await codeOf(b.put('notes', 'pages', envelope([], { rev: 1 }))), 'unavailable');
  assert.equal(b.online, false);
  assert.deepEqual(onlineB, [true, false]);
  // The 5-second check notices when it comes back (for example the Allow button in another frame).
  fs.permission = 'granted';
  await b.poll();
  assert.equal(b.online, true);
});

test('access: a folder that is gone is reported, never replaced by browser storage', async () => {
  const fs = new FakeFolder();
  const s = store(fs);
  await s.put('notes', 'pages', envelope([]));
  fs.remove();
  assert.equal(await codeOf(s.get('notes', 'pages')), 'unavailable');
  assert.equal(s.missing, true);
  assert.equal(s.online, false);
  const opened = await openBrowserStore({ clientId: 'w-x' }, { handle: fs.root, folder: { timers: false, channel: null } });
  assert.equal(opened.storage, 'folder');
  assert.equal(opened.missing, true);
});

test('openBrowserStore: a saved handle that needs asking again is the folder store, offline until allowed', async () => {
  const fs = new FakeFolder('MyWorkshop');
  fs.permission = 'prompt';
  const s = await openBrowserStore({ clientId: 'w-x' }, { handle: fs.root, folder: { timers: false, channel: null } });
  assert.equal(s.storage, 'folder');
  assert.equal(s.name, 'MyWorkshop');
  assert.equal(s.permission, 'prompt');
  assert.equal(s.online, false);
});

// An IndexedDB store as moveIntoFolder sees it, in memory.
function memorySource(collections, files) {
  const src = { mark: null, collections: async () => structuredClone(collections), files: async () => structuredClone(files), moved: async () => src.mark, markMoved: async (m) => { src.mark = m; } };
  return src;
}

test('moving from IndexedDB: collections created or merged, files kept side by side, the old copy marked moved', async () => {
  const fs = new FakeFolder('Workshop');
  const target = store(fs);
  // Already in the folder: tasks (to merge), lists at another version, and a summary that differs.
  await target.put('prioritizer', 'tasks', { schema: 'prioritizer.tasks', version: 3, rev: 0, items: [{ id: 't1', updatedAt: 10, title: 'Folder copy' }, { id: 't2', updatedAt: 10, title: 'Only in folder' }] });
  await target.put('prioritizer', 'lists', { schema: 'prioritizer.lists', version: 2, rev: 0, items: [] });
  await target.files.write('receipts', 'summaries/jl/2026-h2.md', 'folder text', { create: true });
  await target.files.write('receipts', 'summaries/jl/2026-h2-from-browser.md', 'an older move', { create: true });
  await target.files.write('receipts', 'same.md', 'same', { create: true });

  const collections = [
    { app: 'prioritizer', collection: 'tasks', envelope: { schema: 'prioritizer.tasks', version: 3, rev: 7, updatedAt: 'x', items: [{ id: 't1', updatedAt: 20, title: 'Browser copy, newer' }, { id: 't3', updatedAt: 5, title: 'Only in browser' }], deleted: {} } },
    { app: 'prioritizer', collection: 'lists', envelope: { schema: 'prioritizer.lists', version: 1, rev: 2, items: [] } },
    { app: 'receipts', collection: 'entries/jl/2026', envelope: { schema: 'receipts.entries/jl/2026', version: 1, rev: 4, items: [{ id: 'e1', updatedAt: 1 }] } }
  ];
  const files = [
    { app: 'receipts', path: 'summaries/jl/2026-h2.md', content: 'browser text' },
    { app: 'receipts', path: 'same.md', content: 'same' },
    { app: 'receipts', path: 'new.md', content: 'new' }
  ];
  const source = memorySource(collections, files);
  const summary = await moveIntoFolder({ source, target, folderName: 'Workshop', now: () => Date.UTC(2026, 9, 25) });

  assert.deepEqual(summary.collections.created, ['receipts/entries/jl/2026']);
  assert.deepEqual(summary.collections.merged, ['prioritizer/tasks']);
  assert.equal(summary.collections.skipped.length, 1);
  assert.equal(summary.collections.skipped[0].name, 'prioritizer/lists');
  assert.deepEqual(summary.files.created, ['receipts/new.md']);
  assert.deepEqual(summary.files.same, ['receipts/same.md']);
  assert.deepEqual(summary.files.renamed, [{ from: 'receipts/summaries/jl/2026-h2.md', to: 'receipts/summaries/jl/2026-h2-from-browser-2.md' }]);

  const tasks = await target.get('prioritizer', 'tasks');
  assert.deepEqual(tasks.items.map(i => [i.id, i.title]).sort(), [['t1', 'Browser copy, newer'], ['t2', 'Only in folder'], ['t3', 'Only in browser']]);
  assert.equal(tasks.rev, 2, 'merged and put on top of the folder copy');
  assert.equal((await target.get('receipts', 'entries/jl/2026')).rev, 1, 'created fresh in the folder');
  assert.equal(fs.read('receipts/summaries/jl/2026-h2.md'), 'folder text', 'the folder copy is kept');
  assert.equal(fs.read('receipts/summaries/jl/2026-h2-from-browser-2.md'), 'browser text');
  assert.equal((await target.get('prioritizer', 'lists')).version, 2, 'a different version is left alone');

  assert.deepEqual(source.mark, { movedTo: 'Workshop', movedAt: '2026-10-25T00:00:00.000Z' });
  assert.deepEqual(await source.collections(), collections, 'the browser copy is unchanged');
  assert.deepEqual(await source.files(), files);

  const writes = fs.writes;
  const again = await moveIntoFolder({ source, target, folderName: 'Workshop' });
  assert.equal(again.alreadyMoved, true);
  assert.equal(fs.writes, writes, 'a store marked moved is never copied again');
});

test('moving from IndexedDB: a long file name still fits the name rules', async () => {
  const fs = new FakeFolder();
  const target = store(fs);
  const long = 'a'.repeat(40);
  await target.files.write('notes', `${long}.md`, 'folder', { create: true });
  const summary = await moveIntoFolder({ source: memorySource([], [{ app: 'notes', path: `${long}.md`, content: 'browser' }]), target, folderName: 'W' });
  const to = summary.files.renamed[0].to.split('/')[1];
  assert.match(to, /^a+-from-browser\.md$/);
  assert.equal(to.length, 40 + 3);
});

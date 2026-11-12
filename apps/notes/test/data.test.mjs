// Notes: loading, saving, conflicts, outside changes and images through the SDK (apps/notes/js/data.js),
// against the SDK's folder store on an in-memory folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals } from '../../../shared/workshop-sdk.js';
import { FakeFolder } from '../../../shared/test/fake-dir.mjs';
import { createNotes } from '../js/data.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

// A tiny ws: ws.files over the SDK folder store, the way connect() wires it.
function wsOver(fs, client = 'w-a') {
  const s = _internals.makeFolderStore({ clientId: client }, fs.root, { timers: false, channel: null });
  const handlers = [];
  return {
    store: s,
    fire: (ev) => handlers.forEach(h => h(ev)),
    files: {
      list: (folder, o) => s.files.list((o && o.app) || 'notes', folder),
      read: (path, o) => s.files.read((o && o.app) || 'notes', path),
      write: (path, content, o) => s.files.write('notes', path, content, o),
      trash: (path, o) => s.files.trash('notes', path, o),
      subscribe: (_t, h) => { handlers.push(h); return () => {}; }
    }
  };
}

test('load reads every note and builds the index; other files are known but not read', async () => {
  const fs = new FakeFolder();
  fs.write('notes/a.md', '# A\n\nSee [b](b.md) #x');
  fs.write('notes/b.md', '# B');
  fs.write('notes/attachments/i.png', PNG);
  fs.write('notes/Bad Name.md', 'ignored');
  const n = createNotes(wsOver(fs));
  await n.load();
  assert.equal(n.loaded, true);
  assert.deepEqual([...n.texts.keys()].sort(), ['a.md', 'b.md']);
  assert.ok(n.files.has('attachments/i.png'));
  assert.deepEqual(n.index.backlinks.get('b.md'), [{ from: 'a.md', line: 2 }]);
  assert.deepEqual([...n.index.tags.keys()], ['x']);
});

test('save writes with the mtime read; a stale save is a conflict and writes nothing', async () => {
  const fs = new FakeFolder();
  const n = createNotes(wsOver(fs));
  await n.load();
  const made = await n.create('plan.md', '# Plan\n');
  const saved = await n.save('plan.md', '# Plan\n\nmore', made.mtime);
  assert.equal(fs.read('notes/plan.md'), '# Plan\n\nmore');
  const err = await n.save('plan.md', 'stale', made.mtime).catch(e => e);
  assert.equal(err.code, 'conflict');
  assert.equal(err.current.mtime, saved.mtime);
  assert.equal(fs.read('notes/plan.md'), '# Plan\n\nmore');
});

test('changes made elsewhere are read again and the index follows', async () => {
  const fs = new FakeFolder();
  const ws = wsOver(fs);
  const seen = [];
  const n = createNotes(ws, { onExternal: (e) => seen.push(e) });
  await n.load();
  fs.write('notes/new.md', '# New #tagged');
  ws.fire({ app: 'notes', path: 'new.md', mtime: fs.mtime('notes/new.md'), client: null });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(n.index.notes.get('new.md').title, 'New #tagged');
  fs.delete('notes/new.md');
  ws.fire({ app: 'notes', path: 'new.md', mtime: null, client: null });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(n.index.notes.has('new.md'), false);
  assert.deepEqual(seen, [{ path: 'new.md', gone: false }, { path: 'new.md', gone: true }]);
});

test('images: pasted images go to attachments/ with a unique name; SVG and others are refused', async () => {
  const fs = new FakeFolder();
  const n = createNotes(wsOver(fs));
  await n.load();
  const now = new Date(Date.UTC(2026, 10, 3, 9, 30, 15));
  const p1 = await n.addImage(new Blob([PNG], { type: 'image/png' }), 'Screen Shot.png', now);
  assert.equal(p1, 'attachments/screen-shot-20261103-093015.png');
  const p2 = await n.addImage(new Blob([PNG], { type: 'image/png' }), 'Screen Shot.png', now);
  assert.equal(p2, 'attachments/screen-shot-20261103-093015-2.png');
  assert.deepEqual(fs.read(`notes/${p1}`), PNG);
  const svg = await n.addImage(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg').catch(e => e);
  assert.equal(svg.code, 'bad_request');
  assert.match(await n.imageUrl(p1), /^blob:/);
  assert.equal(await n.imageUrl('attachments/none.png'), null);
});

test('trash moves the note to the trash and out of the index', async () => {
  const fs = new FakeFolder();
  fs.write('notes/old.md', '# Old');
  const n = createNotes(wsOver(fs));
  await n.load();
  const t = await n.trash('old.md');
  assert.match(t.trash, /^\.trash\/notes\/old\.\d{8}T\d{9}Z\.md$/);
  assert.equal(n.index.notes.has('old.md'), false);
  assert.equal(fs.exists('notes/old.md'), false);
});

test('other apps: Notes never lists or reads their files (Rapport 1:1 notes stay in Rapport)', async () => {
  const fs = new FakeFolder();
  fs.write('notes/a.md', '# A');
  fs.write('receipts/oneonones/notes/person-one.md', '# 1:1 with a report');
  const ws = wsOver(fs);
  const asked = [];
  const { list, read } = ws.files;
  ws.files.list = (folder, o) => { asked.push(['list', o && o.app]); return list(folder, o); };
  ws.files.read = (path, o) => { asked.push(['read', o && o.app]); return read(path, o); };
  const n = createNotes(ws);
  await n.load();
  assert.deepEqual([...n.texts.keys()], ['a.md']);
  assert.equal(asked.some(([, app]) => app && app !== 'notes'), false);
  assert.equal('loadOthers' in n || 'readOther' in n || 'others' in n, false);
});

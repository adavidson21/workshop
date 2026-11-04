import test from 'node:test';
import assert from 'node:assert/strict';
import { data as sdkData } from '../../../shared/workshop-sdk.js';
import { SENDERS, acceptedNotes, noteFile, startPickup } from '../js/pickup.js';

const H = { id: 'c_1', updatedAt: 1, to: 'notes', date: '2026-11-03', createdAt: '2026-11-03T22:00:00Z', text: 'retro ideas. More async standups',
  payload: { kind: 'note', title: 'Retro ideas' }, source: { app: 'home', id: 'c_1' }, accepted: true };
const env = (app, items) => ({ schema: `${app}.handoffs`, version: 1, rev: 1, items, deleted: {} });

test('only accepted note offers for Notes, not yet taken', () => {
  assert.deepEqual(Object.keys(SENDERS), ['home', 'agents']);
  const items = [H, { ...H, id: 'c_2', accepted: false }, { ...H, id: 'c_3', to: 'receipts' }, { ...H, id: 'c_4', payload: { kind: 'task' } }];
  assert.deepEqual(acceptedNotes('home', env('home', items)).map(o => o.id), ['c_1']);
  assert.deepEqual(acceptedNotes('home', env('home', items), new Set(['home:c_1'])), []);
  assert.deepEqual(acceptedNotes('home', env('agents', items)), [], 'the schema must name the sender');
  assert.deepEqual(acceptedNotes('home', { ...env('home', items), version: 2 }), []);
  assert.equal(acceptedNotes('home', env('home', [{ ...H, payload: { kind: 'note' }, text: 'First line\nsecond' }]))[0].title, 'First line');
});

test('noteFile: a free path in inbox/ and a note with where it came from', () => {
  const [o] = acceptedNotes('home', env('home', [H]));
  const f = noteFile(o, new Set(['inbox/retro-ideas.md']));
  assert.equal(f.path, 'inbox/retro-ideas-2.md');
  assert.match(f.content, /^# Retro ideas\n\nretro ideas\. More async standups\n\nCaptured in Home on 2026-11-03\.\n$/);
});

test('startPickup writes each capture once and records it in notes.taken', async () => {
  const files = new Map(), cols = new Map();
  cols.set('home/handoffs', env('home', [H, { ...H, id: 'c_9', payload: { kind: 'note', title: '<b>x</b>' }, text: '<b>x</b>' }]));
  const ws = {
    data: {
      stamp: sdkData.stamp, merge: sdkData.merge,
      async get(name, o = {}) { const v = cols.get(`${o.app || 'notes'}/${name}`); return v ? structuredClone(v) : null; },
      async put(name, e) { cols.set(`notes/${name}`, { ...structuredClone(e), rev: (e.rev || 0) + 1 }); return { rev: e.rev + 1 }; },
      subscribe() {}
    },
    files: { async write(path, content, o) { if (o.create && files.has(path)) { const e = new Error('c'); e.code = 'conflict'; throw e; } files.set(path, content); return {}; } }
  };
  const added = [];
  const p = startPickup(ws, { files: new Map() }, { onAdded: w => added.push(...w) });
  assert.equal(await p.run(), 2);
  assert.deepEqual([...files.keys()].sort(), ['inbox/b-x-b.md', 'inbox/retro-ideas.md']);
  assert.deepEqual(cols.get('notes/taken').items.map(i => i.id).sort(), ['home:c_1', 'home:c_9']);
  assert.equal(await p.run(), 0, 'never twice');
  files.clear();
  assert.equal(await p.run(), 0, 'a deleted note does not come back');
});

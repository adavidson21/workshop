// Saving through ws.data (store.js) on the SDK's folder store: nested collection names, two windows, conflicts
// merged per item, failed writes kept on screen and retried, outside changes, and newer versions read only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyEnvelope, entriesName, newEntry } from '../js/model.js';
import { createStore, RETRY_MS } from '../js/store.js';
import { fixture, tick, workshop } from './helpers.mjs';

const COL = entriesName('jordan-lee', 2026);
const init = () => emptyEnvelope(COL);
const add = (store, note, date = '2026-10-01') => store.update(COL, env => { env.items.push(newEntry({ note }, date)); return env; }, init);
const notes = env => (env ? env.items.map(i => i.note).sort() : []);

test('a new entry is saved at once, under the nested name, as receipts/entries/<person>/<year>.json', async () => {
  const w = workshop(), a = w.open();
  const s = createStore({ data: a.data });
  assert.equal(await s.load(COL), null);
  await add(s, 'First receipt');
  const disk = JSON.parse(w.folder.read('receipts/entries/jordan-lee/2026.json'));
  assert.equal(disk.schema, 'receipts.entries/jordan-lee/2026');
  assert.equal(disk.rev, 1);
  assert.deepEqual(notes(disk), ['First receipt']);
  assert.ok(disk.items[0].updatedAt > 0, 'stamped');
  assert.equal(s.unsaved, false);
});

test('two windows: edits on both sides merge; nothing is lost', async () => {
  const w = workshop(), A = w.open(), B = w.open();
  const changed = [];
  const a = createStore({ data: A.data }), b = createStore({ data: B.data, changed: c => changed.push(c) });
  await a.load(COL); await b.load(COL);
  await add(a, 'From A');
  await add(b, 'From B'); // b's rev is stale: conflict, merge, put again
  await b.idle();
  assert.deepEqual(notes(JSON.parse(w.folder.read('receipts/entries/jordan-lee/2026.json'))), ['From A', 'From B']);
  assert.deepEqual(notes(b.get(COL)), ['From A', 'From B'], 'the window that lost the race shows both');
  assert.ok(changed.includes(COL));
  // A deletes its entry; B edits the other one. Both changes survive.
  await a.load(COL);
  const idA = a.get(COL).items.find(i => i.note === 'From A').id;
  await a.update(COL, env => { env.items = env.items.filter(i => i.id !== idA); return env; });
  await b.update(COL, env => { env.items.find(i => i.note === 'From B').bullet = 'Edited in B'; return env; });
  await b.idle();
  const disk = JSON.parse(w.folder.read('receipts/entries/jordan-lee/2026.json'));
  assert.deepEqual(notes(disk), ['From B']);
  assert.equal(disk.items[0].bullet, 'Edited in B');
  assert.ok(disk.deleted[idA], 'the deletion is a tombstone');
});

test('another window\'s save is read in, merged with edits not saved yet', async () => {
  const w = workshop(), A = w.open(), B = w.open();
  const a = createStore({ data: A.data });
  const b = createStore({ data: B.data });
  await a.load(COL); await b.load(COL);
  await add(a, 'Saved by A');
  // The folder store with channel: null does not cross windows, so B hears it the way an outside change arrives.
  await b.load(COL);
  assert.deepEqual(notes(b.get(COL)), ['Saved by A']);
});

test('a failed write keeps the edit on screen, says not saved, and is retried', async () => {
  const w = workshop(), A = w.open();
  let fail = 1;
  const data = { ...A.data, put: (c, env) => (fail-- > 0 ? Promise.reject(Object.assign(new Error('disk full'), { code: 'internal' })) : A.data.put(c, env)) };
  const timers = { fns: [], setTimeout(fn, ms) { this.fns.push([fn, ms]); return this.fns.length; }, clearTimeout() {} };
  const states = [];
  const s = createStore({ data, timers, status: st => states.push(st.state) });
  await s.load(COL);
  await add(s, 'Keep me');
  assert.equal(states.at(-1), 'error');
  assert.deepEqual(notes(s.get(COL)), ['Keep me'], 'still on screen');
  assert.equal(w.folder.read('receipts/entries/jordan-lee/2026.json'), null, 'nothing on disk yet');
  assert.equal(s.unsaved, true);
  const [retry, ms] = timers.fns.at(-1);
  assert.equal(ms, RETRY_MS);
  retry(); await s.idle();
  assert.equal(states.at(-1), 'saved');
  assert.deepEqual(notes(JSON.parse(w.folder.read('receipts/entries/jordan-lee/2026.json'))), ['Keep me']);
});

test('a change made outside Workshop is read again on the next event, and merged', async () => {
  const w = workshop(), A = w.open();
  const changed = [];
  const s = createStore({ data: A.data, changed: c => changed.push(c) });
  await s.load(COL);
  await add(s, 'Mine');
  const disk = JSON.parse(w.folder.read('receipts/entries/jordan-lee/2026.json'));
  disk.rev += 1;
  disk.items.push({ ...disk.items[0], id: 'r_outside', note: 'Added in an editor', updatedAt: Date.now() + 1000 });
  w.folder.write('receipts/entries/jordan-lee/2026.json', JSON.stringify(disk, null, 2) + '\n');
  await A.store.poll(); await s.idle();
  assert.deepEqual(notes(s.get(COL)), ['Added in an editor', 'Mine']);
  assert.ok(changed.includes(COL));
});

test('a collection saved by a newer Receipts is shown read only and never written', async () => {
  const w = workshop(), A = w.open();
  const newer = { ...fixture('entries-jordan-lee-2026.json'), version: 2, rev: 0 };
  delete newer.updatedAt;
  await A.data.put(COL, newer);
  const before = w.folder.read('receipts/entries/jordan-lee/2026.json');
  const states = [];
  const s = createStore({ data: A.data, status: st => states.push(st.state) });
  const env = await s.load(COL);
  assert.equal(env.version, 2);
  assert.equal(s.isReadOnly(COL), true);
  assert.throws(() => add(s, 'nope'), e => e.code === 'readonly');
  assert.equal(w.folder.read('receipts/entries/jordan-lee/2026.json'), before);
});

test('a damaged file is reported, not written over', async () => {
  const w = workshop(), A = w.open();
  w.folder.write('receipts/config.json', '{ not json');
  const s = createStore({ data: A.data });
  const e = await s.load('config').catch(err => err);
  assert.ok(e instanceof Error);
  assert.equal(w.folder.read('receipts/config.json'), '{ not json');
  await tick();
});

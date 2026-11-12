// Saving through the SDK: the write loop, merging with another window, failed writes, the list, Markdown files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { blankDoc, cleanItem } from '../js/model.js';
import { SchemaSet } from './workshop/schema.mjs';
import { fakeWs } from './fake.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const workshop = SchemaSet.fromDir(join(HERE, 'workshop', 'schemas'));
const runway = SchemaSet.fromDir(join(HERE, '..', 'schemas'));
const make = (ws, o = {}) => createStore(ws, { debounceMs: 1, retryMs: 20, ...o });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const item = (id, extra = {}) => cleanItem({ id, kind: 'item', lane: null, order: 0, title: id, start: '2027-01-04', end: '2027-01-29', ...extra });

test('a new roadmap writes its map, the list and the last opened, in valid envelopes', async () => {
  const ws = fakeWs();
  const s = make(ws);
  await s.load();
  const doc = blankDoc('Q1 plan');
  doc.lanes.push({ id: 'l-1', kind: 'lane', title: 'Search', order: 0 });
  doc.items.push(item('i-1', { lane: 'l-1' }), { id: 't-1', kind: 'text', lane: null, order: 1, raw: 'loose words' });
  const id = await s.create(doc);
  const map = ws.store[`maps/${id}`];
  assert.equal(map.schema, `runway.maps/${id}`);
  assert.equal(map.version, 1);
  assert.deepEqual(workshop.validate('data-envelope', map), []);
  assert.deepEqual(runway.validate('map-meta', map.meta), []);
  for (const x of map.items) assert.deepEqual(runway.validate(`map-${x.kind}`, x), [], x.kind);
  assert.deepEqual(ws.store.index.items.map(x => [x.id, x.title]), [[id, 'Q1 plan']]);
  for (const x of ws.store.index.items) assert.deepEqual(runway.validate('index-item', x), []);
  assert.equal(ws.store.settings.meta.lastOpen, id);
  assert.deepEqual(workshop.validate('data-envelope', ws.store.index), []);
});

test('edits are stamped item by item, so two windows editing different items merge', async () => {
  const ws = fakeWs();
  const a = make(ws);
  await a.load();
  const doc = blankDoc('Shared');
  doc.items.push(item('i-1'), item('i-2'));
  const id = await a.create(doc);
  const b = make(ws);
  await b.load();
  await b.open(id);
  a.edit(d => { d.items[0].title = 'Changed in A'; });
  await a.flush();
  b.edit(d => { d.items[1].title = 'Changed in B'; });
  await b.flush();
  const titles = ws.store[`maps/${id}`].items.map(i => i.title).sort();
  assert.deepEqual(titles, ['Changed in A', 'Changed in B']);
  assert.deepEqual(b.v.doc.items.map(i => i.title).sort(), titles);
});

test('a title change renames the roadmap in the list', async () => {
  const ws = fakeWs();
  const s = make(ws);
  await s.load();
  const id = await s.create(blankDoc('Old'));
  s.edit(d => { d.meta.title = 'New name'; });
  await s.flush();
  assert.equal(ws.store.index.items.find(x => x.id === id).title, 'New name');
  assert.equal(ws.store[`maps/${id}`].meta.title, 'New name');
});

test('a failed write keeps the edit, says Not saved yet, and retries', async () => {
  const ws = fakeWs();
  const s = make(ws);
  await s.load();
  const id = await s.create(blankDoc('Retry'));
  ws.failNext = Object.assign(new Error('Disk is full'), { code: 'internal' });
  s.edit(d => { d.meta.title = 'Kept'; });
  await s.flush();
  assert.equal(s.v.save, 'unsaved');
  assert.equal(s.v.doc.meta.title, 'Kept');
  await sleep(60);
  await s.flush();
  assert.equal(s.v.save, 'saved');
  assert.equal(ws.store[`maps/${id}`].meta.title, 'Kept');
});

test('removing a roadmap takes it off the list and keeps its file', async () => {
  const ws = fakeWs();
  const s = make(ws);
  await s.load();
  const id = await s.create(blankDoc('Gone'));
  await s.remove(id);
  assert.equal(ws.store.index.items.length, 0);
  assert.ok(ws.store.index.deleted[id]);
  assert.ok(ws.store[`maps/${id}`]);
});

test('a roadmap saved by a newer Runway is read only', async () => {
  const ws = fakeWs({ stored: { 'maps/m-new': { schema: 'runway.maps/m-new', version: 2, rev: 3, items: [], meta: { updatedAt: 1, title: 'From the future' } } } });
  const s = make(ws);
  await s.load();
  assert.equal(await s.open('m-new'), true);
  assert.match(s.v.readOnly, /newer Runway/);
  assert.equal(s.edit(d => { d.meta.title = 'x'; }), false);
  await s.flush();
  assert.equal(ws.store['maps/m-new'].rev, 3);
});

test('an unknown roadmap id is reported, not created', async () => {
  const ws = fakeWs();
  const s = make(ws);
  await s.load();
  assert.equal(await s.open('m-nothing'), false);
  assert.equal(await s.open('Bad Id!'), false);
  assert.equal(ws.puts.length, 0);
});

test('waiting for folder access: nothing loads or saves until allowed', async () => {
  const ws = fakeWs({ backend: 'browser' });
  ws.allowed = false;
  const s = make(ws);
  await s.load();
  assert.equal(s.v.waiting, true);
  assert.equal(s.v.loaded, false);
  await assert.rejects(s.create(blankDoc()), { code: 'unavailable' });
});

test('a Markdown copy is saved as a file, and saved again over itself', async () => {
  const ws = fakeWs();
  const s = make(ws);
  await s.load();
  assert.equal(await s.saveMarkdown('m-1', '# One\n'), 'exports/m-1.md');
  await s.saveMarkdown('m-1', '# Two\n');
  assert.equal(ws._files['exports/m-1.md'].content, '# Two\n');
});

test('unknown fields on items and meta are kept', async () => {
  const id = 'm-keep';
  const ws = fakeWs({ stored: { [`maps/${id}`]: { schema: `runway.maps/${id}`, version: 1, rev: 1, items: [{ ...item('i-1'), updatedAt: 5, future: 'kept' }], deleted: {}, meta: { updatedAt: 5, title: 'Keep', scale: 'month', origin: '2027-01-01', sprint: null, range: null, hidden: [], later: 1 } } } });
  const s = make(ws);
  await s.load();
  await s.open(id);
  s.edit(d => { d.meta.title = 'Keep 2'; });
  await s.flush();
  const e = ws.store[`maps/${id}`];
  assert.equal(e.items[0].future, 'kept');
  assert.equal(e.meta.later, 1);
});

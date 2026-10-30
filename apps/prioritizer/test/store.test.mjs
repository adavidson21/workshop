// Prioritizer storage (WS5): the board as collections, and the save engine that keeps windows in step.
// Runs in Node against a fake data backend with the same rules as the agent and the browser backend
// (rev check, conflict with the stored envelope, change events to other clients). The real agent and
// browser are covered by tests/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { data as sdk } from '../../../shared/workshop-sdk.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import { COLLECTIONS, MAIN_LIST, VERSIONS, applyEnvelope, envelopeFromBoard, envelopesFromBundle, legacyToEnvelopes } from '../js/store-format.js';
import { createStore } from '../js/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const schemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));
const legacy = () => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'today-localstorage.json'), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const settle = () => new Promise(r => setTimeout(r, 15));

/* A data backend shared by several clients ("windows"): one store, events to everyone but the writer. */
function fakeBackend(){
  const files = {}, subs = [];
  let failures = 0;
  return {
    files,
    failNext(n = 1){ failures = n; },
    client(id){
      return {
        async get(col){ return files[col] ? clone(files[col]) : null; },
        async put(col, env){
          await null;
          if (failures > 0){ failures--; throw Object.assign(new Error('disk is full'), {code: 'internal'}); }
          assert.equal(env.schema, `prioritizer.${col}`);
          const errs = schemas.validate('data-envelope', env);
          assert.deepEqual(errs, [], `put ${col} is a valid envelope`);
          const stored = files[col], rev = stored ? stored.rev : 0;
          if ((env.rev || 0) !== rev){
            throw Object.assign(new Error('conflict'), {code: 'conflict', current: clone(stored || {schema: env.schema, version: env.version, rev: 0, updatedAt: new Date().toISOString(), items: [], deleted: {}})});
          }
          if (stored && env.version < stored.version) throw Object.assign(new Error('downgrade'), {code: 'downgrade'});
          const next = clone(env); next.rev = rev + 1; next.updatedAt = new Date().toISOString();
          files[col] = next;
          for (const s of subs) if (s.id !== id && s.col === col) setTimeout(() => s.fn({app: 'prioritizer', collection: col, rev: next.rev, client: id}), 1);
          return {rev: next.rev, updatedAt: next.updatedAt};
        },
        subscribe(col, fn){ const s = {id, col, fn}; subs.push(s); return () => subs.splice(subs.indexOf(s), 1); },
        merge: sdk.merge, stamp: sdk.stamp
      };
    }
  };
}

/* Timers the test runs by hand. */
function manualTimers(){
  const due = new Map(); let n = 0;
  return {
    setTimeout(fn){ due.set(++n, fn); return n; },
    clearTimeout(id){ due.delete(id); },
    run(){ const fns = [...due.values()]; due.clear(); fns.forEach(f => f()); },
    get count(){ return due.size; }
  };
}

const newBoard = () => ({lists: [{id: MAIN_LIST, name: 'Main', parentId: null}], tasks: [], people: [], capacity: 20, ado: {}, view: 'today'});
async function openWindow(backend, id, {timers = manualTimers()} = {}){
  const w = {board: newBoard(), statuses: [], timers};
  w.store = createStore({data: backend.client(id), board: () => w.board, applied: () => { w.applied = (w.applied || 0) + 1; }, status: s => w.statuses.push(s.state), timers});
  await w.store.load();
  w.store.start();
  return w;
}
const titles = w => w.board.tasks.map(t => t.title).sort();
const task = (id, title, extra = {}) => ({id, title, listId: MAIN_LIST, rank: 1, value: 2, effort: 'S', done: false, ...extra});

/* ---------- format ---------- */

test('a board saved by the localStorage app becomes four valid envelopes, keeping stamps and tombstones', () => {
  const raw = legacy();
  raw.dead = {tasks: {gone1: 1792000000000}, lists: {}, people: {}};
  raw.peopleAt = {deva: 1791000000000};
  const envs = legacyToEnvelopes(raw, 1);
  assert.deepEqual(Object.keys(envs), COLLECTIONS);
  for (const col of COLLECTIONS){
    assert.deepEqual(schemas.validate('data-envelope', envs[col]), [], col);
    assert.equal(envs[col].schema, `prioritizer.${col}`);
    assert.equal(envs[col].version, VERSIONS[col]);
  }
  assert.equal(envs.tasks.items.length, raw.tasks.length);
  assert.equal(envs.tasks.items[0].updatedAt, raw.tasks[0].updatedAt);
  assert.deepEqual(envs.tasks.deleted, {gone1: 1792000000000});
  assert.equal(envs.tasks.meta.capacity, raw.capacity);
  assert.deepEqual(envs.people.items.map(p => p.name).sort(), [...raw.people].sort());
  assert.equal(envs.people.items.find(p => p.id === 'deva').updatedAt, 1791000000000);
  assert.deepEqual(envs.settings.meta.ado, raw.ado);
});

test('envelopes put back into a board give the same board', () => {
  const raw = legacy();
  const envs = legacyToEnvelopes(raw);
  const board = newBoard();
  for (const col of COLLECTIONS) applyEnvelope(col, envs[col], board);
  const strip = a => a.map(x => { const c = clone(x); delete c.updatedAt; return c; });
  assert.deepEqual(board.lists, strip(raw.lists));
  assert.deepEqual(board.tasks, strip(raw.tasks));
  assert.deepEqual(board.people, raw.people);
  assert.equal(board.capacity, raw.capacity);
  assert.deepEqual(board.ado, raw.ado);
  assert.equal(board.view, 'today', 'which view a window shows is not data');
  // And from the board back to envelopes, with the stamps they came with.
  for (const col of COLLECTIONS){
    const again = envelopeFromBoard(col, board, envs[col]);
    assert.deepEqual(again.items, envs[col].items, col);
  }
});

test('tasks whose list has not arrived are held, not dropped', () => {
  const board = newBoard();
  const held = applyEnvelope('tasks', {items: [task('a', 'A'), task('b', 'B', {listId: 'l_new'})], meta: {updatedAt: 1, capacity: 9}}, board);
  assert.deepEqual(board.tasks.map(t => t.id), ['a']);
  assert.deepEqual(held.map(t => t.id), ['b']);
  assert.equal(board.capacity, 9);
  const env = envelopeFromBoard('tasks', board, null, held);
  assert.deepEqual(env.items.map(t => t.id), ['a', 'b'], 'held tasks are saved as they are');
});

test('backups: Prioritizer collections are taken, bad files say what is wrong', () => {
  const envs = legacyToEnvelopes(legacy());
  const bundle = {schema: 'workshop.bundle', version: 1, exportedAt: new Date().toISOString(), source: {mode: 'local', backend: 'agent'},
    collections: [...COLLECTIONS.map(c => ({app: 'prioritizer', collection: c, envelope: envs[c]})), {app: 'notes', collection: 'pages', envelope: {schema: 'notes.pages', version: 1, rev: 1, items: []}}]};
  assert.deepEqual(schemas.validate('data-bundle', bundle), []);
  assert.deepEqual(Object.keys(envelopesFromBundle(bundle)), COLLECTIONS);
  assert.throws(() => envelopesFromBundle({hello: 1}), /not a Workshop backup/);
  assert.throws(() => envelopesFromBundle({...bundle, version: 2}), /newer Workshop/);
  const newer = clone(bundle); newer.collections[1].envelope.version = 99;
  assert.throws(() => envelopesFromBundle(newer), /newer Workshop/);
  assert.throws(() => envelopesFromBundle({...bundle, collections: bundle.collections.slice(4)}), /no Prioritizer board/);
});

/* ---------- saving and windows ---------- */

test('edits are saved as stamped envelopes, and nothing is written when nothing changed', async () => {
  const be = fakeBackend();
  const w = await openWindow(be, 'w1');
  assert.equal(w.store.isNew, true);
  w.board.tasks.push(task('t1', 'Write plan'));
  await w.store.flushAll();
  assert.equal(be.files.tasks.rev, 1);
  assert.equal(be.files.lists.items[0].id, MAIN_LIST);
  assert.ok(be.files.tasks.items[0].updatedAt > 0);
  assert.equal(w.store.isNew, false);
  assert.equal(be.files.people, undefined, 'an empty collection is not written');
  const written = ['lists', 'tasks', 'settings'], revs = written.map(c => be.files[c].rev);
  await w.store.flushAll();
  assert.deepEqual(written.map(c => be.files[c].rev), revs, 'no change, no write');
  w.board.tasks[0].title = 'Write the plan';
  const before = be.files.tasks.items[0].updatedAt;
  await new Promise(r => setTimeout(r, 2));
  await w.store.flushAll();
  assert.equal(be.files.tasks.rev, 2);
  assert.ok(be.files.tasks.items[0].updatedAt > before, 'the edited task got a new stamp');
  assert.equal(be.files.lists.rev, revs[0], 'other collections untouched');
  assert.equal(w.statuses.at(-1), 'saved');
});

test('two windows stay in sync: each hears the other\'s writes', async () => {
  const be = fakeBackend();
  const a = await openWindow(be, 'a'), b = await openWindow(be, 'b');
  a.board.tasks.push(task('t1', 'From A'));
  await a.store.flushAll(); await settle(); await b.store.idle();
  assert.deepEqual(titles(b), ['From A']);
  b.board.tasks.push(task('t2', 'From B'));
  await b.store.flushAll(); await settle(); await a.store.idle();
  assert.deepEqual(titles(a), ['From A', 'From B']);
  assert.ok(b.applied > 1, 'the window was told to re-render');
});

test('two windows editing at once merge instead of overwriting', async () => {
  const be = fakeBackend();
  const a = await openWindow(be, 'a'), b = await openWindow(be, 'b');
  a.board.tasks.push(task('t1', 'One'), task('t2', 'Two'), task('t3', 'Three'));
  await a.store.flushAll(); await settle(); await b.store.idle();
  // Both edit before hearing each other: A renames t1 and deletes t3, B renames t2 and adds t4.
  a.board.tasks.find(t => t.id === 't1').title = 'One (A)';
  a.board.tasks = a.board.tasks.filter(t => t.id !== 't3');
  b.board.tasks.find(t => t.id === 't2').title = 'Two (B)';
  b.board.tasks.push(task('t4', 'Four (B)'));
  await a.store.flushAll();
  await b.store.flushAll(); // conflicts with A's write, merges, writes again
  await settle(); await a.store.idle(); await b.store.idle();
  const want = ['Four (B)', 'One (A)', 'Two (B)'];
  assert.deepEqual(titles(a), want);
  assert.deepEqual(titles(b), want);
  assert.deepEqual(be.files.tasks.items.map(t => t.title).sort(), want);
  assert.ok(be.files.tasks.deleted.t3, 'the delete is kept as a tombstone');
});

test('the same task edited in two windows: the later edit wins', async () => {
  const be = fakeBackend();
  const a = await openWindow(be, 'a'), b = await openWindow(be, 'b');
  a.board.tasks.push(task('t1', 'Start'));
  await a.store.flushAll(); await settle(); await b.store.idle();
  a.board.tasks[0].title = 'A edit';
  await a.store.flushAll();
  await new Promise(r => setTimeout(r, 3));
  b.board.tasks[0].title = 'B edit (later)';
  await b.store.flushAll(); await settle(); await a.store.idle();
  assert.deepEqual(titles(a), ['B edit (later)']);
  assert.deepEqual(titles(b), ['B edit (later)']);
});

test('edits made while a remote change arrives are kept and saved', async () => {
  const be = fakeBackend();
  const a = await openWindow(be, 'a'), b = await openWindow(be, 'b');
  a.board.tasks.push(task('t1', 'From A'));
  await a.store.flushAll();
  await new Promise(r => setTimeout(r, 2));
  b.board.capacity = 33;                      // edited after A saved, not saved yet when A's event arrives
  await settle(); await b.store.idle();
  assert.deepEqual(titles(b), ['From A']);
  assert.equal(b.board.capacity, 33, 'the unsaved edit survives the update');
  await b.store.flushAll(); await settle(); await a.store.idle();
  assert.equal(a.board.capacity, 33);
});

test('a new list and its tasks from another window: tasks wait for the list, never get deleted', async () => {
  const be = fakeBackend();
  const a = await openWindow(be, 'a');
  a.board.lists.push({id: 'l2', name: 'Second', parentId: null});
  a.board.tasks.push(task('t1', 'In second', {listId: 'l2'}));
  await a.store.flushAll();
  // A window that has read the tasks but not yet the lists (its lists event is late).
  const client = be.client('b'), board = newBoard();
  const b = createStore({data: {...client, get: async c => c === 'lists' ? null : client.get(c)}, board: () => board, applied() {}, timers: manualTimers()});
  await b.load();
  assert.deepEqual(board.tasks, [], 'not shown while its list is unknown');
  board.capacity = 5;
  await b.flushAll();
  assert.deepEqual(be.files.tasks.items.map(t => t.id), ['t1']);
  assert.equal(be.files.tasks.deleted.t1, undefined, 'the held task was not deleted');
});

test('a new window does not add its empty Main list to a saved board', async () => {
  const be = fakeBackend();
  const early = await openWindow(be, 'early');         // opened before anything was saved
  const a = await openWindow(be, 'a');
  await a.store.seed(legacyToEnvelopes({lists: [{id: 'l_old', name: 'Team', parentId: null}], tasks: [task('t1', 'Old', {listId: 'l_old'})], people: [], capacity: 20, ado: {}}));
  await settle(); await early.store.idle();
  assert.deepEqual(early.board.lists.map(l => l.id), ['l_old'], 'the placeholder gives way');
  assert.deepEqual(titles(early), ['Old']);
  const late = await openWindow(be, 'late');
  assert.deepEqual(late.board.lists.map(l => l.id), ['l_old']);
  await early.store.flushAll();
  assert.deepEqual(be.files.lists.items.map(l => l.id), ['l_old'], 'and is never written');
});

test('a failed write keeps the edits and the stored copy, says so, and retries', async () => {
  const be = fakeBackend();
  const w = await openWindow(be, 'w');
  w.board.tasks.push(task('t1', 'Saved'));
  await w.store.flushAll();
  const stored = clone(be.files.tasks);
  w.board.tasks.push(task('t2', 'Not saved yet'));
  be.failNext(1);
  await w.store.flushAll();
  assert.equal(w.statuses.at(-1), 'error');
  assert.equal(w.store.unsaved, true);
  assert.deepEqual(be.files.tasks, stored, 'the stored copy is untouched');
  assert.deepEqual(titles(w), ['Not saved yet', 'Saved'], 'the edit is still on screen');
  assert.equal(w.timers.count, 1, 'a retry is scheduled');
  w.timers.run(); await w.store.idle();
  assert.equal(w.statuses.at(-1), 'saved');
  assert.deepEqual(be.files.tasks.items.map(t => t.title).sort(), ['Not saved yet', 'Saved']);
});

test('a collection saved by a newer Workshop is read only', async () => {
  const be = fakeBackend();
  be.files.lists = {schema: 'prioritizer.lists', version: 9, rev: 4, updatedAt: new Date().toISOString(), items: [{id: 'l9', updatedAt: 5, name: 'Future'}], deleted: {}};
  const w = await openWindow(be, 'w');
  assert.equal(w.store.readOnly, true);
  assert.deepEqual(w.board.lists.map(l => l.name), ['Future'], 'still shown');
  w.board.lists[0].name = 'Changed';
  await w.store.flushAll();
  assert.equal(be.files.lists.rev, 4, 'never written');
  assert.equal(be.files.lists.items[0].name, 'Future');
  assert.equal(w.statuses.at(-1), 'readonly');
});

test('importing a backup into a board with data merges, and keeps both sides', async () => {
  const be = fakeBackend();
  const w = await openWindow(be, 'w');
  w.board.tasks.push(task('mine', 'Mine'));
  await w.store.flushAll();
  const other = legacyToEnvelopes(legacy());
  await w.store.importEnvelopes(other);
  const want = ['Mine', ...legacy().tasks.map(t => t.title)].sort();
  assert.deepEqual(titles(w), want);
  assert.deepEqual(be.files.tasks.items.map(t => t.title).sort(), want);
  assert.equal(w.board.lists.length, 1 + legacy().lists.length);
});

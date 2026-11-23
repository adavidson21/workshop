import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RO from '../rail-order.js';

const DEF = ['tasks', 'builds', 'people', 'notes', 'roadmaps', 'bench', 'chat', 'settings'];

test('no order is the default order', () => {
  assert.deepEqual(RO.arrange(DEF, []), DEF);
  assert.deepEqual(RO.arrange(DEF, null), DEF);
});

test('a saved order wins; ids not on the rail are dropped', () => {
  const order = ['notes', 'tasks', 'gone', 'builds', 'people', 'roadmaps', 'bench', 'chat', 'settings'];
  assert.deepEqual(RO.arrange(DEF, order), ['notes', 'tasks', 'builds', 'people', 'roadmaps', 'bench', 'chat', 'settings']);
});

test('an app the order does not name goes after the app before it in the default order', () => {
  const order = ['settings', 'notes', 'tasks', 'builds', 'people', 'roadmaps', 'chat'];   // no bench
  assert.deepEqual(RO.arrange(DEF, order), ['settings', 'notes', 'tasks', 'builds', 'people', 'roadmaps', 'bench', 'chat']);
  // A new first app with nothing before it goes first.
  assert.deepEqual(RO.arrange(['new', ...DEF], DEF.slice().reverse()), ['new', ...DEF.slice().reverse()]);
});

test('nextOrder keeps an app that is off where it was', () => {
  const saved = ['notes', 'people', 'tasks', 'builds', 'roadmaps', 'bench', 'chat', 'settings'];
  // People (receipts) is off; the person moves Bench first.
  const shown = ['bench', 'notes', 'tasks', 'builds', 'roadmaps', 'chat', 'settings'];
  const next = RO.nextOrder(saved, shown);
  assert.deepEqual(next, ['bench', 'notes', 'people', 'tasks', 'builds', 'roadmaps', 'chat', 'settings']);
  // Turned back on, People is back after Notes.
  assert.deepEqual(RO.arrange(DEF, next), next);
});

test('move clamps at the ends and returns the same array when it cannot move', () => {
  assert.deepEqual(RO.move(DEF, 'builds', -1), ['builds', 'tasks', ...DEF.slice(2)]);
  assert.deepEqual(RO.move(DEF, 'chat', 999), [...DEF.filter(x => x !== 'chat'), 'chat']);
  assert.equal(RO.move(DEF, 'tasks', -1), DEF);
  assert.equal(RO.move(DEF, 'nope', 1), DEF);
});

test('cleanOrder keeps app ids only, once each, up to MAX', () => {
  assert.deepEqual(RO.cleanOrder(['a', 'a', 'B', 1, null, 'ok-2', '9x']), ['a', 'ok-2']);
  assert.deepEqual(RO.cleanOrder('a,b'), []);
  assert.equal(RO.cleanOrder(Array.from({ length: 150 }, (_, i) => 'a' + i)).length, RO.MAX);
});

test('the envelope: read and written in meta.order, rev kept', () => {
  assert.deepEqual(RO.orderOf(null), []);
  assert.deepEqual(RO.orderOf({ schema: 'settings.focus', version: 1, meta: { order: ['notes'] } }), []);
  assert.deepEqual(RO.orderOf({ schema: RO.SCHEMA, version: 2, meta: { order: ['notes'] } }), [], 'a newer version is not read');
  const fresh = RO.withOrder(null, ['notes', 'notes', 'chat'], 5);
  assert.deepEqual(fresh, { schema: 'settings.rail', version: 1, rev: 0, items: [], meta: { updatedAt: 5, order: ['notes', 'chat'] } });
  const again = RO.withOrder({ ...fresh, rev: 3, updatedAt: '2026-11-22T00:00:00.000Z' }, [], 6);
  assert.equal(again.rev, 3);
  assert.equal('updatedAt' in again, false);
  assert.deepEqual(RO.orderOf(again), []);
  assert.deepEqual(RO.orderOf(fresh), ['notes', 'chat']);
});

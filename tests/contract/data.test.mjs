// docs/agent-api.md (data endpoints) and docs/data-format.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent, get, put, request, expectJson, expectError, envelope } from './helpers.mjs';

let agent;
before(async () => { agent = await startAgent(); });
after(async () => { await agent?.stop(); });

const page = (id, text, updatedAt = 1792330000000) => ({ id, updatedAt, text });

test('a collection that was never written is not found', async () => {
  expectError(await get(agent, '/api/data/notes/missing'), 404, 'not_found');
});

test('an app with no data lists no collections', async () => {
  const body = expectJson(await get(agent, '/api/data/empty-app'), 200, 'data-list');
  assert.deepEqual(body, { app: 'empty-app', collections: [] });
});

test('create, read, update with revisions', async () => {
  const created = expectJson(await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [page('a', 'one')])), 200, 'data-put-response');
  assert.equal(created.rev, 1);

  const read = expectJson(await get(agent, '/api/data/notes/pages'), 200, 'data-envelope');
  assert.equal(read.rev, 1);
  assert.equal(read.updatedAt, created.updatedAt);
  assert.deepEqual(read.items, [page('a', 'one')]);

  const next = { ...read, items: [page('a', 'two', 1792330000500)], deleted: { gone: 1792330000400 }, meta: { updatedAt: 1792330000500, color: 'blue' } };
  const updated = expectJson(await put(agent, '/api/data/notes/pages', next), 200, 'data-put-response');
  assert.equal(updated.rev, 2);
  const again = expectJson(await get(agent, '/api/data/notes/pages'), 200, 'data-envelope');
  assert.deepEqual(again.items, next.items);
  assert.deepEqual(again.deleted, next.deleted);
  assert.deepEqual(again.meta, next.meta);
});

test('the backend owns rev and updatedAt; app fields are stored untouched', async () => {
  const body = envelope('notes', 'owned', [{ id: 'x', updatedAt: 5, nested: { deep: [1, { two: 2 }] }, unknownField: true }], { updatedAt: '2000-01-01T00:00:00.000Z' });
  const res = expectJson(await put(agent, '/api/data/notes/owned', body), 200, 'data-put-response');
  const read = (await get(agent, '/api/data/notes/owned')).json;
  assert.equal(read.rev, 1);
  assert.equal(read.updatedAt, res.updatedAt);
  assert.notEqual(read.updatedAt, '2000-01-01T00:00:00.000Z');
  assert.deepEqual(read.items, body.items);
});

test('a stale rev is a conflict that returns the stored envelope', async () => {
  await put(agent, '/api/data/notes/race', envelope('notes', 'race', [page('a', 'first')]));
  const res = await put(agent, '/api/data/notes/race', envelope('notes', 'race', [page('a', 'second')]));
  const body = expectJson(res, 409, 'data-conflict');
  assert.equal(body.code, 'conflict');
  assert.equal(body.current.rev, 1);
  assert.deepEqual(body.current.items, [page('a', 'first')]);
  const read = (await get(agent, '/api/data/notes/race')).json;
  assert.equal(read.rev, 1, 'a conflict must not write');
});

test('writing to a missing collection with rev other than 0 is a conflict', async () => {
  const res = await put(agent, '/api/data/notes/ghost', { ...envelope('notes', 'ghost'), rev: 3 });
  const body = expectJson(res, 409, 'data-conflict');
  assert.equal(body.current.rev, 0);
});

test('the envelope is checked', async () => {
  const bad = [
    ['wrong schema name', { ...envelope('notes', 'pages'), schema: 'other.pages' }],
    ['missing change stamp', envelope('notes', 'checks', [{ id: 'a', text: 'x' }])],
    ['duplicate ids', envelope('notes', 'checks', [page('a', '1'), page('a', '2')])],
    ['extra top-level field', { ...envelope('notes', 'checks'), settings: {} }],
    ['version 0', { ...envelope('notes', 'checks'), version: 0 }],
    ['not an object', [1, 2, 3]]
  ];
  for (const [label, body] of bad) {
    const res = await put(agent, '/api/data/notes/checks', body);
    assert.equal(res.status, 400, `${label}: ${res.status}`);
    expectError(res, 400, 'bad_request');
  }
  expectError(await request(agent, 'PUT', '/api/data/notes/checks', { rawBody: '{not json', headers: { 'Content-Type': 'application/json' } }), 400, 'bad_request');
  expectError(await get(agent, '/api/data/notes/checks'), 404, 'not_found');
});

test('names in the path are checked', async () => {
  expectError(await get(agent, '/api/data/Notes/pages'), 400, 'bad_request');
  expectError(await get(agent, '/api/data/notes/Pages%20x'), 400, 'bad_request');
  expectError(await put(agent, '/api/data/notes/_hidden', envelope('notes', '_hidden')), 400, 'bad_request');
});

test('version can go up but not down', async () => {
  await put(agent, '/api/data/notes/versions', { ...envelope('notes', 'versions'), version: 2 });
  expectJson(await put(agent, '/api/data/notes/versions', { ...envelope('notes', 'versions'), version: 3, rev: 1 }), 200, 'data-put-response');
  expectError(await put(agent, '/api/data/notes/versions', { ...envelope('notes', 'versions'), version: 2, rev: 2 }), 400, 'downgrade');
});

test('listing an app\'s collections', async () => {
  const body = expectJson(await get(agent, '/api/data/notes'), 200, 'data-list');
  const pages = body.collections.find(c => c.collection === 'pages');
  assert.equal(pages.schema, 'notes.pages');
  assert.equal(pages.rev, 2);
  assert.equal(pages.items, 1);
  assert.deepEqual(body.collections.map(c => c.collection), [...body.collections.map(c => c.collection)].sort());
});

test('bodies over 10 MB are refused', async () => {
  const big = envelope('notes', 'big', [{ id: 'a', updatedAt: 1, blob: 'x'.repeat(10 * 1024 * 1024) }]);
  expectError(await put(agent, '/api/data/notes/big', big), 413, 'too_large');
});

test('wrong methods', async () => {
  expectError(await request(agent, 'POST', '/api/data/notes/pages', { body: {} }), 405, 'method_not_allowed');
  expectError(await request(agent, 'PUT', '/api/data/notes', { body: {} }), 405, 'method_not_allowed');
});

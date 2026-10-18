// docs/agent-api.md (GET /api/events).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent, put, get, post, openEvents, envelope, schemas, HOSTED, expectError } from './helpers.mjs';

let agent, hosted;
before(async () => {
  agent = await startAgent({ connectors: { echo: { enabled: true } } });
  hosted = await startAgent({ allowedOrigins: [HOSTED], features: { hostedMode: true } });
});
after(async () => { await agent?.stop(); await hosted?.stop(); });

test('the stream starts with hello and uses the right headers', async () => {
  const es = await openEvents(agent);
  try {
    assert.equal(es.status, 200);
    assert.match(es.headers['content-type'], /^text\/event-stream/);
    assert.equal(es.headers['cache-control'], 'no-store');
    const hello = await es.next('hello');
    schemas.assert('event', hello, 'hello event');
    assert.equal(hello.data.api, 1);
  } finally { es.close(); }
});

test('a data write sends a data event with the writer\'s client id and no contents', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const secretText = 'contents-must-not-appear-in-events';
    await put(agent, '/api/data/notes/live', envelope('notes', 'live', [{ id: 'a', updatedAt: 1, text: secretText }]), { headers: { 'X-Workshop-Client': 'w-test1' } });
    const e = await es.next('data', d => d.collection === 'live');
    schemas.assert('event', e, 'data event');
    assert.deepEqual({ app: e.data.app, collection: e.data.collection, rev: e.data.rev, client: e.data.client }, { app: 'notes', collection: 'live', rev: 1, client: 'w-test1' });
    assert.ok(!JSON.stringify(es.events).includes(secretText));
    await put(agent, '/api/data/notes/live', { ...envelope('notes', 'live'), rev: 1 });
    const e2 = await es.next('data', d => d.collection === 'live' && d.rev === 2);
    assert.equal(e2.data.client, null);
  } finally { es.close(); }
});

test('connector emits arrive as connector events', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    await post(agent, '/api/connectors/echo/echo', { args: { text: 'hi' } });
    const e = await es.next('connector', d => d.id === 'echo');
    schemas.assert('event', e, 'connector event');
    assert.deepEqual(e.data, { id: 'echo', event: 'echoed', payload: { text: 'hi' } });
  } finally { es.close(); }
});

test('the cookie works on the agent\'s own origin', async () => {
  const es = await openEvents(agent, { auth: 'cookie' });
  try { assert.equal(es.status, 200); await es.next('hello'); } finally { es.close(); }
});

test('a hosted page can use the query token, with CORS', async () => {
  const es = await openEvents(hosted, { auth: 'none', origin: HOSTED, query: `?token=${hosted.token}` });
  try {
    assert.equal(es.status, 200);
    assert.equal(es.headers['access-control-allow-origin'], HOSTED);
    await es.next('hello');
  } finally { es.close(); }
});

test('no token, no stream; the query token works only on /api/events', async () => {
  const res = await get(agent, '/api/events', { auth: 'none' });
  expectError(res, 401, 'unauthorized');
  expectError(await get(agent, `/api/apps?token=${agent.token}`, { auth: 'none' }), 401, 'unauthorized');
});

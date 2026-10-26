// docs/agent-api.md (GET /api/events).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startAgent, put, get, post, del, openEvents, envelope, schemas, HOSTED, expectError, sleep } from './helpers.mjs';


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

test('nested collections are named in full in data events', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    await put(agent, '/api/data/notes/entries/kim/2026', envelope('notes', 'entries/kim/2026'), { headers: { 'X-Workshop-Client': 'w-nest' } });
    const e = await es.next('data', d => d.collection === 'entries/kim/2026');
    schemas.assert('event', e, 'nested data event');
    assert.deepEqual({ app: e.data.app, rev: e.data.rev, client: e.data.client }, { app: 'notes', rev: 1, client: 'w-nest' });
  } finally { es.close(); }
});

test('file writes and deletes send file events with no contents', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const secret = 'file-contents-must-not-appear-in-events';
    const made = (await put(agent, '/api/files/notes/ev/a.md', { content: secret, create: true }, { headers: { 'X-Workshop-Client': 'w-file' } })).json;
    const e = await es.next('file', d => d.path === 'ev/a.md' && d.mtime !== null);
    schemas.assert('event', e, 'file event');
    assert.deepEqual(e.data, { app: 'notes', path: 'ev/a.md', mtime: made.mtime, client: 'w-file' });
    await del(agent, `/api/files/notes/ev/a.md?mtime=${made.mtime}`);
    const gone = await es.next('file', d => d.path === 'ev/a.md' && d.mtime === null);
    schemas.assert('event', gone, 'file event, trashed');
    assert.equal(gone.data.client, null);
    assert.ok(!JSON.stringify(es.events).includes(secret));
  } finally { es.close(); }
});

test('changes made outside Workshop send re-read events with client null', async () => {
  await put(agent, '/api/data/notes/watched', envelope('notes', 'watched'));
  const made = (await put(agent, '/api/files/notes/watched.md', { content: 'one', create: true })).json;
  await sleep(700); // let the agent's own writes settle
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const md = path.join(agent.dataDir, 'notes', 'watched.md');
    fs.writeFileSync(md, 'edited by hand');
    fs.utimesSync(md, new Date(), new Date(made.mtime + 3000));
    const f = await es.next('file', d => d.path === 'watched.md');
    schemas.assert('event', f, 'external file event');
    assert.deepEqual(f.data, { app: 'notes', path: 'watched.md', mtime: Math.floor(fs.statSync(md).mtimeMs), client: null });

    const col = path.join(agent.dataDir, 'notes', 'watched.json');
    const env = JSON.parse(fs.readFileSync(col, 'utf8'));
    env.items.push({ id: 'hand', updatedAt: 1, text: 'added in an editor' });
    fs.writeFileSync(col, JSON.stringify(env, null, 2));
    const d = await es.next('data', x => x.collection === 'watched');
    schemas.assert('event', d, 'external data event');
    assert.deepEqual(d.data, { app: 'notes', collection: 'watched', rev: null, updatedAt: null, client: null });
    assert.ok(!JSON.stringify(es.events).includes('added in an editor'));

    fs.writeFileSync(path.join(agent.dataDir, 'notes', 'new-by-hand.md'), 'new');
    await es.next('file', x => x.path === 'new-by-hand.md' && x.mtime !== null && x.client === null);

    fs.rmSync(md);
    const removed = await es.next('file', x => x.path === 'watched.md' && x.mtime === null);
    assert.equal(removed.data.client, null);
  } finally { es.close(); }
});

test('the agent\'s own writes do not cause outside-change events', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const headers = { 'X-Workshop-Client': 'w-quiet' };
    await put(agent, '/api/data/notes/quiet', envelope('notes', 'quiet'), { headers });
    const made = (await put(agent, '/api/files/notes/quiet.md', { content: 'x', create: true }, { headers })).json;
    await put(agent, '/api/files/notes/quiet.md', { content: 'y', mtime: made.mtime }, { headers });
    const trashed = (await del(agent, `/api/files/notes/quiet.md?mtime=${(await get(agent, '/api/files/notes/quiet.md')).json.mtime}`, { headers })).json;
    assert.ok(trashed.trash);
    await sleep(1200);
    const extra = es.events.filter(e => (e.event === 'data' && e.data.collection === 'quiet' && e.data.rev === null) || (e.event === 'file' && e.data.path === 'quiet.md' && e.data.client === null));
    assert.deepEqual(extra, []);
  } finally { es.close(); }
});

test('a burst of outside changes gives one event', async () => {
  await put(agent, '/api/files/notes/burst.md', { content: '0', create: true });
  await sleep(700);
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const file = path.join(agent.dataDir, 'notes', 'burst.md');
    for (let i = 1; i <= 3; i++) fs.writeFileSync(file, String(i));
    await es.next('file', d => d.path === 'burst.md');
    await sleep(1000);
    assert.equal(es.events.filter(e => e.event === 'file' && e.data.path === 'burst.md').length, 1);
  } finally { es.close(); }
});

test('paths Workshop ignores send nothing', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const dir = path.join(agent.dataDir, 'notes');
    fs.mkdirSync(path.join(agent.dataDir, '.trash', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(agent.dataDir, '.trash', 'notes', 'x.md'), 'x');
    fs.writeFileSync(path.join(dir, 'Upper.md'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'temp.md.tmp'), 'x');
    fs.writeFileSync(path.join(agent.dataDir, 'top.md'), 'x');
    await sleep(1200);
    assert.deepEqual(es.events.filter(e => e.event === 'file' || (e.event === 'data' && e.data.client === null && e.data.rev === null)), []);
  } finally { es.close(); }
});

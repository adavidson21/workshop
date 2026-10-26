// The SDK against an agent (docs/sdk.md, docs/run-modes.md), run in Node against the in-memory mock agent
// (tests/mock-agent.mjs) with just enough browser globals. Covers backend detection, the data write loop
// with conflicts, bundles, connectors and settings. The browser backend (IndexedDB) and the event stream
// need a real browser; tests/e2e.py covers them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockAgent } from '../../tests/mock-agent.mjs';
import { SchemaSet } from '../../tests/lib/schema.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));
const FIXTURES = path.join(REPO, 'tests', 'fixtures');

let agent, sdk;
const realFetch = globalThis.fetch;

// A page served by the agent: same origin, and the browser sends the agent cookie on same-origin requests.
function pageOn(origin, cookieToken) {
  const store = new Map();
  globalThis.window = globalThis;
  // Node has a real BroadcastChannel, which would keep the test process alive; browsers do not have that problem.
  globalThis.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
  globalThis.location = new URL(origin + '/apps/notes/index.html');
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  globalThis.fetch = (url, opts = {}) => {
    const u = new URL(url);
    const headers = new Headers(opts.headers || {});
    if (cookieToken && u.origin === origin) headers.set('Cookie', `workshop_token=${cookieToken}`);
    return realFetch(url, { ...opts, headers });
  };
  return store;
}

before(async () => {
  agent = await createMockAgent({
    appsDir: path.join(FIXTURES, 'apps'),
    connectorsDir: path.join(FIXTURES, 'connectors'),
    config: { connectors: { echo: { enabled: true, config: {} } } },
    env: { ECHO_TOKEN: 'x' }
  });
  pageOn(agent.url, agent.token);
  sdk = await import('../workshop-sdk.js');
});
after(async () => { globalThis.fetch = realFetch; await agent.stop(); });

test('a page served by the agent is local mode on the agent backend', async () => {
  const ws = await sdk.connect({ app: 'notes' });
  assert.equal(ws.mode, 'local');
  assert.equal(ws.backend, 'agent');
  assert.equal(ws.embedded, false);
});

test('connect needs an app id', async () => {
  await assert.rejects(sdk.connect({}), e => e.code === 'bad_request');
});

test('the write loop: create, read, stale put conflicts, merge and put again', async () => {
  const a = await sdk.connect({ app: 'notes' });
  const b = await sdk.connect({ app: 'notes' });
  assert.equal(await a.data.get('pages'), null, 'never written');

  const fresh = { schema: 'notes.pages', version: 1, rev: 0, items: [] };
  const first = a.data.stamp(null, { ...fresh, items: [{ id: 'p1', title: 'One' }] });
  const put1 = await a.data.put('pages', first);
  assert.equal(put1.rev, 1);
  assert.deepEqual(schemas.validate('data-put-response', put1), []);

  const readA = await a.data.get('pages');
  const readB = await b.data.get('pages');
  assert.deepEqual(schemas.validate('data-envelope', readA), []);

  // b writes first; a's put is now stale.
  const editB = b.data.stamp(readB, { ...structuredClone(readB), items: [...readB.items, { id: 'p2', title: 'Two' }] });
  assert.equal((await b.data.put('pages', editB)).rev, 2);
  const editA = a.data.stamp(readA, { ...structuredClone(readA), items: [{ id: 'p1', title: 'One, edited' }] });
  const err = await a.data.put('pages', editA).then(() => null, e => e);
  assert.ok(err, 'stale rev must be refused');
  assert.equal(err.code, 'conflict');
  assert.equal(err.status, 409);
  assert.equal(err.current.rev, 2);

  const merged = a.data.merge(editA, err.current);
  assert.equal(merged.rev, 2);
  assert.equal((await a.data.put('pages', merged)).rev, 3);
  const final = await a.data.get('pages');
  assert.deepEqual(final.items.map(i => [i.id, i.title]).sort(), [['p1', 'One, edited'], ['p2', 'Two']]);
});

test('put writes only this app, and get can read another app', async () => {
  const notes = await sdk.connect({ app: 'notes' });
  const board = await sdk.connect({ app: 'board' });
  assert.ok(await board.data.get('pages', { app: 'notes' }), 'other apps can read');
  // data.put has no app option: the app is always the connected one.
  await assert.rejects(board.data.put('pages', { schema: 'notes.pages', version: 1, rev: 0, items: [] }), e => e.code === 'bad_request');
  assert.ok(notes);
});

test('export makes a valid bundle and import merges it back', async () => {
  const ws = await sdk.connect({ app: 'notes' });
  const bundle = await ws.data.export({ apps: ['notes'] });
  assert.deepEqual(schemas.validate('data-bundle', bundle), []);
  assert.equal(bundle.source.backend, 'agent');
  assert.equal(bundle.collections.length, 1);

  // Import into a fresh collection name creates it; into the existing one merges.
  const copy = structuredClone(bundle);
  copy.collections.push({ app: 'notes', collection: 'drafts', envelope: { ...structuredClone(bundle.collections[0].envelope), schema: 'notes.drafts' } });
  const res = await ws.data.import(copy);
  assert.deepEqual(res, { created: 1, merged: 1 });
  const drafts = await ws.data.get('drafts');
  assert.equal(drafts.rev, 1);
  assert.deepEqual(drafts.items.map(i => i.id).sort(), ['p1', 'p2']);
});

test('connectors: list, call, write needs confirm, errors carry codes', async () => {
  const ws = await sdk.connect({ app: 'notes' });
  const list = await ws.connectors.list();
  assert.ok(list.some(c => c.id === 'echo' && c.enabled));
  const r = await ws.connectors.call('echo', 'echo', { text: 'hi' });
  assert.equal(r.text, 'hi');
  await assert.rejects(ws.connectors.call('echo', 'record', {}), e => e.code === 'confirm_required');
  assert.equal((await ws.connectors.call('echo', 'record', { n: 1 }, { confirm: true })).count, 1);
  await assert.rejects(ws.connectors.call('echo', 'fail'), e => e.code === 'unavailable' && e.status === 503);
});

test('settings: config and connector config read and write', async () => {
  const ws = await sdk.connect({ app: 'settings' });
  const cfg = await ws.config.get();
  assert.deepEqual(schemas.validate('config-public', cfg), []);
  const put = await ws.config.put({ features: { startAtLogin: true } });
  assert.equal(put.config.features.startAtLogin, true);
  const cc = await ws.connectors.getConfig('echo');
  assert.deepEqual(schemas.validate('connector-config', cc), []);
  const saved = await ws.connectors.putConfig('echo', { ...cc.config, greeting: 'Hello from Settings' });
  assert.equal(saved.config.greeting, 'Hello from Settings');
  await assert.rejects(ws.connectors.putConfig('echo', { nope: 1 }), e => e.code === 'invalid_config');
});

test('files on the agent: create, read, conflicts, list and trash (docs/sdk.md, Files)', async () => {
  const ws = await sdk.connect({ app: 'notes' });
  assert.equal(await ws.files.read('summaries/q4.md'), null);
  const made = await ws.files.write('summaries/q4.md', '# Q4\n', { create: true });
  assert.deepEqual(schemas.validate('file-put-response', made), []);
  const read = await ws.files.read('summaries/q4.md');
  assert.deepEqual(schemas.validate('file', read), []);
  assert.equal(read.content, '# Q4\n');
  const next = await ws.files.write('summaries/q4.md', '# Q4, edited\n', { mtime: read.mtime });
  const stale = await ws.files.write('summaries/q4.md', 'x', { mtime: read.mtime }).catch(e => e);
  assert.equal(stale.code, 'conflict');
  assert.equal(stale.current.mtime, next.mtime);
  const exists = await ws.files.write('summaries/q4.md', 'x', { create: true }).catch(e => e);
  assert.equal(exists.code, 'conflict');
  const gone = await ws.files.write('summaries/none.md', 'x', { mtime: 1 }).catch(e => e);
  assert.equal(gone.code, 'conflict');
  assert.equal(gone.current, null);
  assert.deepEqual((await ws.files.list('summaries')).map(f => f.path), ['summaries/q4.md']);
  const other = await sdk.connect({ app: 'board' });
  assert.equal((await other.files.read('summaries/q4.md', { app: 'notes' })).content, '# Q4, edited\n', 'other apps can read');
  assert.equal(await other.files.read('summaries/q4.md'), null, 'writes and default reads are the connected app');
  assert.equal((await ws.files.trash('summaries/q4.md', { mtime: 1 }).catch(e => e)).code, 'conflict');
  const t = await ws.files.trash('summaries/q4.md', { mtime: next.mtime });
  assert.match(t.trash, /^\.trash\/notes\/summaries\/q4\.\d{8}T\d{9}Z\.md$/);
  assert.deepEqual(await ws.files.list(), []);
});

test('nested collection names reach the agent; bad names are refused before any request', async () => {
  const ws = await sdk.connect({ app: 'notes' });
  const env = ws.data.stamp(null, { schema: 'notes.entries/jordan-lee/2026', version: 1, rev: 0, items: [{ id: 'e1' }] });
  assert.equal((await ws.data.put('entries/jordan-lee/2026', env)).rev, 1);
  assert.equal((await ws.data.get('entries/jordan-lee/2026')).items[0].id, 'e1');
  assert.ok(fs.existsSync(path.join(agent.dataDir, 'notes', 'entries', 'jordan-lee', '2026.json')));
  let calls = 0;
  const f = globalThis.fetch;
  globalThis.fetch = (...a) => { calls++; return f(...a); };
  try {
    for (const bad of ['../x', 'A', 'a/b/c/d/e']) await assert.rejects(ws.data.get(bad), e => e.code === 'bad_request');
    await assert.rejects(ws.files.read('notes.txt'), e => e.code === 'bad_request');
    await assert.rejects(ws.files.write('a.md', 'x', {}), e => e.code === 'bad_request');
  } finally { globalThis.fetch = f; }
  assert.equal(calls, 0);
});

test('folder on the agent: status names dataDir; choose and allow are for the browser backend', async () => {
  const ws = await sdk.connect({ app: 'settings' });
  assert.equal(ws.storage, 'agent');
  const st = await ws.folder.status();
  assert.equal(st.storage, 'agent');
  assert.equal(st.name, (await ws.config.get()).dataDir);
  assert.equal(st.permission, null);
  await assert.rejects(ws.folder.choose(), e => e.code === 'unavailable');
  await assert.rejects(ws.folder.allow(), e => e.code === 'unavailable');
});

test('no agent: browser mode, and agent-only calls say unavailable', async () => {
  pageOn('http://127.0.0.1:1', null); // nothing listens on port 1
  try {
    const ws = await sdk.connect({ app: 'notes' });
    assert.equal(ws.mode, 'browser');
    assert.equal(ws.backend, 'browser');
    assert.equal(ws.storage, 'indexeddb', 'no folder chosen: the IndexedDB store');
    assert.deepEqual(await ws.connectors.list(), []);
    await assert.rejects(ws.connectors.call('echo', 'echo', { text: 'x' }), e => e.code === 'unavailable');
    await assert.rejects(ws.config.get(), e => e.code === 'unavailable');
  } finally {
    pageOn(agent.url, agent.token);
  }
});

test('a paired page (hosted) uses the stored agent and token', async () => {
  const store = pageOn('https://work.example.org', null);
  try {
    store.set('workshop.agent', JSON.stringify({ url: agent.url, token: agent.token }));
    const ws = await sdk.connect({ app: 'notes' });
    // The mock refuses the foreign Origin header that a real browser would send; Node sends none, so this
    // checks the SDK's choice and its use of the header token, not the agent's origin rules.
    assert.equal(ws.mode, 'hosted');
    assert.equal(ws.backend, 'agent');
    assert.ok(await ws.data.get('pages'));
    store.set('workshop.agent', JSON.stringify({ url: agent.url, token: 'wrong' }));
    assert.equal((await sdk.connect({ app: 'notes' })).mode, 'browser', 'a stale pairing falls back to browser mode');
  } finally {
    pageOn(agent.url, agent.token);
  }
});

// docs/data-format.md (Names, Data folder, Moving from ~/.workshop/data) and docs/agent-api.md (nested names).
// The agent keeps these tests as to-do until WS11b lands (see pendingOnAgent in helpers.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startAgent, get, put, request, expectJson, expectError, envelope, pendingOnAgent, schemas } from './helpers.mjs';

const todo = pendingOnAgent('WS11b');
const item = (id, text, updatedAt = 1792330000000) => ({ id, updatedAt, text });
const onDisk = (agent, ...parts) => path.join(agent.dataDir, ...parts);

let agent;
before(async () => { agent = await startAgent(); });
after(async () => { await agent?.stop(); });

test('collections are files in the data folder, not in the Workshop home', { todo }, async () => {
  expectJson(await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [item('a', 'one')])), 200, 'data-put-response');
  const file = onDisk(agent, 'notes', 'pages.json');
  assert.ok(fs.existsSync(file), `expected ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.endsWith('\n'), 'pretty-printed with a final newline');
  assert.deepEqual(JSON.parse(text), (await get(agent, '/api/data/notes/pages')).json);
  assert.ok(!fs.existsSync(path.join(agent.home, 'data', 'notes')), 'nothing written under ~/.workshop/data');
});

test('nested collection names are subfolders', { todo }, async () => {
  const name = 'entries/jordan-lee/y2026';
  const body = envelope('notes', name, [item('e1', 'win')]);
  schemas.assert('data-envelope', body, 'nested envelope');
  expectJson(await put(agent, `/api/data/notes/${name}`, body, { headers: { 'X-Workshop-Client': 'w-nest' } }), 200, 'data-put-response');
  assert.ok(fs.existsSync(onDisk(agent, 'notes', 'entries', 'jordan-lee', 'y2026.json')));
  const read = expectJson(await get(agent, `/api/data/notes/${name}`), 200, 'data-envelope');
  assert.equal(read.schema, 'notes.entries/jordan-lee/y2026');
  const list = expectJson(await get(agent, '/api/data/notes'), 200, 'data-list');
  assert.ok(list.collections.some(c => c.collection === name && c.schema === `notes.${name}`));
  assert.deepEqual(list.collections.map(c => c.collection), [...list.collections.map(c => c.collection)].sort());
});

test('a collection and a folder of the same name live side by side', { todo }, async () => {
  expectJson(await put(agent, '/api/data/notes/archive', envelope('notes', 'archive')), 200, 'data-put-response');
  expectJson(await put(agent, '/api/data/notes/archive/old', envelope('notes', 'archive/old')), 200, 'data-put-response');
  assert.equal((await get(agent, '/api/data/notes/archive')).json.schema, 'notes.archive');
  assert.equal((await get(agent, '/api/data/notes/archive/old')).json.schema, 'notes.archive/old');
});

test('nested names are checked', { todo }, async () => {
  const bad = [
    '/api/data/notes/a/b/c/d/e',          // 5 segments
    '/api/data/notes/entries//y2026',     // empty segment
    '/api/data/notes/entries/',           // trailing slash
    '/api/data/notes/entries/2026',       // segment starts with a digit
    '/api/data/notes/entries%2Fy2026',    // encoded slash
    '/api/data/notes/entries%5Cy2026',    // encoded backslash
    '/api/data/notes/entries/Jordan',     // uppercase
    '/api/data/notes/entries.json'        // a dot
  ];
  for (const p of bad) expectError(await get(agent, p), 400, 'bad_request');
  expectError(await put(agent, '/api/data/notes/a/b/c/d/e', envelope('notes', 'a/b/c/d/e')), 400, 'bad_request');
  // schema must name the full nested path
  expectError(await put(agent, '/api/data/notes/entries/kim', envelope('notes', 'entries')), 400, 'bad_request');
  expectError(await put(agent, '/api/data/notes/entries/kim', envelope('notes', 'kim')), 400, 'bad_request');
});

test('dot segments are refused as sent, not normalized away', { todo }, async () => {
  for (const p of ['/api/data/notes/../pages', '/api/data/notes/%2e%2e/pages', '/api/data/notes/./pages', '/api/data/notes/x/%2E%2E/pages']) {
    expectError(await get(agent, p), 400, 'bad_request');
  }
});

test('a version upgrade keeps a copy in .backups, not next to the collection', { todo }, async () => {
  await put(agent, '/api/data/notes/versions', { ...envelope('notes', 'versions'), version: 2 });
  expectJson(await put(agent, '/api/data/notes/versions', { ...envelope('notes', 'versions'), version: 3, rev: 1 }), 200, 'data-put-response');
  const day = fs.readdirSync(onDisk(agent, '.backups'));
  assert.equal(day.length, 1);
  assert.match(day[0], /^\d{4}-\d{2}-\d{2}$/);
  const copy = JSON.parse(fs.readFileSync(onDisk(agent, '.backups', day[0], 'notes', 'versions.v2.json'), 'utf8'));
  assert.equal(copy.version, 2);
  assert.ok(!fs.existsSync(onDisk(agent, 'notes', 'versions.v2.json')));
  assert.ok(!(await get(agent, '/api/data/notes')).json.collections.some(c => c.collection.includes('.')));
});

test('a damaged collection file is reported and never written over', { todo }, async () => {
  fs.mkdirSync(onDisk(agent, 'notes'), { recursive: true });
  fs.writeFileSync(onDisk(agent, 'notes', 'broken.json'), '{"schema": "notes.broken", ');
  expectError(await get(agent, '/api/data/notes/broken'), 500, 'internal');
  expectError(await put(agent, '/api/data/notes/broken', envelope('notes', 'broken')), 500, 'internal');
  assert.equal(fs.readFileSync(onDisk(agent, 'notes', 'broken.json'), 'utf8'), '{"schema": "notes.broken", ');
  assert.ok(!(await get(agent, '/api/data/notes')).json.collections.some(c => c.collection === 'broken'));
});

test('names Workshop ignores are not listed', { todo }, async () => {
  fs.mkdirSync(onDisk(agent, 'notes', '.git'), { recursive: true });
  fs.writeFileSync(onDisk(agent, 'notes', '.git', 'config.json'), '{}');
  fs.writeFileSync(onDisk(agent, 'notes', 'Upper.json'), JSON.stringify(envelope('notes', 'Upper')));
  fs.writeFileSync(onDisk(agent, 'readme.md'), 'top-level files are not app data');
  const list = expectJson(await get(agent, '/api/data/notes'), 200, 'data-list');
  assert.ok(!list.collections.some(c => /git|Upper/.test(c.collection)));
});

// ---------- symbolic links and junctions

test('paths that lead outside the data folder are refused', { todo }, async (t) => {
  const outside = path.join(agent.root, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.md'), 'outside');
  fs.writeFileSync(path.join(outside, 'pages.json'), JSON.stringify({ ...envelope('notes', 'link/pages'), rev: 1, updatedAt: '2026-10-25T00:00:00.000Z' }));
  fs.mkdirSync(onDisk(agent, 'notes'), { recursive: true });
  try { fs.symlinkSync(outside, onDisk(agent, 'notes', 'link'), 'junction'); } catch (e) { t.skip(`cannot create a link here: ${e.code}`); return; }
  expectError(await get(agent, '/api/files/notes/link/secret.md'), 400, 'bad_request');
  expectError(await put(agent, '/api/files/notes/link/new.md', { content: 'x', create: true }), 400, 'bad_request');
  assert.ok(!fs.existsSync(path.join(outside, 'new.md')), 'nothing created outside');
  expectError(await get(agent, '/api/data/notes/link/pages'), 400, 'bad_request');
  expectError(await put(agent, '/api/data/notes/link/other', envelope('notes', 'link/other')), 400, 'bad_request');
  assert.ok(!fs.existsSync(path.join(outside, 'other.json')));
  const files = expectJson(await get(agent, '/api/files/notes'), 200, 'file-list');
  assert.ok(!files.files.some(f => f.path.startsWith('link/')));
  const cols = expectJson(await get(agent, '/api/data/notes'), 200, 'data-list');
  assert.ok(!cols.collections.some(c => c.collection.startsWith('link/')));
});

test('a data folder that is itself a link works', { todo }, async (t) => {
  let linked;
  const real = path.join(agent.root, 'real-data');
  fs.mkdirSync(real);
  const link = path.join(agent.root, 'linked-data');
  try { fs.symlinkSync(real, link, 'junction'); } catch (e) { t.skip(`cannot create a link here: ${e.code}`); return; }
  try {
    linked = await startAgent({ dataDir: link });
    expectJson(await put(linked, '/api/data/notes/pages', envelope('notes', 'pages')), 200, 'data-put-response');
    assert.ok(fs.existsSync(path.join(real, 'notes', 'pages.json')));
  } finally { await linked?.stop(); fs.rmSync(real, { recursive: true, force: true }); }
});

// ---------- moving from ~/.workshop/data

const oldEnvelope = (app, collection, rev) => ({ ...envelope(app, collection, [item('a', 'old')]), rev, updatedAt: '2026-10-20T10:00:00.000Z' });
function writeOld(home, app, collection, env) {
  fs.mkdirSync(path.join(home, 'data', app), { recursive: true });
  fs.writeFileSync(path.join(home, 'data', app, `${collection}.json`), `${JSON.stringify(env, null, 2)}\n`);
}

test('on start, old app data is copied in once and kept', { todo }, async () => {
  let a;
  try {
    a = await startAgent({}, {
      setup: ({ home }) => {
        writeOld(home, 'notes', 'pages', oldEnvelope('notes', 'pages', 7));
        writeOld(home, 'notes', 'pages.v1', { not: 'a collection' });
        fs.mkdirSync(path.join(home, 'data', '_connectors', 'echo'), { recursive: true });
        fs.writeFileSync(path.join(home, 'data', '_connectors', 'echo', 'cache.json'), '{}');
      }
    });
    const read = expectJson(await get(a, '/api/data/notes/pages'), 200, 'data-envelope');
    assert.equal(read.rev, 7, 'copied as is');
    assert.deepEqual(read.items, [item('a', 'old')]);
    assert.ok(fs.existsSync(path.join(a.home, 'data', 'notes', 'pages.json')), 'old file kept');
    assert.ok(!fs.existsSync(path.join(a.dataDir, '_connectors')), 'connector storage stays in the home');
    assert.ok(!fs.existsSync(path.join(a.dataDir, 'notes', 'pages.v1.json')), 'version copies stay behind');
    const marker = JSON.parse(fs.readFileSync(path.join(a.home, 'data', 'moved.json'), 'utf8'));
    schemas.assert('data-moved', marker, 'moved.json');
    assert.equal(marker.collections, 1);
  } finally { await a?.stop(); }
});

test('no copy when the data folder already has app data', { todo }, async () => {
  let a;
  try {
    a = await startAgent({}, {
      setup: ({ home, dataDir }) => {
        writeOld(home, 'notes', 'pages', oldEnvelope('notes', 'pages', 7));
        fs.mkdirSync(path.join(dataDir, 'other'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'other', 'readme.md'), 'already here');
      }
    });
    expectError(await get(a, '/api/data/notes/pages'), 404, 'not_found');
    assert.ok(!fs.existsSync(path.join(a.home, 'data', 'moved.json')));
  } finally { await a?.stop(); }
});

test('no copy once moved.json exists', { todo }, async () => {
  let a;
  try {
    a = await startAgent({}, {
      setup: ({ home }) => {
        writeOld(home, 'notes', 'pages', oldEnvelope('notes', 'pages', 7));
        fs.writeFileSync(path.join(home, 'data', 'moved.json'), JSON.stringify({ movedTo: '/somewhere/else', movedAt: '2026-10-20T10:00:00.000Z', collections: 1 }));
      }
    });
    expectError(await get(a, '/api/data/notes/pages'), 404, 'not_found');
  } finally { await a?.stop(); }
});

test('the data folder is created on start if missing', { todo }, async () => {
  let a;
  try {
    a = await startAgent({}, { setup: ({ root }) => { assert.ok(!fs.existsSync(path.join(root, 'Workshop'))); } });
    assert.ok(fs.statSync(a.dataDir).isDirectory());
  } finally { await a?.stop(); }
});

test('the data folder is never served as static files', { todo }, async () => {
  assert.equal((await get(agent, '/api/data/notes/pages')).status, 200);
  for (const p of ['/notes/pages.json', '/Workshop/notes/pages.json', '/apps/../Workshop/notes/pages.json']) {
    const res = await request(agent, 'GET', p, { auth: 'cookie' });
    assert.equal(res.status, 404, `${p}: ${res.status}`);
  }
});

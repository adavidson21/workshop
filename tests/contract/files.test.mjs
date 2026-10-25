// docs/agent-api.md (Files). The agent keeps these tests as to-do until WS11b lands.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startAgent, get, put, del, request, expectJson, expectError, envelope, pendingOnAgent, HOSTED } from './helpers.mjs';

const todo = pendingOnAgent('WS11b');
const MB = 1024 * 1024;
const P = '/api/files/notes';

let agent, hosted;
before(async () => {
  agent = await startAgent();
  hosted = await startAgent({ allowedOrigins: [HOSTED], features: { hostedMode: true } });
});
after(async () => { await agent?.stop(); await hosted?.stop(); });

const create = (a, p, content) => put(a, `${P}/${p}`, { content, create: true });

test('create, read, list and replace a file', { todo }, async () => {
  const made = expectJson(await create(agent, 'summaries/kim/h2-2026.md', '# Kim\n'), 200, 'file-put-response');
  assert.deepEqual({ app: made.app, path: made.path, size: made.size }, { app: 'notes', path: 'summaries/kim/h2-2026.md', size: 6 });
  const file = path.join(agent.dataDir, 'notes', 'summaries', 'kim', 'h2-2026.md');
  assert.equal(fs.readFileSync(file, 'utf8'), '# Kim\n', 'stored as the plain file, byte for byte');
  assert.equal(made.mtime, Math.floor(fs.statSync(file).mtimeMs));

  const read = expectJson(await get(agent, `${P}/summaries/kim/h2-2026.md`), 200, 'file');
  assert.deepEqual(read, { app: 'notes', path: 'summaries/kim/h2-2026.md', mtime: made.mtime, size: 6, content: '# Kim\n' });

  const next = expectJson(await put(agent, `${P}/summaries/kim/h2-2026.md`, { content: '# Kim\n\nMore.\n', mtime: read.mtime }), 200, 'file-put-response');
  assert.notEqual(next.mtime, read.mtime, 'every write changes the mtime');
  assert.equal(expectJson(await get(agent, `${P}/summaries/kim/h2-2026.md`), 200, 'file').content, '# Kim\n\nMore.\n');

  await create(agent, 'summaries/ann/h2-2026.md', 'a');
  await create(agent, 'top.json', '{"a": 1}');
  const all = expectJson(await get(agent, P), 200, 'file-list');
  assert.deepEqual(all.files.map(f => f.path), ['summaries/ann/h2-2026.md', 'summaries/kim/h2-2026.md', 'top.json']);
  const kim = expectJson(await get(agent, `${P}/summaries/kim`), 200, 'file-list');
  assert.deepEqual(kim.files.map(f => f.path), ['summaries/kim/h2-2026.md']);
  assert.equal(kim.files[0].mtime, next.mtime);
});

test('empty lists and missing files', { todo }, async () => {
  assert.deepEqual(expectJson(await get(agent, '/api/files/empty-app'), 200, 'file-list'), { app: 'empty-app', files: [] });
  assert.deepEqual(expectJson(await get(agent, `${P}/no/such`), 200, 'file-list').files, []);
  expectError(await get(agent, `${P}/missing.md`), 404, 'not_found');
  expectError(await del(agent, `${P}/missing.md`), 404, 'not_found');
});

test('a stale mtime is a conflict that returns the file as it is now', { todo }, async () => {
  const a = expectJson(await create(agent, 'race.md', 'first'), 200, 'file-put-response');
  const b = expectJson(await put(agent, `${P}/race.md`, { content: 'second', mtime: a.mtime }), 200, 'file-put-response');
  const res = expectJson(await put(agent, `${P}/race.md`, { content: 'third', mtime: a.mtime }), 409, 'file-conflict');
  assert.equal(res.current.content, 'second');
  assert.equal(res.current.mtime, b.mtime);
  assert.equal((await get(agent, `${P}/race.md`)).json.content, 'second', 'a conflict must not write');
});

test('a change made outside Workshop is a conflict too', { todo }, async () => {
  const a = expectJson(await create(agent, 'outside.md', 'mine'), 200, 'file-put-response');
  const file = path.join(agent.dataDir, 'notes', 'outside.md');
  fs.writeFileSync(file, 'edited in another program');
  fs.utimesSync(file, new Date(), new Date(a.mtime + 5000));
  const res = expectJson(await put(agent, `${P}/outside.md`, { content: 'mine again', mtime: a.mtime }), 409, 'file-conflict');
  assert.equal(res.current.content, 'edited in another program');
});

test('create means the file must not exist yet', { todo }, async () => {
  expectJson(await create(agent, 'once.md', 'one'), 200, 'file-put-response');
  const res = expectJson(await create(agent, 'once.md', 'two'), 409, 'file-conflict');
  assert.equal(res.current.content, 'one');
});

test('replacing a file that is gone is a conflict with current null', { todo }, async () => {
  const res = expectJson(await put(agent, `${P}/never.md`, { content: 'x', mtime: 1792330000000 }), 409, 'file-conflict');
  assert.equal(res.current, null);
});

test('the body needs exactly one of mtime and create', { todo }, async () => {
  for (const body of [{ content: 'x' }, { content: 'x', mtime: 1, create: true }, { content: 'x', create: false }, { mtime: 1 }, { content: 1, create: true }, { content: 'x', create: true, extra: 1 }]) {
    expectError(await put(agent, `${P}/body.md`, body), 400, 'bad_request');
  }
  assert.ok(!fs.existsSync(path.join(agent.dataDir, 'notes', 'body.md')));
});

test('only .md and .json, and .json must be valid JSON', { todo }, async () => {
  for (const p of ['notes.txt', 'notes.MD', 'notes.md.bak', 'run.js', 'page.html']) {
    expectError(await request(agent, 'PUT', `${P}/${p}`, { body: { content: 'x', create: true } }), 400, 'bad_request');
  }
  expectError(await get(agent, `${P}/notes.txt`), 400, 'bad_request');
  expectError(await create(agent, 'bad.json', '{not json'), 400, 'bad_request');
  expectJson(await create(agent, 'good.json', '[1, 2, 3]'), 200, 'file-put-response');
});

test('file paths follow the name rules', { todo }, async () => {
  const bad = [
    `${P}/a/b/c/d/e.md`,              // 5 segments
    `${P}//etc/passwd.md`,            // empty segment (absolute path)
    `${P}/../config.md`,              // traversal, raw
    `${P}/%2e%2e/config.md`,          // traversal, encoded
    `${P}/x/%2E%2E/%2E%2E/token.md`,  // traversal, encoded, deeper
    `${P}/..%2Fconfig.md`,            // encoded slash
    `${P}/..%5Cconfig.md`,            // encoded backslash
    `${P}/C:%5Cnotes.md`,             // drive letter
    `${P}/Notes.md`,                  // uppercase
    `${P}/2026.md`,                   // starts with a digit
    `${P}/my%20notes.md`,             // space
    '/api/files/Notes/a.md'           // bad app
  ];
  for (const p of bad) {
    expectError(await get(agent, p), 400, 'bad_request');
    expectError(await request(agent, 'PUT', p, { body: { content: 'x', create: true } }), 400, 'bad_request');
  }
  expectError(await get(agent, `${P}/a/b/c/d`), 400, 'bad_request'); // a folder has at most 3 segments
  assert.ok(!fs.existsSync(path.join(agent.home, 'config.md')));
  assert.ok(!fs.existsSync(path.join(agent.root, 'config.md')));
});

test('files over 10 MB are refused', { todo }, async () => {
  expectError(await create(agent, 'big.md', 'x'.repeat(10 * MB + 1)), 413, 'too_large');
  expectJson(await create(agent, 'exact.md', 'x'.repeat(10 * MB)), 200, 'file-put-response');
  // JSON escaping may make the body larger than the content; the limit is on the content.
  expectJson(await create(agent, 'quotes.md', '"'.repeat(6 * MB)), 200, 'file-put-response');
});

test('a file that grew past 10 MB outside Workshop is listed but not read', { todo }, async () => {
  fs.mkdirSync(path.join(agent.dataDir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(agent.dataDir, 'notes', 'huge.md'), 'x'.repeat(10 * MB + 10));
  expectError(await get(agent, `${P}/huge.md`), 413, 'too_large');
  assert.ok(expectJson(await get(agent, P), 200, 'file-list').files.some(f => f.path === 'huge.md' && f.size === 10 * MB + 10));
});

test('delete moves the file to the trash and never removes it', { todo }, async () => {
  const made = expectJson(await create(agent, 'drafts/old.md', 'keep me'), 200, 'file-put-response');
  const res = expectJson(await del(agent, `${P}/drafts/old.md`), 200, 'file-delete-response');
  assert.match(res.trash, /^\.trash\/notes\/drafts\/old\.\d{8}T\d{9}Z(-\d+)?\.md$/);
  assert.equal(fs.readFileSync(path.join(agent.dataDir, ...res.trash.split('/')), 'utf8'), 'keep me');
  expectError(await get(agent, `${P}/drafts/old.md`), 404, 'not_found');
  assert.ok(!expectJson(await get(agent, P), 200, 'file-list').files.some(f => f.path === 'drafts/old.md'), 'the trash is not listed');

  // the same name again gets its own trash file
  const again = expectJson(await create(agent, 'drafts/old.md', 'second'), 200, 'file-put-response');
  const res2 = expectJson(await del(agent, `${P}/drafts/old.md?mtime=${again.mtime}`), 200, 'file-delete-response');
  assert.notEqual(res2.trash, res.trash);
  assert.ok(fs.existsSync(path.join(agent.dataDir, ...res.trash.split('/'))));
  assert.ok(made.mtime > 0);
});

test('delete with a stale mtime is a conflict and moves nothing', { todo }, async () => {
  const a = expectJson(await create(agent, 'keep.md', 'one'), 200, 'file-put-response');
  const b = expectJson(await put(agent, `${P}/keep.md`, { content: 'two', mtime: a.mtime }), 200, 'file-put-response');
  const res = expectJson(await del(agent, `${P}/keep.md?mtime=${a.mtime}`), 409, 'file-conflict');
  assert.equal(res.current.mtime, b.mtime);
  expectJson(await get(agent, `${P}/keep.md`), 200, 'file');
  expectError(await del(agent, `${P}/keep.md?mtime=soon`), 400, 'bad_request');
});

test('the files API never touches a collection', { todo }, async () => {
  expectJson(await put(agent, '/api/data/notes/sidecar', envelope('notes', 'sidecar')), 200, 'data-put-response');
  expectError(await get(agent, `${P}/sidecar.json`), 400, 'bad_request');
  expectError(await put(agent, `${P}/sidecar.json`, { content: '{}', mtime: 1 }), 400, 'bad_request');
  expectError(await create(agent, 'sidecar.json', '{}'), 400, 'bad_request');
  expectError(await del(agent, `${P}/sidecar.json`), 400, 'bad_request');
  assert.ok(!expectJson(await get(agent, P), 200, 'file-list').files.some(f => f.path === 'sidecar.json'), 'collections are not listed as files');
  // content that would become a collection is refused
  expectError(await create(agent, 'smuggled.json', JSON.stringify(envelope('notes', 'smuggled'))), 400, 'bad_request');
  // a .md next to a collection of the same name is fine
  expectJson(await create(agent, 'sidecar.md', '# Summary'), 200, 'file-put-response');
  // a plain .json file is not a collection
  expectJson(await create(agent, 'plain.json', '{"schema": "something.else"}'), 200, 'file-put-response');
  assert.ok(!expectJson(await get(agent, '/api/data/notes'), 200, 'data-list').collections.some(c => c.collection === 'plain'));
  expectError(await get(agent, '/api/data/notes/plain'), 500, 'internal');
});

test('writes need the header token; reads accept the cookie', { todo }, async () => {
  await create(agent, 'auth.md', 'x');
  expectJson(await get(agent, `${P}/auth.md`, { auth: 'cookie' }), 200, 'file');
  expectError(await put(agent, `${P}/auth.md`, { content: 'y', create: true }, { auth: 'cookie' }), 401, 'unauthorized');
  expectError(await del(agent, `${P}/auth.md`, { auth: 'cookie' }), 401, 'unauthorized');
  expectError(await get(agent, `${P}/auth.md`, { auth: 'none' }), 401, 'unauthorized');
});

test('a paired hosted origin has the same access as for data', { todo }, async () => {
  const made = expectJson(await put(hosted, `${P}/hosted.md`, { content: 'from the site', create: true }, { origin: HOSTED }), 200, 'file-put-response');
  const read = await get(hosted, `${P}/hosted.md`, { origin: HOSTED });
  expectJson(read, 200, 'file');
  assert.equal(read.headers['access-control-allow-origin'], HOSTED);
  expectJson(await del(hosted, `${P}/hosted.md?mtime=${made.mtime}`, { origin: HOSTED }), 200, 'file-delete-response');
  const pre = await request(hosted, 'OPTIONS', `${P}/hosted.md`, { auth: 'none', origin: HOSTED, headers: { 'Access-Control-Request-Method': 'DELETE' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers['access-control-allow-methods'], /DELETE/);
  expectError(await get(agent, `${P}/hosted.md`, { origin: HOSTED }), 403, 'forbidden');
});

test('wrong methods', { todo }, async () => {
  expectError(await request(agent, 'POST', `${P}/x.md`, { body: {} }), 405, 'method_not_allowed');
  expectError(await request(agent, 'PUT', P, { body: { content: 'x', create: true } }), 405, 'method_not_allowed');
  expectError(await request(agent, 'DELETE', `${P}/summaries`), 405, 'method_not_allowed');
});

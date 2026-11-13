// Work mode (docs/run-modes.md, Work mode): the agent serves only the pinned copy built by `workshop pin`,
// checked file by file, and no hosted site can pair or use it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server.mjs';
import { buildPinned, verifyPinned, safeRel, BUILD_FILE } from '../lib/pinned.mjs';
import { buildRegistry, loadSchemas } from '../../workshop.mjs';
import { tempHome, rmHome, get, REPO, dataDirOf } from './helpers.mjs';

const schemas = loadSchemas();
const HOSTED = 'https://workshop.example.org';

let home, uiDir, agent, build;
before(async () => {
  home = tempHome();
  uiDir = path.join(home, 'ui');
  build = buildPinned({ repo: REPO, outDir: uiDir, registry: d => buildRegistry(d, schemas), info: { workshop: { version: 't', ref: 'v0.0.1', commit: 'a'.repeat(40) } } });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, allowedOrigins: [HOSTED], features: { hostedMode: true, workMode: true } }));
  agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), uiDir });
});
after(async () => { await agent?.stop(); rmHome(home); });

test('the build lists every site file with its SHA-256, every app included, and leaves out what is not the site', () => {
  for (const rel of ['index.html', 'sw.js', 'shell/shell.js', 'shared/workshop-sdk.js', 'apps/home/index.html', 'apps/slate/index.html', 'apps/settings/index.html', 'apps/registry.json', 'apps/prioritizer/index.html', 'apps/prioritizer/js/main.js', 'apps/runway/index.html', 'apps/receipts/index.html', 'apps/notes/index.html']) {
    assert.match(build.files[rel] || '', /^[0-9a-f]{64}$/, rel);
  }
  for (const rel of Object.keys(build.files)) {
    assert.ok(safeRel(rel), rel);
    assert.ok(!/(^|\/)test\//.test(rel), `${rel} is a test file`);
    assert.ok(!rel.startsWith('agent/') && !rel.startsWith('connectors/') && !rel.startsWith('tests/'), rel);
  }
  const reg = JSON.parse(fs.readFileSync(path.join(uiDir, 'apps', 'registry.json'), 'utf8'));
  for (const id of ['prioritizer', 'runway', 'receipts', 'notes']) assert.ok(reg.apps.some(a => a.manifest.id === id), `${id} is in the registry`);
  assert.equal(build.workshop.ref, 'v0.0.1');
  assert.equal(verifyPinned(uiDir).ok, true);
});

test('work mode serves the hub at "/" and every app from the pinned copy, with the security headers', async () => {
  const hub = await get(agent, '/', { auth: 'none' });
  assert.equal(hub.status, 200);
  assert.equal(hub.text, fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
  assert.match(hub.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(hub.headers['x-frame-options'], 'SAMEORIGIN');
  for (const p of ['/index.html', '/shell/shell.js', '/sw.js', '/manifest.webmanifest', '/apps/registry.json', '/apps/home/', '/apps/slate/index.html', '/apps/settings/', '/apps/prioritizer/', '/apps/prioritizer/js/main.js']) {
    assert.equal((await get(agent, p, { auth: 'none' })).status, 200, p);
  }
  const b = await get(agent, `/${BUILD_FILE}`, { auth: 'none' });
  assert.equal(b.status, 200);
  assert.equal(JSON.parse(b.text).workshop.ref, 'v0.0.1');
  // A folder without its slash redirects to it.
  const dir = await get(agent, '/apps/home', { auth: 'none' });
  assert.equal(dir.status, 301);
  assert.equal(dir.headers.location, '/apps/home/');
});

test('work mode never serves a file the build does not list, or anything outside the copy', async () => {
  fs.writeFileSync(path.join(uiDir, 'extra.js'), 'alert(1)');
  for (const p of ['/extra.js', '/apps/prioritizer/test/e2e.py', '/agent/server.mjs', '/config.json', '/token', '/../config.json', '/%2e%2e/token', '/apps/../../token', '/.git/config', '/shell/..%2f..%2ftoken']) {
    assert.equal((await get(agent, p, { auth: 'none' })).status, 404, p);
  }
});

test('a pinned file changed after the build is refused, and doctor-style checks see it', async () => {
  const file = path.join(uiDir, 'apps', 'home', 'index.html');
  const before = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, Buffer.concat([before, Buffer.from('<script>steal()</script>')]));
    const res = await get(agent, '/apps/home/', { auth: 'none' });
    assert.equal(res.status, 500);
    assert.ok(!res.text.includes('steal()'), 'the changed bytes are never sent');
    const v = verifyPinned(uiDir);
    assert.equal(v.ok, false);
    assert.match(v.problem, /apps\/home\/index\.html changed/);
  } finally { fs.writeFileSync(file, before); }
  assert.equal((await get(agent, '/apps/home/', { auth: 'none' })).status, 200);
});

test('work mode refuses hosted origins and pairing even though the origin is allowed', async () => {
  assert.equal((await get(agent, '/api/apps', { origin: HOSTED })).status, 403);
  const pair = await get(agent, `/pair?origin=${encodeURIComponent(HOSTED)}`, { auth: 'cookie' });
  assert.equal(pair.status, 403);
  assert.ok(!pair.text.includes('workshop-pair'));
});

test('with no pinned copy, work mode builds one from this install when it starts', async () => {
  const other = tempHome();
  fs.writeFileSync(path.join(other, 'config.json'), JSON.stringify({ configVersion: 1, features: { workMode: true } }));
  const a = await createAgent({ home: other, port: 0, dataDir: dataDirOf(other) });
  try {
    assert.equal(fs.existsSync(path.join(other, 'ui', BUILD_FILE)), true, 'built at start');
    assert.equal(verifyPinned(path.join(other, 'ui')).ok, true);
    assert.equal((await get(a, '/', { auth: 'none' })).status, 200);
  } finally { await a.stop(); rmHome(other); }
});

test('a pinned copy whose files changed is not rebuilt by itself: "/" says why and Settings still opens', async () => {
  const other = tempHome();
  fs.writeFileSync(path.join(other, 'config.json'), JSON.stringify({ configVersion: 1, features: { workMode: true } }));
  const a = await createAgent({ home: other, port: 0, dataDir: dataDirOf(other) });
  try {
    fs.appendFileSync(path.join(other, 'ui', 'shell', 'shell.js'), '\n// changed');
    const res = await get(a, '/', { auth: 'none' });
    assert.equal(res.status, 503);
    assert.match(res.text, /workshop pin/);
    assert.equal((await get(a, '/apps/settings/', { auth: 'none' })).status, 200);
    assert.equal((await get(a, '/shell/shell.js', { auth: 'none' })).status, 404, 'no hub from the repo');
    assert.match(fs.readFileSync(path.join(other, 'ui', 'shell', 'shell.js'), 'utf8'), /changed$/, 'left as it is');
  } finally { await a.stop(); rmHome(other); }
});

test('a pin while the agent runs is picked up on the next request', async () => {
  const old = fs.readFileSync(path.join(uiDir, BUILD_FILE), 'utf8');
  try {
    buildPinned({ repo: REPO, outDir: uiDir, registry: d => buildRegistry(d, schemas), info: { workshop: { ref: 'v0.0.2' } }, now: new Date(Date.now() + 5000) });
    const res = await get(agent, `/${BUILD_FILE}`, { auth: 'none' });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).workshop.ref, 'v0.0.2');
  } finally { fs.writeFileSync(path.join(uiDir, BUILD_FILE), old); }
});

test('with work mode off the agent serves only Settings, as before', async () => {
  const other = tempHome();
  const a = await createAgent({ home: other, port: 0, dataDir: dataDirOf(other), uiDir });
  try {
    const res = await get(a, '/', { auth: 'none' });
    assert.equal(res.status, 302);
    assert.equal((await get(a, '/shell/shell.js', { auth: 'none' })).status, 404);
    assert.equal((await get(a, `/${BUILD_FILE}`, { auth: 'none' })).status, 404);
  } finally { await a.stop(); rmHome(other); }
});

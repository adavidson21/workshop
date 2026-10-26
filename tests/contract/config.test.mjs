// docs/config.md and docs/agent-api.md (GET and PUT /api/config).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { startAgent, get, put, openEvents, expectJson, expectError, envelope, HOSTED } from './helpers.mjs';

let agent;
before(async () => { agent = await startAgent(); });
after(async () => { await agent?.stop(); });

test('defaults: everything that could be blocked is off', async () => {
  const body = expectJson(await get(agent, '/api/config'), 200, 'config-public');
  assert.deepEqual(body.allowedOrigins, []);
  assert.deepEqual(body.features, { startAtLogin: false, hostedMode: false });
  assert.equal(body.port, agent.port);
  assert.ok(Object.values(body.connectors).every(c => c.enabled === false));
});

test('features merge and origins replace', async () => {
  let body = expectJson(await put(agent, '/api/config', { features: { startAtLogin: true } }), 200, 'config-put-response');
  assert.deepEqual(body.config.features, { startAtLogin: true, hostedMode: false });
  assert.equal(body.restartRequired, false);
  body = expectJson(await put(agent, '/api/config', { features: { hostedMode: true }, allowedOrigins: [HOSTED, 'https://other.example.org'] }), 200, 'config-put-response');
  assert.deepEqual(body.config.features, { startAtLogin: true, hostedMode: true });
  body = expectJson(await put(agent, '/api/config', { allowedOrigins: [HOSTED] }), 200, 'config-put-response');
  assert.deepEqual(body.config.allowedOrigins, [HOSTED]);
  assert.deepEqual(expectJson(await get(agent, '/api/config'), 200, 'config-public').allowedOrigins, [HOSTED]);
});

test('the new origin is honored right away', async () => { // needs the test above
  const res = await get(agent, '/api/apps', { origin: HOSTED });
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], HOSTED);
});

test('a port change is saved and needs a restart', async () => {
  const body = expectJson(await put(agent, '/api/config', { port: agent.port === 4381 ? 4382 : 4381 }), 200, 'config-put-response');
  assert.equal(body.restartRequired, true);
  assert.notEqual(body.config.port, agent.port);
});

test('invalid changes are refused', async () => {
  const bad = [
    { allowedOrigins: ['https://*.example.org'] },
    { allowedOrigins: ['http://work.example.org'] },
    { allowedOrigins: ['https://work.example.org/'] },
    { features: { telemetry: true } },
    { connectors: { echo: { enabled: true, config: {} } } },
    { port: 80 },
    { token: 'x' }
  ];
  for (const b of bad) expectError(await put(agent, '/api/config', b), 400, 'invalid_config');
});

test('config writes need the header token', async () => {
  expectError(await put(agent, '/api/config', { features: { hostedMode: false } }, { auth: 'cookie' }), 401, 'unauthorized');
});

test('the data folder is reported, and is not the Workshop home', async () => {
  const body = expectJson(await get(agent, '/api/config'), 200, 'config-public');
  assert.equal(body.dataDir, agent.dataDir);
  assert.notEqual(path.resolve(body.dataDir), path.resolve(body.home));
});

test('a data folder change is saved, needs a restart, and moves nothing until then', async () => {
  const next = path.join(agent.root, 'Elsewhere');
  const body = expectJson(await put(agent, '/api/config', { dataDir: next }), 200, 'config-put-response');
  assert.equal(body.restartRequired, true);
  assert.equal(body.config.dataDir, next);
  assert.equal(expectJson(await get(agent, '/api/config'), 200, 'config-public').dataDir, next);
  await put(agent, '/api/data/notes/still-here', envelope('notes', 'still-here'));
  assert.ok(fs.existsSync(path.join(agent.dataDir, 'notes', 'still-here.json')), 'the folder in use until restart');
  assert.ok(!fs.existsSync(next), 'nothing created or copied in the new folder');
  const same = expectJson(await put(agent, '/api/config', { dataDir: agent.dataDir }), 200, 'config-put-response');
  assert.equal(same.restartRequired, false, 'back to the folder in use');
});

test('a data folder change sends a config event', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    await put(agent, '/api/config', { dataDir: agent.dataDir });
    await es.next('config', d => d.changed.includes('dataDir'));
  } finally { es.close(); }
});

test('the data folder must be absolute and outside the Workshop home', async () => {
  for (const dataDir of ['Workshop', '~/Workshop', './data', '', '$HOME/Workshop', '%USERPROFILE%\\Workshop', 42]) {
    expectError(await put(agent, '/api/config', { dataDir }), 400, 'invalid_config');
  }
  expectError(await put(agent, '/api/config', { dataDir: agent.home }), 400, 'invalid_config');
  expectError(await put(agent, '/api/config', { dataDir: path.join(agent.home, 'data') }), 400, 'invalid_config');
});

test('hosted origins cannot change the data folder', async () => {
  const hosted = await startAgent({ allowedOrigins: [HOSTED], features: { hostedMode: true } });
  try {
    expectError(await put(hosted, '/api/config', { dataDir: path.join(hosted.root, 'Elsewhere') }, { origin: HOSTED }), 403, 'local_only');
  } finally { await hosted.stop(); }
});

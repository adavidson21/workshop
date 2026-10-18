// docs/config.md and docs/agent-api.md (GET and PUT /api/config).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent, get, put, expectJson, expectError, HOSTED } from './helpers.mjs';

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

test('the new origin is honored right away', async () => {
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

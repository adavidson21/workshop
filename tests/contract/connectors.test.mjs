// docs/agent-api.md (connector endpoints) and docs/connector.md, using tests/fixtures/connectors/echo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent, get, put, post, request, expectJson, expectError, openEvents, schemas, SECRET, pendingOnAgent } from './helpers.mjs';

let agent;
before(async () => { agent = await startAgent(); });
after(async () => { await agent?.stop(); });

const enable = on => put(agent, '/api/config', { connectors: { echo: { enabled: on } } });

test('connectors are listed even when off', async () => {
  const body = expectJson(await get(agent, '/api/connectors'), 200, 'connectors-response');
  const echo = body.connectors.find(c => c.id === 'echo');
  assert.equal(echo.enabled, false);
  assert.equal(echo.status.state, 'disabled');
  assert.deepEqual(echo.actions.map(a => [a.name, a.write]), [['echo', false], ['record', true], ['envProbe', false], ['fail', false]]);
  assert.deepEqual(echo.test, { action: 'echo', arg: 'text', label: 'Text' });
  expectJson(await get(agent, '/api/connectors/echo'), 200, 'connector-info');
  expectError(await get(agent, '/api/connectors/nope'), 404, 'not_found');
  expectError(await get(agent, '/api/connectors/Bad_Name'), 400, 'bad_request');
});

test('calling an action on a disabled connector', async () => {
  expectError(await post(agent, '/api/connectors/echo/echo', { args: { text: 'x' } }), 503, 'disabled');
});

// The PUT /api/config response now carries dataDir: to-do on the agent until WS11b.
test('enabling starts it and sends connector-status', { todo: pendingOnAgent('WS11b') }, async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    expectJson(await enable(true), 200, 'config-put-response');
    const e = await es.next('connector-status', d => d.id === 'echo' && d.status.state === 'ready');
    schemas.assert('event', e, 'connector-status event');
    const cfg = await es.next('config');
    assert.ok(cfg.data.changed.includes('connectors'));
  } finally { es.close(); }
  const info = expectJson(await get(agent, '/api/connectors/echo'), 200, 'connector-info');
  assert.equal(info.enabled, true);
  assert.equal(info.status.state, 'ready');
});

test('read actions run and return result', async () => {
  const body = expectJson(await post(agent, '/api/connectors/echo/echo', { args: { text: 'hello' } }), 200, 'connector-call-response');
  assert.equal(body.result.greeting, 'Hello');
  assert.equal(body.result.text, 'hello');
  assert.equal(body.result.tokenSet, true);
});

test('args are checked against argsSchema', async () => {
  expectError(await post(agent, '/api/connectors/echo/echo', { args: {} }), 400, 'bad_request');
  expectError(await post(agent, '/api/connectors/echo/echo', { args: { text: 5 } }), 400, 'bad_request');
  expectError(await post(agent, '/api/connectors/echo/echo', { args: [] }), 400, 'bad_request');
  expectError(await post(agent, '/api/connectors/echo/echo', { args: { text: 'x' }, extra: 1 }), 400, 'bad_request');
});

test('write actions need confirm: true', async () => {
  expectError(await post(agent, '/api/connectors/echo/record', { args: { note: 'a' } }), 400, 'confirm_required');
  expectError(await post(agent, '/api/connectors/echo/record', { args: { note: 'a' }, confirm: false }), 400, 'confirm_required');
  const ok = expectJson(await post(agent, '/api/connectors/echo/record', { args: { note: 'a' }, confirm: true }), 200, 'connector-call-response');
  assert.equal(ok.result.count, 1);
  const again = expectJson(await post(agent, '/api/connectors/echo/record', { args: { note: 'b' }, confirm: true }), 200, 'connector-call-response');
  assert.equal(again.result.count, 2, 'private storage keeps values between calls');
});

test('connectors can read only environment variables named in their config', async () => {
  const body = expectJson(await post(agent, '/api/connectors/echo/envProbe', {}), 200, 'connector-call-response');
  assert.equal(body.result.threw, true);
});

test('errors thrown by actions keep their status and code', async () => {
  const body = expectError(await post(agent, '/api/connectors/echo/fail', {}), 503, 'unavailable');
  assert.equal(body.error, 'The echo service is not answering.');
});

test('unknown and malformed actions; wrong method', async () => {
  expectError(await post(agent, '/api/connectors/echo/nope', {}), 404, 'not_found');
  expectError(await post(agent, '/api/connectors/echo/Bad-Action', {}), 400, 'bad_request');
  expectError(await get(agent, '/api/connectors/echo/echo'), 405, 'method_not_allowed');
  expectError(await post(agent, '/api/connectors/echo/toString', {}), 404, 'not_found');
});

test('config: schema, defaults, and env status without the value', async () => {
  const res = await get(agent, '/api/connectors/echo/config');
  const body = expectJson(res, 200, 'connector-config');
  assert.deepEqual(body.config, { greeting: 'Hello', tokenEnv: 'ECHO_TOKEN', mode: 'plain', failStart: false });
  assert.deepEqual(body.env, { ECHO_TOKEN: { set: true } });
  assert.equal(body.schema.properties.tokenEnv['x-workshop-env'], true);
  assert.ok(!res.text.includes(SECRET), 'the secret value must never be returned');
});

test('config: an unset variable shows set: false', async () => {
  const body = expectJson(await put(agent, '/api/connectors/echo/config', { config: { greeting: 'Hi', tokenEnv: 'ECHO_MISSING' } }), 200, 'connector-config');
  assert.deepEqual(body.env, { ECHO_MISSING: { set: false } });
  const call = expectJson(await post(agent, '/api/connectors/echo/echo', { args: { text: 'x' } }), 200, 'connector-call-response');
  assert.equal(call.result.tokenSet, false);
});

test('config: valid changes restart the connector and apply', async () => {
  const before = (await get(agent, '/api/connectors/echo')).json.status.details.starts;
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    const body = expectJson(await put(agent, '/api/connectors/echo/config', { config: { greeting: 'Hey', mode: 'loud' } }), 200, 'connector-config');
    assert.equal(body.config.greeting, 'Hey');
    const cfg = await es.next('config', d => d.changed.includes('connector:echo'));
    schemas.assert('event', cfg, 'config event');
  } finally { es.close(); }
  const after = (await get(agent, '/api/connectors/echo')).json.status.details.starts;
  assert.equal(after, before + 1);
  const call = (await post(agent, '/api/connectors/echo/echo', { args: { text: 'quiet' } })).json;
  assert.deepEqual([call.result.greeting, call.result.text], ['Hey', 'QUIET']);
});

test('config: invalid changes are refused and nothing changes', async () => {
  expectError(await put(agent, '/api/connectors/echo/config', { config: { greeting: 'x', apiKey: 'secret' } }), 400, 'invalid_config');
  expectError(await put(agent, '/api/connectors/echo/config', { config: { mode: 'shouting' } }), 400, 'invalid_config');
  expectError(await put(agent, '/api/connectors/echo/config', { greeting: 'not wrapped' }), 400, 'bad_request');
  assert.equal((await get(agent, '/api/connectors/echo/config')).json.config.greeting, 'Hey');
});

test('a connector that fails to start reports error and refuses calls', async () => {
  await put(agent, '/api/connectors/echo/config', { config: { greeting: 'Hey', failStart: true } });
  const info = expectJson(await get(agent, '/api/connectors/echo'), 200, 'connector-info');
  assert.equal(info.status.state, 'error');
  assert.equal(info.status.message, 'Start failed on purpose.');
  expectError(await post(agent, '/api/connectors/echo/echo', { args: { text: 'x' } }), 503, 'unavailable');
  await put(agent, '/api/connectors/echo/config', { config: { greeting: 'Hey' } });
  assert.equal((await get(agent, '/api/connectors/echo')).json.status.state, 'ready');
});

test('disabling stops it', async () => {
  const es = await openEvents(agent);
  try {
    await es.next('hello');
    await enable(false);
    await es.next('connector-status', d => d.id === 'echo' && d.status.state === 'disabled');
  } finally { es.close(); }
  expectError(await post(agent, '/api/connectors/echo/echo', { args: { text: 'x' } }), 503, 'disabled');
  expectJson(await get(agent, '/api/connectors/echo/config'), 200, 'connector-config');
});

test('connector config writes need the header token', async () => {
  expectError(await request(agent, 'PUT', '/api/connectors/echo/config', { body: { config: {} }, auth: 'cookie' }), 401, 'unauthorized');
});

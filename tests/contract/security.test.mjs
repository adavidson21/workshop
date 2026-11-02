// docs/agent-api.md (Security) and docs/run-modes.md (Pairing).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAgent, request, get, put, expectJson, expectError, HOSTED } from './helpers.mjs';

let agent, hosted;
before(async () => {
  agent = await startAgent();
  hosted = await startAgent({ allowedOrigins: [HOSTED], features: { hostedMode: true } });
});
after(async () => { await agent?.stop(); await hosted?.stop(); });

test('health needs no token and says what it is', async () => {
  const body = expectJson(await get(agent, '/api/health', { auth: 'none' }), 200, 'health');
  assert.equal(body.app, 'workshop-agent');
  assert.equal(body.api, 1);
});

test('health answers on localhost too', async () => {
  expectJson(await get(agent, '/api/health', { auth: 'none', host: `localhost:${agent.port}` }), 200, 'health');
});

test('a foreign Host is refused (DNS rebinding)', async () => {
  expectError(await get(agent, '/api/health', { auth: 'none', host: `evil.example:${agent.port}` }), 403, 'forbidden');
  expectError(await get(agent, '/api/apps', { host: `127.0.0.1:${agent.port + 1}` }), 403, 'forbidden');
});

test('a foreign Origin is refused even with the token', async () => {
  expectError(await get(agent, '/api/apps', { origin: 'https://evil.example' }), 403, 'forbidden');
  expectError(await get(agent, '/api/health', { auth: 'none', origin: 'https://evil.example' }), 403, 'forbidden');
});

test('the agent\'s own origin is accepted', async () => {
  expectJson(await get(agent, '/api/apps', { origin: `http://127.0.0.1:${agent.port}` }), 200, 'apps-response');
  expectJson(await get(agent, '/api/apps', { origin: `http://localhost:${agent.port}` }), 200, 'apps-response');
});

test('API calls without a token are refused', async () => {
  expectError(await get(agent, '/api/apps', { auth: 'none' }), 401, 'unauthorized');
  expectError(await get(agent, '/api/apps', { auth: 'none', headers: { 'X-Workshop-Token': 'wrong' } }), 401, 'unauthorized');
  expectError(await get(agent, '/api/config', { auth: 'none', headers: { Cookie: 'workshop_token=wrong' } }), 401, 'unauthorized');
});

test('the cookie works for reads but writes need the header', async () => {
  expectJson(await get(agent, '/api/apps', { auth: 'cookie' }), 200, 'apps-response');
  const env = { schema: 'notes.pages', version: 1, rev: 0, items: [] };
  expectError(await put(agent, '/api/data/notes/pages', env, { auth: 'cookie' }), 401, 'unauthorized');
  expectError(await put(agent, '/api/data/notes/pages', env, { auth: 'none' }), 401, 'unauthorized');
});

test('opening the launcher URL sets the cookie and drops the token from the URL', async () => {
  const res = await get(agent, `/?token=${agent.token}&x=1`, { auth: 'none' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/?x=1');
  const cookie = String(res.headers['set-cookie']);
  assert.match(cookie, new RegExp(`^workshop_token=${agent.token};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});

test('a wrong launcher token sets no cookie', async () => {
  const res = await get(agent, '/?token=wrong', { auth: 'none' });
  assert.equal(res.status, 303);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('session returns the token to the agent\'s own pages only', async () => {
  const body = expectJson(await get(agent, '/api/session', { auth: 'cookie' }), 200, 'session');
  assert.equal(body.token, agent.token);
  assert.equal(body.agentOrigin, `http://127.0.0.1:${agent.port}`);
  expectError(await get(agent, '/api/session', { auth: 'none' }), 401, 'unauthorized');
  expectError(await get(hosted, '/api/session', { auth: 'cookie', origin: HOSTED }), 403, 'forbidden');
});

test('the token never appears in other responses', async () => {
  for (const p of ['/api/health', '/api/apps', '/api/config', '/api/connectors', '/api/connectors/echo/config']) {
    const res = await get(agent, p);
    assert.ok(!res.text.includes(agent.token), `${p} leaked the token`);
  }
});

test('hosted origins are refused while hosted mode is off', async () => {
  const off = await startAgent({ allowedOrigins: [HOSTED], features: { hostedMode: false } });
  try { expectError(await get(off, '/api/apps', { origin: HOSTED }), 403, 'forbidden'); }
  finally { await off.stop(); }
});

test('an allowed hosted origin gets CORS for that origin only', async () => {
  const res = await get(hosted, '/api/apps', { origin: HOSTED });
  expectJson(res, 200, 'apps-response');
  assert.equal(res.headers['access-control-allow-origin'], HOSTED);
  assert.match(res.headers.vary || '', /Origin/);
  assert.equal(res.headers['access-control-allow-credentials'], undefined);
  expectError(await get(hosted, '/api/apps', { origin: 'https://other.example.org' }), 403, 'forbidden');
  const own = await get(hosted, '/api/apps');
  assert.equal(own.headers['access-control-allow-origin'], undefined);
});

test('preflight from an allowed origin allows the token header and private network access', async () => {
  const res = await request(hosted, 'OPTIONS', '/api/data/notes/pages', {
    auth: 'none', origin: HOSTED,
    headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type, x-workshop-token', 'Access-Control-Request-Private-Network': 'true' }
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], HOSTED);
  assert.match(res.headers['access-control-allow-methods'], /PUT/);
  assert.match(res.headers['access-control-allow-headers'], /X-Workshop-Token/i);
  assert.equal(res.headers['access-control-allow-private-network'], 'true');
  expectError(await request(hosted, 'OPTIONS', '/api/apps', { auth: 'none', origin: 'https://evil.example' }), 403, 'forbidden');
});

test('config changes are refused from hosted origins', async () => {
  expectError(await put(hosted, '/api/config', { features: { startAtLogin: true } }, { origin: HOSTED }), 403, 'local_only');
});

test('connector config changes are refused from hosted origins, except fields marked x-workshop-hosted', async () => {
  expectError(await put(hosted, '/api/connectors/echo/config', { config: { greeting: 'Hello', tokenEnv: 'OTHER_SECRET' } }, { origin: HOSTED }), 403, 'local_only');
  // A field the connector marks x-workshop-hosted can be changed from a paired hosted page.
  const saved = expectJson(await put(hosted, '/api/connectors/echo/config', { config: { greeting: 'Hi there' } }, { origin: HOSTED }), 200, 'connector-config');
  assert.equal(saved.config.greeting, 'Hi there');
  // Changing a marked field together with an unmarked one is refused as a whole, and nothing is saved.
  const mixed = expectError(await put(hosted, '/api/connectors/echo/config', { config: { greeting: 'Hey', mode: 'loud' } }, { origin: HOSTED }), 403, 'local_only');
  assert.match(mixed.error, /mode/);
  assert.equal(expectJson(await get(hosted, '/api/connectors/echo/config', { origin: HOSTED }), 200, 'connector-config').config.greeting, 'Hi there');
});

test('pairing needs the cookie, hosted mode, and a listed origin', async () => {
  const enc = encodeURIComponent(HOSTED);
  // A pairing window opened from the hosted site arrives without the SameSite=Strict cookie: the page reloads
  // itself once (a same-site navigation, which carries it), and only then says to open Workshop first.
  const first = await get(hosted, `/pair?origin=${enc}`, { auth: 'none' });
  assert.equal(first.status, 200);
  assert.ok(first.text.includes('location.replace(') && first.text.includes('again=1'), 'reloads once, same-site');
  assert.ok(!first.text.includes('workshop-pair'), 'no token without the cookie');
  const noCookie = await get(hosted, `/pair?origin=${enc}&again=1`, { auth: 'none' });
  assert.equal(noCookie.status, 401);
  const notListed = await get(hosted, `/pair?origin=${encodeURIComponent('https://other.example.org')}`, { auth: 'cookie' });
  assert.equal(notListed.status, 403);
  const bad = await get(hosted, '/pair?origin=javascript:alert(1)', { auth: 'cookie' });
  assert.equal(bad.status, 403);
  const off = await get(agent, `/pair?origin=${enc}`, { auth: 'cookie' });
  assert.equal(off.status, 403);
  const ok = await get(hosted, `/pair?origin=${enc}`, { auth: 'cookie' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /^text\/html/);
  assert.ok(ok.text.includes(HOSTED));
  assert.ok(ok.text.includes('workshop-pair'));
  for (const r of [first, noCookie, notListed, bad, off, ok]) {
    assert.match(r.headers['content-security-policy'] || '', /frame-ancestors 'none'/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
  }
});

test('static paths cannot leave the served folders', async () => {
  for (const p of ['/../package.json', '/%2e%2e/tests/mock-agent.mjs', '/tests/mock-agent.mjs', '/apps/../../tests/mock-agent.mjs', '/apps/notes/%2e%2e/%2e%2e/connectors/echo/index.mjs', '/.git/config']) {
    const res = await get(agent, p, { auth: 'none' });
    assert.equal(res.status, 404, `${p} gave ${res.status}`);
  }
});

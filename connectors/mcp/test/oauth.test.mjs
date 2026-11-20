// MCP sign-in (connector 1.1.0): discovery, registration, PKCE, tokens at rest, refresh, and `workshop mcp login`,
// against a fake MCP server with an OAuth server (a fetch function). Nothing reaches the network. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import connector, { setFetch } from '../index.mjs';
import { authorizeUrl, discover, exchange, needsRefresh, newKey, pkce, refresh, register, resourceMetadataUrl, seal, unseal } from '../lib/oauth.mjs';
import { main } from '../../../workshop.mjs';

const MCP = 'https://mcp.example.test/mcp';
const AUTH = 'https://auth.example.test';

/** A fake MCP server behind OAuth: 401 with resource metadata until it gets a token it issued. */
function fakeOAuth({ rotate = true, expiresIn = 3600 } = {}) {
  const s = { clients: [], codes: new Map(), access: new Set(), refreshes: new Map(), calls: [], now: () => Date.now() };
  let n = 0;
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  s.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    s.calls.push(`${method} ${u.origin}${u.pathname}`);
    if (u.href.startsWith(MCP) && method === 'POST') {
      const auth = (init.headers || {}).Authorization || '';
      if (!s.access.has(auth.replace(/^Bearer /, ''))) return new Response('no', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"` } });
      const m = JSON.parse(init.body);
      if (m.id === undefined) return new Response(null, { status: 202 });
      const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {} } : m.method === 'tools/list' ? { tools: [{ name: 'list_issues', annotations: { readOnlyHint: true } }] } : { content: [{ type: 'text', text: 'ok' }] };
      return json({ jsonrpc: '2.0', id: m.id, result });
    }
    if (u.href === 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp') return json({ resource: MCP, authorization_servers: [AUTH], scopes_supported: ['read'] });
    if (u.href === `${AUTH}/.well-known/oauth-authorization-server`) return json({ issuer: AUTH, authorization_endpoint: `${AUTH}/authorize`, token_endpoint: `${AUTH}/token`, registration_endpoint: `${AUTH}/register`, code_challenge_methods_supported: ['S256'] });
    if (u.href === `${AUTH}/register`) { const b = JSON.parse(init.body); s.clients.push(b); return json({ client_id: `client-${s.clients.length}`, redirect_uris: b.redirect_uris }, 201); }
    if (u.href === `${AUTH}/token`) {
      const f = Object.fromEntries(new URLSearchParams(init.body));
      const issue = () => { const a = `at-${++n}`, r = `rt-${n}`; s.access.add(a); s.refreshes.set(r, true); return json({ access_token: a, refresh_token: r, expires_in: expiresIn, token_type: 'Bearer' }); };
      if (f.resource !== MCP) return json({ error: 'invalid_target' }, 400);
      if (f.grant_type === 'authorization_code') {
        const c = s.codes.get(f.code);
        if (!c || crypto.createHash('sha256').update(f.code_verifier).digest('base64url') !== c.challenge || c.redirect !== f.redirect_uri) return json({ error: 'invalid_grant' }, 400);
        s.codes.delete(f.code);
        return issue();
      }
      if (f.grant_type === 'refresh_token') {
        if (!s.refreshes.get(f.refresh_token)) return json({ error: 'invalid_grant', error_description: 'refresh token used or revoked' }, 400);
        if (rotate) s.refreshes.set(f.refresh_token, false);
        return issue();
      }
    }
    return new Response('not found', { status: 404 });
  };
  /** What the browser does: the person signs in, the server redirects with a code. */
  s.approve = (authorize) => {
    const q = new URL(authorize).searchParams;
    const code = `code-${crypto.randomBytes(4).toString('hex')}`;
    s.codes.set(code, { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri') });
    return { code, state: q.get('state') };
  };
  return s;
}

test('discovery, registration, PKCE sign-in and refresh follow the MCP authorization spec', async () => {
  const s = fakeOAuth();
  assert.equal(resourceMetadataUrl('Bearer error="x", resource_metadata="https://a/b"'), 'https://a/b');
  const meta = await discover(MCP, s.fetch);
  assert.deepEqual(meta, { resource: MCP, issuer: AUTH, authorization_endpoint: `${AUTH}/authorize`, token_endpoint: `${AUTH}/token`, registration_endpoint: `${AUTH}/register`, scopes: ['read'] });
  const client = await register(meta, 'http://127.0.0.1:5555/callback', s.fetch);
  assert.deepEqual(s.clients[0].redirect_uris, ['http://127.0.0.1:5555/callback']);
  assert.equal(s.clients[0].token_endpoint_auth_method, 'none', 'a public client: no secret to keep');
  const p = pkce();
  const url = authorizeUrl(meta, { client_id: client.client_id, redirect_uri: 'http://127.0.0.1:5555/callback', challenge: p.challenge, state: 'st', scope: 'read' });
  const q = new URL(url).searchParams;
  assert.deepEqual([q.get('code_challenge_method'), q.get('resource'), q.get('state'), q.get('scope')], ['S256', MCP, 'st', 'read']);
  const { code } = s.approve(url);
  await assert.rejects(exchange(meta, client, { code, verifier: 'wrong', redirect_uri: 'http://127.0.0.1:5555/callback' }, s.fetch), /refused/);
  const again = s.approve(url);
  const rec = await exchange(meta, client, { code: again.code, verifier: p.verifier, redirect_uri: 'http://127.0.0.1:5555/callback' }, s.fetch, 1000);
  assert.deepEqual([rec.access_token, rec.refresh_token, rec.expires_at], ['at-1', 'rt-1', 1000 + 3600 * 1000]);
  assert.equal(needsRefresh(rec, 1000), false);
  assert.equal(needsRefresh(rec, 1000 + 3600 * 1000 - 30000), true, 'a minute early');
  const next = await refresh(rec, s.fetch);
  assert.deepEqual([next.access_token, next.refresh_token], ['at-2', 'rt-2']);
  await assert.rejects(refresh(rec, s.fetch), /used or revoked/, 'a rotated refresh token works once');
});

test('the sign-in at rest: sealed with the key from the secret store, useless without it', () => {
  const key = newKey();
  const box = seal(key, { access_token: 'at-secret-value', refresh_token: 'rt-secret-value' });
  assert.ok(!JSON.stringify(box).includes('secret-value'), 'never in the clear');
  assert.equal(unseal(key, box).access_token, 'at-secret-value');
  assert.throws(() => unseal(newKey(), box), /does not match the key/);
  assert.throws(() => unseal('short', box), /not one Workshop made/);
  assert.throws(() => unseal(key, null), /No sign-in saved/);
});

function oauthCtx(s, { key, box } = {}) {
  const store = new Map(box ? [['oauth-linear', box]] : []);
  return {
    store,
    ctx: {
      config: Object.freeze({ servers: [{ id: 'linear', name: 'Linear', url: MCP, auth: 'oauth', tokenSecret: 'linear-signin', trustReadOnly: true, enabled: true }] }),
      secret: async n => (n === 'linear-signin' ? key : undefined),
      storage: { get: async k => store.get(k), put: async (k, v) => { store.set(k, v); } },
      workMode: () => false, log: { info() {}, warn() {}, error() {} }, emit() {}, statusChanged() {}, signal: new AbortController().signal
    }
  };
}

test('the connector sends the access token, refreshes it when it runs out or is refused, and saves the new one sealed', async () => {
  const s = fakeOAuth();
  setFetch(s.fetch);
  const meta = await discover(MCP, s.fetch);
  const client = await register(meta, 'http://127.0.0.1:1/callback', s.fetch);
  const p = pkce();
  const url = authorizeUrl(meta, { client_id: client.client_id, redirect_uri: 'http://127.0.0.1:1/callback', challenge: p.challenge, state: 'x' });
  const rec = await exchange(meta, client, { code: s.approve(url).code, verifier: p.verifier, redirect_uri: 'http://127.0.0.1:1/callback' }, s.fetch);
  const key = newKey();
  // Not signed in yet: says how.
  const empty = oauthCtx(s, { key });
  await assert.rejects(connector.actions['tools.list'].run({ server: 'linear' }, empty.ctx), /Not signed in to Linear\. In a terminal run: workshop mcp login linear/);
  // Signed in: tools list with the access token.
  const c = oauthCtx(s, { key, box: seal(key, rec) });
  assert.deepEqual((await connector.actions['tools.list'].run({ server: 'linear' }, c.ctx)).map(t => t.name), ['list_issues']);
  // The server revokes the access token: one refresh, saved sealed, and the call goes through.
  s.access.clear();
  const r = await connector.actions['tools.read'].run({ server: 'linear', tool: 'list_issues', arguments: {} }, c.ctx);
  assert.equal(r.text, 'ok');
  const saved = unseal(key, c.store.get('oauth-linear'));
  assert.deepEqual([saved.access_token, saved.refresh_token], ['at-2', 'rt-2']);
  // Expired by the clock: refreshed before the call.
  c.store.set('oauth-linear', seal(key, { ...saved, expires_at: Date.now() - 1 }));
  await connector.actions['tools.read'].run({ server: 'linear', tool: 'list_issues', arguments: {} }, c.ctx);
  assert.equal(unseal(key, c.store.get('oauth-linear')).access_token, 'at-3');
  // A refresh the server refuses: sign in again.
  s.access.clear(); s.refreshes.clear();
  await assert.rejects(connector.actions['tools.read'].run({ server: 'linear', tool: 'list_issues', arguments: {} }, c.ctx), /workshop mcp login linear/);
});

test('workshop mcp login: browser sign-in, the key in the secret store, the tokens sealed in the connector storage; logout forgets both', async () => {
  const s = fakeOAuth();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-mcp-login-'));
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ version: 1, connectors: { mcp: { enabled: true, config: { servers: [
      { id: 'linear', name: 'Linear', url: MCP, auth: 'oauth', tokenSecret: 'linear-signin' }, { id: 'gh', name: 'GitHub', url: 'https://gh.example.test/mcp', tokenSecret: 'gh-mcp' }] } } } }));
    const stored = {}, lines = [];
    let opened = null, port = 41234;
    const io = {
      out: l => lines.push(l), env: { WORKSHOP_HOME: home }, platform: 'darwin', fetch: s.fetch,
      openUrl: u => { opened = u; },
      listen: async () => ({ port, wait: async () => s.approve(opened), close() {} }),
      secretStore: { save: async (h, n, v) => { stored[n] = v; return { ok: true }; }, remove: (h, n) => { delete stored[n]; return { ok: true }; } }
    };
    assert.equal(await main(['mcp', 'login', 'gh'], io), 1);
    assert.match(lines.join('\n'), /GitHub is set to use a token/);
    assert.equal(await main(['mcp', 'login', 'linear'], io), 0, lines.join('\n'));
    assert.match(opened, /^https:\/\/auth\.example\.test\/authorize\?/);
    assert.equal(new URL(opened).searchParams.get('redirect_uri'), `http://127.0.0.1:${port}/callback`);
    const file = path.join(home, 'data', '_connectors', 'mcp', 'oauth-linear.json');
    const box = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(!JSON.stringify(box).includes('at-1'), 'no token in the clear on disk');
    assert.equal(unseal(stored['linear-signin'], box).access_token, 'at-1');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.match(lines.join('\n'), /Signed in to Linear/);
    // A redirect for another sign-in is refused.
    io.listen = async () => ({ port, wait: async () => ({ code: 'x', state: 'not-ours' }), close() {} });
    assert.equal(await main(['mcp', 'login', 'linear'], io), 1);
    assert.match(lines.join('\n'), /not for this sign-in\. Nothing was saved/);
    assert.equal(await main(['mcp', 'logout', 'linear'], io), 0);
    assert.equal(fs.existsSync(file), false);
    assert.equal(stored['linear-signin'], undefined);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

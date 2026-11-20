// Tokens & sign-ins (agent/lib/credentials.mjs, docs/security.md, Secrets): Settings saves, lists and removes
// tokens without a terminal, and a token pasted where its name goes is moved into the secret store. The store is
// faked here (the real programs are covered by secrets.test.mjs and source.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, rmHome, start, logText, request } from './helpers.mjs';
import { readIndex } from '../lib/secrets.mjs';
import { saveSecret, removeSecret, looksLikeToken } from '../lib/secret-write.mjs';
import { envSecretName } from '../lib/stored-env.mjs';
import { movePastedTokens, freeName } from '../lib/credentials.mjs';

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyzABCDEF0123456789';

function fakeStore() {
  const map = new Map();
  const secrets = async name => map.get(name);
  secrets.forget = () => {};
  const secretWriter = {
    save: (h, n, v, o = {}) => saveSecret(h, n, v, { platform: 'linux', exec: () => { map.set(n, v); return { status: 0 }; }, read: async x => map.get(x), ...o }),
    remove: (h, n) => removeSecret(h, n, { platform: 'linux', exec: () => { map.delete(n); return { status: 0 }; } })
  };
  return { map, secrets, secretWriter };
}

async function withAgent(config, fn) {
  const home = tempHome();
  const s = fakeStore();
  const agent = await start(home, { connectors: { probe: { enabled: true, config } } }, { secrets: s.secrets, secretWriter: s.secretWriter, platform: 'linux' });
  try { await fn({ agent, home, ...s }); } finally { await agent.stop(); rmHome(home); }
}

test('looksLikeToken and envSecretName', () => {
  assert.equal(looksLikeToken(TOKEN), true);
  assert.equal(looksLikeToken('github-pat'), false);
  assert.equal(looksLikeToken('short'), false);
  assert.equal(envSecretName('ADO_PAT'), 'env-ado-pat');
  assert.equal(envSecretName('bad name'), null);
  assert.equal(freeName('github-token', new Set(['github-token'])), 'github-token-2');
});

test('movePastedTokens moves only tokens pasted into name fields', async () => {
  const schema = { type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { s: { type: 'string', 'x-workshop-secret': true }, n: { type: 'string' } } } } } };
  const seen = [];
  const out = await movePastedTokens(schema, { list: [{ s: TOKEN, n: TOKEN }, { s: 'gh' }] }, async (f, v) => { seen.push([f.path, v === TOKEN]); return 'gh-token'; });
  assert.deepEqual(out, { list: [{ s: 'gh-token', n: TOKEN }, { s: 'gh' }] });
  assert.deepEqual(seen, [['list[0].s', true]]);
});

test('Settings saves a token: the value goes to the store only, never back to the page or into a file or log', async () => {
  await withAgent({}, async ({ agent, home, map }) => {
    const r = await request(agent, 'POST', '/api/secrets', { body: { name: 'probe-key', kind: 'token', value: TOKEN, expires: '2027-01-31' } });
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.json).includes(TOKEN));
    assert.equal(r.json.secret.set, true);
    assert.equal(map.get('probe-key'), TOKEN);
    assert.equal(readIndex(home)['probe-key'].expires, '2027-01-31');
    for (const f of ['config.json', 'secrets.json']) assert.ok(!fs.readFileSync(path.join(home, f), 'utf8').includes(TOKEN), f);
    // The connector reads it.
    const st = await request(agent, 'POST', '/api/connectors/probe/stored', { body: { args: {} } });
    assert.equal(st.status, 200);
    // Listed by name, with who uses it; never the value.
    const l = await request(agent, 'GET', '/api/secrets');
    assert.equal(l.status, 200);
    assert.ok(!JSON.stringify(l.json).includes(TOKEN));
    assert.deepEqual(l.json.secrets.find(s => s.name === 'probe-key').usedBy.map(u => u.connector), ['probe']);
    assert.ok(l.json.uses.some(u => u.connector === 'probe' && u.kind === 'secret' && u.saved));
    // Bad values are refused in words, and nothing is saved.
    const bad = await request(agent, 'POST', '/api/secrets', { body: { name: 'x1', value: 'has a space in it, so not a token' } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /spaces/);
    assert.equal(map.has('x1'), false);
    // Removing it.
    const del = await request(agent, 'DELETE', '/api/secrets/probe-key');
    assert.equal(del.status, 200);
    assert.equal(map.has('probe-key'), false);
    assert.equal(readIndex(home)['probe-key'], undefined);
    assert.ok(!logText(agent).includes(TOKEN));
  });
});

test('saving and removing need the token header and Workshop on this computer', async () => {
  await withAgent({}, async ({ agent, map }) => {
    const noHeader = await request(agent, 'POST', '/api/secrets', { auth: 'cookie', body: { name: 'a1', value: TOKEN } });
    assert.ok([401, 403].includes(noHeader.status));
    const page = await request(agent, 'POST', '/api/secrets', { origin: 'https://evil.example.org', body: { name: 'a1', value: TOKEN } });
    assert.equal(page.status, 403);
    assert.equal(map.size, 0);
  });
});

test('a variable\'s token saved from Settings is what the connector reads for that variable', async () => {
  await withAgent({ secretEnv: 'OTHER_PAT' }, async ({ agent, map }) => {
    const before = await request(agent, 'GET', '/api/connectors/probe/config');
    assert.equal(before.json.env.OTHER_PAT.set, false);
    const r = await request(agent, 'POST', '/api/secrets', { body: { env: 'OTHER_PAT', value: TOKEN } });
    assert.equal(r.status, 200);
    assert.equal(r.json.name, 'env-other-pat');
    assert.equal(map.get('env-other-pat'), TOKEN);
    const after = await request(agent, 'GET', '/api/connectors/probe/config');
    assert.equal(after.json.env.OTHER_PAT.set, true);
    assert.equal(after.json.env.OTHER_PAT.stored, true);
    // The leak fixture logs what ctx.env gives it: the saved token, which the log redacts.
    const leak = await request(agent, 'POST', '/api/connectors/probe/leak', { body: { args: {} } });
    assert.equal(leak.status, 200);
    await new Promise(res => setTimeout(res, 50));
    const log = logText(agent);
    assert.match(log, /the secret is/);
    assert.ok(!log.includes(TOKEN));
  });
});

test('a token pasted into a name field is moved into the store when Settings saves, and at start', async () => {
  await withAgent({}, async ({ agent, home, map }) => {
    const r = await request(agent, 'PUT', '/api/connectors/probe/config', { body: { config: { storedSecret: TOKEN } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.config.storedSecret, 'probe-key');
    assert.equal(map.get('probe-key'), TOKEN);
    assert.ok(!fs.readFileSync(path.join(home, 'config.json'), 'utf8').includes(TOKEN));
  });
  // Already in config.json (pasted before this version): moved at start.
  await withAgent({ storedSecret: TOKEN }, async ({ home, map }) => {
    assert.equal(map.get('probe-key'), TOKEN);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    assert.equal(cfg.connectors.probe.config.storedSecret, 'probe-key');
    assert.ok(!JSON.stringify(cfg).includes(TOKEN));
  });
});

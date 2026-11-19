// The GitHub connector through the agent API (mock agent and real agent): actions, status, and that the token
// never shows up in responses, errors or logs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockAgent } from '../../../tests/mock-agent.mjs';
import { start as startReal } from '../../../agent/test-target.mjs';
import { post, get } from '../../../tests/contract/helpers.mjs';
import { startFakeGitHub, TOKEN } from './fake-github.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const configFor = url => ({ connections: [{ name: 'github', apiUrl: url, tokenEnv: 'TEST_GH_TOKEN' }] });

async function withAgent(fn, { env = { TEST_GH_TOKEN: TOKEN } } = {}) {
  for (const kind of ['mock', 'real']) {
    const srv = await startFakeGitHub();
    const cfg = { configVersion: 1, connectors: { github: { enabled: true, config: configFor(srv.url) } } };
    const dirs = { connectorsDir: path.join(REPO, 'connectors'), appsDir: path.join(REPO, 'tests', 'fixtures', 'apps') };
    const lines = [];
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-github-'));
    const agent = kind === 'mock'
      ? await createMockAgent({ ...dirs, env, config: cfg, log: (who, level, msg) => lines.push(`${who} ${level} ${msg}`) })
      : await startReal({ ...dirs, home, env, config: cfg });
    const logs = () => (kind === 'mock' ? lines : fs.existsSync(path.join(home, 'logs'))
      ? fs.readdirSync(path.join(home, 'logs')).map(f => fs.readFileSync(path.join(home, 'logs', f), 'utf8')) : []);
    try {
      await fn({ agent, srv, logs, kind });
    } catch (e) {
      e.message = `[${kind} agent] ${e.message}`;
      throw e;
    } finally {
      await agent.stop();
      await srv.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

test('sync, sync.prs, workitem.get and areas.mine through the agent; no token anywhere', () => withAgent(async ({ agent, logs }) => {
  const sync = await post(agent, '/api/connectors/github/sync', { args: { known: ['acme/web#5'], knownPrs: [] } });
  assert.equal(sync.status, 200);
  const r = sync.json.result;
  assert.deepEqual(r.items.map(i => i.id).sort(), ['acme/web#1', 'acme/web#2', 'me/tools#9']);
  assert.equal(r.gone[0].reason, 'closed');
  assert.ok(r.prs.items.length >= 2);
  const prs = await post(agent, '/api/connectors/github/sync.prs', { args: { knownPrs: [] } });
  assert.equal(prs.status, 200);
  const it = await post(agent, '/api/connectors/github/workitem.get', { args: { id: 'acme/web#1', details: true } });
  assert.equal(it.json.result.type, 'Bug');
  const areas = await post(agent, '/api/connectors/github/areas.mine', { args: {} });
  assert.equal(areas.json.result.areas.length, 3);
  const all = JSON.stringify([sync.json, prs.json, it.json, areas.json]) + logs().join('\n');
  assert.ok(!all.includes(TOKEN));
}));

test('a missing token is an error status; a bad one is a plain-words error without the value', async () => {
  await withAgent(async ({ agent }) => {
    const list = await get(agent, '/api/connectors');
    const gh = (list.json.connectors || list.json).find(c => c.id === 'github');
    assert.equal(gh.status.state, 'error');
    assert.match(gh.status.message, /TEST_GH_TOKEN is not set/);
  }, { env: {} });
  await withAgent(async ({ agent, logs }) => {
    const res = await post(agent, '/api/connectors/github/sync', { args: {} });
    assert.equal(res.status, 503);
    assert.match(res.json.error, /rejected the token in TEST_GH_TOKEN/);
    assert.ok(!(JSON.stringify(res.json) + logs().join('\n')).includes('nope-not-it'));
  }, { env: { TEST_GH_TOKEN: 'nope-not-it' } });
});

test('setup actions work before a token is set', () => withAgent(async ({ agent }) => {
  const r = await post(agent, '/api/connectors/github/connection.resolve', { args: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.tokenSet, false);
  const u = await post(agent, '/api/connectors/github/config.fromUrl', { args: { url: 'https://github.com/acme/web' } });
  assert.equal(u.status, 200);
  assert.ok(Array.isArray(u.json.result.notes));
}, { env: {} }));

test('writes need confirm: true; with it, Loom-style calls (repo as connection) update and create', () => withAgent(async ({ agent, srv }) => {
  const no = await post(agent, '/api/connectors/github/workitem.update', { args: { id: 2, connection: 'acme/web', changes: { title: 'x' } } });
  assert.equal(no.status, 400);
  assert.equal(no.json.code, 'confirm_required');
  assert.equal(srv.data.writes.length, 0, 'nothing reached GitHub');
  const up = await post(agent, '/api/connectors/github/workitem.update', { args: { id: 2, connection: 'acme/web', changes: { title: 'Dark mode' } }, confirm: true });
  assert.equal(up.status, 200);
  assert.equal(up.json.result.title, 'Dark mode');
  const made = await post(agent, '/api/connectors/github/workitem.create', { args: { type: 'Bug', title: 'Crash', connection: 'acme/web' }, confirm: true });
  assert.equal(made.status, 200);
  assert.equal(made.json.result.type, 'Bug');
  const stale = await post(agent, '/api/connectors/github/workitem.update', { args: { id: 2, connection: 'acme/web', rev: 1, changes: { title: 'y' } }, confirm: true });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'conflict');
  const bl = await post(agent, '/api/connectors/github/backlog', { args: { areas: ['acme/web'], connection: 'acme/web' } });
  assert.equal(bl.status, 200);
  assert.ok(bl.json.result.items.some(i => i.id === 2 && i.title === 'Dark mode'));
}));

test('agent reads: GET on issues and pull requests only, GraphQL queries only', async () => {
  const { checkPath, checkQuery } = await import('../lib/agent-reads.mjs');
  assert.deepEqual(checkPath('/repos/me/app/issues/12'), { path: '/repos/me/app/issues/12', query: {} });
  assert.deepEqual(checkPath('/repos/me/app/pulls/3/reviews?per_page=100&page=2'), { path: '/repos/me/app/pulls/3/reviews', query: { per_page: '100', page: '2' } });
  assert.deepEqual(checkPath('/user').path, '/user');
  for (const bad of ['/repos/me/app/issues/12/../../../orgs/x', '/repos/me/app/hooks', '/orgs/me/members', '/repos/me/app/issues/12?state=all', '/repos/me/app/pulls/3/merge', '/repos/me/app/contents/x']) {
    assert.throws(() => checkPath(bad), /not one Workshop reads|Only page and per_page/, bad);
  }
  assert.equal(checkQuery('query($n:Int!){ repository(owner:"a",name:"b"){ issue(number:$n){ title } } }').length > 0, true);
  assert.equal(checkQuery('{ viewer { login } } # a mutation in a comment is fine').length > 0, true);
  assert.equal(checkQuery('{ search(query: "mutation") { issueCount } }').length > 0, true, 'the word in a string is fine');
  for (const bad of ['mutation { addComment(input:{}) { clientMutationId } }', 'query a { x } mutation b { y }', 'subscription { x }', '']) {
    assert.throws(() => checkQuery(bad), /Only queries|Send a GraphQL query/, bad);
  }
});

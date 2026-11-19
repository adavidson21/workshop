// Tools for agents (/api/tools, docs/agent-api.md) and ctx.secret (docs/connector.md), through a running agent with
// the probe fixture connector. The agent token can run read actions marked for agents, and nothing else; the
// per-install token, the sign-in cookie and web pages cannot use /api/tools at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, rmHome, start, logText, request } from './helpers.mjs';

const STORED = 'stored-secret-value-4f19a2';

async function withAgent(fn, { workMode = false } = {}) {
  const home = tempHome();
  const reads = [];
  const secrets = async name => { reads.push(name); return name === 'probe-key' ? STORED : undefined; };
  const agent = await start(home, { connectors: { probe: { enabled: true, config: {} } }, features: { workMode } }, { secrets });
  const agentToken = fs.readFileSync(path.join(home, 'agent-token'), 'utf8').trim();
  try { await fn({ agent, home, agentToken, reads }); } finally { await agent.stop(); rmHome(home); }
}

const tools = (agent, method, p, { token, body, headers = {} } = {}) =>
  request(agent, method, `/api/tools${p}`, { body, auth: 'none', headers: { ...(token ? { 'X-Workshop-Agent-Token': token } : {}), ...headers } });

test('the agent token is its own file, readable by this user only, and not the per-install token', async () => {
  await withAgent(async ({ agent, home, agentToken }) => {
    assert.match(agentToken, /^[0-9a-f]{64}$/);
    assert.notEqual(agentToken, agent.token);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, 'agent-token')).mode & 0o777, 0o600);
  });
});

test('/api/tools lists and runs only read actions marked for agents, and tells the connector the caller', async () => {
  await withAgent(async ({ agent, agentToken }) => {
    const list = await tools(agent, 'GET', '', { token: agentToken });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.tools.map(t => `${t.connector} ${t.action}`), ['probe forAgents']);
    const run = await tools(agent, 'POST', '/probe/forAgents', { token: agentToken, body: { args: { n: 3 } } });
    assert.equal(run.status, 200);
    assert.deepEqual(run.json.result, { n: 3, caller: 'agent' });
    // The same action from a page is a person.
    const page = await request(agent, 'POST', '/api/connectors/probe/forAgents', { body: { args: {} } });
    assert.equal(page.json.result.caller, 'person');
    assert.match(logText(agent), /An agent ran probe forAgents/);
  });
});

test('/api/tools refuses writes, unmarked actions, confirm, other keys, and web pages', async () => {
  await withAgent(async ({ agent, agentToken }) => {
    assert.equal((await tools(agent, 'POST', '/probe/change', { token: agentToken, body: { args: {} } })).status, 404, 'a write is not a tool');
    assert.equal((await tools(agent, 'POST', '/probe/change', { token: agentToken, body: { args: {}, confirm: true } })).status, 404);
    assert.equal((await tools(agent, 'POST', '/probe/save', { token: agentToken, body: { args: { value: 1 } } })).status, 404, 'not marked for agents');
    assert.equal((await tools(agent, 'POST', '/probe/forAgents', { token: agentToken, body: { args: {}, confirm: true } })).status, 400);
    assert.equal((await tools(agent, 'GET', '', {})).status, 401, 'no token');
    assert.equal((await tools(agent, 'GET', '', { token: agent.token })).status, 401, 'the per-install token is not an agent token');
    assert.equal((await tools(agent, 'GET', '', { headers: { 'X-Workshop-Token': agent.token } })).status, 401);
    assert.equal((await tools(agent, 'GET', '', { token: agentToken, headers: { Origin: `${agent.url}` } })).status, 403, 'no page may use tools');
    assert.equal((await tools(agent, 'GET', '', { token: agentToken, headers: { Origin: 'https://evil.example' } })).status, 403);
    // The agent token opens nothing else.
    const other = await request(agent, 'GET', '/api/connectors', { auth: 'none', headers: { 'X-Workshop-Token': agentToken } });
    assert.equal(other.status, 401);
    const write = await request(agent, 'POST', '/api/connectors/probe/change', { auth: 'none', body: { args: {}, confirm: true }, headers: { 'X-Workshop-Agent-Token': agentToken } });
    assert.equal(write.status, 401);
    assert.ok(!logText(agent).includes(agentToken), 'the agent token is never logged');
  });
});

test('ctx.secret reads only names in the config, from the store, and the value is kept out of the log', async () => {
  await withAgent(async ({ agent, reads }) => {
    const r = await request(agent, 'POST', '/api/connectors/probe/stored', { body: { args: {} } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.result, { length: STORED.length, other: 'refused', workMode: false });
    assert.deepEqual(reads, ['probe-key'], 'a name not in the config never reaches the store');
    assert.ok(!logText(agent).includes(STORED), 'redacted from the log');
    const cfg = await request(agent, 'GET', '/api/connectors/probe/config');
    assert.deepEqual(cfg.json.secrets, { 'probe-key': { set: false, store: null, expires: null, daysLeft: null } });
  });
});

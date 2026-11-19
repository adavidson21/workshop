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
    assert.deepEqual(list.json.tools.map(t => `${t.connector} ${t.action}${t.asks ? ' (asks)' : ''}`), ['probe forAgents', 'probe askChange (asks)']);
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

test('approvals: an agent asks, a person reads it worked out from the arguments, approves with the digest, and can always allow', async () => {
  await withAgent(async ({ agent, home, agentToken }) => {
    const ask = target => tools(agent, 'POST', '/probe/askChange', { token: agentToken, body: { args: { target } } });
    const asked = await ask('a.example');
    assert.equal(asked.status, 200);
    const id = asked.json.result.approval.id;
    assert.match(id, /^ap-\d{8}-[0-9a-f]{8}$/);
    assert.equal((await tools(agent, 'GET', `/approvals/${id}`, { token: agentToken })).json.status, 'waiting');
    assert.equal((await tools(agent, 'GET', `/approvals/${id}`, {})).status, 401, 'agent token needed');

    const list = await request(agent, 'GET', '/api/approvals?status=waiting');
    assert.equal(list.json.waiting, 1);
    const view = list.json.approvals[0];
    assert.equal(view.id, id);
    assert.equal(view.by, 'agent');
    assert.deepEqual(view.lines, ['Change a.example']);
    assert.deepEqual(view.scopes, ['a.example']);
    assert.match(view.digest, /^[0-9a-f]{64}$/);

    // Agents cannot decide; a wrong digest runs nothing.
    assert.equal((await request(agent, 'POST', `/api/approvals/${id}`, { auth: 'none', body: { approve: true, digest: view.digest }, headers: { 'X-Workshop-Agent-Token': agentToken } })).status, 401);
    assert.equal((await request(agent, 'POST', `/api/approvals/${id}`, { body: { approve: true, digest: 'f'.repeat(64) } })).status, 409);
    // An edit to the request file after it was read is refused too.
    const file = path.join(agent.dataDir, 'connections', 'approvals', `${id}.json`);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...j, args: { target: 'evil.example' } }));
    assert.equal((await request(agent, 'POST', `/api/approvals/${id}`, { body: { approve: true, digest: view.digest } })).status, 409);
    fs.writeFileSync(file, JSON.stringify(j));

    const ok = await request(agent, 'POST', `/api/approvals/${id}`, { body: { approve: true, digest: view.digest, always: true } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.result, { changed: 'a.example', caller: 'person', approval: id, rule: null });
    assert.match(ok.json.rule, /^r-[0-9a-f]{8}$/);
    const done = await tools(agent, 'GET', `/approvals/${id}`, { token: agentToken });
    assert.equal(done.json.status, 'approved');
    assert.equal(done.json.result.changed, 'a.example');
    assert.equal((await request(agent, 'POST', `/api/approvals/${id}`, { body: { approve: true, digest: view.digest } })).status, 409, 'once only');

    // The rule covers the same scope at once, and only that scope.
    const covered = await ask('a.example');
    assert.equal(covered.json.result.rule, ok.json.rule);
    assert.equal(covered.json.result.result.caller, 'agent');
    const other = await ask('b.example');
    const otherId = other.json.result.approval.id;
    const rej = await request(agent, 'POST', `/api/approvals/${otherId}`, { body: { approve: false, note: 'No' } });
    assert.equal(rej.json.status, 'rejected');
    assert.equal((await tools(agent, 'GET', `/approvals/${otherId}`, { token: agentToken })).json.status, 'rejected');
    assert.match(logText(agent), /rejected b\.example: No/);

    const rules = (await request(agent, 'GET', '/api/approvals/rules')).json.rules;
    assert.deepEqual(rules.map(r => [r.connector, r.action, r.scopes]), [['probe', 'askChange', ['a.example']]]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).approvals.rules.map(r => r.id), [ok.json.rule]);

    const act = (await request(agent, 'GET', '/api/activity?connector=probe')).json;
    const kinds = act.entries.map(e => `${e.by} ${e.kind}`).reverse();
    assert.deepEqual(kinds, ['agent request', 'you write', 'rule write', 'agent request', 'you reject']);
    assert.ok(act.lastUsed.probe);
    assert.ok(!JSON.stringify(act).includes('a.example'), 'no arguments in the activity log');

    assert.equal((await request(agent, 'DELETE', `/api/approvals/rules/${ok.json.rule}`)).status, 200);
    assert.equal((await ask('a.example')).json.result.approval.status, 'waiting', 'without the rule it asks again');
  });
});

test('/api/mcp: initialize, list and call tools as opencode would; changes wait in Approvals; same key and rules as /api/tools', async () => {
  await withAgent(async ({ agent, agentToken }) => {
    const rpc = (body, headers = { 'X-Workshop-Agent-Token': agentToken }) => request(agent, 'POST', '/api/mcp', { auth: 'none', body, headers });
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'opencode', version: '1' } } });
    assert.equal(init.status, 200);
    assert.equal(init.json.result.protocolVersion, '2025-03-26');
    assert.equal(init.json.result.serverInfo.name, 'workshop');
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { Authorization: `Bearer ${agentToken}` });
    const names = list.json.result.tools.map(t => `${t.name}:${t.annotations.readOnlyHint}`);
    assert.deepEqual(names, ['probe__forAgents:true', 'probe__askChange:false', 'workshop__approval_status:true']);
    const read = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'probe__forAgents', arguments: { n: 7 } } });
    assert.deepEqual(JSON.parse(read.json.result.content[0].text), { n: 7, caller: 'agent' });
    const ask = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'probe__askChange', arguments: { target: 'c.example' } } });
    const id = /Approval id: (ap-\d{8}-[0-9a-f]{8})/.exec(ask.json.result.content[0].text)[1];
    assert.equal(ask.json.result.isError, false);
    const st = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'workshop__approval_status', arguments: { id } } });
    assert.equal(JSON.parse(st.json.result.content[0].text).status, 'waiting');
    const batch = await rpc([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }, { jsonrpc: '2.0', id: 7, method: 'resources/list' }]);
    assert.deepEqual(batch.json.map(m => [m.id, m.error ? m.error.code : 'ok']), [[6, 'ok'], [7, -32601]]);
    const missing = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'probe__change', arguments: {} } });
    assert.equal(missing.json.result.isError, true, 'a write not marked for agents is not a tool');
    assert.equal((await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' }, {})).status, 401);
    assert.equal((await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' }, { 'X-Workshop-Token': agent.token })).status, 401, 'the per-install token is not the key');
    assert.equal((await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' }, { 'X-Workshop-Agent-Token': agentToken, Origin: agent.url })).status, 403);
    assert.equal((await request(agent, 'GET', '/api/mcp', { auth: 'none', headers: { 'X-Workshop-Agent-Token': agentToken } })).status, 405);
  });
});

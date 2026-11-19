// The MCP servers connector against a fake MCP server (a fetch function). Nothing reaches the network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import connector, { setFetch } from '../index.mjs';
import { fromEventStream, McpClient } from '../lib/client.mjs';

const A = connector.actions;
const TOKEN = 'ghp_fake_token_0123456789abcdef';

function fakeServer({ sse = false, token = TOKEN } = {}) {
  const calls = [];
  const tools = [
    { name: 'get_issue', description: 'Read an issue', inputSchema: { type: 'object', properties: { n: { type: 'integer' } } }, annotations: { readOnlyHint: true, title: 'Get issue' } },
    { name: 'create_issue', description: 'Open an issue\nMore text', inputSchema: { type: 'object' } },
    { name: 'bad name!', description: 'dropped' }
  ];
  async function fetchImpl(url, init) {
    const m = JSON.parse(init.body);
    calls.push({ url, method: m.method, auth: init.headers.Authorization, session: init.headers['Mcp-Session-Id'] || null, params: m.params });
    if (init.headers.Authorization !== `Bearer ${token}`) return new Response('no', { status: 401 });
    const headers = { 'content-type': sse ? 'text/event-stream' : 'application/json' };
    if (m.method === 'initialize') headers['mcp-session-id'] = 'sess-1';
    if (m.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } };
    else if (m.method === 'tools/list') result = m.params && m.params.cursor ? { tools: [tools[2]] } : { tools: tools.slice(0, 2), nextCursor: 'p2' };
    else if (m.method === 'tools/call') result = { content: [{ type: 'text', text: `ran ${m.params.name} ${JSON.stringify(m.params.arguments)}` }], isError: false };
    const msg = { jsonrpc: '2.0', id: m.id, result };
    const body = sse ? `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${JSON.stringify(msg)}\n\n` : JSON.stringify(msg);
    return new Response(body, { status: 200, headers });
  }
  return { fetchImpl, calls };
}

function makeCtx(servers, { token = TOKEN } = {}) {
  return {
    config: Object.freeze({ servers }),
    secret: async n => (n === 'gh-mcp' ? token : undefined),
    workMode: () => false,
    log: { info() {}, warn() {}, error() {} },
    emit() {}, statusChanged() {}, signal: new AbortController().signal
  };
}
const GH = { id: 'gh', name: 'GitHub MCP', url: 'https://mcp.example.test/mcp/', tokenSecret: 'gh-mcp', header: 'Authorization', prefix: 'Bearer ', trustReadOnly: true, enabled: true };

let fake;
beforeEach(() => { fake = fakeServer(); setFetch(fake.fetchImpl); });

test('the client opens a session, sends its id after, follows pages, and reads event-stream answers', async () => {
  const sse = fakeServer({ sse: true });
  const c = new McpClient({ url: GH.url, headers: { Authorization: `Bearer ${TOKEN}` }, fetchImpl: sse.fetchImpl, name: 'x' });
  const tools = await c.listTools();
  assert.deepEqual(tools.map(t => t.name), ['get_issue', 'create_issue', 'bad name!']);
  assert.deepEqual(sse.calls.map(x => [x.method, x.session]), [['initialize', null], ['notifications/initialized', 'sess-1'], ['tools/list', 'sess-1'], ['tools/list', 'sess-1']]);
  assert.equal(fromEventStream('data: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n', 7).result.ok, 1);
  assert.equal(fromEventStream('data: not json\n\n', 1), null);
});

test('tools: read-only ones run at once, the rest only through tools.call (an approval); bad names are dropped', async () => {
  const ctx = makeCtx([GH]);
  const list = await A['tools.list'].run({ server: 'gh' }, ctx);
  assert.deepEqual(list.map(t => [t.name, t.readOnly]), [['get_issue', true], ['create_issue', false]]);
  const r = await A['tools.read'].run({ server: 'gh', tool: 'get_issue', arguments: { n: 3 } }, ctx);
  assert.deepEqual(r, { isError: false, text: 'ran get_issue {"n":3}' });
  await assert.rejects(A['tools.read'].run({ server: 'gh', tool: 'create_issue' }, ctx), /needs your approval/);
  assert.equal(A['tools.call'].agent, 'ask');
  assert.equal(A['tools.call'].write, true);
  assert.deepEqual(A['tools.call'].scope({ server: 'gh', tool: 'create_issue' }), ['gh/create_issue']);
  const lines = await A['tools.call'].describe({ server: 'gh', tool: 'create_issue', arguments: { title: 'Hi' } }, ctx);
  assert.equal(lines[0], 'GitHub MCP: create_issue');
  assert.equal(lines[1], 'Open an issue');
  assert.match(lines[2], /"title": "Hi"/);
  assert.ok(fake.calls.every(c => c.auth === `Bearer ${TOKEN}`), 'the token only in the header');
  assert.ok(fake.calls.every(c => c.url === GH.url), 'only the server in the settings');
});

test('not trusting read-only marks makes every tool ask; a missing token says how to save it', async () => {
  const ctx = makeCtx([{ ...GH, trustReadOnly: false }]);
  const list = await A['tools.list'].run({ server: 'gh' }, ctx);
  assert.ok(list.every(t => !t.readOnly));
  await assert.rejects(A['tools.read'].run({ server: 'gh', tool: 'get_issue' }, ctx), /needs your approval/);
  await assert.rejects(A['tools.list'].run({ server: 'gh2' }, makeCtx([{ ...GH, id: 'gh2' }], { token: null })), /workshop secret set gh-mcp/);
  await assert.rejects(A['tools.list'].run({ server: 'nope' }, ctx), /no MCP server "nope"/);
  await assert.rejects(A['tools.list'].run({ server: 'gh' }, makeCtx([{ ...GH, enabled: false }])), /no MCP server "gh"/);
});

test('catalog and status cover every server; a rejected token shows on the status', async () => {
  const ctx = makeCtx([GH, { ...GH, id: 'bad', name: 'Bad', tokenSecret: 'gh-mcp' }]);
  setFetch(async (url, init) => (url.includes('bad') ? new Response('', { status: 401 }) : fake.fetchImpl(url, init)));
  const ctx2 = makeCtx([GH, { ...GH, id: 'bad', name: 'Bad', url: 'https://bad.example.test/mcp' }]);
  await connector.start(ctx2);
  const cat = await A.catalog.run({}, ctx2);
  assert.deepEqual(cat.map(t => `${t.server}/${t.name}`), ['gh/get_issue', 'gh/create_issue']);
  const servers = await A['servers.list'].run({}, ctx2);
  assert.deepEqual(servers.map(s => [s.id, s.ok]), [['gh', true], ['bad', false]]);
  assert.match(servers[1].error, /rejected the token/);
  const st = connector.status();
  assert.equal(st.state, 'ready');
  assert.deepEqual(st.details, { servers: 2, tools: 2, failing: ['bad'] });
  assert.match(st.message, /Bad: Bad rejected the token/);
  await connector.stop();
  void ctx;
});

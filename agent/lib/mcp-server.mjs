// /api/mcp (docs/agent-api.md, MCP for agents): Workshop as one MCP server for opencode, over Streamable HTTP with
// plain JSON answers (no event stream, no sessions). It serves:
//
//   <connector>__<action>     every connector action agents may use (/api/tools): reads run; writes marked
//                             agent: "ask" become a request in Approvals
//   <server>__<tool>          every tool on the MCP servers you added (the mcp connector): read-only tools run;
//                             any other tool call waits in Approvals
//   workshop__approval_status where a change you asked for stands, and its result once approved
//
// Same key and rules as /api/tools: the agent token, no web pages, nothing an agent can confirm itself.

export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const clean = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

/** The tools, with what each maps to. Built fresh for every list and call (connectors come and go). */
export async function catalog(connectors) {
  const out = [];
  const seen = new Set();
  const add = t => { if (t.name.length <= 64 && !seen.has(t.name)) { seen.add(t.name); out.push(t); } };
  const agentTools = connectors.agentTools();
  for (const t of agentTools) {
    if (t.connector === 'mcp') continue; // its servers' tools are listed one by one below
    add({
      name: `${t.connector}__${clean(t.action)}`, kind: 'connector', connector: t.connector, action: t.action, readOnly: !t.asks,
      description: `${t.title}${t.asks ? '. Changes something outside: it waits for the person to approve it in Workshop.' : ''}`,
      inputSchema: t.argsSchema && t.argsSchema.type === 'object' ? t.argsSchema : { type: 'object' }
    });
  }
  if (agentTools.some(t => t.connector === 'mcp' && t.action === 'catalog')) {
    let list = [];
    try { list = await connectors.callForAgent('mcp', 'catalog', { args: {} }); } catch { list = []; }
    for (const t of Array.isArray(list) ? list : []) {
      add({
        name: `${t.server}__${clean(t.name)}`, kind: 'mcp', server: t.server, tool: t.name, readOnly: t.readOnly === true,
        description: `${t.serverName}: ${t.description || t.title}${t.readOnly ? '' : ' (waits for the person to approve it in Workshop)'}`.slice(0, 2000),
        inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }
      });
    }
  }
  add({
    name: 'workshop__approval_status', kind: 'status', readOnly: true,
    description: 'Where a change you asked for stands: waiting, approved (with its result), rejected (with the note) or failed.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'The approval id you were given, ap-...' } } }
  });
  return out;
}

const text = (obj, isError = false) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }], isError });

/** Turns an approval answer into words an agent acts on. */
function asked(r) {
  if (r && r.approval) return text(`Waiting for the person to approve this in Workshop (Approvals). Approval id: ${r.approval.id}. Do not ask again; check later with workshop__approval_status.`);
  if (r && r.rule) return text({ approvedBy: 'an always-allow rule', result: r.result });
  return text(r);
}

async function callTool(name, args, { connectors, approvals }) {
  const t = (await catalog(connectors)).find(x => x.name === name);
  if (!t) return text(`There is no tool ${name}.`, true);
  try {
    if (t.kind === 'status') {
      const r = approvals.get(String(args && args.id || ''));
      if (!r) return text(`There is no approval ${args && args.id}.`, true);
      return text({ id: r.id, status: r.status, title: r.title, ...(r.result !== undefined ? { result: r.result } : {}), ...(r.error ? { error: r.error } : {}), ...(r.note ? { note: r.note } : {}) });
    }
    if (t.kind === 'connector') {
      const r = await connectors.callForAgent(t.connector, t.action, { args: args || {} });
      return t.readOnly ? text(r) : asked(r);
    }
    const r = await connectors.callForAgent('mcp', t.readOnly ? 'tools.read' : 'tools.call', { args: { server: t.server, tool: t.tool, arguments: args || {} } });
    if (!t.readOnly) return asked(r);
    return { content: [{ type: 'text', text: r.text || '' }], isError: r.isError === true, ...(r.structured ? { structuredContent: r.structured } : {}) };
  } catch (e) {
    return text(e && e.message ? e.message : 'It failed.', true);
  }
}

/** One JSON-RPC message in, its answer out (null for a notification). */
async function one(m, deps) {
  const isReq = m && typeof m === 'object' && m.jsonrpc === '2.0' && typeof m.method === 'string';
  if (!isReq) return { jsonrpc: '2.0', id: m && m.id !== undefined ? m.id : null, error: { code: -32600, message: 'Not a JSON-RPC 2.0 request.' } };
  if (m.id === undefined) return null; // a notification (notifications/initialized and the like)
  const ok = result => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize': {
      const want = m.params && m.params.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'workshop', version: deps.version },
        instructions: 'Workshop on this computer: your outside connections (Cloudflare, MCP servers). Reads run at once. Anything that changes something outside waits for the person to approve it in Workshop; you get an approval id to check with workshop__approval_status. Never ask for or handle tokens.'
      });
    }
    case 'ping': return ok({});
    case 'tools/list': {
      const tools = (await catalog(deps.connectors)).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly, openWorldHint: t.kind !== 'status' } }));
      return ok({ tools });
    }
    case 'tools/call': {
      const p = m.params || {};
      if (typeof p.name !== 'string') return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'tools/call needs a name.' } };
      return ok(await callTool(p.name, p.arguments && typeof p.arguments === 'object' ? p.arguments : {}, deps));
    }
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Workshop does not support ${m.method}.` } };
  }
}

/** A whole POST body (one message or a batch). Returns {status, body}; body null means 202 with nothing. */
export async function handleMcp(body, deps) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => one(m, deps)))).filter(Boolean);
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  const r = await one(body, deps);
  return r ? { status: 200, body: r } : { status: 202, body: null };
}

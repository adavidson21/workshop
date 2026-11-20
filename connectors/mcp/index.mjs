// The MCP servers connector (README.md): remote MCP servers you add in Settings, reached through Workshop. Their
// tokens live in this computer's secret store (`workshop secret set <name>`); Tandem uses their tools through
// Workshop (/api/mcp and /api/tools) and never sees a token. Tools a server marks read-only run at once; every
// other tool call is a change that waits in Approvals (or runs when an always-allow rule covers that tool).
// Node standard library only. It calls only the server URLs in its settings.
import { McpClient, McpError } from './lib/client.mjs';
import { needsRefresh, refresh, seal, storageKey, unseal } from './lib/oauth.mjs';

// 1.1.0: Sign in (OAuth) for servers that take no token (lib/oauth.mjs, README.md, Sign in).
const VERSION = '1.1.0';
const TOOL = /^[A-Za-z0-9_.\-/]{1,128}$/;
const CACHE_MS = 5 * 60 * 1000;
let running = null;
let fetchImpl = null;
let state = new Map(); // server id -> {ok, tools, error, at}

/** Tests point the client at a fake fetch. */
export function setFetch(f) { fetchImpl = f; }

class SettingsError extends Error {
  constructor(message, code = 'bad_request') { super(message); this.name = 'SettingsError'; this.code = code; this.status = code === 'not_found' ? 404 : 400; }
}

const servers = ctx => (ctx.config.servers || []).filter(s => s && s.enabled !== false);

function serverOf(ctx, id) {
  const s = servers(ctx).find(x => x.id === id);
  if (!s) throw new SettingsError(`There is no MCP server "${id}" turned on in Settings, MCP servers.`, 'not_found');
  return s;
}

const refreshing = new Map(); // server id -> a refresh in flight, so a rotated refresh token is used once

/** The access token of a signed-in server, refreshed and saved again (encrypted) when it runs out or was refused. */
async function oauthToken(ctx, s, { force = false } = {}) {
  const login = `In a terminal run: workshop mcp login ${s.id}`;
  if (!s.tokenSecret) throw new SettingsError(`${s.name} signs in with OAuth: name its sign-in key under Token (secret name), then ${login.toLowerCase()}`);
  let key;
  try { key = await ctx.secret(s.tokenSecret); } catch { throw new SettingsError(`Server "${s.name}" names a secret Workshop cannot read.`); }
  const box = ctx.storage ? await ctx.storage.get(storageKey(s.id)) : undefined;
  if (!key || !box) throw new McpError(`Not signed in to ${s.name}. ${login}`);
  let rec;
  try { rec = unseal(key, box); } catch (e) { throw new McpError(`${e.message} ${login}`); }
  if (!force && !needsRefresh(rec)) return rec.access_token;
  if (!refreshing.has(s.id)) {
    refreshing.set(s.id, (async () => {
      try {
        const next = await refresh(rec, fetchImpl || globalThis.fetch);
        await ctx.storage.put(storageKey(s.id), seal(key, next));
        return next.access_token;
      } catch (e) {
        throw new McpError(`${s.name}: ${e.message} ${login}`, e.code === 'unauthorized' ? 401 : null);
      } finally { refreshing.delete(s.id); }
    })());
  }
  return refreshing.get(s.id);
}

async function clientFor(ctx, s, { fresh = false } = {}) {
  const headers = {};
  if (s.auth === 'oauth') {
    headers.Authorization = `Bearer ${await oauthToken(ctx, s, { force: fresh })}`;
  } else if (s.tokenSecret) {
    let token;
    try { token = await ctx.secret(s.tokenSecret); } catch { throw new SettingsError(`Server "${s.name}" names a secret Workshop cannot read.`); }
    if (!token) throw new McpError(`No token saved as "${s.tokenSecret}" for ${s.name}. In a terminal run: workshop secret set ${s.tokenSecret}`);
    headers[s.header || 'Authorization'] = `${s.prefix ?? 'Bearer '}${token}`;
  }
  return new McpClient({ url: s.url, headers, fetchImpl, signal: ctx.signal, name: s.name, clientVersion: VERSION });
}

const readOnly = (s, t) => s.trustReadOnly !== false && !!(t && t.annotations && t.annotations.readOnlyHint === true);
const shapeTool = (s, t) => ({
  name: t.name, title: (t.annotations && t.annotations.title) || t.title || t.name, description: String(t.description || '').slice(0, 2000),
  inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }, readOnly: readOnly(s, t)
});

/** Runs fn(client); a signed-in server that refuses the access token gets one refresh and one more try. */
async function withClient(ctx, s, fn) {
  try { return await fn(await clientFor(ctx, s)); }
  catch (e) {
    if (s.auth !== 'oauth' || !e || (e.upstream !== 401 && e.upstream !== 403)) throw e;
    return fn(await clientFor(ctx, s, { fresh: true }));
  }
}

/** A server's tools, cached for five minutes (as the server sent them, keyed by its URL; read-only is worked out each time). */
async function tools(ctx, s, { fresh = false } = {}) {
  const st = state.get(s.id);
  if (!fresh && st && st.ok && st.url === s.url && Date.now() - st.at < CACHE_MS) return st.tools.map(t => shapeTool(s, t));
  try {
    const raw = (await withClient(ctx, s, c => c.listTools())).filter(t => t && TOOL.test(String(t.name)));
    state.set(s.id, { ok: true, tools: raw, url: s.url, at: Date.now() });
    if (running) running.statusChanged();
    return raw.map(t => shapeTool(s, t));
  } catch (e) {
    state.set(s.id, { ok: false, tools: [], error: e && e.message ? e.message : 'It failed.', at: Date.now() });
    if (running) running.statusChanged();
    throw e;
  }
}

async function toolOf(ctx, serverId, name) {
  const s = serverOf(ctx, serverId);
  const t = (await tools(ctx, s)).find(x => x.name === name);
  if (!t) throw new SettingsError(`${s.name} has no tool "${name}".`, 'not_found');
  return { s, t };
}

/** A tool's answer, small: text parts joined, plus structured content when there is any. */
function answer(r) {
  const parts = Array.isArray(r && r.content) ? r.content : [];
  const text = parts.filter(p => p && p.type === 'text').map(p => p.text).join('\n').slice(0, 200000);
  return { isError: r && r.isError === true, text, ...(r && r.structuredContent ? { structured: r.structuredContent } : {}), ...(parts.some(p => p && p.type !== 'text') ? { otherParts: parts.filter(p => p && p.type !== 'text').map(p => p.type) } : {}) };
}

const callArgs = { type: 'object', required: ['server', 'tool'], properties: { server: { type: 'string', maxLength: 32 }, tool: { type: 'string', maxLength: 128 }, arguments: { type: 'object' } } };

export default {
  api: 1,
  id: 'mcp',
  name: 'MCP servers',
  version: VERSION,
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      servers: {
        type: 'array',
        title: 'MCP servers',
        description: 'Remote MCP servers Tandem can use through Workshop. Tools the server marks read-only run at once; every other tool waits for your approval.',
        default: [],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'url'],
          properties: {
            id: { type: 'string', title: 'Id', pattern: '^[a-z][a-z0-9-]{0,30}$', description: 'Short, lowercase: github, linear. Tools show as <id>__<tool>.' },
            name: { type: 'string', title: 'Name', maxLength: 60 },
            url: { type: 'string', title: 'Server URL', format: 'uri', pattern: '^(https://|http://127\\.0\\.0\\.1[:/]|http://localhost[:/])', description: 'Its Streamable HTTP address, for example https://api.githubcopilot.com/mcp/. https only, except on this computer.' },
            auth: { type: 'string', title: 'How it signs in', enum: ['token', 'oauth'], 'x-workshop-labels': ['A token', 'Sign in (OAuth)'], default: 'token', description: 'Sign in: for servers that take no token. Name a secret below, then run workshop mcp login <id> in a terminal; it opens your browser.' },
            tokenSecret: { type: 'string', title: 'Token (secret name)', 'x-workshop-secret': true, description: 'Optional. Save the token with: workshop secret set <name> --expires YYYY-MM-DD. With Sign in, any name, for example linear-signin: workshop mcp login saves a key there.' },
            header: { type: 'string', title: 'Header', default: 'Authorization', pattern: '^[A-Za-z0-9-]{1,60}$', 'x-workshop-section': 'Advanced' },
            prefix: { type: 'string', title: 'Before the token', default: 'Bearer ', maxLength: 20, 'x-workshop-section': 'Advanced' },
            trustReadOnly: { type: 'boolean', title: 'Run tools the server marks read-only without asking', default: true, description: 'Off: every tool call from Tandem waits for your approval.' },
            enabled: { type: 'boolean', title: 'On', default: true }
          }
        }
      }
    }
  },
  test: { action: 'tools.list', arg: 'server', label: 'Server id (lists its tools)' },
  actions: {
    'servers.list': {
      title: 'List the MCP servers and how many tools each has', write: false, agent: true, setup: true,
      async run(args, ctx) {
        const out = [];
        for (const s of servers(ctx)) {
          try { const t = await tools(ctx, s, { fresh: !!(args && args.fresh === true) }); out.push({ id: s.id, name: s.name, host: new URL(s.url).host, ok: true, tools: t.length, readOnly: t.filter(x => x.readOnly).length }); }
          catch (e) { out.push({ id: s.id, name: s.name, host: new URL(s.url).host, ok: false, error: e.message }); }
        }
        return out;
      }
    },
    'tools.list': {
      title: "List a server's tools", write: false, agent: true,
      argsSchema: { type: 'object', required: ['server'], properties: { server: { type: 'string', maxLength: 32 } } },
      async run(args, ctx) { return tools(ctx, serverOf(ctx, args.server)); }
    },
    catalog: {
      title: 'Every tool on every server (for /api/mcp)', write: false, agent: true,
      async run(args, ctx) {
        const out = [];
        for (const s of servers(ctx)) { try { for (const t of await tools(ctx, s)) out.push({ server: s.id, serverName: s.name, ...t }); } catch { /* status shows it */ } }
        return out;
      }
    },
    'tools.read': {
      title: 'Run a tool the server marks read-only', write: false, agent: true,
      argsSchema: callArgs,
      async run(args, ctx) {
        const { s, t } = await toolOf(ctx, args.server, args.tool);
        if (!t.readOnly) throw new SettingsError(`${s.name}'s ${t.name} is not marked read-only, so it needs your approval: use tools.call.`);
        return answer(await withClient(ctx, s, c => c.callTool(t.name, args.arguments || {})));
      }
    },
    'tools.call': {
      title: 'Run any tool on an MCP server', write: true, agent: 'ask',
      argsSchema: callArgs,
      async describe(args, ctx) {
        const { s, t } = await toolOf(ctx, args.server, args.tool);
        const a = JSON.stringify(args.arguments || {}, null, 1);
        return [`${s.name}: ${t.title}${t.readOnly ? ' (marked read-only)' : ''}`, ...(t.description ? [t.description.split('\n')[0].slice(0, 300)] : []), `Arguments: ${a.length > 1500 ? `${a.slice(0, 1500)}...` : a}`];
      },
      scope(args) { return [`${args.server}/${args.tool}`]; },
      async run(args, ctx) {
        const { s, t } = await toolOf(ctx, args.server, args.tool);
        return answer(await withClient(ctx, s, c => c.callTool(t.name, args.arguments || {})));
      }
    }
  },
  async start(ctx) {
    running = ctx;
    state = new Map();
    // Check each server once in the background; the status says what it found.
    (async () => { for (const s of servers(ctx)) { try { await tools(ctx, s, { fresh: true }); } catch { /* in state */ } } })();
  },
  async stop() { running = null; },
  status() {
    if (!running) return { state: 'stopped', message: null };
    const list = servers(running);
    if (!list.length) return { state: 'ready', message: 'No MCP servers yet. Add one in Settings.', details: { servers: 0, tools: 0 } };
    const failing = list.filter(s => state.get(s.id) && !state.get(s.id).ok);
    const toolsCount = list.reduce((n, s) => n + ((state.get(s.id) && state.get(s.id).tools.length) || 0), 0);
    const details = { servers: list.length, tools: toolsCount, failing: failing.map(s => s.id) };
    if (failing.length === list.length && list.every(s => state.get(s.id))) return { state: 'error', message: state.get(failing[0].id).error, details };
    return { state: 'ready', message: failing.length ? `${failing.map(s => s.name).join(', ')}: ${state.get(failing[0].id).error}` : null, details };
  }
};

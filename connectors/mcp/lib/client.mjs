// A small MCP client over Streamable HTTP (JSON-RPC 2.0 by POST; answers as JSON or as a server-sent event
// stream). Node standard library only. Each use starts its own session: initialize, notifications/initialized,
// then one request. The token (from ctx.secret) goes only in the header the settings name, to the server's URL.

export const PROTOCOL = '2025-06-18';
const MAX_BODY = 4 * 1024 * 1024;

export class McpError extends Error {
  constructor(message, upstream = null) {
    super(message);
    this.name = 'McpError';
    this.upstream = upstream;
    this.status = 503;
    this.code = 'unavailable';
  }
}

/** The JSON-RPC answer with this id from a server-sent event stream, or null. */
export function fromEventStream(text, id) {
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    let m; try { m = JSON.parse(data); } catch { continue; }
    for (const one of Array.isArray(m) ? m : [m]) if (one && one.id === id && ('result' in one || 'error' in one)) return one;
  }
  return null;
}

export class McpClient {
  #url; #headers; #fetch; #signal; #session = null; #next = 1; #name;
  constructor({ url, headers = {}, fetchImpl, signal, name = 'the server', clientVersion = '1.0.0' }) {
    this.#url = url;
    this.#headers = headers;
    this.#fetch = fetchImpl || globalThis.fetch;
    this.#signal = signal;
    this.#name = name;
    this.clientVersion = clientVersion;
  }

  async #post(message, { notify = false } = {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'Workshop', ...this.#headers };
    if (this.#session) { headers['Mcp-Session-Id'] = this.#session; headers['MCP-Protocol-Version'] = PROTOCOL; }
    let res;
    try { res = await this.#fetch(this.#url, { method: 'POST', headers, body: JSON.stringify(message), signal: this.#signal }); }
    catch (e) { throw new McpError(e && e.name === 'AbortError' ? 'The request was stopped.' : `Could not reach ${this.#name} at ${new URL(this.#url).host}.`); }
    const sid = res.headers.get('mcp-session-id');
    if (sid && !this.#session) this.#session = sid;
    if (notify) { await res.text().catch(() => ''); if (res.status >= 400) throw new McpError(`${this.#name} refused it (HTTP ${res.status}).`, res.status); return null; }
    const text = await res.text();
    if (text.length > MAX_BODY) throw new McpError(`${this.#name} sent more than 4 MB.`);
    if (res.status === 401 || res.status === 403) throw new McpError(`${this.#name} rejected the token (HTTP ${res.status}). It may have expired, or lack a permission.`, res.status);
    if (res.status >= 400) throw new McpError(`${this.#name} answered HTTP ${res.status}.`, res.status);
    const type = String(res.headers.get('content-type') || '');
    let answer = null;
    if (type.includes('text/event-stream')) answer = fromEventStream(text, message.id);
    else { try { const j = JSON.parse(text); answer = Array.isArray(j) ? j.find(x => x && x.id === message.id) : j; } catch { answer = null; } }
    if (!answer) throw new McpError(`${this.#name} did not answer ${message.method}.`);
    if (answer.error) throw new McpError(`${this.#name}: ${answer.error.message || `error ${answer.error.code}`}`);
    return answer.result;
  }

  async #request(method, params) { return this.#post({ jsonrpc: '2.0', id: this.#next++, method, ...(params ? { params } : {}) }); }

  async open() {
    if (this.#session !== null || this.opened) return;
    const r = await this.#request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Workshop', version: this.clientVersion } });
    this.server = r && r.serverInfo ? r.serverInfo : null;
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { notify: true });
    this.opened = true;
  }

  /** Every tool, following pages (at most 20). */
  async listTools() {
    await this.open();
    const out = [];
    let cursor;
    for (let i = 0; i < 20; i += 1) {
      const r = await this.#request('tools/list', cursor ? { cursor } : undefined);
      out.push(...((r && r.tools) || []));
      if (!r || !r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return out;
  }

  async callTool(name, args) {
    await this.open();
    return this.#request('tools/call', { name, arguments: args || {} });
  }
}

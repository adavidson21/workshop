// The server-sent event stream (docs/agent-api.md, GET /api/events). One stream carries every event.
// Payloads never contain collection contents or secrets; callers pass only the fields the doc lists.
const PING_MS = 15000;

export class EventHub {
  #clients = new Set();
  #version;

  constructor({ version }) { this.#version = version; }

  get size() { return this.#clients.size; }

  /** Take over an HTTP response as an event stream. `headers` adds CORS for hosted pages. */
  open(req, res, headers = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'keep-alive',
      ...headers
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ api: 1, version: this.#version })}\n\n`);
    const client = { res };
    this.#clients.add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    ping.unref();
    const done = () => { clearInterval(ping); this.#clients.delete(client); };
    req.on('close', done);
    res.on('error', done);
  }

  send(event, payload) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of this.#clients) {
      try { c.res.write(chunk); } catch { this.#clients.delete(c); }
    }
  }

  closeAll() {
    for (const c of this.#clients) { try { c.res.end(); } catch { /* already gone */ } }
    this.#clients.clear();
  }
}

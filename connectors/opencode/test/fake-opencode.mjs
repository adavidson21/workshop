// A fake opencode server on 127.0.0.1 for tests: the 1.x API (`opencode serve`) or the 2.x background
// service API (/api routes, basic auth). Only the routes the connector uses, shaped like the payloads the
// eng-agents adapters read. Records every request; tests push events and prompts.
import http from "node:http";

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/**
 * @param {object} o
 * @param {"v1"|"v2"} o.kind
 * @param {string} [o.version]
 * @param {string} [o.password]   2.x: required basic auth password (user "opencode" unless o.username)
 * @param {string} [o.username]
 * @param {string[]} [o.commands]
 */
export async function startFakeOpencode({ kind, version, password = null, username = "opencode", commands = ["start", "spec", "plan", "approve", "tasks", "do-task", "review", "pr", "bug"] }) {
  const s = {
    kind,
    version: version || (kind === "v2" ? "2.0.4" : "1.14.2"),
    requests: [], // "METHOD /path" (no query)
    bodies: [], // {route, body}
    sessions: new Map(), // id -> {id, title, directory}
    active: new Set(),
    permissions: [], // raw permission objects (version-specific shape)
    forms: [], // raw question or form objects
    streams: new Set(),
    n: 0,
    commandResult: null, // set to {status, body} to make the next command call fail
  };

  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : undefined;
      const route = `${req.method} ${url.pathname}`;
      s.requests.push(route);
      if (parsed !== undefined) s.bodies.push({ route, body: parsed });
      if (kind === "v2" && password && req.headers.authorization !== auth) return json(res, 401, { name: "Unauthorized" });
      (kind === "v2" ? v2 : v1)(req, res, url, parsed);
    });
  });

  const newId = () => `ses_${(++s.n).toString().padStart(4, "0")}abc`;
  const sse = (res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(": hi\n\n");
    s.streams.add(res);
    res.on("close", () => s.streams.delete(res));
  };

  function v1(req, res, url, body) {
    const p = url.pathname;
    const m = (re) => re.exec(p);
    let r;
    if (req.method === "GET" && p === "/global/health") return json(res, 200, { healthy: true, version: s.version });
    if (req.method === "GET" && p === "/command") return json(res, 200, commands.map((name) => ({ name })));
    if (req.method === "GET" && p === "/session") return json(res, 200, [...s.sessions.values()].map((x) => ({ id: x.id, title: x.title, time: { updated: 1 } })));
    if (req.method === "GET" && p === "/session/status") return json(res, 200, Object.fromEntries([...s.active].map((id) => [id, { type: "busy" }])));
    if (req.method === "GET" && p === "/permission") return json(res, 200, s.permissions);
    if (req.method === "GET" && p === "/question") return json(res, 200, s.forms);
    if (req.method === "GET" && p === "/event") return sse(res);
    if (req.method === "POST" && p === "/session") {
      const id = newId();
      s.sessions.set(id, { id, title: body.title });
      return json(res, 200, { id, title: body.title });
    }
    if ((r = m(/^\/session\/([^/]+)$/)) && req.method === "GET") return s.sessions.has(r[1]) ? json(res, 200, { id: r[1] }) : json(res, 404, {});
    if ((r = m(/^\/session\/([^/]+)\/message$/))) return json(res, 200, [{ info: { role: "assistant", time: { completed: 5 } }, parts: [{ type: "text", text: `Last reply in ${r[1]}` }] }]);
    if ((r = m(/^\/session\/([^/]+)\/command$/))) {
      if (s.commandResult) {
        const c = s.commandResult;
        s.commandResult = null;
        return json(res, c.status, c.body);
      }
      return json(res, 200, {});
    }
    if ((r = m(/^\/session\/([^/]+)\/prompt_async$/))) return json(res, 200, {});
    if ((r = m(/^\/session\/([^/]+)\/abort$/))) return json(res, 200, true);
    if ((r = m(/^\/session\/([^/]+)\/permissions\/([^/]+)$/))) {
      s.permissions = s.permissions.filter((x) => x.id !== r[2]);
      return json(res, 200, true);
    }
    if ((r = m(/^\/question\/([^/]+)\/(reply|reject)$/))) {
      s.forms = s.forms.filter((x) => x.id !== r[1]);
      return json(res, 200, true);
    }
    json(res, 404, { name: "NotFound" });
  }

  function v2(req, res, url, body) {
    const p = url.pathname;
    const m = (re) => re.exec(p);
    let r;
    if (req.method === "GET" && p === "/api/info") return json(res, 200, { version: s.version });
    if (req.method === "GET" && p === "/api/command") return json(res, 200, { data: commands.map((name) => ({ name })) });
    if (req.method === "GET" && p === "/api/session") return json(res, 200, { data: [...s.sessions.values()].map((x) => ({ id: x.id, title: x.title, time: { updated: 1 } })) });
    if (req.method === "GET" && p === "/api/session/active") return json(res, 200, { data: Object.fromEntries([...s.active].map((id) => [id, true])) });
    if (req.method === "GET" && p === "/api/permission/request") return json(res, 200, { data: s.permissions });
    if (req.method === "GET" && p === "/api/form") return json(res, 200, { data: s.forms });
    if (req.method === "GET" && p === "/api/event") return sse(res);
    if (req.method === "POST" && p === "/api/session") {
      const id = newId();
      s.sessions.set(id, { id, title: body.title, directory: body.location && body.location.directory });
      return json(res, 200, { data: { id, title: body.title } });
    }
    if ((r = m(/^\/api\/session\/([^/]+)$/)) && req.method === "GET") return s.sessions.has(r[1]) ? json(res, 200, { data: { id: r[1] } }) : json(res, 404, {});
    if ((r = m(/^\/api\/session\/([^/]+)\/message$/))) return json(res, 200, { data: [{ type: "assistant", time: { completed: 5 }, content: [{ type: "text", text: `Last reply in ${r[1]}` }] }] });
    if ((r = m(/^\/api\/session\/([^/]+)\/command$/))) {
      if (s.commandResult) {
        const c = s.commandResult;
        s.commandResult = null;
        return json(res, c.status, c.body);
      }
      return json(res, 200, { data: {} });
    }
    if ((r = m(/^\/api\/session\/([^/]+)\/prompt$/))) return json(res, 200, { data: {} });
    if ((r = m(/^\/api\/session\/([^/]+)\/interrupt$/))) return json(res, 200, { data: true });
    if ((r = m(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/))) {
      s.permissions = s.permissions.filter((x) => x.id !== r[2]);
      return json(res, 200, { data: true });
    }
    if ((r = m(/^\/api\/session\/([^/]+)\/form\/([^/]+)(\/reply)?$/))) {
      s.forms = s.forms.filter((x) => x.id !== r[2]);
      return json(res, 200, { data: true });
    }
    json(res, 404, { name: "NotFound" });
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    state: s,
    /** Sends one event on every open event stream. */
    send(ev) {
      const line = `data: ${JSON.stringify(ev)}\n\n`;
      for (const res of s.streams) res.write(line);
    },
    count(route) {
      return s.requests.filter((r) => r === route).length;
    },
    bodiesFor(route) {
      return s.bodies.filter((b) => b.route === route).map((b) => b.body);
    },
    async close() {
      for (const res of s.streams) res.destroy();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

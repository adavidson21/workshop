/* Workshop SDK (sdk: 1). See docs/sdk.md.

   Apps use this for everything that leaves the app: navigation, toasts, badges, notifications,
   commands, theme, data and connectors. No ad hoc postMessage, no direct fetch to the agent.

     import { connect } from '../../shared/workshop-sdk.js';
     const ws = await connect({ app: 'prioritizer' });

   connect() picks the backend once, when the page loads (docs/run-modes.md):
     1. Served by the agent (origin is 127.0.0.1:<port> or localhost:<port> and GET /api/health
        returns the agent) -> mode 'local', backend 'agent'.
     2. Paired (workshop.agent in localStorage, and GET <url>/api/health then /api/apps succeed)
        -> mode 'hosted', backend 'agent'.
     3. Otherwise -> mode 'browser', backend 'browser' (IndexedDB).

   Shell methods (open, toast, badge, notify, commands, theme, events) travel to the shell by
   postMessage. Data and connector calls go straight to the agent or the browser backend, so an
   app also works when opened on its own (ws.embedded === false). */
const SDK_VERSION = 1;
const PAIR_KEY = 'workshop.agent';
const HEALTH_TIMEOUT_MS = 1500;
const READY_TIMEOUT_MS = 3000;
// The shell page is the site root, one folder up from shared/. Works under a subpath too (GitHub Pages).
const SHELL_URL = new URL('../', import.meta.url);

/* ---------- errors ---------- */
export class WorkshopError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'WorkshopError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
function errorFrom(body, status) {
  const code = (body && body.code) || 'internal';
  const message = (body && body.error) || (body && body.message) || `Request failed (${status})`;
  return new WorkshopError(code, message, status);
}

/* ---------- small helpers ---------- */
const randomId = (p) => p + Math.random().toString(36).slice(2, 10);
// Deep equality with object keys compared regardless of order (data-format.md "differs").
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const withoutStamp = (o) => { const { updatedAt, ...rest } = o; return canonical(rest); };
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/* ---------- change stamps and merge (docs/data-format.md) ---------- */
const TOMBSTONE_TTL = 60 * 864e5; // 60 days

// Stamp what changed between before and after, at time now (ms). Mutates and returns after.
function stampEnvelope(before, after, now = Date.now()) {
  after.deleted = after.deleted || {};
  const prev = new Map((before && before.items || []).map(i => [i.id, withoutStamp(i)]));
  const cur = new Set();
  for (const item of after.items) {
    cur.add(item.id);
    if (prev.get(item.id) !== withoutStamp(item)) {
      item.updatedAt = now;
      delete after.deleted[item.id];
    }
  }
  for (const id of prev.keys()) if (!cur.has(id)) after.deleted[id] = now;
  if (after.meta && (!(before && before.meta) || withoutStamp(before.meta) !== withoutStamp(after.meta))) after.meta.updatedAt = now;
  for (const [id, t] of Object.entries(after.deleted)) if (now - t > TOMBSTONE_TTL) delete after.deleted[id];
  return after;
}

// Merge two envelopes of the same schema and version. Pure; returns a new envelope with remote's rev.
function mergeEnvelopes(local, remote) {
  if (local.schema !== remote.schema || local.version !== remote.version) {
    throw new WorkshopError('bad_request', `Cannot merge ${local.schema} v${local.version} with ${remote.schema} v${remote.version}. Migrate first.`);
  }
  const deleted = { ...(local.deleted || {}) };
  for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] ?? 0, t);

  const L = new Map(local.items.map(i => [i.id, i]));
  const R = new Map(remote.items.map(i => [i.id, i]));
  const order = [...remote.items.map(i => i.id), ...local.items.map(i => i.id).filter(id => !R.has(id))];
  const items = [];
  for (const id of order) {
    const a = L.get(id), b = R.get(id);
    const pick = !a ? b : !b ? a : (a.updatedAt > b.updatedAt ? a : b);
    if (id in deleted && deleted[id] >= pick.updatedAt) continue;
    delete deleted[id];
    items.push(clone(pick));
  }

  const out = { schema: remote.schema, version: remote.version, rev: remote.rev };
  if (remote.updatedAt !== undefined) out.updatedAt = remote.updatedAt;
  out.items = items;
  out.deleted = deleted;
  const lm = local.meta, rm = remote.meta;
  const meta = !lm ? rm : !rm ? lm : (lm.updatedAt > rm.updatedAt ? lm : rm);
  if (meta) out.meta = clone(meta);
  return out;
}

/* ---------- backend selection (docs/run-modes.md) ---------- */
async function fetchJson(url, opts, timeoutMs) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, Object.assign({ cache: 'no-store' }, opts, ctrl ? { signal: ctrl.signal } : {}));
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { res, body };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pairedAgent() {
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.url === 'string' && typeof v.token === 'string') return v;
  } catch (e) { /* unreadable */ }
  return null;
}

// Decide {mode, backend, agentUrl, token}. Called once by connect(). The shell calls it too
// (exported as detectBackend), so the shell and its apps always agree on the mode.
async function pickBackend() {
  const origin = location.origin;
  const localish = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

  // 1. Served by the agent on this same origin.
  if (localish) {
    try {
      const { res, body } = await fetchJson(origin + '/api/health', { targetAddressSpace: 'loopback' }, HEALTH_TIMEOUT_MS);
      if (res.ok && body && body.app === 'workshop-agent' && body.api === 1) {
        // Get the header token for this origin (the cookie authenticates the call).
        let token = null;
        try {
          const sess = await fetchJson(origin + '/api/session', { targetAddressSpace: 'loopback' }, HEALTH_TIMEOUT_MS);
          if (sess.res.ok && sess.body && sess.body.token) token = sess.body.token;
        } catch (e) { /* session not reachable; writes will fail clearly */ }
        return { mode: 'local', backend: 'agent', agentUrl: origin, token };
      }
    } catch (e) { /* fall through */ }
  }

  // 2. Paired with an agent (hosted).
  const pair = pairedAgent();
  if (pair) {
    try {
      const health = await fetchJson(pair.url + '/api/health', { targetAddressSpace: 'loopback' }, HEALTH_TIMEOUT_MS);
      if (health.res.ok && health.body && health.body.app === 'workshop-agent' && health.body.api === 1) {
        const apps = await fetchJson(pair.url + '/api/apps', { targetAddressSpace: 'loopback', headers: { 'X-Workshop-Token': pair.token } }, HEALTH_TIMEOUT_MS);
        if (apps.res.ok) return { mode: 'hosted', backend: 'agent', agentUrl: pair.url, token: pair.token };
      }
    } catch (e) { /* fall through */ }
  }

  // 3. Browser only.
  return { mode: 'browser', backend: 'browser', agentUrl: null, token: null };
}

/* ---------- agent data backend ---------- */
function makeAgentBackend(ctx) {
  const base = ctx.agentUrl;
  const headers = (extra) => {
    const h = Object.assign({}, extra);
    if (ctx.token) h['X-Workshop-Token'] = ctx.token;
    return h;
  };
  const common = { targetAddressSpace: 'loopback' };

  async function get(app, collection) {
    const { res, body } = await fetchJson(`${base}/api/data/${app}/${collection}`, Object.assign({ headers: headers() }, common));
    if (res.status === 404) return null;
    if (!res.ok) throw errorFrom(body, res.status);
    return body;
  }
  async function put(app, collection, envelope) {
    const { res, body } = await fetchJson(`${base}/api/data/${app}/${collection}`, Object.assign({
      method: 'PUT',
      headers: headers({ 'Content-Type': 'application/json', 'X-Workshop-Client': ctx.clientId }),
      body: JSON.stringify(envelope)
    }, common));
    if (res.status === 409) { const err = errorFrom(body, 409); err.current = body && body.current; throw err; }
    if (!res.ok) throw errorFrom(body, res.status);
    return body; // {rev, updatedAt}
  }
  return {
    kind: 'agent', get, put,
    // Subscriptions come from the event stream (ctx.events).
    subscribe(app, collection, handler) { return ctx.events.onData(app, collection, handler); },
    async list(app) {
      const { res, body } = await fetchJson(`${base}/api/data/${app}`, Object.assign({ headers: headers() }, common));
      if (!res.ok) throw errorFrom(body, res.status);
      return body;
    },
    connectorsAvailable: true
  };
}

/* ---------- browser data backend (IndexedDB + BroadcastChannel) ---------- */
function makeBrowserBackend(ctx) {
  const DB = 'workshop', STORE = 'data';
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new WorkshopError('internal', 'Could not open browser storage.'));
    });
    return dbPromise;
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(new WorkshopError('internal', 'Browser storage error.'));
      t.onabort = () => reject(new WorkshopError('conflict', 'Browser storage write was aborted.'));
    }));
  }
  const reqAsPromise = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const key = (app, collection) => `${app}/${collection}`;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('workshop-data') : null;

  async function get(app, collection) {
    const stored = await tx('readonly', s => reqAsPromise(s.get(key(app, collection))));
    return stored || null;
  }
  async function put(app, collection, envelope) {
    if (envelope.schema !== `${app}.${collection}`) throw new WorkshopError('bad_request', `schema must be ${app}.${collection}.`);
    const seen = new Set();
    for (const it of envelope.items || []) { if (seen.has(it.id)) throw new WorkshopError('bad_request', 'Duplicate item id.'); seen.add(it.id); }
    const now = new Date().toISOString();
    const result = await tx('readwrite', async (s) => {
      const stored = await reqAsPromise(s.get(key(app, collection)));
      const storedRev = stored ? stored.rev : 0;
      if ((envelope.rev || 0) !== storedRev) {
        const current = stored || { schema: `${app}.${collection}`, version: envelope.version, rev: 0, updatedAt: now, items: [], deleted: {} };
        const err = new WorkshopError('conflict', 'That collection changed since you loaded it. Reload and try again.');
        err.current = current;
        throw err;
      }
      if (stored && envelope.version < stored.version) throw new WorkshopError('downgrade', 'A data put tried to lower the collection version.');
      // The backend sets rev and updatedAt exactly as the agent does; items/deleted/meta untouched.
      const next = clone(envelope);
      next.rev = storedRev + 1;
      next.updatedAt = now;
      s.put(next, key(app, collection));
      return { rev: next.rev, updatedAt: next.updatedAt };
    });
    // Same payload as the agent's data event, so other tabs update.
    if (channel) channel.postMessage({ app, collection, rev: result.rev, updatedAt: result.updatedAt, client: ctx.clientId });
    return result;
  }
  const subscribers = [];
  if (channel) channel.onmessage = (e) => { const m = e.data; if (m && m.client !== ctx.clientId) subscribers.forEach(fn => fn(m)); };
  function subscribe(app, collection, handler) {
    const fn = (m) => { if (m.app === app && m.collection === collection) handler(m); };
    subscribers.push(fn);
    return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); };
  }
  async function list(app) {
    const d = await db();
    const all = await new Promise((resolve, reject) => {
      const out = [];
      const t = d.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return resolve(out); out.push([c.key, c.value]); c.continue(); };
      req.onerror = () => reject(req.error);
    });
    const collections = all.filter(([k]) => k.startsWith(app + '/')).map(([k, env]) => ({
      collection: k.slice(app.length + 1), schema: env.schema, version: env.version, rev: env.rev, updatedAt: env.updatedAt, items: (env.items || []).length
    }));
    return { app, collections };
  }
  async function allCollections() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const out = [];
      const t = d.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return resolve(out); const [app, collection] = String(c.key).split('/'); out.push({ app, collection, envelope: c.value }); c.continue(); };
      req.onerror = () => reject(req.error);
    });
  }
  return { kind: 'browser', get, put, subscribe, list, allCollections, connectorsAvailable: false };
}

/* ---------- event stream (agent backend) ----------
   One EventSource per browser for each agent, not one per page. Browsers allow only 6 HTTP/1.1
   connections to one origin, and each open stream holds one, so a stream per app frame and window would
   soon starve every other request to the agent. One page (the holder, picked with the Web Locks API)
   opens the stream and relays each event to the others over a BroadcastChannel; when it closes, the
   lock passes to another page, which opens the stream. Without Web Locks each page opens its own. */
const hubs = new Map(); // agentUrl -> hub, one per page

function eventHub(ctx) {
  if (hubs.has(ctx.agentUrl)) return hubs.get(ctx.agentUrl);
  const listeners = new Set();     // fn(name, payload)
  const onlineListeners = new Set();
  let online = true;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('workshop-events') : null;
  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  const deliver = (name, payload) => listeners.forEach(fn => fn(name, payload));
  const setOnline = (v) => { if (v !== online) { online = v; onlineListeners.forEach(fn => fn({ online })); } };

  // Holder: open the stream, deliver here, relay to other pages.
  function hold() {
    let source = null, retry = null;
    const relay = (m) => { if (channel) channel.postMessage(Object.assign({ agent: ctx.agentUrl }, m)); };
    const announce = (v) => { setOnline(v); relay({ online: v }); };
    function open() {
      const u = new URL(ctx.agentUrl + '/api/events');
      // EventSource cannot set headers; hosted pages pass the token as a query parameter (agent-api.md).
      if (ctx.mode === 'hosted' && ctx.token) u.searchParams.set('token', ctx.token);
      try { source = new EventSource(u.toString(), { withCredentials: ctx.mode === 'local' }); } catch (e) { announce(false); return later(); }
      source.addEventListener('open', () => announce(true));
      for (const name of ['data', 'connector', 'connector-status', 'config']) {
        source.addEventListener(name, (e) => { const p = parse(e.data); if (p) { deliver(name, p); relay({ name, payload: p }); } });
      }
      source.addEventListener('error', () => { announce(false); try { source.close(); } catch (e) { /* closed */ } later(); });
    }
    // No silent switching (run-modes.md): keep trying every 5 seconds; ws.online says what is happening.
    function later() { if (!retry) retry = setTimeout(() => { retry = null; open(); }, 5000); }
    if (channel) channel.addEventListener('message', (e) => { const m = e.data; if (m && m.agent === ctx.agentUrl && m.hello) relay({ online }); });
    open();
  }

  // Everyone listens for relayed events (the holder's own channel never hears itself).
  if (channel) {
    channel.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.agent !== ctx.agentUrl) return;
      if (m.name) deliver(m.name, m.payload);
      else if (typeof m.online === 'boolean') setOnline(m.online);
    });
  }
  if (typeof EventSource === 'function') {
    if (channel && typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      // The callback's promise never settles, so the lock is held until this page goes away.
      navigator.locks.request('workshop-events ' + ctx.agentUrl, () => { hold(); return new Promise(() => {}); }).catch(() => {});
      channel.postMessage({ agent: ctx.agentUrl, hello: true }); // ask the holder whether the agent is online
    } else hold();
  }

  const hub = {
    get online() { return online; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onOnline(fn) { onlineListeners.add(fn); return () => onlineListeners.delete(fn); }
  };
  hubs.set(ctx.agentUrl, hub);
  return hub;
}

function makeEventStream(ctx) {
  const hub = eventHub(ctx);
  const on = (fn) => hub.on(fn);
  return {
    get online() { return hub.online; },
    onData(app, collection, handler) {
      // Writes made through this ws carry its client id and are not reported back to it.
      return on((name, p) => { if (name === 'data' && p.app === app && p.collection === collection && p.client !== ctx.clientId) handler(p); });
    },
    onConnector(id, event, fn) { return on((name, p) => { if (name === 'connector' && p.id === id && (event === '*' || p.event === event)) fn(p); }); },
    onStatus(id, fn) { return on((name, p) => { if (name === 'connector-status' && p.id === id) fn(p.status); }); },
    onOnline(fn) { return hub.onOnline(fn); }
  };
}

/* ---------- shell channel: postMessage to the shell (embedded) or in-page fallbacks (standalone) ---------- */
function makeShellChannel(ctx) {
  const pending = new Map();
  const eventHandlers = { theme: [], route: [], command: [], visible: [], online: [] };
  const embedded = (() => { try { return window.parent !== window && window.parent.location.origin === location.origin; } catch (e) { return false; } })();

  function emit(event, payload) { (eventHandlers[event] || []).forEach(fn => fn(payload)); }

  // Messages from the shell (embedded) arrive here.
  if (embedded) {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const m = e.data;
      if (!m || m.workshop !== 1) return;
      if (m.kind === 'response' && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.ok) resolve(m.result);
        else reject(new WorkshopError(m.error && m.error.code || 'internal', m.error && m.error.message));
      } else if (m.kind === 'event' && eventHandlers[m.event]) {
        emit(m.event, m.payload);
      }
    });
  }

  function request(method, params, timeoutMs) {
    if (!embedded) return standalone(method, params);
    return new Promise((resolve, reject) => {
      const id = randomId('r');
      const timer = timeoutMs ? setTimeout(() => { pending.delete(id); reject(new WorkshopError('unavailable', 'The shell did not answer.')); }, timeoutMs) : null;
      pending.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); }
      });
      window.parent.postMessage({ workshop: 1, kind: 'request', id, method, params }, location.origin);
    });
  }

  // Standalone (ws.embedded === false): shell methods still work, locally (docs/sdk.md Standalone pages).
  function standalone(method, params) {
    switch (method) {
      case 'open': {
        const hash = '#/' + params.app + (params.path ? '/' + encodeURIComponent(params.path) : '');
        location.href = SHELL_URL.href + hash;
        return Promise.resolve(null);
      }
      case 'toast': inPageToast(params.text, params.action); return Promise.resolve(null);
      case 'badge': {
        const base = document.title.replace(/^\(\d+\)\s*/, '');
        document.title = params.count ? `(${params.count}) ${base}` : base;
        return Promise.resolve(null);
      }
      case 'notify': {
        if (typeof Notification === 'function' && Notification.permission === 'granted') new Notification(params.title, { body: params.body });
        else inPageToast(params.title);
        return Promise.resolve(null);
      }
      case 'commands.register': {
        if (params.shortcut) bindShortcut(params.shortcut, params.id);
        return Promise.resolve(null);
      }
      case 'commands.unregister': return Promise.resolve(null);
      default: return Promise.resolve(null);
    }
  }
  let toastEl = null;
  function inPageToast(text, action) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('role', 'status');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);display:flex;gap:.75rem;align-items:center;background:#222;color:#fff;padding:.5rem .9rem;border-radius:8px;font:500 14px system-ui;z-index:2147483647;opacity:0;transition:opacity .2s';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = '';
    const span = document.createElement('span'); span.textContent = text; toastEl.appendChild(span);
    if (action && action.label && action.command) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.style.cssText = 'background:none;border:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer';
      b.addEventListener('click', () => { toastEl.style.opacity = '0'; emit('command', { id: action.command }); });
      toastEl.appendChild(b);
    }
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 4000);
  }
  const shortcuts = [];
  function bindShortcut(keys, commandId) {
    shortcuts.push({ keys, commandId });
    if (shortcuts.length === 1) {
      window.addEventListener('keydown', (e) => {
        const pressed = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
        const name = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        const combo = [...pressed, name].join('+');
        const hit = shortcuts.find(s => s.keys === combo);
        if (hit) { e.preventDefault(); emit('command', { id: hit.commandId }); }
      });
    }
  }

  return { embedded, request, emit, on(event, fn) { (eventHandlers[event] ||= []).push(fn); return () => { const a = eventHandlers[event]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; } };
}

/* ---------- connect ---------- */
export async function connect(options) {
  const app = options && options.app;
  if (!app) throw new WorkshopError('bad_request', 'connect({app}) needs an app id.');

  const picked = await pickBackend();
  const ctx = {
    app,
    mode: picked.mode,
    backend: picked.backend,
    agentUrl: picked.agentUrl,
    token: picked.token,
    clientId: randomId('w-')
  };
  ctx.events = (picked.backend === 'agent') ? makeEventStream(ctx) : { get online() { return false; }, onData() { return () => {}; }, onConnector() { return () => {}; }, onStatus() { return () => {}; }, onOnline() { return () => {}; } };
  const data = (picked.backend === 'agent') ? makeAgentBackend(ctx) : makeBrowserBackend(ctx);
  const shell = makeShellChannel(ctx);

  // Tell the shell the app is ready and learn the initial theme/route/visibility.
  let initial = { theme: null, route: '', visible: true };
  if (shell.embedded) {
    try { initial = await shell.request('ready', { app, sdk: SDK_VERSION }, READY_TIMEOUT_MS) || initial; } catch (e) { /* no answer: keep the defaults */ }
  }

  // Keep the theme current() returns up to date.
  shell.on('theme', (t) => {
    initial.theme = t;
    // Apps that use shared/themes.css and data-theme get the theme applied (docs/sdk.md, theme event).
    const root = document.documentElement;
    if (t && t.key && root.hasAttribute('data-theme')) root.dataset.theme = t.key;
  });

  // Wire online events: from the event stream (agent) or never (browser).
  ctx.events.onOnline((p) => shell.emit('online', p));

  const ws = {
    get mode() { return ctx.mode; },
    get backend() { return ctx.backend; },
    get online() { return ctx.events.online; },
    get embedded() { return shell.embedded; },

    /* shell */
    open(target) { return shell.request('open', { app: target.app, path: target.path }); },
    toast(text, opts) { return shell.request('toast', Object.assign({ text }, opts)); },
    badge(count) { return shell.request('badge', { count }); },
    notify(opts) { return shell.request('notify', opts); },
    commands: {
      register(cmd) {
        shell.request('commands.register', cmd);
        return () => shell.request('commands.unregister', { id: cmd.id });
      }
    },
    theme: {
      current() {
        if (initial.theme) return initial.theme;
        const T = window.WorkshopTheme;
        if (T) { const key = T.current(); return { key, scheme: T.scheme(key) }; }
        return { key: 'system', scheme: 'light' };
      }
    },
    on(event, handler) { return shell.on(event, handler); },

    /* data */
    data: {
      async get(collection, opts) { return data.get((opts && opts.app) || app, collection); },
      async put(collection, envelope) { return data.put(app, collection, envelope); },
      subscribe(collection, handler, opts) { return data.subscribe((opts && opts.app) || app, collection, handler); },
      merge(local, remote) { return mergeEnvelopes(local, remote); },
      stamp(before, after) { return stampEnvelope(before, after); },
      async export(opts) {
        const wantApps = opts && opts.apps;
        const collections = [];
        if (data.kind === 'agent') {
          const appsList = wantApps || await agentAppIds(ctx);
          for (const a of appsList) {
            const listing = await data.list(a);
            for (const c of listing.collections) {
              const env = await data.get(a, c.collection);
              if (env) collections.push({ app: a, collection: c.collection, envelope: env });
            }
          }
        } else {
          const all = await data.allCollections();
          for (const row of all) if (!wantApps || wantApps.includes(row.app)) collections.push(row);
        }
        return { schema: 'workshop.bundle', version: 1, exportedAt: new Date().toISOString(), source: { mode: ctx.mode, backend: ctx.backend }, collections };
      },
      async import(bundle) {
        let created = 0, merged = 0;
        for (const row of (bundle.collections || [])) {
          const existing = await data.get(row.app, row.collection);
          if (!existing) {
            const env = clone(row.envelope); env.rev = 0;
            await putWithRetry(data, row.app, row.collection, env);
            created++;
          } else {
            const combined = mergeEnvelopes(row.envelope, existing);
            combined.rev = existing.rev;
            await putWithRetry(data, row.app, row.collection, combined);
            merged++;
          }
        }
        return { created, merged };
      }
    },

    /* connectors */
    connectors: {
      async list() {
        if (!data.connectorsAvailable) return [];
        const body = await agentCall(ctx, 'GET', '/api/connectors');
        return (body && body.connectors) || [];
      },
      async call(id, action, args, opts) {
        if (!data.connectorsAvailable) throw new WorkshopError('unavailable', 'Connectors are not available in browser mode.');
        const body = await agentCall(ctx, 'POST', `/api/connectors/${id}/${action}`, { args: args || {}, confirm: !!(opts && opts.confirm) });
        return body && body.result;
      },
      on(id, event, handler) { return ctx.events.onConnector(id, event, handler); },
      onStatus(id, handler) { return ctx.events.onStatus(id, handler); },
      // A connector's settings: {id, schema, config, env} (GET /api/connectors/<id>/config). For the Settings app.
      getConfig(id) { return agentCall(ctx, 'GET', `/api/connectors/${id}/config`); },
      // Change them. The agent refuses this from a hosted page (code local_only).
      putConfig(id, config) { return agentCall(ctx, 'PUT', `/api/connectors/${id}/config`, { config }); }
    },

    /* Workshop settings (docs/config.md). Agent backend only; browser mode rejects with code unavailable. */
    config: {
      // The public view of config.json (GET /api/config).
      get() { return agentCall(ctx, 'GET', '/api/config'); },
      // Change features, allowedOrigins, connectors on/off or port. Resolves {config, restartRequired}.
      put(patch) { return agentCall(ctx, 'PUT', '/api/config', patch); }
    }
  };
  return ws;
}

// One JSON request to the agent with the token header. Rejects with code unavailable in browser mode.
async function agentCall(ctx, method, pathname, body) {
  if (ctx.backend !== 'agent') throw new WorkshopError('unavailable', 'Workshop is not running on this computer, or this page is not connected to it.');
  const headers = {};
  if (ctx.token) headers['X-Workshop-Token'] = ctx.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const { res, body: out } = await fetchJson(ctx.agentUrl + pathname, {
    method, targetAddressSpace: 'loopback', headers, body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw errorFrom(out, res.status);
  return out;
}

async function putWithRetry(data, app, collection, envelope) {
  try {
    return await data.put(app, collection, envelope);
  } catch (e) {
    if (e instanceof WorkshopError && e.code === 'conflict' && e.current) {
      const combined = mergeEnvelopes(envelope, e.current);
      combined.rev = e.current.rev;
      return data.put(app, collection, combined);
    }
    throw e;
  }
}

async function agentAppIds(ctx) {
  const { res, body } = await fetchJson(ctx.agentUrl + '/api/apps', { targetAddressSpace: 'loopback', headers: ctx.token ? { 'X-Workshop-Token': ctx.token } : {} });
  if (!res.ok) return [];
  return ((body && body.apps) || []).map(a => a.manifest.id);
}

// The pure envelope helpers are exported for tests and for apps that need them without a connection.
// ws.data.merge and ws.data.stamp call exactly these.
export const data = { merge: mergeEnvelopes, stamp: stampEnvelope };

export { pickBackend as detectBackend };

export default { connect, WorkshopError, data, detectBackend: pickBackend };

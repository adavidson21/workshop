/* Workshop SDK (sdk: 1). See docs/sdk.md.

   Apps use this for everything that leaves the app: navigation, toasts, badges, notifications,
   commands, theme, data, files and connectors. No ad hoc postMessage, no direct fetch to the agent.

     import { connect } from '../../shared/workshop-sdk.js';
     const ws = await connect({ app: 'prioritizer' });

   connect() picks the backend once, when the page loads (docs/run-modes.md):
     1. Served by the agent (origin is 127.0.0.1:<port> or localhost:<port> and GET /api/health
        returns the agent) -> mode 'local', backend 'agent'.
     2. Paired (workshop.agent in localStorage, and GET <url>/api/health then /api/apps succeed)
        -> mode 'hosted', backend 'agent'.
     3. Otherwise -> mode 'browser', backend 'browser': the folder store when a folder handle is saved
        (File System Access API), else the IndexedDB store. ws.storage says which.

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

/* ---------- names (docs/data-format.md, Names) ----------
   Checked before any request, on every backend, so a bad name is always bad_request. */
const APP_RE = /^[a-z][a-z0-9-]{0,39}$/;
const SEG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FILE_RE = /^([a-z0-9][a-z0-9-]{0,39})\.(md|json)$/;
const MAX_SEGS = 4;
const FILE_MAX = 10 * 1024 * 1024;
const bad = (msg) => new WorkshopError('bad_request', msg, 400);

function checkApp(app) {
  if (typeof app !== 'string' || !APP_RE.test(app)) throw bad(`"${app}" is not a valid app name.`);
  return app;
}
// A collection name: 1 to 4 segments. Returns the segments.
function checkCollection(name) {
  const segs = typeof name === 'string' ? name.split('/') : [];
  if (segs.length < 1 || segs.length > MAX_SEGS || !segs.every(s => SEG_RE.test(s))) throw bad(`"${name}" is not a valid collection name. Use 1 to 4 parts like entries/person-one/2026.`);
  return segs;
}
// A folder for listing files: 0 to 3 segments.
function checkFolder(name) {
  if (name === undefined || name === null || name === '') return [];
  const segs = typeof name === 'string' ? name.split('/') : [null];
  if (segs.length > MAX_SEGS - 1 || !segs.every(s => SEG_RE.test(s))) throw bad(`"${name}" is not a valid folder name.`);
  return segs;
}
// A file path: 1 to 4 segments, the last ending in .md or .json.
function checkFile(name) {
  const segs = typeof name === 'string' ? name.split('/') : [];
  if (segs.length < 1 || segs.length > MAX_SEGS || !segs.slice(0, -1).every(s => SEG_RE.test(s))) throw bad(`"${name}" is not a valid file path. Use names like notes/2026-plan.md.`);
  const last = segs[segs.length - 1];
  if (!FILE_RE.test(last)) throw bad(/^[a-z0-9][a-z0-9-]{0,39}\.[^.]+$/.test(last) ? 'Only .md and .json files are allowed.' : `"${last}" is not a valid file name.`);
  return segs;
}
// Light envelope check before a write (the agent checks the full schema; this catches the same mistakes apps make).
function checkEnvelope(app, collection, env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw bad('A collection is an envelope object.');
  if (env.schema !== `${app}.${collection}`) throw bad(`schema must be "${app}.${collection}".`);
  if (!Number.isInteger(env.version) || env.version < 1) throw bad('version must be a whole number, 1 or more.');
  if (!Number.isInteger(env.rev) || env.rev < 0) throw bad('rev must be the revision you read (0 to create).');
  if (!Array.isArray(env.items)) throw bad('items must be an array.');
  const ids = new Set();
  for (const it of env.items) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id || it.id.length > 200) throw bad('Every item needs a string id of 1 to 200 characters.');
    if (ids.has(it.id)) throw bad(`Item id "${it.id}" appears more than once.`);
    ids.add(it.id);
  }
}
// Does this text, stored at <app>/<path>.json, mean to be a collection? JSON whose schema is its own name.
function isCollectionText(app, path, text) {
  if (!path.endsWith('.json')) return false;
  let v;
  try { v = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { return false; }
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && v.schema === `${app}.${path.slice(0, -5)}`;
}
function checkFileContent(app, path, content) {
  if (typeof content !== 'string') throw bad('File content is text.');
  const size = new TextEncoder().encode(content).length;
  if (size > FILE_MAX) throw new WorkshopError('too_large', 'A file can be at most 10 MB.', 413);
  if (path.endsWith('.json')) {
    try { JSON.parse(content); } catch (e) { throw bad(`${path} must hold valid JSON.`); }
    if (isCollectionText(app, path, content)) throw bad('That content is a collection for this path. Save it with ws.data instead.');
  }
  return size;
}
function checkWriteOpts(opts) {
  const o = opts || {};
  const hasM = typeof o.mtime === 'number', hasC = o.create === true;
  if (hasM === hasC) throw bad('Pass {mtime} (the mtime you read) to replace a file, or {create: true} to create one.');
  return o;
}
const fileConflict = (message, current) => { const e = new WorkshopError('conflict', message, 409); e.current = current; return e; };
const collectionConflict = (current) => { const e = new WorkshopError('conflict', 'That collection changed since you loaded it. Reload and try again.', 409); e.current = current; return e; };
const downgrade = (stored, mine) => new WorkshopError('downgrade', `This data is version ${stored}. A version ${mine} writer cannot save it. Update Workshop.`, 400);
// UTC stamp for trash names: 20261025T140500123Z (docs/data-format.md, Trash).
const trashStamp = (d) => d.toISOString().replace(/[-:.]/g, '');
// Does a file event at `path` concern a subscription to `target` (a file path, a folder, or '' for every file)?
const coversPath = (target, path) => !target || target === path || path.startsWith(target + '/');
const isFilePath = (s) => /\.(md|json)$/.test(s || '');
// Envelope as stored: no extra top-level fields, rev and updatedAt set by the backend.
function storedEnvelope(env, rev, updatedAt) {
  const next = { schema: env.schema, version: env.version, rev, updatedAt, items: env.items };
  if (env.deleted !== undefined) next.deleted = env.deleted;
  if (env.meta !== undefined) next.meta = env.meta;
  return next;
}

/* ---------- IndexedDB (docs/run-modes.md, Browser backend) ----------
   Database "workshop": object stores data (envelopes, plus the _moved mark), files, trash, and handles (the
   folder handle, key "folder"). Version 2 added files, trash and handles; data from version 1 is kept. */
const IDB_NAME = 'workshop', IDB_VERSION = 2;
const IDB_STORES = ['data', 'files', 'trash', 'handles'];
let idbPromise = null;
function openIdb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new WorkshopError('unavailable', 'This browser has no storage for Workshop.'));
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => { const d = req.result; for (const s of IDB_STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    req.onsuccess = () => {
      const d = req.result;
      // Another tab opened a newer version: let it upgrade, and open again on the next call.
      d.onversionchange = () => { d.close(); idbPromise = null; };
      resolve(d);
    };
    req.onerror = () => { idbPromise = null; reject(new WorkshopError('internal', 'Could not open browser storage.')); };
    req.onblocked = () => { /* another tab holds version 1 open; it closes on versionchange */ };
  });
  return idbPromise;
}
const reqAsPromise = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
// Run fn(stores) in one transaction over the named stores. Only IndexedDB requests may be awaited inside fn.
function idbTx(names, mode, fn) {
  return openIdb().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(names, mode);
    const stores = Object.fromEntries([].concat(names).map(n => [n, t.objectStore(n)]));
    let result, failure = null;
    Promise.resolve().then(() => fn(stores)).then(r => { result = r; }, e => { failure = e; try { t.abort(); } catch (x) { /* already done */ } });
    t.oncomplete = () => (failure ? reject(failure) : resolve(result));
    t.onerror = () => { if (!failure) failure = new WorkshopError('internal', 'Browser storage error.'); };
    t.onabort = () => reject(failure || new WorkshopError('conflict', 'Browser storage write was aborted.'));
  }));
}
function idbEntries(storeName) {
  return idbTx(storeName, 'readonly', (s) => new Promise((resolve, reject) => {
    const out = [];
    const req = s[storeName].openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return resolve(out); out.push([String(c.key), c.value]); c.continue(); };
    req.onerror = () => reject(req.error);
  }));
}
// The saved folder handle, or null. Never rejects. tests/e2e.py swaps where the handle is kept through
// window.__workshopHandleStore ({load, save}): some headless test browsers crash reading a directory handle back
// from IndexedDB, and the folder picker cannot be automated anyway. Nothing else sets it.
const handleStore = () => (typeof window !== 'undefined' && window.__workshopHandleStore) || null;
async function savedFolderHandle() {
  try {
    const hs = handleStore();
    if (hs) return (await hs.load()) || null;
    return (await idbTx('handles', 'readonly', s => reqAsPromise(s.handles.get('folder')))) || null;
  } catch (e) { return null; }
}
function saveFolderHandle(handle) {
  const hs = handleStore();
  if (hs) return hs.save(handle);
  return idbTx('handles', 'readwrite', s => { s.handles.put(handle, 'folder'); });
}
async function idbMoved() {
  try { return (await idbTx('data', 'readonly', s => reqAsPromise(s.data.get('_moved')))) || null; } catch (e) { return null; }
}

function newChannel() { return typeof BroadcastChannel === 'function' ? new BroadcastChannel('workshop-data') : null; }

/* ---------- agent data backend ---------- */
function makeAgentBackend(ctx) {
  const base = ctx.agentUrl;
  const headers = (extra) => {
    const h = Object.assign({}, extra);
    if (ctx.token) h['X-Workshop-Token'] = ctx.token;
    return h;
  };
  const common = { targetAddressSpace: 'loopback' };
  const enc = (segs) => segs.map(encodeURIComponent).join('/');

  async function get(app, collection) {
    const segs = checkCollection(collection);
    const { res, body } = await fetchJson(`${base}/api/data/${checkApp(app)}/${enc(segs)}`, Object.assign({ headers: headers() }, common));
    if (res.status === 404) return null;
    if (!res.ok) throw errorFrom(body, res.status);
    return body;
  }
  async function put(app, collection, envelope) {
    const segs = checkCollection(collection);
    const { res, body } = await fetchJson(`${base}/api/data/${checkApp(app)}/${enc(segs)}`, Object.assign({
      method: 'PUT',
      headers: headers({ 'Content-Type': 'application/json', 'X-Workshop-Client': ctx.clientId }),
      body: JSON.stringify(envelope)
    }, common));
    if (res.status === 409) { const err = errorFrom(body, 409); err.current = body && body.current; throw err; }
    if (!res.ok) throw errorFrom(body, res.status);
    return body; // {rev, updatedAt}
  }
  async function list(app) {
    const { res, body } = await fetchJson(`${base}/api/data/${checkApp(app)}`, Object.assign({ headers: headers() }, common));
    if (!res.ok) throw errorFrom(body, res.status);
    return body;
  }

  // Files (docs/agent-api.md, Files).
  const files = {
    async list(app, folder) {
      const segs = checkFolder(folder);
      const { res, body } = await fetchJson(`${base}/api/files/${checkApp(app)}${segs.length ? '/' + enc(segs) : ''}`, Object.assign({ headers: headers() }, common));
      if (!res.ok) throw errorFrom(body, res.status);
      return (body && body.files) || [];
    },
    async read(app, path) {
      const segs = checkFile(path);
      const { res, body } = await fetchJson(`${base}/api/files/${checkApp(app)}/${enc(segs)}`, Object.assign({ headers: headers() }, common));
      if (res.status === 404) return null;
      if (!res.ok) throw errorFrom(body, res.status);
      return body;
    },
    async write(app, path, content, opts) {
      const segs = checkFile(path);
      const o = checkWriteOpts(opts);
      checkFileContent(app, path, content);
      const { res, body } = await fetchJson(`${base}/api/files/${checkApp(app)}/${enc(segs)}`, Object.assign({
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/json', 'X-Workshop-Client': ctx.clientId }),
        body: JSON.stringify(o.create ? { content, create: true } : { content, mtime: o.mtime })
      }, common));
      if (res.status === 409) { const err = errorFrom(body, 409); err.current = body ? body.current : null; throw err; }
      if (!res.ok) throw errorFrom(body, res.status);
      return body; // {app, path, mtime, size}
    },
    async trash(app, path, opts) {
      const segs = checkFile(path);
      const m = opts && typeof opts.mtime === 'number' ? `?mtime=${opts.mtime}` : '';
      const { res, body } = await fetchJson(`${base}/api/files/${checkApp(app)}/${enc(segs)}${m}`, Object.assign({
        method: 'DELETE', headers: headers({ 'X-Workshop-Client': ctx.clientId })
      }, common));
      if (res.status === 409) { const err = errorFrom(body, 409); err.current = body ? body.current : null; throw err; }
      if (!res.ok) throw errorFrom(body, res.status);
      return body; // {app, path, trash}
    },
    subscribe(app, target, handler) { return ctx.events.onFile(app, target, handler); }
  };

  return {
    kind: 'agent', storage: 'agent', get, put, list, files,
    // Subscriptions come from the event stream (ctx.events).
    subscribe(app, collection, handler) { checkCollection(collection); return ctx.events.onData(app, collection, handler); },
    connectorsAvailable: true
  };
}

/* ---------- browser backend, IndexedDB store (docs/run-modes.md) ---------- */
function makeIdbStore(ctx, opts = {}) {
  const channel = opts.channel !== undefined ? opts.channel : newChannel();
  const key = (app, name) => `${app}/${name}`;
  const nowMs = opts.now || (() => Date.now());
  const listeners = [];
  if (channel) channel.addEventListener('message', (e) => { const m = e.data; if (m && m.client !== ctx.clientId) listeners.forEach(fn => fn(m)); });
  const post = (m) => { if (channel) channel.postMessage(m); };

  async function get(app, collection) {
    checkApp(app); checkCollection(collection);
    return (await idbTx('data', 'readonly', s => reqAsPromise(s.data.get(key(app, collection))))) || null;
  }
  async function put(app, collection, envelope) {
    checkApp(app); checkCollection(collection); checkEnvelope(app, collection, envelope);
    const now = new Date(nowMs()).toISOString();
    const result = await idbTx('data', 'readwrite', async (s) => {
      const stored = await reqAsPromise(s.data.get(key(app, collection)));
      const storedRev = stored ? stored.rev : 0;
      if (envelope.rev !== storedRev) throw collectionConflict(stored || { schema: envelope.schema, version: envelope.version, rev: 0, items: [] });
      if (stored && envelope.version < stored.version) throw downgrade(stored.version, envelope.version);
      // The backend sets rev and updatedAt exactly as the agent does; items, deleted and meta untouched.
      const next = clone(storedEnvelope(envelope, storedRev + 1, now));
      s.data.put(next, key(app, collection));
      return { rev: next.rev, updatedAt: next.updatedAt };
    });
    // Same payload as the agent's data event, so other tabs update.
    post({ app, collection, rev: result.rev, updatedAt: result.updatedAt, client: ctx.clientId });
    return result;
  }
  function subscribe(app, collection, handler) {
    checkCollection(collection);
    const fn = (m) => { if (m.collection !== undefined && m.app === app && m.collection === collection) handler(m); };
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  // Collections only: keys are <app>/<collection>; the _moved mark has no "/".
  async function allCollections() {
    return (await idbEntries('data')).filter(([k]) => k.includes('/')).map(([k, envelope]) => {
      const i = k.indexOf('/');
      return { app: k.slice(0, i), collection: k.slice(i + 1), envelope };
    });
  }
  async function list(app) {
    checkApp(app);
    const collections = (await allCollections()).filter(r => r.app === app).map(({ collection, envelope: env }) => ({
      collection, schema: env.schema, version: env.version, rev: env.rev, updatedAt: env.updatedAt, items: (env.items || []).length
    })).sort((a, b) => (a.collection < b.collection ? -1 : 1));
    return { app, collections };
  }

  const view = (app, path, v) => ({ app, path, mtime: v.mtime, size: new TextEncoder().encode(v.content).length, content: v.content });
  const files = {
    async list(app, folder) {
      checkApp(app);
      const segs = checkFolder(folder);
      const prefix = key(app, segs.length ? segs.join('/') + '/' : '');
      return (await idbEntries('files')).filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ path: k.slice(app.length + 1), mtime: v.mtime, size: new TextEncoder().encode(v.content).length }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    async read(app, path) {
      checkApp(app); checkFile(path);
      const v = await idbTx('files', 'readonly', s => reqAsPromise(s.files.get(key(app, path))));
      return v ? view(app, path, v) : null;
    },
    async write(app, path, content, opts) {
      checkApp(app); checkFile(path);
      const o = checkWriteOpts(opts);
      const size = checkFileContent(app, path, content);
      const result = await idbTx('files', 'readwrite', async (s) => {
        const cur = await reqAsPromise(s.files.get(key(app, path)));
        if (o.create && cur) throw fileConflict(`${path} already exists.`, view(app, path, cur));
        if (!o.create && !cur) throw fileConflict('That file is gone. It may have been moved to the trash.', null);
        if (!o.create && cur.mtime !== o.mtime) throw fileConflict('That file changed since you loaded it. Reload and try again.', view(app, path, cur));
        // Always later than the previous mtime, so an mtime names one version of the file.
        const mtime = Math.max(nowMs(), cur ? cur.mtime + 1 : 0);
        s.files.put({ content, mtime }, key(app, path));
        return { app, path, mtime, size };
      });
      post({ app, path, mtime: result.mtime, client: ctx.clientId });
      return result;
    },
    async trash(app, path, opts) {
      checkApp(app); checkFile(path);
      const want = opts && typeof opts.mtime === 'number' ? opts.mtime : null;
      const stamp = trashStamp(new Date(nowMs()));
      const result = await idbTx(['files', 'trash'], 'readwrite', async (s) => {
        const cur = await reqAsPromise(s.files.get(key(app, path)));
        if (!cur) throw new WorkshopError('not_found', `${app} has no file ${path}.`, 404);
        if (want !== null && cur.mtime !== want) throw fileConflict('That file changed since you loaded it. Reload and try again.', view(app, path, cur));
        let tkey = `${key(app, path)}.${stamp}`;
        for (let i = 1; await reqAsPromise(s.trash.get(tkey)); i++) tkey = `${key(app, path)}.${stamp}-${i}`;
        s.trash.put(Object.assign({ app, path, trashedAt: new Date(nowMs()).toISOString() }, cur), tkey);
        s.files.delete(key(app, path));
        return { app, path, trash: `.trash/${tkey}` };
      });
      post({ app, path, mtime: null, client: ctx.clientId });
      return result;
    },
    subscribe(app, target, handler) {
      const fn = (m) => { if (m.path !== undefined && m.app === app && coversPath(target, m.path)) handler(m); };
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    async all() { return (await idbEntries('files')).map(([k, v]) => { const i = k.indexOf('/'); return { app: k.slice(0, i), path: k.slice(i + 1), content: v.content }; }); }
  };

  return {
    kind: 'browser', storage: 'indexeddb', get, put, list, subscribe, files, allCollections, connectorsAvailable: false,
    online: false, onOnline() { return () => {}; }
  };
}

/* ---------- browser backend, folder store (docs/run-modes.md, Folder store) ----------
   Reads and writes a folder the user picked in Chrome, through the File System Access API, with the same
   layout and rules as the agent's data folder. `root` is a FileSystemDirectoryHandle (or anything with the
   same methods; tests pass an in-memory one). Before every write the file is read and checked, and just before
   writing its lastModified is read again; if it changed in between, the write starts over. Changes made
   outside this origin are found by checking lastModified of what the page subscribed to, every 5 seconds
   while the page is visible and whenever it becomes visible. */
const POLL_MS = 5000;
const RESTARTS = 5;
const SAME_MTIME_WAITS = [2, 20, 1100, 2100]; // a file system that keeps the old modified time: write again later
const isMissing = (e) => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
const isDenied = (e) => e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
const sameTime = (a, b) => (a === null ? null : a) === (b === null ? null : b);

function makeFolderStore(ctx, root, opts = {}) {
  const channel = opts.channel !== undefined ? opts.channel : newChannel();
  const nowMs = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const lockFn = opts.lock || webLock;
  const name = root.name || null;
  let permission = opts.permission || 'granted';
  let missing = false;
  const onlineListeners = new Set();
  const isOnline = () => permission === 'granted' && !missing;
  let wasOnline = isOnline();
  const announce = () => { const now = isOnline(); if (now !== wasOnline) { wasOnline = now; onlineListeners.forEach(fn => fn({ online: now })); } };

  /* -- paths -- */
  const relKey = (segs) => segs.join('/');
  async function dirAt(segs, create) { let d = root; for (const s of segs) d = await d.getDirectoryHandle(s, { create }); return d; }
  async function fileHandle(segs, create) {
    try { return await (await dirAt(segs.slice(0, -1), create)).getFileHandle(segs[segs.length - 1], { create }); }
    catch (e) { if (!create && isMissing(e) && await rootAlive()) return null; throw e; }
  }
  async function stat(segs) { const h = await fileHandle(segs, false); return h ? h.getFile() : null; }
  async function exists(segs) { return (await stat(segs).catch(e => { if (isMissing(e)) return null; throw e; })) !== null; }
  async function writeData(segs, data) {
    const existed = await fileHandle(segs, false);
    const h = existed || await fileHandle(segs, true);
    try {
      const w = await h.createWritable(); // writes a temporary file, moved into place on close: atomic
      try { await w.write(data); await w.close(); } catch (e) { try { await w.abort(); } catch (x) { /* closed */ } throw e; }
    } catch (e) {
      // Creating the handle made an empty file; a failed first write must not leave it behind as a damaged collection.
      if (!existed) { try { await (await dirAt(segs.slice(0, -1), false)).removeEntry(segs[segs.length - 1]); } catch (x) { /* already gone */ } }
      throw e;
    }
    return h.getFile();
  }

  /* -- access: every call goes through here -- */
  async function rootAlive() {
    try { const it = root.values(); await it.next(); if (it.return) await it.return(); return true; } catch (e) { return !isMissing(e); }
  }
  const unavailable = () => new WorkshopError('unavailable', missing
    ? `The folder ${name || ''} is gone. It may have been moved, renamed or deleted. Choose it again in Settings.`
    : `Workshop needs your permission to use the folder ${name || ''}. Click Allow in the bar at the top of Workshop.`, 503);
  async function access(fn) {
    if (!isOnline()) throw unavailable();
    try { return await fn(); }
    catch (e) {
      if (e instanceof WorkshopError) throw e;
      if (isDenied(e)) { await recheck(); throw unavailable(); }
      if (isMissing(e) && !(await rootAlive())) { missing = true; announce(); throw unavailable(); }
      throw new WorkshopError('internal', `The folder could not be read or written: ${e && e.message ? e.message : e}`);
    }
  }
  async function recheck() {
    try { permission = await root.queryPermission({ mode: 'readwrite' }); } catch (e) { permission = 'denied'; }
    missing = permission === 'granted' ? !(await rootAlive()) : false;
    announce();
    return isOnline();
  }

  /* -- one writer per path: across tabs with Web Locks, else within this page -- */
  const withLock = (k, fn) => lockFn('workshop-folder ' + (name || '') + ' ' + k, fn);

  /* -- change tracking: our own writes, and outside changes for subscriptions -- */
  const own = new Map(); // relKey -> lastModified we (or a tab of this origin) wrote, or null for gone
  const watches = new Set();
  const listeners = [];
  const post = (m) => { if (channel) channel.postMessage(m); };
  if (channel) channel.addEventListener('message', (e) => {
    const m = e.data;
    if (!m) return;
    if (m.folder === 'granted' && !isOnline()) { recheck(); return; }
    if (m.client === ctx.clientId || m.app === undefined) return;
    listeners.forEach(fn => fn(m));
    // Another tab wrote it: learn the new modified time, so the outside-change check does not report it again.
    let segs;
    try { segs = m.collection !== undefined ? collectionSegs(m.app, m.collection) : [m.app, ...checkFile(m.path)]; } catch (x) { return; }
    stat(segs).then(f => own.set(relKey(segs), f ? f.lastModified : null), () => {});
  });

  /* -- reading -- */
  function collectionSegs(app, collection) { const segs = [app, ...checkCollection(collection)]; segs[segs.length - 1] += '.json'; return segs; }
  // {env, text, lm} for the collection, or {env: null, lm: null}. Anything at that path that is not this collection: 500.
  async function readCollection(app, collection, segs) {
    const f = await stat(segs);
    if (!f) return { env: null, text: null, lm: null };
    const text = await f.text();
    let env;
    try { env = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { env = undefined; }
    const ok = env && typeof env === 'object' && !Array.isArray(env) && env.schema === `${app}.${collection}`
      && Number.isInteger(env.version) && env.version >= 1 && Number.isInteger(env.rev) && env.rev >= 0 && Array.isArray(env.items);
    if (!ok) throw new WorkshopError('internal', `${app}/${collection}.json cannot be read as a collection. Workshop left it untouched; fix or move the file.`, 500);
    return { env, text, lm: f.lastModified };
  }

  async function get(app, collection) {
    checkApp(app);
    const segs = collectionSegs(app, collection);
    return access(async () => (await readCollection(app, collection, segs)).env);
  }

  async function put(app, collection, envelope) {
    checkApp(app);
    const segs = collectionSegs(app, collection);
    checkEnvelope(app, collection, envelope);
    const result = await access(() => withLock(relKey(segs), async () => {
      for (let attempt = 0; ; attempt++) {
        const first = await readCollection(app, collection, segs);
        const storedRev = first.env ? first.env.rev : 0;
        if (envelope.rev !== storedRev) throw collectionConflict(first.env || { schema: envelope.schema, version: envelope.version, rev: 0, items: [] });
        if (first.env && envelope.version < first.env.version) throw downgrade(first.env.version, envelope.version);
        if (first.env && envelope.version > first.env.version) await backup(segs, first.text, first.env.version);
        const next = storedEnvelope(envelope, storedRev + 1, new Date(nowMs()).toISOString());
        // Changed since we read it (the agent, another program, a tab on another origin)? Start over with the new file.
        const again = await stat(segs);
        if (!sameTime(again ? again.lastModified : null, first.lm)) {
          if (attempt < RESTARTS) continue;
          throw collectionConflict((await readCollection(app, collection, segs)).env || { schema: envelope.schema, version: envelope.version, rev: 0, items: [] });
        }
        const f = await writeData(segs, JSON.stringify(next, null, 2) + '\n');
        own.set(relKey(segs), f.lastModified);
        return { rev: next.rev, updatedAt: next.updatedAt };
      }
    }));
    post({ app, collection, rev: result.rev, updatedAt: result.updatedAt, client: ctx.clientId });
    return result;
  }

  // <folder>/.backups/<yyyy-mm-dd>/<app>/<collection>.v<old>.json, never overwritten (docs/data-format.md, Migrations rule 5).
  async function backup(segs, text, oldVersion) {
    const dest = ['.backups', new Date(nowMs()).toISOString().slice(0, 10), ...segs];
    dest[dest.length - 1] = dest[dest.length - 1].replace(/\.json$/, `.v${oldVersion}.json`);
    if (await exists(dest)) return;
    await writeData(dest, text);
  }

  // Every visible .md and .json file under <app>/<folder>, at every depth: [{path, file}], sorted.
  async function walk(app, folderSegs) {
    const out = [];
    let start;
    try { start = await dirAt([app, ...folderSegs], false); } catch (e) { if (isMissing(e) && await rootAlive()) return out; throw e; }
    const visit = async (dir, parts) => {
      for await (const [entry, h] of dir.entries()) {
        if (entry.startsWith('.')) continue;
        if (h.kind === 'directory') { if (SEG_RE.test(entry) && parts.length < MAX_SEGS - 1) await visit(h, [...parts, entry]); }
        else if (FILE_RE.test(entry)) out.push({ path: [...parts, entry].join('/'), file: await h.getFile() });
      }
    };
    await visit(start, folderSegs);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  // Is this .json file a collection? Cached per modified time, so the 5-second check reads only changed files.
  const kinds = new Map();
  async function isCollectionFile(app, path, file) {
    if (!path.endsWith('.json')) return false;
    if (file.size > FILE_MAX) return false;
    const k = `${app}/${path}`, hit = kinds.get(k);
    if (hit && hit.lm === file.lastModified) return hit.collection;
    const collection = isCollectionText(app, path, await file.text());
    kinds.set(k, { lm: file.lastModified, collection });
    return collection;
  }

  async function list(app) {
    checkApp(app);
    return access(async () => {
      const collections = [];
      for (const { path, file } of await walk(app, [])) {
        if (!(await isCollectionFile(app, path, file))) continue;
        const collection = path.slice(0, -5);
        let r;
        try { r = await readCollection(app, collection, [app, ...path.split('/')]); } catch (e) { continue; } // damaged: left out
        if (!r.env || typeof r.env.updatedAt !== 'string' || r.env.rev < 1) continue;
        collections.push({ collection, schema: r.env.schema, version: r.env.version, rev: r.env.rev, updatedAt: r.env.updatedAt, items: r.env.items.length });
      }
      return { app, collections };
    });
  }
  async function allCollections() {
    return access(async () => {
      const out = [];
      for await (const [entry, h] of root.entries()) {
        if (h.kind !== 'directory' || !APP_RE.test(entry)) continue;
        for (const c of (await list(entry)).collections) {
          const env = await get(entry, c.collection);
          if (env) out.push({ app: entry, collection: c.collection, envelope: env });
        }
      }
      return out.sort((a, b) => (a.app + '/' + a.collection < b.app + '/' + b.collection ? -1 : 1));
    });
  }

  function subscribe(app, collection, handler) {
    const segs = collectionSegs(app, collection);
    const fn = (m) => { if (m.collection !== undefined && m.app === app && m.collection === collection) handler(m); };
    listeners.push(fn);
    const w = { paths: async () => { const f = await stat(segs); return new Map([[relKey(segs), f ? f.lastModified : null]]); },
      fire: () => handler({ app, collection, rev: null, updatedAt: null, client: null }) };
    return watch(w, fn);
  }

  /* -- files -- */
  // The file as {app, path, mtime, size, content}, or null. tooLarge: content '' (the conflict view still describes it).
  async function current(app, path, segs) {
    const f = await stat(segs);
    if (!f) return null;
    const v = { app, path, mtime: f.lastModified, size: f.size };
    if (f.size > FILE_MAX) return Object.assign(v, { content: '', tooLarge: true, file: f });
    const content = await f.text();
    if (isCollectionText(app, path, content)) throw bad(`${path} is a collection. Use ws.data for it.`);
    return Object.assign(v, { content, file: f });
  }
  const plain = (c) => { if (!c) return null; const { tooLarge, file, ...rest } = c; return rest; };

  const files = {
    async list(app, folder) {
      checkApp(app);
      const fsegs = checkFolder(folder);
      return access(async () => {
        const out = [];
        for (const { path, file } of await walk(app, fsegs)) {
          if (await isCollectionFile(app, path, file)) continue;
          out.push({ path, mtime: file.lastModified, size: file.size });
        }
        return out;
      });
    },
    async read(app, path) {
      checkApp(app);
      const segs = [app, ...checkFile(path)];
      return access(async () => {
        const c = await current(app, path, segs);
        if (c && c.tooLarge) throw new WorkshopError('too_large', `${path} is larger than 10 MB, so Workshop does not read it.`, 413);
        return plain(c);
      });
    },
    async write(app, path, content, opts) {
      checkApp(app);
      const segs = [app, ...checkFile(path)];
      const o = checkWriteOpts(opts);
      const size = checkFileContent(app, path, content);
      const result = await access(() => withLock(relKey(segs), async () => {
        for (let attempt = 0; ; attempt++) {
          const cur = await current(app, path, segs);
          if (o.create && cur) throw fileConflict(`${path} already exists.`, plain(cur));
          if (!o.create && !cur) throw fileConflict('That file is gone. It may have been moved to the trash.', null);
          if (!o.create && cur.mtime !== o.mtime) throw fileConflict('That file changed since you loaded it. Reload and try again.', plain(cur));
          const again = await stat(segs);
          if (!sameTime(again ? again.lastModified : null, cur ? cur.mtime : null)) {
            if (attempt < RESTARTS) continue;
            throw fileConflict('That file keeps changing. Reload and try again.', plain(await current(app, path, segs)));
          }
          let f = await writeData(segs, content);
          // An mtime must name one version: if the file system kept the old time, write again a little later.
          for (const ms of SAME_MTIME_WAITS) {
            if (!cur || f.lastModified !== cur.mtime) break;
            await sleep(ms);
            f = await writeData(segs, content);
          }
          own.set(relKey(segs), f.lastModified);
          return { app, path, mtime: f.lastModified, size };
        }
      }));
      post({ app, path, mtime: result.mtime, client: ctx.clientId });
      return result;
    },
    async trash(app, path, opts) {
      checkApp(app);
      const segs = [app, ...checkFile(path)];
      const want = opts && typeof opts.mtime === 'number' ? opts.mtime : null;
      const result = await access(() => withLock(relKey(segs), async () => {
        const cur = await current(app, path, segs);
        if (!cur) throw new WorkshopError('not_found', `${app} has no file ${path}.`, 404);
        if (want !== null && cur.mtime !== want) throw fileConflict('That file changed since you loaded it. Reload and try again.', plain(cur));
        const m = /^(.*)\.(md|json)$/.exec(relKey(segs));
        const base = `.trash/${m[1]}.${trashStamp(new Date(nowMs()))}`;
        let dest = `${base}.${m[2]}`;
        for (let i = 1; await exists(dest.split('/')); i++) dest = `${base}-${i}.${m[2]}`;
        // Copy into the trash first, then remove the original: the file is never lost, only moved.
        await writeData(dest.split('/'), cur.file);
        await (await dirAt(segs.slice(0, -1), false)).removeEntry(segs[segs.length - 1]);
        own.set(relKey(segs), null);
        return { app, path, trash: dest };
      }));
      post({ app, path, mtime: null, client: ctx.clientId });
      return result;
    },
    subscribe(app, target, handler) {
      checkApp(app);
      const asFile = isFilePath(target);
      const tsegs = asFile ? checkFile(target) : checkFolder(target);
      const t = tsegs.join('/');
      const fn = (m) => { if (m.path !== undefined && m.app === app && coversPath(t, m.path)) handler(m); };
      listeners.push(fn);
      const w = {
        paths: async () => {
          const out = new Map();
          if (asFile) { const f = await stat([app, ...tsegs]); out.set(`${app}/${t}`, f ? f.lastModified : null); return out; }
          for (const { path, file } of await walk(app, tsegs)) if (!(await isCollectionFile(app, path, file))) out.set(`${app}/${path}`, file.lastModified);
          return out;
        },
        fire: (k, lm) => handler({ app, path: k.slice(app.length + 1), mtime: lm, client: null })
      };
      return watch(w, fn);
    },
    async all() {
      // Every file of every app (for tests and diagnostics).
      return access(async () => {
        const out = [];
        for await (const [entry, h] of root.entries()) {
          if (h.kind !== 'directory' || !APP_RE.test(entry)) continue;
          for (const f of await files.list(entry)) out.push({ app: entry, path: f.path, content: (await files.read(entry, f.path)).content });
        }
        return out;
      });
    }
  };

  /* -- the outside-change check -- */
  function watch(w, fn) {
    w.seen = null;
    watches.add(w);
    // Learn where things stand now; changes after this are reported.
    if (isOnline()) w.paths().then(p => { if (!w.seen) w.seen = p; }, () => {});
    startTimer();
    return () => { watches.delete(w); const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  let checking = null;
  // One check: permission if it was lost, then the modified time of everything subscribed to.
  function poll() {
    if (checking) return checking;
    checking = (async () => {
      if (!isOnline()) { if (!(await recheck())) return; }
      for (const w of [...watches]) {
        let now;
        try { now = await w.paths(); } catch (e) {
          if (isDenied(e)) { await recheck(); return; }
          if (isMissing(e) && !(await rootAlive())) { missing = true; announce(); return; }
          continue;
        }
        if (!w.seen) { w.seen = now; continue; }
        const keys = [...new Set([...w.seen.keys(), ...now.keys()])].sort();
        for (const k of keys) {
          const before = w.seen.has(k) ? w.seen.get(k) : null, after = now.has(k) ? now.get(k) : null;
          if (sameTime(before, after)) continue;
          // Our own write (or another tab's, already reported over the channel): nothing to tell.
          if (own.has(k) && sameTime(own.get(k), after)) continue;
          w.fire(k, after);
        }
        w.seen = now;
      }
    })().finally(() => { checking = null; });
    return checking;
  }
  let timer = null;
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  function startTimer() {
    if (timer || opts.timers === false) return;
    timer = setInterval(() => { if (visible()) poll(); }, POLL_MS);
    if (timer && timer.unref) timer.unref();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (visible()) poll(); });
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', () => poll());
  }
  // Without subscriptions, still notice when access comes back (for example the shell's Allow button).
  if (!isOnline()) startTimer();

  return {
    kind: 'browser', storage: 'folder', name, get, put, list, subscribe, files, allCollections, connectorsAvailable: false,
    get online() { return isOnline(); },
    onOnline(fn) { onlineListeners.add(fn); return () => onlineListeners.delete(fn); },
    get permission() { return permission; },
    get missing() { return missing; },
    recheck, poll,
    async allow() {
      try { permission = await root.requestPermission({ mode: 'readwrite' }); } catch (e) { permission = 'denied'; }
      missing = permission === 'granted' ? !(await rootAlive()) : false;
      announce();
      if (isOnline()) post({ folder: 'granted' });
      return isOnline();
    }
  };
}

// Web Locks when the browser has them (one writer per path across tabs of this origin), else a queue per page.
const pageLocks = new Map();
function webLock(name, fn) {
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) return navigator.locks.request(name, fn);
  const prev = pageLocks.get(name) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  pageLocks.set(name, tail);
  tail.then(() => { if (pageLocks.get(name) === tail) pageLocks.delete(name); });
  return run;
}

/* ---------- moving the IndexedDB store into a folder (docs/run-modes.md) ----------
   source: {collections(), files(), moved(), markMoved(mark)}; target: a folder store. Collections are created
   if missing or merged and put; files are created if missing, and a different file already in the folder is
   kept with the browser's copy written beside it as <name>-from-browser.<ext>. The source is never changed
   except for the mark. Returns a summary for Settings. */
async function moveIntoFolder({ source, target, folderName, now = () => Date.now() }) {
  const summary = { folder: folderName || null, alreadyMoved: false, collections: { created: [], merged: [], skipped: [] }, files: { created: [], same: [], renamed: [] } };
  if (await source.moved()) { summary.alreadyMoved = true; return summary; }
  for (const { app, collection, envelope } of await source.collections()) {
    const name = `${app}/${collection}`;
    const existing = await target.get(app, collection);
    if (!existing) {
      const env = clone(envelope); env.rev = 0;
      await putMerging(target, app, collection, env);
      summary.collections.created.push(name);
    } else if (existing.version !== envelope.version) {
      summary.collections.skipped.push({ name, reason: `the folder has version ${existing.version}, this browser has version ${envelope.version}` });
    } else {
      const combined = mergeEnvelopes(envelope, existing);
      combined.rev = existing.rev;
      await putMerging(target, app, collection, combined);
      summary.collections.merged.push(name);
    }
  }
  for (const { app, path, content } of await source.files()) {
    const there = await target.files.read(app, path);
    if (!there) { await target.files.write(app, path, content, { create: true }); summary.files.created.push(`${app}/${path}`); continue; }
    if (there.content === content) { summary.files.same.push(`${app}/${path}`); continue; }
    const m = /^(.*\/)?([^/]+)\.(md|json)$/.exec(path);
    for (let i = 1; ; i++) {
      const suffix = i === 1 ? '-from-browser' : `-from-browser-${i}`;
      const alt = `${m[1] || ''}${m[2].slice(0, 40 - suffix.length)}${suffix}.${m[3]}`;
      try {
        await target.files.write(app, alt, content, { create: true });
        summary.files.renamed.push({ from: `${app}/${path}`, to: `${app}/${alt}` });
        break;
      } catch (e) { if (!(e instanceof WorkshopError && e.code === 'conflict')) throw e; }
    }
  }
  await source.markMoved({ movedTo: folderName || null, movedAt: new Date(now()).toISOString() });
  return summary;
}
async function putMerging(target, app, collection, envelope) {
  try { return await target.put(app, collection, envelope); }
  catch (e) {
    if (e instanceof WorkshopError && e.code === 'conflict' && e.current) {
      const combined = e.current.rev ? mergeEnvelopes(envelope, e.current) : clone(envelope);
      combined.rev = e.current.rev;
      return target.put(app, collection, combined);
    }
    throw e;
  }
}
// The IndexedDB store as a source for moveIntoFolder.
function idbSource(store) {
  return {
    collections: () => store.allCollections(),
    files: () => store.files.all(),
    moved: () => idbMoved(),
    markMoved: (mark) => idbTx('data', 'readwrite', s => { s.data.put(mark, '_moved'); })
  };
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
      for (const name of ['data', 'file', 'connector', 'connector-status', 'config']) {
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
    onFile(app, target, handler) {
      return on((name, p) => { if (name === 'file' && p.app === app && coversPath(target, p.path) && p.client !== ctx.clientId) handler(p); });
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

/* ---------- the browser backend's store: folder if one is saved, else IndexedDB ---------- */
async function openBrowserStore(ctx, opts = {}) {
  const handle = opts.handle !== undefined ? opts.handle : await savedFolderHandle();
  if (handle) {
    let permission;
    try { permission = await handle.queryPermission({ mode: 'readwrite' }); } catch (e) { permission = 'denied'; }
    const store = makeFolderStore(ctx, handle, Object.assign({ permission }, opts.folder));
    if (permission === 'granted') await store.recheck(); // notices a folder that is gone
    return store;
  }
  return makeIdbStore(ctx, opts.idb);
}

// Folder access for the shell's bar (docs/run-modes.md, Access), without connecting as an app.
// {storage, name, permission, missing}; storage is 'folder' or 'indexeddb'. Browser backend only.
export async function folderState() {
  const handle = await savedFolderHandle();
  if (!handle) return { storage: 'indexeddb', name: null, permission: null, missing: false };
  const store = await openBrowserStore({ clientId: randomId('w-') }, { handle, folder: { timers: false, channel: null } });
  return { storage: 'folder', name: store.name, permission: store.permission, missing: store.missing };
}
// Call only from a click. Asks Chrome again for the saved folder; tells every app on this origin when it works.
export async function allowFolder() {
  const handle = await savedFolderHandle();
  if (!handle) throw new WorkshopError('unavailable', 'No folder is chosen. Choose one in Settings.');
  const channel = newChannel();
  const store = makeFolderStore({ clientId: randomId('w-') }, handle, { permission: 'prompt', timers: false, channel });
  await store.allow();
  if (channel) setTimeout(() => channel.close(), 1000);
  return { storage: 'folder', name: store.name, permission: store.permission, missing: store.missing };
}

const MOVE_SUMMARY_KEY = 'workshop.folder.moved';
function reloadAll() { try { (window.top || window).location.reload(); } catch (e) { location.reload(); } }

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
  const noEvents = { get online() { return false; }, onData() { return () => {}; }, onFile() { return () => {}; }, onConnector() { return () => {}; }, onStatus() { return () => {}; }, onOnline() { return () => {}; } };
  ctx.events = (picked.backend === 'agent') ? makeEventStream(ctx) : noEvents;
  const data = (picked.backend === 'agent') ? makeAgentBackend(ctx) : await openBrowserStore(ctx);
  // ws.online and online events: the agent's event stream, or the folder's access.
  const status = data.kind === 'agent' ? ctx.events : data;
  const shell = makeShellChannel(ctx);

  // Another tab chose a folder: every tab switches together (docs/run-modes.md, Picking a folder).
  if (data.kind === 'browser') {
    const ch = newChannel();
    if (ch) ch.addEventListener('message', (e) => { if (e.data && e.data.folder === 'reload' && e.data.client !== ctx.clientId) reloadAll(); });
  }

  // Tell the shell the app is ready and learn the initial theme/route/visibility.
  let initial = { theme: null, route: '', visible: true };
  if (shell.embedded) {
    try { initial = await shell.request('ready', { app, sdk: SDK_VERSION }, READY_TIMEOUT_MS) || initial; } catch (e) { /* no answer: keep the defaults */ }
    // The route the app was opened at (docs/sdk.md: route fires "including on first show"). Sent on the
    // next task, so handlers the app adds right after `await connect()` get it.
    if (initial.route) { const path = initial.route; setTimeout(() => shell.emit('route', { path })); }
  }

  // Keep the theme current() returns up to date.
  shell.on('theme', (t) => {
    initial.theme = t;
    // Apps that use shared/themes.css and data-theme get the theme applied (docs/sdk.md, theme event).
    const root = document.documentElement;
    if (t && t.key && root.hasAttribute('data-theme')) root.dataset.theme = t.key;
  });

  // Wire online events: from the event stream (agent) or the folder's access (browser).
  status.onOnline((p) => shell.emit('online', p));

  const ws = {
    get mode() { return ctx.mode; },
    get backend() { return ctx.backend; },
    get storage() { return data.storage; },
    get online() { return status.online; },
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

    /* files (docs/sdk.md, Files): this app writes only its own files; any app's files can be read */
    files: {
      list(folder, opts) { return data.files.list((opts && opts.app) || app, folder); },
      read(path, opts) { return data.files.read((opts && opts.app) || app, path); },
      write(path, content, opts) { return data.files.write(app, path, content, opts); },
      trash(path, opts) { return data.files.trash(app, path, opts); },
      subscribe(pathOrFolder, handler, opts) { return data.files.subscribe((opts && opts.app) || app, pathOrFolder || '', handler); }
    },

    /* the data folder (docs/sdk.md, Folder): for the shell and the Settings app */
    folder: {
      async status() {
        if (data.kind === 'agent') {
          let name = null;
          try { name = (await agentCall(ctx, 'GET', '/api/config')).dataDir || null; } catch (e) { /* not reachable */ }
          return { storage: 'agent', name, permission: null, moved: false, missing: false };
        }
        const moved = Boolean(await idbMoved());
        if (data.storage === 'folder') return { storage: 'folder', name: data.name, permission: data.permission, moved, missing: data.missing };
        return { storage: 'indexeddb', name: null, permission: null, moved, missing: false };
      },
      async choose(opts) {
        if (data.kind === 'agent') throw new WorkshopError('unavailable', 'Workshop is running on this computer: change its data folder in Settings instead.');
        const picker = (opts && opts.picker) || (typeof window !== 'undefined' && window.showDirectoryPicker);
        if (typeof picker !== 'function') throw new WorkshopError('unavailable', 'This browser cannot use a folder. Use Chrome.');
        let dir;
        try { dir = await picker.call(typeof window !== 'undefined' ? window : undefined, { id: 'workshop', mode: 'readwrite' }); }
        catch (e) { if (e && e.name === 'AbortError') throw bad('No folder was chosen.'); throw new WorkshopError('internal', `Chrome could not open that folder: ${e && e.message ? e.message : e}`); }
        let permission;
        try { permission = await dir.requestPermission({ mode: 'readwrite' }); } catch (e) { permission = 'denied'; }
        if (permission !== 'granted') throw bad('Workshop needs permission to read and write that folder.');
        // Copy this browser's IndexedDB data in (kept, and marked moved), then use the folder from now on.
        const idb = data.storage === 'indexeddb' ? data : makeIdbStore(ctx, { channel: null });
        const target = makeFolderStore({ clientId: ctx.clientId }, dir, { timers: false, channel: null });
        const summary = await moveIntoFolder({ source: idbSource(idb), target, folderName: dir.name });
        await saveFolderHandle(dir);
        try { sessionStorage.setItem(MOVE_SUMMARY_KEY, JSON.stringify(summary)); } catch (e) { /* no session storage: Settings shows no summary */ }
        const ch = newChannel();
        if (ch) { ch.postMessage({ folder: 'reload', client: ctx.clientId }); setTimeout(() => ch.close(), 1000); }
        if (!(opts && opts.reload === false)) reloadAll();
        return summary;
      },
      async allow() {
        if (data.storage !== 'folder') throw new WorkshopError('unavailable', 'No folder is chosen. Choose one in Settings.');
        await data.allow();
        return ws.folder.status();
      },
      // What the last choose() copied, once, after its reload. For the Settings app.
      lastMove() {
        try { const raw = sessionStorage.getItem(MOVE_SUMMARY_KEY); sessionStorage.removeItem(MOVE_SUMMARY_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
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
      // Change features, allowedOrigins, connectors on/off, the port or dataDir. Resolves {config, restartRequired}.
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

// Internals for tests (shared/test/): the stores against any directory handle, and the move from IndexedDB.
export const _internals = { makeFolderStore, makeIdbStore, moveIntoFolder, openBrowserStore };

export default { connect, WorkshopError, data, detectBackend: pickBackend, folderState, allowFolder };

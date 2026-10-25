// Mock Workshop agent: a small implementation of docs/agent-api.md, so app work can start before the real
// agent ships. It passes the same contract suite (tests/contract/) the real agent must pass.
//
// Run it:   node tests/mock-agent.mjs [--port 4380] [--root .] [--apps <dir>] [--connectors <dir>]
//                                     [--allow-origin https://x.example] [--token <token>] [--data-dir <dir>]
// It serves the repo's static files, keeps app data in a data folder (docs/data-format.md, Data folder),
// and prints the URL to open. Without --data-dir (or options.dataDir / config.dataDir) the data folder is a
// new temporary folder that is removed when the mock stops, so the mock never touches ~/Workshop.
//
// Use it from code:  const agent = await createMockAgent({...}); ... await agent.stop();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SchemaSet } from './lib/schema.mjs';
import { checkConnectorModule } from './lib/connector-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const VERSION = '0.0.0-mock';
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const FILE_NAME = /^([a-z][a-z0-9-]{0,39})\.(md|json)$/;
const MAX_SEGMENTS = 4;
const DEBOUNCE_MS = 300;
const ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const STATUS_FOR = { bad_request: 400, invalid_config: 400, confirm_required: 400, downgrade: 400, unauthorized: 401, forbidden: 403,
  local_only: 403, not_found: 404, method_not_allowed: 405, conflict: 409, too_large: 413, disabled: 503, unavailable: 503, internal: 500 };
const MB = 1024 * 1024;
const FILE_MAX = 10 * MB;
const STATIC_TOP = new Set(['shell', 'shared', 'icons', 'index.html', 'manifest.webmanifest', 'sw.js']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

class HttpError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.status = STATUS_FOR[code]; this.extra = extra; }
}
const fail = (code, message, extra) => { throw new HttpError(code, message, extra); };

const DEFAULT_CONFIG = () => ({ configVersion: 1, port: 4380, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} });

/** True if child is parent or inside it. */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
const lexists = p => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const floorMs = st => Math.floor(st.mtimeMs);
/** UTC stamp for trash names: 20261025T140500123Z. */
const stamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, '');

function deepFreeze(o) { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

/** Fill defaults from a form-subset configSchema into value (objects only, recursively). */
function applyDefaults(schema, value) {
  if (!schema || schema.type !== 'object') return value;
  const out = { ...(value && typeof value === 'object' ? value : {}) };
  for (const [k, s] of Object.entries(schema.properties || {})) {
    if (out[k] === undefined && s.default !== undefined) out[k] = structuredClone(s.default);
    if (s.type === 'object') out[k] = applyDefaults(s, out[k]);
  }
  return out;
}

/** Every environment variable name a config holds in fields marked x-workshop-env. */
function envNames(schema, value, acc = new Set()) {
  if (!schema || value === undefined || value === null) return acc;
  if (schema.type === 'object' && typeof value === 'object') for (const [k, s] of Object.entries(schema.properties || {})) envNames(s, value[k], acc);
  else if (schema.type === 'array' && Array.isArray(value)) value.forEach(v => envNames(schema.items, v, acc));
  else if (schema.type === 'string' && schema['x-workshop-env'] && typeof value === 'string' && ENV_NAME.test(value)) acc.add(value);
  return acc;
}

export async function createMockAgent(options = {}) {
  const schemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));
  const config = { ...DEFAULT_CONFIG(), ...structuredClone(options.config || {}) };
  config.features = { ...DEFAULT_CONFIG().features, ...(options.config?.features || {}) };
  const env = options.env || process.env;
  const token = options.token || crypto.randomBytes(32).toString('hex');
  const appsDir = options.appsDir || path.join(REPO, 'apps');
  const connectorsDir = options.connectorsDir || path.join(REPO, 'connectors');
  const staticRoot = options.staticRoot || null;
  const home = options.home || '(mock agent: no home folder)';
  const homeIsReal = Boolean(options.home) && isDir(options.home);
  const log = options.log || (() => {});

  // ---------- data folder (docs/config.md, Data folder)
  let dataDir = options.dataDir || config.dataDir;
  let ownsDataDir = false;
  if (!dataDir) { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-mock-data-')); ownsDataDir = true; }
  if (!path.isAbsolute(dataDir)) throw new Error(`dataDir must be an absolute path: ${dataDir}`);
  if (homeIsReal && isInside(dataDir, home)) throw new Error(`dataDir may not be inside the Workshop home (${home}).`);
  fs.mkdirSync(dataDir, { recursive: true });
  const realData = fs.realpathSync(dataDir);
  const own = new Map();       // "<app>/<path>.<ext>" -> mtime (ms) or 'gone', for writes the agent made itself
  const kinds = new Map();     // "<app>/<path>.<ext>" -> 'collection' | 'file', last known
  const timers = new Map();    // watcher debounce
  let watcher = null;

  const sse = new Set();       // {res, hosted}
  const connectors = new Map(); // id -> {mod, error, ctx, abort, storage, lastState, since}
  let port = 0;

  // ---------- connectors
  async function loadConnectors() {
    let names = [];
    try { names = fs.readdirSync(connectorsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort(); } catch { /* none */ }
    for (const id of names) {
      const file = path.join(connectorsDir, id, 'index.mjs');
      if (!fs.existsSync(file)) continue;
      const entry = { id, mod: null, error: null, ctx: null, abort: null, storage: new Map(), lastState: null, since: new Date().toISOString() };
      try {
        const mod = (await import(pathToFileURL(file).href)).default;
        const problem = checkConnectorModule(mod, id, schemas);
        if (problem) entry.error = problem; else entry.mod = mod;
      } catch (e) { entry.error = `Could not load: ${e.message}`; }
      connectors.set(id, entry);
    }
  }

  const enabled = id => config.connectors?.[id]?.enabled === true;
  const connectorConfig = entry => applyDefaults(entry.mod.configSchema, config.connectors?.[entry.id]?.config);

  function statusOf(entry) {
    let s;
    if (entry.error) s = { state: 'error', message: entry.error };
    else if (enabled(entry.id) && entry.startError) s = { state: 'error', message: entry.startError };
    else if (!enabled(entry.id)) s = { state: 'disabled', message: null };
    else {
      try { const r = entry.mod.status() || {}; s = { state: r.state, message: r.message ?? null }; if (r.details) s.details = r.details; }
      catch (e) { s = { state: 'error', message: e.message }; }
      if (!['starting', 'ready', 'stopped', 'error'].includes(s.state)) s = { state: 'error', message: 'The connector reported an unknown state.' };
    }
    if (s.state !== entry.lastState) { entry.lastState = s.state; entry.since = new Date().toISOString(); }
    return { state: s.state, message: s.message, since: entry.since, ...(s.details ? { details: s.details } : {}) };
  }

  const broadcastStatus = entry => broadcast('connector-status', { id: entry.id, status: statusOf(entry) });

  async function startConnector(entry) {
    if (!entry.mod || !enabled(entry.id)) return;
    const cfg = deepFreeze(connectorConfig(entry));
    const allowed = envNames(entry.mod.configSchema, cfg);
    const abort = new AbortController();
    const ctx = {
      config: cfg,
      env: name => { if (!allowed.has(name)) throw new Error(`Environment variable ${name} is not named in this connector's config.`); return env[name]; },
      log: { info: (m) => log(entry.id, 'info', m), warn: (m) => log(entry.id, 'warn', m), error: (m) => log(entry.id, 'error', m) },
      storage: {
        async get(key) { return entry.storage.has(key) ? structuredClone(entry.storage.get(key)) : undefined; },
        async put(key, value) { if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key)) throw new Error('Bad storage key.'); entry.storage.set(key, structuredClone(value)); }
      },
      emit: (event, payload) => broadcast('connector', { id: entry.id, event, payload: payload ?? null }),
      statusChanged: () => broadcastStatus(entry),
      signal: abort.signal,
      home
    };
    entry.ctx = ctx; entry.abort = abort;
    entry.startError = null;
    try { await entry.mod.start(ctx); } catch (e) { entry.startError = `Could not start: ${e.message}`; log(entry.id, 'error', e.message); }
    broadcastStatus(entry);
  }

  async function stopConnector(entry) {
    if (!entry.mod || !entry.ctx) return;
    entry.abort.abort();
    try { await entry.mod.stop(); } catch (e) { log(entry.id, 'error', e.message); }
    entry.ctx = null; entry.abort = null;
  }

  function info(entry) {
    const m = entry.mod;
    const o = {
      id: entry.id, name: m ? m.name : entry.id, version: m ? m.version : '0.0.0', enabled: enabled(entry.id), status: statusOf(entry),
      actions: m ? Object.entries(m.actions).map(([name, a]) => ({ name, title: a.title, write: a.write === true })) : []
    };
    if (m?.test) o.test = { action: m.test.action, arg: m.test.arg, label: m.test.label };
    return o;
  }

  function connectorConfigView(entry) {
    const cfg = connectorConfig(entry);
    const envView = {};
    for (const n of envNames(entry.mod.configSchema, cfg)) envView[n] = { set: typeof env[n] === 'string' && env[n] !== '' };
    return { id: entry.id, schema: entry.mod.configSchema, config: cfg, env: envView };
  }

  // ---------- events
  function broadcast(event, payload) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of sse) c.res.write(chunk);
  }

  // ---------- helpers
  const ownOrigins = () => [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const publicConfig = () => ({
    configVersion: 1, port: config.port, dataDir: config.dataDir || dataDir, allowedOrigins: [...config.allowedOrigins],
    features: { startAtLogin: config.features.startAtLogin === true, hostedMode: config.features.hostedMode === true },
    connectors: Object.fromEntries(Object.entries(config.connectors || {}).map(([id, c]) => [id, { enabled: c.enabled === true }])),
    home
  });
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const same = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > limit) { req.resume(); return reject(new HttpError('too_large', `The request is larger than ${limit / MB} MB.`)); }
      const chunks = []; let size = 0, over = false;
      req.on('data', c => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
      req.on('end', () => {
        if (over) return reject(new HttpError('too_large', `The request is larger than ${limit / MB} MB.`));
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve(undefined);
        try { resolve(JSON.parse(text)); } catch { reject(new HttpError('bad_request', 'The request body is not valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, body, extra = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(text), ...extra });
    res.end(text);
  }

  function html(res, status, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY', ...extra });
    res.end(body);
  }

  const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function listApps() {
    let dirs = [];
    try { dirs = fs.readdirSync(appsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { /* none */ }
    const apps = [];
    for (const dir of dirs) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(appsDir, dir, 'app.json'), 'utf8'));
        const e = schemas.validate('app', manifest);
        if (e.length || manifest.id !== dir) { log('apps', 'warn', `Skipped apps/${dir}: ${e[0] || 'id does not match folder'}`); continue; }
        apps.push({ base: `/apps/${dir}/`, manifest });
      } catch { /* no or bad app.json: skipped */ }
    }
    apps.sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
    return { apps };
  }

  // ---------- data folder helpers (docs/data-format.md, Data folder; docs/agent-api.md, Files)
  const clientOf = req => { const c = req.headers['x-workshop-client']; return typeof c === 'string' && CLIENT.test(c) ? c : null; };

  /** Decode one raw path segment. Empty, ".", "..", or anything that decodes to a separator is refused. */
  function segment(rawSeg) {
    let d;
    try { d = decodeURIComponent(rawSeg); } catch { fail('bad_request', 'That path is not valid.'); }
    if (!d || d === '.' || d === '..' || /[\\/\0]/.test(d)) fail('bad_request', 'That path is not valid. Use names like notes/2026-plan.md, without "..", empty parts or absolute paths.');
    return d;
  }
  function collectionName(segs) {
    if (segs.length < 1 || segs.length > MAX_SEGMENTS) fail('bad_request', 'A collection name has 1 to 4 parts.');
    for (const g of segs) if (!NAME.test(g)) fail('bad_request', `"${g}" is not a valid collection name part.`);
    return segs.join('/');
  }
  function folderName(segs) {
    if (segs.length > MAX_SEGMENTS - 1) fail('bad_request', 'A folder has 1 to 3 parts.');
    for (const g of segs) if (!NAME.test(g)) fail('bad_request', `"${g}" is not a valid folder name.`);
    return segs.join('/');
  }
  function filePath(segs) {
    if (segs.length > MAX_SEGMENTS) fail('bad_request', 'A file path has 1 to 4 parts.');
    for (const g of segs.slice(0, -1)) if (!NAME.test(g)) fail('bad_request', `"${g}" is not a valid folder name.`);
    const last = segs[segs.length - 1];
    if (!FILE_NAME.test(last)) {
      if (/^[a-z][a-z0-9-]{0,39}\.[^.]+$/.test(last)) fail('bad_request', 'Only .md and .json files are allowed.');
      fail('bad_request', `"${last}" is not a valid file name.`);
    }
    return segs.join('/');
  }

  /** The absolute path for a path relative to the data folder, refusing anything that leads outside it. */
  function inside(rel) {
    const abs = path.join(dataDir, ...rel.split('/'));
    let p = abs;
    while (!lexists(p) && p !== path.dirname(p)) p = path.dirname(p);
    let real;
    try { real = fs.realpathSync(p); } catch { fail('bad_request', 'That path leads outside the data folder.'); }
    if (!isInside(real, realData)) fail('bad_request', 'That path leads outside the data folder.');
    return abs;
  }

  /** Does this text, stored at rel ("<app>/<path>.json"), mean to be a collection? JSON whose schema is its own name. */
  function isCollectionText(rel, text) {
    if (!rel.endsWith('.json')) return false;
    let v;
    try { v = JSON.parse(text); } catch { return false; }
    const [app, ...rest] = rel.slice(0, -5).split('/');
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && v.schema === `${app}.${rest.join('/')}`;
  }

  /** A collection file, or null if missing. Anything that cannot be read as this collection is a 500. */
  function readCollection(rel, file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const [app, ...rest] = rel.slice(0, -5).split('/');
    let v;
    try { v = JSON.parse(text); } catch { v = undefined; }
    if (!v || v.schema !== `${app}.${rest.join('/')}` || schemas.validate('data-envelope', v).length) {
      log('data', 'error', `${rel} cannot be read as a collection. It is left untouched.`);
      fail('internal', `${rel} cannot be read as a collection. It was left untouched; fix or move the file.`);
    }
    kinds.set(rel, 'collection');
    return v;
  }

  /** A plain file {app, path, mtime, size, content}, or null if missing. A collection is refused. */
  function readFile(rel, file) {
    let st;
    try { st = fs.statSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (!st.isFile()) fail('bad_request', 'That path is a folder.');
    const [app, ...rest] = rel.split('/');
    const view = { app, path: rest.join('/'), mtime: floorMs(st), size: st.size };
    if (st.size > FILE_MAX) return { ...view, content: '' };
    const content = fs.readFileSync(file, 'utf8');
    if (isCollectionText(rel, content)) { kinds.set(rel, 'collection'); fail('bad_request', `${view.path} is a collection. Use the data API.`); }
    kinds.set(rel, 'file');
    return { ...view, content };
  }

  /** Atomic write (temp file, then rename). Makes sure the mtime changes. Returns the new mtime. */
  function writeAtomic(rel, file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let prev = null;
    try { prev = floorMs(fs.statSync(file)); } catch { /* new */ }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    let mt = floorMs(fs.statSync(file));
    for (let bump = 1; prev !== null && mt <= prev && bump <= 5; bump++) {
      fs.utimesSync(file, new Date(), new Date(prev + bump));
      mt = floorMs(fs.statSync(file));
    }
    own.set(rel, mt);
    return mt;
  }

  /** Keep a copy in .backups/<yyyy-mm-dd>/ before a version upgrade. Never overwrites a copy. */
  function backup(rel, file, suffix) {
    const dest = path.join(dataDir, '.backups', new Date().toISOString().slice(0, 10), ...rel.slice(0, -5).split('/')) + suffix;
    if (lexists(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }

  /** Move a file to .trash/<app>/... and return where it went, relative to the data folder. */
  function moveToTrash(rel, file) {
    const m = rel.match(/^(.*)\.(md|json)$/);
    const base = `.trash/${m[1]}.${stamp()}`;
    let dest = `${base}.${m[2]}`;
    for (let i = 1; lexists(path.join(dataDir, ...dest.split('/'))); i++) dest = `${base}-${i}.${m[2]}`;
    const abs = path.join(dataDir, ...dest.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.renameSync(file, abs);
    own.set(rel, 'gone');
    return dest;
  }

  /** Every visible .json/.md path under an app folder (or a folder in it), as [rel to app, abs, stat]. */
  function walk(app, folder) {
    const out = [];
    const start = path.join(dataDir, app, ...(folder ? folder.split('/') : []));
    const visit = (abs, relParts) => {
      let entries;
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(abs, e.name);
        let real, st;
        try { real = fs.realpathSync(p); st = fs.statSync(p); } catch { continue; }
        if (!isInside(real, realData)) continue;
        if (st.isDirectory()) { if (NAME.test(e.name) && relParts.length < MAX_SEGMENTS - 1) visit(p, [...relParts, e.name]); }
        else if (st.isFile() && FILE_NAME.test(e.name)) out.push([[...relParts, e.name].join('/'), p, st]);
      }
    };
    if (folder) { try { if (!isInside(fs.realpathSync(start), realData)) return out; } catch { return out; } }
    visit(start, folder ? folder.split('/') : []);
    return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  function listCollections(app) {
    const out = [];
    for (const [r, abs] of walk(app, '')) {
      if (!r.endsWith('.json')) continue;
      const rel = `${app}/${r}`;
      let text;
      try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      if (!isCollectionText(rel, text)) continue;
      const e = JSON.parse(text);
      if (schemas.validate('data-envelope', e).length || typeof e.updatedAt !== 'string' || e.rev < 1) { log('data', 'error', `${rel} cannot be read as a collection.`); continue; }
      kinds.set(rel, 'collection');
      out.push({ collection: r.slice(0, -5), schema: e.schema, version: e.version, rev: e.rev, updatedAt: e.updatedAt, items: e.items.length });
    }
    return out;
  }

  function listFiles(app, folder) {
    const out = [];
    for (const [r, abs, st] of walk(app, folder)) {
      const rel = `${app}/${r}`;
      if (r.endsWith('.json') && st.size <= FILE_MAX) {
        let text;
        try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
        if (isCollectionText(rel, text)) { kinds.set(rel, 'collection'); continue; }
      }
      out.push({ path: r, mtime: floorMs(st), size: st.size });
    }
    return out;
  }

  // ---------- changes made outside Workshop (docs/agent-api.md, GET /api/events)
  function startWatching() {
    try {
      watcher = fs.watch(dataDir, { recursive: true }, (type, filename) => {
        if (!filename) return;
        const rel = String(filename).split(path.sep).join('/');
        if (rel.split('/').some(g => g.startsWith('.')) || rel.endsWith('.tmp')) return;
        clearTimeout(timers.get(rel));
        const t = setTimeout(() => { timers.delete(rel); external(rel); }, DEBOUNCE_MS);
        t.unref();
        timers.set(rel, t);
      });
      watcher.on('error', e => log('watch', 'warn', `Watching the data folder stopped: ${e.message}`));
    } catch (e) { log('watch', 'warn', `Cannot watch the data folder: ${e.message}`); }
  }

  function external(rel) {
    const [app, ...rest] = rel.split('/');
    if (!NAME.test(app || '') || rest.length < 1 || rest.length > MAX_SEGMENTS) return;
    if (!rest.slice(0, -1).every(g => NAME.test(g)) || !FILE_NAME.test(rest[rest.length - 1])) return;
    const abs = path.join(dataDir, ...rel.split('/'));
    let st = null;
    try { st = fs.statSync(abs); } catch { /* gone */ }
    if (st && !st.isFile()) return;
    const now = st ? floorMs(st) : 'gone';
    if (own.get(rel) === now) return;
    own.delete(rel);
    if (st) { try { if (!isInside(fs.realpathSync(abs), realData)) return; } catch { return; } }
    let kind = 'file';
    if (rel.endsWith('.json')) {
      if (st) { let text = ''; try { text = fs.readFileSync(abs, 'utf8'); } catch { /* unreadable */ } kind = isCollectionText(rel, text) ? 'collection' : 'file'; }
      else kind = kinds.get(rel) || 'file';
    }
    kinds.set(rel, kind);
    if (kind === 'collection') broadcast('data', { app, collection: rest.join('/').slice(0, -5), rev: null, updatedAt: null, client: null });
    else broadcast('file', { app, path: rest.join('/'), mtime: st ? now : null, client: null });
  }

  // ---------- moving from ~/.workshop/data (docs/data-format.md)
  function hasAppData() {
    let apps = [];
    try { apps = fs.readdirSync(dataDir, { withFileTypes: true }).filter(d => d.isDirectory() && NAME.test(d.name)).map(d => d.name); } catch { return false; }
    return apps.some(a => walk(a, '').length > 0);
  }
  function moveOldData() {
    if (!homeIsReal) return;
    const old = path.join(home, 'data');
    if (!isDir(old) || lexists(path.join(old, 'moved.json'))) return;
    const found = [];
    for (const d of fs.readdirSync(old, { withFileTypes: true })) {
      if (!d.isDirectory() || !NAME.test(d.name)) continue;
      for (const f of fs.readdirSync(path.join(old, d.name), { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith('.json') && NAME.test(f.name.slice(0, -5))) found.push([d.name, f.name]);
      }
    }
    if (!found.length || hasAppData()) return;
    for (const [app, f] of found) {
      fs.mkdirSync(path.join(dataDir, app), { recursive: true });
      fs.copyFileSync(path.join(old, app, f), path.join(dataDir, app, f));
    }
    const marker = { movedTo: dataDir, movedAt: new Date().toISOString(), collections: found.length };
    fs.writeFileSync(path.join(old, 'moved.json.tmp'), `${JSON.stringify(marker, null, 2)}\n`);
    fs.renameSync(path.join(old, 'moved.json.tmp'), path.join(old, 'moved.json'));
    log('data', 'info', `Copied ${found.length} collections from ${old} to ${dataDir}. The old files are kept.`);
  }

  // ---------- request handling
  async function handle(req, res) {
    const url = new URL(req.url, 'http://placeholder');
    const p = url.pathname;
    const isApi = p.startsWith('/api/');
    const errOut = (e) => {
      const status = e instanceof HttpError ? e.status : 500;
      const code = e instanceof HttpError ? e.code : 'internal';
      const message = e instanceof HttpError ? e.message : 'Something went wrong in the agent.';
      if (isApi) send(res, status, { error: message, code, ...(e.extra || {}) }, cors);
      else { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(message); }
    };
    let cors = {};
    try {
      const host = req.headers.host || '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) fail('forbidden', 'This address is not allowed. Use 127.0.0.1.');
      const origin = req.headers.origin;
      const own = !origin || ownOrigins().includes(origin);
      const hosted = Boolean(origin) && !own && config.features.hostedMode === true && config.allowedOrigins.includes(origin);
      if (origin && !own && !hosted) fail('forbidden', 'This site is not allowed to use Workshop.');
      if (hosted) cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-Workshop-Token, X-Workshop-Client',
          'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' });
        return res.end();
      }

      const headerOk = same(req.headers['x-workshop-token'], token);
      const cookieOk = same(cookies(req).workshop_token, token);
      const write = req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE';

      if (!isApi) return await handlePage(req, res, url, { cookieOk });

      if (p === '/api/health') {
        if (req.method !== 'GET') fail('method_not_allowed', 'Use GET.');
        return send(res, 200, { app: 'workshop-agent', api: 1, version: VERSION }, cors);
      }
      if (p === '/api/session') {
        if (req.method !== 'GET') fail('method_not_allowed', 'Use GET.');
        if (!own) fail('forbidden', 'Pair this page from Settings instead.');
        if (!cookieOk) fail('unauthorized', 'Open Workshop from this computer first.');
        return send(res, 200, { api: 1, token, agentOrigin: ownOrigins()[0] }, cors);
      }
      const queryOk = p === '/api/events' && same(url.searchParams.get('token'), token);
      const authed = headerOk || (cookieOk && own && req.method === 'GET') || queryOk;
      if (!authed) fail('unauthorized', 'Open Workshop from this computer first, or pair this page in Settings.');
      if (write && !headerOk) fail('unauthorized', 'Writes need the X-Workshop-Token header.');
      return await handleApi(req, res, url, { own, cors });
    } catch (e) {
      if (!(e instanceof HttpError)) log('agent', 'error', e.stack || e.message);
      if (!res.headersSent) errOut(e); else res.end();
    }
  }

  async function handlePage(req, res, url, { cookieOk }) {
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('method_not_allowed', 'Use GET.');
    const q = url.searchParams.get('token');
    if (q !== null && url.pathname !== '/pair') {
      url.searchParams.delete('token');
      const loc = url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '');
      const headers = { Location: loc, 'Cache-Control': 'no-store' };
      if (same(q, token)) headers['Set-Cookie'] = `workshop_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
      res.writeHead(303, headers);
      return res.end();
    }
    if (url.pathname === '/pair') return pairPage(res, url, cookieOk);
    return serveStatic(req, res, url.pathname);
  }

  function pairPage(res, url, cookieOk) {
    const origin = url.searchParams.get('origin') || '';
    if (!cookieOk) return html(res, 401, '<!doctype html><meta charset="utf-8"><title>Workshop</title><p>Open Workshop on this computer first, then try pairing again.</p>');
    if (!origin || schemas.validate({ $ref: 'common.schema.json#/$defs/origin' }, origin).length) {
      return html(res, 403, '<!doctype html><meta charset="utf-8"><title>Workshop</title><p>That pairing link is not valid.</p>');
    }
    if (config.features.hostedMode !== true) return html(res, 403, '<!doctype html><meta charset="utf-8"><title>Workshop</title><p>Hosted mode is off. Turn it on in Settings first.</p>');
    if (!config.allowedOrigins.includes(origin)) return html(res, 403, `<!doctype html><meta charset="utf-8"><title>Workshop</title><p>${escHtml(origin)} is not in your allowed sites. Add it in Settings first.</p>`);
    const payload = JSON.stringify({ type: 'workshop-pair', api: 1, url: ownOrigins()[0], token }).replace(/</g, '\\u003c');
    return html(res, 200, `<!doctype html><meta charset="utf-8"><title>Pair Workshop</title>
<p>Allow <strong>${escHtml(origin)}</strong> to use Workshop on this computer?</p>
<button id="allow" type="button">Allow ${escHtml(origin)} to use Workshop on this computer</button>
<script>
document.getElementById('allow').addEventListener('click', function () {
  if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(origin).replace(/</g, '\\u003c')});
  window.close();
});
</script>`);
  }

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { fail('not_found', 'Not found.'); }
    if (rel.includes('\0') || rel.split('/').some(s => s === '..' || (s.startsWith('.') && s.length > 0))) fail('not_found', 'Not found.');
    let file;
    if (rel === '/') rel = '/index.html';
    const parts = rel.split('/').filter(Boolean);
    if (parts[0] === 'apps' && parts.length >= 2) file = path.join(appsDir, ...parts.slice(1));
    else if (staticRoot && STATIC_TOP.has(parts[0])) file = path.join(staticRoot, ...parts);
    else fail('not_found', 'Not found.');
    const base = parts[0] === 'apps' ? appsDir : staticRoot;
    if (!path.resolve(file).startsWith(path.resolve(base) + path.sep)) fail('not_found', 'Not found.');
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    let st;
    try { st = fs.statSync(file); } catch { fail('not_found', 'Not found.'); }
    if (st.isDirectory()) { file = path.join(file, 'index.html'); try { st = fs.statSync(file); } catch { fail('not_found', 'Not found.'); } }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  async function handleApi(req, res, url, { own, cors }) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const m = req.method;
    const only = (...methods) => { if (!methods.includes(m)) fail('method_not_allowed', `Use ${methods.join(' or ')}.`); };
    const name = (v, what) => { if (!NAME.test(v)) fail('bad_request', `"${v}" is not a valid ${what} name.`); return v; };
    const ok = (body, status = 200) => send(res, status, body, cors);

    if (parts[0] === 'apps' && parts.length === 1) { only('GET'); return ok(listApps()); }

    // Data and files paths are checked as sent, segment by segment, before any normalization.
    const raw = req.url.split('?')[0].split('/').slice(2); // after "", "api"
    if (raw[0] === 'data' && raw.length >= 2) {
      const app = name(segment(raw[1]), 'app');
      if (raw.length === 2) { only('GET'); return ok({ app, collections: listCollections(app) }); }
      const segs = raw.slice(2).map(segment);
      const collection = collectionName(segs);
      const rel = `${app}/${collection}.json`;
      const file = inside(rel);
      if (m === 'GET') {
        const stored = readCollection(rel, file);
        if (!stored) fail('not_found', `${app} has no ${collection} data yet.`);
        return ok(stored);
      }
      only('GET', 'PUT');
      const body = await readBody(req, 10 * MB);
      const errs = schemas.validate('data-envelope', body);
      if (errs.length) fail('bad_request', `That data does not match the envelope format: ${errs[0]}`);
      if (body.schema !== `${app}.${collection}`) fail('bad_request', `schema must be "${app}.${collection}".`);
      const ids = new Set();
      for (const it of body.items) { if (ids.has(it.id)) fail('bad_request', `Item id "${it.id}" appears more than once.`); ids.add(it.id); }
      const stored = readCollection(rel, file);
      const rev = stored ? stored.rev : 0;
      if (body.rev !== rev) fail('conflict', 'That collection changed since you loaded it. Reload and try again.', { current: stored ?? { schema: body.schema, version: body.version, rev: 0, items: [] } });
      if (stored && body.version < stored.version) fail('downgrade', `This data is version ${stored.version}. A version ${body.version} writer cannot save it. Update Workshop.`);
      if (stored && body.version > stored.version) backup(rel, file, `.v${stored.version}.json`);
      const client = req.headers['x-workshop-client'];
      const next = { ...structuredClone(body), rev: rev + 1, updatedAt: new Date().toISOString() };
      const ordered = { schema: next.schema, version: next.version, rev: next.rev, updatedAt: next.updatedAt, items: next.items };
      if (next.deleted) ordered.deleted = next.deleted;
      if (next.meta) ordered.meta = next.meta;
      writeAtomic(rel, file, `${JSON.stringify(ordered, null, 2)}\n`);
      kinds.set(rel, 'collection');
      broadcast('data', { app, collection, rev: ordered.rev, updatedAt: ordered.updatedAt, client: clientOf(req) });
      return ok({ rev: ordered.rev, updatedAt: ordered.updatedAt });
    }

    if (raw[0] === 'files' && raw.length >= 2) {
      const app = name(segment(raw[1]), 'app');
      const segs = raw.slice(2).map(segment);
      const last = segs[segs.length - 1];
      if (!segs.length || !last.includes('.')) {
        only('GET');
        const folder = segs.length ? folderName(segs) : '';
        return ok({ app, files: listFiles(app, folder) });
      }
      const fpath = filePath(segs);
      const rel = `${app}/${fpath}`;
      const file = inside(rel);
      const current = () => readFile(rel, file);
      if (m === 'GET') {
        const cur = current();
        if (!cur) fail('not_found', `${app} has no file ${fpath}.`);
        if (cur.size > FILE_MAX) fail('too_large', `${fpath} is larger than 10 MB.`);
        return ok(cur);
      }
      if (m === 'PUT') {
        const body = await readBody(req, 64 * MB);
        const errs = schemas.validate('file-put', body);
        if (errs.length) fail('bad_request', `Send {"content": "...", "mtime": <the mtime you read>} or {"content": "...", "create": true}: ${errs[0]}`);
        if (Buffer.byteLength(body.content) > FILE_MAX) fail('too_large', 'A file can be at most 10 MB.');
        if (fpath.endsWith('.json')) {
          try { JSON.parse(body.content); } catch { fail('bad_request', `${fpath} must hold valid JSON.`); }
          if (isCollectionText(rel, body.content)) fail('bad_request', `That content is a collection. Save it with the data API instead.`);
        }
        const cur = current();
        if (body.create) { if (cur) fail('conflict', `${fpath} already exists.`, { current: cur }); }
        else if (!cur) fail('conflict', 'That file is gone. It may have been moved to the trash.', { current: null });
        else if (cur.mtime !== body.mtime) fail('conflict', 'That file changed since you loaded it. Reload and try again.', { current: cur });
        const mtime = writeAtomic(rel, file, body.content);
        kinds.set(rel, 'file');
        broadcast('file', { app, path: fpath, mtime, client: clientOf(req) });
        return ok({ app, path: fpath, mtime, size: Buffer.byteLength(body.content) });
      }
      if (m === 'DELETE') {
        const q = url.searchParams.get('mtime');
        if (q !== null && !/^[0-9]{1,16}$/.test(q)) fail('bad_request', 'mtime must be a whole number of milliseconds.');
        const cur = current();
        if (!cur) fail('not_found', `${app} has no file ${fpath}.`);
        if (q !== null && cur.mtime !== Number(q)) fail('conflict', 'That file changed since you loaded it. Reload and try again.', { current: cur });
        const trash = moveToTrash(rel, file);
        broadcast('file', { app, path: fpath, mtime: null, client: clientOf(req) });
        return ok({ app, path: fpath, trash });
      }
      fail('method_not_allowed', 'Use GET, PUT or DELETE.');
    }

    if (parts[0] === 'connectors') {
      if (parts.length === 1) { only('GET'); return ok({ connectors: [...connectors.values()].map(info) }); }
      const id = name(parts[1], 'connector');
      const entry = connectors.get(id);
      if (!entry) fail('not_found', `There is no ${id} connector.`);
      if (parts.length === 2) { only('GET'); return ok(info(entry)); }
      if (parts.length === 3 && parts[2] === 'config') {
        if (!entry.mod) fail('unavailable', `The ${id} connector did not load: ${entry.error}`);
        if (m === 'GET') return ok(connectorConfigView(entry));
        only('GET', 'PUT');
        if (!own) fail('local_only', 'Change connector settings from Workshop on this computer.');
        const body = await readBody(req, MB);
        const e1 = schemas.validate('connector-config-put', body);
        if (e1.length) fail('bad_request', `Send {"config": {...}}: ${e1[0]}`);
        const e2 = schemas.validate(entry.mod.configSchema, applyDefaults(entry.mod.configSchema, body.config));
        if (e2.length) fail('invalid_config', `That ${entry.mod.name} setting is not valid: ${e2[0]}`);
        config.connectors[id] = { ...(config.connectors[id] || { enabled: false }), config: structuredClone(body.config) };
        if (enabled(id)) { await stopConnector(entry); await startConnector(entry); }
        broadcast('config', { changed: [`connector:${id}`] });
        return ok(connectorConfigView(entry));
      }
      if (parts.length === 3) {
        only('POST');
        const action = parts[2];
        if (!ACTION.test(action)) fail('bad_request', `"${action}" is not a valid action name.`);
        if (!entry.mod) fail('unavailable', `The ${id} connector did not load: ${entry.error}`);
        const a = Object.hasOwn(entry.mod.actions, action) ? entry.mod.actions[action] : null;
        if (!a) fail('not_found', `The ${entry.mod.name} connector has no ${action} action.`);
        const body = (await readBody(req, MB)) ?? {};
        const e1 = schemas.validate('connector-call-request', body);
        if (e1.length) fail('bad_request', `Send {"args": {...}}: ${e1[0]}`);
        if (!enabled(id)) fail('disabled', `The ${entry.mod.name} connector is off. Turn it on in Settings.`);
        if (statusOf(entry).state !== 'ready') fail('unavailable', `The ${entry.mod.name} connector is not ready yet.`);
        if (a.write === true && body.confirm !== true) fail('confirm_required', `${a.title} changes something outside Workshop. Ask the user to confirm first.`);
        const args = body.args ?? {};
        if (a.argsSchema) { const e2 = schemas.validate(a.argsSchema, args); if (e2.length) fail('bad_request', `Those arguments are not valid: ${e2[0]}`); }
        try {
          const result = await a.run(args, entry.ctx);
          return ok({ result: result === undefined ? null : result });
        } catch (e) {
          if (e && STATUS_FOR[e.code] && e.status >= 400 && e.status <= 599) throw new HttpError(e.code, e.message);
          throw new HttpError('internal', e && e.message ? e.message : 'The connector failed.');
        }
      }
      fail('not_found', 'Not found.');
    }

    if (parts[0] === 'config' && parts.length === 1) {
      if (m === 'GET') return ok(publicConfig());
      only('GET', 'PUT');
      if (!own) fail('local_only', 'Change settings from Workshop on this computer.');
      const body = await readBody(req, MB);
      const errs = schemas.validate('config-patch', body);
      if (errs.length) fail('invalid_config', `That setting is not valid: ${errs[0]}`);
      const changed = [];
      let restartRequired = false;
      if (body.dataDir !== undefined && homeIsReal && isInside(body.dataDir, home)) fail('invalid_config', 'The data folder may not be inside the Workshop home folder.');
      if (body.port !== undefined) { restartRequired = body.port !== port; config.port = body.port; changed.push('port'); }
      if (body.dataDir !== undefined) { restartRequired = restartRequired || path.resolve(body.dataDir) !== path.resolve(dataDir); config.dataDir = body.dataDir; changed.push('dataDir'); }
      if (body.allowedOrigins) { config.allowedOrigins = [...body.allowedOrigins]; changed.push('allowedOrigins'); }
      if (body.features) { Object.assign(config.features, body.features); changed.push('features'); }
      if (body.connectors) {
        changed.push('connectors');
        for (const [id, c] of Object.entries(body.connectors)) {
          const before = enabled(id);
          config.connectors[id] = { ...(config.connectors[id] || {}), enabled: c.enabled };
          const entry = connectors.get(id);
          if (!entry || before === c.enabled) continue;
          if (c.enabled) await startConnector(entry); else { await stopConnector(entry); broadcastStatus(entry); }
        }
      }
      if (changed.length) broadcast('config', { changed });
      return ok({ config: publicConfig(), restartRequired });
    }

    if (parts[0] === 'events' && parts.length === 1) {
      only('GET');
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'keep-alive', ...cors });
      res.write(`event: hello\ndata: ${JSON.stringify({ api: 1, version: VERSION })}\n\n`);
      const client = { res };
      sse.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      ping.unref();
      req.on('close', () => { clearInterval(ping); sse.delete(client); });
      return;
    }

    fail('not_found', 'Not found.');
  }

  // ---------- start
  moveOldData();
  startWatching();
  await loadConnectors();
  const server = http.createServer((req, res) => { handle(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  port = server.address().port;
  if (options.port === undefined) config.port = port;
  for (const entry of connectors.values()) await startConnector(entry);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    config,
    dataDir,
    async stop() {
      watcher?.close();
      for (const t of timers.values()) clearTimeout(t);
      for (const c of sse) c.res.end();
      sse.clear();
      for (const entry of connectors.values()) await stopConnector(entry);
      const closed = new Promise(r => server.close(r));
      server.closeAllConnections();
      await closed;
      if (ownsDataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// ---------- command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = { port: 4380, root: REPO, origins: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], v = () => args[++i];
    if (a === '--port') opt.port = Number(v());
    else if (a === '--root') opt.root = path.resolve(v());
    else if (a === '--apps') opt.apps = path.resolve(v());
    else if (a === '--connectors') opt.connectors = path.resolve(v());
    else if (a === '--allow-origin') opt.origins.push(v());
    else if (a === '--token') opt.token = v();
    else if (a === '--data-dir') opt.dataDir = path.resolve(v());
    else { console.log('Usage: node tests/mock-agent.mjs [--port 4380] [--root .] [--apps dir] [--connectors dir] [--allow-origin url] [--token t] [--data-dir dir]'); process.exit(a === '--help' ? 0 : 1); }
  }
  const agent = await createMockAgent({
    port: opt.port, staticRoot: opt.root, dataDir: opt.dataDir, appsDir: opt.apps || path.join(opt.root, 'apps'), connectorsDir: opt.connectors || path.join(opt.root, 'connectors'), token: opt.token,
    config: { port: opt.port, allowedOrigins: opt.origins, features: { hostedMode: opt.origins.length > 0 } },
    log: (who, level, msg) => console.log(`[${who}] ${level}: ${msg}`)
  });
  console.log(`Mock Workshop agent. Data folder: ${agent.dataDir}${opt.dataDir ? '' : ' (temporary, removed on exit)'}. Open:\n  ${agent.url}/?token=${agent.token}`);
  const quit = async () => { await agent.stop(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

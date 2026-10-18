// Mock Workshop agent: an in-memory implementation of docs/agent-api.md, so app work can start before
// the real agent (WS1) ships. It passes the same contract suite (tests/contract/) the real agent must pass.
//
// Run it:   node tests/mock-agent.mjs [--port 4380] [--root .] [--apps <dir>] [--connectors <dir>]
//                                     [--allow-origin https://x.example] [--token <token>]
// It serves the repo's static files, keeps data in memory, and prints the URL to open.
//
// Use it from code:  const agent = await createMockAgent({...}); ... await agent.stop();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SchemaSet } from './lib/schema.mjs';
import { checkConnectorModule } from './lib/connector-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const VERSION = '0.0.0-mock';
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const STATUS_FOR = { bad_request: 400, invalid_config: 400, confirm_required: 400, downgrade: 400, unauthorized: 401, forbidden: 403,
  local_only: 403, not_found: 404, method_not_allowed: 405, conflict: 409, too_large: 413, disabled: 503, unavailable: 503, internal: 500 };
const MB = 1024 * 1024;
const STATIC_TOP = new Set(['shell', 'shared', 'icons', 'index.html', 'manifest.webmanifest', 'sw.js']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

class HttpError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.status = STATUS_FOR[code]; this.extra = extra; }
}
const fail = (code, message, extra) => { throw new HttpError(code, message, extra); };

const DEFAULT_CONFIG = () => ({ configVersion: 1, port: 4380, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} });

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
  const home = options.home || '(mock agent: in memory)';
  const log = options.log || (() => {});

  const data = new Map();      // "<app>/<collection>" -> envelope
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
    configVersion: 1, port: config.port, allowedOrigins: [...config.allowedOrigins],
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
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Workshop-Token, X-Workshop-Client',
          'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' });
        return res.end();
      }

      const headerOk = same(req.headers['x-workshop-token'], token);
      const cookieOk = same(cookies(req).workshop_token, token);
      const write = req.method === 'PUT' || req.method === 'POST';

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

    if (parts[0] === 'data' && (parts.length === 2 || parts.length === 3)) {
      const app = name(parts[1], 'app');
      if (parts.length === 2) {
        only('GET');
        const collections = [...data.entries()].filter(([k]) => k.startsWith(`${app}/`)).map(([k, e]) => ({
          collection: k.slice(app.length + 1), schema: e.schema, version: e.version, rev: e.rev, updatedAt: e.updatedAt, items: e.items.length
        })).sort((a, b) => a.collection.localeCompare(b.collection));
        return ok({ app, collections });
      }
      const collection = name(parts[2], 'collection');
      const key = `${app}/${collection}`;
      if (m === 'GET') {
        if (!data.has(key)) fail('not_found', `${app} has no ${collection} data yet.`);
        return ok(data.get(key));
      }
      only('GET', 'PUT');
      const body = await readBody(req, 10 * MB);
      const errs = schemas.validate('data-envelope', body);
      if (errs.length) fail('bad_request', `That data does not match the envelope format: ${errs[0]}`);
      if (body.schema !== key.replace('/', '.')) fail('bad_request', `schema must be "${app}.${collection}".`);
      const ids = new Set();
      for (const it of body.items) { if (ids.has(it.id)) fail('bad_request', `Item id "${it.id}" appears more than once.`); ids.add(it.id); }
      const stored = data.get(key);
      const rev = stored ? stored.rev : 0;
      if (body.rev !== rev) fail('conflict', 'That collection changed since you loaded it. Reload and try again.', { current: stored ?? { schema: body.schema, version: body.version, rev: 0, items: [] } });
      if (stored && body.version < stored.version) fail('downgrade', `This data is version ${stored.version}. A version ${body.version} writer cannot save it. Update Workshop.`);
      const client = req.headers['x-workshop-client'];
      const next = { ...structuredClone(body), rev: rev + 1, updatedAt: new Date().toISOString() };
      const ordered = { schema: next.schema, version: next.version, rev: next.rev, updatedAt: next.updatedAt, items: next.items };
      if (next.deleted) ordered.deleted = next.deleted;
      if (next.meta) ordered.meta = next.meta;
      data.set(key, ordered);
      broadcast('data', { app, collection, rev: ordered.rev, updatedAt: ordered.updatedAt, client: typeof client === 'string' && CLIENT.test(client) ? client : null });
      return ok({ rev: ordered.rev, updatedAt: ordered.updatedAt });
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
      if (body.port !== undefined) { restartRequired = body.port !== port; config.port = body.port; changed.push('port'); }
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
    async stop() {
      for (const c of sse) c.res.end();
      sse.clear();
      for (const entry of connectors.values()) await stopConnector(entry);
      const closed = new Promise(r => server.close(r));
      server.closeAllConnections();
      await closed;
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
    else { console.log('Usage: node tests/mock-agent.mjs [--port 4380] [--root .] [--apps dir] [--connectors dir] [--allow-origin url] [--token t]'); process.exit(a === '--help' ? 0 : 1); }
  }
  const agent = await createMockAgent({
    port: opt.port, staticRoot: opt.root, appsDir: opt.apps || path.join(opt.root, 'apps'), connectorsDir: opt.connectors || path.join(opt.root, 'connectors'), token: opt.token,
    config: { port: opt.port, allowedOrigins: opt.origins, features: { hostedMode: opt.origins.length > 0 } },
    log: (who, level, msg) => console.log(`[${who}] ${level}: ${msg}`)
  });
  console.log(`Mock Workshop agent (data in memory only). Open:\n  ${agent.url}/?token=${agent.token}`);
  const quit = async () => { await agent.stop(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

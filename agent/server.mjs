// The Workshop agent: one local process that serves the UI, stores app data on disk and hosts connectors.
// Implements docs/agent-api.md (api: 1). Node standard library only. It never makes an outbound request
// itself; only connectors do, to hosts from their own config.
//
// Use it from code:  const agent = await createAgent({ home }); ... await agent.stop();
// Run it:            node agent/start.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.mjs';
import { SchemaSet } from './lib/schema.mjs';
import { HttpError, MB, fail, sendJson, sendHtml, sendText, readJsonBody, parseCookies, escapeHtml } from './lib/http.mjs';
import { removeTmpFiles, KeyedLock } from './lib/fsutil.mjs';
import { homePaths, loadConfig, saveConfig, loadToken } from './lib/home.mjs';
import { createLogger, stripToken } from './lib/log.mjs';
import { Store } from './lib/store.mjs';
import { EventHub } from './lib/events.mjs';
import { ConnectorHost } from './lib/connectors.mjs';
import { serveStatic } from './lib/static.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const API_PREFLIGHT = {
  'Access-Control-Allow-Methods': 'GET, PUT, POST',
  'Access-Control-Allow-Headers': 'Content-Type, X-Workshop-Token, X-Workshop-Client',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '600'
};

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Start the agent.
 * @param {object} o
 * @param {string} o.home              the Workshop home folder (see lib/home.mjs resolveHome)
 * @param {string} [o.root]            folder with shell/, shared/, icons/, index.html (default: this repo)
 * @param {string} [o.appsDir]         default <root>/apps
 * @param {string} [o.connectorsDir]   default <root>/connectors
 * @param {object} [o.env]             environment variables connectors may read (default process.env)
 * @param {number} [o.port]            listen here instead of config.json's port (0 picks a free port)
 * @param {boolean} [o.echoLog]        also print log lines to the console
 * @returns {Promise<{url: string, port: number, token: string, home: string, logFile: string, stop: () => Promise<void>}>}
 */
export async function createAgent(o) {
  if (!o || !o.home) throw new Error('createAgent needs a home folder.');
  const home = path.resolve(o.home);
  const root = path.resolve(o.root || REPO);
  const appsDir = path.resolve(o.appsDir || path.join(root, 'apps'));
  const connectorsDir = path.resolve(o.connectorsDir || path.join(root, 'connectors'));
  const env = o.env || process.env;
  const paths = homePaths(home);
  const schemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));

  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const leftovers = removeTmpFiles(home);
  const config = await loadConfig(paths.config, schemas);
  const token = await loadToken(paths.token);
  const log = createLogger({ dir: paths.logs, echo: o.echoLog === true, secrets: [token] });
  for (const f of leftovers) log.warn(`Removed a leftover temp file from an interrupted write: ${path.relative(home, f)}`);

  const configLock = new KeyedLock();
  /** Apply a change to the live config and save it. If saving fails, the change is undone. */
  const commitConfig = mutate => configLock.run('config', async () => {
    const before = structuredClone(config);
    mutate();
    try { await saveConfig(paths.config, config); } catch (e) {
      for (const k of Object.keys(config)) delete config[k];
      Object.assign(config, before);
      log.error(`Could not save config.json: ${e.code || e.message}`);
      fail('internal', 'Workshop could not save its settings. Nothing was changed.');
    }
  });
  const events = new EventHub({ version: VERSION });
  const store = new Store({ dir: paths.data, schemas, log: log.for('data') });
  const connectors = new ConnectorHost({
    dir: connectorsDir, schemas, env, home, storageDir: path.join(paths.data, '_connectors'), log, events, config: () => config
  });

  let port = 0;
  const ownOrigins = () => [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  const publicConfig = () => ({
    configVersion: 1,
    port: config.port,
    allowedOrigins: [...config.allowedOrigins],
    features: { startAtLogin: config.features.startAtLogin === true, hostedMode: config.features.hostedMode === true },
    connectors: Object.fromEntries(Object.entries(config.connectors || {}).map(([id, c]) => [id, { enabled: c.enabled === true }])),
    home
  });

  function listApps() {
    let dirs = [];
    try { dirs = fs.readdirSync(appsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { /* no apps folder */ }
    const apps = [];
    for (const dir of dirs) {
      const file = path.join(appsDir, dir, 'app.json');
      if (!fs.existsSync(file)) continue;
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
        log.warn(`Skipped apps/${dir}: app.json is not valid JSON.`);
        continue;
      }
      const errs = schemas.validate('app', manifest);
      if (errs.length || manifest.id !== dir) {
        log.warn(`Skipped apps/${dir}: ${errs[0] || `id "${manifest.id}" does not match the folder name`}`);
        continue;
      }
      apps.push({ base: `/apps/${dir}/`, manifest });
    }
    apps.sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
    return { apps };
  }

  // ---------- request handling
  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://placeholder');
    const p = url.pathname;
    const isApi = p.startsWith('/api/');
    let cors = {};
    res.on('close', () => {
      if (isApi || res.statusCode >= 400) log.for('http').info(`${req.method} ${stripToken(req.url)} ${res.statusCode} ${Date.now() - started}ms`);
    });
    try {
      const host = req.headers.host || '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) fail('forbidden', 'This address is not allowed. Use 127.0.0.1.');
      const origin = req.headers.origin;
      const own = origin === undefined || ownOrigins().includes(origin);
      const hosted = !own && config.features.hostedMode === true && config.allowedOrigins.includes(origin);
      if (!own && !hosted) fail('forbidden', 'This site is not allowed to use Workshop.');
      if (hosted) cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };

      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, ...API_PREFLIGHT, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      const headerOk = same(req.headers['x-workshop-token'], token);
      const cookieOk = same(parseCookies(req).workshop_token, token);

      if (!isApi) { await handlePage(req, res, url, cookieOk); return; }

      if (p === '/api/health') {
        if (req.method !== 'GET') fail('method_not_allowed', 'Use GET.');
        sendJson(res, 200, { app: 'workshop-agent', api: 1, version: VERSION }, cors);
        return;
      }
      if (p === '/api/session') {
        if (req.method !== 'GET') fail('method_not_allowed', 'Use GET.');
        if (!own) fail('forbidden', 'Pair this page from Settings instead.');
        if (!cookieOk) fail('unauthorized', 'Open Workshop from this computer first.');
        sendJson(res, 200, { api: 1, token, agentOrigin: ownOrigins()[0] }, cors);
        return;
      }
      const queryOk = p === '/api/events' && same(url.searchParams.get('token'), token);
      const authed = headerOk || (cookieOk && own && req.method === 'GET') || queryOk;
      if (!authed) fail('unauthorized', 'Open Workshop from this computer first, or pair this page in Settings.');
      if ((req.method === 'PUT' || req.method === 'POST') && !headerOk) fail('unauthorized', 'Writes need the X-Workshop-Token header.');
      await handleApi(req, res, url, { own, cors });
    } catch (e) {
      if (!(e instanceof HttpError)) log.error(`Unexpected error on ${req.method} ${stripToken(req.url)}: ${e && (e.stack || e.message)}`);
      if (res.headersSent) { res.end(); return; }
      const err = e instanceof HttpError ? e : new HttpError('internal', 'Something went wrong in the agent. See the log for details.');
      if (isApi) sendJson(res, err.status, { error: err.message, code: err.code, ...(err.extra || {}) }, cors);
      else sendText(res, err.status, err.message);
    }
  }

  async function handlePage(req, res, url, cookieOk) {
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('method_not_allowed', 'Use GET.');
    const q = url.searchParams.get('token');
    if (q !== null && url.pathname !== '/pair') {
      url.searchParams.delete('token');
      const qs = url.searchParams.toString();
      const headers = { Location: url.pathname + (qs ? `?${qs}` : ''), 'Cache-Control': 'no-store' };
      if (same(q, token)) headers['Set-Cookie'] = `workshop_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
      res.writeHead(303, headers);
      res.end();
      return;
    }
    if (url.pathname === '/pair') { pairPage(res, url, cookieOk); return; }
    serveStatic(req, res, url.pathname, { root, appsDir });
  }

  const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${body}`;

  function pairPage(res, url, cookieOk) {
    const origin = url.searchParams.get('origin') || '';
    if (!cookieOk) { sendHtml(res, 401, page('Workshop', '<p>Open Workshop on this computer first, then try pairing again.</p>')); return; }
    if (!origin || schemas.validate({ $ref: 'common.schema.json#/$defs/origin' }, origin).length) {
      sendHtml(res, 403, page('Workshop', '<p>That pairing link is not valid.</p>'));
      return;
    }
    if (config.features.hostedMode !== true) { sendHtml(res, 403, page('Workshop', '<p>Hosted mode is off. Turn it on in Settings first.</p>')); return; }
    if (!config.allowedOrigins.includes(origin)) {
      sendHtml(res, 403, page('Workshop', `<p>${escapeHtml(origin)} is not in your allowed sites. Add it in Settings first.</p>`));
      return;
    }
    const js = v => JSON.stringify(v).replace(/</g, '\\u003c');
    const payload = js({ type: 'workshop-pair', api: 1, url: ownOrigins()[0], token });
    sendHtml(res, 200, page('Pair Workshop', `
<p>Allow <strong>${escapeHtml(origin)}</strong> to use Workshop on this computer?</p>
<button id="allow" type="button">Allow ${escapeHtml(origin)} to use Workshop on this computer</button>
<script>
document.getElementById('allow').addEventListener('click', function () {
  if (window.opener) window.opener.postMessage(${payload}, ${js(origin)});
  window.close();
});
</script>`));
  }

  async function handleApi(req, res, url, { own, cors }) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const m = req.method;
    const only = (...methods) => { if (!methods.includes(m)) fail('method_not_allowed', `Use ${methods.join(' or ')}.`); };
    const name = (v, what) => { if (!NAME.test(v)) fail('bad_request', `"${v}" is not a valid ${what} name.`); return v; };
    const ok = body => sendJson(res, 200, body, cors);

    if (parts[0] === 'apps' && parts.length === 1) { only('GET'); ok(listApps()); return; }

    if (parts[0] === 'data' && (parts.length === 2 || parts.length === 3)) {
      const app = name(parts[1], 'app');
      if (parts.length === 2) { only('GET'); ok({ app, collections: await store.list(app) }); return; }
      const collection = name(parts[2], 'collection');
      if (m === 'GET') { ok(await store.get(app, collection)); return; }
      only('GET', 'PUT');
      const body = await readJsonBody(req, 10 * MB);
      const saved = await store.put(app, collection, body);
      const client = req.headers['x-workshop-client'];
      events.send('data', { app, collection, rev: saved.rev, updatedAt: saved.updatedAt, client: typeof client === 'string' && CLIENT.test(client) ? client : null });
      ok({ rev: saved.rev, updatedAt: saved.updatedAt });
      return;
    }

    if (parts[0] === 'connectors') {
      if (parts.length === 1) { only('GET'); ok({ connectors: connectors.list() }); return; }
      const id = name(parts[1], 'connector');
      if (!connectors.has(id)) fail('not_found', `There is no ${id} connector.`);
      if (parts.length === 2) { only('GET'); ok(connectors.info(id)); return; }
      if (parts.length === 3 && parts[2] === 'config') {
        if (m === 'GET') { ok(connectors.configView(id)); return; }
        only('GET', 'PUT');
        if (!own) fail('local_only', 'Change connector settings from Workshop on this computer.');
        connectors.configView(id); // 503 if the module did not load
        const body = await readJsonBody(req, MB);
        const errs = schemas.validate('connector-config-put', body);
        if (errs.length) fail('bad_request', `Send {"config": {...}}: ${errs[0]}`);
        connectors.checkConfig(id, body.config);
        await commitConfig(() => {
          config.connectors[id] = { ...(config.connectors[id] || { enabled: false }), config: structuredClone(body.config) };
        });
        await connectors.configChanged(id);
        events.send('config', { changed: [`connector:${id}`] });
        ok(connectors.configView(id));
        return;
      }
      if (parts.length === 3) {
        only('POST');
        const action = parts[2];
        if (!ACTION.test(action)) fail('bad_request', `"${action}" is not a valid action name.`);
        const body = (await readJsonBody(req, MB)) ?? {};
        ok({ result: await connectors.call(id, action, body) });
        return;
      }
      fail('not_found', 'Not found.');
    }

    if (parts[0] === 'config' && parts.length === 1) {
      if (m === 'GET') { ok(publicConfig()); return; }
      only('GET', 'PUT');
      if (!own) fail('local_only', 'Change settings from Workshop on this computer.');
      const body = await readJsonBody(req, MB);
      const errs = schemas.validate('config-patch', body);
      if (errs.length) fail('invalid_config', `That setting is not valid: ${errs[0]}`);
      const changed = [];
      const toggled = [];
      const restartRequired = body.port !== undefined && body.port !== port;
      await commitConfig(() => {
        if (body.port !== undefined) { config.port = body.port; changed.push('port'); }
        if (body.allowedOrigins) { config.allowedOrigins = [...body.allowedOrigins]; changed.push('allowedOrigins'); }
        if (body.features) { config.features = { ...config.features, ...body.features }; changed.push('features'); }
        if (body.connectors) {
          changed.push('connectors');
          for (const [id, c] of Object.entries(body.connectors)) {
            const before = config.connectors[id]?.enabled === true;
            config.connectors[id] = { ...(config.connectors[id] || {}), enabled: c.enabled };
            if (before !== c.enabled) toggled.push([id, c.enabled]);
          }
        }
      });
      for (const [id, on] of toggled) await connectors.enabledChanged(id, on);
      if (changed.length) events.send('config', { changed });
      ok({ config: publicConfig(), restartRequired });
      return;
    }

    if (parts[0] === 'events' && parts.length === 1) { only('GET'); events.open(req, res, cors); return; }

    fail('not_found', 'Not found.');
  }

  // ---------- start
  const server = http.createServer((req, res) => { handle(req, res); });
  server.headersTimeout = 30000;
  server.requestTimeout = 120000;
  await connectors.load();
  const listenPort = o.port ?? config.port;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPort, '127.0.0.1', resolve); });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      const err = new Error(`Port ${listenPort} on 127.0.0.1 is already in use. Workshop may already be running; otherwise change "port" in ${paths.config}.`);
      err.code = 'EADDRINUSE';
      throw err;
    }
    throw e;
  }
  port = server.address().port;
  log.info(`Workshop agent ${VERSION} listening on http://127.0.0.1:${port} (home ${home}).`);
  await connectors.startAll();

  let stopping = null;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    home,
    logFile: log.file,
    stop() {
      stopping ??= (async () => {
        events.closeAll();
        await connectors.stopAll();
        const closed = new Promise(r => server.close(r));
        server.closeAllConnections();
        await closed;
        log.info('Workshop agent stopped.');
      })();
      return stopping;
    }
  };
}

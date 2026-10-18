// The connector host (docs/connector.md). Loads every connectors/<id>/index.mjs, starts the ones enabled in
// config.json, builds each one's ctx, and runs actions for the API. A broken connector is listed with
// state "error" and never stops the agent.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkConnectorModule } from './connector-check.mjs';
import { writeJsonAtomic, KeyedLock } from './fsutil.mjs';
import { HttpError, STATUS_FOR, fail } from './http.mjs';

const STOP_MS = 5000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const STORAGE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EVENT_NAME = /^[a-z][a-zA-Z0-9.-]{0,63}$/;
const MAX_PAYLOAD = 64 * 1024;
const STATES = new Set(['starting', 'ready', 'stopped', 'error']);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

/** Fill defaults from a form-subset configSchema into value (objects, recursively). */
export function applyDefaults(schema, value) {
  if (!schema || schema.type !== 'object') return value;
  const out = { ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) };
  for (const [k, s] of Object.entries(schema.properties || {})) {
    if (out[k] === undefined && s.default !== undefined) out[k] = structuredClone(s.default);
    if (s.type === 'object') out[k] = applyDefaults(s, out[k]);
  }
  return out;
}

/** Every environment variable name a config holds in fields marked x-workshop-env. */
export function envNames(schema, value, acc = new Set()) {
  if (!schema || value === undefined || value === null) return acc;
  if (schema.type === 'object' && typeof value === 'object') {
    for (const [k, s] of Object.entries(schema.properties || {})) envNames(s, value[k], acc);
  } else if (schema.type === 'array' && Array.isArray(value)) {
    value.forEach(v => envNames(schema.items, v, acc));
  } else if (schema.type === 'string' && schema['x-workshop-env'] && typeof value === 'string' && ENV_NAME.test(value)) {
    acc.add(value);
  }
  return acc;
}

const timeout = (ms, what) => new Promise((_, reject) => {
  const t = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} seconds.`)), ms);
  t.unref();
});

export class ConnectorHost {
  #dir; #schemas; #env; #home; #storageDir; #log; #events; #config;
  #entries = new Map();
  #storageLock = new KeyedLock();

  /**
   * @param {object} o
   * @param {string} o.dir         folder holding <id>/index.mjs
   * @param {object} o.schemas     SchemaSet for docs/schemas
   * @param {object} o.env         environment variables connectors may read
   * @param {string} o.home        the Workshop home folder
   * @param {string} o.storageDir  <home>/data/_connectors
   * @param {object} o.log         logger from log.mjs
   * @param {object} o.events      EventHub
   * @param {() => object} o.config returns the live config object
   */
  constructor(o) {
    this.#dir = o.dir; this.#schemas = o.schemas; this.#env = o.env; this.#home = o.home;
    this.#storageDir = o.storageDir; this.#log = o.log; this.#events = o.events; this.#config = o.config;
  }

  async load() {
    let ids = [];
    try {
      ids = fs.readdirSync(this.#dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_')).map(d => d.name).sort();
    } catch { /* no connectors folder */ }
    for (const id of ids) {
      const file = path.join(this.#dir, id, 'index.mjs');
      if (!fs.existsSync(file)) continue;
      const entry = { id, mod: null, error: null, startError: null, ctx: null, abort: null, lastState: null, since: new Date().toISOString() };
      try {
        const mod = (await import(pathToFileURL(file).href)).default;
        const problem = checkConnectorModule(mod, id, this.#schemas);
        if (problem) entry.error = problem; else entry.mod = mod;
      } catch (e) {
        entry.error = `Could not load: ${e.message}`;
      }
      if (entry.error) this.#log.error(`Connector ${id} is not usable: ${entry.error}`);
      this.#entries.set(id, entry);
    }
  }

  has(id) { return this.#entries.has(id); }
  #entry(id) {
    const e = this.#entries.get(id);
    if (!e) fail('not_found', `There is no ${id} connector.`);
    return e;
  }

  #enabled(id) { return this.#config().connectors?.[id]?.enabled === true; }
  #storedConfig(entry) { return applyDefaults(entry.mod.configSchema, this.#config().connectors?.[entry.id]?.config); }

  #status(entry) {
    let s;
    if (entry.error) s = { state: 'error', message: entry.error };
    else if (!this.#enabled(entry.id)) s = { state: 'disabled', message: null };
    else if (entry.startError) s = { state: 'error', message: entry.startError };
    else {
      try {
        const r = entry.mod.status() || {};
        s = { state: r.state, message: typeof r.message === 'string' ? r.message : null };
        if (r.details && typeof r.details === 'object' && !Array.isArray(r.details)) s.details = r.details;
      } catch (e) { s = { state: 'error', message: e.message }; }
      if (!STATES.has(s.state)) s = { state: 'error', message: 'The connector reported an unknown state.' };
    }
    if (s.state !== entry.lastState) { entry.lastState = s.state; entry.since = new Date().toISOString(); }
    return { state: s.state, message: s.message, since: entry.since, ...(s.details ? { details: s.details } : {}) };
  }

  #broadcastStatus(entry) { this.#events.send('connector-status', { id: entry.id, status: this.#status(entry) }); }

  info(id) { return this.#info(this.#entry(id)); }
  list() { return [...this.#entries.values()].map(e => this.#info(e)); }

  #info(entry) {
    const m = entry.mod;
    const o = {
      id: entry.id, name: m ? m.name : entry.id, version: m ? m.version : '0.0.0', enabled: this.#enabled(entry.id), status: this.#status(entry),
      actions: m ? Object.entries(m.actions).map(([name, a]) => ({ name, title: a.title, write: a.write === true })) : []
    };
    if (m?.test) o.test = { action: m.test.action, arg: m.test.arg, label: m.test.label };
    return o;
  }

  #makeCtx(entry) {
    const cfg = deepFreeze(this.#storedConfig(entry));
    const allowed = envNames(entry.mod.configSchema, cfg);
    const abort = new AbortController();
    const log = this.#log.for(`connector:${entry.id}`);
    const env = this.#env;
    const storageDir = path.join(this.#storageDir, entry.id);
    const lock = this.#storageLock;
    const events = this.#events;
    const ctx = Object.freeze({
      config: cfg,
      env: name => {
        if (!allowed.has(name)) throw new Error(`Environment variable ${name} is not named in this connector's config.`);
        const v = env[name];
        if (typeof v === 'string') this.#log.addSecret(v);
        return v;
      },
      log: Object.freeze({ info: (m, d) => log.info(m, d), warn: (m, d) => log.warn(m, d), error: (m, d) => log.error(m, d) }),
      storage: Object.freeze({
        async get(key) {
          if (typeof key !== 'string' || !STORAGE_KEY.test(key)) throw new Error(`"${key}" is not a valid storage key.`);
          try { return JSON.parse(await fsp.readFile(path.join(storageDir, `${key}.json`), 'utf8')); } catch (e) {
            if (e.code === 'ENOENT') return undefined;
            throw new Error(`Could not read stored value "${key}".`);
          }
        },
        async put(key, value) {
          if (typeof key !== 'string' || !STORAGE_KEY.test(key)) throw new Error(`"${key}" is not a valid storage key.`);
          const text = JSON.stringify(value);
          if (text === undefined) throw new Error('Storage values must be JSON.');
          await lock.run(`${entry.id}/${key}`, () => writeJsonAtomic(path.join(storageDir, `${key}.json`), JSON.parse(text)));
        }
      }),
      emit: (event, payload) => {
        if (typeof event !== 'string' || !EVENT_NAME.test(event)) throw new Error(`"${event}" is not a valid event name.`);
        const text = JSON.stringify(payload ?? null);
        if (text === undefined || Buffer.byteLength(text) > MAX_PAYLOAD) throw new Error('Event payloads must be JSON under 64 KB.');
        events.send('connector', { id: entry.id, event, payload: JSON.parse(text) });
      },
      statusChanged: () => this.#broadcastStatus(entry),
      signal: abort.signal,
      home: this.#home
    });
    return { ctx, abort };
  }

  async #start(entry) {
    if (!entry.mod || !this.#enabled(entry.id) || entry.ctx) return;
    const { ctx, abort } = this.#makeCtx(entry);
    entry.ctx = ctx; entry.abort = abort; entry.startError = null;
    try { await entry.mod.start(ctx); } catch (e) {
      entry.startError = `Could not start: ${e && e.message ? e.message : 'unknown error'}`;
      this.#log.error(`Connector ${entry.id} failed to start: ${e && e.message}`);
    }
    if (!entry.startError) this.#log.info(`Connector ${entry.id} started.`);
    this.#broadcastStatus(entry);
  }

  async #stop(entry) {
    if (!entry.mod || !entry.ctx) return;
    entry.abort.abort();
    try { await Promise.race([Promise.resolve().then(() => entry.mod.stop()), timeout(STOP_MS, `Stopping ${entry.id}`)]); } catch (e) {
      this.#log.error(`Connector ${entry.id} did not stop cleanly: ${e.message}`);
    }
    entry.ctx = null; entry.abort = null; entry.startError = null;
    this.#log.info(`Connector ${entry.id} stopped.`);
  }

  async startAll() { for (const e of this.#entries.values()) await this.#start(e); }
  async stopAll() { for (const e of this.#entries.values()) await this.#stop(e); }

  /** Apply an enabled change already written to config. */
  async enabledChanged(id, on) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (on) await this.#start(entry);
    else { await this.#stop(entry); this.#broadcastStatus(entry); }
  }

  #loaded(id) {
    const entry = this.#entry(id);
    if (!entry.mod) fail('unavailable', `The ${id} connector did not load: ${entry.error}`);
    return entry;
  }

  configView(id) {
    const entry = this.#loaded(id);
    const cfg = this.#storedConfig(entry);
    const env = {};
    for (const n of envNames(entry.mod.configSchema, cfg)) env[n] = { set: typeof this.#env[n] === 'string' && this.#env[n] !== '' };
    return { id: entry.id, schema: entry.mod.configSchema, config: cfg, env };
  }

  /** Validate a new config for one connector. Returns it unchanged if valid; throws invalid_config if not. */
  checkConfig(id, value) {
    const entry = this.#loaded(id);
    const errs = this.#schemas.validate(entry.mod.configSchema, applyDefaults(entry.mod.configSchema, value));
    if (errs.length) fail('invalid_config', `That ${entry.mod.name} setting is not valid: ${errs[0]}`);
    return value;
  }

  /** Restart after a config change already written to config. */
  async configChanged(id) {
    const entry = this.#loaded(id);
    if (this.#enabled(id)) { await this.#stop(entry); await this.#start(entry); }
  }

  async call(id, action, body) {
    const entry = this.#loaded(id);
    const a = Object.hasOwn(entry.mod.actions, action) ? entry.mod.actions[action] : null;
    if (!a) fail('not_found', `The ${entry.mod.name} connector has no ${action} action.`);
    const errs = this.#schemas.validate('connector-call-request', body);
    if (errs.length) fail('bad_request', `Send {"args": {...}}: ${errs[0]}`);
    if (!this.#enabled(id)) fail('disabled', `The ${entry.mod.name} connector is off. Turn it on in Settings.`);
    if (this.#status(entry).state !== 'ready' || !entry.ctx) fail('unavailable', `The ${entry.mod.name} connector is not ready yet.`);
    if (a.write === true && body.confirm !== true) fail('confirm_required', `${a.title} changes something outside Workshop. Ask the user to confirm first.`);
    const args = body.args ?? {};
    if (a.argsSchema) {
      const e2 = this.#schemas.validate(a.argsSchema, args);
      if (e2.length) fail('bad_request', `Those arguments are not valid: ${e2[0]}`);
    }
    try {
      const result = await a.run(args, entry.ctx);
      const text = JSON.stringify(result === undefined ? null : result);
      return JSON.parse(text);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e && STATUS_FOR[e.code] && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599) throw new HttpError(e.code, e.message);
      this.#log.error(`Connector ${id} action ${action} failed: ${e && e.message}`);
      throw new HttpError('internal', e && e.message ? e.message : 'The connector failed.');
    }
  }
}

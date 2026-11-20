// Tokens & sign-ins (docs/agent-api.md, Secrets; docs/security.md, Secrets): what Settings needs so nobody has to
// open a terminal to give Workshop a token, key or password.
//
//   GET    /api/secrets              every saved secret (names and dates) and every field that names one
//   POST   /api/secrets              save one: {name | env, kind, value, expires?, note?}
//   DELETE /api/secrets/<name>       remove one
//   POST   /api/signin/mcp/<id>      start an MCP server's sign-in: {url} to open in a new tab
//   POST   /api/signout/mcp/<id>     forget it
//   GET    /oauth/callback           where the server's sign-in page sends the browser back
//
// All but GET /api/secrets and the callback are local only (Workshop on this computer, never a hosted page) and
// writes (the X-Workshop-Token header). A value is never returned, logged or written anywhere but the store.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, fail, readJsonBody, sendHtml, escapeHtml } from './http.mjs';
import { SECRET_NAME, readIndex, secretStatus, storeName } from './secrets.mjs';
import { compactKeyFile, looksLikeToken, passwordProblem, removeSecret, saveSecret, secretProblem } from './secret-write.mjs';
import { envSecretName } from './stored-env.mjs';

const KINDS = ['token', 'password', 'key-file'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PENDING_MS = 10 * 60 * 1000;
const OAUTH_FILE = id => `oauth-${id}.json`;

/** Every field in a config that names a token: {path, title, kind: 'secret'|'env', secretKind, value, def}. */
export function credentialFields(schema, value, at = '', out = []) {
  if (!schema) return out;
  if (schema.type === 'object') {
    const v = value && typeof value === 'object' ? value : {};
    for (const [k, s] of Object.entries(schema.properties || {})) credentialFields(s, v[k], at ? `${at}.${k}` : k, out);
  } else if (schema.type === 'array' && Array.isArray(value)) {
    value.forEach((v, i) => credentialFields(schema.items, v, `${at}[${i}]`, out));
  } else if (schema.type === 'string' && (schema['x-workshop-secret'] || schema['x-workshop-env'])) {
    const def = typeof schema.default === 'string' ? schema.default : '';
    out.push({ path: at, title: schema.title || at, kind: schema['x-workshop-secret'] ? 'secret' : 'env', secretKind: schema['x-workshop-secret-kind'] || 'token', value: typeof value === 'string' ? value : def, def });
  }
  return out;
}

/** A copy of `value` with every token pasted where a name goes moved out by `move(field, token)` (=> the name). */
export async function movePastedTokens(schema, value, move, at = '') {
  if (!schema || value === undefined || value === null) return value;
  if (schema.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    const out = { ...value };
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in out) out[k] = await movePastedTokens(s, out[k], move, at ? `${at}.${k}` : k);
    return out;
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(await movePastedTokens(schema.items, value[i], move, `${at}[${i}]`));
    return out;
  }
  if (schema.type === 'string' && (schema['x-workshop-secret'] || schema['x-workshop-env']) && typeof value === 'string') {
    const v = value.trim();
    const pasted = schema['x-workshop-secret'] ? looksLikeToken(v) : (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v) && secretProblem(v) === null);
    if (pasted && (schema['x-workshop-secret-kind'] || 'token') === 'token') {
      const name = await move({ path: at, kind: schema['x-workshop-secret'] ? 'secret' : 'env', def: typeof schema.default === 'string' ? schema.default : '' }, v);
      return name ?? value;
    }
  }
  return value;
}

/** A free secret name like `base`, `base-2`, ... not in `taken`. */
export function freeName(base, taken) {
  const b = String(base).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, '').slice(0, 36) || 'token';
  if (!taken.has(b)) return b;
  for (let i = 2; i < 100; i++) if (!taken.has(`${b}-${i}`)) return `${b}-${i}`;
  return `${b}-${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * The routes above. `deps`: {home, dataDir, connectors, secretsRead, savedEnv, log, events, platform, ownOrigin,
 * commitConfig, config, save, remove}. `save` and `remove` default to lib/secret-write.mjs (tests fake them).
 */
export function credentials(deps) {
  const platform = deps.platform || process.platform;
  const save = deps.save || ((h, n, v, o) => saveSecret(h, n, v, { platform, ...o }));
  const remove = deps.remove || ((h, n) => removeSecret(h, n, { platform }));
  const pending = new Map(); // state -> {id, secret, at}
  const log = deps.log;

  /** Connectors whose config names this secret (or the variable it stands for), so they start again with it. */
  const usersOf = name => {
    const out = [];
    for (const c of deps.connectors.list()) {
      let v; try { v = deps.connectors.configView(c.id); } catch { continue; }
      if (credentialFields(v.schema, v.config).some(f => (f.kind === 'secret' ? f.value === name : envSecretName(f.value) === name))) out.push(c.id);
    }
    return out;
  };
  const changed = async name => {
    deps.secretsRead.forget?.(name);
    if (name.startsWith('env-')) await deps.savedEnv.refresh();
    for (const id of usersOf(name)) { try { await deps.connectors.configChanged(id); } catch { /* status says it */ } }
    deps.events.send('config', { changed: ['secrets'] });
  };

  /** Saves a value under a name. Checks it for its kind first. Returns {ok, message, name, note}. */
  async function store(name, kind, raw, { expires = null, note = '' } = {}) {
    if (!storeName(platform)) return { ok: false, message: `Workshop has no secret store on ${platform}.` };
    let value = typeof raw === 'string' ? raw : '';
    if (kind === 'key-file') {
      let k;
      try { k = compactKeyFile(value); } catch (e) { return { ok: false, message: e.message }; }
      if (platform === 'win32' && k.value.length > 1280) return { ok: false, message: 'A Google service account key is too big for Windows Credential Manager. The Google Play connector works on macOS and Linux for now.' };
      value = k.value; note = note || `Google service account ${k.email}`;
    } else {
      if (kind === 'token') value = value.trim();
      const problem = kind === 'password' ? passwordProblem(value) : secretProblem(value);
      if (problem) return { ok: false, message: problem };
    }
    log.addSecret(value);
    const r = await save(deps.home, name, value, { expires, note });
    if (!r.ok) return { ok: false, message: r.message };
    log.for('secrets').info(`Saved ${name} in ${storeName(platform)} from Settings.`);
    await changed(name);
    return { ok: true, message: '', name, note };
  }

  /** At start and on each local config save: tokens pasted where a name goes are moved into the store. */
  async function moveOut(id, schema, value) {
    if (!storeName(platform)) return { value, moved: [] };
    const moved = [];
    const next = await movePastedTokens(schema, value, async (field, token) => {
      const taken = new Set(Object.keys(readIndex(deps.home)));
      if (field.kind === 'env') {
        const envName = field.def || `${id.toUpperCase().replace(/-/g, '_')}_TOKEN`;
        const n = envSecretName(envName);
        if (!n) return null;
        const r = await store(n, 'token', token, { note: `${id}: ${field.path}` });
        if (!r.ok) { log.for('secrets').warn(`A token was pasted into ${id} ${field.path} but could not be saved: ${r.message}`); return null; }
        moved.push({ path: field.path, name: n });
        return envName;
      }
      const n = field.def && !taken.has(field.def) ? field.def : freeName(`${id}-token`, taken);
      const r = await store(n, 'token', token, { note: `${id}: ${field.path}` });
      if (!r.ok) { log.for('secrets').warn(`A token was pasted into ${id} ${field.path} but could not be saved: ${r.message}`); return null; }
      moved.push({ path: field.path, name: n });
      return n;
    });
    for (const m of moved) log.for('secrets').info(`Moved a token pasted into ${id} ${m.path} into ${storeName(platform)} as ${m.name}.`);
    return { value: next, moved };
  }

  function list() {
    const index = readIndex(deps.home);
    const uses = [];
    for (const c of deps.connectors.list()) {
      let v; try { v = deps.connectors.configView(c.id); } catch { continue; }
      if (!deps.connectors.has(c.id) || !(deps.config.connectors && deps.config.connectors[c.id])) continue;
      for (const f of credentialFields(v.schema, v.config)) {
        if (!f.value) continue;
        const secret = f.kind === 'secret' ? (SECRET_NAME.test(f.value) ? f.value : null) : envSecretName(f.value);
        const envSet = f.kind === 'env' && v.env && v.env[f.value] ? v.env[f.value].set === true : false;
        uses.push({ connector: c.id, connectorName: c.name || c.id, enabled: !!c.enabled, path: f.path, title: f.title, kind: f.kind, secretKind: f.secretKind,
          name: secret, env: f.kind === 'env' ? f.value : null, saved: !!(secret && index[secret]), envSet });
      }
    }
    const servers = (((deps.config.connectors || {}).mcp || {}).config || {}).servers || [];
    const signins = servers.filter(s => s && s.auth === 'oauth').map(s => ({
      id: s.id, name: s.name, host: (() => { try { return new URL(s.url).host; } catch { return ''; } })(), secret: SECRET_NAME.test(String(s.tokenSecret || '')) ? s.tokenSecret : null,
      signedIn: !!(s.tokenSecret && index[s.tokenSecret] && fs.existsSync(path.join(deps.dataDirConnectors, 'mcp', OAUTH_FILE(s.id))))
    }));
    const today = new Date().toISOString().slice(0, 10);
    return {
      store: storeName(platform), platform,
      secrets: Object.keys(index).sort().map(n => ({ name: n, ...secretStatus(index, n, today), saved: index[n].saved, note: index[n].note, usedBy: uses.filter(u => u.name === n).map(u => ({ connector: u.connector, connectorName: u.connectorName, title: u.title })) })),
      uses, signins
    };
  }

  async function signin(id) {
    const servers = (((deps.config.connectors || {}).mcp || {}).config || {}).servers || [];
    const s = servers.find(x => x && x.id === id);
    if (!s) fail('not_found', `There is no MCP server "${id}" in Settings, MCP servers.`);
    if (s.auth !== 'oauth') fail('bad_request', `${s.name} is set to use a token. Set How it signs in to Sign in (OAuth) first.`);
    if (!storeName(platform)) fail('unavailable', `Workshop has no secret store on ${platform}.`);
    let secret = SECRET_NAME.test(String(s.tokenSecret || '')) ? s.tokenSecret : null;
    if (!secret) {
      // Name its sign-in key for the person, so there is nothing to fill in first.
      secret = freeName(`${id}-signin`, new Set(Object.keys(readIndex(deps.home))));
      await deps.commitConfig(() => { const t = deps.config.connectors.mcp.config.servers.find(x => x && x.id === id); t.tokenSecret = secret; });
      await deps.connectors.configChanged('mcp');
    }
    const r = await deps.connectors.call('mcp', 'signin.begin', { args: { server: id, redirect: `${deps.ownOrigin()}/oauth/callback` }, confirm: true });
    for (const [k, p] of pending) if (Date.now() - p.at > PENDING_MS) pending.delete(k);
    pending.set(r.state, { id, secret, name: s.name, at: Date.now() });
    return { url: r.url, host: r.host };
  }

  async function signout(id) {
    const servers = (((deps.config.connectors || {}).mcp || {}).config || {}).servers || [];
    const s = servers.find(x => x && x.id === id);
    if (!s) fail('not_found', `There is no MCP server "${id}" in Settings, MCP servers.`);
    try { fs.rmSync(path.join(deps.dataDirConnectors, 'mcp', OAUTH_FILE(id)), { force: true }); } catch { /* gone */ }
    if (SECRET_NAME.test(String(s.tokenSecret || ''))) { await remove(deps.home, s.tokenSecret); await changed(s.tokenSecret); }
    log.for('secrets').info(`Signed out of the MCP server ${id} from Settings.`);
    return { ok: true };
  }

  const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font:16px system-ui;margin:3em;max-width:36em">${body}</body>`;

  async function callback(res, url) {
    const q = Object.fromEntries(url.searchParams);
    const p = typeof q.state === 'string' ? pending.get(q.state) : undefined;
    if (!p || Date.now() - p.at > PENDING_MS) { sendHtml(res, 400, page('Workshop', '<p>This sign-in is not one Workshop started, or it took longer than 10 minutes. Start it again from Settings, Tokens &amp; sign-ins.</p>')); return; }
    pending.delete(q.state);
    if (q.error || !q.code) { sendHtml(res, 400, page('Workshop', `<p>Sign-in to ${escapeHtml(p.name)} did not go through: ${escapeHtml(String(q.error_description || q.error || 'no code').slice(0, 200))}. Nothing was saved.</p>`)); return; }
    try {
      const key = crypto.randomBytes(32).toString('base64');
      log.addSecret(key);
      const saved = await save(deps.home, p.secret, key, { note: `Sign-in key for the MCP server ${p.name}` });
      if (!saved.ok) throw new Error(saved.message);
      deps.secretsRead.forget?.(p.secret);
      await deps.connectors.call('mcp', 'signin.finish', { args: { state: q.state, code: String(q.code).slice(0, 4096), key }, confirm: true });
      log.for('secrets').info(`Signed in to the MCP server ${p.id} from Settings.`);
      deps.events.send('config', { changed: ['secrets'] });
      sendHtml(res, 200, page('Workshop', `<p>Signed in to ${escapeHtml(p.name)}. You can close this tab and go back to Workshop.</p><script>try{window.opener&&window.opener.postMessage({workshop:'signed-in'},'*')}catch(e){}setTimeout(()=>window.close(),1500)</script>`));
    } catch (e) {
      sendHtml(res, 500, page('Workshop', `<p>Sign-in to ${escapeHtml(p.name)} did not finish: ${escapeHtml((e && e.message) || 'unknown error')}. Nothing was saved. Try again from Settings.</p>`));
    }
  }

  /** Handles /api/secrets, /api/signin, /api/signout. Returns true when it answered. */
  async function api(req, parts, { own, ok }) {
    const m = req.method;
    const local = what => { if (!own) fail('local_only', `${what} from Workshop on this computer.`); };
    if (parts[0] === 'secrets') {
      if (parts.length === 1 && m === 'GET') { ok(list()); return true; }
      if (parts.length === 1 && m === 'POST') {
        local('Save tokens');
        const b = await readJsonBody(req, 128 * 1024);
        if (!b || typeof b !== 'object') fail('bad_request', 'Send {"name": ..., "kind": ..., "value": ...}.');
        const kind = KINDS.includes(b.kind) ? b.kind : 'token';
        let name = typeof b.name === 'string' ? b.name.trim() : '';
        if (typeof b.env === 'string' && b.env) { name = envSecretName(b.env) || ''; if (!name) fail('bad_request', `"${b.env}" is not a variable name Workshop can save a token for.`); }
        if (!SECRET_NAME.test(name)) fail('bad_request', 'Give it a name: lowercase letters, digits and -, for example github.');
        const expires = typeof b.expires === 'string' && DATE.test(b.expires) ? b.expires : null;
        const r = await store(name, kind, b.value, { expires, note: typeof b.note === 'string' ? b.note.slice(0, 200) : '' });
        if (!r.ok) throw new HttpError('bad_request', `${r.message} Nothing was saved.`);
        ok({ ok: true, name, secret: secretStatus(readIndex(deps.home), name) });
        return true;
      }
      if (parts.length === 2 && m === 'DELETE') {
        local('Remove tokens');
        const name = parts[1];
        if (!SECRET_NAME.test(name)) fail('bad_request', `"${name}" is not a valid secret name.`);
        const r = await remove(deps.home, name);
        if (!r.ok) fail('internal', r.message);
        log.for('secrets').info(`Removed ${name} from ${storeName(platform)} from Settings.`);
        await changed(name);
        ok({ ok: true, message: r.message });
        return true;
      }
      fail('method_not_allowed', 'Use GET or POST /api/secrets, or DELETE /api/secrets/<name>.');
    }
    if ((parts[0] === 'signin' || parts[0] === 'signout') && parts[1] === 'mcp' && parts.length === 3) {
      if (m !== 'POST') fail('method_not_allowed', 'Use POST.');
      local(parts[0] === 'signin' ? 'Sign in' : 'Sign out');
      if (!SECRET_NAME.test(parts[2])) fail('bad_request', `"${parts[2]}" is not a valid server id.`);
      ok(parts[0] === 'signin' ? await signin(parts[2]) : await signout(parts[2]));
      return true;
    }
    return false;
  }

  return { api, callback, moveOut, list, store };
}

// ADO REST client. Node standard library only. Calls only the server URL from the connection config.
// The PAT goes into the Authorization header and nowhere else: never into messages, logs or results.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { pyQuote } from './util.mjs';

/** A problem talking to ADO. `upstream` is the HTTP status ADO answered with, if any. */
export class AdoError extends Error {
  constructor(message, upstream = null) {
    super(message);
    this.name = 'AdoError';
    this.upstream = upstream;
    this.status = upstream === 404 ? 404 : 503;
    this.code = upstream === 404 ? 'not_found' : 'unavailable';
  }
}

/** A problem with the request or the settings, not with ADO. */
export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsError';
    this.status = 400;
    this.code = 'bad_request';
  }
}

let systemCa = null;
/** Bundled CAs, NODE_EXTRA_CA_CERTS and the operating system's store, like Python's default SSL context. */
function caList() {
  if (systemCa === null) {
    try {
      systemCa = typeof tls.getCACertificates === 'function'
        ? [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]
        : false;
    } catch {
      systemCa = false;
    }
  }
  return systemCa || undefined;
}

const TIMEOUT_MS = 45000;

/**
 * A client for one connection. `env(name)` returns an environment variable (ctx.env in the agent).
 * The PAT is read here and kept only inside the client.
 */
export function clientFor(conn, env, signal) {
  let pat;
  try {
    pat = String(env(conn.patEnv) || '').trim();
  } catch {
    throw new SettingsError(`Connection "${conn.name}" names an environment variable Workshop cannot read. Check its PAT setting.`);
  }
  if (!pat) {
    throw new AdoError(`Environment variable ${conn.patEnv} is empty or missing. If you just set it, start Workshop again from a new terminal window.`);
  }
  return new Ado({ base: conn.base, pat, apiVersion: conn.apiVersion, verifyTls: conn.verifyTls, useSystemCa: conn.useSystemCa, signal });
}

export class Ado {
  /**
   * @param {object} o
   * @param {string} o.base collection URL, for example https://ado.example.com/Main
   * @param {string} o.pat the personal access token
   * @param {string} [o.apiVersion]
   * @param {boolean} [o.verifyTls]
   * @param {boolean} [o.useSystemCa]
   * @param {AbortSignal} [o.signal]
   */
  constructor(o) {
    this.o = o;
    this.base = String(o.base || '').replace(/\/+$/, '');
    if (!this.base) throw new SettingsError('No ADO server URL is set for this connection.');
    if (!o.pat) throw new AdoError('No PAT for this connection.');
    this.auth = 'Basic ' + Buffer.from(':' + o.pat).toString('base64');
  }

  /** The same client pointed at another base URL (for example the server root). */
  at(base) {
    return new Ado({ ...this.o, base });
  }

  async call(method, path, { body, query, project, api } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) q.append(k, String(v));
    q.append('api-version', api || this.o.apiVersion || '6.0');
    const scope = project ? `${this.base}/${pyQuote(project)}` : this.base;
    const url = `${scope}/_apis/${path}?${q.toString()}`;
    const res = await this.request(method, url, body);
    if (res.status >= 200 && res.status < 300) {
      const type = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw new AdoError('ADO answered with a sign-in page instead of data. Check the URL and that the PAT is valid.');
      try {
        return JSON.parse(res.text);
      } catch {
        throw new AdoError('ADO answered with data Workshop could not read.');
      }
    }
    if (res.status >= 300 && res.status < 400) {
      throw new AdoError('ADO answered with a sign-in page instead of data. Check the URL and that the PAT is valid.');
    }
    if (res.status === 401 || res.status === 403) {
      const need = url.includes('/git/') ? 'Code (Read)' : url.includes('/teams') ? 'Project and Team (Read)' : 'Work Items (Read)';
      throw new AdoError(`ADO rejected the PAT (HTTP ${res.status}) for ${this.base}. It may be expired or missing the ${need} scope.`, res.status);
    }
    if (res.status === 404) {
      throw new AdoError(`ADO URL not found (HTTP 404): ${url.split('?')[0]}. Check the collection URL and project name.`, 404);
    }
    let detail = '';
    try {
      detail = JSON.parse(res.text).message || '';
    } catch { /* not JSON */ }
    throw new AdoError(`ADO error HTTP ${res.status}. ${detail}`.trim(), res.status);
  }

  request(method, url, body) {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!lib) return Promise.reject(new SettingsError('The ADO server URL must start with https:// or http://.'));
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = String(data.length);
    const options = { method, headers, signal: this.o.signal };
    if (lib === https) {
      options.rejectUnauthorized = this.o.verifyTls !== false;
      if (this.o.useSystemCa !== false) {
        const ca = caList();
        if (ca) options.ca = ca;
      }
    }
    return new Promise((resolve, reject) => {
      const req = lib.request(u, options, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', e => reject(this.unreachable(e)));
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
      req.on('error', e => reject(this.unreachable(e)));
      if (data) req.write(data);
      req.end();
    });
  }

  unreachable(e) {
    if (e && e.name === 'AbortError') return new AdoError('The request to ADO was stopped because the connector stopped.');
    const reason = (e && (e.code || e.message)) || 'unknown error';
    return new AdoError(`Could not reach ADO at ${this.base}. Are you on VPN? (${reason})`);
  }

  async wiql(where) {
    const query = `SELECT [System.Id] FROM WorkItems WHERE ${where} ORDER BY [System.ChangedDate] DESC`;
    const res = await this.call('POST', 'wit/wiql', { body: { query } });
    return (res.workItems || []).map(w => w.id);
  }

  /** Work items by id, as a Map id -> item. Missing ids are left out. */
  async details(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const res = await this.call('POST', 'wit/workitemsbatch', { body: { ids: chunk, $expand: 'Links', errorPolicy: 'omit' } });
      for (const w of res.value || []) if (w && w.id) out.set(w.id, w);
    }
    return out;
  }
}

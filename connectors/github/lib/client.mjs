// A small GitHub REST and GraphQL client. Node standard library only (fetch). The token is read from the
// environment variable a connection names, kept only inside the client, and sent only in the Authorization header.
import { shortSource, sourceLabel, tokenHint } from './token.mjs';

/** A problem talking to GitHub. `upstream` is the HTTP status GitHub answered with, if any. */
export class GhError extends Error {
  constructor(message, upstream = null) {
    super(message);
    this.name = 'GhError';
    this.upstream = upstream;
    this.status = upstream === 404 ? 404 : 503;
    this.code = upstream === 404 ? 'not_found' : 'unavailable';
  }
}

/** A write GitHub would apply over a newer change: the issue changed since the caller read it (`rev`). */
export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
    this.code = 'conflict';
  }
}

/** A settings or argument problem the person can fix. */
export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsError';
    this.status = 400;
    this.code = 'bad_request';
  }
}

const VERSION = '2022-11-28';

/** The token for a connection, or a plain-words error. */
export function clientFor(conn, env, signal) {
  let token;
  try {
    token = String(env(conn.tokenEnv) || '').trim();
  } catch {
    throw new SettingsError(`Connection "${conn.name}" names an environment variable Workshop cannot read. Check its token setting.`);
  }
  if (!token) throw new GhError(`${sourceLabel(conn.tokenEnv)} is empty or missing. ${tokenHint(conn.tokenEnv)}`);
  return new GitHub({ conn, token, onAuth: env.onAuth, signal, fetchImpl: env.fetch });
}

export class GitHub {
  constructor({ conn, token, onAuth, signal, fetchImpl }) {
    this.conn = conn;
    this.api = conn.apiUrl;
    this.web = conn.webUrl;
    this.graphqlUrl = conn.graphqlUrl;
    this.token = token;
    this.onAuth = onAuth;
    this.signal = signal;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  async request(method, url, body) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': VERSION,
      'User-Agent': 'Workshop'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await this.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: this.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new GhError('The request to GitHub was stopped.');
      throw new GhError(`Could not reach GitHub at ${new URL(this.api).host}. Check your network and the API URL.`);
    }
    const expires = res.headers.get('github-authentication-token-expiration');
    if (expires) { try { this.onAuth?.expires?.(this.conn.tokenEnv, expires); } catch { /* status only */ } }
    const text = await res.text();
    if (res.status >= 200 && res.status < 300) {
      try { this.onAuth?.ok?.(this.conn.tokenEnv); } catch { /* status only */ }
      if (!text) return { data: null, headers: res.headers };
      try { return { data: JSON.parse(text), headers: res.headers }; } catch { throw new GhError('GitHub answered with data Workshop could not read.'); }
    }
    let detail = '';
    try { detail = JSON.parse(text).message || ''; } catch { /* not JSON */ }
    if (res.status === 401) {
      try { this.onAuth?.rejected?.(this.conn.tokenEnv, 401); } catch { /* status only */ }
      throw new GhError(`GitHub rejected the token in ${shortSource(this.conn.tokenEnv)} (HTTP 401). It may have expired or been revoked. If you made a new one, ${tokenHint(this.conn.tokenEnv).replace(/^Save/, 'save').replace(/^Set/, 'set')}.`, 401);
    }
    if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(detail))) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const when = reset > 0 ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ' Try again in a few minutes.';
      throw new GhError(`GitHub's rate limit was reached.${when}`, res.status);
    }
    if (res.status === 403) throw new GhError(`GitHub refused this (HTTP 403). The token in ${shortSource(this.conn.tokenEnv)} may be missing a permission. ${detail}`.trim(), 403);
    if (res.status === 404 || res.status === 410) throw new GhError('Not found on GitHub, or the token cannot see it (HTTP 404).', 404);
    throw new GhError(`GitHub error HTTP ${res.status}. ${detail}`.trim(), res.status);
  }

  /** GET or other REST call. `path` starts with /. Returns the parsed body. */
  async rest(method, path, { query, body } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) q.append(k, String(v));
    const url = `${this.api}${path}${q.toString() ? `?${q}` : ''}`;
    return (await this.request(method, url, body)).data;
  }

  /** Every page of a list endpoint, up to `max` rows. */
  async pages(path, query = {}, max = 1000) {
    const out = [];
    for (let page = 1; out.length < max && page <= 20; page++) {
      const rows = await this.rest('GET', path, { query: { ...query, per_page: 100, page } });
      if (!Array.isArray(rows)) break;
      out.push(...rows);
      if (rows.length < 100) break;
    }
    return out.slice(0, max);
  }

  /** A GraphQL query. Errors in the answer become a GhError unless `partial` is set (then data is returned). */
  async graphql(query, variables = {}, { partial = false } = {}) {
    const res = (await this.request('POST', this.graphqlUrl, { query, variables })).data || {};
    if (Array.isArray(res.errors) && res.errors.length && !(partial && res.data)) {
      const msg = String(res.errors[0].message || 'GraphQL error');
      throw new GhError(`GitHub could not answer: ${msg}`, res.errors[0].type === 'NOT_FOUND' ? 404 : null);
    }
    return res.data || {};
  }

  /** The signed-in login, cached on this client. */
  async me() {
    if (!this._me) {
      const u = await this.rest('GET', '/user');
      this._me = String(u?.login || '');
      if (!this._me) throw new GhError('Could not tell who you are on GitHub.');
    }
    return this._me;
  }
}

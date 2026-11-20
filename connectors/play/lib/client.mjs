// A small Google Play Developer API (androidpublisher v3) client. Node standard library only (fetch, crypto). The
// service account key comes from ctx.secret (this computer's secret store), lives only inside one client, and is
// used only to sign the request for an access token at the token address in the settings. The access token goes
// only in the Authorization header to the API address in the settings.
import crypto from 'node:crypto';
import { DEFAULT_TOKEN_URL, KeyError, parseKey, signedAssertion } from './key.mjs';

export const DEFAULT_API = 'https://androidpublisher.googleapis.com';

/** A problem talking to Google. `upstream` is the HTTP status Google answered with, if any. */
export class PlayError extends Error {
  constructor(message, upstream = null) {
    super(message);
    this.name = 'PlayError';
    this.upstream = upstream;
    this.status = upstream === 404 ? 404 : upstream === 409 ? 409 : 503;
    this.code = upstream === 404 ? 'not_found' : upstream === 409 ? 'conflict' : 'unavailable';
  }
}

/** A settings or argument problem the person (or the agent) can fix. */
export class SettingsError extends Error {
  constructor(message, code = 'bad_request') {
    super(message);
    this.name = 'SettingsError';
    this.status = code === 'disabled' ? 503 : code === 'forbidden' ? 403 : 400;
    this.code = code;
  }
}

// Access tokens by service account, key and token address, good for an hour. In memory only.
const tokens = new Map();
export function clearTokens() { tokens.clear(); }

/** A client for this ctx: reads the key from the secret store, or explains how to save it. */
export async function clientFor(ctx, { fetchImpl, now } = {}) {
  const name = ctx.config.keySecret;
  let value;
  try { value = await ctx.secret(name); } catch { throw new SettingsError('The service account key setting names a secret Workshop cannot read. Check it in Settings, Google Play.'); }
  if (!value) throw new PlayError(`No service account key saved as "${name}". In a terminal run: workshop secret set ${name} --from-file <key.json>`);
  let key;
  try { key = parseKey(value); } catch (e) { throw new PlayError(e instanceof KeyError ? e.message : 'The saved service account key cannot be read.'); }
  return new Play({ api: ctx.config.apiUrl || DEFAULT_API, tokenUrl: ctx.config.tokenUrl || DEFAULT_TOKEN_URL, key, secretName: name, signal: ctx.signal, fetchImpl, now });
}

const hostOf = u => { try { return new URL(u).host; } catch { return u; } };

/** Google's error message and reason from a JSON error body, without the noise. */
function googleError(j) {
  const e = j && j.error;
  if (!e) return { message: '', reason: '' };
  if (typeof e === 'string') return { message: String(j.error_description || e), reason: e };
  const reason = (Array.isArray(e.details) && e.details.map(d => d && d.reason).find(Boolean)) || (Array.isArray(e.errors) && e.errors.map(d => d && d.reason).find(Boolean)) || e.status || '';
  return { message: String(e.message || ''), reason: String(reason) };
}

/** The plain-words error for an API answer that was not a success. */
export function explain(status, message, reason, secretName) {
  const m = String(message || '').trim();
  if (/Only releases with status draft may be created on draft app/i.test(m)) return new PlayError('Play only takes draft releases for this app until its first release is reviewed and published. Ask for it again with status "draft", then send it for review in Play Console (Publishing overview).', 400);
  if (/changesNotSentForReview/i.test(m)) return Object.assign(new PlayError('Play wants these changes sent for review by hand in Play Console.', 400), { needsManualReview: true });
  if (/CHANGES_ALREADY_IN_REVIEW|already have changes in review/i.test(`${reason} ${m}`)) return new PlayError('This app already has changes in review on Play. Workshop never cancels a review: wait for it to finish (or cancel it yourself in Play Console), then try again.', 409);
  if (/(API has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured)/i.test(`${reason} ${m}`)) return new PlayError('The Google Play Android Developer API is not turned on in the service account\'s Google Cloud project. Turn it on (APIs & Services, Library, "Google Play Android Developer API"), wait a few minutes, and try again.', 403);
  if (status === 401) return new PlayError(`Google did not accept the sign-in made from the key saved as "${secretName}" (HTTP 401). Make a new JSON key, then run: workshop secret set ${secretName} --from-file <key.json>`, 401);
  if (status === 403) return new PlayError(`Play refused this (HTTP 403): the service account is missing a permission for this app. In Play Console, Users and permissions, give it the app and the permission. ${m}`.trim(), 403);
  if (status === 404 && /package not found|applicationNotFound|No application was found/i.test(`${reason} ${m}`)) return new PlayError('Play does not know this package, or the service account cannot see it. Create the app in Play Console, upload its first bundle there by hand, and give the service account access to it (Users and permissions).', 404);
  if (status === 404) return new PlayError(`Not found on Google Play (HTTP 404). ${m}`.trim(), 404);
  if (status === 429) return new PlayError('Google Play\'s rate limit was reached. Try again in a few minutes.', 429);
  return new PlayError(`Google Play error HTTP ${status}. ${m}`.trim(), status);
}

export class Play {
  constructor({ api, tokenUrl, key, secretName, signal, fetchImpl, now }) {
    this.api = String(api).replace(/\/+$/, '');
    this.tokenUrl = tokenUrl;
    this.key = key;
    this.email = key.email;
    this.secretName = secretName;
    this.signal = signal;
    this.fetch = fetchImpl || globalThis.fetch;
    this.now = now || (() => Date.now());
    // Which key this is, so a newly saved key gets its own token at once.
    this.keyTag = crypto.createHash('sha256').update(key.key.export({ type: 'pkcs8', format: 'der' })).digest('hex').slice(0, 16);
  }

  #cacheKey() { return `${this.email}\n${this.tokenUrl}\n${this.keyTag}`; }

  /** An access token: from the cache while it has more than a minute left, else a new one from Google. */
  async token({ fresh = false } = {}) {
    const k = this.#cacheKey();
    const hit = tokens.get(k);
    if (!fresh && hit && hit.until - this.now() > 60_000) return hit.token;
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(this.key, { tokenUrl: this.tokenUrl, now: this.now() }) }).toString();
    let res;
    try {
      res = await this.fetch(this.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'Workshop' }, body, signal: this.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new PlayError('The request to Google was stopped.');
      throw new PlayError(`Could not reach Google at ${hostOf(this.tokenUrl)}. Check your network.`);
    }
    let j = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    if (res.status === 200 && j && typeof j.access_token === 'string') {
      const ttl = Math.max(60, Math.min(Number(j.expires_in) || 3600, 3600));
      tokens.set(k, { token: j.access_token, until: this.now() + ttl * 1000 });
      return j.access_token;
    }
    tokens.delete(k);
    const { message, reason } = googleError(j);
    if (reason === 'invalid_grant' || /invalid_grant|Invalid JWT/i.test(message)) throw new PlayError(`Google refused the service account key saved as "${this.secretName}" (${message || 'invalid_grant'}). It may have been deleted or disabled in Google Cloud, or this computer's clock is off. Make a new JSON key, then run: workshop secret set ${this.secretName} --from-file <key.json>`, 401);
    throw new PlayError(`Google did not give Workshop an access token (HTTP ${res.status}). ${message}`.trim(), res.status);
  }

  /**
   * One call to the API. `path` starts with /applications/... (the /androidpublisher/v3 prefix is added, or
   * /upload/androidpublisher/v3 with `upload`). Returns the JSON answer. A 401 gets one more try with a new token.
   */
  async request(method, path, { query = null, body, raw = null, contentType = null, upload = false } = {}, retried = false) {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const url = `${this.api}${upload ? '/upload' : ''}/androidpublisher/v3${path}${qs}`;
    const headers = { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json', 'User-Agent': 'Workshop' };
    let payload;
    if (raw) { headers['Content-Type'] = contentType || 'application/octet-stream'; payload = raw; }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try { res = await this.fetch(url, { method, headers, body: payload, signal: this.signal }); }
    catch (e) {
      if (e && e.name === 'AbortError') throw new PlayError('The request to Google Play was stopped.');
      throw new PlayError(`Could not reach Google Play at ${hostOf(this.api)}. Check your network.`);
    }
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (res.status >= 200 && res.status < 300) return j || {};
    if (res.status === 401 && !retried) { tokens.delete(this.#cacheKey()); return this.request(method, path, { query, body, raw, contentType, upload }, true); }
    const { message, reason } = googleError(j);
    throw explain(res.status, message, reason, this.secretName);
  }

  get(path, query) { return this.request('GET', path, { query }); }

  /** Runs fn(editId) inside a new edit. Without `commit` the edit is always deleted (reads change nothing). */
  async withEdit(pkg, fn, { commit = null } = {}) {
    const app = `/applications/${encodeURIComponent(pkg)}`;
    const edit = await this.request('POST', `${app}/edits`, { body: {} });
    if (!edit || !edit.id) throw new PlayError('Google Play did not open an edit.');
    let done = false;
    try {
      const out = await fn(edit.id, `${app}/edits/${encodeURIComponent(edit.id)}`);
      if (commit) { const c = await commit(edit.id, `${app}/edits/${encodeURIComponent(edit.id)}`); done = true; return { out, commit: c }; }
      return { out };
    } finally {
      if (!done) { try { await this.request('DELETE', `${app}/edits/${encodeURIComponent(edit.id)}`); } catch { /* it expires on its own */ } }
    }
  }
}

// A small Cloudflare API v4 client. Node standard library only (fetch). The token comes from ctx.secret (the
// secret store on this computer, never an environment variable or a file), lives only inside one client, and is
// sent only in the Authorization header to the API address in the settings.

/** A problem talking to Cloudflare. `upstream` is the HTTP status Cloudflare answered with, if any. */
export class CfError extends Error {
  constructor(message, upstream = null) {
    super(message);
    this.name = 'CfError';
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

export const DEFAULT_API = 'https://api.cloudflare.com/client/v4';

/** A client for this ctx: reads the token from the secret store, or explains how to save it. */
export async function clientFor(ctx, { fetchImpl } = {}) {
  const name = ctx.config.tokenSecret;
  let token;
  try { token = await ctx.secret(name); } catch { throw new SettingsError('The API token setting names a secret Workshop cannot read. Check it in Settings.'); }
  if (!token) throw new CfError(`No Cloudflare token saved as "${name}". In a terminal run: workshop secret set ${name} --expires YYYY-MM-DD`);
  return new Cloudflare({ api: ctx.config.apiUrl || DEFAULT_API, token, account: ctx.config.accountId, secretName: name, signal: ctx.signal, fetchImpl });
}

export class Cloudflare {
  constructor({ api, token, account, secretName, signal, fetchImpl }) {
    this.api = String(api).replace(/\/+$/, '');
    this.token = token;
    this.account = account;
    this.secretName = secretName;
    this.signal = signal;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  /** The account-scoped path for `rest` (no leading slash): accounts/<id>/<rest>. */
  acct(rest) { return `/accounts/${encodeURIComponent(this.account)}/${rest}`; }

  /** One call. Returns Cloudflare's `result` (and `result_info` as `info`). Throws CfError in plain words. */
  async request(method, pathAndQuery, body) {
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'User-Agent': 'Workshop' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await this.fetch(this.api + pathAndQuery, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: this.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new CfError('The request to Cloudflare was stopped.');
      throw new CfError(`Could not reach Cloudflare at ${new URL(this.api).host}. Check your network.`);
    }
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (res.status >= 200 && res.status < 300 && (!j || j.success !== false)) return { result: j ? j.result : null, info: j ? j.result_info || null : null };
    const detail = j && Array.isArray(j.errors) && j.errors.length ? j.errors.map(e => (e && e.message) || '').filter(Boolean).join('; ') : '';
    if (res.status === 401) throw new CfError(`Cloudflare rejected the token saved as "${this.secretName}" (HTTP 401). It may have expired or been revoked. Make a new one, then run: workshop secret set ${this.secretName}`, 401);
    if (res.status === 403) throw new CfError(`Cloudflare refused this (HTTP 403): the token is missing a permission for it. ${detail}`.trim(), 403);
    if (res.status === 429) throw new CfError('Cloudflare\'s rate limit was reached. Try again in a few minutes.', 429);
    if (res.status === 404) throw new CfError(`Not found on Cloudflare (HTTP 404). ${detail}`.trim(), 404);
    throw new CfError(`Cloudflare error HTTP ${res.status}. ${detail}`.trim(), res.status);
  }

  get(p) { return this.request('GET', p).then(r => r.result); }

  /** Every page of a list (page/per_page paging), up to `max` items. */
  async all(p, { perPage = 50, max = 1000 } = {}) {
    const out = [];
    for (let page = 1; page <= 50 && out.length < max; page += 1) {
      const sep = p.includes('?') ? '&' : '?';
      const { result, info } = await this.request('GET', `${p}${sep}page=${page}&per_page=${perPage}`);
      const items = Array.isArray(result) ? result : [];
      out.push(...items);
      const pages = info && Number(info.total_pages);
      if (!items.length || (pages && page >= pages) || (!pages && items.length < perPage)) break;
    }
    return out.slice(0, max);
  }
}

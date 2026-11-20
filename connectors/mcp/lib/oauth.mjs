// MCP sign-in with OAuth (connector 1.1.0, README.md, Sign in): for servers that only offer OAuth sign-in, not a
// token. Node standard library only. Used by `workshop mcp login <id>` (the sign-in itself, in your browser) and by
// the connector (sending the access token, and refreshing it when it runs out).
//
// The flow follows the MCP authorization spec: the server's protected resource metadata (RFC 9728) names its
// authorization server; that server's metadata (RFC 8414, or OpenID discovery) gives its endpoints; Workshop
// registers itself as a public client (RFC 7591, dynamic client registration) with a loopback redirect, and signs in
// with the authorization code flow and PKCE (S256), naming the server as the resource (RFC 8707).
//
// Where the tokens live: Workshop's agent only ever reads this computer's secret store (docs/security.md), and the
// tokens change every time they are refreshed. So `workshop mcp login` saves a random key in the secret store (under
// the server's Token secret name), and the tokens go in the connector's storage encrypted with it (AES-256-GCM,
// <home>/data/_connectors/mcp/oauth-<id>.json). Neither alone is enough; the file never holds a token in the clear.

import crypto from 'node:crypto';

export const SKEW_MS = 60 * 1000;
export const storageKey = id => `oauth-${id}`;

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class OAuthError extends Error {
  constructor(message, code = 'unavailable') { super(message); this.name = 'OAuthError'; this.code = code; this.status = code === 'unauthorized' ? 401 : 503; }
}

/** PKCE: a verifier and its S256 challenge. */
export function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

/** The resource metadata address named in a 401's WWW-Authenticate header, or null. */
export function resourceMetadataUrl(header) {
  const m = /resource_metadata\s*=\s*"([^"]+)"/i.exec(String(header || ''));
  return m ? m[1] : null;
}

async function getJson(fetchImpl, url) {
  let res;
  try { res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Workshop' } }); } catch { return null; }
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/**
 * Where to sign in for an MCP server: {resource, issuer, authorization_endpoint, token_endpoint, registration_endpoint,
 * scopes}. Asks the server first (an initialize with no token should answer 401 naming its metadata), then the
 * well-known addresses, and for servers with no resource metadata falls back to the server's own origin.
 */
export async function discover(serverUrl, fetchImpl = globalThis.fetch) {
  const url = new URL(serverUrl);
  let metaUrl = null;
  try {
    const r = await fetchImpl(serverUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'Workshop' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Workshop', version: '1' } } }) });
    if (r.status === 401) metaUrl = resourceMetadataUrl(r.headers.get('www-authenticate'));
    await r.text().catch(() => '');
  } catch { throw new OAuthError(`Could not reach ${url.host}.`); }
  const path = url.pathname.replace(/\/$/, '');
  const tries = [metaUrl, `${url.origin}/.well-known/oauth-protected-resource${path}`, `${url.origin}/.well-known/oauth-protected-resource`].filter(Boolean);
  let resourceMeta = null;
  for (const t of tries) { resourceMeta = await getJson(fetchImpl, t); if (resourceMeta) break; }
  const issuer = (resourceMeta && Array.isArray(resourceMeta.authorization_servers) && resourceMeta.authorization_servers[0]) || url.origin;
  const iss = new URL(issuer);
  const ipath = iss.pathname.replace(/\/$/, '');
  let as = null;
  for (const t of [`${iss.origin}/.well-known/oauth-authorization-server${ipath}`, `${iss.origin}/.well-known/openid-configuration${ipath}`, `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`]) {
    as = await getJson(fetchImpl, t);
    if (as && as.authorization_endpoint && as.token_endpoint) break;
    as = null;
  }
  if (!as) throw new OAuthError(`${url.host} does not say how to sign in (no OAuth metadata). Use a token instead.`);
  if (Array.isArray(as.code_challenge_methods_supported) && !as.code_challenge_methods_supported.includes('S256')) throw new OAuthError(`${iss.host} does not support PKCE (S256), which Workshop needs to sign in safely.`);
  for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (as[k] && !/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(as[k])) throw new OAuthError(`${iss.host} names a sign-in address that is not https: ${as[k]}`);
  }
  const resource = (resourceMeta && resourceMeta.resource) || serverUrl;
  const scopes = (resourceMeta && Array.isArray(resourceMeta.scopes_supported) && resourceMeta.scopes_supported) || (Array.isArray(as.scopes_supported) ? as.scopes_supported : []);
  return { resource, issuer, authorization_endpoint: as.authorization_endpoint, token_endpoint: as.token_endpoint, registration_endpoint: as.registration_endpoint || null, scopes: scopes.slice(0, 20) };
}

/** Registers Workshop as a public client with this redirect: {client_id, client_secret?}. */
export async function register(meta, redirectUri, fetchImpl = globalThis.fetch) {
  if (!meta.registration_endpoint) throw new OAuthError(`${new URL(meta.issuer).host} does not let apps register themselves. Use a token instead.`);
  let res;
  try {
    res = await fetchImpl(meta.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Workshop' },
      body: JSON.stringify({ client_name: 'Workshop', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  } catch { throw new OAuthError(`Could not reach ${new URL(meta.registration_endpoint).host} to register.`); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.client_id) throw new OAuthError(`Registering Workshop failed (HTTP ${res.status}${j && j.error ? `: ${j.error}` : ''}).`);
  return { client_id: j.client_id, ...(j.client_secret ? { client_secret: j.client_secret } : {}) };
}

/** The address to open in the browser. */
export function authorizeUrl(meta, { client_id, redirect_uri, challenge, state, scope }) {
  const u = new URL(meta.authorization_endpoint);
  const q = { response_type: 'code', client_id, redirect_uri, code_challenge: challenge, code_challenge_method: 'S256', state, resource: meta.resource, ...(scope ? { scope } : {}) };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

async function tokenCall(meta, client, form, fetchImpl) {
  const body = new URLSearchParams({ ...form, client_id: client.client_id, resource: meta.resource, ...(client.client_secret ? { client_secret: client.client_secret } : {}) });
  let res;
  try { res = await fetchImpl(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'Workshop' }, body: body.toString() }); }
  catch { throw new OAuthError(`Could not reach ${new URL(meta.token_endpoint).host}.`); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.access_token) {
    const why = j && (j.error_description || j.error);
    throw new OAuthError(`Sign-in was refused${why ? `: ${String(why).slice(0, 200)}` : ` (HTTP ${res.status})`}.`, res.status === 400 || res.status === 401 ? 'unauthorized' : 'unavailable');
  }
  return j;
}
const tokensFrom = (j, was = {}, now = Date.now()) => ({
  access_token: j.access_token,
  refresh_token: j.refresh_token || was.refresh_token || null,
  expires_at: Number(j.expires_in) > 0 ? now + Number(j.expires_in) * 1000 : null,
  scope: j.scope || was.scope || null,
});

/** Trades the code for tokens: the record kept (encrypted) for the connector. */
export async function exchange(meta, client, { code, verifier, redirect_uri }, fetchImpl = globalThis.fetch, now = Date.now()) {
  const j = await tokenCall(meta, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri }, fetchImpl);
  return { v: 1, meta, client, ...tokensFrom(j, {}, now), signedIn: new Date(now).toISOString() };
}

/** A record whose access token runs out within SKEW_MS needs a refresh. */
export const needsRefresh = (rec, now = Date.now()) => !!(rec && rec.expires_at && rec.expires_at - SKEW_MS <= now);

/** A fresh access token from the refresh token: the new record (the refresh token may change too). */
export async function refresh(rec, fetchImpl = globalThis.fetch, now = Date.now()) {
  if (!rec.refresh_token) throw new OAuthError('The sign-in ran out and the server gave no way to renew it.', 'unauthorized');
  const j = await tokenCall(rec.meta, rec.client, { grant_type: 'refresh_token', refresh_token: rec.refresh_token }, fetchImpl);
  return { ...rec, ...tokensFrom(j, rec, now) };
}

/* ---------- the record at rest: AES-256-GCM with the key from the secret store ---------- */

/** A new key for the secret store (base64, 32 bytes). */
export const newKey = () => crypto.randomBytes(32).toString('base64');
function keyBuf(key) {
  const k = Buffer.from(String(key || ''), 'base64');
  if (k.length !== 32) throw new OAuthError('The sign-in key in the secret store is not one Workshop made. Sign in again.', 'unauthorized');
  return k;
}
export function seal(key, rec) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBuf(key), iv);
  const data = Buffer.concat([c.update(JSON.stringify(rec), 'utf8'), c.final()]);
  return { v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function unseal(key, box) {
  if (!box || box.v !== 1 || box.alg !== 'aes-256-gcm') throw new OAuthError('No sign-in saved for this server.', 'unauthorized');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyBuf(key), Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
  } catch (e) {
    if (e instanceof OAuthError) throw e;
    throw new OAuthError('The saved sign-in does not match the key in the secret store. Sign in again.', 'unauthorized');
  }
}

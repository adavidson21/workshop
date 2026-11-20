// The Google service account key, kept small enough for the secret store, and the short-lived access token made
// from it. Node standard library only (crypto for RS256).
//
// Google's key file is JSON with line breaks and spaces, so `workshop secret set play --from-file <key.json>`
// stores only what signing needs, in one line of printable characters:
//
//   gsa1.<client_email, base64url>.<private key as PKCS#8 DER, base64url>
//
// The connector turns that into a signed JWT and trades it at Google's token address for an access token
// (scope androidpublisher, one hour). The key never leaves this computer; only the signed JWT does.
import crypto from 'node:crypto';

export const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PREFIX = 'gsa1';
const EMAIL = /^[a-z0-9][a-z0-9._-]{0,99}@[a-z0-9][a-z0-9.-]{0,199}\.[a-z]{2,}$/i;

const b64u = buf => Buffer.from(buf).toString('base64url');

/** A key problem in plain words. Never includes any part of the key. */
export class KeyError extends Error {
  constructor(message) { super(message); this.name = 'KeyError'; this.status = 400; this.code = 'bad_request'; }
}

/**
 * The stored form of a service account key file's text, and its email. Throws KeyError in plain words for anything
 * that is not a Google service account key with a working RSA private key.
 */
export function compactKey(fileText) {
  let j;
  try { j = JSON.parse(String(fileText).replace(/^﻿/, '')); } catch { throw new KeyError('That file is not JSON. Use the key file Google Cloud downloaded (Service accounts, Keys, Add key, JSON).'); }
  if (!j || typeof j !== 'object') throw new KeyError('That file is not a service account key.');
  if (j.type !== 'service_account') throw new KeyError(`That file is not a service account key (its type is "${String(j.type || 'missing').slice(0, 40)}").`);
  const email = String(j.client_email || '');
  if (!EMAIL.test(email)) throw new KeyError('The key file has no service account email (client_email).');
  let der;
  try { der = crypto.createPrivateKey({ key: String(j.private_key || ''), format: 'pem' }).export({ type: 'pkcs8', format: 'der' }); }
  catch { throw new KeyError('The key file\'s private key cannot be read. Download a new JSON key.'); }
  return { value: `${PREFIX}.${b64u(email)}.${b64u(der)}`, email, keyId: typeof j.private_key_id === 'string' ? j.private_key_id.slice(0, 8) : null };
}

/** {email, key: KeyObject} from the stored form. Throws KeyError when it is not one. */
export function parseKey(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new KeyError('The saved secret is not a service account key. Save it with: workshop secret set play --from-file <key.json>');
  const email = Buffer.from(parts[1], 'base64url').toString('utf8');
  if (!EMAIL.test(email)) throw new KeyError('The saved service account key has no valid email. Save it again with --from-file.');
  try { return { email, key: crypto.createPrivateKey({ key: Buffer.from(parts[2], 'base64url'), format: 'der', type: 'pkcs8' }) }; }
  catch { throw new KeyError('The saved service account key cannot be read. Save it again with: workshop secret set play --from-file <key.json>'); }
}

/** A signed JWT asking Google for an access token (RFC 7523), good for `ttl` seconds (at most an hour). */
export function signedAssertion({ email, key }, { tokenUrl = DEFAULT_TOKEN_URL, now = Date.now(), ttl = 3600 } = {}) {
  const iat = Math.floor(now / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: email, scope: SCOPE, aud: tokenUrl, iat, exp: iat + Math.min(ttl, 3600) }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key);
  return `${head}.${body}.${b64u(sig)}`;
}

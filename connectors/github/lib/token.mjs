// Token health for status(): which tokens are missing, which expire soon, and which GitHub rejected. Never stores
// or returns a token: a rejection keeps only a hash of the value it was seen with, in memory, so a new token clears
// it. The expiry date comes from the "Token expires" setting or, when GitHub sends it, the
// github-authentication-token-expiration header (fine-grained and classic tokens with an expiry).
import crypto from 'node:crypto';

export const WARN_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function tokenHint(name, platform = process.platform) {
  return platform === 'win32'
    ? `Save it with: workshop pat ${name}`
    : `Set ${name} in your shell profile ("workshop pat ${name}" shows how), then run: workshop restart`;
}

/** Days until a YYYY-MM-DD date (the last day the token works). Null when not a real date. */
export function daysLeft(date, now = new Date()) {
  if (!DATE.test(String(date || ''))) return null;
  const [y, m, d] = date.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  const check = new Date(end);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end - today) / DAY);
}

const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');

/** Remembers rejected tokens and the expiry dates GitHub reported, per variable name. */
export function authTracker({ now = () => new Date() } = {}) {
  const rejected = new Map(); // tokenEnv -> {at, fp}
  const expiry = new Map();   // tokenEnv -> YYYY-MM-DD
  let changed = () => {};
  return {
    onChange(fn) { changed = fn; },
    hooks(read) {
      return {
        ok(name) { if (rejected.delete(name)) changed(); },
        rejected(name, status) {
          if (status !== 401) return;
          let v;
          try { v = read(name); } catch { v = undefined; }
          const before = rejected.get(name);
          rejected.set(name, { at: now().toISOString(), fp: hash(v ?? '') });
          if (!before) changed();
        },
        expires(name, header) {
          const d = String(header || '').slice(0, 10);
          if (!DATE.test(d) || expiry.get(name) === d) return;
          expiry.set(name, d);
          changed();
        }
      };
    },
    active(read) {
      const out = [];
      for (const [name, r] of rejected) {
        let v;
        try { v = read(name); } catch { v = undefined; }
        if (hash(v ?? '') === r.fp) out.push({ tokenEnv: name, at: r.at });
        else rejected.delete(name);
      }
      return out;
    },
    expiry(name) { return expiry.get(name) || null; },
    clear() { rejected.clear(); expiry.clear(); }
  };
}

/** The connector's status from its normalized config, the live environment and the tracker. */
export function tokenStatus(cfg, read, tracker, { now = new Date(), platform = process.platform } = {}) {
  const missing = [];
  const expiring = [];
  for (const c of cfg.connections) {
    let v;
    try { v = read(c.tokenEnv); } catch { v = undefined; }
    if (!String(v || '').trim()) { if (!missing.includes(c.tokenEnv)) missing.push(c.tokenEnv); continue; }
    const expires = c.tokenExpires || (tracker && tracker.expiry(c.tokenEnv));
    const days = daysLeft(expires, now);
    if (days !== null && days <= WARN_DAYS && !expiring.some(e => e.tokenEnv === c.tokenEnv)) {
      expiring.push({ tokenEnv: c.tokenEnv, connection: c.name, expires, days });
    }
  }
  const details = {};
  if (missing.length) {
    details.tokensMissing = missing;
    const hint = missing.length === 1 ? ` ${tokenHint(missing[0], platform)}` : ` ${tokenHint('<NAME>', platform)} for each.`;
    return { state: 'error', message: `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.${hint}`, details };
  }
  const rejections = tracker ? tracker.active(read) : [];
  if (expiring.length) details.tokensExpiring = expiring;
  if (rejections.length) details.tokensRejected = rejections;
  const fix = name => tokenHint(name, platform).replace(/^Save/, 'save').replace(/^Set/, 'set');
  let message = null;
  if (rejections.length) {
    const r = rejections[0];
    message = `GitHub rejected the token in ${r.tokenEnv}. It may have expired or been revoked. Make a new one on GitHub, then ${fix(r.tokenEnv)}.`;
  } else if (expiring.length) {
    const e = [...expiring].sort((a, b) => a.days - b.days)[0];
    const when = e.days < 0 ? `expired on ${e.expires}` : e.days === 0 ? 'expires today' : `expires in ${e.days} day${e.days === 1 ? '' : 's'} (${e.expires})`;
    message = `The token in ${e.tokenEnv} ${when}. Make a new one on GitHub and ${fix(e.tokenEnv)}.`;
  }
  return { state: 'ready', message, details };
}

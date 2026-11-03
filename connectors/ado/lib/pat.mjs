// PAT health for status(): which PATs are missing, which expire soon (by the date the user typed in
// Settings), and which ADO rejected. Never stores or returns a PAT: a rejection keeps only a hash of the
// value it was seen with, in memory, so a new PAT clears it.
import crypto from 'node:crypto';

export const WARN_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What to do about a PAT, in plain words, for this computer's platform. */
export function patHint(name, platform = process.platform) {
  return platform === 'win32'
    ? `Save it with: workshop pat ${name}`
    : `Set ${name} in your shell profile ("workshop pat ${name}" shows how), then run: workshop restart`;
}

/**
 * Days until a connection's PAT expires, from its `patExpires` date (the last day it works). Null when no
 * date is set or the date is not real. 0 means it expires today; negative means it has expired.
 */
export function daysLeft(patExpires, now = new Date()) {
  if (!DATE.test(String(patExpires || ''))) return null;
  const [y, m, d] = patExpires.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  const check = new Date(end);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end - today) / DAY);
}

const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');

/** Remembers PATs ADO answered 401 to, until that variable holds a different value or a call succeeds. */
export function authTracker({ now = () => new Date() } = {}) {
  const rejected = new Map(); // patEnv -> {at, fp}
  let changed = () => {};
  return {
    onChange(fn) { changed = fn; },
    /** Hooks for the ADO client (lib/client.mjs). `read(name)` gives the current value. */
    hooks(read) {
      return {
        ok(patEnv) { if (rejected.delete(patEnv)) changed(); },
        rejected(patEnv, status) {
          if (status !== 401) return; // 403 is a missing scope on one call, not a bad PAT
          let v;
          try { v = read(patEnv); } catch { v = undefined; }
          const before = rejected.get(patEnv);
          rejected.set(patEnv, { at: now().toISOString(), fp: hash(v ?? '') });
          if (!before) changed();
        }
      };
    },
    /** Rejections that still apply: the variable holds the same value ADO refused. */
    active(read) {
      const out = [];
      for (const [patEnv, r] of rejected) {
        let v;
        try { v = read(patEnv); } catch { v = undefined; }
        if (hash(v ?? '') === r.fp) out.push({ patEnv, at: r.at });
        else rejected.delete(patEnv);
      }
      return out;
    },
    clear() { rejected.clear(); }
  };
}

/**
 * The connector's status from its normalized config and live environment. `read(name)` returns a variable
 * or throws; `rejections` comes from authTracker().active().
 */
export function patStatus(cfg, read, rejections = [], { now = new Date(), platform = process.platform } = {}) {
  const missing = [];
  const expiring = [];
  for (const c of cfg.connections) {
    let v;
    try { v = read(c.patEnv); } catch { v = undefined; }
    if (!String(v || '').trim()) { if (!missing.includes(c.patEnv)) missing.push(c.patEnv); continue; }
    const days = daysLeft(c.patExpires, now);
    if (days !== null && days <= WARN_DAYS && !expiring.some(e => e.patEnv === c.patEnv)) {
      expiring.push({ patEnv: c.patEnv, connection: c.name, expires: c.patExpires, days });
    }
  }
  const details = {};
  if (missing.length) {
    details.patsMissing = missing;
    const hint = missing.length === 1 ? ` ${patHint(missing[0], platform)}` : ` ${patHint('<NAME>', platform)} for each.`;
    return { state: 'error', message: `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.${hint}`, details };
  }
  if (expiring.length) details.patsExpiring = expiring;
  if (rejections.length) details.patsRejected = rejections;
  let message = null;
  if (rejections.length) {
    const r = rejections[0];
    message = `ADO rejected the PAT in ${r.patEnv}. It may have expired or been revoked. Make a new one in ADO, then ${patHint(r.patEnv, platform).replace(/^Save/, 'save').replace(/^Set/, 'set')}.`;
  } else if (expiring.length) {
    const e = [...expiring].sort((a, b) => a.days - b.days)[0];
    const when = e.days < 0 ? `expired on ${e.expires}` : e.days === 0 ? 'expires today' : `expires in ${e.days} day${e.days === 1 ? '' : 's'} (${e.expires})`;
    message = `The PAT in ${e.patEnv} ${when}. Make a new one in ADO, ${patHint(e.patEnv, platform).replace(/^Save/, 'save').replace(/^Set/, 'set')}, and update "PAT expires" in Settings.`;
  }
  return { state: 'ready', message, details };
}

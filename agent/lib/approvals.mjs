// Approvals (docs/security.md, Approvals): a change an agent asked for waits here until a person approves or
// rejects it in Workshop, unless an always-allow rule covers it.
//
//   <dataDir>/connections/approvals/<id>.json   one request: which connector action, its arguments, who asked,
//                                               when, and what happened. Never removed by Workshop.
//   config.json  approvals.rules                always-allow rules (a security setting, so in config, which only
//                                               Workshop on this computer writes, never the data folder).
//
// What a person reads is worked out from the arguments every time (the connector's describe hook), never from the
// file, and Approve sends back a digest of those arguments: if anything edited the request after it was read, the
// approval is refused. A rule names a connector, an action and, optionally, the scopes it covers (the connector's
// scope hook, for example the Cloudflare zones a change set touches); it covers a request only when every scope
// of the request is in the rule.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ID = /^ap-\d{8}-[0-9a-f]{8}$/;
const RULE_ID = /^r-[0-9a-f]{8}$/;
export const STATUSES = ['waiting', 'approved', 'failed', 'rejected'];

/** A stable JSON text (keys sorted) so the same arguments always give the same digest. */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const digestOf = (connector, action, args) => crypto.createHash('sha256').update(`${connector}\n${action}\n${stable(args)}`).digest('hex');

/** Scopes as a clean, sorted, unique list of short strings. */
export function cleanScopes(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 200)))].sort();
}

/** Whether a rule covers a request for (connector, action, scopes). A rule with no scopes covers every call. */
export function covers(rule, connector, action, scopes) {
  if (!rule || rule.connector !== connector || rule.action !== action) return false;
  const rs = Array.isArray(rule.scopes) ? rule.scopes : [];
  if (!rs.length) return true;
  return scopes.length > 0 && scopes.every(s => rs.includes(s));
}

export class Approvals {
  #dir; #log; #now;
  /**
   * @param {object} o
   * @param {string|null} o.dataDir
   * @param {() => object[]} o.rules the live rules (config.approvals.rules)
   * @param {(fn: (rules: object[]) => object[]) => Promise<void>} o.saveRules changes and saves the rules
   */
  constructor(o) {
    this.#dir = o.dataDir ? path.join(o.dataDir, 'connections', 'approvals') : null;
    this.rules = o.rules;
    this.saveRules = o.saveRules;
    this.#log = o.log;
    this.#now = o.now || (() => new Date());
  }

  #file(id) { return path.join(this.#dir, `${id}.json`); }
  #need() { if (!this.#dir) throw Object.assign(new Error('Workshop has no data folder, so it cannot keep approvals.'), { code: 'unavailable', status: 503 }); }

  #write(req) {
    this.#need();
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.#file(req.id)}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(req, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.#file(req.id));
    return req;
  }

  /** A new request, waiting. */
  create({ connector, action, args, title, by, scopes }) {
    const now = this.#now();
    const req = {
      id: `ap-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`,
      connector, action, args: args ?? {}, title: String(title || '').slice(0, 200), by: by === 'agent' ? 'agent' : 'you',
      scopes: cleanScopes(scopes), requested: now.toISOString(), status: 'waiting'
    };
    return this.#write(req);
  }

  /** One request, or null. A file that is not a request (or names another id) is null. */
  get(id) {
    if (!this.#dir || typeof id !== 'string' || !ID.test(id)) return null;
    try {
      const r = JSON.parse(fs.readFileSync(this.#file(id), 'utf8'));
      return r && r.id === id && STATUSES.includes(r.status) && typeof r.connector === 'string' && typeof r.action === 'string' ? r : null;
    } catch { return null; }
  }

  /** Requests, newest first; `status` filters. */
  list({ status, limit = 100 } = {}) {
    if (!this.#dir) return [];
    let names = [];
    try { names = fs.readdirSync(this.#dir).filter(n => n.endsWith('.json')); } catch { return []; }
    const out = [];
    for (const n of names) { const r = this.get(n.slice(0, -5)); if (r && (!status || r.status === status)) out.push(r); }
    return out.sort((a, b) => String(b.requested).localeCompare(String(a.requested))).slice(0, limit);
  }

  /** How many wait. */
  waiting() { return this.list({ status: 'waiting', limit: 1000 }).length; }

  /** Records what happened to a request (approved, failed or rejected). */
  finish(id, status, extra = {}) {
    const r = this.get(id);
    if (!r) return null;
    return this.#write({ ...r, ...extra, status, decided: this.#now().toISOString() });
  }

  /** The rule that covers a request, or null. */
  match(connector, action, scopes) {
    return (this.rules() || []).find(r => covers(r, connector, action, scopes)) || null;
  }

  /** Adds an always-allow rule (or returns the one that already says the same). */
  async addRule({ connector, action, scopes, label }) {
    const s = cleanScopes(scopes);
    const same = (this.rules() || []).find(r => r.connector === connector && r.action === action && stable(r.scopes || []) === stable(s));
    if (same) return same;
    const rule = { id: `r-${crypto.randomBytes(4).toString('hex')}`, connector, action, scopes: s, label: String(label || '').slice(0, 200), created: this.#now().toISOString() };
    await this.saveRules(rules => [...(rules || []), rule]);
    this.#log?.info(`Always-allow rule added: ${connector} ${action}${s.length ? ` for ${s.join(', ')}` : ''}.`);
    return rule;
  }

  async removeRule(id) {
    if (!RULE_ID.test(String(id))) return false;
    let found = false;
    await this.saveRules(rules => (rules || []).filter(r => { if (r.id === id) { found = true; return false; } return true; }));
    return found;
  }
}

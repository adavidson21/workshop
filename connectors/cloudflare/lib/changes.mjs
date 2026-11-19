// Change sets: the only way anything changes on Cloudflare (README.md, Change sets). An agent (or a person) writes
// a list of changes; Workshop checks each one against the settings (the zones you allow) and describes it in plain
// words; nothing happens until a person clicks Apply in Workshop. There is no way to delete a zone, a Worker or a
// Pages project, and no change can carry a secret value.
import { SettingsError } from './client.mjs';

export const MAX_CHANGES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_ID = /^[0-9a-f]{32}$/i;
const WORKER = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const PROJECT = /^[a-z0-9][a-z0-9-]{0,57}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const VAR = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// Names that hold secrets. Agents never handle secret values: set those in the Cloudflare dashboard yourself.
const SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL)/i;
const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX'];

/** Every kind of change, with the words a person sees. */
export const OPS = {
  'dns.create': 'Add a DNS record',
  'dns.update': 'Change a DNS record',
  'dns.delete': 'Remove a DNS record',
  'workers.domain.attach': 'Serve a Worker on a custom domain',
  'workers.domain.detach': 'Stop serving a Worker on a custom domain',
  'workers.rollback': 'Roll a Worker back to an earlier version',
  'workers.build.retry': 'Run a Worker build again',
  'pages.create': 'Create a Pages project',
  'pages.domain.add': 'Add a custom domain to a Pages project',
  'pages.env.set': 'Set Pages environment variables',
  'pages.rollback': 'Roll a Pages project back to an earlier deployment',
  'pages.retry': 'Run a Pages deployment again'
};

const bad = msg => { throw new SettingsError(msg); };
const str = (v, what, { max = 255, min = 1 } = {}) => {
  if (typeof v !== 'string' || v.trim().length < min) bad(`${what} is missing.`);
  if (v.length > max) bad(`${what} is longer than ${max} characters.`);
  return v.trim();
};
const lowerHost = h => String(h || '').trim().toLowerCase().replace(/\.$/, '');
const isHost = h => h.length <= 253 && h.split('.').length >= 2 && h.split('.').every(l => LABEL.test(l));

/** The allowed zone a host name is in (the longest match), or null. */
export function zoneOf(host, zones) {
  const h = lowerHost(host);
  let best = null;
  for (const z of zones || []) {
    const zone = lowerHost(z);
    if (zone && (h === zone || h.endsWith(`.${zone}`)) && (!best || zone.length > best.length)) best = zone;
  }
  return best;
}

function allowedHost(host, zones, what) {
  const h = lowerHost(str(host, what));
  if (!isHost(h)) bad(`${what} "${host}" is not a host name like app.example.org.`);
  const zone = zoneOf(h, zones);
  if (!zone) bad(`${h} is not in a zone Workshop may change. Add its domain under "Zones Workshop may change" in Settings, Cloudflare, first.`);
  return { host: h, zone };
}

function allowedZone(z, zones) {
  const zone = lowerHost(str(z, 'zone'));
  if (!(zones || []).map(lowerHost).includes(zone)) bad(`${zone} is not one of the zones Workshop may change (Settings, Cloudflare).`);
  return zone;
}

/** A DNS name in full: "@" is the zone itself, "app" is app.<zone>, a full name must be inside the zone. */
export function fullName(name, zone) {
  const n = lowerHost(str(name, 'name'));
  if (n === '@') return zone;
  const full = n === zone || n.endsWith(`.${zone}`) ? n : `${n}.${zone}`;
  // A leading * (wildcard) and labels starting with _ (_dmarc, _acme-challenge) are allowed in DNS names.
  if (!isHost(full.replace(/^\*\./, 'x.').split('.').map(l => l.replace(/^_/, 'x')).join('.'))) bad(`"${name}" is not a valid DNS name.`);
  return full;
}

/**
 * Checks one change against the settings and returns it in full form, or throws SettingsError in plain words.
 * `config` is the connector's config ({zones}).
 */
export function normalize(change, config) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) bad('Each change must be an object with an op.');
  const op = change.op;
  if (!Object.hasOwn(OPS, op)) bad(`"${op}" is not a change Workshop can make. It can: ${Object.keys(OPS).join(', ')}.`);
  const zones = config.zones || [];
  switch (op) {
    case 'dns.create': {
      const zone = allowedZone(change.zone, zones);
      const type = str(change.type, 'type').toUpperCase();
      if (!DNS_TYPES.includes(type)) bad(`DNS type ${type} is not supported here. Use one of ${DNS_TYPES.join(', ')}.`);
      const out = { op, zone, type, name: fullName(change.name, zone), content: str(change.content, 'content', { max: 2048 }) };
      if (change.proxied !== undefined) {
        if (typeof change.proxied !== 'boolean') bad('proxied must be true or false.');
        if (!['A', 'AAAA', 'CNAME'].includes(type)) bad(`A ${type} record cannot be proxied.`);
        out.proxied = change.proxied;
      }
      if (change.ttl !== undefined) out.ttl = ttlOf(change.ttl);
      if (change.comment !== undefined) out.comment = str(change.comment, 'comment', { max: 100, min: 0 });
      if (type === 'MX') {
        if (!Number.isInteger(change.priority) || change.priority < 0 || change.priority > 65535) bad('An MX record needs a priority from 0 to 65535.');
        out.priority = change.priority;
      }
      return out;
    }
    case 'dns.update': {
      const zone = allowedZone(change.zone, zones);
      const id = str(change.id, 'record id');
      if (!RECORD_ID.test(id)) bad('record id must be the 32-character id from dns.list.');
      const out = { op, zone, id };
      if (change.name !== undefined) out.name = fullName(change.name, zone);
      if (change.content !== undefined) out.content = str(change.content, 'content', { max: 2048 });
      if (change.proxied !== undefined) { if (typeof change.proxied !== 'boolean') bad('proxied must be true or false.'); out.proxied = change.proxied; }
      if (change.ttl !== undefined) out.ttl = ttlOf(change.ttl);
      if (change.comment !== undefined) out.comment = str(change.comment, 'comment', { max: 100, min: 0 });
      if (Object.keys(out).length === 3) bad('dns.update needs at least one of name, content, proxied, ttl or comment.');
      return out;
    }
    case 'dns.delete': {
      const zone = allowedZone(change.zone, zones);
      const id = str(change.id, 'record id');
      if (!RECORD_ID.test(id)) bad('record id must be the 32-character id from dns.list.');
      return { op, zone, id };
    }
    case 'workers.domain.attach':
    case 'workers.domain.detach': {
      const { host, zone } = allowedHost(change.hostname, zones, 'hostname');
      const out = { op, hostname: host, zone };
      if (op === 'workers.domain.attach') out.service = worker(change.service);
      return out;
    }
    case 'workers.rollback': {
      const versionId = str(change.versionId, 'versionId');
      if (!UUID.test(versionId)) bad('versionId must be a version id from workers.versions.');
      const out = { op, script: worker(change.script), versionId };
      if (change.message !== undefined) out.message = str(change.message, 'message', { max: 100, min: 0 });
      return out;
    }
    case 'workers.build.retry': {
      const buildId = str(change.buildId, 'buildId');
      if (!UUID.test(buildId)) bad('buildId must be a build id from workers.builds.');
      return { op, script: worker(change.script), buildId };
    }
    case 'pages.create': {
      const name = str(change.name, 'name').toLowerCase();
      if (!PROJECT.test(name)) bad('A Pages project name is lowercase letters, digits and dashes.');
      const out = { op, name, productionBranch: str(change.productionBranch ?? 'main', 'productionBranch', { max: 100 }) };
      if (change.repo !== undefined) {
        const r = change.repo;
        if (!r || typeof r !== 'object') bad('repo must be {owner, name}.');
        out.repo = { owner: str(r.owner, 'repo owner', { max: 100 }), name: str(r.name, 'repo name', { max: 100 }) };
      }
      for (const k of ['buildCommand', 'outputDir', 'rootDir']) if (change[k] !== undefined) out[k] = str(change[k], k, { max: 500, min: 0 });
      return out;
    }
    case 'pages.domain.add': {
      const { host, zone } = allowedHost(change.domain, zones, 'domain');
      return { op, project: project(change.project), domain: host, zone };
    }
    case 'pages.env.set': {
      const environment = change.environment;
      if (environment !== 'production' && environment !== 'preview') bad('environment must be production or preview.');
      const vars = change.vars;
      if (!vars || typeof vars !== 'object' || Array.isArray(vars) || !Object.keys(vars).length) bad('vars must be an object of NAME: "value" (null removes one).');
      if (Object.keys(vars).length > 50) bad('Set at most 50 variables at a time.');
      const out = {};
      for (const [k, v] of Object.entries(vars)) {
        if (!VAR.test(k)) bad(`${k} is not a valid variable name.`);
        if (SECRETISH.test(k) && v !== null) bad(`${k} looks like a secret. Agents never handle secret values: set it yourself in the Cloudflare dashboard as an encrypted variable.`);
        if (v !== null && (typeof v !== 'string' || v.length > 5000)) bad(`${k} must be text (at most 5000 characters) or null to remove it.`);
        out[k] = v;
      }
      return { op, project: project(change.project), environment, vars: out };
    }
    case 'pages.rollback':
    case 'pages.retry': {
      const deployment = str(change.deployment, 'deployment');
      if (!UUID.test(deployment)) bad('deployment must be a deployment id from pages.deployments.');
      return { op, project: project(change.project), deployment };
    }
  }
  return bad('Unknown change.');
}

function ttlOf(v) {
  if (v === 1 || v === 'auto') return 1;
  if (!Number.isInteger(v) || v < 60 || v > 86400) bad('ttl must be 1 (automatic) or 60 to 86400 seconds.');
  return v;
}
function worker(v) { const s = str(v, 'Worker name'); if (!WORKER.test(s)) bad(`"${s}" is not a Worker name.`); return s; }
function project(v) { const s = str(v, 'project'); if (!PROJECT.test(s)) bad(`"${s}" is not a Pages project name.`); return s; }

/** One change in plain words. `before` is what it replaces, when known (from preview). */
export function describe(c, before = null) {
  const was = before ? ` (now: ${before})` : '';
  switch (c.op) {
    case 'dns.create': return `Add DNS ${c.type} record ${c.name} pointing to ${c.content}${c.proxied === true ? ', proxied' : c.proxied === false ? ', DNS only' : ''}${c.priority !== undefined ? `, priority ${c.priority}` : ''}`;
    case 'dns.update': {
      const parts = [];
      if (c.name !== undefined) parts.push(`name ${c.name}`);
      if (c.content !== undefined) parts.push(`content ${c.content}`);
      if (c.proxied !== undefined) parts.push(c.proxied ? 'proxied' : 'DNS only');
      if (c.ttl !== undefined) parts.push(`TTL ${c.ttl === 1 ? 'auto' : c.ttl}`);
      if (c.comment !== undefined) parts.push(`comment "${c.comment}"`);
      return `Change DNS record ${c.id.slice(0, 8)} in ${c.zone} to ${parts.join(', ')}${was}`;
    }
    case 'dns.delete': return `Remove DNS record ${c.id.slice(0, 8)} from ${c.zone}${was}`;
    case 'workers.domain.attach': return `Serve Worker ${c.service} on https://${c.hostname}`;
    case 'workers.domain.detach': return `Stop serving https://${c.hostname} from a Worker${was}`;
    case 'workers.rollback': return `Roll Worker ${c.script} back to version ${c.versionId.slice(0, 8)} (all traffic)`;
    case 'workers.build.retry': return `Run Worker ${c.script}'s build ${c.buildId.slice(0, 8)} again`;
    case 'pages.create': return `Create Pages project ${c.name}${c.repo ? ` from GitHub ${c.repo.owner}/${c.repo.name}` : ' (direct upload)'}, production branch ${c.productionBranch}`;
    case 'pages.domain.add': return `Serve Pages project ${c.project} on https://${c.domain}`;
    case 'pages.env.set': return `Set ${c.environment} variables on Pages project ${c.project}: ${Object.entries(c.vars).map(([k, v]) => (v === null ? `remove ${k}` : `${k}=${v.length > 40 ? `${v.slice(0, 40)}...` : v}`)).join(', ')}`;
    case 'pages.rollback': return `Roll Pages project ${c.project} back to deployment ${c.deployment.slice(0, 8)}`;
    case 'pages.retry': return `Run Pages project ${c.project}'s deployment ${c.deployment.slice(0, 8)} again`;
  }
  return c.op;
}

/**
 * Checks a whole set. Returns {ok, steps: [{op, change?, summary, problem?}]}. A problem in one change does not stop
 * the others being checked, so an agent sees every problem at once.
 */
export function checkSet(changes, config) {
  if (!Array.isArray(changes) || !changes.length) bad('changes must be a list with at least one change.');
  if (changes.length > MAX_CHANGES) bad(`At most ${MAX_CHANGES} changes in one set. Split it up.`);
  const steps = changes.map(c => {
    try { const n = normalize(c, config); return { op: n.op, change: n, summary: describe(n) }; }
    catch (e) { if (!(e instanceof SettingsError)) throw e; return { op: c && c.op, summary: OPS[c && c.op] || 'Unknown change', problem: e.message }; }
  });
  return { ok: steps.every(s => !s.problem), steps };
}

// --------------------------------------------------------------------------------------------- Cloudflare calls

/** Looks up zone ids by name, once per set. */
export function zoneIds(cf) {
  const cache = new Map();
  return async zone => {
    if (cache.has(zone)) return cache.get(zone);
    const list = await cf.get(`/zones?name=${encodeURIComponent(zone)}&account.id=${encodeURIComponent(cf.account)}`);
    const z = Array.isArray(list) ? list.find(x => x && lowerHost(x.name) === zone) : null;
    if (!z) throw new SettingsError(`The token cannot see the zone ${zone}. Check the token's zone permissions.`);
    cache.set(zone, z.id);
    return z.id;
  };
}

const recordWords = r => `${r.type} ${r.name} pointing to ${r.content}${r.proxied ? ', proxied' : ''}`;

/** What a change replaces, in words, for review (reads only). Null when there is nothing to say. */
export async function preview(cf, c, zid) {
  if (c.op === 'dns.update' || c.op === 'dns.delete') {
    const r = await cf.get(`/zones/${await zid(c.zone)}/dns_records/${c.id}`);
    return r ? recordWords(r) : null;
  }
  if (c.op === 'workers.domain.detach') {
    const list = await cf.get(cf.acct(`workers/domains?hostname=${encodeURIComponent(c.hostname)}`));
    const d = Array.isArray(list) ? list.find(x => lowerHost(x.hostname) === c.hostname) : null;
    if (!d) throw new SettingsError(`No Worker is served on ${c.hostname}.`);
    return `Worker ${d.service}`;
  }
  return null;
}

/** Makes one change on Cloudflare. Returns a short result in words (and ids that help the next step). */
export async function applyOne(cf, c, zid) {
  const enc = encodeURIComponent;
  switch (c.op) {
    case 'dns.create': {
      const body = { type: c.type, name: c.name, content: c.content, ttl: c.ttl ?? 1 };
      for (const k of ['proxied', 'comment', 'priority']) if (c[k] !== undefined) body[k] = c[k];
      const r = await cf.request('POST', `/zones/${await zid(c.zone)}/dns_records`, body);
      return { id: r.result && r.result.id };
    }
    case 'dns.update': {
      const body = {};
      for (const k of ['name', 'content', 'proxied', 'ttl', 'comment']) if (c[k] !== undefined) body[k] = c[k];
      await cf.request('PATCH', `/zones/${await zid(c.zone)}/dns_records/${enc(c.id)}`, body);
      return { id: c.id };
    }
    case 'dns.delete':
      await cf.request('DELETE', `/zones/${await zid(c.zone)}/dns_records/${enc(c.id)}`);
      return { id: c.id };
    case 'workers.domain.attach': {
      const r = await cf.request('PUT', cf.acct('workers/domains'), { hostname: c.hostname, service: c.service, zone_id: await zid(c.zone), zone_name: c.zone });
      return { id: r.result && r.result.id };
    }
    case 'workers.domain.detach': {
      const list = await cf.get(cf.acct(`workers/domains?hostname=${enc(c.hostname)}`));
      const d = Array.isArray(list) ? list.find(x => lowerHost(x.hostname) === c.hostname) : null;
      if (!d) throw new SettingsError(`No Worker is served on ${c.hostname}.`);
      await cf.request('DELETE', cf.acct(`workers/domains/${enc(d.id)}`));
      return { id: d.id };
    }
    case 'workers.rollback': {
      const body = { strategy: 'percentage', versions: [{ version_id: c.versionId, percentage: 100 }] };
      if (c.message) body.annotations = { 'workers/message': c.message };
      const r = await cf.request('POST', cf.acct(`workers/scripts/${enc(c.script)}/deployments`), body);
      return { id: r.result && r.result.id };
    }
    case 'workers.build.retry': {
      const tag = await scriptTag(cf, c.script);
      const r = await cf.request('POST', cf.acct(`builds/workers/${enc(tag)}/builds/${enc(c.buildId)}/retry`));
      return { id: r.result && (r.result.build_uuid || r.result.id) };
    }
    case 'pages.create': {
      const body = { name: c.name, production_branch: c.productionBranch };
      const build = {};
      if (c.buildCommand !== undefined) build.build_command = c.buildCommand;
      if (c.outputDir !== undefined) build.destination_dir = c.outputDir;
      if (c.rootDir !== undefined) build.root_dir = c.rootDir;
      if (Object.keys(build).length) body.build_config = build;
      if (c.repo) body.source = { type: 'github', config: { owner: c.repo.owner, repo_name: c.repo.name, production_branch: c.productionBranch, production_deployments_enabled: true } };
      const r = await cf.request('POST', cf.acct('pages/projects'), body);
      return { id: r.result && r.result.name, subdomain: r.result && r.result.subdomain };
    }
    case 'pages.domain.add':
      await cf.request('POST', cf.acct(`pages/projects/${enc(c.project)}/domains`), { name: c.domain });
      return { id: c.domain };
    case 'pages.env.set': {
      const envVars = {};
      for (const [k, v] of Object.entries(c.vars)) envVars[k] = v === null ? null : { type: 'plain_text', value: v };
      await cf.request('PATCH', cf.acct(`pages/projects/${enc(c.project)}`), { deployment_configs: { [c.environment]: { env_vars: envVars } } });
      return { id: c.project };
    }
    case 'pages.rollback':
    case 'pages.retry': {
      const r = await cf.request('POST', cf.acct(`pages/projects/${enc(c.project)}/deployments/${enc(c.deployment)}/${c.op === 'pages.rollback' ? 'rollback' : 'retry'}`));
      return { id: r.result && r.result.id };
    }
  }
  throw new SettingsError(`Unknown change ${c.op}.`);
}

/** A Worker's script tag (what Workers Builds calls it), by name. */
export async function scriptTag(cf, name) {
  const list = await cf.get(cf.acct('workers/scripts'));
  const s = Array.isArray(list) ? list.find(x => x && x.id === name) : null;
  if (!s) throw new SettingsError(`There is no Worker named ${name} in this account.`);
  if (!s.tag) throw new SettingsError(`Cloudflare did not say ${name}'s script tag.`);
  return s.tag;
}

/**
 * Applies a checked set in order and stops at the first failure (the rest are skipped). Returns
 * {status: applied|failed, results: [{summary, ok, skipped?, error?, id?}]}.
 */
export async function applySet(cf, changes) {
  const zid = zoneIds(cf);
  const results = [];
  let failed = false;
  for (const c of changes) {
    const summary = describe(c);
    if (failed) { results.push({ summary, ok: false, skipped: true }); continue; }
    try { results.push({ summary, ok: true, ...(await applyOne(cf, c, zid)) }); }
    catch (e) { failed = true; results.push({ summary, ok: false, error: e && e.message ? e.message : 'Cloudflare failed.' }); }
  }
  return { status: failed ? 'failed' : 'applied', results };
}

// One-time import of an existing ado-helper.json (Prioritizer ADO helper) and eng-agents config.json
// into this connector's config. Pure: takes parsed JSON, returns {config, notes}. Never reads secrets.
import { baseOf } from './config.mjs';

const NAME = /^[A-Za-z0-9_-]{1,40}$/;

function slug(s) {
  const v = String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return v || 'ado';
}

function uniqueName(want, taken) {
  let name = slug(want);
  for (let n = 2; taken.has(name); n++) name = `${slug(want).slice(0, 36)}-${n}`;
  taken.add(name);
  return name;
}

/** Splits a collection URL (https://host/tfs/Main) into server URL and collection. */
export function splitBase(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  const i = u.lastIndexOf('/');
  if (i < 0 || i <= u.indexOf('://') + 2) return { serverUrl: u, collection: '' };
  return { serverUrl: u.slice(0, i), collection: decodeURIComponent(u.slice(i + 1)) };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const strList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : null);

/**
 * @param {object} src
 * @param {object} [src.helper] parsed ado-helper.json
 * @param {object} [src.engAgents] parsed eng-agents config.json
 * @param {object} [src.current] the connector's current config, kept where the imports say nothing
 */
export function importConfig({ helper, engAgents, current } = {}) {
  const notes = [];
  const cur = isObj(current) ? current : {};
  const connections = Array.isArray(cur.connections) ? cur.connections.map(c => ({ ...c })) : [];
  const taken = new Set(connections.map(c => c.name));
  const out = { ...cur, connections };
  const findByBase = base => connections.find(c => baseOf(c).toLowerCase() === String(base).replace(/\/+$/, '').toLowerCase());

  // eng-agents first: its connections are already named.
  if (isObj(engAgents)) {
    const topApi = engAgents.apiVersion;
    const topPat = engAgents.patEnv;
    let src = isObj(engAgents.connections) ? Object.entries(engAgents.connections) : [];
    if (!src.length && engAgents.serverUrl) src = [['default', engAgents]];
    for (const [rawName, c] of src) {
      if (!isObj(c) || !c.serverUrl || !c.collection) {
        notes.push(`Skipped eng-agents connection "${rawName}": it needs serverUrl and collection.`);
        continue;
      }
      if (/example\.local/i.test(c.serverUrl)) {
        notes.push(`Skipped eng-agents connection "${rawName}": it still has the example server URL.`);
        continue;
      }
      const existing = findByBase(baseOf(c));
      if (existing) {
        notes.push(`eng-agents connection "${rawName}" is the same collection as "${existing.name}"; kept "${existing.name}".`);
        continue;
      }
      const name = NAME.test(rawName) && !taken.has(rawName) ? (taken.add(rawName), rawName) : uniqueName(rawName, taken);
      if (name !== rawName) notes.push(`eng-agents connection "${rawName}" is named "${name}" here.`);
      const conn = { name, serverUrl: String(c.serverUrl).replace(/\/+$/, ''), collection: String(c.collection), patEnv: String(c.patEnv || topPat || 'ADO_PAT') };
      if (c.project) conn.project = String(c.project);
      const api = c.apiVersion || topApi;
      if (api && String(api) !== '6.0') conn.apiVersion = String(api);
      if ((c.auth || engAgents.auth) === 'windows') {
        notes.push(`Connection "${name}" used Windows sign-in in eng-agents. Workshop uses a PAT; set ${conn.patEnv} before using it.`);
      }
      connections.push(conn);
    }
    const def = engAgents.default;
    if (def && !out.defaultConnection) {
      const c = connections.find(x => x.name === def) || connections.find(x => x.name === slug(def));
      if (c) out.defaultConnection = c.name;
    }
    if (isObj(engAgents.paths)) {
      const paths = Array.isArray(out.paths) ? [...out.paths] : [];
      for (const [pattern, target] of Object.entries(engAgents.paths)) {
        const c = connections.find(x => x.name === target) || connections.find(x => x.name === slug(target));
        if (!c) { notes.push(`Skipped the mapping for ${pattern}: "${target}" is not a connection.`); continue; }
        if (!paths.some(p => p.path === pattern)) paths.push({ path: pattern, connection: c.name });
      }
      out.paths = paths;
    }
  }

  // Then the helper: one collection for my work items, plus PR sources.
  if (isObj(helper)) {
    const patEnv = String(helper.pat_env || 'ADO_PAT');
    const api = helper.api_version ? String(helper.api_version) : '';
    const verify = helper.verify_ssl !== false;
    const ensure = base => {
      const found = findByBase(base);
      if (found) {
        if ((found.patEnv || 'ADO_PAT') !== patEnv) notes.push(`The helper used ${patEnv} for ${base}; connection "${found.name}" keeps ${found.patEnv || 'ADO_PAT'}.`);
        if (!verify && found.verifyTls !== false) { found.verifyTls = false; notes.push(`TLS checks are off for "${found.name}" because they were off in the helper.`); }
        return found;
      }
      const { serverUrl, collection } = splitBase(base);
      const conn = { name: uniqueName(collection || 'ado', taken), serverUrl, collection, patEnv };
      if (api && api !== '6.0') conn.apiVersion = api;
      if (!verify) { conn.verifyTls = false; notes.push(`TLS checks are off for "${conn.name}" because they were off in the helper.`); }
      connections.push(conn);
      return conn;
    };
    if (helper.base_url) {
      const c = ensure(helper.base_url);
      if (!out.defaultConnection) out.defaultConnection = c.name;
      else if (out.defaultConnection !== c.name) out.syncConnection = c.name;
    }
    const prSources = Array.isArray(out.prSources) ? [...out.prSources] : [];
    for (const s of Array.isArray(helper.pr_sources) ? helper.pr_sources : []) {
      if (!isObj(s) || !s.base_url || !s.project) continue;
      const c = ensure(s.base_url);
      if (!prSources.some(p => p.connection === c.name && p.project === s.project)) {
        prSources.push({ connection: c.name, project: String(s.project), repos: strList(s.repos) || [] });
      }
    }
    if (prSources.length) out.prSources = prSources;
    const lists = [['types', 'types'], ['closed_states', 'closedStates'], ['removed_states', 'removedStates'], ['pr_teams', 'prTeams']];
    for (const [from, to] of lists) if (strList(helper[from])) out[to] = strList(helper[from]);
    const reports = isObj(out.reports) ? { ...out.reports } : {};
    if (strList(helper.workload_types)) reports.workloadTypes = strList(helper.workload_types);
    if (strList(helper.bug_types)) reports.bugTypes = strList(helper.bug_types);
    if (Array.isArray(helper.high_priorities)) reports.highPriorities = helper.high_priorities.map(p => String(p)).filter(p => /^\d+$/.test(p));
    if (Number.isInteger(helper.escalation_priority)) reports.escalationPriority = helper.escalation_priority;
    if (strList(helper.effort_fields)) reports.effortFields = strList(helper.effort_fields);
    if (Number.isInteger(helper.workload_max_items)) reports.maxItems = helper.workload_max_items;
    if (Object.keys(reports).length) out.reports = reports;
    if (Array.isArray(helper.allowed_origins) && helper.allowed_origins.length) {
      notes.push('The helper\'s allowed_origins were not imported. Workshop keeps allowed origins in its own settings (hosted mode).');
    }
  }

  if (!connections.length) notes.push('No connections found to import.');
  if (!out.defaultConnection && connections.length) out.defaultConnection = connections[0].name;
  return { config: out, notes };
}

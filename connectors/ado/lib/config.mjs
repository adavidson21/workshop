// The ADO connection model for all of Workshop: named connections (one per server and collection), a
// default, and a repo or folder mapping, as in eng-agents config.json; plus the settings ado_helper.py had.
import os from 'node:os';
import { SettingsError } from './client.mjs';

const DEFAULTS = {
  types: ['Issue', 'Bug', 'User Story'],
  closedStates: ['Resolved', 'Closed', 'Done'],
  removedStates: ['Removed'],
  reports: {
    workloadTypes: [],
    bugTypes: ['Bug'],
    highPriorities: ['1', '2'],
    escalationPriority: 1,
    effortFields: ['Microsoft.VSTS.Scheduling.RemainingWork', 'Microsoft.VSTS.Scheduling.Effort',
      'Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.OriginalEstimate'],
    maxItems: 1500
  }
};

const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : null);

/** Collection URL of a connection: server URL plus collection, no trailing slash. */
export function baseOf(c) {
  const server = String(c.serverUrl || '').replace(/\/+$/, '');
  const coll = String(c.collection || '').replace(/^\/+|\/+$/g, '');
  return coll ? `${server}/${coll}` : server;
}

/**
 * Fills defaults (including inside array items, which the agent does not do) and adds `base` to each
 * connection. Returns {config, problems}; problems are plain words for status().
 */
export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const connections = (Array.isArray(r.connections) ? r.connections : []).map(c => {
    const conn = {
      name: String(c?.name || ''),
      serverUrl: String(c?.serverUrl || ''),
      collection: String(c?.collection || ''),
      project: c?.project ? String(c.project) : '',
      patEnv: c?.patEnv ? String(c.patEnv) : 'ADO_PAT',
      apiVersion: c?.apiVersion ? String(c.apiVersion) : '6.0',
      useSystemCa: c?.useSystemCa !== false,
      verifyTls: c?.verifyTls !== false
    };
    conn.base = baseOf(conn);
    return conn;
  });
  const names = new Set();
  for (const c of connections) {
    if (!c.name) problems.push('A connection has no name.');
    else if (names.has(c.name)) problems.push(`Two connections are named "${c.name}".`);
    names.add(c.name);
    if (!/^https?:\/\//i.test(c.serverUrl)) problems.push(`Connection "${c.name}" needs a server URL starting with https://.`);
  }
  if (!connections.length) problems.push('Add an ADO connection in Settings.');

  const known = name => !name || names.has(name);
  const defaultConnection = r.defaultConnection ? String(r.defaultConnection) : '';
  const syncConnection = r.syncConnection ? String(r.syncConnection) : '';
  if (!known(defaultConnection)) problems.push(`The default connection "${defaultConnection}" is not one of your connections.`);
  if (!known(syncConnection)) problems.push(`The connection for my work items "${syncConnection}" is not one of your connections.`);

  const paths = (Array.isArray(r.paths) ? r.paths : []).filter(p => p && p.path && p.connection)
    .map(p => ({ path: String(p.path), connection: String(p.connection), project: p.project ? String(p.project) : '' }));
  for (const p of paths) if (!names.has(p.connection)) problems.push(`The mapping for ${p.path} names "${p.connection}", which is not one of your connections.`);

  const prSources = (Array.isArray(r.prSources) ? r.prSources : []).filter(s => s && s.connection && s.project)
    .map(s => ({ connection: String(s.connection), project: String(s.project), repos: strings(s.repos) || [] }));
  for (const s of prSources) if (!names.has(s.connection)) problems.push(`A PR source names "${s.connection}", which is not one of your connections.`);

  const rr = r.reports && typeof r.reports === 'object' ? r.reports : {};
  const config = {
    connections,
    defaultConnection,
    syncConnection,
    paths,
    types: strings(r.types) || DEFAULTS.types,
    closedStates: strings(r.closedStates) || DEFAULTS.closedStates,
    removedStates: strings(r.removedStates) || DEFAULTS.removedStates,
    prSources,
    prTeams: strings(r.prTeams) || [],
    reports: {
      workloadTypes: strings(rr.workloadTypes) || DEFAULTS.reports.workloadTypes,
      bugTypes: strings(rr.bugTypes) || DEFAULTS.reports.bugTypes,
      highPriorities: strings(rr.highPriorities) || DEFAULTS.reports.highPriorities,
      escalationPriority: Number.isInteger(rr.escalationPriority) ? rr.escalationPriority : DEFAULTS.reports.escalationPriority,
      effortFields: strings(rr.effortFields) || DEFAULTS.reports.effortFields,
      maxItems: Number.isInteger(rr.maxItems) ? rr.maxItems : DEFAULTS.reports.maxItems
    }
  };
  return { config, problems };
}

const byName = (cfg, name) => cfg.connections.find(c => c.name === name);
const namesText = cfg => cfg.connections.map(c => c.name).join(', ');

/** Lower case, forward slashes, no trailing slash, "~" expanded. Same as eng-agents ConvertTo-PathKey. */
export function pathKey(p, home = os.homedir()) {
  let s = String(p);
  if (s === '~') s = home;
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = home.replace(/[\\/]+$/, '') + '/' + s.slice(2);
  return s.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

/** PowerShell -like: "*" any characters, "?" one character, case already folded. */
function like(text, pattern) {
  const re = '^' + pattern.split('').map(ch => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('') + '$';
  return new RegExp(re, 's').test(text);
}

/** The longest `paths` entry that matches a repo or folder path, or null. */
export function matchPath(cfg, p, home) {
  const key = pathKey(p, home);
  let best = null;
  let bestLen = -1;
  for (const m of cfg.paths) {
    const pattern = pathKey(m.path, home);
    if (like(key, pattern) || like(key + '/', pattern) || like(key, pattern + '/*')) {
      if (pattern.length > bestLen) { best = m; bestLen = pattern.length; }
    }
  }
  return best;
}

/**
 * Picks a connection, in eng-agents order: a named connection, a path mapping, the default, the only one.
 * Returns {connection, project, reason}. Throws SettingsError when it cannot decide.
 */
export function resolveConnection(cfg, { connection, path, home } = {}) {
  if (!cfg.connections.length) throw new SettingsError('No ADO connections are set. Add one in Settings.');
  if (connection) {
    const c = byName(cfg, connection);
    if (!c) throw new SettingsError(`"${connection}" is not one of your ADO connections. Connections: ${namesText(cfg)}`);
    return { connection: c, project: c.project, reason: 'named connection' };
  }
  if (path) {
    const m = matchPath(cfg, path, home);
    if (m) {
      const c = byName(cfg, m.connection);
      if (!c) throw new SettingsError(`The mapping for ${m.path} names "${m.connection}", which is not one of your connections.`);
      return { connection: c, project: m.project || c.project, reason: `path matches ${m.path}` };
    }
  }
  if (cfg.defaultConnection) {
    const c = byName(cfg, cfg.defaultConnection);
    if (c) return { connection: c, project: c.project, reason: 'default connection' };
  }
  if (cfg.connections.length === 1) {
    const c = cfg.connections[0];
    return { connection: c, project: c.project, reason: 'only connection' };
  }
  throw new SettingsError(`Could not tell which ADO connection to use. Pick one, or map this repo in Settings. Connections: ${namesText(cfg)}`);
}

/** The connection used for "my work items": syncConnection, else the default, else the only one. */
export function syncConnection(cfg) {
  if (cfg.syncConnection) return resolveConnection(cfg, { connection: cfg.syncConnection }).connection;
  return resolveConnection(cfg, {}).connection;
}

/** Connection whose collection URL is `base` (as ado_helper.py sends it), or null. */
export function connectionForBase(cfg, base) {
  const b = String(base || '').replace(/\/+$/, '').toLowerCase();
  return cfg.connections.find(c => c.base.toLowerCase() === b) || null;
}

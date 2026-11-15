// Normalized settings: defaults filled in, bad entries dropped with a plain-words problem for status().
import { SettingsError } from './client.mjs';

export const DEFAULT_TYPES = ['Issue', 'Bug', 'Story'];
/** Labels that set an issue's type (lower case). An issue with none of them is an Issue. */
export const TYPE_LABELS = { epic: 'Epic', feature: 'Feature', story: 'Story', 'user story': 'Story', bug: 'Bug', task: 'Task' };
export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Web, API and GraphQL addresses for an API URL (github.com or GitHub Enterprise Server). */
export function addresses(apiUrl, webUrl) {
  const api = String(apiUrl || 'https://api.github.com').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(api); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let web, graphql;
  if (u.hostname === 'api.github.com') { web = 'https://github.com'; graphql = 'https://api.github.com/graphql'; }
  else if (/\/api\/v3$/.test(u.pathname)) { web = api.replace(/\/api\/v3$/, ''); graphql = api.replace(/\/api\/v3$/, '/api/graphql'); }
  else { web = api; graphql = `${api}/graphql`; }
  if (webUrl) { try { web = new URL(String(webUrl)).href.replace(/\/+$/, ''); } catch { /* keep derived */ } }
  return { api, web, graphql };
}

const list = v => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean);

export function normalize(raw = {}) {
  const problems = [];
  const connections = [];
  for (const c of Array.isArray(raw.connections) ? raw.connections : []) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.name || '').trim();
    if (!NAME_RE.test(name)) { problems.push('A GitHub connection needs a short name (letters, digits, - or _).'); continue; }
    if (connections.some(x => x.name === name)) { problems.push(`Two GitHub connections are named "${name}".`); continue; }
    const a = addresses(c.apiUrl, c.webUrl);
    if (!a) { problems.push(`Connection "${name}" has an API URL that is not a web address.`); continue; }
    connections.push({
      name, apiUrl: a.api, webUrl: a.web, graphqlUrl: a.graphql,
      tokenEnv: String(c.tokenEnv || 'GITHUB_PAT').trim() || 'GITHUB_PAT',
      tokenExpires: /^\d{4}-\d{2}-\d{2}$/.test(String(c.tokenExpires || '')) ? c.tokenExpires : ''
    });
  }
  if (!connections.length && !problems.length) problems.push('Add a GitHub connection in Settings.');
  const names = new Set(connections.map(c => c.name));
  let defaultConnection = String(raw.defaultConnection || '').trim();
  if (defaultConnection && !names.has(defaultConnection)) { problems.push(`Default connection "${defaultConnection}" does not exist.`); defaultConnection = ''; }
  const repos = [];
  for (const r of list(raw.repos)) {
    if (REPO_RE.test(r)) { if (!repos.some(x => x.toLowerCase() === r.toLowerCase())) repos.push(r); }
    else problems.push(`"${r}" is not owner/repo.`);
  }
  const types = list(raw.types);
  const nn = raw.prNotNeeded && typeof raw.prNotNeeded === 'object' ? raw.prNotNeeded : {};
  const approvals = Number.isInteger(nn.approvals) && nn.approvals >= 0 && nn.approvals <= 20 ? nn.approvals : 2;
  return {
    config: {
      connections,
      defaultConnection: defaultConnection || connections[0]?.name || '',
      repos,
      types: types.length ? types : [...DEFAULT_TYPES],
      areaLabelPrefix: typeof raw.areaLabelPrefix === 'string' ? raw.areaLabelPrefix.trim() : 'area:',
      prs: raw.prs !== false,
      prTeams: list(raw.prTeams).map(t => t.toLowerCase()),
      prNotNeeded: { teamOnly: nn.teamOnly !== false, canMerge: nn.canMerge !== false, approvals }
    },
    problems
  };
}

/** The connection to use: by name, else the default. */
export function pickConnection(cfg, name) {
  if (name) {
    const c = cfg.connections.find(x => x.name === name);
    if (!c) throw new SettingsError(`No GitHub connection named "${name}". Check Settings.`);
    return c;
  }
  const c = cfg.connections.find(x => x.name === cfg.defaultConnection) || cfg.connections[0];
  if (!c) throw new SettingsError('Add a GitHub connection in Settings.');
  return c;
}

/** Whether a repo (owner/repo) is in scope: every repo when `repos` is empty. */
export function inScope(cfg, repo) {
  return !cfg.repos.length || cfg.repos.some(r => r.toLowerCase() === String(repo).toLowerCase());
}

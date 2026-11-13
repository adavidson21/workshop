/* Settings: the Repos tab's model. One list of the repos in your workspace (from the opencode connector's
   state), each with the ADO connection and project it uses (the ADO connector's `paths`) and whether its pull
   requests are watched (`prSources`). Pure, no DOM, so test/repos.test.mjs can import it. Every change returns
   a new ADO config for settings.js to save with ws.connectors.putConfig; nothing here saves. */

const lc = s => String(s == null ? '' : s).toLowerCase();
const trimSlash = s => String(s || '').replace(/[\\/]+$/, '');

/** The ADO config keys the Repos and Pull requests pages draw themselves (x-workshop-page in the connector's configSchema). */
export const KEYS = ['paths', 'prSources'];

/** "work" connection's collection URL, like the connector's baseOf: server + "/" + collection. */
export function baseOf(c) {
  const server = trimSlash(c && c.serverUrl);
  const coll = String((c && c.collection) || '').replace(/^\/+|\/+$/g, '');
  return coll ? `${server}/${coll}` : server;
}

/** A folder's full path for a `paths` entry: the workspace, then "repo" or "Category/repo" (categories can nest: "Platform/Lighthouse/ui"). */
export function folderPath(workspace, folder) {
  const w = trimSlash(workspace);
  return w ? `${w}/${folder}` : String(folder || '');
}

/** Compare key for paths: lower case, forward slashes, no trailing slash. */
export const pathKey = p => trimSlash(String(p || '').replaceAll('\\', '/')).toLowerCase();

/**
 * The ADO parts of a repo's web or clone URL, or null when it is not an ADO repo (no /_git/).
 *   https://ado.example.com/tfs/Main/Project/_git/repo   -> base https://ado.example.com/tfs/Main
 *   https://org@dev.azure.com/org/Project/_git/repo      -> base https://dev.azure.com/org
 *   https://org.visualstudio.com/Project/_git/repo       -> base https://dev.azure.com/org
 *   git@ssh.dev.azure.com:v3/org/Project/repo            -> base https://dev.azure.com/org
 * @returns {{base: string, project: string, repo: string} | null}
 */
export function adoParts(url) {
  let u = String(url || '').trim();
  if (!u) return null;
  const ssh = u.match(/^(?:[^@/]+@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/?#]+?)\/?$/i);
  if (ssh) return { base: `https://dev.azure.com/${dec(ssh[1])}`, project: dec(ssh[2]), repo: dec(ssh[3]).replace(/\.git$/i, '') };
  u = u.replace(/^(https?:\/\/)[^@/]+@/i, '$1');
  const m = u.match(/^(https?:\/\/[^/]+(?:\/[^?#]*?)?)\/([^/?#]+)\/_git\/([^/?#]+)/i);
  if (!m) return null;
  let base = trimSlash(m[1]);
  const vs = base.match(/^https?:\/\/([^/.]+)\.visualstudio\.com(\/DefaultCollection)?$/i);
  if (vs) base = `https://dev.azure.com/${vs[1]}`;
  return { base, project: dec(m[2]), repo: dec(m[3]).replace(/\.git$/i, '') };
}
function dec(s) { try { return decodeURIComponent(s); } catch { return s; } }

const connections = cfg => (cfg && Array.isArray(cfg.connections) ? cfg.connections : []);
const paths = cfg => (cfg && Array.isArray(cfg.paths) ? cfg.paths : []);
const sources = cfg => (cfg && Array.isArray(cfg.prSources) ? cfg.prSources : []);
const byName = (cfg, name) => connections(cfg).find(c => c.name === name) || null;

/** The PR source for a connection and project (project compared without case), with its index, or null. */
export function sourceFor(cfg, connection, project) {
  const i = sources(cfg).findIndex(s => s.connection === connection && lc(s.project) === lc(project));
  return i < 0 ? null : { index: i, source: sources(cfg)[i] };
}

/** Whether a repo's PRs are watched: "project" (every repo in its project), "repo" (named), or "no". */
export function watchOf(cfg, connection, project, repo) {
  if (!connection || !project) return 'no';
  const hit = sourceFor(cfg, connection, project);
  if (!hit) return 'no';
  const repos = Array.isArray(hit.source.repos) ? hit.source.repos : [];
  if (!repos.length) return 'project';
  return repos.some(r => lc(r) === lc(repo)) ? 'repo' : 'no';
}

/**
 * One row per workspace repo.
 * @param {{repos?: Array<{folder: string, git?: {web?: string}}>, workspace?: string}} state opencode's state
 * @param {object} cfg the ADO config
 * @returns {Array<{folder, path, web, name, mapping, remote, ado, watch}>}
 *   mapping: the `paths` entry for this folder, or null
 *   remote:  what its git remote says ({connection, project, repo} when the server is a connection, or
 *            {base, project, repo, connection: null} when it is not), or null for a non-ADO remote
 *   ado:     what the repo uses: {connection, project, repo, from: "mapping" | "remote"}, or null
 */
export function rows(state, cfg) {
  const ws = state && state.workspace;
  return ((state && state.repos) || []).filter(r => r && r.folder).map(r => {
    const path = folderPath(ws, r.folder);
    const web = (r.git && r.git.web) || '';
    const parts = adoParts(web);
    const remoteConn = parts ? connections(cfg).find(c => lc(baseOf(c)) === lc(parts.base)) : null;
    const remote = parts ? { ...parts, connection: remoteConn ? remoteConn.name : null } : null;
    const name = (parts && parts.repo) || String(r.folder).split('/').pop();
    const mapping = paths(cfg).find(p => pathKey(p.path) === pathKey(path)) || null;
    let ado = null;
    if (mapping) {
      const c = byName(cfg, mapping.connection);
      ado = { connection: mapping.connection, project: mapping.project || (c && c.project) || (remote && remote.project) || '', repo: name, from: 'mapping' };
    } else if (remote && remote.connection) ado = { connection: remote.connection, project: remote.project, repo: name, from: 'remote' };
    return { folder: r.folder, path, web, name, mapping, remote, ado, watch: ado ? watchOf(cfg, ado.connection, ado.project, name) : 'no' };
  });
}

/** `paths` entries that are not one of the workspace repos (patterns, folders elsewhere), with their index. */
export function otherMappings(cfg, list) {
  const mine = new Set(list.map(r => pathKey(r.path)));
  return paths(cfg).map((p, index) => ({ ...p, index })).filter(p => !mine.has(pathKey(p.path)));
}

/** Rows whose remote names one of your connections but that have no mapping yet. */
export const unmapped = list => list.filter(r => r.ado && r.ado.from === 'remote');

const copy = cfg => ({ ...(cfg || {}), paths: paths(cfg).map(p => ({ ...p })), prSources: sources(cfg).map(s => ({ ...s, repos: [...(s.repos || [])] })) });

function setMapping(out, path, connection, project) {
  const key = pathKey(path);
  out.paths = out.paths.filter(p => pathKey(p.path) !== key);
  if (connection) out.paths.push(project ? { path, connection, project } : { path, connection });
}

function unwatch(out, connection, project, repo) {
  const hit = sourceFor(out, connection, project);
  if (!hit || !hit.source.repos.length) return; // not watched, or watched with the whole project
  hit.source.repos = hit.source.repos.filter(r => lc(r) !== lc(repo));
  // An empty list means every repo, so the last repo out takes the source with it.
  if (!hit.source.repos.length) out.prSources.splice(hit.index, 1);
}

function watch(out, connection, project, repo) {
  const hit = sourceFor(out, connection, project);
  if (!hit) { out.prSources.push({ connection, project, repos: [repo] }); return; }
  if (!hit.source.repos.length) return; // already every repo in the project
  if (!hit.source.repos.some(r => lc(r) === lc(repo))) hit.source.repos.push(repo);
}

/**
 * Saves one repo's settings: its mapping and whether its PRs are watched.
 * @param {object} cfg the ADO config
 * @param {{path: string, connection: string, project?: string, repo: string, watch: boolean,
 *          was?: {connection?: string, project?: string, repo?: string}}} it  `was` is what it used before,
 *          so a repo moved to another project stops being watched in the old one
 */
export function saveRepo(cfg, it) {
  const out = copy(cfg);
  const connection = String(it.connection || '').trim();
  const c = byName(cfg, connection);
  const project = String(it.project || '').trim();
  const repo = String(it.repo || '').trim();
  // The project is left off the mapping when it is the connection's own, so changing that changes both.
  setMapping(out, it.path, connection, c && project && lc(project) === lc(c.project) ? '' : project);
  const was = it.was || {};
  if (was.connection && was.project && was.repo) unwatch(out, was.connection, was.project, was.repo);
  const usedProject = project || (c && c.project) || '';
  if (connection && usedProject && repo) (it.watch ? watch : unwatch)(out, connection, usedProject, repo);
  return out;
}

/** Saves a mapping for every row that only has its remote to go on. */
export function mapAll(cfg, list) {
  let out = copy(cfg);
  for (const r of unmapped(list)) out = saveRepo(out, { path: r.path, connection: r.ado.connection, project: r.ado.project, repo: r.name, watch: r.watch !== 'no' });
  return out;
}

/** Adds, changes (index) or removes (connection empty) a mapping that is not a workspace repo. */
export function saveMapping(cfg, { index, path, connection, project }) {
  const out = copy(cfg);
  const entry = { path: String(path || '').trim(), connection: String(connection || '').trim() };
  const proj = String(project || '').trim();
  if (proj) entry.project = proj;
  if (index == null) { if (entry.path && entry.connection) out.paths.push(entry); return out; }
  if (!entry.path || !entry.connection) out.paths.splice(index, 1);
  else out.paths[index] = entry;
  return out;
}

/** Adds a PR source for a whole project (or makes an existing one the whole project). */
export function addSource(cfg, connection, project) {
  const out = copy(cfg);
  const p = String(project || '').trim();
  if (!connection || !p) return out;
  const hit = sourceFor(out, connection, p);
  if (hit) hit.source.repos = [];
  else out.prSources.push({ connection, project: p, repos: [] });
  return out;
}

/**
 * Changes a PR source between every repo in the project (all) and only some repos. Going to "only some"
 * keeps `repos`, the workspace repos in that project; with none, the source is removed (empty means every repo).
 */
export function setSourceScope(cfg, index, all, repos) {
  const out = copy(cfg);
  const s = out.prSources[index];
  if (!s) return out;
  if (all) s.repos = [];
  else {
    const list = [...new Set((repos || []).map(String).filter(Boolean))];
    if (list.length) s.repos = list; else out.prSources.splice(index, 1);
  }
  return out;
}

export function removeSource(cfg, index) {
  const out = copy(cfg);
  out.prSources.splice(index, 1);
  return out;
}

/** Workspace repo names that use a connection and project, for "only some repos". */
export function reposIn(list, connection, project) {
  return list.filter(r => r.ado && r.ado.connection === connection && lc(r.ado.project) === lc(project)).map(r => r.name);
}

/**
 * After cloning: what the clone URL says, matched to your connections.
 * @returns {{connection: string|null, project: string, repo: string, base: string} | null} null for non-ADO URLs
 */
export function fromCloneUrl(cfg, url) {
  const parts = adoParts(url);
  if (!parts) return null;
  const c = connections(cfg).find(x => lc(baseOf(x)) === lc(parts.base));
  return { ...parts, connection: c ? c.name : null };
}

/* ---------- hidden folders (opencode `hiddenRepos`) ----------
   Workspace folders Loom and this page leave out with everything under them: a category ("Tools",
   "Platform/Lighthouse") or a repo ("gh-repo", "Tools/workshop"), up to HIDE_DEPTH names (the connector's
   REPO_DEPTH). The connector's parser does the hiding; these only edit the list. */

/** The opencode config key the Repos page draws itself. */
export const HIDE_KEYS = ['hiddenRepos'];
const HIDE_DEPTH = 4;

/** A folder as the list keeps it: trimmed, forward slashes, no slash at either end. '' when it is not 1 to HIDE_DEPTH names. */
export function hideEntry(s) {
  const parts = String(s || '').trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length > HIDE_DEPTH || parts.some(p => !p || p === '.' || p === '..')) return '';
  return parts.join('/');
}

/** The saved list, cleaned, in saved order. */
export function hiddenOf(cfg) {
  return (Array.isArray(cfg && cfg.hiddenRepos) ? cfg.hiddenRepos : []).map(hideEntry).filter(Boolean);
}

/** True when `folder` ("repo" or "Category/repo") is hidden by the list, itself or through its category. */
export function isHidden(list, folder) {
  const f = lc(hideEntry(folder));
  return !!f && list.some(h => { const k = lc(h); return k === f || f.startsWith(k + '/'); });
}

/** The list with `folder` added (no change when it is already hidden). Throws a plain message for a bad name. */
export function hide(list, folder) {
  const f = hideEntry(folder);
  if (!f) throw new Error('Give a folder in your workspace, like Tools or Tools/workshop.');
  if (isHidden(list, f)) return list.slice();
  // Hiding a category takes over anything under it already on the list.
  return [...list.filter(h => !lc(h).startsWith(lc(f) + '/')), f];
}

/** The list without `entry` (case ignored). */
export function unhide(list, entry) {
  const k = lc(hideEntry(entry));
  return list.filter(h => lc(h) !== k);
}

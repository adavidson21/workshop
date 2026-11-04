// Fills the ADO settings from one link copied out of ADO (a work item, a board, a repo, a PR, a project
// page). Pure: takes the link and the current config, returns {config, notes}. Saves nothing.
import { baseOf } from './config.mjs';

const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * Splits an ADO link into its parts.
 *   Azure DevOps Server: https://host[:port][/tfs]/Collection/Project/_workitems/edit/123
 *   Azure DevOps cloud:  https://dev.azure.com/Org/Project/_git/Repo, https://org.visualstudio.com/Project/...
 * Everything from the first segment starting with "_" (_git, _workitems, _boards, _apis, ...) is ignored,
 * except the repo name after _git.
 * @returns {{serverUrl: string, collection: string, project: string, repo: string}}
 */
export function parseAdoUrl(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { throw new Error('That is not a link. Copy the address from your browser while ADO is open.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('ADO links start with https:// (or http://).');
  const segs = u.pathname.split('/').filter(Boolean).map(dec);
  const cut = segs.findIndex(s => s.startsWith('_'));
  const head = cut < 0 ? segs : segs.slice(0, cut);
  const repo = cut >= 0 && segs[cut] === '_git' && segs[cut + 1] ? segs[cut + 1] : '';
  const host = u.hostname.toLowerCase();

  let serverUrl, collection, project;
  if (host === 'dev.azure.com') {
    // dev.azure.com/{org}/{project}: the org plays the collection's part.
    [collection = '', project = ''] = head;
    serverUrl = `${u.protocol}//${u.host}`;
  } else if (host.endsWith('.visualstudio.com')) {
    // The old cloud address: {org}.visualstudio.com/{project}. Same server as dev.azure.com/{org}.
    collection = host.slice(0, -'.visualstudio.com'.length);
    project = head[0] || '';
    serverUrl = 'https://dev.azure.com';
  } else {
    // Server: an optional /tfs folder, then the collection, then the project (a team name may follow).
    const vdir = head.length && /^tfs$/i.test(head[0]) ? head[0] : '';
    const rest = vdir ? head.slice(1) : head;
    [collection = '', project = ''] = rest;
    serverUrl = `${u.protocol}//${u.host}${vdir ? '/' + encodeURIComponent(vdir) : ''}`;
  }
  if (!collection) throw new Error('The link has no collection in it. Copy a link from inside a project, for example a work item or a repo.');
  return { serverUrl, collection, project, repo };
}

function nameFor(parts, taken) {
  const want = String(parts.collection || 'work').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'work';
  const first = taken.size ? want : 'work';
  let name = first;
  for (let n = 2; taken.has(name); n++) name = `${first}-${n}`;
  return NAME.test(name) ? name : 'work';
}

/**
 * The current settings with the link's connection added (or filled in, when a connection for the same
 * server and collection exists), its project as the default project, and a PR source for that project
 * when there are none yet.
 */
export function configFromUrl(link, current) {
  const parts = parseAdoUrl(link);
  const cur = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const out = { ...cur };
  const connections = Array.isArray(cur.connections) ? cur.connections.map(c => ({ ...c })) : [];
  const notes = [];
  const base = baseOf(parts).toLowerCase();
  let conn = connections.find(c => baseOf(c).toLowerCase() === base);
  if (conn) {
    if (parts.project && !conn.project) { conn.project = parts.project; notes.push(`Connection "${conn.name}" already uses this server; its project is now ${parts.project}.`); }
    else notes.push(`Connection "${conn.name}" already uses this server and collection.`);
  } else {
    conn = { name: nameFor(parts, new Set(connections.map(c => c.name))), serverUrl: parts.serverUrl, collection: parts.collection, patEnv: 'ADO_PAT',
      apiVersion: '6.0', useSystemCa: true, verifyTls: true }; // set, not left to defaults: the form shows unset checkboxes as off
    if (parts.project) conn.project = parts.project;
    connections.push(conn);
    notes.push(`Added connection "${conn.name}": server ${parts.serverUrl}, collection ${parts.collection}${parts.project ? `, project ${parts.project}` : ''}.`);
  }
  out.connections = connections;
  if (!out.defaultConnection) out.defaultConnection = conn.name;

  const prSources = Array.isArray(cur.prSources) ? cur.prSources : [];
  if (parts.project && !prSources.length) {
    out.prSources = [{ connection: conn.name, project: parts.project, repos: [] }];
    notes.push(`Pull requests waiting on you will come from every repo in ${parts.project}.`);
  }
  notes.push(`Save your PAT with: workshop pat ${conn.patEnv || 'ADO_PAT'}`);
  return { config: out, notes, parts };
}

// "workitem.prs": the pull requests linked to a work item, and to its child items, with their status. Read only.
// Slate uses it to tell when everything for an item has merged (its Merged column).
//
// Links come from the item's relations: ArtifactLink urls shaped vstfs:///Git/PullRequestId/<project>%2F<repo>%2F<id>.
// Each PR is read once at project scope (GET <project>/_apis/git/pullrequests/<id>), the project being the
// link's own project id, so a PR in another project of the collection is found too.
import { AdoError, clientFor } from './client.mjs';
import { resolveConnection } from './config.mjs';
import { get, mapLimit, pyQuote } from './util.mjs';

const PR_LINK = /^vstfs:\/\/\/Git\/PullRequestId\/([^%/]+)(?:%2F|\/)([^%/]+)(?:%2F|\/)(\d+)$/i;
const CHILD = 'System.LinkTypes.Hierarchy-Forward';
const MAX_CHILDREN = 100;
const MAX_PRS = 60;

/** PR links in a relations list: [{project, repositoryId, id}]. */
export function prLinks(relations) {
  const out = [];
  for (const rel of relations || []) {
    const m = PR_LINK.exec(String(rel && rel.url || ''));
    if (m) out.push({ project: decodeURIComponent(m[1]), repositoryId: decodeURIComponent(m[2]), id: Number(m[3]) });
  }
  return out;
}

/** Child work item ids in a relations list. */
export function childIds(relations) {
  const out = [];
  for (const rel of relations || []) {
    if (!rel || rel.rel !== CHILD) continue;
    const m = /\/workItems\/(\d+)$/i.exec(String(rel.url || ''));
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/** Overall status of a set of PRs: 'none', 'open' (any active), 'merged' (all completed or abandoned, one completed), 'abandoned'. */
export function prsStatus(prs) {
  const live = (prs || []).filter(p => p.status !== 'missing');
  if (!live.length) return 'none';
  if (live.some(p => p.status === 'active')) return 'open';
  if (live.some(p => p.status === 'completed')) return 'merged';
  return 'abandoned';
}

/** @param {object} d {cfg, env, signal} */
export async function workItemPrs(d, args) {
  const r = resolveConnection(d.cfg, { connection: args.connection });
  const conn = r.connection;
  const ado = clientFor(conn, d.env, d.signal);
  let w;
  try {
    w = await ado.call('GET', `wit/workitems/${args.id}`, { query: { $expand: 'relations' } });
  } catch (e) {
    if (e instanceof AdoError && e.upstream === 404) throw new AdoError(`Work item ${args.id} was not found on connection "${conn.name}" (${conn.base}).`, 404);
    throw e;
  }
  const f = w.fields || {};
  const links = prLinks(w.relations).map(l => ({ ...l, workItemId: w.id }));
  const children = [];
  if (args.children !== false) {
    const ids = childIds(w.relations).slice(0, MAX_CHILDREN);
    if (ids.length) {
      const res = await ado.call('POST', 'wit/workitemsbatch', { body: { ids, $expand: 'Relations', errorPolicy: 'omit' } });
      for (const c of res.value || []) {
        if (!c || !c.id) continue;
        const cf = c.fields || {};
        children.push({ id: c.id, title: get(cf, 'System.Title', '') || '', type: get(cf, 'System.WorkItemType', '') || '', state: get(cf, 'System.State', '') || '' });
        for (const l of prLinks(c.relations)) links.push({ ...l, workItemId: c.id });
      }
    }
  }
  const seen = new Map();
  for (const l of links) if (!seen.has(l.id)) seen.set(l.id, l);
  const unique = [...seen.values()].slice(0, MAX_PRS);
  const prs = await mapLimit(unique, 4, async (l) => {
    let pr;
    try {
      pr = await ado.call('GET', `git/pullrequests/${l.id}`, { project: l.project });
    } catch (e) {
      if (e instanceof AdoError && (e.upstream === 404 || e.upstream === 403)) return { id: l.id, workItemId: l.workItemId, status: 'missing', title: '', repository: '', targetBranch: '', url: '', closed: null };
      throw e;
    }
    const repo = pr.repository || {};
    const projName = get(get(repo, 'project') || {}, 'name') || '';
    const repoName = String(repo.name || '');
    return {
      id: l.id,
      workItemId: l.workItemId,
      status: String(pr.status || ''),
      title: String(pr.title || ''),
      repository: repoName,
      targetBranch: String(pr.targetRefName || '').replace(/^refs\/heads\//, ''),
      url: projName && repoName ? `${ado.base}/${pyQuote(projName)}/_git/${pyQuote(repoName)}/pullrequest/${l.id}` : '',
      closed: pr.closedDate || null
    };
  });
  return {
    id: w.id,
    type: get(f, 'System.WorkItemType', '') || '',
    state: get(f, 'System.State', '') || '',
    rev: w.rev || null,
    connection: conn.name,
    children,
    prs,
    status: prsStatus(prs),
    truncated: seen.size > MAX_PRS
  };
}

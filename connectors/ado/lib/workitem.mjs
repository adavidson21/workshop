// "workitem.get": one work item with the connection used, so a caller (Settings' Test field, or
// eng-agents /start through the agent) can show title, type and project and ask before acting.
// Picks the connection the way eng-agents Get-WorkItem.ps1 does, minus the git remote lookup.
import { AdoError, clientFor } from './client.mjs';
import { resolveConnection } from './config.mjs';
import { get, pyQuote } from './util.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** ADO rich text to plain text. Same steps as ConvertFrom-AdoHtml in eng-agents. */
export function htmlToText(html) {
  if (!html) return '';
  let t = String(html);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '\n- ');
  t = t.replace(/<\/(td|th)>/gi, ' | ');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** What connection would be used, without calling ADO. */
export function connectionInfo(cfg, args) {
  const r = resolveConnection(cfg, { connection: args.connection, path: args.path });
  const c = r.connection;
  return { connection: c.name, reason: r.reason, serverUrl: c.serverUrl, collection: c.collection, project: r.project || '', base: c.base, patEnv: c.patEnv };
}

/** @param {object} d {cfg, env, signal} */
export async function getWorkItem(d, args) {
  const r = resolveConnection(d.cfg, { connection: args.connection, path: args.path });
  const conn = r.connection;
  const ado = clientFor(conn, d.env, d.signal);
  let w;
  try {
    w = await ado.call('GET', `wit/workitems/${args.id}`, { query: { $expand: 'relations' } });
  } catch (e) {
    if (e instanceof AdoError && e.upstream === 404) {
      throw new AdoError(`Work item ${args.id} was not found on connection "${conn.name}" (${conn.base}).`, 404);
    }
    throw e;
  }
  const f = w.fields || {};
  const project = get(f, 'System.TeamProject') || r.project || '';
  const href = get(get(get(w, '_links') || {}, 'html') || {}, 'href');
  const url = href || (project ? `${ado.base}/${pyQuote(project)}/_workitems/edit/${w.id}` : `${ado.base}/_workitems/edit/${w.id}`);
  const out = {
    id: w.id,
    title: get(f, 'System.Title', ''),
    type: get(f, 'System.WorkItemType', ''),
    state: get(f, 'System.State', ''),
    project,
    connection: conn.name,
    reason: r.reason,
    url
  };
  if (args.details) {
    const related = [];
    for (const rel of w.relations || []) {
      const m = /\/workItems\/(\d+)$/i.exec(String(rel.url || ''));
      if (m) related.push({ name: get(rel.attributes || {}, 'name') || rel.rel || '', id: Number(m[1]) });
    }
    Object.assign(out, {
      area: get(f, 'System.AreaPath', ''),
      iteration: get(f, 'System.IterationPath', ''),
      tags: get(f, 'System.Tags', ''),
      description: htmlToText(get(f, 'System.Description')),
      acceptanceCriteria: htmlToText(get(f, 'Microsoft.VSTS.Common.AcceptanceCriteria')),
      reproSteps: htmlToText(get(f, 'Microsoft.VSTS.TCM.ReproSteps')),
      related
    });
  }
  return out;
}

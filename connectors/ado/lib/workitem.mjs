// "workitem.get": one work item with the connection used, so a caller (Settings' Test field, or
// eng-agents /start through the agent) can show title, type and project and ask before acting.
// Picks the connection the way eng-agents Get-WorkItem.ps1 does, minus the git remote lookup.
import { AdoError, clientFor } from './client.mjs';
import { resolveConnection } from './config.mjs';
import { asInt, get, pyQuote, who } from './util.mjs';

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
    rev: Number(w.rev) || 0,
    project,
    connection: conn.name,
    reason: r.reason,
    url
  };
  if (args.details) {
    const related = [];
    const pullRequests = [];
    for (const rel of w.relations || []) {
      const m = /\/workItems\/(\d+)$/i.exec(String(rel.url || ''));
      if (m) related.push({ name: get(rel.attributes || {}, 'name') || rel.rel || '', id: Number(m[1]) });
      const pr = /^vstfs:\/\/\/Git\/PullRequestId\/([^%/]+)(?:%2F|\/)([^%/]+)(?:%2F|\/)(\d+)$/i.exec(String(rel.url || ''));
      if (pr) pullRequests.push({ id: Number(pr[3]), repositoryId: pr[2] });
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
    // Added for the Queue app; callers that do not ask get the shape above unchanged.
    if (args.html) {
      out.html = {
        description: String(get(f, 'System.Description') || ''),
        acceptanceCriteria: String(get(f, 'Microsoft.VSTS.Common.AcceptanceCriteria') || ''),
        reproSteps: String(get(f, 'Microsoft.VSTS.TCM.ReproSteps') || '')
      };
    }
    if (args.pullRequests) out.pullRequests = pullRequests;
  }
  if (args.extras) Object.assign(out, await extras(ado, w, f, args));
  if (args.comments) out.comments = await comments(ado, conn, project, w.id);
  if (args.history) out.history = await history(ado, w.id);
  return out;
}

/**
 * "workitem.find": an id looked up on every connection, since ids are unique only within a collection. Returns
 * {id, matches: [workitem.get's short shape, plus area and rev], failed: [{connection, message}]}: a 404 is "not
 * there", anything else (no PAT, server down) is a failure, so a caller never mistakes "could not ask" for "not
 * there". With one connection it is one read.
 */
export async function findWorkItem(d, args) {
  const matches = [];
  const failed = [];
  for (const c of d.cfg.connections) {
    try {
      const w = await getWorkItem(d, { id: args.id, connection: c.name, details: true });
      matches.push({ id: w.id, title: w.title, type: w.type, state: w.state, project: w.project, connection: w.connection, url: w.url, area: w.area || '', rev: w.rev || 0 });
    } catch (e) {
      if (e instanceof AdoError && e.upstream === 404) continue;
      failed.push({ connection: c.name, message: e && e.message ? e.message : 'Could not read it.' });
    }
  }
  return { id: args.id, matches, failed };
}

/** Story points fields tried in order when a caller names none: Agile's Story Points, then Scrum's Effort. */
export const POINTS_FIELDS = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort'];

/** The first number set in `refs`, or null. */
export function pointsOf(fields, refs = POINTS_FIELDS) {
  for (const r of refs) {
    const v = get(fields, r);
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** ADO tags ("a; b") as a list. */
export const tagList = (v) => String(v || '').split(';').map(t => t.trim()).filter(Boolean);

/** Any field value as plain text: rich text converted, identities by name, everything else as a string. */
export function fieldText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return who(v)?.name || '';
  const s = String(v);
  return /<[a-z][^>]*>/i.test(s) ? htmlToText(s) : s;
}

const MAX_LINKS = 50;

/**
 * More of the item for Slate's panel: assignee, priority, severity, story points, system info, comment count,
 * links (work items with their title, type and state; hyperlinks; attachments) and any fields asked for by
 * reference name (`fields`, as plain text in `custom`). The related items cost one batch call.
 */
async function extras(ado, w, f, args) {
  const items = [];
  const hyperlinks = [];
  const attachments = [];
  let pullRequests = 0;
  for (const rel of w.relations || []) {
    const url = String(rel.url || '');
    const name = get(rel.attributes || {}, 'name') || rel.rel || '';
    const m = /\/workItems\/(\d+)$/i.exec(url);
    if (m) { if (items.length < MAX_LINKS) items.push({ id: Number(m[1]), name }); continue; }
    if (rel.rel === 'Hyperlink' && /^https?:\/\//i.test(url)) { if (hyperlinks.length < MAX_LINKS) hyperlinks.push({ url, comment: String(get(rel.attributes || {}, 'comment') || '') }); continue; }
    if (rel.rel === 'AttachedFile') { if (attachments.length < MAX_LINKS) attachments.push({ name: String(get(rel.attributes || {}, 'name') || 'Attachment'), url }); continue; }
    if (/^vstfs:\/\/\/Git\/PullRequestId\//i.test(url)) pullRequests++;
  }
  if (items.length) {
    try {
      const found = await ado.details([...new Set(items.map(i => i.id))]);
      for (const i of items) {
        const r = found.get(i.id);
        if (!r) continue;
        const rf = r.fields || {};
        const project = get(rf, 'System.TeamProject') || '';
        const href = get(get(get(r, '_links') || {}, 'html') || {}, 'href');
        Object.assign(i, {
          title: get(rf, 'System.Title', '') || '',
          type: get(rf, 'System.WorkItemType', '') || '',
          state: get(rf, 'System.State', '') || '',
          url: href || (project ? `${ado.base}/${pyQuote(project)}/_workitems/edit/${i.id}` : `${ado.base}/_workitems/edit/${i.id}`)
        });
      }
    } catch { /* titles are a nicety: the ids still show */ }
  }
  const custom = {};
  for (const ref of args.fields || []) custom[ref] = fieldText(get(f, ref));
  const sev = get(f, 'Microsoft.VSTS.Common.Severity');
  return {
    assignee: who(get(f, 'System.AssignedTo')),
    priority: asInt(get(f, 'Microsoft.VSTS.Common.Priority')),
    severity: sev ? String(sev) : '',
    storyPoints: pointsOf(f, args.pointsFields && args.pointsFields.length ? args.pointsFields : POINTS_FIELDS),
    systemInfo: htmlToText(get(f, 'Microsoft.VSTS.TCM.SystemInfo')),
    commentCount: asInt(get(f, 'System.CommentCount')),
    links: { items, hyperlinks, attachments, pullRequests },
    custom
  };
}

/** The comments API version for a connection: the work item comments API is a preview on ADO Server 2020. */
export function commentsApi(conn) {
  return `${conn.apiVersion || '6.0'}-preview.3`;
}

/** Comments, oldest first. `html` is ADO's rich text (untrusted); `text` is plain. */
async function comments(ado, conn, project, id) {
  if (!project) return [];
  const res = await ado.call('GET', `wit/workItems/${id}/comments`, { project, api: commentsApi(conn), query: { $top: 200 } });
  return (res.comments || []).map(c => ({
    id: c.id,
    html: String(c.text || ''),
    text: htmlToText(c.text),
    by: who(c.createdBy),
    date: c.createdDate || null,
    edited: Boolean(c.modifiedDate && c.createdDate && c.modifiedDate !== c.createdDate)
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const HISTORY_FIELDS = {
  'System.State': 'state',
  'System.AssignedTo': 'assignee',
  'Microsoft.VSTS.Common.Priority': 'priority',
  'System.IterationPath': 'iteration',
  'System.AreaPath': 'area',
  'System.Tags': 'tags',
  'System.Title': 'title'
};

const plain = v => (v && typeof v === 'object' ? (who(v)?.name || '') : v ?? null);

/** Changes to the fields people care about, newest first, at most 50. */
async function history(ado, id) {
  const all = [];
  for (let skip = 0; skip < 1000; skip += 200) {
    const res = await ado.call('GET', `wit/workItems/${id}/updates`, { query: { $top: 200, $skip: skip } });
    const page = res.value || [];
    all.push(...page);
    if (page.length < 200) break;
  }
  const out = [];
  for (const u of all) {
    const changes = [];
    for (const [field, name] of Object.entries(HISTORY_FIELDS)) {
      const c = get(u.fields || {}, field);
      if (c && (c.oldValue !== undefined || c.newValue !== undefined)) changes.push({ field: name, from: plain(c.oldValue), to: plain(c.newValue) });
    }
    if (!changes.length && u.rev !== 1) continue;
    out.push({ rev: u.rev, by: who(u.revisedBy), date: get(get(u.fields || {}, 'System.ChangedDate') || {}, 'newValue') || u.revisedDate || null, changes });
  }
  return out.reverse().slice(0, 50);
}

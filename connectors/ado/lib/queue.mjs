// The team queue: open work items in a set of area paths, plus the lookups the Queue app needs to
// offer only values ADO accepts (states per type, sprints). All read-only.
import { AdoError, SettingsError, clientFor } from './client.mjs';
import { resolveConnection, syncConnection } from './config.mjs';
import { asInt, cleanList, day, get, or, pyQuote, truthy, who, wiqlList } from './util.mjs';

export const MAX_ITEMS = 2000;
const PATH_RE = /^[^\n\r\t'"]{1,400}$/;

/** The connection a queue call uses: `connection` by name, else the connection for my work items. */
export function queueConnection(cfg, args) {
  return args && args.connection ? resolveConnection(cfg, { connection: args.connection }).connection : syncConnection(cfg);
}

/** Web URL of a work item. */
export function itemUrl(ado, w, project) {
  const href = get(get(get(w, '_links') || {}, 'html') || {}, 'href');
  if (href) return href;
  return project ? `${ado.base}/${pyQuote(project)}/_workitems/edit/${w.id}` : `${ado.base}/_workitems/edit/${w.id}`;
}

/** Tags as a list. ADO stores them as "a; b". */
export function tagList(v) {
  return String(v || '').split(';').map(t => t.trim()).filter(Boolean);
}

/** One work item in the shape the Queue app keeps. */
export function queueItem(ado, w, connection) {
  const f = w.fields || {};
  const project = get(f, 'System.TeamProject') || '';
  return {
    id: w.id,
    rev: asInt(w.rev) ?? asInt(get(f, 'System.Rev')) ?? 0,
    type: get(f, 'System.WorkItemType', '') || '',
    title: get(f, 'System.Title', '') || '',
    state: get(f, 'System.State', '') || '',
    reason: get(f, 'System.Reason', '') || '',
    assignee: who(get(f, 'System.AssignedTo')),
    priority: asInt(get(f, 'Microsoft.VSTS.Common.Priority')),
    iteration: get(f, 'System.IterationPath', '') || '',
    area: get(f, 'System.AreaPath', '') || '',
    project,
    tags: tagList(get(f, 'System.Tags')),
    created: get(f, 'System.CreatedDate') || null,
    changed: get(f, 'System.ChangedDate') || null,
    stateChanged: get(f, 'Microsoft.VSTS.Common.StateChangeDate') || null,
    connection,
    url: itemUrl(ado, w, project)
  };
}

/** Who the PAT belongs to, from connectionData. Null if ADO does not say. */
export async function whoAmI(ado) {
  try {
    const res = await ado.call('GET', 'connectionData', { api: '1.0' });
    const u = or(get(res, 'authenticatedUser'), {});
    const account = get(get(get(u, 'properties') || {}, 'Account') || {}, '$value');
    const name = u.providerDisplayName || u.customDisplayName || '';
    if (!name && !account) return null;
    return { name: String(name), email: String(account || '').toLowerCase() };
  } catch (e) {
    if (e instanceof AdoError) return null;
    throw e;
  }
}

function checkAreas(areas) {
  const list = cleanList(areas, 50, 400);
  if (!list.length) throw new SettingsError('Add at least one area path for your team in the Queue settings.');
  for (const a of list) if (!PATH_RE.test(a)) throw new SettingsError('An area path has a character ADO does not allow. Check the Queue settings.');
  return list;
}

/**
 * "queue.list": open items in the team's areas.
 * args: {connection?, areas[], types?, includeClosed?, changedSince? (yyyy-mm-dd)}
 * @param {object} d {cfg, env, signal}
 */
export async function queueList(d, args = {}) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const areas = checkAreas(args.areas);
  const types = cleanList(args.types, 20, 100);
  const typeList = types.length ? types : d.cfg.types;
  const where = [
    `[System.WorkItemType] IN (${wiqlList(typeList)})`,
    `(${areas.map(a => `[System.AreaPath] UNDER ${wiqlList([a])}`).join(' OR ')})`
  ];
  if (!args.includeClosed) where.push(`[System.State] NOT IN (${wiqlList([...d.cfg.closedStates, ...d.cfg.removedStates])})`);
  if (args.changedSince) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.changedSince))) throw new SettingsError('changedSince must be a date like 2026-11-02.');
    where.push(`[System.ChangedDate] >= '${args.changedSince}'`);
  }
  const ids = await ado.wiql(where.join(' AND '));
  const truncated = ids.length > MAX_ITEMS;
  const wanted = ids.slice(0, MAX_ITEMS);
  const details = await ado.details(wanted);
  const items = [];
  for (const id of wanted) {
    const w = details.get(id);
    if (w) items.push(queueItem(ado, w, conn.name));
  }
  const me = await whoAmI(ado);
  return { connection: conn.name, me, items, total: ids.length, truncated, fetchedAt: new Date().toISOString() };
}

/** "workitem.states": the states a work item type allows, with their category. */
export async function workitemStates(d, args) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const project = args.project || conn.project;
  if (!project) throw new SettingsError('Say which project, or set one on the connection.');
  const res = await ado.call('GET', `wit/workitemtypes/${pyQuote(args.type)}/states`, { project });
  const states = (res.value || []).map(s => ({ name: String(s.name || ''), category: String(s.category || ''), color: s.color ? String(s.color) : null })).filter(s => s.name);
  return { connection: conn.name, project, type: args.type, states };
}

/** "iterations.list": sprints of a project as the paths work items use, with dates and which one is current. */
export async function iterationsList(d, args, now = new Date()) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const project = args.project || conn.project;
  if (!project) throw new SettingsError('Say which project, or set one on the connection.');
  const res = await ado.call('GET', 'wit/classificationnodes/Iterations', { project, query: { $depth: 10 } });
  const today = now.toISOString().slice(0, 10);
  const out = [];
  const walk = node => {
    let parts = String(get(node, 'path') || '').split('\\').filter(Boolean);
    if (parts.length >= 2 && parts[1].toLowerCase() === 'iteration') parts = [parts[0], ...parts.slice(2)];
    if (!parts.length) parts = [String(get(node, 'name') || project)];
    const attrs = or(get(node, 'attributes'), {});
    const start = truthy(attrs.startDate) ? day(attrs.startDate) : null;
    const finish = truthy(attrs.finishDate) ? day(attrs.finishDate) : null;
    out.push({ path: parts.join('\\'), name: parts[parts.length - 1], start, finish, current: Boolean(start && finish && start <= today && today <= finish) });
    for (const c of or(get(node, 'children'), [])) walk(c);
  };
  walk(res);
  return { connection: conn.name, project, iterations: out };
}

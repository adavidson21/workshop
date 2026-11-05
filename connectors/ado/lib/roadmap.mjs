// The roadmap: Epics and Features in a set of area paths, with how many child stories each Feature has and how
// many of those are done. Read-only. Built like queue.list: WIQL for ids, then batch GETs.
import { clientFor } from './client.mjs';
import { checkAreas, itemUrl, queueConnection } from './queue.mjs';
import { asInt, day, get, who, wiqlList } from './util.mjs';

export const MAX_ITEMS = 2000;
export const MAX_CHILDREN = 5000;
export const ROADMAP_TYPES = ['Epic', 'Feature'];
export const CHILD_TYPES = ['User Story', 'Issue'];
const CHUNK = 200;

/** One Epic or Feature in the shape the Roadmap app keeps. `assignee` is {name, email} (email lower case, '' when
    ADO gives none) or null when unassigned. */
export function roadmapItem(ado, w) {
  const f = w.fields || {};
  const project = get(f, 'System.TeamProject') || '';
  return {
    id: w.id,
    rev: asInt(w.rev) ?? asInt(get(f, 'System.Rev')) ?? 0,
    type: get(f, 'System.WorkItemType', '') || '',
    title: get(f, 'System.Title', '') || '',
    state: get(f, 'System.State', '') || '',
    area: get(f, 'System.AreaPath', '') || '',
    iteration: get(f, 'System.IterationPath', '') || '',
    parentId: asInt(get(f, 'System.Parent')),
    assignee: who(get(f, 'System.AssignedTo')),
    targetDate: day(get(f, 'Microsoft.VSTS.Scheduling.TargetDate')),
    startDate: day(get(f, 'Microsoft.VSTS.Scheduling.StartDate')),
    changed: get(f, 'System.ChangedDate') || null,
    url: itemUrl(ado, w, project)
  };
}

/** Parent and state of work items, by id, with only the fields counting needs. Missing ids are left out. */
async function parentsAndStates(ado, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await ado.call('POST', 'wit/workitemsbatch', { body: { ids: chunk, fields: ['System.Id', 'System.Parent', 'System.State'], errorPolicy: 'omit' } });
    for (const w of res.value || []) {
      if (!w || !w.id) continue;
      const f = w.fields || {};
      out.push({ id: w.id, parentId: asInt(get(f, 'System.Parent')), state: get(f, 'System.State', '') || '' });
    }
  }
  return out;
}

/**
 * "roadmap": Epics and Features under the areas, newest change first, at most MAX_ITEMS. Each Feature also has
 * storiesTotal and storiesDone: its User Story and Issue children, not counting won't-do states, and those in a
 * state that counts as done (closedStates).
 * With stories: true, those children are also returned in items (same shape, parentId is the Feature), open ones
 * only unless includeClosed. Callers that do not ask get Epics and Features only, as before.
 * args: {connection?, areas[], includeClosed?, stories?}
 * @param {object} d {cfg, env, signal}
 */
export async function roadmapList(d, args = {}) {
  const conn = queueConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const areas = checkAreas(args.areas, 'the Roadmap settings');
  const where = [
    `[System.WorkItemType] IN (${wiqlList(ROADMAP_TYPES)})`,
    `(${areas.map(a => `[System.AreaPath] UNDER ${wiqlList([a])}`).join(' OR ')})`
  ];
  if (!args.includeClosed) where.push(`[System.State] NOT IN (${wiqlList([...d.cfg.closedStates, ...d.cfg.removedStates])})`);
  const ids = await ado.wiql(where.join(' AND '));
  const truncated = ids.length > MAX_ITEMS;
  const wanted = ids.slice(0, MAX_ITEMS);
  const details = await ado.details(wanted);
  const items = [];
  for (const id of wanted) {
    const w = details.get(id);
    if (w) items.push(roadmapItem(ado, w));
  }

  // Child counts: stories under these Features, wherever their area is.
  const features = items.filter(i => i.type === 'Feature');
  const counts = new Map(features.map(f => [f.id, { storiesTotal: 0, storiesDone: 0 }]));
  let childIds = [];
  for (let i = 0; i < features.length; i += CHUNK) {
    const chunk = features.slice(i, i + CHUNK).map(f => f.id);
    const q = [`[System.WorkItemType] IN (${wiqlList(CHILD_TYPES)})`, `[System.Parent] IN (${chunk.join(', ')})`];
    if (d.cfg.removedStates.length) q.push(`[System.State] NOT IN (${wiqlList(d.cfg.removedStates)})`);
    const found = await ado.wiql(q.join(' AND '));
    childIds.push(...found);
  }
  childIds = [...new Set(childIds)];
  const childrenTruncated = childIds.length > MAX_CHILDREN;
  const done = new Set(d.cfg.closedStates);
  for (const c of await parentsAndStates(ado, childIds.slice(0, MAX_CHILDREN))) {
    const n = counts.get(c.parentId);
    if (!n) continue;
    n.storiesTotal++;
    if (done.has(c.state)) n.storiesDone++;
  }
  for (const f of features) Object.assign(f, counts.get(f.id));

  if (args.stories) {
    const ended = new Set([...d.cfg.closedStates, ...d.cfg.removedStates]);
    const kids = await ado.details(childIds.slice(0, MAX_CHILDREN));
    for (const id of childIds.slice(0, MAX_CHILDREN)) {
      const w = kids.get(id);
      if (!w) continue;
      const s = roadmapItem(ado, w);
      if (!counts.has(s.parentId) || !CHILD_TYPES.includes(s.type)) continue;
      if (!args.includeClosed && ended.has(s.state)) continue;
      items.push(s);
    }
  }

  return { connection: conn.name, items, total: ids.length, truncated, childrenTruncated, fetchedAt: new Date().toISOString() };
}

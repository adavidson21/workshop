// The roadmap: Epics and Features in a set of area paths, with how many child stories each Feature has and how
// many of those are done. Read-only. WIQL for ids, then batch GETs. Children are found through each Feature's
// Hierarchy-Forward links, not a WIQL filter on [System.Parent]: Azure DevOps Server 2020 refuses that filter
// ("The Parent field is not supported in the filter").
import { clientFor } from './client.mjs';
import { checkAreas, itemUrl, itemConnection } from './items.mjs';
import { asInt, day, get, who, wiqlList } from './util.mjs';
import { POINTS_FIELDS, fieldText, pointsOf, tagList } from './workitem.mjs';

export const MAX_ITEMS = 2000;
export const MAX_CHILDREN = 5000;
export const ROADMAP_TYPES = ['Epic', 'Feature'];
export const CHILD_TYPES = ['User Story', 'Issue'];
const CHUNK = 200;
const CHILD_LINK = 'System.LinkTypes.Hierarchy-Forward';
const PARENT_LINK = 'System.LinkTypes.Hierarchy-Reverse';

/** Work item ids linked from `w` by link type `rel`, in link order. */
function linked(w, rel) {
  const out = [];
  for (const r of (w && w.relations) || []) {
    if (!r || r.rel !== rel) continue;
    const m = /\/workItems\/(\d+)$/i.exec(String(r.url || ''));
    if (m) out.push(Number(m[1]));
  }
  return out;
}

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

/** `item` with `custom`: each field in `fields` (reference names) as plain text, at most `max` characters. No
    fields asked for: `item` as it is. Shared by `roadmap` (Runway's release notes) and `backlog` (Slate). */
export function withFields(item, w, fields, max = 500) {
  if (!Array.isArray(fields) || !fields.length) return item;
  const f = (w && w.fields) || {};
  item.custom = {};
  for (const ref of fields) item.custom[ref] = fieldText(get(f, ref)).slice(0, max);
  return item;
}

/** Type and state of work items, by id, with only the fields counting needs. Missing ids are left out. */
async function typesAndStates(ado, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await ado.call('POST', 'wit/workitemsbatch', { body: { ids: chunk, fields: ['System.Id', 'System.WorkItemType', 'System.State'], errorPolicy: 'omit' } });
    for (const w of res.value || []) {
      if (!w || !w.id) continue;
      const f = w.fields || {};
      out.push({ id: w.id, type: get(f, 'System.WorkItemType', '') || '', state: get(f, 'System.State', '') || '' });
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
 * With fields (reference names), each item also has `custom` with those fields as plain text (at most 2000
 * characters each), so Runway can show a release notes field.
 * args: {connection?, areas[], includeClosed?, stories?, fields?}
 * @param {object} d {cfg, env, signal}
 */
export async function roadmapList(d, args = {}) {
  const conn = itemConnection(d.cfg, args);
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
  const details = await ado.details(wanted, 'All');
  const items = [];
  const parentOf = new Map(); // child id -> Feature id, from the Features' child links
  for (const id of wanted) {
    const w = details.get(id);
    if (!w) continue;
    const item = withFields(roadmapItem(ado, w), w, args.fields, 2000);
    // System.Parent may be missing on older servers; the parent link says the same thing.
    if (item.parentId == null) item.parentId = linked(w, PARENT_LINK)[0] ?? null;
    if (item.type === 'Feature') for (const c of linked(w, CHILD_LINK)) if (!parentOf.has(c)) parentOf.set(c, item.id);
    items.push(item);
  }

  // Child counts: User Stories and Issues under these Features, wherever their area is, not removed.
  const features = items.filter(i => i.type === 'Feature');
  const counts = new Map(features.map(f => [f.id, { storiesTotal: 0, storiesDone: 0 }]));
  const linkedIds = [...parentOf.keys()];
  const removed = new Set(d.cfg.removedStates);
  const done = new Set(d.cfg.closedStates);
  const childIds = [];
  for (const c of await typesAndStates(ado, linkedIds)) {
    if (!CHILD_TYPES.includes(c.type) || removed.has(c.state)) continue;
    childIds.push(c.id);
    if (childIds.length > MAX_CHILDREN) continue;
    const n = counts.get(parentOf.get(c.id));
    n.storiesTotal++;
    if (done.has(c.state)) n.storiesDone++;
  }
  const childrenTruncated = childIds.length > MAX_CHILDREN;
  const kept = childIds.slice(0, MAX_CHILDREN);
  for (const f of features) Object.assign(f, counts.get(f.id));

  if (args.stories) {
    const ended = new Set([...d.cfg.closedStates, ...d.cfg.removedStates]);
    const kids = await ado.details(kept);
    for (const id of kept) {
      const w = kids.get(id);
      if (!w) continue;
      const s = withFields(roadmapItem(ado, w), w, args.fields, 2000);
      s.parentId = parentOf.get(id);
      if (!CHILD_TYPES.includes(s.type)) continue;
      if (!args.includeClosed && ended.has(s.state)) continue;
      items.push(s);
    }
  }

  return { connection: conn.name, items, total: ids.length, truncated, childrenTruncated, fetchedAt: new Date().toISOString() };
}

export const BACKLOG_TYPES = ['Epic', 'Feature', 'User Story', 'Product Backlog Item', 'Bug', 'Issue'];
export const MAX_BACKLOG = 500;

/** A backlog item: the roadmap shape plus what Slate's cards show (tags, priority, story points, comment count)
    and any fields asked for by reference name, as plain text in `custom`. */
export function backlogItem(ado, w, args = {}) {
  const f = w.fields || {};
  const out = {
    ...roadmapItem(ado, w),
    tags: tagList(get(f, 'System.Tags')),
    priority: asInt(get(f, 'Microsoft.VSTS.Common.Priority')),
    storyPoints: pointsOf(f, args.pointsFields && args.pointsFields.length ? args.pointsFields : POINTS_FIELDS),
    commentCount: asInt(get(f, 'System.CommentCount'))
  };
  return withFields(out, w, args.fields);
}

/**
 * "backlog" (Slate): open work items of BACKLOG_TYPES under the areas, in the roadmap shape, newest change first,
 * at most MAX_BACKLOG. Unlike roadmap, stories and bugs come whatever their parent, so a new request that sits
 * on its own shows. args: {connection?, areas[], types?, pointsFields?, fields?}. `types` narrows BACKLOG_TYPES;
 * `pointsFields` are tried in order for storyPoints; `fields` adds those fields to `custom`.
 */
export async function backlogList(d, args = {}) {
  const conn = itemConnection(d.cfg, args);
  const ado = clientFor(conn, d.env, d.signal);
  const areas = checkAreas(args.areas, 'Slate');
  const types = Array.isArray(args.types) && args.types.length ? BACKLOG_TYPES.filter(t => args.types.includes(t)) : BACKLOG_TYPES;
  const ended = [...d.cfg.closedStates, ...d.cfg.removedStates];
  const where = [
    `[System.WorkItemType] IN (${wiqlList(types)})`,
    `(${areas.map(a => `[System.AreaPath] UNDER ${wiqlList([a])}`).join(' OR ')})`
  ];
  if (ended.length) where.push(`[System.State] NOT IN (${wiqlList(ended)})`);
  const ids = await ado.wiql(where.join(' AND '));
  const wanted = ids.slice(0, MAX_BACKLOG);
  const details = await ado.details(wanted);
  const items = [];
  for (const id of wanted) {
    const w = details.get(id);
    if (w) items.push(backlogItem(ado, w, args));
  }
  items.sort((a, b) => String(b.changed || '').localeCompare(String(a.changed || '')));
  return { connection: conn.name, items, total: ids.length, truncated: ids.length > MAX_BACKLOG, fetchedAt: new Date().toISOString() };
}

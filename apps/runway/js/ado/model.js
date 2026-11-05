/* Runway's ADO side, pure: no DOM, no SDK, so Node tests drive it. Loaded only by js/ado/index.js, which main.js
   imports with a dynamic import() when Workshop on this computer is connected. Nothing else in Runway needs it.

   A roadmap can take items from Azure DevOps two ways (meta.ado.mode):
     live    a view of ADO. Every refresh rebuilds the lanes and items from ADO; items cannot be edited here.
             Title, scale, dates shown and goals are still yours.
     linked  imported once, then yours. Items keep an `ado` link. A refresh adds new work items, updates items you
             have not changed, and marks the ones that differ ("differs from ADO") without overwriting your edit.
             Linked and ad hoc items mix in one roadmap.
   Refresh never writes to ADO. Only Publish (publish.js, from a button) does.

   meta.ado: {mode, areas[], types[], lanes: 'area' | 'epic', connection, includeClosed, fetchedAt, total, truncated}
   item.ado: {id, connection, rev, type, state, url, assignee, iteration, project, ownDates, base: {title, start, end, status, who}, remote?, missing?}
     assignee ADO's Assigned To, {name, email}, or null
     iteration its sprint (Iteration Path), project its ADO project, ownDates true when ADO has its own start or
              target date (so its bar does not come from the sprint). Publish (publish.js) uses these three.
     base     what the last refresh brought, so a refresh can tell your edits from ADO's
     remote   ADO's values when they differ from yours (linked only)
     missing  true when the last refresh no longer found the work item

   Owners: Assigned To becomes the item's `who` when Workshop's people directory has someone with that Azure DevOps
   identity (adoIdentity: email, else exact display name). Someone it does not have leaves `who` empty and shows
   in the panel. Without a directory (not loaded, or another version) owners are left out of the refresh: `who`
   stays as it is. */
import { byAdoIdentity } from '../../shared/people.js';

export const TYPES = ['Epic', 'Feature', 'User Story'];
// Work item types that come in under the 'User Story' choice: the children the connector returns with stories: true.
export const DEFAULT_TYPES = ['Epic', 'Feature'];
export const STORY_TYPES = ['User Story', 'Issue'];
const SEP = ' > ';
export const LANE_MODES = ['area', 'epic'];
export const MODES = ['live', 'linked'];
const FIELDS = ['title', 'start', 'end', 'status', 'who'];
const MIN_SPAN = 14; // days a bar spans when only one end is known

const lower = s => String(s == null ? '' : s).toLowerCase();
const leaf = p => String(p || '').split('\\').filter(Boolean).pop() || String(p || '');
export const projectOf = p => String(p || '').split('\\')[0];
const under = (area, path) => { const a = lower(area), p = lower(path); return a === p || a.startsWith(p + '\\'); };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const httpUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

/** Clean the dialog's or a stored meta.ado. Returns null when there are no area paths. */
export function cleanSource(src) {
  if (!src || typeof src !== 'object') return null;
  const areas = [...new Set((Array.isArray(src.areas) ? src.areas : String(src.areas || '').split(/\r?\n/))
    .map(a => String(a).trim().replace(/\//g, '\\')).filter(Boolean).map(a => clip(a, 400)))].slice(0, 50);
  if (!areas.length) return null;
  const types = (Array.isArray(src.types) ? src.types : DEFAULT_TYPES).filter(t => TYPES.includes(t));
  return {
    ...src,
    mode: MODES.includes(src.mode) ? src.mode : 'linked',
    areas,
    types: types.length ? types : [...DEFAULT_TYPES],
    lanes: LANE_MODES.includes(src.lanes) ? src.lanes : 'area',
    connection: clip(String(src.connection || '').trim(), 40),
    includeClosed: !!src.includeClosed
  };
}

/** The connector's arguments for a source. */
export const roadmapArgs = src => ({ areas: src.areas, ...(src.includeClosed ? { includeClosed: true } : {}), ...(src.types.includes('User Story') ? { stories: true } : {}), ...(src.connection ? { connection: src.connection } : {}) });

/** Projects whose sprint dates are worth asking for (iterations.list). */
export function projectsOf(items, areas) {
  return [...new Set([...items.map(i => projectOf(i.iteration)), ...areas.map(projectOf)].filter(Boolean))];
}

/** Sprint dates by iteration path (lower case), from {project: [{path, start, finish}]}. */
export function iterationIndex(iterations) {
  const out = new Map();
  for (const list of Object.values(iterations || {})) for (const x of Array.isArray(list) ? list : []) {
    if (x && x.path && isDate(x.start) && isDate(x.finish)) out.set(lower(x.path), { start: x.start, end: x.finish });
  }
  return out;
}

/** Where a work item goes: its own start and target dates, else its sprint's dates, else nowhere. */
export function placeItem(item, iters) {
  const sprint = iters.get(lower(item.iteration)) || null;
  const s = isDate(item.startDate) ? item.startDate : null;
  const t = isDate(item.targetDate) ? item.targetDate : null;
  if (s && t) return s <= t ? { start: s, end: t } : { start: t, end: s };
  if (t) return { start: sprint && sprint.start <= t ? sprint.start : addDays(t, -MIN_SPAN), end: t };
  if (s) return { start: s, end: sprint && sprint.end >= s ? sprint.end : addDays(s, MIN_SPAN) };
  if (sprint) return { start: sprint.start, end: sprint.end };
  return { start: null, end: null };
}

const DONE = new Set(['done', 'closed', 'resolved', 'completed']);
const CUT = new Set(['removed', 'cut', "won't do", 'wont do', 'abandoned']);
const NOT_STARTED = new Set(['new', 'proposed', 'to do', 'approved', 'open', '']);

/** Runway's status for an ADO state. */
export function statusOf(state) {
  const s = lower(state).trim();
  if (DONE.has(s)) return 'done';
  if (CUT.has(s)) return 'cut';
  if (NOT_STARTED.has(s)) return 'planned';
  return 'active';
}

/** Owner ids for an ADO assignee: the directory's person with that ADO identity (email, then display name), or
    none. Undefined without a usable directory, so the refresh leaves owners alone. */
export function ownersOf(assignee, dir) {
  if (!dir || dir.unreadable) return undefined;
  if (!assignee) return [];
  const hit = (assignee.email && byAdoIdentity(dir, assignee.email)) || (assignee.name && byAdoIdentity(dir, assignee.name));
  return hit ? [hit.id] : [];
}

/** Where ADO keeps a work item's dates: its sprint, its project, and whether it has its own start or target date. */
const where = w => ({ iteration: clip(String(w.iteration || ''), 400), project: clip(projectOf(w.iteration) || projectOf(w.area), 200), ownDates: isDate(w.startDate) || isDate(w.targetDate) });

const cleanAssignee = a => (a && (a.name || a.email) ? { name: clip(a.name || a.email, 200), email: clip(String(a.email || '').toLowerCase(), 300) } : null);

/** The description Runway shows for a work item: type, id, state, story progress, then its ADO link. */
export function describe(w) {
  const bits = [`${w.type || 'Work item'} #${w.id}`, w.state].filter(Boolean);
  if (Number(w.storiesTotal) > 0) bits.push(`${Number(w.storiesDone) || 0} of ${Number(w.storiesTotal)} stories done`);
  const url = httpUrl(w.url);
  return clip(bits.join(' · ') + (url ? `\n${url}` : ''), 4000);
}

/**
 * Turn a `roadmap` result into lanes and items, keyed so a refresh finds them again.
 * lanes: [{key, title}] in order; items: [{key: <ado id>, laneKey, title, start, end, status, notes, ado}].
 * By area: one lane per area path of the source (the longest match wins), plus "Other".
 * By Epic: one lane per Epic (Epics are often versions, so lanes sort with numbers in order: v2.9 before v2.10),
 * holding its Features; an Epic with Features shows as a milestone on its target date, and as a bar when it has
 * none. Features without an Epic in the roadmap go to "No Epic".
 * User Stories (with types including 'User Story'): each story is a bar named "Feature > Story", in its Feature's
 * lane. A Feature whose stories are shown is not drawn as its own bar.
 * `dir` is Workshop's people directory, for owners (ownersOf); without it items carry no `who`.
 */
export function pulled(result, iterations, src, { dir = null } = {}) {
  const iters = iterationIndex(iterations);
  const all = (result && Array.isArray(result.items) ? result.items : []).filter(w => w && Number.isInteger(Number(w.id)));
  const wantStories = src.types.includes('User Story');
  const isStory = w => STORY_TYPES.includes(w.type);
  const features = new Map(all.filter(w => w.type === 'Feature').map(w => [Number(w.id), w]));
  const keep = all.filter(w => (isStory(w) ? wantStories && features.has(Number(w.parentId)) : src.types.includes(w.type)));
  const connection = String((result && result.connection) || src.connection || '');
  const lanes = [], laneSeen = new Set();
  const addLane = (key, title) => { if (!laneSeen.has(key)) { laneSeen.add(key); lanes.push({ key, title: clip(title || 'Lane', 80) }); } return key; };
  // A story sits where its Feature would.
  const anchor = w => (isStory(w) ? features.get(Number(w.parentId)) : w);
  let laneOf;
  if (src.lanes === 'epic') {
    const epics = new Map(all.filter(w => w.type === 'Epic').map(w => [Number(w.id), w]));
    const epicOf = w => { const a = anchor(w); return a.type === 'Epic' ? Number(a.id) : epics.has(Number(a.parentId)) ? Number(a.parentId) : null; };
    const hasKids = new Set(keep.filter(w => w.type !== 'Epic').map(epicOf).filter(id => id != null));
    for (const e of [...epics.values()].sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true }))) {
      if (hasKids.has(Number(e.id)) || keep.includes(e)) addLane(`epic:${e.id}`, e.title);
    }
    laneOf = w => { const id = epicOf(w); return id != null ? `epic:${id}` : addLane('epic:none', 'No Epic'); };
  } else {
    for (const a of src.areas) addLane(`area:${lower(a)}`, leaf(a));
    laneOf = w => {
      const at = anchor(w);
      let best = null, len = -1;
      for (const a of src.areas) if (under(at.area, a) && a.length > len) { best = a; len = a.length; }
      return best ? `area:${lower(best)}` : addLane('area:other', 'Other');
    };
  }
  const shownStoryParents = new Set(keep.filter(isStory).map(w => Number(w.parentId)));
  const items = [];
  for (const w of keep) {
    if (w.type === 'Feature' && shownStoryParents.has(Number(w.id))) continue;
    let p = placeItem(w, iters), milestone = false;
    if (src.lanes === 'epic' && w.type === 'Epic' && keep.some(f => f.type !== 'Epic' && laneOf(f) === `epic:${w.id}`)) {
      // The Epic is the lane; draw its release date, if it has one, as a milestone.
      const t = isDate(w.targetDate) ? w.targetDate : null;
      if (!t) continue;
      p = { start: t, end: t }; milestone = true;
    }
    const f = isStory(w) ? features.get(Number(w.parentId)) : null;
    const name = f ? `${String(f.title || `Feature #${f.id}`).trim()}${SEP}${String(w.title || `${w.type} #${w.id}`).trim()}` : (w.title || `${w.type} #${w.id}`);
    const who = ownersOf(w.assignee, dir);
    const fields = { title: clip(name, 200), start: p.start, end: p.end, status: statusOf(w.state), ...(who ? { who } : {}) };
    items.push({
      key: String(w.id), laneKey: laneOf(w), ...fields, milestone, notes: describe(w),
      ado: { id: Number(w.id), connection, rev: Number(w.rev) || 0, type: String(w.type || ''), state: String(w.state || ''), url: httpUrl(w.url), assignee: cleanAssignee(w.assignee), ...where(w), base: { ...fields } }
    });
  }
  // A Feature sits under its Epic when the Epic is an item in the same lane.
  const byKey = new Map(items.map(i => [i.key, i]));
  const all2 = new Map(keep.map(w => [String(w.id), w]));
  for (const it of items) {
    const w = all2.get(it.key);
    const p = w && w.parentId != null ? byKey.get(String(w.parentId)) : null;
    if (p && p.laneKey === it.laneKey) it.parentKey = p.key;
  }
  const used = new Set(items.map(i => i.laneKey));
  return { lanes: lanes.filter(l => used.has(l.key)), items };
}

const laneIdFor = key => `l-ado-${lower(key).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x'}`;
const fetchInfo = (result) => ({ fetchedAt: (result && result.fetchedAt) || new Date().toISOString(), total: Number(result && result.total) || 0, truncated: !!(result && result.truncated) });

/**
 * A live roadmap: lanes and items replaced by ADO's, with stable ids so selection and folded lanes survive.
 * Meta (title, scale, range, goals, folded lanes) is kept. Returns the new doc.
 */
export function applyLive(doc, data, src, result) {
  const lanes = data.lanes.map((l, i) => ({ id: laneIdFor(l.key), kind: 'lane', title: l.title, order: i, adoKey: l.key }));
  const laneId = new Map(lanes.map(l => [l.adoKey, l.id]));
  const counter = new Map();
  const before = new Map(doc.items.map(i => [i.id, i]));
  const items = data.items.map(it => {
    const lane = laneId.get(it.laneKey) || null;
    const order = counter.get(lane) || 0; counter.set(lane, order + 1);
    const id = `i-ado-${it.key}`;
    const who = it.who || (before.get(id) || {}).who || [];
    return { id, kind: 'item', lane, order, parent: it.parentKey ? `i-ado-${it.parentKey}` : null, title: it.title, start: it.start, end: it.end, size: null, milestone: !!it.milestone, status: it.status, color: '', notes: it.notes, who: [...who], dependsOn: [], afterMissing: [], ado: it.ado };
  });
  const ids = new Set(lanes.map(l => l.id));
  return { meta: { ...doc.meta, hidden: doc.meta.hidden.filter(h => ids.has(h)), ado: { ...src, mode: 'live', ...fetchInfo(result) } }, lanes, items };
}

const key = (f, v) => (f === 'who' ? [...(v || [])].sort().join(',') : v ?? null);
/** Equal on `fields` (all of FIELDS by default). */
const same = (a, b, fields = FIELDS) => fields.every(f => key(f, a[f]) === key(f, b[f]));
const pick = (o, fields = FIELDS) => Object.fromEntries(fields.map(f => [f, f === 'who' ? [...(o[f] || [])] : o[f] ?? null]));
/** A refresh without a directory brings no owners: compare and take everything but `who`, and keep the old base's. */
const fieldsOf = remote => ('who' in remote ? FIELDS : FIELDS.filter(f => f !== 'who'));

/**
 * A linked roadmap: merge ADO's items into yours. Returns {doc, added, updated, differs, missing}.
 * - New work items are added (to their ADO lane, made if needed).
 * - An item you have not changed since the last refresh takes ADO's values.
 * - An item you changed, whose ADO values also changed, gets `ado.remote` and is counted in differs.
 * - A linked item the refresh no longer finds gets `ado.missing`. It is never deleted.
 * Ad hoc items (no `ado`) are never touched.
 */
export function mergeLinked(doc, data, src, result) {
  const out = structuredClone(doc);
  const counts = { added: 0, updated: 0, differs: 0, missing: 0 };
  const laneByKey = new Map(out.lanes.filter(l => l.adoKey).map(l => [l.adoKey, l.id]));
  const ensureLane = (key) => {
    if (laneByKey.has(key)) return laneByKey.get(key);
    const def = data.lanes.find(l => l.key === key) || { title: 'Lane' };
    let id = laneIdFor(key);
    while (out.lanes.some(l => l.id === id)) id += '-x';
    out.lanes.push({ id, kind: 'lane', title: def.title, order: Math.max(-1, ...out.lanes.map(l => l.order)) + 1, adoKey: key });
    laneByKey.set(key, id);
    return id;
  };
  const byAdo = new Map(out.items.filter(i => i.kind === 'item' && i.ado && Number.isInteger(i.ado.id)).map(i => [i.ado.id, i]));
  const seen = new Set();
  for (const it of [...data.items].sort((a, b) => (a.parentKey ? 1 : 0) - (b.parentKey ? 1 : 0))) {
    seen.add(it.ado.id);
    const cur = byAdo.get(it.ado.id);
    const fields = fieldsOf(it);
    const remote = pick(it, fields);
    if (!cur) {
      const lane = ensureLane(it.laneKey);
      const order = Math.max(-1, ...out.items.filter(i => (i.lane || null) === lane).map(i => Number(i.order) || 0)) + 1;
      let id = `i-ado-${it.key}`;
      while (out.items.some(i => i.id === id)) id += '-x';
      const par = it.parentKey ? byAdo.get(Number(it.parentKey)) : null;
      const added = { id, kind: 'item', lane, order, parent: par && (par.lane || null) === lane ? par.id : null, who: [], ...remote, size: null, milestone: !!it.milestone, color: '', notes: it.notes, dependsOn: [], afterMissing: [], ado: { ...it.ado } };
      out.items.push(added);
      byAdo.set(it.ado.id, added);
      counts.added++;
      continue;
    }
    const base = pick(cur.ado.base || cur, fields);
    const mine = pick(cur, fields);
    const link = { ...cur.ado, connection: it.ado.connection, rev: it.ado.rev, type: it.ado.type, state: it.ado.state, url: it.ado.url, assignee: it.ado.assignee, iteration: it.ado.iteration, project: it.ado.project, ownDates: it.ado.ownDates };
    delete link.missing;
    // The new base, with the old base's owners when this refresh brought none.
    const nextBase = { ...pick(cur.ado.base || cur), ...remote };
    if (same(base, remote, fields)) {
      // ADO did not change. Keep yours; clear an old "differs" if you now match ADO.
      if (link.remote && same(mine, remote, fields)) delete link.remote;
      cur.ado = link;
    } else if (same(mine, base, fields) || same(mine, remote, fields)) {
      // You did not change it (or already match): take ADO's.
      Object.assign(cur, remote);
      delete link.remote;
      cur.ado = { ...link, base: nextBase };
      counts.updated++;
    } else {
      cur.ado = { ...link, base: nextBase, remote: nextBase };
      counts.differs++;
    }
  }
  for (const [id, cur] of byAdo) if (!seen.has(id)) { if (!cur.ado.missing) counts.missing++; cur.ado = { ...cur.ado, missing: true }; }
  out.meta = { ...out.meta, ado: { ...src, mode: 'linked', ...fetchInfo(result) } };
  return { doc: out, ...counts };
}

/** Use ADO's values for a linked item that differs. */
export function useRemote(doc, id) {
  const it = doc.items.find(i => i.id === id);
  if (!it || !it.ado || !it.ado.remote) return false;
  const r = it.ado.remote;
  Object.assign(it, pick(r, fieldsOf(r)));
  it.ado = { ...it.ado, base: { ...pick(it.ado.base || it), ...pick(r, fieldsOf(r)) } };
  delete it.ado.remote;
  return true;
}

/** Keep your values for a linked item that differs (until ADO changes it again). */
export function keepMine(doc, id) {
  const it = doc.items.find(i => i.id === id);
  if (!it || !it.ado || !it.ado.remote) return false;
  const r = it.ado.remote;
  it.ado = { ...it.ado, base: { ...pick(it.ado.base || it), ...pick(r, fieldsOf(r)) } };
  delete it.ado.remote;
  return true;
}

/** Turn a linked item into an ad hoc one. */
export function unlink(doc, id) {
  const it = doc.items.find(i => i.id === id);
  if (!it || !it.ado) return false;
  delete it.ado;
  return true;
}

/** Stop a roadmap following ADO. A live roadmap becomes an ordinary one; its items keep their links. */
export function stopFollowing(doc) {
  if (!doc.meta.ado) return false;
  const m = { ...doc.meta };
  delete m.ado;
  doc.meta = m;
  for (const l of doc.lanes) delete l.adoKey;
  return true;
}

export const isLive = doc => !!(doc && doc.meta && doc.meta.ado && doc.meta.ado.mode === 'live');

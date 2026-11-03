/* Queue: the rules, with no DOM or SDK, so Node tests can import them.
   Items come from the ADO connector's queue.list (connectors/ado/README.md), one shape for every item:
   {id, rev, type, title, state, reason, assignee: {name, email} | null, priority, iteration, area, project,
    tags[], created, changed, stateChanged, connection, url}. */

export const APP = 'queue';
export const VERSION = 1;
export const DEFAULT_TYPES = ['Issue', 'Bug', 'User Story'];

export const DEFAULT_SETTINGS = {
  connection: '',        // empty: the ADO connector's connection for my work items
  areas: [],             // area paths that are the team's work (UNDER)
  people: [],            // [{name, email}]: assign pickers and the Team view
  types: [],             // empty: Issue, Bug, User Story
  refreshMinutes: 15,
  staleDays: 7,
  meEmail: ''            // override when ADO does not say who the PAT belongs to
};

export const BUILT_IN_VIEWS = [
  { id: 'mine', name: 'Mine' },
  { id: 'team', name: 'Team' },
  { id: 'unassigned', name: 'Unassigned' },
  { id: 'sprint', name: 'Current sprint' },
  { id: 'all', name: 'All' }
];

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lower = s => String(s || '').toLowerCase();

/** Settings from the stored meta, cleaned, defaults filled in. */
export function cleanSettings(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const list = (v, max, size) => [...new Set((Array.isArray(v) ? v : []).map(x => str(x, size)).filter(Boolean))].slice(0, max);
  const people = [];
  for (const p of Array.isArray(m.people) ? m.people : []) {
    const name = str(p && p.name, 120);
    const email = lower(str(p && p.email, 200));
    if ((name || email) && !people.some(x => (email && x.email === email) || (!email && x.name === name))) people.push({ name: name || email, email });
  }
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  return {
    connection: str(m.connection, 40),
    areas: list(m.areas, 50, 400),
    people: people.slice(0, 100),
    types: list(m.types, 20, 100),
    refreshMinutes: int(m.refreshMinutes, 5, 240, DEFAULT_SETTINGS.refreshMinutes),
    staleDays: int(m.staleDays, 1, 90, DEFAULT_SETTINGS.staleDays),
    meEmail: lower(str(m.meEmail, 200))
  };
}

/** Who "me" is: the settings override, else what ADO said. */
export function meOf(settings, snapMe) {
  if (settings.meEmail) return { name: '', email: settings.meEmail };
  return snapMe && (snapMe.email || snapMe.name) ? { name: snapMe.name || '', email: lower(snapMe.email) } : null;
}

export function isMine(item, me) {
  if (!me || !item.assignee) return false;
  if (me.email && item.assignee.email) return lower(item.assignee.email) === me.email;
  return !!me.name && item.assignee.name === me.name;
}

export function onTeam(item, people) {
  if (!item.assignee) return false;
  const e = lower(item.assignee.email);
  return people.some(p => (p.email && e === p.email) || (!p.email && p.name === item.assignee.name));
}

const DAY = 864e5;
export function ageDays(iso, now) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.floor((now - t) / DAY) : null;
}

/** Stale: no change in ADO for `staleDays` or more. */
export function isStale(item, staleDays, now) {
  const a = ageDays(item.changed, now);
  return a !== null && a >= staleDays;
}

/** The category of an item's state ('Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed'), or ''. */
export function categoryOf(item, categories) {
  return (categories && categories[item.type] && categories[item.type][item.state]) || '';
}

/** Items for a built-in view. `ctx` is {me, people, currentIterations[]}. */
export function inView(item, viewId, ctx) {
  switch (viewId) {
    case 'mine': return isMine(item, ctx.me);
    case 'team': return ctx.people.length ? onTeam(item, ctx.people) : !!item.assignee;
    case 'unassigned': return !item.assignee;
    case 'sprint': return (ctx.currentIterations || []).includes(item.iteration);
    default: return true;
  }
}

export const EMPTY_FILTERS = { q: '', type: '', state: '', assignee: '', priority: '', tag: '', area: '', stale: false };

export function cleanFilters(f) {
  const x = f && typeof f === 'object' ? f : {};
  return {
    q: str(x.q, 200), type: str(x.type, 100), state: str(x.state, 100), assignee: str(x.assignee, 200),
    priority: str(String(x.priority ?? ''), 2), tag: str(x.tag, 100), area: str(x.area, 400), stale: x.stale === true
  };
}

/** Assignee filter key: an email, the name when ADO gives no email, or '-' for unassigned. */
export const assigneeKey = a => (a ? lower(a.email) || a.name : '-');

export function matches(item, f, { staleDays, now }) {
  if (f.type && item.type !== f.type) return false;
  if (f.state && item.state !== f.state) return false;
  if (f.assignee && assigneeKey(item.assignee) !== f.assignee) return false;
  if (f.priority && String(item.priority ?? '') !== f.priority) return false;
  if (f.tag && !item.tags.some(t => lower(t) === lower(f.tag))) return false;
  if (f.area && !(item.area === f.area || item.area.startsWith(f.area + '\\'))) return false;
  if (f.stale && !isStale(item, staleDays, now)) return false;
  if (f.q) {
    const q = lower(f.q);
    const hay = lower([item.id, item.title, item.state, item.type, item.assignee?.name, item.tags.join(' ')].join(' '));
    if (!q.split(/\s+/).every(w => hay.includes(w.replace(/^#/, '')))) return false;
  }
  return true;
}

export const SORTS = {
  changed: (a, b) => String(b.changed || '').localeCompare(String(a.changed || '')) || b.id - a.id,
  priority: (a, b) => (a.priority ?? 9) - (b.priority ?? 9) || String(b.changed || '').localeCompare(String(a.changed || '')),
  id: (a, b) => b.id - a.id,
  state: (a, b) => a.state.localeCompare(b.state) || b.id - a.id
};

/** The list for a view, filters and sort. */
export function visible(items, { viewId, filters, sort = 'changed', ctx, staleDays, now }) {
  const f = cleanFilters(filters);
  return items.filter(i => inView(i, viewId, ctx) && matches(i, f, { staleDays, now })).sort(SORTS[sort] || SORTS.changed);
}

/** Counts per built-in view, for the tabs. */
export function viewCounts(items, ctx) {
  const out = {};
  for (const v of BUILT_IN_VIEWS) out[v.id] = items.filter(i => inView(i, v.id, ctx)).length;
  return out;
}

/** Team view rows: one per person in settings, open items, in progress, stale, newest change. */
export function teamRows(items, { people, categories, staleDays, now }) {
  return people.map(p => {
    const mine = items.filter(i => onTeam(i, [p]));
    const changed = mine.map(i => i.changed).filter(Boolean).sort().pop() || null;
    return {
      name: p.name, email: p.email, key: p.email || p.name,
      open: mine.length,
      inProgress: mine.filter(i => categoryOf(i, categories) === 'InProgress').length,
      stale: mine.filter(i => isStale(i, staleDays, now)).length,
      changed
    };
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

/** Distinct values for the filter pickers. */
export function facets(items) {
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const people = new Map();
  for (const i of items) if (i.assignee) people.set(assigneeKey(i.assignee), i.assignee.name || i.assignee.email);
  return {
    types: uniq(items.map(i => i.type)),
    states: uniq(items.map(i => i.state)),
    tags: uniq(items.flatMap(i => i.tags)),
    areas: uniq(items.map(i => i.area)),
    assignees: [...people.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

/** Item ids whose ADO revision moved since you last opened them. `seen` is {id: rev}; unseen items are not "changed". */
export function changedSinceSeen(items, seen) {
  return new Set(items.filter(i => seen[i.id] !== undefined && seen[i.id] < i.rev).map(i => i.id));
}

/** What changed between two copies of an item, in plain words, for the conflict message. */
export function diffItems(before, after) {
  const out = [];
  const show = (label, a, b) => { if (a !== b) out.push(`${label}: ${a || 'none'} to ${b || 'none'}`); };
  show('State', before.state, after.state);
  show('Assigned to', before.assignee?.name, after.assignee?.name);
  show('Priority', before.priority == null ? '' : String(before.priority), after.priority == null ? '' : String(after.priority));
  show('Sprint', before.iteration, after.iteration);
  show('Title', before.title, after.title);
  show('Tags', before.tags.join(', '), after.tags.join(', '));
  return out;
}

/** "2 hours ago" style age. */
export function ago(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** The last part of an area or iteration path. */
export const leaf = p => String(p || '').split('\\').pop();

/** The project an area path belongs to (its first segment). */
export const projectOf = p => String(p || '').split('\\')[0];

/** What a change set means, in plain words, for the confirm dialog. */
export function describeChange(item, changes, labelFor = x => x) {
  const out = [];
  if (changes.state !== undefined) out.push(`State: ${item.state} to ${changes.state}`);
  if (changes.assignedTo !== undefined) out.push(`Assigned to: ${item.assignee ? item.assignee.name : 'nobody'} to ${changes.assignedTo ? labelFor(changes.assignedTo) : 'nobody'}`);
  if (changes.priority !== undefined) out.push(`Priority: ${item.priority ?? 'none'} to ${changes.priority}`);
  if (changes.iteration !== undefined) out.push(`Sprint: ${leaf(item.iteration) || 'none'} to ${leaf(changes.iteration)}`);
  if (changes.tagsAdd && changes.tagsAdd.length) out.push(`Add tag: ${changes.tagsAdd.join(', ')}`);
  if (changes.tagsRemove && changes.tagsRemove.length) out.push(`Remove tag: ${changes.tagsRemove.join(', ')}`);
  return out;
}

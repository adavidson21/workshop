/* The people directory (docs/people.md): the people and groups every app assigns work to.

   Pure: no DOM, no SDK, no storage. The SDK's `ws.people` reads and writes the directory with it, and apps
   use the query helpers (find, reach, involves, label) on the directory object `ws.people` gives them, so no
   app parses the collection or matches names itself.

   Storage: Settings' collection `people`, schema settings.people, version 2. Items are people (`p_` ids)
   and groups (`g_` ids). Apps keep references to either as ids and never copy names. */

export const APP = 'settings';
export const COLLECTION = 'people';
export const SCHEMA = 'settings.people';
export const VERSION = 2;

export const RELATIONS = ['self', 'report', 'manager', 'peer', 'contact'];
export const RELATION_LABEL = { self: 'You', report: 'Direct report', manager: 'Manager', peer: 'Peer', contact: 'Contact' };
const ORDER = { self: 0, manager: 1, report: 2, peer: 3, contact: 4 };

const PERSON_ID = /^p_[A-Za-z0-9_-]{1,100}$/;
const GROUP_ID = /^g_[A-Za-z0-9_-]{1,100}$/;
export const HANDLE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MEMBERS = 200;

export const isPersonId = id => PERSON_ID.test(id);
export const isGroupId = id => GROUP_ID.test(id);
export const isRef = id => isPersonId(id) || isGroupId(id);

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });

/** Whether an envelope can be read and written by this version. A missing directory is readable (empty). */
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION);

export function newId(kind = 'person', now = Date.now()) {
  return `${kind === 'group' ? 'g' : 'p'}_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const low = s => String(s || '').trim().toLowerCase();

/** A handle made from text: lower case, letters and digits joined by '-'. '' when nothing is left. */
export function slug(text) {
  return low(text).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '').slice(0, 40);
}

/** A handle for a new item that no active item uses: the first name, then the full name, then a number. */
export function makeHandle(name, taken = new Set()) {
  const words = low(name).split(/\s+/).filter(Boolean);
  const tries = [slug(words[0] || ''), slug(words.join('-'))].filter(Boolean);
  for (const h of tries) if (!taken.has(h)) return h;
  const base = tries[tries.length - 1] || 'someone';
  for (let i = 2; ; i++) { const h = `${base.slice(0, 36)}${i}`; if (!taken.has(h)) return h; }
}

/** Whether a person counts as on your team: `team` when set, else true for you and reports. */
export const onTeam = p => (typeof p.team === 'boolean' ? p.team : p.relation === 'self' || p.relation === 'report');

/** One item trimmed to the schema; unknown fields are kept (docs/data-format.md). Returns null for an item
    that is neither a person nor a group. */
export function cleanItem(it) {
  if (!it || typeof it !== 'object') return null;
  const base = { ...it, updatedAt: Number(it.updatedAt) || 0, name: str(it.name), handle: HANDLE.test(it.handle) ? it.handle : '', archived: !!it.archived };
  if (it.kind === 'group' || isGroupId(it.id)) {
    if (!isGroupId(it.id)) return null;
    const members = Array.isArray(it.members) ? [...new Set(it.members.filter(isPersonId))].slice(0, MAX_MEMBERS) : [];
    return { ...base, kind: 'group', members };
  }
  if (!isPersonId(it.id)) return null;
  const relation = RELATIONS.includes(it.relation) ? it.relation : 'contact';
  return {
    ...base, kind: 'person', relation,
    team: typeof it.team === 'boolean' ? it.team : relation === 'self' || relation === 'report',
    adoIdentity: str(it.adoIdentity), role: str(it.role), since: DAY.test(it.since) ? it.since : ''
  };
}

/* ---------- the directory object ---------- */

/** The directory from an envelope: {items, people, groups, byId, unreadable}. A missing envelope is an empty
    directory; one written by another version is empty with `unreadable: true` (never guessed at). */
export function directory(env) {
  const unreadable = !readable(env);
  const items = unreadable ? [] : (Array.isArray(env && env.items) ? env.items : []).map(cleanItem).filter(it => it && it.name);
  const byId = new Map(items.map(it => [it.id, it]));
  return {
    items, byId, unreadable, version: env ? env.version : VERSION,
    people: items.filter(it => it.kind === 'person'),
    groups: items.filter(it => it.kind === 'group')
  };
}

export const EMPTY = directory(null);
const live = d => d.items.filter(it => !it.archived);

/** Active items, people first by relation, then groups, each by name. For pickers. */
export function active(d, { kind, self = true } = {}) {
  return sorted(live(d).filter(it => (!kind || it.kind === kind) && (self || it.relation !== 'self')));
}

/** People by relation (you, manager, reports, peers, contacts), then groups, then archived; by name inside. */
export function sorted(items) {
  const rank = it => (it.kind === 'group' ? 5 : ORDER[it.relation] ?? 4);
  return [...items].sort((a, b) => (a.archived - b.archived) || (rank(a) - rank(b)) || a.name.localeCompare(b.name));
}

/** You, if set. */
export const self = d => live(d).find(it => it.kind === 'person' && it.relation === 'self') || null;
/** Your manager, if set. */
export const manager = d => live(d).find(it => it.kind === 'person' && it.relation === 'manager') || null;
/** People with a relation, active, by name. */
export const withRelation = (d, relation) => active(d, { kind: 'person' }).filter(p => p.relation === relation);
/** Active people on your team. */
export const team = d => active(d, { kind: 'person' }).filter(onTeam);

/** The item a handle or name points to: `@handle` or the exact handle, then the exact name (no case), then a
    first name only one active person has. Active items only. Null when nothing or more than one matches. */
export function find(d, token) {
  const t = low(String(token || '').replace(/^@/, ''));
  if (!t) return null;
  const items = live(d);
  const one = list => (list.length === 1 ? list[0] : null);
  return one(items.filter(it => it.handle === t))
    || one(items.filter(it => low(it.name) === t))
    || one(items.filter(it => it.kind === 'person' && low(it.name).split(/\s+/)[0] === t))
    || null;
}

/** Display name for an id, from the directory; `fallback` for an id it does not know (gone or tombstoned). */
export function label(d, id, fallback = 'Unknown') {
  const it = d.byId.get(id);
  return it ? it.name : fallback;
}

/** `@handle` for an id, or the name when it has no handle. */
export function mention(d, id) {
  const it = d.byId.get(id);
  return it ? (it.handle ? `@${it.handle}` : it.name) : '@unknown';
}

/** Active groups a person is in. */
export const groupsOf = (d, personId) => live(d).filter(it => it.kind === 'group' && it.members.includes(personId));

/** Active members of a group, as people. */
export function membersOf(d, groupId) {
  const g = d.byId.get(groupId);
  return g && g.kind === 'group' ? g.members.map(id => d.byId.get(id)).filter(p => p && !p.archived) : [];
}

/** Every id that counts as `id` when searching references: the id itself and, for a person, the active groups
    they are in. A task assigned to any of these involves them. */
export function reach(d, id) {
  const out = new Set([id]);
  if (isPersonId(id)) for (const g of groupsOf(d, id)) out.add(g.id);
  return out;
}

/** How a list of references involves `id`: 'direct' when it holds the id, the group's id when it holds a
    group the person is in, or null. */
export function involves(d, refs, id) {
  const list = Array.isArray(refs) ? refs : [];
  if (list.includes(id)) return 'direct';
  if (isPersonId(id)) { const g = groupsOf(d, id).find(x => list.includes(x.id)); if (g) return g.id; }
  return null;
}

/** References with every group swapped for its active members (people only, no duplicates). */
export function expand(d, refs) {
  const out = new Set();
  for (const id of Array.isArray(refs) ? refs : []) {
    if (isGroupId(id)) membersOf(d, id).forEach(p => out.add(p.id)); else if (isPersonId(id)) out.add(id);
  }
  return [...out];
}

/** The person whose ADO identity (email or display name) matches, without case. */
export function byAdoIdentity(d, identity) {
  const t = low(identity);
  return t ? live(d).find(it => it.kind === 'person' && low(it.adoIdentity) === t) || null : null;
}

/* ---------- changes (pure: they return new item arrays) ---------- */

const takenHandles = (items, exceptId) => new Set(items.filter(it => !it.archived && it.id !== exceptId && it.handle).map(it => it.handle));

/** Why an item can't be saved next to the others, or '' if it can. */
export function problem(item, items) {
  if (!item.name) return 'Enter a name.';
  if (!item.handle || !HANDLE.test(item.handle)) return 'Handles use lower-case letters, digits, dots, dashes or underscores.';
  if (!item.archived && takenHandles(items, item.id).has(item.handle)) {
    const other = items.find(it => !it.archived && it.id !== item.id && it.handle === item.handle);
    return `@${item.handle} is already ${other ? other.name : 'taken'}.`;
  }
  if (item.kind === 'person' && !item.archived && (item.relation === 'self' || item.relation === 'manager')) {
    const clash = items.find(it => it.id !== item.id && it.kind === 'person' && !it.archived && it.relation === item.relation);
    if (clash) return `${clash.name} is already ${item.relation === 'self' ? 'you' : 'your manager'}. Archive them or change their relation first.`;
  }
  if (item.kind === 'group' && item.members.some(id => !items.some(it => it.id === id && it.kind === 'person'))) return 'A member is not in the directory.';
  return '';
}

/** A new person or group ready to add: id, kind and a free handle filled in. Throws with the problem. */
export function create(input, items, now = Date.now()) {
  const kind = input.kind === 'group' ? 'group' : 'person';
  const draft = { ...input, kind, id: newId(kind, now), updatedAt: now };
  if (!draft.handle) draft.handle = makeHandle(input.name, takenHandles(items));
  if (kind === 'person' && !draft.relation) draft.relation = 'contact';
  const item = cleanItem(draft);
  const why = problem(item, items);
  if (why) throw Object.assign(new Error(why), { code: 'bad_request' });
  return item;
}

/** The item with `patch` applied. Throws with the problem. Kind and id never change. */
export function edit(item, patch, items, now = Date.now()) {
  const next = cleanItem({ ...item, ...patch, id: item.id, kind: item.kind, updatedAt: now });
  const why = problem(next, items);
  if (why) throw Object.assign(new Error(why), { code: 'bad_request' });
  return next;
}

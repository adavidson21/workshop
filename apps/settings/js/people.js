/* Settings: the people directory (docs/people.md). Pure logic, no DOM or SDK, so test/people.test.mjs can
   import it. settings.js draws the People card and saves through the SDK.

   The directory is Settings' collection `people` (schema settings.people, version 1). Only Settings writes
   it; other apps read it with {app: 'settings'}. People are archived, never deleted from the UI. */

export const COLLECTION = 'people';
export const SCHEMA = 'settings.people';
export const VERSION = 1;
export const RELATIONS = ['self', 'report', 'manager', 'peer'];
export const RELATION_LABEL = { self: 'You', report: 'Direct report', manager: 'Manager', peer: 'Peer' };
const ID = /^p_[A-Za-z0-9_-]{1,100}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });

export function newId(now = Date.now()) {
  return `p_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Whether a person counts as on your team, with the contract's default when `team` is missing. */
export const onTeam = p => (typeof p.team === 'boolean' ? p.team : p.relation === 'self' || p.relation === 'report');

/** One person, trimmed to the schema. Unknown fields are kept (docs/data-format.md). */
export function cleanPerson(p, now = Date.now()) {
  const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const relation = RELATIONS.includes(p && p.relation) ? p.relation : 'peer';
  const out = {
    ...(p || {}),
    id: ID.test(p && p.id) ? p.id : newId(now),
    updatedAt: Number(p && p.updatedAt) || 0,
    name: s(p && p.name),
    relation,
    team: typeof (p && p.team) === 'boolean' ? p.team : relation === 'self' || relation === 'report',
    adoIdentity: s(p && p.adoIdentity),
    role: s(p && p.role),
    since: DAY.test(p && p.since) ? p.since : '',
    archived: !!(p && p.archived),
  };
  return out;
}

/** Why a person can't be saved next to the others, or '' if it can. */
export function problem(person, people) {
  if (!person.name) return 'Enter a name.';
  if (!person.archived && (person.relation === 'self' || person.relation === 'manager')) {
    const clash = people.find(p => p.id !== person.id && !p.archived && p.relation === person.relation);
    if (clash) return `${clash.name} is already ${person.relation === 'self' ? 'you' : 'your manager'}. Archive them or change their relation first.`;
  }
  return '';
}

/** Active people first by relation (you, manager, reports, peers), then by name; archived last. */
const ORDER = { self: 0, manager: 1, report: 2, peer: 3 };
export function sorted(people) {
  return [...people].sort((a, b) => (a.archived - b.archived) || (ORDER[a.relation] - ORDER[b.relation]) || a.name.localeCompare(b.name));
}

/** Whether an envelope is a directory this Settings can read and write. */
export function readable(env) {
  return !env || (env.schema === SCHEMA && env.version === VERSION);
}

const key = s => String(s || '').trim().toLowerCase();

/** What an import from Receipts would do, without doing it.
    receipts: {people, config} envelopes (or null).
    Returns {add: [person], update: [{id, name, adoIdentity}], notes: [text]}. `update` is always empty
    since Queue (the only source of ADO identities) was removed; applyPlan still accepts it. Never changes
    the sources. */
export function importPlan({ receipts = {}, existing = [], now = Date.now() } = {}) {
  const add = [], update = [], notes = [];
  const known = [...existing];
  const findByName = n => known.find(p => key(p.name) === key(n));

  const rOk = !!receipts.people && receipts.people.schema === 'receipts.people' && receipts.people.version === 1;
  if (receipts.people && !rOk) notes.push('Rapport\'s people were saved by a different Rapport version, so they were skipped.');
  const rPeople = rOk ? receipts.people.items || [] : [];
  for (const r of rPeople) {
    if (!r || !r.name || known.some(p => p.id === r.id)) continue;
    if (findByName(r.name)) { notes.push(`${r.name} is already in the directory.`); continue; }
    if (!ID.test(r.id)) { notes.push(`${r.name} was skipped: their Rapport id can't be kept.`); continue; }
    const p = cleanPerson({ id: r.id, name: r.name, relation: 'report', role: r.role, since: r.since, archived: !!r.archived }, now);
    add.push(p); known.push(p);
  }

  const rMeta = receipts.config && receipts.config.schema === 'receipts.config' && receipts.config.meta;
  const upLabel = rMeta && typeof rMeta.upLabel === 'string' ? rMeta.upLabel.trim() : '';
  if (upLabel && !known.some(p => p.relation === 'manager' && !p.archived)) {
    if (findByName(upLabel)) notes.push(`${upLabel} is already in the directory.`);
    else { const p = cleanPerson({ name: upLabel, relation: 'manager' }, now); add.push(p); known.push(p); }
  }

  return { add, update, notes };
}

/** Applies an import plan to the directory's items (a copy). */
export function applyPlan(items, plan) {
  const out = items.map(p => {
    const u = plan.update.find(x => x.id === p.id);
    return u ? { ...p, adoIdentity: u.adoIdentity } : p;
  });
  return [...out, ...plan.add];
}

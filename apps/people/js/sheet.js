/* People: the spreadsheet template and importing a filled-in sheet (docs/people.md). Pure: rows in and out are
   arrays of cells, so main.js does the SheetJS reading and writing and test/sheet.test.mjs needs no browser.

   One sheet, one person per row. Columns, in any order (matched by header, case and spacing ignored):
     Name          required
     Handle        optional; filled in from the name when empty
     Relation      You, Manager, Direct report, Peer or Contact (blank: Contact, or unchanged for someone here)
     On my team    Yes or No (blank: yes for you and reports, no for everyone else)
     Azure DevOps  email or exact display name
     Role
     Groups        @handles, comma separated; groups that do not exist yet are made
   A row matches someone already here by handle, else by name (one active match only), and updates them.
   Everyone else is added. Groups only gain members; an import never removes anyone from a group. */
import * as P from '../../../shared/people.js';

export const SHEET = 'People';
export const COLUMNS = ['Name', 'Handle', 'Relation', 'On my team', 'Azure DevOps', 'Role', 'Groups'];
const KEY = { name: 'name', handle: 'handle', relation: 'relation', onmyteam: 'team', team: 'team', azuredevops: 'adoIdentity', ado: 'adoIdentity', adoidentity: 'adoIdentity', email: 'adoIdentity', role: 'role', groups: 'groups', group: 'groups' };
const REL = {
  you: 'self', self: 'self', me: 'self', manager: 'manager', 'my manager': 'manager',
  'direct report': 'report', report: 'report', 'direct reports': 'report', peer: 'peer', contact: 'contact'
};
export const MAX_ROWS = 2000;

/** The rows of the help sheet that goes with the template. */
export const HELP = [
  ['Column', 'What to put in it'],
  ['Name', 'Required. Full name.'],
  ['Handle', 'Optional. What you type after @ in Docket and quick capture. Filled in from the first name when empty.'],
  ['Relation', 'You, Manager, Direct report, Peer or Contact. Empty means Contact for someone new and no change for someone already here. At most one You and one Manager.'],
  ['On my team', 'Yes or No. Empty means yes for You and direct reports, no for everyone else.'],
  ['Azure DevOps', 'Optional. Their email or exact display name in Azure DevOps.'],
  ['Role', 'Optional. Their title.'],
  ['Groups', 'Optional. Group handles, comma separated, for example @leadership, @platform. New groups are made for you.'],
  [],
  ['Importing', 'A row with the handle or name of someone already in People updates them; other rows add someone. You see every change before anything is saved.']
];

const cell = v => (v == null ? '' : String(v)).trim();
const low = v => cell(v).toLowerCase().replace(/\s+/g, ' ');
const handleOf = v => low(v).replace(/^@/, '');

/** Rows for a sheet of the people here (template with nothing in it when `dir` is empty): header first. */
export function rows(dir) {
  const out = [COLUMNS.slice()];
  for (const p of P.active(dir, { kind: 'person' })) {
    out.push([p.name, p.handle, P.RELATION_LABEL[p.relation], P.onTeam(p) ? 'Yes' : 'No', p.adoIdentity, p.role,
      P.groupsOf(dir, p.id).map(g => '@' + g.handle).join(', ')]);
  }
  return out;
}

/** Rows from a sheet (arrays of cells, header first) as [{line, name, handle, relation, team, adoIdentity,
    role, groups, why}]. Blank rows are skipped. `why` says what is wrong with a row ('' when nothing is).
    Throws when there is no Name column. */
export function parse(table) {
  const list = (Array.isArray(table) ? table : []).filter(r => Array.isArray(r));
  const hi = list.findIndex(r => r.some(c => cell(c)));
  if (hi < 0) throw new Error('That sheet is empty.');
  const cols = list[hi].map(h => KEY[low(h).replace(/[^a-z]/g, '')] || null);
  if (!cols.includes('name')) throw new Error('That sheet has no Name column. Start from the template.');
  const out = [];
  for (let i = hi + 1; i < list.length && out.length < MAX_ROWS; i++) {
    const r = list[i];
    if (!r.some(c => cell(c))) continue;
    const f = {};
    cols.forEach((k, j) => { if (k && !(k in f && f[k])) f[k] = cell(r[j]); });
    const row = { line: i + 1, name: cell(f.name).slice(0, 200), handle: handleOf(f.handle).slice(0, 40), relation: '', team: null,
      adoIdentity: cell(f.adoIdentity).slice(0, 200), role: cell(f.role).slice(0, 200), groups: [], why: '' };
    const rel = low(f.relation);
    if (rel && !REL[rel]) row.why = `Relation "${cell(f.relation)}" is not one of You, Manager, Direct report, Peer or Contact.`;
    else if (rel) row.relation = REL[rel];
    const t = low(f.team);
    if (['yes', 'y', 'true', '1', 'x'].includes(t)) row.team = true;
    else if (['no', 'n', 'false', '0'].includes(t)) row.team = false;
    else if (t && !row.why) row.why = `On my team "${cell(f.team)}" should be Yes or No.`;
    row.groups = [...new Set(cell(f.groups).split(/[,;\s]+/).map(handleOf).filter(Boolean))];
    const badGroup = row.groups.find(h => !P.HANDLE.test(h));
    if (!row.name && !row.why) row.why = 'No name.';
    else if (row.handle && !P.HANDLE.test(row.handle) && !row.why) row.why = 'Handles use lower-case letters, digits, dots, dashes or underscores.';
    else if (badGroup && !row.why) row.why = `@${badGroup} is not a group handle Workshop can use.`;
    out.push(row);
  }
  return out;
}

const PERSON_FIELDS = ['name', 'handle', 'relation', 'team', 'adoIdentity', 'role'];
const FIELD_LABEL = { name: 'name', handle: 'handle', relation: 'relation', team: 'on my team', adoIdentity: 'Azure DevOps', role: 'role' };

/** What importing `parsed` into `dir` would do, checked with the directory's own rules:
    {rows: [{line, name, action: 'new' | 'update' | 'same' | 'skip', id, fields, changes, groups, why}],
     groups: [handles of groups to make], counts: {new, update, same, skip}}.
    Rows are checked in order against everything before them, so two rows cannot both be "you". */
export function plan(dir, parsed) {
  let items = dir.items.slice();
  const out = [];
  const used = new Set();
  const newGroups = [];
  for (const r of parsed) {
    const row = { line: r.line, name: r.name, action: 'skip', id: '', fields: null, changes: [], groups: r.groups, why: r.why };
    out.push(row);
    if (r.why) continue;
    const live = items.filter(it => it.kind === 'person' && !it.archived);
    let match = r.handle ? live.find(it => it.handle === r.handle) : null;
    if (!match) { const byName = live.filter(it => low(it.name) === low(r.name)); if (byName.length === 1) match = byName[0]; }
    if (match && used.has(match.id)) { row.why = `${match.name} is already on an earlier row.`; continue; }
    const relation = r.relation || (match ? match.relation : 'contact');
    const fields = { name: r.name, relation, adoIdentity: r.adoIdentity, role: r.role };
    if (r.handle) fields.handle = r.handle;
    if (r.team !== null) fields.team = r.team;
    else if (!match) fields.team = P.onTeam({ relation });
    try {
      if (match) {
        // Empty cells leave what is there.
        for (const k of ['adoIdentity', 'role']) if (!fields[k]) delete fields[k];
        const next = P.edit(match, fields, items);
        row.changes = PERSON_FIELDS.filter(k => next[k] !== match[k]).map(k => FIELD_LABEL[k]);
        row.id = match.id;
        used.add(match.id);
        items = items.map(it => (it.id === next.id ? next : it));
        const joins = r.groups.filter(h => !P.groupsOf({ items }, match.id).some(g => g.handle === h));
        row.fields = row.changes.length ? fields : null;
        row.action = row.changes.length || joins.length ? 'update' : 'same';
        if (joins.length) row.changes.push(...joins.map(h => `joins @${h}`));
      } else {
        const it = P.create({ ...fields, kind: 'person' }, items);
        items = [...items, it];
        row.action = 'new';
        row.id = it.id; // a placeholder; the saved id comes from ws.people
        row.fields = { ...fields, handle: it.handle };
      }
    } catch (e) { row.action = 'skip'; row.why = e.message; continue; }
    for (const h of r.groups) {
      const g = items.find(it => it.kind === 'group' && !it.archived && it.handle === h);
      if (!g && !newGroups.includes(h)) {
        const taken = items.find(it => !it.archived && it.handle === h);
        if (taken) { row.why = `@${h} is ${taken.name}, not a group; left out.`; row.groups = row.groups.filter(x => x !== h); continue; }
        newGroups.push(h);
      }
    }
  }
  const counts = { new: 0, update: 0, same: 0, skip: 0 };
  for (const r of out) counts[r.action]++;
  return { rows: out, groups: newGroups, counts };
}

/** A group name from a handle: "platform-team" becomes "Platform team". */
export const groupName = h => { const s = h.replace(/[._-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** The ws.people.saveMany lists that carry out `pl` against `dir`: people first, then (with their saved ids,
    `ids` maps each row's planned id to it) the groups to make and the groups that gain members. */
export function peopleChanges(pl) {
  return pl.rows.filter(r => r.action === 'new' || (r.action === 'update' && r.fields))
    .map(r => (r.action === 'new' ? { kind: 'person', ...r.fields } : { id: r.id, ...r.fields }));
}
export function groupChanges(dir, pl, ids) {
  const want = new Map(); // group handle -> person ids to add
  for (const r of pl.rows) {
    if (r.action === 'skip') continue;
    const id = ids.get(r.id) || r.id;
    for (const h of r.groups) want.set(h, [...(want.get(h) || []), id]);
  }
  const out = [];
  for (const [h, add] of want) {
    const g = dir.items.find(it => it.kind === 'group' && !it.archived && it.handle === h);
    if (g) {
      const members = [...new Set([...g.members, ...add])];
      if (members.length !== g.members.length) out.push({ id: g.id, members });
    } else if (pl.groups.includes(h)) out.push({ kind: 'group', name: groupName(h), handle: h, members: [...new Set(add)] });
  }
  return out;
}

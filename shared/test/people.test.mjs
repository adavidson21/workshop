/* shared/people.js (the directory model) and the SDK's ws.people over an in-memory store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../people.js';
import { _internals, WorkshopError } from '../workshop-sdk.js';

const env = (items, extra = {}) => ({ schema: P.SCHEMA, version: P.VERSION, rev: 1, items, ...extra });
const person = (id, name, relation = 'peer', extra = {}) => ({ id, kind: 'person', updatedAt: 1, name, handle: P.slug(name.split(' ')[0]), relation, ...extra });
const group = (id, name, members, extra = {}) => ({ id, kind: 'group', updatedAt: 1, name, handle: P.slug(name), members, ...extra });

const sample = () => P.directory(env([
  person('p_me', 'Alex Example', 'self'),
  person('p_john', 'John Smith', 'peer'),
  person('p_jane', 'Jane Doe', 'manager'),
  person('p_old', 'Old Timer', 'report', { archived: true }),
  person('p_vend', 'Vendor Rep', 'contact', { handle: 'vendor' }),
  group('g_lead', 'Leadership', ['p_john', 'p_jane', 'p_old']),
  group('g_gone', 'Old group', ['p_john'], { archived: true })
]));

test('directory: missing is empty, another version is unreadable and empty', () => {
  assert.equal(P.directory(null).items.length, 0);
  assert.equal(P.directory(null).unreadable, false);
  const d = P.directory({ schema: P.SCHEMA, version: 3, items: [{ id: 'p_a', name: 'A', relation: 'peer' }] });
  assert.equal(d.unreadable, true);
  assert.equal(d.items.length, 0);
});

test('upgrade: a version 1 directory reads as version 2 with handles; others are left alone', () => {
  const v1 = { schema: P.SCHEMA, version: 1, rev: 4, deleted: { p_x: 5 }, items: [
    { id: 'p_me', name: 'Alex Kim', relation: 'self', updatedAt: 1 },
    { id: 'p_a', name: 'Alex Lee', relation: 'report', role: 'Engineer', since: '2025-03-01', updatedAt: 1 },
    { id: 'p_old', name: 'Alex Kim', relation: 'peer', archived: true, updatedAt: 1 },
    { id: 'p_b', name: 'Sam', relation: 'manager', team: false, adoIdentity: 'sam@example.com', updatedAt: 1 }
  ] };
  const up = P.upgrade(v1);
  assert.equal(up.version, P.VERSION);
  assert.equal(up.rev, 4);
  assert.deepEqual(up.deleted, { p_x: 5 });
  assert.deepEqual(up.items.map(it => it.handle), ['alex', 'alex-lee', 'alex-kim', 'sam']);
  assert.ok(up.items.every(it => it.kind === 'person'));
  assert.equal(v1.version, 1, 'the stored envelope is not changed');
  const d = P.directory(v1);
  assert.equal(d.unreadable, false);
  assert.equal(d.people.length, 4);
  assert.equal(P.self(d).id, 'p_me');
  assert.equal(P.manager(d).adoIdentity, 'sam@example.com');
  assert.equal(P.find(d, '@alex-lee').id, 'p_a');
  for (const it of up.items) assert.equal(P.problem(P.cleanItem(it), up.items.map(P.cleanItem)), '', it.id);
  const v2 = { schema: P.SCHEMA, version: 2, items: [] };
  assert.equal(P.upgrade(v2), v2);
  assert.equal(P.upgrade(null), null);
});

test('directory: cleans items, splits people and groups, drops unknown ids', () => {
  const d = P.directory(env([
    { id: 'p_a', name: ' Ana ', relation: 'boss' },
    { id: 'g_t', kind: 'group', name: 'Team', members: ['p_a', 'p_a', 'g_x', 'junk'] },
    { id: 'x_1', name: 'Nobody' },
    { id: 'p_b', name: '' }
  ]));
  assert.deepEqual(d.people.map(p => [p.id, p.name, p.relation, p.team]), [['p_a', 'Ana', 'contact', false]]);
  assert.deepEqual(d.groups[0].members, ['p_a']);
  assert.equal(d.items.length, 2);
});

test('find: handle, then name, then a first name only one person has', () => {
  const d = sample();
  assert.equal(P.find(d, '@leadership').id, 'g_lead');
  assert.equal(P.find(d, 'JOHN').id, 'p_john');
  assert.equal(P.find(d, 'vendor rep').id, 'p_vend');
  assert.equal(P.find(d, 'old'), null, 'archived people are not found');
  assert.equal(P.find(d, ''), null);
  const twins = P.directory(env([person('p_1', 'Sam One', 'peer', { handle: 'sam1' }), person('p_2', 'Sam Two', 'peer', { handle: 'sam2' })]));
  assert.equal(P.find(twins, 'sam'), null, 'a shared first name matches neither');
});

test('reach and involves: a person counts through the active groups they are in', () => {
  const d = sample();
  assert.deepEqual([...P.reach(d, 'p_john')].sort(), ['g_lead', 'p_john']);
  assert.equal(P.involves(d, ['p_john'], 'p_john'), 'direct');
  assert.equal(P.involves(d, ['g_lead'], 'p_john'), 'g_lead');
  assert.equal(P.involves(d, ['g_gone'], 'p_john'), null, 'archived groups do not count');
  assert.equal(P.involves(d, ['p_vend'], 'p_john'), null);
  assert.equal(P.involves(d, ['g_lead'], 'g_lead'), 'direct');
});

test('expand and membersOf leave out archived people', () => {
  const d = sample();
  assert.deepEqual(P.membersOf(d, 'g_lead').map(p => p.id), ['p_john', 'p_jane']);
  assert.deepEqual(P.expand(d, ['g_lead', 'p_vend', 'p_john']).sort(), ['p_jane', 'p_john', 'p_vend']);
});

test('label, mention, self, manager, withRelation, team', () => {
  const d = sample();
  assert.equal(P.label(d, 'p_nope'), 'Unknown');
  assert.equal(P.mention(d, 'g_lead'), '@leadership');
  assert.equal(P.self(d).id, 'p_me');
  assert.equal(P.manager(d).id, 'p_jane');
  assert.deepEqual(P.withRelation(d, 'report'), []);
  assert.deepEqual(P.team(d).map(p => p.id), ['p_me']);
});

test('makeHandle: first name, then full name, then a number', () => {
  assert.equal(P.makeHandle('John Smith'), 'john');
  assert.equal(P.makeHandle('John Smith', new Set(['john'])), 'john-smith');
  assert.equal(P.makeHandle('John Smith', new Set(['john', 'john-smith'])), 'john-smith2');
  assert.equal(P.makeHandle('Zoë Ünder'), 'zoe');
});

test('create and edit: checks handles, one you, one manager, real members', () => {
  const d = sample();
  const g = P.create({ kind: 'group', name: 'QA team', members: ['p_john'] }, d.items, 5);
  assert.match(g.id, /^g_/);
  assert.equal(g.handle, 'qa');
  assert.throws(() => P.create({ name: 'Someone', handle: 'john' }, d.items), /already John Smith/);
  assert.throws(() => P.create({ name: 'Boss Two', relation: 'manager' }, d.items), /already your manager/);
  assert.throws(() => P.create({ kind: 'group', name: 'Ghosts', members: ['p_ghost'] }, d.items), /not in the directory/);
  const c = P.create({ name: 'New Person' }, d.items);
  assert.equal(c.relation, 'contact');
  const john = d.byId.get('p_john');
  assert.equal(P.edit(john, { name: 'John S.', kind: 'group', id: 'p_other' }, d.items).id, 'p_john');
  assert.throws(() => P.edit(john, { handle: 'Bad Handle' }, d.items), /Handles use/);
});

/* ---------- ws.people ---------- */

// The data layer the SDK hands peopleService: get, put with rev checks, subscribe.
function memoryData(start = null) {
  let stored = start ? structuredClone(start) : null;
  const subs = [];
  return {
    get stored() { return stored; },
    async get(app, col) { assert.equal(`${app}/${col}`, 'settings/people'); return stored ? structuredClone(stored) : null; },
    async put(app, col, e) {
      const rev = stored ? stored.rev : 0;
      if (e.rev !== rev) throw new WorkshopError('conflict');
      stored = { ...structuredClone(e), rev: rev + 1 };
      return { rev: stored.rev };
    },
    subscribe(app, col, fn) { subs.push(fn); return () => {}; },
    outside(next) { stored = next; subs.forEach(fn => fn({})); }
  };
}

test('ws.people: add creates the collection, update and setMembers change it, local subscribers hear', async () => {
  const data = memoryData();
  const people = _internals.peopleService(data);
  const heard = [];
  people.subscribe(d => heard.push(d.items.length));
  const john = await people.add({ name: 'John Smith', relation: 'peer' });
  const lead = await people.add({ kind: 'group', name: 'Leadership', members: [john.id] });
  assert.equal(data.stored.schema, 'settings.people');
  assert.equal(data.stored.version, 2);
  assert.deepEqual((await people.get()).groups.map(g => g.handle), ['leadership']);
  await people.update(john.id, { name: 'John Q. Smith' });
  await people.setMembers(lead.id, []);
  const d = await people.get();
  assert.equal(d.byId.get(john.id).name, 'John Q. Smith');
  assert.deepEqual(d.byId.get(lead.id).members, []);
  assert.deepEqual(heard, [1, 2, 2, 2]);
  await people.archive(john.id);
  assert.equal((await people.get()).byId.get(john.id).archived, true);
});

test('ws.people: keeps items it cannot parse, refuses another version, reports problems', async () => {
  const data = memoryData(env([{ id: 'weird', note: 'kept' }]));
  const people = _internals.peopleService(data);
  await people.add({ name: 'Ana' });
  assert.ok(data.stored.items.some(i => i.id === 'weird'), 'unknown item kept');
  await assert.rejects(people.add({ name: 'Ana Two', handle: 'ana' }), /@ana is already Ana/);
  assert.equal((await people.add({ name: 'Ana' })).handle, 'ana2', 'a second Ana gets a free handle');
  await assert.rejects(people.update('p_missing', { name: 'x' }), e => e.code === 'not_found');
  const newer = _internals.peopleService(memoryData({ schema: P.SCHEMA, version: 3, rev: 1, items: [] }));
  await assert.rejects(newer.add({ name: 'B' }), e => e.code === 'unsupported');
});

test('ws.people: retries after a conflict with a fresh read', async () => {
  const data = memoryData(env([person('p_a', 'Ana')]));
  const realPut = data.put.bind(data);
  let first = true;
  data.put = async (a, c, e) => {
    if (first) { first = false; data.outside(env([person('p_a', 'Ana'), person('p_b', 'Ben')], { rev: 2 })); }
    return realPut(a, c, e);
  };
  const people = _internals.peopleService(data);
  await people.add({ name: 'Cara' });
  assert.deepEqual((await people.get()).people.map(p => p.name).sort(), ['Ana', 'Ben', 'Cara']);
});

test('ws.people: a version 1 directory is read as version 2 and saved that way once', async () => {
  const data = memoryData({ schema: P.SCHEMA, version: 1, rev: 2, items: [
    { id: 'p_me', name: 'Pat Doe', relation: 'self', updatedAt: 1 },
    { id: 'p_r', name: 'Robin Roe', relation: 'report', updatedAt: 1 }
  ] });
  const people = _internals.peopleService(data);
  const d = await people.get();
  assert.equal(d.unreadable, false);
  assert.deepEqual(d.people.map(p => p.handle).sort(), ['pat', 'robin']);
  assert.equal(data.stored.version, 2);
  assert.equal(data.stored.rev, 3);
  await people.get();
  assert.equal(data.stored.rev, 3, 'nothing is written once it is version 2');
  await people.update('p_r', { role: 'Engineer' });
  assert.equal(data.stored.items.find(it => it.id === 'p_r').role, 'Engineer');
});

test('ws.people: a version 1 directory can be changed before anything read it', async () => {
  const data = memoryData({ schema: P.SCHEMA, version: 1, rev: 1, items: [{ id: 'p_a', name: 'Ann', relation: 'peer', updatedAt: 1 }] });
  const people = _internals.peopleService(data);
  await people.add({ name: 'Bo', relation: 'report' });
  assert.equal(data.stored.version, 2);
  assert.deepEqual(data.stored.items.map(it => it.handle), ['ann', 'bo']);
});

test('adopt: keeps ids, skips known, deleted and invalid ones, never a second you or manager', () => {
  const items = [P.cleanItem({ id: 'p_me', name: 'Pat Doe', relation: 'self', handle: 'pat' }), P.cleanItem({ id: 'p_m', name: 'Max', relation: 'manager', handle: 'max' })];
  const added = P.adopt([
    { id: 'p_r1', name: 'Robin Roe', relation: 'report', role: 'Engineer', since: '2025-01-02' },
    { id: 'p_me', name: 'Pat Again', relation: 'report' },
    { id: 'p_gone', name: 'Gone', relation: 'report' },
    { id: 'x_bad', name: 'Bad id', relation: 'report' },
    { id: 'p_noname', name: '  ', relation: 'report' },
    { id: 'p_m2', name: 'Other Boss', relation: 'manager' },
    { id: 'p_r2', name: 'Pat Roe', relation: 'report', archived: true }
  ], items, { p_gone: 5 }, 9);
  assert.deepEqual(added.map(it => it.id), ['p_r1', 'p_m2', 'p_r2']);
  assert.equal(added[0].role, 'Engineer');
  assert.equal(added[0].updatedAt, 9);
  assert.equal(added[1].relation, 'contact');
  assert.equal(added[2].archived, true);
  assert.deepEqual(added.map(it => it.handle), ['robin', 'other', 'pat-roe']);
});

test('ws.people.adopt: writes once, then nothing when everyone is there', async () => {
  const data = memoryData();
  const people = _internals.peopleService(data);
  const added = await people.adopt([{ id: 'p_a', name: 'Ann Lee', relation: 'report' }]);
  assert.deepEqual(added.map(it => it.id), ['p_a']);
  assert.equal(data.stored.rev, 1);
  assert.deepEqual(await people.adopt([{ id: 'p_a', name: 'Ann Lee', relation: 'report' }]), []);
  assert.equal(data.stored.rev, 1);
  assert.equal((await people.get()).byId.get('p_a').handle, 'ann');
});

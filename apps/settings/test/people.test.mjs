// The people directory's rules (docs/people.md). Run: node --test "apps/*/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import * as P from '../js/people.js';

const schemas = SchemaSet.fromDir(new URL('../../../docs/schemas', import.meta.url).pathname);
const NOW = 1793736000000;

test('cleanPerson matches the person schema and keeps unknown fields', () => {
  const p = P.cleanPerson({ name: '  Person One ', relation: 'report', extra: 1 }, NOW);
  assert.match(p.id, /^p_/);
  assert.equal(p.name, 'Person One');
  assert.equal(p.team, true);
  assert.equal(p.extra, 1);
  assert.deepEqual(schemas.validate('person', { ...p, updatedAt: NOW, extra: undefined }), []);
});

test('team defaults by relation, and an explicit value wins', () => {
  assert.equal(P.onTeam({ relation: 'self' }), true);
  assert.equal(P.onTeam({ relation: 'report' }), true);
  assert.equal(P.onTeam({ relation: 'peer' }), false);
  assert.equal(P.onTeam({ relation: 'manager' }), false);
  assert.equal(P.onTeam({ relation: 'peer', team: true }), true);
  assert.equal(P.cleanPerson({ name: 'X', relation: 'report', team: false }).team, false);
});

test('bad relation becomes peer; bad since is dropped; bad id is replaced', () => {
  const p = P.cleanPerson({ id: 'nope', name: 'X', relation: 'vendor', since: 'soon' });
  assert.equal(p.relation, 'peer');
  assert.equal(p.since, '');
  assert.match(p.id, /^p_/);
});

test('only one active self and one active manager', () => {
  const people = [P.cleanPerson({ id: 'p_me', name: 'Me', relation: 'self' }), P.cleanPerson({ id: 'p_boss', name: 'Boss', relation: 'manager' })];
  assert.match(P.problem(P.cleanPerson({ id: 'p_two', name: 'Other', relation: 'self' }), people), /already you/);
  assert.match(P.problem(P.cleanPerson({ id: 'p_m2', name: 'New boss', relation: 'manager' }), people), /already your manager/);
  assert.equal(P.problem(P.cleanPerson({ id: 'p_m2', name: 'Old boss', relation: 'manager', archived: true }), people), '');
  assert.equal(P.problem({ ...people[0], name: 'Me again' }, people), '');
  assert.equal(P.problem(P.cleanPerson({ name: '', relation: 'peer' }), people), 'Enter a name.');
});

test('sorted: you, manager, reports, peers, then archived', () => {
  const names = P.sorted([
    P.cleanPerson({ name: 'Zed', relation: 'peer' }), P.cleanPerson({ name: 'Ann', relation: 'report', archived: true }),
    P.cleanPerson({ name: 'Bo', relation: 'report' }), P.cleanPerson({ name: 'Me', relation: 'self' }), P.cleanPerson({ name: 'Boss', relation: 'manager' }),
  ]).map(p => p.name);
  assert.deepEqual(names, ['Me', 'Boss', 'Bo', 'Zed', 'Ann']);
});

test('readable: missing or v1 only', () => {
  assert.equal(P.readable(null), true);
  assert.equal(P.readable({ schema: 'settings.people', version: 1 }), true);
  assert.equal(P.readable({ schema: 'settings.people', version: 2 }), false);
});

const receipts = {
  people: { schema: 'receipts.people', version: 1, items: [
    { id: 'p_abc1', name: 'Person One', role: 'Engineer', since: '2025-03-01', archived: false },
    { id: 'p_abc2', name: 'Person Two', archived: true },
  ] },
  config: { schema: 'receipts.config', version: 1, items: [], meta: { upLabel: 'Boss Person' } },
};
test('import keeps Receipts ids and adds the manager', () => {
  const plan = P.importPlan({ receipts, existing: [], now: NOW });
  const byName = Object.fromEntries(plan.add.map(p => [p.name, p]));
  assert.equal(byName['Person One'].id, 'p_abc1');
  assert.equal(byName['Person One'].relation, 'report');
  assert.equal(byName['Person Two'].archived, true);
  assert.equal(byName['Boss Person'].relation, 'manager');
  assert.equal(plan.add.length, 3);
  assert.equal(plan.update.length, 0);
  for (const p of plan.add) assert.deepEqual(schemas.validate('person', { ...p, updatedAt: NOW }), []);
});

test('import again adds nothing; Queue settings are no longer a source', () => {
  const first = P.importPlan({ receipts, existing: [], now: NOW });
  const again = P.importPlan({ receipts, existing: P.applyPlan([], first), now: NOW });
  assert.equal(again.add.length, 0);
  assert.equal(again.update.length, 0);
  const queue = { schema: 'queue.settings', version: 1, items: [], meta: { people: [{ name: 'Peer Three', email: '' }] } };
  assert.deepEqual(P.importPlan({ queue, existing: [], now: NOW }), { add: [], update: [], notes: [] });
});

test('import skips an unknown Receipts version and does not change the sources', () => {
  const src = structuredClone(receipts);
  src.people.version = 2;
  const before = JSON.stringify(src);
  const plan = P.importPlan({ receipts: src, existing: [], now: NOW });
  assert.ok(plan.notes.some(n => /different Rapport version/.test(n)));
  assert.ok(!plan.add.some(p => p.id === 'p_abc1'));
  assert.equal(JSON.stringify(src), before);
});

test('settings.js escapes names it draws', () => {
  const src = fs.readFileSync(new URL('../js/settings.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('function personRow'), src.indexOf('async function importSources'));
  assert.match(block, /esc\(p\.name\)/);
  assert.doesNotMatch(block, /\$\{p\.name\}/);
});

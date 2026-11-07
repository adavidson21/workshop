// People's forms, and what they save matching the contract (docs/people.md).
// Run: node --test "apps/*/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import * as F from '../js/people-forms.js';
import * as P from '../../../shared/people.js';

const schemas = SchemaSet.fromDir(new URL('../../../docs/schemas', import.meta.url).pathname);
const NOW = 1793736000000;

test('personFields: trims, lowers the handle, defaults the relation', () => {
  const f = F.personFields([['name', '  Person One '], ['handle', '@One'], ['relation', 'boss'], ['team', 'on']]);
  assert.deepEqual(f, { name: 'Person One', handle: 'one', relation: 'contact', team: true, adoIdentity: '', role: '', owns: [] });
  assert.deepEqual(F.personFields([['name', 'X'], ['owns', 'Lighthouse, web-app\nWeb\\Team A, lighthouse']]).owns, ['Lighthouse', 'web-app', 'Web\\Team A']);
});

test('groupFields: checked members in order, without duplicates', () => {
  const f = F.groupFields([['name', 'Leadership'], ['handle', ''], ['member', 'p_a'], ['member', 'p_b'], ['member', 'p_a']]);
  assert.deepEqual(f, { name: 'Leadership', handle: '', members: ['p_a', 'p_b'] });
});

test('what the forms create matches the person and group schemas', () => {
  const me = P.create({ ...F.personFields([['name', 'Person One'], ['relation', 'self']]), handle: '' }, [], NOW);
  assert.deepEqual(schemas.validate('person', me), []);
  const g = P.create({ kind: 'group', ...F.groupFields([['name', 'Leadership'], ['member', me.id]]), handle: '' }, [me], NOW);
  assert.deepEqual(schemas.validate('person-group', g), []);
  assert.equal(g.handle, 'leadership');
});

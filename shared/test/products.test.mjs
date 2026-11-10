import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../products.js';
import { SchemaSet } from '../../tests/lib/schema.mjs';

const schemas = SchemaSet.fromDir(new URL('../../docs/schemas/', import.meta.url).pathname);

test('products: slugs from names match Folio product note names', () => {
  assert.equal(P.slugOf('Sample Portal'), 'sample-portal');
  assert.equal(P.slugOf('  Café / API v2!  '), 'cafe-api-v2');
  assert.equal(P.slugOf('---'), '');
  assert.equal(P.slugOf('x'.repeat(60)).length, 40);
  assert.match(P.slugOf('A'.repeat(39) + ' b'), P.SLUG);
  assert.equal(P.notePath({ slug: 'sample-portal' }), 'products/sample-portal.md');
});

test('products: form lists split on commas or lines, no repeats, capped', () => {
  assert.deepEqual(P.parseList(' Portal, SP ,portal\n\nOther'), ['Portal', 'SP', 'Other']);
  assert.deepEqual(P.parseList('A\\B, C\nD\\E', { lines: true }), ['A\\B, C', 'D\\E']);
  assert.equal(P.parseList(Array.from({ length: 50 }, (_, i) => 'r' + i), { max: P.MAX_REPOS }).length, P.MAX_REPOS);
  assert.deepEqual(P.fieldsOf({ name: ' Portal ', alsoCalled: 'SP', repos: ['ui', 'ui', ''], areas: 'Project\\Team\r\n' }),
    { name: 'Portal', alsoCalled: ['SP'], repos: ['ui'], areas: ['Project\\Team'] });
});

test('products: add, rename (slug kept), clash, archive and read back, matching docs/products.md', () => {
  let { items, product } = P.upsert([], { name: 'Sample Portal', alsoCalled: 'Portal', repos: 'Platform/Sample Portal/portal-ui', areas: 'Project\\Team\\Portal' });
  assert.equal(product.id, 'p_sample-portal');
  assert.equal(product.slug, 'sample-portal');
  assert.equal(product.archived, undefined);
  ({ items } = P.upsert(items, { name: 'Sample!Portal' }));
  assert.deepEqual(items.map(i => i.slug), ['sample-portal', 'sample-portal-2'], 'a second product with the same slug gets -2');
  assert.throws(() => P.upsert(items, { name: 'sample portal' }), /already a product called Sample Portal/);
  assert.throws(() => P.upsert(items, { name: '' }), /Give the product a name/);
  assert.throws(() => P.upsert(items, { name: '!!' }), /at least one letter/);
  assert.throws(() => P.upsert(items, { name: 'X' }, 'p_gone'), /not there anymore/);
  ({ items, product } = P.upsert(items, { name: 'Portal Next', repos: [] }, 'p_sample-portal'));
  assert.equal(product.slug, 'sample-portal', 'renaming keeps the slug');
  assert.equal(product.id, 'p_sample-portal');
  items = P.setArchived(items, 'p_sample-portal-2', true);
  const env = { ...P.blank(), items: items.map(i => ({ ...i, updatedAt: 1 })) };
  for (const i of env.items) assert.deepEqual(schemas.validate('product', i), []);
  assert.deepEqual(P.list(env).map(p => p.name), ['Portal Next', 'Sample!Portal']);
  assert.deepEqual(P.list(env, { archived: false }).map(p => p.name), ['Portal Next']);
  assert.equal(P.list({ ...env, items: P.setArchived(env.items, 'p_sample-portal-2', false) }, { archived: false }).length, 2);
});

test('products: the reader skips what is not a product and cleans the rest', () => {
  const env = { ...P.blank(), items: [null, { id: 'bad', slug: 'x', name: 'X' }, { id: 'p_a', slug: 'A b', name: 'A' }, { id: 'p_ok', slug: 'ok', name: ' Ok ', repos: ['r', 7, 'R'], updatedAt: 5 }] };
  assert.deepEqual(P.list(env), [{ id: 'p_ok', name: 'Ok', slug: 'ok', alsoCalled: [], repos: ['r'], areas: [], archived: false, updatedAt: 5 }]);
  assert.equal(P.readable(null), true);
  assert.equal(P.readable({ ...env, version: 2 }), false);
  assert.deepEqual(P.list(null), []);
});

test('products: owners from People "Owns", by name, other name, repo or area path', () => {
  const product = { name: 'Sample Portal', alsoCalled: ['SP'], repos: ['Platform/Sample Portal/portal-ui'], areas: ['Project\\Team\\Portal'] };
  const people = [
    { id: 'p1', kind: 'person', name: 'Bea', owns: ['sample portal'] },
    { id: 'p2', kind: 'person', name: 'Al', owns: ['portal-ui', 'Other'] },
    { id: 'p3', kind: 'person', name: 'Cy', owns: ['Project\\Team'] },
    { id: 'p4', kind: 'person', name: 'Di', owns: ['Portal'] },
    { id: 'p5', kind: 'person', name: 'Ed', owns: ['SP'], archived: true },
    { id: 'g1', kind: 'group', name: 'Leads', owns: ['SP'] },
    { id: 'p6', kind: 'person', name: 'Fay', owns: ['Project\\Team\\Portal\\Sub'] }
  ];
  assert.deepEqual(P.ownersOf(product, people).map(o => [o.name, o.hits]), [['Al', ['portal-ui']], ['Bea', ['sample portal']], ['Cy', ['Project\\Team']]]);
  assert.deepEqual(P.ownersOf(null, people), []);
});

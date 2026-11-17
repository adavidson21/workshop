import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as K from '../knowledge.js';
import * as G from '../glossary.js';
import * as P from '../products.js';
import { SchemaSet } from '../../tests/lib/schema.mjs';

const fx = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const schemas = SchemaSet.fromDir(new URL('../../docs/schemas/', import.meta.url).pathname);

test('glossary: rows become words with stable ids, problems named, matching the schema', () => {
  assert.equal(G.problem([{ term: 'Member', code: '' }]), 'Say what the code calls "Member".');
  assert.equal(G.problem([{ term: '', code: 'X' }]), 'Give the word for "X".');
  assert.match(G.problem([{ term: 'Member', code: 'A' }, { term: 'member', code: 'B' }]), /listed twice/);
  assert.equal(G.problem([{ term: 'Member', code: 'A' }, { term: 'member', code: 'B', productId: 'p_x' }]), '', 'the same word for another product is fine');
  const items = G.replaceAll([{ term: 'Plan year', code: 'CoverageYear' }, { term: 'Member', code: 'Subscriber', productId: 'p_sample-portal', where: 'a.cs' }, { term: ' ', code: ' ' }, { id: 'g_keep', term: 'Kept', code: 'K' }]);
  assert.deepEqual(items.map(i => i.id), ['g_plan-year', 'g_member', 'g_keep']);
  for (const it of items) assert.deepEqual(schemas.validate('glossary-term', { ...it, updatedAt: 1 }), []);
  const env = { ...G.blank(), items: [...items.map(i => ({ ...i, updatedAt: 1 })), { id: 'bad', term: 'x', code: 'y' }] };
  assert.deepEqual(G.list(env).map(w => w.term), ['Kept', 'Member', 'Plan year']);
  const words = G.list(env);
  assert.deepEqual(G.forProduct(words, 'p_sample-portal').map(w => w.term), ['Member', 'Kept', 'Plan year']);
  assert.deepEqual(G.forProduct(words, 'p_other').map(w => w.term), ['Kept', 'Plan year']);
  assert.deepEqual(G.forProduct(words, 'p_other', ['p_other']).map(w => w.term), ['Kept', 'Member', 'Plan year'], 'a word whose product is gone counts as any product');
  assert.ok(G.readable(null) && G.readable(env) && !G.readable({ ...env, version: 2 }));
});

test('knowledge: the eng-agents template on its own imports nothing but its real sections', () => {
  const t = K.parseRepoMap(fx('repo-map.template.md'));
  assert.deepEqual(t.repos, []);
  assert.deepEqual(t.products, []);
  assert.deepEqual(t.glossary, []);
  // Template sections with only filler are dropped; the one with a real rule is kept.
  assert.doesNotMatch(t.extra, /Local environment notes/);
  assert.match(t.extra, /## How the repos depend on each other/);
});

test('knowledge: a hand-written map is read: repos, a product with every field, the glossary, other sections', () => {
  const m = K.parseRepoMap(fx('repo-map.hand.md'));
  assert.deepEqual(m.repos.map(r => [r.folder, r.about]), [['shared-lib', 'Domain models and validation'], ['Platform/portal-api', 'Portal API'], ['Platform/portal-ui', 'Portal screens'], ['new-repo', '']]);
  assert.equal(m.products.length, 1, 'the template block is skipped');
  const p = m.products[0];
  assert.equal(p.name, 'Sample Portal');
  assert.deepEqual(p.alsoCalled, ['Portal', 'SP']);
  assert.deepEqual(p.repos, ['shared-lib', 'Platform/portal-api', 'Platform/portal-ui']);
  assert.deepEqual(p.together, ['Platform/portal-api + Platform/portal-ui']);
  assert.deepEqual(p.changeOrder, ['shared-lib', 'Platform/portal-api', 'Platform/portal-ui']);
  assert.deepEqual(p.entryPoints, ['Platform/portal-api/src/Api/OrdersController.cs']);
  assert.deepEqual(p.external, ['Payment gateway REST API', 'nightly reporting job']);
  assert.deepEqual(p.processes, ['Place an order', 'Issue a refund']);
  assert.equal(p.docsFolder, 'product-docs/portal');
  assert.deepEqual(m.glossary, [{ term: 'Member', code: 'Subscriber', product: 'Sample Portal', where: 'shared-lib/src/Domain/Subscriber.cs' }]);
  assert.match(m.extra, /## Do not touch\n\n- Generated clients/);
  assert.doesNotMatch(m.extra, /Local environment notes/);
});

test('knowledge: import adds only what Settings does not have', () => {
  const m = K.parseRepoMap(fx('repo-map.hand.md'));
  const fresh = K.importPlan(m, {});
  assert.equal(fresh.newProducts.length, 1);
  assert.equal(fresh.newProducts[0].docsFolder, 'product-docs/portal');
  assert.equal(fresh.abouts.length, 3);
  let { items } = P.upsert([], fresh.newProducts[0]);
  const stored = P.list({ ...P.blank(), items: items.map(i => ({ ...i, updatedAt: 1 })) });
  assert.deepEqual(stored[0].changeOrder, ['shared-lib', 'Platform/portal-api', 'Platform/portal-ui']);
  for (const it of items) assert.deepEqual(schemas.validate('product', { ...it, updatedAt: 1 }), []);
  // Again over what is now there: nothing new.
  const again = K.importPlan(m, { products: stored, repos: K.setAbouts([], fresh.abouts) });
  assert.equal(again.count, 0);
  // An existing product with fewer repos and its own change order: repos added, order kept.
  ({ items } = P.upsert([], { name: 'Portal', alsoCalled: 'SP', repos: 'shared-lib', changeOrder: 'shared-lib' }));
  const mine = P.list({ ...P.blank(), items });
  const plan = K.importPlan(m, { products: mine });
  assert.equal(plan.newProducts.length, 0, 'matched by another name');
  assert.deepEqual(plan.updates[0].added, ['alsoCalled', 'repos', 'together', 'entryPoints', 'external', 'processes', 'docsFolder']);
  assert.deepEqual(plan.updates[0].input.changeOrder, ['shared-lib']);
  assert.deepEqual(G.toAdd(m.glossary, [], mine).map(w => w.productId), [''], 'an unknown product name: any product');
  assert.deepEqual(G.toAdd(m.glossary, [], mine, plan.renamed).map(w => w.productId), ['p_portal'], 'a word\'s product found through the product it matched');
});

test('knowledge: the written map has the marker, the template shape, and reads back the same', () => {
  const m = K.parseRepoMap(fx('repo-map.hand.md'));
  const { items } = P.upsert([], K.importPlan(m, {}).newProducts[0]);
  const products = P.list({ ...P.blank(), items: items.map(i => ({ ...i, areas: ['Project\\Team\\Portal'] })) });
  const glossary = G.list({ ...G.blank(), items: G.replaceAll(G.toAdd(m.glossary, [], products)) });
  const people = [{ id: 'p_1', name: 'Person One', owns: ['Sample Portal'] }];
  const info = [{ folder: 'shared-lib', stack: 'dotnet', purpose: 'Shared code' }, { folder: 'Platform/portal-api', stack: 'dotnet' }, { folder: 'Platform/portal-ui', stack: 'angular' }, { folder: 'tools', stack: '', purpose: 'Build scripts' }];
  const text = K.buildRepoMap({ products, glossary, repos: K.setAbouts([], [{ folder: 'shared-lib', about: 'Domain models' }]), info, previous: fx('repo-map.hand.md'), people, extra: m.extra });
  assert.ok(K.isGenerated(text));
  assert.ok(!K.isGenerated(fx('repo-map.hand.md')));
  assert.match(text, /\| shared-lib \| Domain models \| dotnet \| No \|/, 'Settings wins over the old map');
  assert.match(text, /\| Platform\/portal-api \| Portal API \| dotnet \| No \|/, 'the old map\'s text is kept');
  assert.match(text, /\| tools \| Build scripts \|/, 'else the repo guide\'s purpose');
  assert.match(text, /\| new-repo \| TODO\(you\)/);
  assert.match(text, /### Sample Portal\n\nAlso called: Portal, SP\n\nNote: `products\/sample-portal.md`/);
  assert.match(text, /- Owners: Person One/);
  assert.match(text, /\| Member \| `Subscriber` \| Sample Portal \| `shared-lib\/src\/Domain\/Subscriber.cs` \|/);
  assert.match(text, /## Do not touch/);
  assert.match(text, /Get-Knowledge\.ps1 -Product/);
  assert.doesNotMatch(text, /—/);
  const back = K.parseRepoMap(text);
  assert.deepEqual(back.products[0].changeOrder, products[0].changeOrder);
  assert.deepEqual(back.products[0].areas, ['Project\\Team\\Portal']);
  assert.deepEqual(back.products[0].repos, products[0].repos);
  assert.deepEqual(back.glossary.map(w => w.term), ['Member']);
  assert.equal(K.importPlan(back, { products, repos: K.setAbouts([], back.repos) }).newProducts.length, 0);
  assert.doesNotMatch(back.extra, /## Knowledge/, 'Workshop\'s own section is rebuilt, not kept as extra');
  // Shared? is Yes for a repo in two products.
  const two = P.upsert(items, { name: 'Other', repos: 'shared-lib' }).items;
  assert.match(K.buildRepoMap({ products: P.list({ ...P.blank(), items: two }) }), /\| shared-lib \| .* \| Yes \|/);
});

test('knowledge: settings.repos abouts are set, replaced and removed', () => {
  let items = K.setAbouts([], [{ folder: 'Platform/portal-ui', about: 'Screens\nfor the portal' }]);
  assert.deepEqual(items, [{ id: 'r_platform-portal-ui', folder: 'Platform/portal-ui', about: 'Screens for the portal' }]);
  items = K.setAbouts(items, [{ folder: 'platform\\portal-ui\\', about: 'UI' }]);
  assert.equal(items[0].about, 'UI');
  assert.deepEqual(K.setAbouts(items, [{ folder: 'Platform/portal-ui', about: '' }]), []);
  assert.deepEqual(K.reposMeta(null), { autoWrite: true, writtenAt: null, extra: '' });
  assert.equal(K.reposMeta({ meta: { autoWrite: false } }).autoWrite, false);
});

test('knowledge: checks find what is kept twice or missing', () => {
  const { items } = P.upsert([], { name: 'Sample Portal', repos: 'Platform/portal-api\ngone-repo' });
  const products = P.list({ ...P.blank(), items });
  const note = '---\ntitle: Sample Portal\n---\n# Sample Portal\n\n## People\n\n- Person One: owns Sample Portal\n- Ask Person One about refunds.\n\n## Gotchas\n\n- Exports are capped at 10k rows. (2026-11-05, PR 4812)\n';
  const info = [{ folder: 'Platform/portal-api', remembered: ['- Exports are capped at 10k rows. (2026-10-01, PR 1)'] }, { folder: 'tools', remembered: [] }];
  const glossary = [{ id: 'g_a', term: 'Member', code: 'A' }, { id: 'g_b', term: 'member', code: 'B' }];
  const found = K.checks({ products, glossary, info, notes: new Map([['sample-portal', note]]), people: [{ id: 'p_1', name: 'Person One' }], map: { exists: true, generated: false } });
  assert.deepEqual(found.map(f => f.id.split(':')[0]), ['orphan', 'missing', 'word', 'people', 'twice', 'map']);
  assert.deepEqual(found.find(f => f.id.startsWith('people')).fix, { note: 'products/sample-portal.md' });
  assert.deepEqual(K.checks({ products: [], info, map: { exists: true, generated: false } }), [], 'nothing to say before products exist');
  assert.equal(K.lineKey('- [ ] Exports are capped. (check: code says 5k, 2026-11-17, a.cs)'), 'exports are capped.');
});

// Notes 4.11.0 (js/builds-items.js; plan: claude/loom-docs-links-v1-plan.md in the Workshop project): plan docs and product
// notes, live with Builds. The docs card, reading Builds' items card, a note's In Builds section, live chips, the [[ source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../js/model.js';
import { isPlan, docKind, docsCard, readBuilds, buildsFor, chipStatus, inBuildsHtml, itemOfHref } from '../js/builds-items.js';
import { notesCards } from '../js/summary-cards.js';
import { recordsFrom } from '../js/records.js';
import { render as renderMarkdown } from '../js/markdown.js';
import { STARTERS, templateInfo } from '../js/templates.js';

const index = buildIndex([
  { path: 'plans/checkout.md', content: '# Checkout redesign\n\nBuilds: [Checkout API](ws:builds/L7) and the [pay epic](ws:builds/scope-pay).\n', mtime: 3 },
  { path: 'work/limits.md', content: '---\nkind: plan\nproduct: Shop\n---\n# Rate limits\n', mtime: 2 },
  { path: 'products/shop.md', content: '# Shop\n', mtime: 1 },
  { path: 'notes/random.md', content: '# Random\n', mtime: 4 },
  { path: 'templates/plan.md', content: STARTERS['templates/plan.md'], mtime: 5 }
]);
const n = (p) => index.notes.get(p);

const LOOM = { schema: 'builds.summary', version: 1, items: [
  { id: 'items', kind: 'list', title: 'Tandem items', rows: [
    { id: 'L7-checkout-api', title: '#L7 Checkout API', route: 'L7', note: 'Loading dock: Publish', flag: 'urgent', product: 'shop', epic: '', docs: [] },
    { id: 'scope-pay', title: 'Pay epic', route: 'scope-pay', note: 'Out tray', product: '', epic: '', docs: [] },
    { id: 'L9-pay-api', title: '#L9 Pay API', route: 'L9', note: 'Build bay', product: '', epic: 'scope-pay', docs: [] },
    { id: 'L10-limits', title: '#L10 Limits', route: 'L10', note: 'Shipped', flag: 'done', product: 'shop', epic: '', docs: ['work/limits.md'] },
    { id: 'L11-admin', title: '#L11 Admin', route: 'L11', note: 'Plan desk', product: 'admin', epic: '', docs: [] },
    { bad: true }
  ] }
] };

test('plan docs: kind: plan anywhere, or a note under plans/; never a template; product notes by path', () => {
  assert.equal(isPlan(n('plans/checkout.md')), true);
  assert.equal(isPlan(n('work/limits.md')), true);
  assert.equal(isPlan(n('notes/random.md')), false);
  assert.equal(isPlan(n('templates/plan.md')), false);
  assert.equal(docKind(n('products/shop.md')), 'product');
  assert.deepEqual(n('work/limits.md').doc, { kind: 'plan', product: 'Shop' });
});

test("the docs card: plans newest first with their product, then product notes; it is in Notes' summary", () => {
  const card = docsCard(index);
  assert.deepEqual(card.rows.map(r => [r.id, r.note, r.product]), [['plans/checkout.md', 'Plan', ''], ['work/limits.md', 'Plan', 'Shop'], ['products/shop.md', 'Product note', 'shop']]);
  assert.ok(notesCards(index).some(c => c.id === 'docs' && c.kind === 'list'));
});

test("reads Builds' items card; nothing without one", () => {
  const items = readBuilds(LOOM);
  assert.equal(items.on, true);
  assert.equal(items.rows.length, 5);
  assert.equal(items.byKey.get('L7').id, 'L7-checkout-api');
  assert.equal(items.byKey.get('L7-checkout-api').route, 'L7');
  assert.equal(readBuilds(null).on, false);
  assert.equal(readBuilds({ schema: 'builds.summary', version: 1, items: [] }).on, false);
  assert.equal(itemOfHref(items, 'ws:builds/L9').id, 'L9-pay-api');
  assert.equal(itemOfHref(items, 'ws:tasks/task/t1'), null);
});

test("In Builds: a plan doc's links and its epic's stories; a doc Builds linked; a product note's items", () => {
  const items = readBuilds(LOOM);
  const plan = buildsFor(n('plans/checkout.md'), items);
  assert.equal(plan.kind, 'plan');
  assert.deepEqual(plan.groups.map(g => [g.id, g.rows.map(r => [r.route, r.via])]), [['you', [['L7', 'doc']]], ['moving', [['scope-pay', 'doc'], ['L9', 'epic']]]]);
  assert.equal(plan.total, 3);
  const limits = buildsFor(n('work/limits.md'), items);
  assert.deepEqual(limits.groups.map(g => g.rows.map(r => [r.route, r.via])), [[['L10', 'builds']]]);
  assert.equal(limits.shipped, 1);
  const shop = buildsFor(n('products/shop.md'), items);
  assert.deepEqual(shop.groups.map(g => g.rows.map(r => r.route)), [['L7'], ['L10']]);
  assert.equal(buildsFor(n('notes/random.md'), items), null);
});

test('the In Builds section: progress, groups, rows open Builds; empty and Builds-not-here wording', () => {
  const items = readBuilds(LOOM);
  const html = inBuildsHtml(buildsFor(n('plans/checkout.md'), items), { buildsOn: true });
  assert.match(html, /0 of 3 shipped/);
  assert.match(html, /<p class="builds-group">Needs you<\/p>/);
  assert.match(html, /data-app="builds" data-app-path="L7"/);
  assert.match(html, /A story of a linked epic/);
  const empty = inBuildsHtml(buildsFor(n('notes/random.md'), items) || { kind: 'plan', groups: [], total: 0, shipped: 0 }, { buildsOn: true });
  assert.match(empty, /Nothing linked yet/);
  assert.match(inBuildsHtml({ kind: 'product', groups: [], total: 0, shipped: 0 }, { buildsOn: true }), /Nothing running for this product/);
  assert.match(inBuildsHtml({ kind: 'plan', groups: [], total: 0, shipped: 0 }, { buildsOn: false }), /Open Agents once/);
  assert.equal(inBuildsHtml(null), '');
});

test('a ws:builds chip says where its item is; other apps keep their name', () => {
  const items = readBuilds(LOOM);
  assert.deepEqual(chipStatus(items, 'builds', 'L7'), { state: 'you', text: 'Loading dock: Publish' });
  assert.deepEqual(chipStatus(items, 'builds', 'L10'), { state: 'done', text: 'Shipped' });
  assert.deepEqual(chipStatus(items, 'builds', 'L9'), { state: 'moving', text: 'Build bay' });
  assert.equal(chipStatus(items, 'tasks', 'task/t1'), null);
  assert.equal(chipStatus(readBuilds(null), 'builds', 'L7'), null);
  const ctx = { appName: id => ({ builds: 'Builds', tasks: 'Tasks' }[id]), appStatus: (a, p) => chipStatus(items, a, p) };
  const html = renderMarkdown('[Checkout API](ws:builds/L7) and [a task](ws:tasks/task/t1)', ctx);
  assert.match(html, /<span class="app-chip s-you"><span class="dot" aria-hidden="true"><\/span>Loading dock: Publish<\/span>/);
  assert.match(html, /<span class="app-chip">Tasks<\/span>/);
});

test("the [[ picker lists Builds' items; the Plan template makes a plan doc", () => {
  const recs = recordsFrom({ builds: LOOM });
  assert.ok(recs.some(r => r.app === 'builds' && r.name === 'Builds' && r.href === 'ws:builds/L7' && r.title === '#L7 Checkout API'));
  assert.equal(templateInfo('templates/plan.md', STARTERS['templates/plan.md']).name, 'Plan (PRD)');
  assert.match(STARTERS['templates/plan.md'], /^---\nkind: plan\nproduct: \n---\n# \{\{title\}\}/);
});

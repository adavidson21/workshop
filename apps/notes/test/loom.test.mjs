// Folio 4.11.0 (js/loom.js; plan: claude/loom-docs-links-v1-plan.md in the Workshop project): plan docs and product
// notes, live with Loom. The docs card, reading Loom's items card, a note's In Loom section, live chips, the [[ source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../js/model.js';
import { isPlan, docKind, docsCard, readLoom, loomFor, chipStatus, inLoomHtml, itemOfHref } from '../js/loom.js';
import { notesCards } from '../js/summary-cards.js';
import { recordsFrom } from '../js/records.js';
import { render as renderMarkdown } from '../js/markdown.js';
import { STARTERS, templateInfo } from '../js/templates.js';

const index = buildIndex([
  { path: 'plans/checkout.md', content: '# Checkout redesign\n\nBuilds: [Checkout API](ws:slate/L7) and the [pay epic](ws:slate/scope-pay).\n', mtime: 3 },
  { path: 'work/limits.md', content: '---\nkind: plan\nproduct: Shop\n---\n# Rate limits\n', mtime: 2 },
  { path: 'products/shop.md', content: '# Shop\n', mtime: 1 },
  { path: 'notes/random.md', content: '# Random\n', mtime: 4 },
  { path: 'templates/plan.md', content: STARTERS['templates/plan.md'], mtime: 5 }
]);
const n = (p) => index.notes.get(p);

const LOOM = { schema: 'slate.summary', version: 1, items: [
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

test("the docs card: plans newest first with their product, then product notes; it is in Folio's summary", () => {
  const card = docsCard(index);
  assert.deepEqual(card.rows.map(r => [r.id, r.note, r.product]), [['plans/checkout.md', 'Plan', ''], ['work/limits.md', 'Plan', 'Shop'], ['products/shop.md', 'Product note', 'shop']]);
  assert.ok(notesCards(index).some(c => c.id === 'docs' && c.kind === 'list'));
});

test("reads Loom's items card; nothing without one", () => {
  const loom = readLoom(LOOM);
  assert.equal(loom.on, true);
  assert.equal(loom.rows.length, 5);
  assert.equal(loom.byKey.get('L7').id, 'L7-checkout-api');
  assert.equal(loom.byKey.get('L7-checkout-api').route, 'L7');
  assert.equal(readLoom(null).on, false);
  assert.equal(readLoom({ schema: 'slate.summary', version: 1, items: [] }).on, false);
  assert.equal(itemOfHref(loom, 'ws:slate/L9').id, 'L9-pay-api');
  assert.equal(itemOfHref(loom, 'ws:prioritizer/task/t1'), null);
});

test("In Loom: a plan doc's links and its epic's stories; a doc Loom linked; a product note's items", () => {
  const loom = readLoom(LOOM);
  const plan = loomFor(n('plans/checkout.md'), loom);
  assert.equal(plan.kind, 'plan');
  assert.deepEqual(plan.groups.map(g => [g.id, g.rows.map(r => [r.route, r.via])]), [['you', [['L7', 'doc']]], ['moving', [['scope-pay', 'doc'], ['L9', 'epic']]]]);
  assert.equal(plan.total, 3);
  const limits = loomFor(n('work/limits.md'), loom);
  assert.deepEqual(limits.groups.map(g => g.rows.map(r => [r.route, r.via])), [[['L10', 'loom']]]);
  assert.equal(limits.shipped, 1);
  const shop = loomFor(n('products/shop.md'), loom);
  assert.deepEqual(shop.groups.map(g => g.rows.map(r => r.route)), [['L7'], ['L10']]);
  assert.equal(loomFor(n('notes/random.md'), loom), null);
});

test('the In Loom section: progress, groups, rows open Loom; empty and Loom-not-here wording', () => {
  const loom = readLoom(LOOM);
  const html = inLoomHtml(loomFor(n('plans/checkout.md'), loom), { loomOn: true });
  assert.match(html, /0 of 3 shipped/);
  assert.match(html, /<p class="loom-group">Needs you<\/p>/);
  assert.match(html, /data-app="slate" data-app-path="L7"/);
  assert.match(html, /A story of a linked epic/);
  const empty = inLoomHtml(loomFor(n('notes/random.md'), loom) || { kind: 'plan', groups: [], total: 0, shipped: 0 }, { loomOn: true });
  assert.match(empty, /Nothing linked yet/);
  assert.match(inLoomHtml({ kind: 'product', groups: [], total: 0, shipped: 0 }, { loomOn: true }), /Nothing running for this product/);
  assert.match(inLoomHtml({ kind: 'plan', groups: [], total: 0, shipped: 0 }, { loomOn: false }), /Open Loom once/);
  assert.equal(inLoomHtml(null), '');
});

test('a ws:slate chip says where its item is; other apps keep their name', () => {
  const loom = readLoom(LOOM);
  assert.deepEqual(chipStatus(loom, 'slate', 'L7'), { state: 'you', text: 'Loading dock: Publish' });
  assert.deepEqual(chipStatus(loom, 'slate', 'L10'), { state: 'done', text: 'Shipped' });
  assert.deepEqual(chipStatus(loom, 'slate', 'L9'), { state: 'moving', text: 'Build bay' });
  assert.equal(chipStatus(loom, 'prioritizer', 'task/t1'), null);
  assert.equal(chipStatus(readLoom(null), 'slate', 'L7'), null);
  const ctx = { appName: id => ({ slate: 'Loom', prioritizer: 'Docket' }[id]), appStatus: (a, p) => chipStatus(loom, a, p) };
  const html = renderMarkdown('[Checkout API](ws:slate/L7) and [a task](ws:prioritizer/task/t1)', ctx);
  assert.match(html, /<span class="app-chip s-you"><span class="dot" aria-hidden="true"><\/span>Loading dock: Publish<\/span>/);
  assert.match(html, /<span class="app-chip">Docket<\/span>/);
});

test("the [[ picker lists Loom's items; the Plan template makes a plan doc", () => {
  const recs = recordsFrom({ slate: LOOM });
  assert.ok(recs.some(r => r.app === 'slate' && r.name === 'Loom' && r.href === 'ws:slate/L7' && r.title === '#L7 Checkout API'));
  assert.equal(templateInfo('templates/plan.md', STARTERS['templates/plan.md']).name, 'Plan (PRD)');
  assert.match(STARTERS['templates/plan.md'], /^---\nkind: plan\nproduct: \n---\n# \{\{title\}\}/);
});

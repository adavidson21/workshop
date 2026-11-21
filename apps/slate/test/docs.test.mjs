// Loom 6.17.0 (js/dispatch/docs.js; plan: claude/loom-docs-links-v1-plan.md in the Workshop project): a card's docs
// both ways. Folio's summary read, Loom's own doc-links, a card's product note and plan docs, the items card for Folio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFolio, linksOf, withLink, blank, docsFor, productOf, itemsCard, docsRowHtml, docPickHtml, pickRows, epicDocsHtml, MAX_DOCS } from '../js/dispatch/docs.js';

const folioEnv = (cards) => ({ schema: 'notes.summary', version: 1, rev: 1, items: cards });
const FOLIO = folioEnv([
  { id: 'docs', kind: 'list', title: 'Plan docs and product notes', rows: [
    { id: 'plans/checkout.md', title: 'Checkout redesign', route: 'plans/checkout.md', note: 'Plan', product: 'shop' },
    { id: 'products/shop.md', title: 'Shop', route: 'products/shop.md', note: 'Product note', product: 'shop' },
    { id: '../evil.md', title: 'Nope', note: 'Plan' }
  ] },
  { id: 'mentions', kind: 'list', title: 'Notes about other apps', rows: [
    { id: 'slate/L7|plans/checkout.md', title: 'Checkout redesign', route: 'plans/checkout.md', note: 'slate/L7' },
    { id: 'slate/scope-pay|plans/pay.md', title: 'Pay', route: 'plans/pay.md', note: 'slate/scope-pay' },
    { id: 'prioritizer/task/t1|daily/x.md', title: 'x', route: 'daily/x.md', note: 'prioritizer/task/t1' }
  ] }
]);
const PRODUCTS = [
  { id: 'p_shop', name: 'Shop', slug: 'shop', repos: ['Web/shop-ui'], areas: [] },
  { id: 'p_admin', name: 'Admin', slug: 'admin', alsoCalled: ['Backoffice'], repos: [] },
  { id: 'p_old', name: 'Old', slug: 'old', archived: true, repos: ['Web/old'] }
];

test('reads Folio: plan docs, product notes and the mentions of Loom items; nothing without a summary', () => {
  const f = readFolio(FOLIO);
  assert.equal(f.on, true);
  assert.deepEqual(f.docs.map(d => [d.path, d.kind, d.product]), [['plans/checkout.md', 'plan', 'shop'], ['products/shop.md', 'product', 'shop']]);
  assert.deepEqual([...f.mentions], [['L7', ['plans/checkout.md']], ['scope-pay', ['plans/pay.md']]]);
  assert.equal(readFolio(null).on, false);
  assert.equal(readFolio({ schema: 'notes.summary', version: 2, items: [] }).on, false);
});

test('doc-links: link, no doubles, unlink drops the item, a cap and bad paths refused', () => {
  let env = withLink(blank(), 'L7', 'plans/a.md', true, 1);
  assert.deepEqual([...linksOf(env)], [['L7', ['plans/a.md']]]);
  assert.equal(withLink(env, 'L7', 'plans/a.md', true), null);
  env = withLink(env, 'L7', 'plans/b.md', true, 2);
  assert.deepEqual(linksOf(env).get('L7'), ['plans/a.md', 'plans/b.md']);
  env = withLink(env, 'L7', 'plans/a.md', false, 3);
  env = withLink(env, 'L7', 'plans/b.md', false, 4);
  assert.equal(env.items.length, 0);
  assert.equal(withLink(blank(), 'L7', '../x.md', true), null);
  assert.equal(withLink(blank(), 'L7', 'plans/x.txt', true), null);
  let full = blank();
  for (let i = 0; i < MAX_DOCS; i++) full = withLink(full, 'L1', `p/${i}.md`, true);
  assert.equal(withLink(full, 'L1', 'p/extra.md', true), null);
  assert.equal(withLink({ schema: 'other', version: 1, items: [] }, 'L1', 'a.md', true), null);
});

test("a card's product: repos first, then a linked plan doc's product, then its name in the title; archived ones never", () => {
  assert.equal(productOf({ title: 'x', repos: [{ folder: 'Web/shop-ui' }] }, PRODUCTS).slug, 'shop');
  assert.equal(productOf({ title: 'x', story: { repos: ['Web/shop-ui'] } }, PRODUCTS).slug, 'shop');
  assert.equal(productOf({ title: 'x' }, PRODUCTS, 'Admin').slug, 'admin');
  assert.equal(productOf({ title: 'Fix the Backoffice login' }, PRODUCTS).slug, 'admin');
  assert.equal(productOf({ title: 'x', repos: [{ folder: 'Web/old' }] }, PRODUCTS), null);
  assert.equal(productOf({ title: 'x' }, []), null);
});

test("a card's docs: linked in the doc, linked here, and a story through its epic; the product note from Settings", () => {
  const folio = readFolio(FOLIO);
  const links = linksOf(withLink(blank(), 'L7-checkout', 'plans/extra.md', true));
  const items = [
    { kind: 'item', id: 'L7', folder: 'L7-checkout', title: 'Checkout', repos: [{ folder: 'Web/shop-ui' }] },
    { kind: 'notes', folder: 'scope-pay', title: 'Pay epic' },
    { kind: 'item', id: 'L9', folder: 'L9-pay-api', title: 'Pay API', story: { epic: 'scope-pay', repos: [] } }
  ];
  const a = docsFor(items[0], { folio, links, products: PRODUCTS, items });
  assert.deepEqual(a.plans.map(p => [p.path, p.via]), [['plans/checkout.md', 'doc'], ['plans/extra.md', 'loom']]);
  assert.equal(a.plans[0].title, 'Checkout redesign');
  assert.equal(a.plans[1].title, 'extra');
  assert.deepEqual(a.product, { slug: 'shop', name: 'Shop', path: 'products/shop.md', has: true });
  const b = docsFor(items[2], { folio, links, products: PRODUCTS, items });
  assert.deepEqual(b.plans.map(p => [p.path, p.via]), [['plans/pay.md', 'epic']]);
  assert.equal(b.product, null);
  // A product note linked by hand is the product, not a plan.
  const c = docsFor({ folder: 'L3-x', title: 'x' }, { folio, links: linksOf(withLink(blank(), 'L3-x', 'products/shop.md', true)), products: [], items });
  assert.equal(c.plans.length, 0);
  assert.equal(c.product.path, 'products/shop.md');
});

test('the items card: needs you first, then running, then shipped in the last 14 days; product, epic and docs', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const links = linksOf(withLink(blank(), 'L7-checkout', 'plans/checkout.md', true));
  const card = itemsCard([
    { it: { kind: 'item', id: 'L8', folder: 'L8-a', title: 'Running one', modifiedMs: now - 1000 }, where: 'Build bay' },
    { it: { kind: 'item', id: 'L7', folder: 'L7-checkout', title: 'Checkout', modifiedMs: now - 5000, story: { epic: 'scope-pay' } }, where: 'Loading dock', mine: true, action: 'Publish' },
    { it: { kind: 'item', id: 'L1', folder: 'L1-old', title: 'Old', modifiedMs: now - 20 * 864e5 }, done: true },
    { it: { kind: 'item', id: 'L2', folder: 'L2-new', title: 'New', modifiedMs: now - 864e5 }, done: true },
    { it: { kind: 'pr', folder: 'pr-1', title: 'PR' } }
  ], { links, now, docsOf: it => ({ product: it.id === 'L7' ? { slug: 'shop' } : null }) });
  assert.equal(card.id, 'items');
  assert.equal(card.kind, 'list');
  assert.deepEqual(card.rows.map(r => [r.id, r.route, r.note, r.flag || '']), [
    ['L7-checkout', 'L7', 'Loading dock: Publish', 'urgent'], ['L8-a', 'L8', 'Build bay', ''], ['L2-new', 'L2', 'Shipped', 'done']]);
  assert.deepEqual(card.rows[0], { id: 'L7-checkout', title: '#L7 Checkout', route: 'L7', note: 'Loading dock: Publish', product: 'shop', epic: 'scope-pay', docs: ['plans/checkout.md'], flag: 'urgent' });
});

test('the Docs row: chips open Folio, only Loom links have an x, Link a doc only with Folio, nothing without either', () => {
  const it = { folder: 'L7-checkout' };
  const info = { product: { slug: 'shop', name: 'Shop', path: 'products/shop.md', has: true }, plans: [{ path: 'plans/a.md', title: 'A <plan>', via: 'doc' }, { path: 'plans/b.md', title: 'B', via: 'loom' }] };
  const html = docsRowHtml(it, info, { folioOn: true });
  assert.match(html, /data-doc-open="products\/shop.md"/);
  assert.match(html, /A &lt;plan&gt;/);
  assert.equal((html.match(/data-doc-unlink=/g) || []).length, 1);
  assert.match(html, /data-doc-unlink="plans\/b.md"/);
  assert.match(html, /Link a doc/);
  assert.doesNotMatch(docsRowHtml(it, info, { folioOn: false }), /Link a doc/);
  assert.equal(docsRowHtml(it, { product: null, plans: [] }, { folioOn: false }), '');
  assert.match(docsRowHtml(it, { product: null, plans: [] }, { folioOn: true }), /None yet/);
  assert.equal(epicDocsHtml({ plans: [] }), '');
  assert.match(epicDocsHtml(info), /plans\/a.md/);
});

test('Link a doc: plans before product notes, linked ones left out, a search, and a hint with no docs', () => {
  const docs = readFolio(FOLIO).docs.concat({ path: 'plans/zeta.md', title: 'Zeta', kind: 'plan', product: '' });
  assert.deepEqual(pickRows(docs, '', []).map(d => d.path), ['plans/checkout.md', 'plans/zeta.md', 'products/shop.md']);
  assert.deepEqual(pickRows(docs, 'zet', []).map(d => d.path), ['plans/zeta.md']);
  assert.deepEqual(pickRows(docs, '', ['plans/checkout.md']).map(d => d.path), ['plans/zeta.md', 'products/shop.md']);
  assert.match(docPickHtml('L7', docs, '', []), /data-doc-link="plans\/zeta.md" data-doc-folder="L7"/);
  assert.match(docPickHtml('L7', [], '', []), /Plan template/);
});

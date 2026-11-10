// +product in Quick add and a task's Product field: matching a tag to Settings' products (js/products-link.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeProducts, allProducts, cleanProduct, matchProduct, productById, productTag, setProducts } from '../js/products-link.js';

const env = {
  schema: 'settings.products', version: 1, rev: 1, deleted: {}, items: [
    { id: 'p_wiki-edge', slug: 'wiki-edge', name: 'Wiki Edge' },
    { id: 'p_wiki', slug: 'wiki', name: 'Wiki' },
    { id: 'p_lighthouse', slug: 'lighthouse', name: 'Lighthouse', alsoCalled: ['LH Edge', 'Beacon'] },
    { id: 'p_old', slug: 'old', name: 'Old Portal', archived: true },
    { id: 'bad', slug: 'bad', name: 'Not a product id' }
  ]
};

test('setProducts reads the envelope by name, archived kept, bad items dropped', () => {
  setProducts(env);
  assert.deepEqual(allProducts().map(p => p.id), ['p_lighthouse', 'p_old', 'p_wiki', 'p_wiki-edge']);
  assert.deepEqual(activeProducts().map(p => p.id), ['p_lighthouse', 'p_wiki', 'p_wiki-edge']);
  assert.equal(productById('p_old').name, 'Old Portal');
  assert.equal(productById('p_nope'), null);
});

test('matchProduct: exact slug, name or other name first, then the first that starts with it', () => {
  setProducts(env);
  const A = activeProducts();
  const id = q => (matchProduct(q, A) || {}).id;
  assert.equal(id('wiki'), 'p_wiki');            // exact beats Wiki Edge's prefix
  assert.equal(id('wiki-e'), 'p_wiki-edge');
  assert.equal(id('Wiki_Edge'), 'p_wiki-edge');  // case and separators do not matter
  assert.equal(id('light'), 'p_lighthouse');
  assert.equal(id('lh-edge'), 'p_lighthouse');   // another name
  assert.equal(id('beac'), 'p_lighthouse');
});

test('matchProduct: archived, unknown, and digits only stay in the title', () => {
  setProducts(env);
  const A = activeProducts();
  assert.equal(matchProduct('old', A), null);
  assert.equal(matchProduct('zzz', A), null);
  assert.equal(matchProduct('1', A), null);
  assert.equal(matchProduct('', A), null);
  assert.equal(matchProduct('wiki', null), null);
});

test('productTag and cleanProduct', () => {
  assert.equal(productTag({ slug: 'wiki-edge' }), '+wiki-edge');
  assert.equal(cleanProduct('p_wiki-edge'), 'p_wiki-edge');
  assert.equal(cleanProduct('wiki'), undefined);
  assert.equal(cleanProduct(3), undefined);
});

test('no products set up is an empty list, not an error', () => {
  setProducts(null);
  assert.deepEqual(allProducts(), []);
  setProducts({ schema: 'other', items: [{}] });
  assert.deepEqual(allProducts(), []);
});

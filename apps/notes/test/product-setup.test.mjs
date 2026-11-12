import test from 'node:test';
import assert from 'node:assert/strict';
import { data as sdkData } from '../../../shared/workshop-sdk.js';
import * as Products from '../../../shared/products.js';
import { frontmatter } from '../js/markdown.js';
import { isProductPath } from '../js/products.js';
import { productNoteText, startProductSetup, toMake } from '../js/product-setup.js';

const at = new Date('2026-11-10T14:00:00Z');
const PORTAL = { id: 'p_sample-portal', name: 'Sample Portal', slug: 'sample-portal', alsoCalled: ['SP', 'Portal: new'], repos: ['Platform/Sample Portal/portal-ui'], areas: ['Project\\Team\\Portal'], archived: false };
const settingsEnv = (items) => ({ schema: 'settings.products', version: 1, rev: 1, items: items.map(i => ({ ...i, updatedAt: 1 })), deleted: {} });

test('product notes: what to make, what is only recorded, what is skipped', () => {
  const tools = { ...PORTAL, id: 'p_tools', name: 'Tools', slug: 'tools' };
  const old = { ...PORTAL, id: 'p_old', name: 'Old', slug: 'old', archived: true };
  const gone = { ...PORTAL, id: 'p_gone', name: 'Gone', slug: 'gone' };
  const made = { items: [{ id: 'p_done', path: 'products/done.md' }], deleted: { p_gone: 5 } };
  const done = { ...PORTAL, id: 'p_done', name: 'Done', slug: 'done' };
  const r = toMake([PORTAL, tools, old, gone, done], made, new Set(['products/tools.md']));
  assert.deepEqual(r.map(t => [t.product.id, t.path, t.make]), [['p_sample-portal', 'products/sample-portal.md', true], ['p_tools', 'products/tools.md', false]]);
  assert.ok(r.every(t => isProductPath(t.path)), 'every path is one Folio lists as a product note');
});

test('product notes: the starter template filled in from Settings, owners under People', () => {
  const text = productNoteText(PORTAL, [{ name: 'Bea', hits: ['sample portal'] }], null, at);
  const fm = frontmatter(text);
  assert.equal(fm.data.title, 'Sample Portal');
  assert.deepEqual(fm.data.tags, ['product', 'product/sample-portal']);
  assert.match(text, /^also-called: \[SP, "Portal: new"\]$/m);
  assert.match(text, /^repos: \[Platform\/Sample Portal\/portal-ui\]$/m);
  assert.match(text, /^areas: \[Project\\Team\\Portal\]$/m);
  assert.match(text, /\n# Sample Portal\n/);
  assert.match(text, /## People\n\n- Bea: owns sample portal\n\n## Decisions/);
  assert.doesNotMatch(text, /tandem-changed|reviewed:|\{\{/);
});

test('product notes: your own template is used, and a missing People section is added', () => {
  const mine = '---\ntemplate: Product\ntags: [product, product/{{slug}}]\n---\n# {{title}}\n\nMade {{date}}.\n\n## Summary\n';
  const text = productNoteText({ ...PORTAL, alsoCalled: [], repos: [], areas: [] }, [{ name: 'Al', hits: ['portal-ui'] }], mine, at);
  assert.equal(text, '---\ntags: [product, product/sample-portal]\nalso-called: []\nrepos: []\n---\n# Sample Portal\n\nMade 2026-11-10.\n\n## Summary\n\n## People\n\n- Al: owns portal-ui\n');
  const none = productNoteText({ ...PORTAL, alsoCalled: [], repos: [], areas: [] }, [], '# {{title}}\n', at);
  assert.equal(none, '---\ntitle: Sample Portal\nalso-called: []\nrepos: []\n---\n# Sample Portal\n');
});

const fakeWs = (cols, files, people = []) => ({
  data: {
    stamp: sdkData.stamp, merge: sdkData.merge,
    async get(name, o = {}) { const v = cols.get(`${o.app || 'notes'}/${name}`); return v ? structuredClone(v) : null; },
    async put(name, e) { cols.set(`notes/${name}`, { ...structuredClone(e), rev: (e.rev || 0) + 1 }); return { rev: e.rev + 1 }; },
    subscribe() {}
  },
  people: { async get() { return { people } } },
  files: {
    async read(path) { return files.has(path) ? { content: files.get(path), mtime: 1 } : null; },
    async write(path, content, o) { if (o.create && files.has(path)) { const e = new Error('c'); e.code = 'conflict'; throw e; } files.set(path, content); return {}; }
  }
});
const store = (files) => ({ loaded: true, get files() { return new Map([...files.keys()].map(p => [p, {}])); }, async refresh() {} });

test('startProductSetup: makes each note once, keeps one made by hand, never brings a trashed one back', async () => {
  const files = new Map([['products/tools.md', '# Mine\n']]), cols = new Map();
  cols.set('settings/products', settingsEnv([PORTAL, { ...PORTAL, id: 'p_tools', name: 'Tools', slug: 'tools', alsoCalled: [], repos: [], areas: [] }]));
  const people = [{ id: 'x', kind: 'person', name: 'Bea', owns: ['SP'] }, { id: 'y', kind: 'person', name: 'Old', owns: ['SP'], archived: true }];
  const seen = [];
  const s = startProductSetup(fakeWs(cols, files, people), store(files), { onMade: d => seen.push(...d) });
  assert.equal(await s.run(), 2);
  assert.match(files.get('products/sample-portal.md'), /## People\n\n- Bea: owns SP\n/);
  assert.equal(files.get('products/tools.md'), '# Mine\n', 'a note made by hand is left alone');
  assert.deepEqual(seen.map(d => [d.name, d.made]), [['Sample Portal', true], ['Tools', false]]);
  assert.deepEqual(cols.get('notes/products-made').items.map(i => [i.id, i.path]), [['p_sample-portal', 'products/sample-portal.md'], ['p_tools', 'products/tools.md']]);
  assert.equal(cols.get('notes/products-made').schema, 'notes.products-made');
  assert.equal(await s.run(), 0, 'never twice');
  files.delete('products/sample-portal.md');
  assert.equal(await s.run(), 0, 'a trashed note does not come back');
  // A rename in Settings does not touch the note; a new product does get one.
  const { items } = Products.upsert(cols.get('settings/products').items, { name: 'Billing' });
  cols.set('settings/products', settingsEnv(Products.upsert(items, { name: 'Portal Next' }, 'p_sample-portal').items));
  assert.equal(await s.run(), 1);
  assert.ok(files.has('products/billing.md') && !files.has('products/sample-portal.md'));
});

test('startProductSetup: nothing without products, while loading, or with a newer version of either collection', async () => {
  const files = new Map(), cols = new Map();
  const s = startProductSetup(fakeWs(cols, files), store(files));
  assert.equal(await s.run(), 0);
  cols.set('settings/products', settingsEnv([PORTAL]));
  assert.equal(await startProductSetup(fakeWs(cols, files), { ...store(files), loaded: false }).run(), 0);
  cols.set('notes/products-made', { schema: 'notes.products-made', version: 2, rev: 1, items: [], deleted: {} });
  assert.equal(await s.run(), 0);
  cols.delete('notes/products-made');
  cols.set('settings/products', { ...settingsEnv([PORTAL]), version: 2 });
  assert.equal(await s.run(), 0);
  assert.equal(files.size, 0);
});

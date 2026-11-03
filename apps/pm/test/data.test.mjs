// Roadmap's data layer with a fake SDK: setup, refresh and the snapshot, seen, settings, ceremonies, the handoff
// to Docket, other apps' data read only, newer versions, and browser mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPm } from '../js/data.js';
import { render } from '../js/view.js';
import { dayplanSettings, epic, fakeWs, feature, products, queueSettings } from './fake.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const make = ws => createPm(ws, { now: () => NOW });
const ui = (extra = {}) => ({ tab: 'roadmap', open: new Set(), release: null, draft: null, ...extra });

test('with no products and no Queue area paths, it asks for setup and calls nothing in ADO', async () => {
  const ws = fakeWs();
  const pm = make(ws);
  await pm.loadAll();
  await pm.refresh();
  assert.equal(ws.calls.length, 0);
  assert.match(render(pm.v, ui(), NOW, true), /Which area paths are your products\?/);
});

test('refresh asks ADO (read only) for products and Queue area paths, saves the snapshot, marks all seen the first time', async () => {
  const ws = fakeWs({ stored: { products: products() }, others: { 'queue/settings': queueSettings() } });
  const pm = make(ws);
  await pm.loadAll();
  await pm.refresh();
  const call = ws.calls.find(c => c.action === 'roadmap');
  assert.deepEqual(call.args, { connection: 'main', areas: ['Web App\\Team A', 'Web App\\Team B'] }, 'uses Queue\'s connection when it has none of its own');
  assert.equal(ws.calls.every(c => !c.confirm), true, 'no write actions');
  assert.deepEqual(pm.v.items.map(i => i.id), [701, 711, 712]);
  assert.equal(ws.store.snapshot.items[0].id, '701', 'envelope ids are strings');
  assert.equal(ws.store.snapshot.meta.iterations['Web App'][1].start, '2026-10-07');
  assert.deepEqual(ws.store.seen.items.map(x => x.id).sort(), ['701', '711', '712']);
  assert.deepEqual(Object.keys(ws.other).sort(), ['queue/settings'], 'other apps\' data is never written');
  // A new window with no ADO shows the last copy with its age.
  const ws2 = fakeWs({ stored: ws.store, ado: null, others: ws.other });
  const pm2 = make(ws2);
  await pm2.loadAll();
  assert.equal(typeof pm2.v.items[0].id, 'number');
  assert.equal(pm2.v.ado.state, 'off');
  const html = render(pm2.v, ui(), NOW + 3600e3, true);
  assert.match(html, /Showing the last copy/);
  assert.match(html, /Updated 1 h ago/);
  assert.match(html, /Synthetic version 701/);
});

test('a later refresh marks what changed since you looked; Mark as seen clears it', async () => {
  const ws = fakeWs({ stored: { products: products() } });
  const pm = make(ws);
  await pm.loadAll();
  await pm.refresh();
  ws.adoItems[1].rev = 9;
  await pm.refresh();
  const html = render(pm.v, ui({ tab: 'releases' }), NOW, true);
  assert.match(html, /<b class="num">1<\/b> changed since you looked/);
  await pm.markSeen(pm.v.items.filter(i => i.id === 701 || i.parentId === 701));
  assert.equal(pm.v.seen[711], 9);
  assert.match(render(pm.v, ui({ tab: 'releases' }), NOW, true), /<b class="num">0<\/b> changed since you looked/);
});

test('settings save products and refresh when the area paths change', async () => {
  const ws = fakeWs({ stored: { products: products() } });
  const pm = make(ws);
  await pm.loadAll();
  await pm.saveSettings({ products: [{ name: 'Product B', areas: ['Web App\\Team C'] }], settings: { staleDays: 7, useQueueAreas: false } });
  assert.deepEqual(ws.store.products.items.map(p => p.name), ['Product B']);
  assert.equal(ws.store.products.meta.staleDays, 7);
  assert.deepEqual(ws.calls.filter(c => c.action === 'roadmap').pop().args.areas, ['Web App\\Team C']);
});

test('ceremonies save, and Send to Docket writes only this app\'s handoffs, per the contract', async () => {
  const ws = fakeWs({ others: { 'prioritizer/dayplan/settings': dayplanSettings() } });
  const pm = make(ws);
  await pm.loadAll();
  await pm.saveCadence([{ id: 'cer_ref', name: 'Backlog refinement', dueDay: 4, minutes: 60, planKind: 'meetings', role: 'Facilitator' }, { name: ' ' }, { id: 'cer_retro', name: 'Retro', last: true, minutes: 45 }]);
  assert.deepEqual(ws.store.cadence.items.map(c => c.id), ['cer_ref', 'cer_retro']);
  assert.equal(await pm.sendToDocket(), 2);
  const h = ws.store.handoffs;
  assert.equal(h.schema, 'pm.handoffs');
  assert.equal(h.version, 1);
  assert.deepEqual(h.items.map(x => [x.id, x.to, x.source.app, x.source.id, x.date]), [['h_cer_ref', 'prioritizer', 'pm', 'cer_ref', '2026-11-03', ], ['h_cer_retro', 'prioritizer', 'pm', 'cer_retro', '2026-11-03']]);
  assert.equal(h.items[0].payload.kind, 'every-sprint');
  assert.equal(typeof h.items[0].updatedAt, 'number');
  const rev = h.rev;
  await pm.sendToDocket();
  assert.equal(ws.store.handoffs.rev, rev + 1);
  assert.deepEqual(ws.store.handoffs.items, h.items, 'sending again with no change leaves the offers as they were');
  assert.deepEqual(Object.keys(ws.other), ['prioritizer/dayplan/settings'], 'Docket\'s data is never written');
  const html = render(pm.v, ui({ tab: 'cadence' }), NOW, true);
  assert.match(html, /Sprint 2026-22/);
  assert.match(html, /Waiting in Docket/);
});

test('without Docket\'s sprint, the cadence tab says so and links to Docket; a newer Docket is not read', async () => {
  const pm = make(fakeWs());
  await pm.loadAll();
  const html = render(pm.v, ui({ tab: 'cadence' }), NOW, true);
  assert.match(html, /Set your sprint in Docket first/);
  assert.match(html, /data-open-docket/);
  const pm2 = make(fakeWs({ others: { 'prioritizer/dayplan/settings': dayplanSettings(undefined, 2) } }));
  await pm2.loadAll();
  assert.match(render(pm2.v, ui({ tab: 'cadence' }), NOW, true), /saved by a newer Docket/);
});

test('a collection saved by a newer Roadmap is read only', async () => {
  const ws = fakeWs({ stored: { cadence: { schema: 'pm.cadence', version: 2, rev: 4, items: [] } } });
  const pm = make(ws);
  await pm.loadAll();
  assert.equal(pm.v.newer, 'cadence');
  await assert.rejects(pm.saveCadence([{ name: 'Retro', last: true }]), e => e.code === 'downgrade');
  assert.equal(ws.puts.length, 0);
  assert.match(render(pm.v, ui(), NOW, true), /Saved by a newer Roadmap/);
});

test('browser mode: no ADO calls, a note that the roadmap needs Workshop, cadence still works', async () => {
  const ws = fakeWs({ backend: 'browser', stored: { products: products() } });
  const pm = make(ws);
  await pm.loadAll();
  await pm.refresh();
  assert.equal(ws.calls.length, 0);
  assert.match(render(pm.v, ui(), NOW, false), /needs Workshop on this computer/);
  await pm.saveCadence([{ name: 'Retro', last: true }]);
  assert.equal(ws.store.cadence.items.length, 1);
});

test('waiting for the folder: nothing is written, the page asks to Allow', async () => {
  const ws = fakeWs({ backend: 'browser' });
  ws.allowed = false;
  const pm = make(ws);
  await pm.loadAll();
  assert.equal(pm.v.waiting, true);
  assert.match(render(pm.v, ui(), NOW, true), /Allow Workshop to use your folder/);
});

test('a write conflict merges with what another window saved', async () => {
  const ws = fakeWs();
  const pm = make(ws);
  await pm.loadAll();
  // Another window saves a ceremony first.
  ws.store.cadence = { schema: 'pm.cadence', version: 1, rev: 1, items: [{ id: 'cer_other', name: 'Demo', dueDay: 9, last: false, minutes: 30, planKind: '', role: '', updatedAt: NOW - 1000 }], deleted: {} };
  await pm.saveCadence([{ id: 'cer_ref', name: 'Refinement', dueDay: 4 }]);
  assert.deepEqual(ws.store.cadence.items.map(c => c.id).sort(), ['cer_other', 'cer_ref']);
});

test('items with no dates go on the Now, Next, Later board', async () => {
  const ws = fakeWs({ stored: { products: products() }, items: [epic(1, { iteration: 'Web App' }), epic(2, { state: 'New', iteration: 'Web App' }), feature(3, null, { iteration: 'Web App\\Sprint 12' })] });
  const pm = make(ws);
  await pm.loadAll();
  await pm.refresh();
  const html = render(pm.v, ui(), NOW, true);
  assert.match(html, /class="board"/);
  assert.match(html, /<h3 class="section-label">Now<\/h3><ul><li><a [^>]*>Synthetic version 1</);
  assert.match(html, /<h3 class="section-label">Later<\/h3><ul><li><a [^>]*>Synthetic version 2</);
  assert.match(html, /Features with no version/, 'a Feature placed by its sprint is on the chart');
});

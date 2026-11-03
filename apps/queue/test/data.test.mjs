// Queue's data layer with a fake SDK: loading, refresh and the snapshot, writes with confirm, conflicts,
// settings, saved views, waiting for the folder, and browser mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../js/data.js';
import { render } from '../js/view.js';
import { DEV1, ME, fakeWs, item, settings } from './fake.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const make = ws => createQueue(ws, { now: () => NOW });
const ui = { route: '', view: 'mine', filters: {}, sort: 'changed', filtersTouched: false, selected: null };

test('with no area paths, the queue asks for setup and calls nothing in ADO', async () => {
  const ws = fakeWs();
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  assert.equal(ws.calls.filter(c => c.id === 'ado').length, 0);
  assert.match(render(q.v, ui, NOW, true), /Which area paths are your team's\?/);
});

test('refresh reads the queue, caches states and sprints, saves the snapshot, and marks all seen the first time', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  assert.deepEqual(q.v.items.map(i => i.id), [501, 502, 503]);
  const list = ws.calls.find(c => c.action === 'queue.list');
  assert.deepEqual(list.args, { areas: ['Web App\\Team A'] });
  assert.equal(list.confirm, false);
  assert.equal(q.v.snap.categories.Bug.Active, 'InProgress');
  assert.deepEqual(q.v.snap.currentIterations, ['Web App\\Sprint 12']);
  assert.equal(ws.store.snapshot.items.length, 3);
  assert.equal(ws.store.snapshot.items[0].id, '501', 'envelope ids are strings');
  assert.deepEqual(ws.store.seen.items.map(x => x.id).sort(), ['501', '502', '503']);
  // A new window loads from the snapshot without calling ADO.
  const ws2 = fakeWs({ stored: ws.store, ado: null });
  const q2 = make(ws2);
  await q2.loadAll();
  assert.deepEqual(q2.v.items.map(i => i.id), [501, 502, 503]);
  assert.equal(typeof q2.v.items[0].id, 'number');
  assert.equal(q2.v.ado.state, 'off');
  assert.match(render(q2.v, { ...ui, view: 'all' }, NOW, true), /Showing the last copy/);
});

test('a later refresh shows items changed in ADO since you looked', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  ws.adoItems[1].rev = 9;
  await q.refresh();
  const html = render(q.v, { ...ui, view: 'all' }, NOW, true);
  assert.equal((html.match(/class="dot"/g) || []).length, 1);
  await q.details(q.v.items.find(i => i.id === 502));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(q.v.seen[502], 9);
});

test('update sends confirm and the read revision, and replaces the item', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  const r = await q.update(q.v.items.find(i => i.id === 502), { state: 'Closed', priority: 1 });
  assert.equal(r.ok, true);
  const call = ws.calls.find(c => c.action === 'workitem.update');
  assert.deepEqual(call, { id: 'ado', action: 'workitem.update', args: { id: 502, rev: 3, changes: { state: 'Closed', priority: 1 } }, confirm: true });
  assert.equal(q.v.items.find(i => i.id === 502).state, 'Closed');
  assert.equal(q.v.items.find(i => i.id === 502).rev, 4);
});

test('a conflict refreshes and returns the before and after, writing nothing', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  const stale = q.v.items.find(i => i.id === 501);
  Object.assign(ws.adoItems[0], { rev: 7, state: 'Resolved' });
  const r = await q.update(stale, { state: 'Closed' });
  assert.equal(r.conflict, true);
  assert.equal(r.before.state, 'Active');
  assert.equal(r.after.state, 'Resolved');
  assert.equal(ws.adoItems[0].state, 'Resolved');
});

test('other write errors reject so the page can keep the edit and offer Retry', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  ws.fail = { 'workitem.update': Object.assign(new Error('ADO rejected the PAT (HTTP 403). It may be missing the Work Items (Read & Write) scope.'), { code: 'unavailable' }) };
  await assert.rejects(q.update(q.v.items[0], { state: 'Closed' }), /Read & Write/);
  assert.equal(q.v.items[0].state, 'Active');
});

test('comment and create send confirm; create adds the new item', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  await q.comment(q.v.items[0], 'Looks good');
  assert.equal(ws.calls.find(c => c.action === 'workitem.comment').confirm, true);
  const it = await q.create({ type: 'Bug', title: 'New one', area: 'Web App\\Team A', project: 'Web App' });
  assert.equal(it.id, 9000);
  assert.ok(q.v.items.some(i => i.id === 9000));
  assert.equal(ws.calls.find(c => c.action === 'workitem.create').confirm, true);
});

test('Start in Dispatch calls the opencode connector with the lane for the type', async () => {
  const ws = fakeWs({ stored: { settings: settings() }, opencode: true });
  const q = make(ws);
  await q.loadAll();
  assert.equal(q.v.dispatch, true);
  await q.startInDispatch(item(502, { type: 'User Story' }));
  await q.startInDispatch(item(501, { type: 'Bug' }));
  assert.deepEqual(ws.calls.filter(c => c.id === 'opencode').map(c => [c.action, c.args, c.confirm]), [
    ['start', { id: '502', lane: 'feature' }, true], ['start', { id: '501', lane: 'bug' }, true]
  ]);
});

test('settings save cleanly and a change of areas refreshes; saved views round-trip', async () => {
  const ws = fakeWs();
  const q = make(ws);
  await q.loadAll();
  await q.saveSettings({ areas: ['Web App\\Team A', ' '], people: [ME, { name: '', email: '' }], refreshMinutes: 1, staleDays: 3 });
  assert.deepEqual(q.v.settings.areas, ['Web App\\Team A']);
  assert.deepEqual(q.v.settings.people, [ME]);
  assert.equal(q.v.settings.refreshMinutes, 15, 'out of range falls back to the default');
  assert.equal(q.v.settings.staleDays, 3);
  assert.ok(ws.calls.some(c => c.action === 'queue.list'));
  const row = await q.saveView({ name: 'P1 bugs', base: 'all', filters: { type: 'Bug', priority: '1' } });
  assert.equal(q.v.views[0].name, 'P1 bugs');
  assert.equal(q.v.views[0].filters.priority, '1');
  await q.deleteView(row.id);
  assert.deepEqual(q.v.views, []);
});

test('connector settings are passed on: a named connection and types', async () => {
  const ws = fakeWs({ stored: { settings: settings({ connection: 'apps', types: ['Bug'] }) } });
  const q = make(ws);
  await q.loadAll();
  await q.refresh();
  assert.deepEqual(ws.calls.find(c => c.action === 'queue.list').args, { connection: 'apps', areas: ['Web App\\Team A'], types: ['Bug'] });
});

test('while the folder needs Allow, the queue waits, saves nothing, and loads on Allow', async () => {
  const ws = fakeWs({ backend: 'browser', stored: { settings: settings() } });
  ws.allowed = false;
  const q = make(ws);
  await q.loadAll();
  assert.equal(q.v.waiting, true);
  assert.match(render(q.v, ui, NOW, true), /Allow Workshop to use your folder/);
  await assert.rejects(q.saveSettings({ areas: ['x'] }), e => e.code === 'unavailable');
  assert.deepEqual(ws.puts, []);
  ws.allowed = true;
  ws.emit('online', { online: true });
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(q.v.waiting, false);
  assert.deepEqual(q.v.settings.areas, ['Web App\\Team A']);
});

test('browser mode with no snapshot explains that the queue needs Workshop on this computer', async () => {
  const ws = fakeWs({ backend: 'browser', stored: { settings: settings() } });
  const q = make(ws);
  await q.loadAll();
  assert.equal(q.v.ado.state, 'browser');
  assert.match(render(q.v, ui, NOW, true), /needs Workshop on this computer/);
});

test('a collection saved by a newer Queue is read-only', async () => {
  const ws = fakeWs({ stored: { settings: { ...settings(), version: 2 } } });
  const q = make(ws);
  await q.loadAll();
  assert.equal(q.v.newer, 'settings');
  await assert.rejects(q.saveSettings({ areas: ['x'] }), e => e.code === 'downgrade');
});

test('DEV1 fixture sanity', () => assert.equal(DEV1.email, 'dev.one@example.com'));

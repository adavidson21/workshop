// Queue and Workshop's people directory (docs/people.md): the team comes from Settings' `people` when it
// exists, Queue's own list is kept but not used, and it falls back to that list when there is no directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../js/data.js';
import { directoryTeam } from '../js/model.js';
import { render, settingsHtml } from '../js/view.js';
import { DEV1, fakeWs, item, settings } from './fake.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const ui = { route: '', view: 'team', filters: {}, sort: 'changed', filtersTouched: false, selected: null };
const dir = items => ({ schema: 'settings.people', version: 1, rev: 3, items, deleted: {} });
const person = (id, name, relation, extra = {}) => ({ id, updatedAt: 1, name, relation, ...extra });

test('directoryTeam: active team people only, ADO email or display name, defaults by relation', () => {
  const team = directoryTeam(dir([
    person('p_me', 'Me', 'self', { adoIdentity: 'Me@Example.com' }),
    person('p_1', 'Dev One', 'report', { adoIdentity: 'dev.one@example.com' }),
    person('p_2', 'Dev Two', 'report', { adoIdentity: 'Dev Two (Contractor)' }),
    person('p_3', 'Gone', 'report', { archived: true }),
    person('p_4', 'Peer', 'peer'),
    person('p_5', 'Teammate', 'peer', { team: true }),
    person('p_6', 'Boss', 'manager'),
    person('p_7', 'Quiet', 'report', { team: false }),
  ]));
  assert.deepEqual(team.map(p => [p.label, p.name, p.email]), [
    ['Me', 'Me', 'me@example.com'],
    ['Dev One', 'Dev One', 'dev.one@example.com'],
    ['Dev Two', 'Dev Two (Contractor)', ''],
    ['Teammate', 'Teammate', ''],
  ]);
});

test('directoryTeam: null without a directory or with an unknown version; an empty one is an empty team', () => {
  assert.equal(directoryTeam(null), null);
  assert.equal(directoryTeam({ ...dir([]), version: 2 }), null);
  assert.equal(directoryTeam({ ...dir([]), schema: 'other.people' }), null);
  assert.deepEqual(directoryTeam(dir([])), []);
});

test('with a directory, the Team view uses it and Queue settings point to People', async () => {
  const ws = fakeWs({
    stored: { settings: settings({ people: [{ name: 'Old Entry', email: 'old@example.com' }] }) },
    others: { 'settings/people': dir([person('p_1', 'Dev One', 'report', { adoIdentity: DEV1.email })]) },
  });
  const q = createQueue(ws, { now: () => NOW });
  await q.loadAll();
  await q.refresh();
  assert.deepEqual(q.v.settings.people.map(p => p.email), [DEV1.email]);
  const html = render(q.v, ui, NOW, true);
  assert.match(html, /data-person="dev\.one@example\.com">Dev One</);
  assert.doesNotMatch(html, /Old Entry/);
  const s = settingsHtml(q.v);
  assert.match(s, /data-open-people/);
  assert.doesNotMatch(s, /name="people"/);
});

test('saving Queue settings with a directory keeps Queue\'s own people list', async () => {
  const ws = fakeWs({
    stored: { settings: settings({ people: [{ name: 'Old Entry', email: 'old@example.com' }] }) },
    others: { 'settings/people': dir([person('p_1', 'Dev One', 'report', { adoIdentity: DEV1.email })]) },
  });
  const q = createQueue(ws, { now: () => NOW });
  await q.loadAll();
  await q.saveSettings({ ...q.v.settings, staleDays: 9 });
  assert.deepEqual(ws.store.settings.meta.people, [{ name: 'Old Entry', email: 'old@example.com' }]);
  assert.equal(ws.store.settings.meta.staleDays, 9);
  assert.deepEqual(q.v.settings.people.map(p => p.email), [DEV1.email]);
});

test('without a directory, Queue uses its own list as before', async () => {
  const ws = fakeWs({ stored: { settings: settings({ people: [{ name: 'Dev One', email: DEV1.email }] }) }, items: [item(503, { assignee: DEV1 })] });
  const q = createQueue(ws, { now: () => NOW });
  await q.loadAll();
  assert.equal(q.v.directory, null);
  assert.deepEqual(q.v.settings.people, [{ name: 'Dev One', email: DEV1.email }]);
  assert.match(settingsHtml(q.v), /name="people"/);
});

test('a directory change is picked up on reload', async () => {
  const ws = fakeWs({ stored: { settings: settings() } });
  const q = createQueue(ws, { now: () => NOW });
  await q.loadAll();
  assert.equal(q.v.directory, null);
  ws.others['settings/people'] = dir([person('p_1', 'Dev One', 'report', { adoIdentity: DEV1.email })]);
  await q.reload('directory');
  assert.deepEqual(q.v.settings.people.map(p => p.label), ['Dev One']);
});

test('names from the directory are escaped', async () => {
  const ws = fakeWs({ stored: { settings: settings() }, others: { 'settings/people': dir([person('p_1', '<script>x</script>', 'report', { adoIdentity: DEV1.email })]) }, items: [item(503, { assignee: DEV1 })] });
  const q = createQueue(ws, { now: () => NOW });
  await q.loadAll();
  await q.refresh();
  const html = render(q.v, ui, NOW, true) + settingsHtml(q.v);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;x/);
});

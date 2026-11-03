// 1:1s data: own collections and files through a fake SDK, other apps read only, handoffs in the
// docs/handoffs.md shape, and the draft step through the opencode connector. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOneOnOnes } from '../js/data.js';
import { winOffers } from '../js/model.js';
import { NOW, PERSON, TODAY, docketPeople, docketTasks, fakeWs, receiptsEntries } from './fake.mjs';

test('loads its own collections and reads other apps without writing them', async () => {
  const ws = fakeWs({ others: { 'prioritizer.tasks': docketTasks([]), 'prioritizer.people': docketPeople(['DevA']), 'receipts.entries': receiptsEntries([]) } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.loaded, true);
  assert.equal(d.v.src.docketPeople.schema, 'prioritizer.people');
  assert.equal(d.v.src.queueSnapshot, null);
  assert.equal(d.v.oc, true);
  assert.deepEqual(ws.puts, [], 'loading writes nothing');
});

test('people: added with a generated id, edited in place, unknown fields kept', async () => {
  const ws = fakeWs({ stored: { people: { schema: 'oneonones.people', version: 1, rev: 1, deleted: {}, items: [{ ...PERSON, updatedAt: 1, extra: 'kept' }] } } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  const added = await d.savePerson({ name: 'Engineer A', links: { docket: 'EngA' }, cadenceDays: 14 });
  assert.match(added.id, /^p_/);
  await d.savePerson({ ...PERSON, cadenceDays: 10 });
  const items = ws.store.people.items;
  assert.equal(items.length, 2);
  const kept = items.find(x => x.id === PERSON.id);
  assert.equal(kept.cadenceDays, 10);
  assert.equal(kept.extra, 'kept');
  assert.deepEqual(ws.puts, ['people', 'people'], 'only its own collection');
});

test('a newer people collection is read only', async () => {
  const ws = fakeWs({ stored: { people: { schema: 'oneonones.people', version: 2, rev: 1, deleted: {}, items: [] } } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.newer, 'people');
  await assert.rejects(d.savePerson({ name: 'Engineer A' }), e => e.code === 'downgrade');
});

test('notes are plain Markdown files under notes/<person>/; a stale write is a conflict', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  const path = d.notePath(PERSON.id, TODAY);
  assert.equal(path, 'notes/p-abc1/2026-11-03.md');
  const r = await d.writeNote(path, '# 1:1\n', null);
  assert.deepEqual(d.notesOf(PERSON.id).map(n => n.day), [TODAY]);
  await d.writeNote(path, '# 1:1\n\nmore\n', r.mtime);
  await assert.rejects(d.writeNote(path, 'stale', r.mtime), e => e.code === 'conflict' && e.current.content.includes('more'));
  assert.equal(ws.disk[path].content, '# 1:1\n\nmore\n');
});

test('wins go to its own handoffs collection as oneonones.handoffs v1; offering again does not double them', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  const items = winOffers({ person: PERSON, day: TODAY, wins: ['Shipped the import fix'], nowIso: '2026-11-03T20:00:00.000Z' });
  await d.offer(items);
  await d.offer(items);
  const env = ws.store.handoffs;
  assert.equal(env.schema, 'oneonones.handoffs');
  assert.equal(env.version, 1);
  assert.equal(env.items.length, 1);
  assert.ok(env.items[0].updatedAt > 0, 'stamped');
  assert.deepEqual(env.items[0].payload, { kind: 'win', about: 'p_r1' });
});

test('settings: the draft step can be turned off', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.settings.aiDraft, true);
  await d.saveSettings({ aiDraft: false });
  assert.equal(d.v.settings.aiDraft, false);
  assert.equal(ws.store.settings.meta.aiDraft, false);
});

test('the draft step calls the opencode connector: draft with confirm, result without', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  await d.draft(PERSON.id, TODAY, '# 1:1 packet');
  const r = await d.draftResult(PERSON.id, TODAY);
  assert.equal(r.state, 'done');
  assert.deepEqual(ws.calls.map(c => [c.action, c.confirm]), [['oneonone.draft', true], ['oneonone.result', false]]);
  assert.deepEqual(ws.calls[0].args, { personId: PERSON.id, date: TODAY, packet: '# 1:1 packet' });
});

test('browser mode: no connector, so no draft step', async () => {
  const ws = fakeWs({ backend: 'browser' });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.oc, false);
});

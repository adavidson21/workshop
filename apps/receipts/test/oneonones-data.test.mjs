// Rapport's 1:1s data: its own collections and files through a fake SDK, other apps read only, the copy from
// the old 1:1s app, and the draft step through the opencode connector. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOneOnOnes } from '../js/oneonones/data.js';
import { NOW, PERSON, TODAY, docketSummary, fakeWs, receiptsEntries } from './oneonones-fake.mjs';

test('loads its own collections and reads other apps without writing them', async () => {
  const ws = fakeWs({ others: { 'prioritizer.summary': docketSummary([], ['DevA']) } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.loaded, true);
  assert.equal(d.v.src.docketSummary.schema, 'prioritizer.summary');
  assert.ok(!('docketTasks' in d.v.src) && !('docketPeople' in d.v.src), 'Docket\'s own collections are never read');
  assert.ok(!('queueSnapshot' in d.v.src), 'Queue is no longer read');
  assert.equal(d.v.src.receiptsEntries, null, "Rapport's own entries are handed in, not read here");
  d.setOwn(receiptsEntries([]), null);
  assert.equal(d.v.src.receiptsEntries.schema, 'receipts.entries');
  assert.equal(d.v.oc, true);
  assert.deepEqual(ws.puts, [], 'loading writes nothing');
});

test('people: added with a generated id, edited in place, unknown fields kept', async () => {
  const ws = fakeWs({ stored: { 'oneonones/people': { schema: 'receipts.oneonones/people', version: 1, rev: 1, deleted: {}, items: [{ ...PERSON, updatedAt: 1, extra: 'kept' }] } } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  const added = await d.savePerson({ name: 'Engineer A', links: { docket: 'EngA' }, cadenceDays: 14 });
  assert.match(added.id, /^p_/);
  await d.savePerson({ ...PERSON, cadenceDays: 10 });
  const items = ws.store['oneonones/people'].items;
  assert.equal(items.length, 2);
  const kept = items.find(x => x.id === PERSON.id);
  assert.equal(kept.cadenceDays, 10);
  assert.equal(kept.extra, 'kept');
  assert.deepEqual(ws.puts, ['oneonones/people', 'oneonones/people'], 'only its own collection');
});

test('a newer people collection is read only', async () => {
  const ws = fakeWs({ stored: { 'oneonones/people': { schema: 'receipts.oneonones/people', version: 2, rev: 1, deleted: {}, items: [] } } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.newer, 'oneonones/people');
  await assert.rejects(d.savePerson({ name: 'Engineer A' }), e => e.code === 'downgrade');
});

test('notes are plain Markdown files under oneonones/notes/<person>/; a stale write is a conflict', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  const path = d.notePath(PERSON.id, TODAY);
  assert.equal(path, 'oneonones/notes/p-abc1/2026-11-03.md');
  const r = await d.writeNote(path, '# 1:1\n', null);
  assert.deepEqual(d.notesOf(PERSON.id).map(n => n.day), [TODAY]);
  await d.writeNote(path, '# 1:1\n\nmore\n', r.mtime);
  await assert.rejects(d.writeNote(path, 'stale', r.mtime), e => e.code === 'conflict' && e.current.content.includes('more'));
  assert.equal(ws.disk[path].content, '# 1:1\n\nmore\n');
});

test('the first load copies the old 1:1s app in: people, settings and notes; the old data is only read', async () => {
  const oldPeople = { schema: 'oneonones.people', version: 1, rev: 7, deleted: {}, items: [{ ...PERSON, updatedAt: 3 }] };
  const oldSettings = { schema: 'oneonones.settings', version: 1, rev: 2, deleted: {}, items: [], meta: { updatedAt: 1, aiDraft: false } };
  const ws = fakeWs({
    others: { 'oneonones.people': oldPeople, 'oneonones.settings': oldSettings },
    otherFiles: { 'oneonones:notes/p-abc1/2026-10-27.md': { content: '# old note\n', mtime: 5 }, 'oneonones:notes/p-abc1/stray.md': { content: 'x', mtime: 6 } }
  });
  const d = createOneOnOnes(ws, { now: () => NOW });
  const copied = await d.loadAll();
  assert.deepEqual(copied, { people: 1, notes: 1, first: true });
  assert.deepEqual(d.v.people.map(p => p.id), [PERSON.id]);
  assert.equal(d.v.settings.aiDraft, false, 'the old setting came along');
  assert.equal(ws.store['oneonones/people'].schema, 'receipts.oneonones/people');
  assert.equal(ws.disk['oneonones/notes/p-abc1/2026-10-27.md'].content, '# old note\n');
  assert.equal(ws.disk['oneonones/notes/p-abc1/stray.md'], undefined, 'only dated notes');
  assert.deepEqual(d.notesOf(PERSON.id).map(n => n.day), ['2026-10-27']);
  assert.equal(d.v.moved.people, 1);
  assert.equal(ws.away['oneonones:notes/p-abc1/2026-10-27.md'].content, '# old note\n', 'the old note is untouched');

  // A second load copies nothing more; a note written in the old app meanwhile still arrives.
  ws.away['oneonones:notes/p-abc1/2026-11-01.md'] = { content: '# later\n', mtime: 9 };
  const d2 = createOneOnOnes(ws, { now: () => NOW + 864e5 });
  const again = await d2.loadAll();
  assert.deepEqual(again, { people: 0, notes: 1, first: false });
  assert.equal(d2.v.moved.notes, 2);
  assert.equal(ws.store['oneonones/people'].items.length, 1, 'people are not copied twice');
});

test('the copy never writes over Rapport data, and stops looking after 30 days', async () => {
  const mineEnv = { schema: 'receipts.oneonones/people', version: 1, rev: 3, deleted: {}, items: [{ ...PERSON, name: 'Mine', updatedAt: 9 }] };
  const ws = fakeWs({
    stored: { 'oneonones/people': mineEnv },
    files: { 'oneonones/notes/p-abc1/2026-10-27.md': { content: 'mine', mtime: 2 } },
    others: { 'oneonones.people': { schema: 'oneonones.people', version: 1, rev: 7, deleted: {}, items: [{ ...PERSON, name: 'Old', updatedAt: 3 }] } },
    otherFiles: { 'oneonones:notes/p-abc1/2026-10-27.md': { content: 'old', mtime: 5 } }
  });
  const d = createOneOnOnes(ws, { now: () => NOW });
  assert.equal(await d.loadAll(), null, 'nothing to copy');
  assert.equal(d.v.people[0].name, 'Mine');
  assert.equal(ws.disk['oneonones/notes/p-abc1/2026-10-27.md'].content, 'mine');

  const late = fakeWs({
    stored: { 'oneonones/settings': { schema: 'receipts.oneonones/settings', version: 1, rev: 1, deleted: {}, items: [], meta: { updatedAt: 1, moved: { at: '2026-09-01T00:00:00.000Z', people: 1, notes: 0 } } } },
    otherFiles: { 'oneonones:notes/p-abc1/2026-10-27.md': { content: 'old', mtime: 5 } }
  });
  const d2 = createOneOnOnes(late, { now: () => NOW });
  assert.equal(await d2.loadAll(), null);
  assert.equal(late.disk['oneonones/notes/p-abc1/2026-10-27.md'], undefined, 'after 30 days a removed note stays removed');
});

test('no old 1:1s app: loading writes nothing', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  assert.equal(await d.loadAll(), null);
  assert.deepEqual(ws.puts, []);
  assert.equal(d.v.moved, null);
});


test('settings: the draft step can be turned off', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  assert.equal(d.v.settings.aiDraft, true);
  await d.saveSettings({ aiDraft: false });
  assert.equal(d.v.settings.aiDraft, false);
  assert.equal(ws.store['oneonones/settings'].meta.aiDraft, false);
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

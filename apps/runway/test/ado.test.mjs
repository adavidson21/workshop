// Runway's ADO model: turning the connector's `roadmap` result into lanes and items, live refresh, and linked
// merges that never overwrite your edits. Synthetic fixtures in the connector's documented shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLive, cleanSource, describe, iterationIndex, keepMine, mergeLinked, placeItem, pulled, statusOf, stopFollowing, unlink, useRemote
} from '../js/ado/model.js';
import { blankDoc, fromEnvelope, toEnvelopeParts } from '../js/model.js';
import { createAdo } from '../js/ado/index.js';

const URL = id => `https://ado.example.test/Platform/_workitems/edit/${id}`;
const w = (id, type, title, extra = {}) => ({ id, rev: 1, type, title, state: 'Active', area: 'Platform\\Docs', iteration: '', parentId: null, startDate: null, targetDate: null, changed: '2026-11-01T00:00:00Z', url: URL(id), ...extra });
const ITER = { Platform: [{ path: 'Platform\\Sprint 1', start: '2027-01-06', finish: '2027-01-19' }] };
const result = (items) => ({ connection: 'work', items, total: items.length, truncated: false, fetchedAt: '2026-11-03T12:00:00Z' });
const SRC = cleanSource({ areas: 'Platform\\Docs\nPlatform\\Monitor', mode: 'linked' });

const ITEMS = () => [
  w(1, 'Epic', 'Docs Portal', { startDate: '2027-01-04', targetDate: '2027-03-31' }),
  w(2, 'Feature', 'Content migration', { parentId: 1, iteration: 'Platform\\Sprint 1', storiesTotal: 4, storiesDone: 1 }),
  w(3, 'Feature', 'Search cutover', { parentId: 1, targetDate: '2027-02-20', state: 'New' }),
  w(4, 'Feature', 'Alerting rework', { area: 'Platform\\Monitor\\Alerts', state: 'Closed' }),
  w(5, 'Feature', 'Elsewhere', { area: 'Other\\Team' })
];

test('cleanSource needs area paths and fills defaults', () => {
  assert.equal(cleanSource({ areas: '  \n ' }), null);
  assert.equal(cleanSource(null), null);
  const s = cleanSource({ areas: 'A/B\nA\\B\nC', types: ['Feature', 'Bug'], lanes: 'nope', mode: 'x' });
  assert.deepEqual(s.areas, ['A\\B', 'C']);
  assert.deepEqual(s.types, ['Feature']);
  assert.equal(s.lanes, 'area');
  assert.equal(s.mode, 'linked');
  assert.deepEqual(cleanSource({ areas: ['A'], types: [] }).types, ['Epic', 'Feature']);
});

test('statusOf maps ADO states', () => {
  assert.equal(statusOf('New'), 'planned');
  assert.equal(statusOf('Active'), 'active');
  assert.equal(statusOf('In Progress'), 'active');
  assert.equal(statusOf('Closed'), 'done');
  assert.equal(statusOf('Done'), 'done');
  assert.equal(statusOf('Removed'), 'cut');
});

test('placement: own dates, one date, sprint, none', () => {
  const it = iterationIndex(ITER);
  assert.deepEqual(placeItem({ startDate: '2027-02-01', targetDate: '2027-01-01' }, it), { start: '2027-01-01', end: '2027-02-01' });
  assert.deepEqual(placeItem({ targetDate: '2027-02-20' }, it), { start: '2027-02-06', end: '2027-02-20' });
  assert.deepEqual(placeItem({ startDate: '2027-01-10', iteration: 'platform\\sprint 1' }, it), { start: '2027-01-10', end: '2027-01-19' });
  assert.deepEqual(placeItem({ iteration: 'Platform\\Sprint 1' }, it), { start: '2027-01-06', end: '2027-01-19' });
  assert.deepEqual(placeItem({ iteration: 'Platform\\Sprint 9' }, it), { start: null, end: null });
});

test('describe: type, id, state, stories, and only an http(s) link', () => {
  assert.equal(describe(w(2, 'Feature', 'x', { storiesTotal: 4, storiesDone: 1 })), `Feature #2 · Active · 1 of 4 stories done\n${URL(2)}`);
  assert.equal(describe(w(9, 'Epic', 'x', { url: 'javascript:alert(1)' })), 'Epic #9 · Active');
});

test('lanes by area: longest match wins, Other for the rest', () => {
  const d = pulled(result(ITEMS()), ITER, SRC);
  assert.deepEqual(d.lanes.map(l => l.title), ['Docs', 'Monitor', 'Other']);
  const lane = Object.fromEntries(d.items.map(i => [i.title, i.laneKey]));
  assert.equal(lane['Docs Portal'], 'area:platform\\docs');
  assert.equal(lane['Alerting rework'], 'area:platform\\monitor');
  assert.equal(lane.Elsewhere, 'area:other');
  const alerting = d.items.find(i => i.title === 'Alerting rework');
  assert.equal(alerting.status, 'done');
  assert.equal(alerting.ado.id, 4);
  assert.equal(alerting.ado.connection, 'work');
  assert.deepEqual(alerting.ado.base, { title: 'Alerting rework', start: null, end: null, status: 'done' });
});

test('lanes by Epic: an Epic with Features is a lane, Features without one go to No Epic', () => {
  const d = pulled(result(ITEMS()), ITER, { ...SRC, lanes: 'epic' });
  assert.deepEqual(d.lanes.map(l => l.title), ['Docs Portal', 'No Epic']);
  assert.deepEqual(d.items.map(i => i.title).sort(), ['Alerting rework', 'Content migration', 'Docs Portal', 'Elsewhere', 'Search cutover']);
  const epic = d.items.find(i => i.ado.type === 'Epic');
  assert.deepEqual([epic.milestone, epic.start, epic.end, epic.laneKey], [true, '2027-03-31', '2027-03-31', 'epic:1'], 'the Epic is the lane, and its target date a milestone');
  const noDate = pulled(result(ITEMS().map(x => (x.id === 1 ? { ...x, targetDate: null } : x))), ITER, { ...SRC, lanes: 'epic' });
  assert.ok(!noDate.items.some(i => i.ado.type === 'Epic'), 'an Epic with no target date is only the lane');
  const lone = pulled(result([w(7, 'Epic', 'Solo', { targetDate: '2027-05-01' })]), {}, { ...SRC, lanes: 'epic' });
  assert.deepEqual(lone.lanes.map(l => l.title), ['Solo']);
  assert.equal(lone.items[0].title, 'Solo');
});

test('types filter', () => {
  const d = pulled(result(ITEMS()), ITER, { ...SRC, types: ['Epic'] });
  assert.deepEqual(d.items.map(i => i.title), ['Docs Portal']);
});

test('live: replaces lanes and items with stable ids, keeps your meta', () => {
  const doc = blankDoc('Platform');
  doc.meta.goals = [{ date: '2027-01-01', text: 'Ship it' }];
  const src = { ...SRC, mode: 'live' };
  const live = applyLive(doc, pulled(result(ITEMS()), ITER, src), src, result(ITEMS()));
  assert.equal(live.meta.title, 'Platform');
  assert.equal(live.meta.goals.length, 1);
  assert.equal(live.meta.ado.mode, 'live');
  assert.equal(live.meta.ado.fetchedAt, '2026-11-03T12:00:00Z');
  assert.ok(live.items.every(i => i.id.startsWith('i-ado-')));
  live.meta.hidden = [live.lanes[0].id, 'gone'];
  const again = applyLive(live, pulled(result(ITEMS().slice(0, 3)), ITER, src), src, result([]));
  assert.deepEqual(again.items.map(i => i.id), ['i-ado-1', 'i-ado-2', 'i-ado-3']);
  assert.deepEqual(again.meta.hidden, [live.lanes[0].id]);
  // It survives a save and load.
  const back = fromEnvelope({ ...toEnvelopeParts(again), version: 1 });
  assert.equal(back.items[0].ado.id, 1);
  assert.equal(back.lanes[0].adoKey, again.lanes[0].adoKey);
  assert.equal(back.meta.ado.mode, 'live');
});

test('linked: import adds items next to ad hoc ones', () => {
  const doc = blankDoc('Mixed');
  doc.items.push({ id: 'i-mine', kind: 'item', lane: null, order: 0, title: 'My idea', start: null, end: null, size: null, milestone: false, status: 'planned', color: '', notes: '', dependsOn: [], afterMissing: [] });
  const r = mergeLinked(doc, pulled(result(ITEMS()), ITER, SRC), SRC, result(ITEMS()));
  assert.equal(r.added, 5);
  assert.ok(r.doc.items.some(i => i.id === 'i-mine' && !i.ado));
  assert.equal(r.doc.meta.ado.mode, 'linked');
  assert.equal(doc.items.length, 1, 'the input doc is not changed');
});

test('linked: ADO changes flow in unless you changed the item; then it differs', () => {
  const first = mergeLinked(blankDoc(), pulled(result(ITEMS()), ITER, SRC), SRC, result(ITEMS())).doc;
  const mine = first.items.find(i => i.ado.id === 3);
  mine.end = '2027-03-15';                                  // your edit
  const changed = ITEMS();
  changed[1].title = 'Content migration v2';                 // ADO edit, item you did not touch
  changed[2].targetDate = '2027-02-27';                      // ADO edit, item you did touch
  const r = mergeLinked(first, pulled(result(changed), ITER, SRC), SRC, result(changed));
  assert.equal(r.updated, 1);
  assert.equal(r.differs, 1);
  assert.equal(r.doc.items.find(i => i.ado.id === 2).title, 'Content migration v2');
  const diff = r.doc.items.find(i => i.ado.id === 3);
  assert.equal(diff.end, '2027-03-15', 'your edit is kept');
  assert.equal(diff.ado.remote.end, '2027-02-27');
  // Refresh again with nothing new: still differs, nothing counted twice.
  const r2 = mergeLinked(r.doc, pulled(result(changed), ITER, SRC), SRC, result(changed));
  assert.equal(r2.updated + r2.differs, 0);
  assert.ok(r2.doc.items.find(i => i.ado.id === 3).ado.remote);
  // Use ADO's, or keep yours.
  const a = structuredClone(r2.doc); assert.ok(useRemote(a, diff.id));
  assert.equal(a.items.find(i => i.id === diff.id).end, '2027-02-27');
  assert.equal(a.items.find(i => i.id === diff.id).ado.remote, undefined);
  const b = structuredClone(r2.doc); assert.ok(keepMine(b, diff.id));
  assert.equal(b.items.find(i => i.id === diff.id).end, '2027-03-15');
  const r3 = mergeLinked(b, pulled(result(changed), ITER, SRC), SRC, result(changed));
  assert.equal(r3.doc.items.find(i => i.id === diff.id).end, '2027-03-15', 'kept until ADO changes it again');
});

test('linked: your edit to an unchanged ADO item stays', () => {
  const first = mergeLinked(blankDoc(), pulled(result(ITEMS()), ITER, SRC), SRC, result(ITEMS())).doc;
  first.items.find(i => i.ado.id === 4).title = 'Alerting, renamed by me';
  const r = mergeLinked(first, pulled(result(ITEMS()), ITER, SRC), SRC, result(ITEMS()));
  assert.equal(r.updated + r.differs, 0);
  assert.equal(r.doc.items.find(i => i.ado.id === 4).title, 'Alerting, renamed by me');
});

test('linked: a work item that disappears is marked, never deleted; unlink and stop following', () => {
  const first = mergeLinked(blankDoc(), pulled(result(ITEMS()), ITER, SRC), SRC, result(ITEMS())).doc;
  const r = mergeLinked(first, pulled(result(ITEMS().slice(0, 4)), ITER, SRC), SRC, result([]));
  assert.equal(r.missing, 1);
  const gone = r.doc.items.find(i => i.ado.id === 5);
  assert.equal(gone.ado.missing, true);
  assert.ok(unlink(r.doc, gone.id));
  assert.equal(r.doc.items.find(i => i.id === gone.id).ado, undefined);
  assert.ok(stopFollowing(r.doc));
  assert.equal(r.doc.meta.ado, undefined);
  assert.ok(r.doc.lanes.every(l => !l.adoKey));
});

test('createAdo: reports the connector state and reads through roadmap and iterations.list only', async () => {
  const calls = [];
  const ws = {
    data: { async get(name, o) { return name === 'settings' && o.app === 'queue' ? { version: 1, meta: { areas: ['Platform\\Docs'], connection: 'work' } } : null; } },
    connectors: {
      status: 'ready',
      async list() { return [{ id: 'ado', status: { state: this.status, message: 'PAT missing' } }]; },
      async call(id, action, args) {
        calls.push([id, action, args]);
        if (action === 'roadmap') return result(ITEMS());
        if (action === 'iterations.list') return { iterations: ITER[args.project] || [] };
        throw new Error('unexpected');
      }
    }
  };
  const ado = createAdo(ws);
  assert.equal((await ado.check()).ready, true);
  ws.connectors.status = 'error';
  assert.equal((await ado.check()).message, 'PAT missing');
  ws.connectors.status = 'disabled';
  assert.match((await ado.check()).message, /off/);
  assert.deepEqual(await ado.defaults(), { areas: ['Platform\\Docs'], connection: 'work' });
  const r = await ado.refresh(blankDoc(), { areas: ['Platform\\Docs'], connection: 'work', mode: 'live' });
  assert.equal(r.doc.meta.ado.mode, 'live');
  assert.ok(calls.every(c => c[0] === 'ado' && ['roadmap', 'iterations.list'].includes(c[1])));
  assert.deepEqual(calls[0][2], { connection: 'work', areas: ['Platform\\Docs'] });
  await assert.rejects(ado.pull({ areas: '' }), /area path/);
  ws.connectors.list = async () => { throw new Error('down'); };
  assert.equal((await ado.check()).ready, false);
});

test('ADO roadmaps pass Runway\'s JSON Schemas', async () => {
  const { SchemaSet } = await import('./workshop/schema.mjs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const schemas = SchemaSet.fromDir(join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas'));
  const first = mergeLinked(blankDoc(), pulled(result(ITEMS()), ITER, SRC), SRC, result(ITEMS())).doc;
  first.items.find(i => i.ado.id === 3).end = '2027-03-15';
  const changed = ITEMS(); changed[2].targetDate = '2027-02-27';
  const doc = mergeLinked(first, pulled(result(changed), ITER, SRC), SRC, result(changed)).doc;
  const parts = toEnvelopeParts(doc);
  for (const it of parts.items.filter(i => i.kind === 'item')) assert.deepEqual(schemas.validate('map-item', it), [], it.title);
  assert.deepEqual(schemas.validate('map-meta', parts.meta), []);
  assert.ok(doc.items.some(i => i.ado.remote), 'the differs case is covered');
});

const STORIES = () => [
  ...ITEMS(),
  w(21, 'User Story', 'Index rebuild', { parentId: 3, iteration: 'Platform\\Sprint 1', area: 'Elsewhere\\Team' }),
  w(22, 'Issue', 'Old links', { parentId: 3, state: 'New' }),
  w(23, 'User Story', 'Orphan', { parentId: 99 })
];

test('User Stories: named Feature > Story, in their Feature\'s lane, and the Feature is not drawn again', () => {
  const src = cleanSource({ areas: 'Platform\\Docs\nPlatform\\Monitor', types: ['Epic', 'Feature', 'User Story'] });
  const d = pulled(result(STORIES()), ITER, { ...src, lanes: 'epic' });
  const titles = d.items.map(i => i.title);
  assert.ok(titles.includes('Search cutover > Index rebuild') && titles.includes('Search cutover > Old links'));
  assert.ok(!titles.includes('Search cutover'), 'a Feature whose stories are shown is not its own bar');
  assert.ok(titles.includes('Content migration'), 'a Feature with no stories here stays a bar');
  assert.ok(!titles.some(t => t.includes('Orphan')), 'a story whose Feature is not in the roadmap is left out');
  const story = d.items.find(i => i.title === 'Search cutover > Index rebuild');
  assert.equal(story.laneKey, 'epic:1');
  assert.deepEqual([story.start, story.end], ['2027-01-06', '2027-01-19'], 'placed by its sprint');
  const byArea = pulled(result(STORIES()), ITER, src);
  assert.equal(byArea.items.find(i => i.title === 'Search cutover > Index rebuild').laneKey, 'area:platform\\docs', 'by area, a story follows its Feature, not its own area');
  const without = pulled(result(STORIES()), ITER, SRC);
  assert.ok(!without.items.some(i => i.title.includes(' > ')), 'stories only when asked');
});

test('roadmapArgs asks for stories only when User Stories are chosen', async () => {
  const { roadmapArgs } = await import('../js/ado/model.js');
  assert.equal(roadmapArgs(SRC).stories, undefined);
  assert.equal(roadmapArgs(cleanSource({ areas: 'A', types: ['User Story'] })).stories, true);
});

test('Epic lanes sort with version numbers in order', () => {
  const items = ['v2.10', 'v2.9', 'v10.0', 'v2.9.1'].map((t, i) => w(i + 1, 'Epic', t, { targetDate: '2027-01-01' }))
    .concat([1, 2, 3, 4].map(n => w(100 + n, 'Feature', `F${n}`, { parentId: n })));
  const d = pulled(result(items), {}, { ...SRC, lanes: 'epic' });
  assert.deepEqual(d.lanes.map(l => l.title), ['v2.9', 'v2.9.1', 'v2.10', 'v10.0']);
});

test('a linked refresh and a live one keep the Epic milestone', () => {
  const src = { ...SRC, lanes: 'epic' };
  const live = applyLive(blankDoc('x'), pulled(result(ITEMS()), ITER, src), src, result(ITEMS()));
  assert.equal(live.items.find(i => i.ado.type === 'Epic').milestone, true);
  const linked = mergeLinked(blankDoc('y'), pulled(result(ITEMS()), ITER, src), src, result(ITEMS())).doc;
  assert.equal(linked.items.find(i => i.ado.type === 'Epic').milestone, true);
});

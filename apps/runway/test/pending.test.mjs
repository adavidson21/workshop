import test from 'node:test';
import assert from 'node:assert/strict';
import { data as sdkData } from '../shared/workshop-sdk.js';
import { fromEnvelope } from '../js/model.js';
import { acceptedIdeas, createPending, ideaToItem, writeToMap } from '../js/pending.js';

const H = { id: 'c_1', updatedAt: 1, to: 'runway', date: '2026-11-04', createdAt: '2026-11-04T21:00:00Z', text: 'Dark mode for the docs site\nUsers keep asking',
  payload: { kind: 'idea' }, source: { app: 'home', id: 'c_1' }, accepted: true };
const env = (items) => ({ schema: 'home.handoffs', version: 1, rev: 1, items, deleted: {} });
const MAP = { schema: 'runway.maps/m-1', version: 1, rev: 1, deleted: {}, meta: { title: 'Docs', updatedAt: 1 },
  items: [{ id: 'l1', kind: 'lane', title: 'Edge', order: 0 }, { id: 'e1', kind: 'item', lane: 'l1', order: 0, title: 'Epic' }] };

function fakeWs(cols) {
  return {
    data: {
      stamp: sdkData.stamp, merge: sdkData.merge,
      async get(name, o = {}) { const v = cols.get(`${o.app || 'runway'}/${name}`); return v ? structuredClone(v) : null; },
      async put(name, e) { const rev = (e.rev || 0) + 1; cols.set(`runway/${name}`, { ...structuredClone(e), rev }); return { rev }; },
      subscribe() {}
    }
  };
}

test('acceptedIdeas: only accepted ideas for Runway, title from the first line, a valid map id kept', () => {
  const items = [H, { ...H, id: 'c_2', accepted: false }, { ...H, id: 'c_3', to: 'notes' }, { ...H, id: 'c_4', payload: { kind: 'note' } },
    { ...H, id: 'c_5', payload: { kind: 'idea', map: 'm-1' } }, { ...H, id: 'c_6', payload: { kind: 'idea', map: '../x' } }];
  const got = acceptedIdeas('home', env(items));
  assert.deepEqual(got.map(o => o.key), ['home:c_1', 'home:c_5', 'home:c_6']);
  assert.equal(got[0].title, 'Dark mode for the docs site');
  assert.equal(got[0].notes, 'Users keep asking');
  assert.equal(got[1].map, 'm-1');
  assert.equal(got[2].map, null);
  assert.deepEqual(acceptedIdeas('home', env(items), new Set(['home:c_1', 'home:c_5', 'home:c_6'])), []);
});

test('ideaToItem: unscheduled, in the lane, under an allowed parent only', () => {
  const doc = fromEnvelope(MAP);
  const it = ideaToItem(doc, { title: 'X', notes: '' }, { lane: 'l1', parent: 'e1' });
  assert.equal(it.parent, 'e1'); assert.equal(it.lane, 'l1'); assert.equal(it.start, null);
  assert.equal(ideaToItem(doc, { title: 'X' }, { lane: null, parent: 'e1' }).parent, null, 'parent must be in the same lane');
});

test('pickup: a named roadmap gets the item, the rest wait on Pending, each once; assign moves it to a roadmap', async () => {
  const cols = new Map([['home/handoffs', env([H, { ...H, id: 'c_5', text: 'Search filters', payload: { kind: 'idea', map: 'm-1' } }])], ['runway/maps/m-1', MAP]]);
  const ws = fakeWs(cols);
  const p = createPending(ws, { hasMap: id => id === 'm-1', addToMap: (id, idea, o) => writeToMap(ws, id, fromEnvelope, idea, o) });
  await p.load();
  assert.equal(await p.pickup(), 2);
  assert.deepEqual(p.v.items.map(x => x.title), ['Dark mode for the docs site']);
  assert.ok(cols.get('runway/maps/m-1').items.some(i => i.title === 'Search filters' && i.start === null));
  assert.equal(await p.pickup(), 0, 'never twice');
  await p.assign(p.v.items[0].id, 'm-1', { lane: 'l1', parent: 'e1' });
  assert.equal(p.v.items.length, 0);
  const added = cols.get('runway/maps/m-1').items.find(i => i.title === 'Dark mode for the docs site');
  assert.equal(added.parent, 'e1');
  assert.equal(added.notes, 'Users keep asking');
  assert.equal(await p.pickup(), 0, 'an assigned idea does not come back');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roadmapItemOffer, sendOffer } from '../js/offers.js';
import { pendingCard } from '../js/summary.js';
import { fakeWs } from './fake.mjs';

const NOW = new Date('2026-11-07T15:00:00Z');
const doc = { items: [
  { id: 'e1', kind: 'item', title: 'Payments', parent: null },
  { id: 'f1', kind: 'item', title: 'Refunds', parent: 'e1', notes: 'Partial too', ado: { id: 42, rev: 3, type: 'Feature', url: 'https://example.test/42', connection: 'work', state: 'New' } },
  { id: 's1', kind: 'item', title: 'Refund API', parent: 'f1' }
] };

test('roadmapItemOffer: an accepted roadmap-item offer with the level from nesting and the ADO link', () => {
  const o = roadmapItemOffer(doc, 'm_a', 'f1', 'slate', NOW);
  assert.equal(o.to, 'slate');
  assert.equal(o.accepted, true);
  assert.deepEqual(o.source, { app: 'runway', id: 'f1' });
  assert.equal(o.text, 'Refunds\nPartial too');
  assert.deepEqual(o.payload, { kind: 'roadmap-item', map: 'm_a', item: 'f1', title: 'Refunds', notes: 'Partial too', level: 'feature',
    ado: { id: 42, rev: 3, type: 'Feature', url: 'https://example.test/42', connection: 'work', state: 'New' } });
  assert.equal(roadmapItemOffer(doc, 'm_a', 'e1', 'slate', NOW).payload.level, 'epic');
  assert.equal(roadmapItemOffer(doc, 'm_a', 's1', 'slate', NOW).payload.level, 'story');
  assert.equal(roadmapItemOffer(doc, 'm_a', 's1', 'slate', NOW).payload.ado, undefined);
  assert.equal(roadmapItemOffer(doc, 'm_a', 'gone', 'slate', NOW), null);
  assert.equal(roadmapItemOffer(doc, 'm_a', 'f1', '', NOW), null);
});

test('sendOffer: writes runway.handoffs, replaces the same id, drops offers older than 60 days', async () => {
  const ws = fakeWs();
  await sendOffer(ws, roadmapItemOffer(doc, 'm_a', 'f1', 'slate', NOW), NOW);
  assert.equal(ws.store.handoffs.schema, 'runway.handoffs');
  assert.equal(ws.store.handoffs.items.length, 1);
  ws.store.handoffs.items.push({ id: 'old', to: 'slate', date: '2026-08-01', updatedAt: 1 });
  await sendOffer(ws, roadmapItemOffer(doc, 'm_a', 'f1', 'slate', NOW), NOW);
  assert.deepEqual(ws.store.handoffs.items.map(x => x.id), ['h_m_a_f1_slate']);
});

test('sendOffer: retries once on a conflict', async () => {
  const ws = fakeWs({ stored: { handoffs: { schema: 'runway.handoffs', version: 1, rev: 4, items: [{ id: 'keep', to: 'slate', date: '2026-11-06', updatedAt: 1 }], deleted: {} } } });
  const realGet = ws.data.get;
  ws.data.get = async () => ({ schema: 'runway.handoffs', version: 1, rev: 3, items: [], deleted: {} });
  await sendOffer(ws, roadmapItemOffer(doc, 'm_a', 's1', 'slate', NOW), NOW);
  ws.data.get = realGet;
  assert.deepEqual(ws.store.handoffs.items.map(x => x.id).sort(), ['h_m_a_s1_slate', 'keep']);
});

test('pendingCard: rows say which app sent the idea, when known', () => {
  const card = pendingCard({ items: [{ id: 'p1', title: 'A', date: '2026-11-06', app: 'slate', from: 'Slate' }, { id: 'p2', title: 'B', from: 'Home' }, { id: 'p3', title: 'C', app: 'Bad App' }] });
  assert.equal(card.rows[0].from, 'slate');
  assert.equal(card.rows[1].from, undefined);
  assert.equal(card.rows[2].from, undefined);
});

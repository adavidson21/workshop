import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardDay, createSummaryWriter, horizon, readCards, summaryEnvelope, targetsFor } from '../summary.js';

test('horizon: today and the next 6 days, across a month end', () => {
  assert.deepEqual(horizon('2026-10-29'), ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
});

test('summaryEnvelope: stamps only what changed, tombstones what went, null when nothing changed', () => {
  const cards = [{ id: 'a', kind: 'count', title: 'A', count: 1 }, { id: 'b', kind: 'count', title: 'B', count: 2 }];
  const first = summaryEnvelope('runway', cards, null, 100);
  assert.equal(first.schema, 'runway.summary');
  assert.equal(first.rev, 0);
  assert.deepEqual(first.items.map(i => i.updatedAt), [100, 100]);
  const stored = Object.assign({}, first, { rev: 1 });
  assert.equal(summaryEnvelope('runway', cards, stored, 200), null);
  const next = summaryEnvelope('runway', [{ id: 'a', kind: 'count', title: 'A', count: 5 }], stored, 300);
  assert.equal(next.rev, 1);
  assert.deepEqual(next.items, [{ id: 'a', kind: 'count', title: 'A', count: 5, updatedAt: 300 }]);
  assert.deepEqual(next.deleted, { b: 300 });
});

test('createSummaryWriter: writes once per change, retries a conflict, skips when build says so or a newer version is stored', async () => {
  let stored = null, puts = 0, conflictOnce = true, skip = false;
  const data = {
    async get() { return stored; },
    async put(col, env) {
      assert.equal(col, 'summary');
      if (conflictOnce) { conflictOnce = false; stored = { schema: 'x.summary', version: 1, rev: 1, items: [], deleted: {} }; throw Object.assign(new Error('stale'), { code: 'conflict' }); }
      assert.equal(env.rev, stored ? stored.rev : 0);
      puts++; stored = Object.assign({}, env, { rev: (stored ? stored.rev : 0) + 1 });
    }
  };
  let count = 1;
  const w = createSummaryWriter({ data, app: 'x', build: () => skip ? null : [{ id: 'n', kind: 'count', title: 'N', count }], now: () => 5 });
  assert.equal(await w.flush(), true);
  assert.equal(puts, 1);
  assert.equal(await w.flush(), false, 'unchanged: no write');
  count = 2; await w.flush();
  assert.equal(puts, 2);
  skip = true; count = 3; await w.flush();
  assert.equal(puts, 2, 'skipped');
  skip = false; stored = Object.assign({}, stored, { version: 2 }); await w.flush();
  assert.equal(puts, 2, 'a newer version is left alone');
});

test('readCards, cardDay and targetsFor', () => {
  const env = { schema: 'prioritizer.summary', version: 1, rev: 3, items: [
    { id: 'board', kind: 'board', updatedAt: 1, days: { '2026-11-04': { open: 3 } } },
    { id: 'lists', kind: 'targets', capture: 'task', updatedAt: 1, rows: [{ id: 'l1', title: 'Inbox' }, { id: 2 }] },
    { kind: 'bad' }
  ] };
  const cards = readCards(env, 'prioritizer');
  assert.deepEqual([...cards.keys()], ['board', 'lists']);
  assert.equal(readCards(env, 'runway'), null, 'another app\'s schema');
  assert.equal(readCards(Object.assign({}, env, { version: 2 }), 'prioritizer'), null);
  assert.equal(readCards(null, 'prioritizer'), null);
  assert.deepEqual(cardDay(cards.get('board'), '2026-11-04'), { open: 3 });
  assert.equal(cardDay(cards.get('board'), '2026-11-12'), null, 'stale');
  assert.equal(cardDay(undefined, '2026-11-04'), null);
  assert.deepEqual(targetsFor([null, cards], 'task'), [{ id: 'l1', title: 'Inbox' }]);
  assert.equal(targetsFor([cards], 'idea'), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureContext } from '../js/capture.js';
import { readCards } from '../../../shared/summary.js';

test('captureContext: lists and roadmaps from the apps\' summaries, their own collections as the fallback', () => {
  const docket = readCards({ schema: 'prioritizer.summary', version: 1, rev: 1, items: [{ id: 'lists', kind: 'targets', capture: 'task', title: 'Lists', updatedAt: 1, rows: [{ id: 'l1', title: 'Inbox' }] }] }, 'prioritizer');
  const runway = readCards({ schema: 'runway.summary', version: 1, rev: 1, items: [{ id: 'roadmaps', kind: 'targets', capture: 'idea', title: 'Roadmaps', updatedAt: 1, rows: [{ id: 'm_a', title: 'Platform' }] }] }, 'runway');
  const lists = { schema: 'prioritizer.lists', version: 1, items: [{ id: 'x', name: 'Old list' }] };
  const maps = { schema: 'runway.index', version: 1, items: [{ id: 'm_old', title: 'Old map' }] };
  const now = new Date(2026, 10, 4, 9);
  const c = captureContext({ lists, maps, summaries: [docket, runway] }, now);
  assert.deepEqual(c.lists, ['Inbox']);
  assert.deepEqual(c.maps, [{ id: 'm_a', title: 'Platform' }]);
  const old = captureContext({ lists, maps, summaries: [null, null] }, now);
  assert.deepEqual(old.lists, ['Old list']);
  assert.deepEqual(old.maps, [{ id: 'm_old', title: 'Old map' }]);
});

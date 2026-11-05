import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureContext } from '../js/capture.js';
import { readCards } from '../../../shared/summary.js';

test('captureContext: lists and roadmaps from the apps\' summaries only', () => {
  const docket = readCards({ schema: 'prioritizer.summary', version: 1, rev: 1, items: [{ id: 'lists', kind: 'targets', capture: 'task', title: 'Lists', updatedAt: 1, rows: [{ id: 'l1', title: 'Inbox' }] }] }, 'prioritizer');
  const runway = readCards({ schema: 'runway.summary', version: 1, rev: 1, items: [{ id: 'roadmaps', kind: 'targets', capture: 'idea', title: 'Roadmaps', updatedAt: 1, rows: [{ id: 'm_a', title: 'Platform' }] }] }, 'runway');
  const now = new Date(2026, 10, 4, 9);
  const c = captureContext({ summaries: [docket, runway] }, now);
  assert.deepEqual(c.lists, ['Inbox']);
  assert.deepEqual(c.maps, [{ id: 'm_a', title: 'Platform' }]);
  assert.deepEqual(captureContext({ summaries: [null, null] }, now).lists, []);
  assert.deepEqual(captureContext({}, now).maps, []);
});

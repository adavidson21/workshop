import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEEP, actionItems, emptyOffers, offerFor, offerId, readOffers, sentIds, wins, withOffer } from '../js/offers.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';

const schemas = SchemaSet.fromDir(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'schemas'));
const NOTE = '---\ntitle: Sync\n---\n# Sync\n\n- [ ] Draft the rollout plan\n- [x] Book the room\n  - [ ] Nested item #win\n* Shipped the cache layer #win today\n\n```\n- [ ] not an item #win\n```\n#winning is not a win\n';

test('action items: open and done, outside code and frontmatter, with whole-file lines', () => {
  assert.deepEqual(actionItems(NOTE), [
    { line: 5, text: 'Draft the rollout plan', done: false },
    { line: 6, text: 'Book the room', done: true },
    { line: 7, text: 'Nested item #win', done: false }
  ]);
});

test('wins: lines tagged #win with the marker and tag taken out', () => {
  assert.deepEqual(wins(NOTE), [{ line: 7, text: 'Nested item' }, { line: 8, text: 'Shipped the cache layer today' }]);
});

test('a task offer is accepted and shaped for Docket; a win offer is ordinary and shaped for Rapport', () => {
  const now = new Date('2026-11-05T15:00:00Z');
  const note = { path: 'meetings/sync.md', title: 'Sync' };
  const task = offerFor('task', note, 'Draft the rollout plan', { day: '2026-11-05', now });
  assert.equal(task.to, 'prioritizer');
  assert.equal(task.accepted, true);
  assert.equal(task.payload.kind, 'task');
  assert.equal(task.payload.title, 'Draft the rollout plan');
  assert.match(task.payload.notes, /meetings\/sync\.md/);
  const win = offerFor('win', note, 'Shipped the cache layer', { day: '2026-11-05', now });
  assert.equal(win.to, 'receipts');
  assert.equal(win.accepted, undefined);
  assert.equal(win.payload.kind, 'win');
  for (const it of [task, win]) assert.deepEqual(schemas.validate('handoff-item', { ...it, updatedAt: now.getTime() }), []);
});

test('the same line keeps its id; the envelope keeps the newest KEEP and never adds an id twice', () => {
  assert.equal(offerId('task', 'a.md', 'Do it '), offerId('task', 'a.md', 'do it'));
  assert.notEqual(offerId('task', 'a.md', 'Do it'), offerId('win', 'a.md', 'Do it'));
  let env = emptyOffers();
  const it = offerFor('task', { path: 'a.md', title: 'A' }, 'Do it', { day: '2026-11-05' });
  env = withOffer(withOffer(env, it), it);
  assert.equal(env.items.length, 1);
  for (let k = 0; k < KEEP + 5; k++) env = withOffer(env, { ...it, id: `x${k}` });
  assert.equal(env.items.length, KEEP);
  assert.equal(sentIds(env).has('x0'), false);
  assert.equal(readOffers({ schema: 'notes.handoffs', version: 2, items: [] }), null);
  assert.deepEqual(readOffers(null).items, []);
});

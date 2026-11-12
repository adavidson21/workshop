// Tandem's first-pass PR reviews on PR tasks (js/pr-ai-model.js): which PRs wait for their review, how
// pr.reviews results become t.pr.ai, when held PRs land, and the words on the chip. The sync glue and the
// drawer are covered by test/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PR_HOLD_DEFAULT, aiFromStatus, aiLabel, aiTip, aiTone, applyStatuses, cleanAi, cleanHeld, cleanHoldMinutes, commitOf, holdsNew } from '../js/pr-ai-model.js';

const NOW = new Date('2026-11-05T15:00:00Z');
const HOLD = 60 * 60 * 1000;
const key = id => `https://ado.example.test/tfs/Coll|Shop|${id}`;
const task = (id, ai, extra = {}) => ({id: 't' + id, done: false, pr: {key: key(id), id, ai}, ...extra});
const heldOf = (id, since = NOW.toISOString()) => ({key: key(id), since, item: {key: key(id), id, title: `PR ${id}`, tier: 'pool'}});
const S = list => new Map(list.map(s => [String(s.id), s]));
const ago = m => new Date(NOW - m * 60000).toISOString();
// Stand-in for state.js cleanPr: needs a key.
const cleanPr = a => a && typeof a.key === 'string' && a.key ? {key: a.key, id: a.id} : null;

test('only asked and team PRs that are not waiting for the author are held, and only with Tandem on', () => {
  assert.equal(holdsNew(true, {tier: 'pool', waiting: false}), true);
  assert.equal(holdsNew(true, {tier: 'asked', waiting: false}), true);
  assert.equal(holdsNew(true, {tier: 'blocking', waiting: false}), false, 'blocking lands at once');
  assert.equal(holdsNew(true, {tier: 'pool', waiting: true}), false, 'waiting for author is never reviewed');
  assert.equal(holdsNew(false, {tier: 'pool', waiting: false}), false, 'Tandem off: as before');
});

test('cleaning: ai, hold minutes, held list, commit', () => {
  assert.equal(cleanAi({state: 'nope'}), null);
  assert.deepEqual(cleanAi({state: 'done', rec: 'Approve', risk: 'low', counts: {blocking: 0, shouldFix: 2, optional: -1}, extra: 1}),
    {state: 'done', rec: 'Approve', risk: 'low', counts: {blocking: 0, shouldFix: 2, optional: 0}});
  assert.equal(cleanHoldMinutes(undefined), PR_HOLD_DEFAULT);
  assert.equal(PR_HOLD_DEFAULT, 60);
  assert.equal(cleanHoldMinutes(2), PR_HOLD_DEFAULT, 'below the minimum');
  assert.equal(cleanHoldMinutes(90), 90);
  const h = cleanHeld([heldOf(1), heldOf(1), {key: 'x'}, null, {since: 'bad', item: {key: key(2), id: 2, title: 5}}], cleanPr);
  assert.equal(h.length, 2, 'duplicates and broken entries dropped');
  assert.equal(h[1].since, new Date(0).toISOString(), 'a bad date is treated as long ago');
  assert.equal(h[1].item.title, undefined);
  assert.equal(commitOf({commit: 'ABCDEF1234'}), 'abcdef1234');
  assert.equal(commitOf({commit: 'nope'}), null);
});

test('pr.reviews states become t.pr.ai', () => {
  assert.equal(aiFromStatus({state: 'queued'}, NOW).state, 'pending');
  assert.equal(aiFromStatus({state: 'running'}, NOW).state, 'pending');
  assert.equal(aiFromStatus({state: 'none'}, NOW), null);
  assert.equal(aiFromStatus(undefined, NOW), null);
  const d = aiFromStatus({state: 'done', recommendation: 'Request changes', risk: 'high', reviewedCommit: 'abc1234', counts: {blocking: 1, shouldFix: 0, optional: 3}}, NOW);
  assert.deepEqual({...d, at: undefined}, {state: 'done', rec: 'Request changes', risk: 'high', counts: {blocking: 1, shouldFix: 0, optional: 3}, commit: 'abc1234', at: undefined});
  assert.deepEqual({...aiFromStatus({state: 'failed', message: 'Repo not cloned.'}, NOW), at: undefined}, {state: 'failed', message: 'Repo not cloned.', at: undefined});
});

test('tasks follow their review; done tasks and tasks without ai are left alone', () => {
  const tasks = [task(1, {state: 'pending', at: ago(1)}), task(2, {state: 'pending', at: ago(1)}), task(3, null), task(4, {state: 'pending', at: ago(1)}, {done: true})];
  const out = applyStatuses({tasks, held: [], now: NOW, holdMs: HOLD, statuses: S([
    {id: 1, state: 'done', recommendation: 'Approve', risk: 'low', counts: {blocking: 0, shouldFix: 0, optional: 0}},
    {id: 2, state: 'asking', message: 'Which repo?'},
    {id: 3, state: 'done', recommendation: 'Approve'},
    {id: 4, state: 'done', recommendation: 'Approve'},
  ])});
  assert.equal(out.changed, 2);
  assert.equal(tasks[0].pr.ai.state, 'done');
  assert.equal(tasks[1].pr.ai.state, 'asking');
  assert.equal(tasks[2].pr.ai, null);
  assert.equal(tasks[3].pr.ai.state, 'pending');
  const again = applyStatuses({tasks, held: [], now: NOW, holdMs: HOLD, statuses: S([{id: 1, state: 'done', recommendation: 'Approve', risk: 'low', counts: {blocking: 0, shouldFix: 0, optional: 0}}])});
  assert.equal(again.changed, 0, 'the same result is not a change');
});

test('a late review still lands on its task, and a review never queued times out', () => {
  const tasks = [task(1, {state: 'timeout', at: ago(5)}), task(2, {state: 'pending', at: ago(61)}), task(3, {state: 'pending', at: ago(10)}), task(4, {state: 'pending', at: ago(1)})];
  applyStatuses({tasks, held: [], now: NOW, holdMs: HOLD, statuses: S([{id: 1, state: 'done', recommendation: 'Approve'}, {id: 2, state: 'none'}, {id: 3, state: 'none'}, {id: 4, state: 'skipped', message: 'Stopped before it started.'}])});
  assert.equal(tasks[0].pr.ai.state, 'done');
  assert.equal(tasks[1].pr.ai.state, 'timeout');
  assert.equal(tasks[2].pr.ai.state, 'pending', 'not yet past the hold limit');
  assert.equal(tasks[3].pr.ai.state, 'failed');
});

test('held PRs land when the review ends, fails, asks, is skipped, or the hold limit passes', () => {
  const held = [heldOf(1), heldOf(2), heldOf(3), heldOf(4, ago(60)), heldOf(5, ago(59)), heldOf(6), heldOf(7)];
  const out = applyStatuses({tasks: [], held, now: NOW, holdMs: HOLD, statuses: S([
    {id: 1, state: 'done', recommendation: 'Approve'},
    {id: 2, state: 'failed', message: 'x'},
    {id: 3, state: 'asking'},
    {id: 4, state: 'running'},
    {id: 5, state: 'queued'},
    {id: 6, state: 'skipped'},
    {id: 7, state: 'none'},
  ])});
  assert.deepEqual(out.release.map(r => [r.entry.item.id, r.ai.state]), [[1, 'done'], [2, 'failed'], [3, 'asking'], [4, 'timeout'], [6, 'failed']]);
  assert.deepEqual(out.held.map(h => h.item.id), [5, 7]);
  assert.equal(out.changed, 5);
});

test('chip words, tooltip and tone', () => {
  assert.equal(aiLabel({state: 'pending'}), 'AI reviewing');
  assert.equal(aiLabel({state: 'done', rec: 'Request changes'}), 'AI: Changes');
  assert.equal(aiLabel({state: 'done', rec: 'Approve after optional cleanup'}), 'AI: Approve');
  assert.equal(aiLabel({state: 'done', rec: 'Needs clarification'}), 'AI: Questions');
  assert.equal(aiLabel({state: 'asking'}), 'AI needs you');
  assert.equal(aiLabel(null), '');
  assert.match(aiTip({state: 'done', rec: 'Approve', risk: 'low', counts: {blocking: 0, shouldFix: 1, optional: 2}}), /^Approve, low risk\. 1 should-fix, 2 optional draft comments\.$/);
  assert.match(aiTip({state: 'pending'}), /nothing is posted/);
  assert.equal(aiTone({state: 'done', risk: 'high', counts: {}}), 'warn');
  assert.equal(aiTone({state: 'done', risk: 'low', counts: {blocking: 1}}), 'warn');
  assert.equal(aiTone({state: 'done', risk: 'low', counts: {blocking: 0}}), 'ok');
  assert.equal(aiTone({state: 'asking'}), 'gate');
  assert.equal(aiTone({state: 'pending'}), 'live');
});

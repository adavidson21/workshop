// Tasks 12.0.0: the agent queue (js/agent-queue.js): Builds' agents card, and personal tasks off showing only PR reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentRowsOf, personalShownWith, personalShown, agentsHtml } from '../js/agent-queue.js';

test('agents card: rows from Builds\' summary, cleaned', () => {
  const env = { schema: 'builds.summary', version: 1, items: [
    { id: 'needs', kind: 'list', rows: [{ id: 'x', title: 'not this card' }] },
    { id: 'agents', kind: 'list', rows: [
      { id: 'L2-b', title: '#L2 Plan', note: 'Approve the plan', route: 'L2' },
      { id: 'gap:G2', title: 'Refund cap?', note: 'Teach Tandem: a build waits on this', route: 'teach', flag: 'urgent' },
      { id: 7, title: 'bad id' }, { id: 'no-title' }
    ] }
  ] };
  assert.deepEqual(agentRowsOf(env), [
    { id: 'L2-b', title: '#L2 Plan', note: 'Approve the plan', route: 'L2', flag: '' },
    { id: 'gap:G2', title: 'Refund cap?', note: 'Teach Tandem: a build waits on this', route: 'teach', flag: 'urgent' }
  ]);
  assert.deepEqual(agentRowsOf(null), []);
  assert.deepEqual(agentRowsOf({ schema: 'other.summary', items: [] }), []);
});

test('personal tasks: off shows only PR reviews; Tasks\' own site shows everything', () => {
  assert.equal(personalShownWith(false, { title: 'mine' }), false);
  assert.equal(personalShownWith(false, { title: 'review', pr: { url: 'x' } }), true);
  assert.equal(personalShownWith(true, { title: 'mine' }), true);
  // Not linked to Workshop (no startAgentQueue): everything shows, no Agents section.
  assert.equal(personalShown({ title: 'mine' }), true);
  assert.equal(agentsHtml(), '');
});

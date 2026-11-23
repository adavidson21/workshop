// Settings, Data: Start over (js/reset-page.js). The pieces that decide what is asked and what is cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phraseFor, secondsLeft, viewKeys, resultLines } from '../js/reset-page.js';

const phrases = { everything: 'delete everything', one: 'delete 1 app', many: 'delete {n} apps', workOnly: 'delete work items' };

test('the phrase names what goes, from the agent\'s patterns', () => {
  assert.equal(phraseFor(phrases, { everything: true, count: 9, tandem: false }), 'delete everything');
  assert.equal(phraseFor(phrases, { everything: false, count: 1, tandem: true }), 'delete 1 app');
  assert.equal(phraseFor(phrases, { everything: false, count: 3, tandem: false }), 'delete 3 apps');
  assert.equal(phraseFor(phrases, { everything: false, count: 0, tandem: true }), 'delete work items');
  assert.equal(phraseFor(phrases, { everything: false, count: 0, tandem: false }), null, 'nothing picked: nothing to type');
  assert.equal(phraseFor(null, { everything: true }), null);
});

test('the button waits out the agent\'s wait', () => {
  assert.equal(secondsLeft(10000, 1000, 1000), 10);
  assert.equal(secondsLeft(10000, 1000, 8600), 3);
  assert.equal(secondsLeft(10000, 1000, 11000), 0);
  assert.equal(secondsLeft(10000, 1000, 99999), 0);
});

test('only the reset apps\' view settings are cleared, never the pairing', () => {
  const keys = ['builds.view', 'loom.x', 'slate.view', 'notes.side', 'roadmaps.mode', 'workshop.agent', 'workshop.home.introduced', 'prioritizer.v1.moved'];
  assert.deepEqual(viewKeys(keys, [{ id: 'builds', folder: 'builds' }, { id: 'tasks', folder: 'tasks' }]), ['builds.view', 'loom.x', 'slate.view', 'prioritizer.v1.moved'], 'old ids and folders too');
  assert.deepEqual(viewKeys(keys, [{ id: 'workshop' }]), ['workshop.home.introduced'], 'workshop.agent is never removed');
  assert.deepEqual(viewKeys(keys, []), []);
});

test('the result says what went, where the backup is, and what was kept', () => {
  const lines = resultLines({
    everything: false, apps: [{ id: 'tasks', name: 'Tasks' }, { id: 'notes', name: 'Notes' }],
    backup: { path: '/Users/a/Workshop backup 2026-11-19 1600.zip', files: 12 },
    tandem: { removed: 3, stopped: 1, kept: ['.worktrees/x/api: has changes'], failed: [] }, failed: ['/x/y: EBUSY']
  });
  assert.match(lines[0], /^Deleted Tasks, Notes\. Backup: \/Users\/a\/Workshop backup 2026-11-19 1600\.zip \(12 files\)\.$/);
  assert.match(lines[1], /removed 3 work items, after stopping 1 running agent/);
  assert.match(lines[2], /Kept worktree \.worktrees\/x\/api/);
  assert.match(lines[3], /Could not delete \/x\/y: EBUSY/);
  assert.deepEqual(resultLines({ error: 'Nothing was deleted: disk full' }), ['Start over stopped: Nothing was deleted: disk full']);
  assert.deepEqual(resultLines(null), []);
});

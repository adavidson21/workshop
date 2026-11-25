import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesFrom, placeName, sentText, sentToast } from '../sent.js';

test('namesFrom: a tab is named by its tab name only while its host is on the site', () => {
  const tasks = { id: 'tasks', name: 'Tasks' };
  const builds = { id: 'builds', name: 'Builds', tabOf: { app: 'tasks', name: 'Agents' } };
  assert.equal(namesFrom([tasks, builds]).builds, 'Agents');
  assert.equal(namesFrom([builds]).builds, 'Builds');
  assert.equal(namesFrom(null).builds, 'Agents');
  assert.equal(namesFrom([tasks, builds]).notes, 'Notes');
});

test('sentText: says the place, and a short version of what went', () => {
  assert.equal(sentText('builds', 'Fix the login timeout.'), 'Sent to Agents: Fix the login timeout.');
  assert.equal(sentText('notes'), 'Sent to Notes.');
  const long = sentText('tasks', 'x'.repeat(200));
  assert.ok(long.length < 90 && long.includes('…'));
  assert.equal(sentText('builds', 'a', 'Started in'), 'Started in Agents: a.');
  assert.ok(!/—/.test(long));
});

test('sentToast: a button that opens where it landed', () => {
  const calls = [];
  sentToast({ toast: (t, o) => calls.push([t, o]) }, { app: 'builds', path: 'L3', what: 'Fix it' });
  assert.deepEqual(calls[0], ['Sent to Agents: Fix it.', { kind: 'success', action: { label: 'Open Agents', open: { app: 'builds', path: 'L3' } } }]);
  assert.equal(placeName('people'), 'People');
});

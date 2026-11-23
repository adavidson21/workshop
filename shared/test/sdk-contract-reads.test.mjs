// docs/shared.md, B5: an app reads another app's data only through the contracts. The SDK refuses the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_READS, PAIR_READS, RETIRED_READS, canReadData } from '../workshop-sdk.js';

test('an app always reads its own collections', () => {
  for (const c of ['tasks', 'entries/person-one/2026', 'summary', 'handoffs']) assert.equal(canReadData('tasks', 'tasks', c), true, c);
});

test('any app\'s summary and handoffs are readable by every app', () => {
  for (const owner of ['tasks', 'roadmaps', 'people', 'notes', 'builds', 'agents', 'settings']) {
    assert.equal(canReadData('home', owner, 'summary'), true, owner);
    assert.equal(canReadData('home', owner, 'handoffs'), true, owner);
  }
});

test('Settings\' shared collections are readable; its other collections are not', () => {
  for (const c of CONTRACT_READS.settings) assert.equal(canReadData('roadmaps', 'settings', c), true, c);
  assert.equal(canReadData('roadmaps', 'settings', 'ui'), false);
  assert.equal(canReadData('roadmaps', 'settings', 'connections'), false);
});

test('another app\'s own collections are refused, nested names too', () => {
  assert.equal(canReadData('home', 'tasks', 'tasks'), false);
  assert.equal(canReadData('builds', 'roadmaps', 'roadmaps'), false);
  assert.equal(canReadData('tasks', 'people', 'entries/person-one/2026'), false);
  assert.equal(canReadData('notes', 'tasks', 'summary/extra'), false, 'only the summary collection itself');
});

test('the contract list is frozen', () => {
  assert.throws(() => { CONTRACT_READS.any.push('tasks'); });
  assert.throws(() => { CONTRACT_READS.extra = []; });
});

test('a retired app\'s data is readable only by the app that took it over', () => {
  assert.equal(RETIRED_READS.oneonones.by, 'people');
  assert.equal(canReadData('people', 'oneonones', 'people'), true);
  assert.equal(canReadData('people', 'oneonones', 'settings'), true);
  assert.equal(canReadData('people', 'oneonones', 'other'), false);
  assert.equal(canReadData('tasks', 'oneonones', 'people'), false);
});

test('a pair read: Settings reads Chat\'s writing feedback; no other app does', () => {
  assert.equal(canReadData('settings', 'chat', 'writing-feedback'), true);
  assert.equal(canReadData('roadmaps', 'chat', 'writing-feedback'), false);
  assert.equal(canReadData('settings', 'chat', 'sessions'), false);
  assert.equal(canReadData('chat', 'settings', 'writing'), true, 'Chat reads your voice from Settings');
  assert.throws(() => { PAIR_READS.chat.other = []; });
});

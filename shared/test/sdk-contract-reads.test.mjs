// docs/shared.md, B5: an app reads another app's data only through the contracts. The SDK refuses the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_READS, RETIRED_READS, canReadData } from '../workshop-sdk.js';

test('an app always reads its own collections', () => {
  for (const c of ['tasks', 'entries/person-one/2026', 'summary', 'handoffs']) assert.equal(canReadData('prioritizer', 'prioritizer', c), true, c);
});

test('any app\'s summary and handoffs are readable by every app', () => {
  for (const owner of ['prioritizer', 'runway', 'receipts', 'notes', 'slate', 'agents', 'settings']) {
    assert.equal(canReadData('home', owner, 'summary'), true, owner);
    assert.equal(canReadData('home', owner, 'handoffs'), true, owner);
  }
});

test('Settings\' shared collections are readable; its other collections are not', () => {
  for (const c of CONTRACT_READS.settings) assert.equal(canReadData('runway', 'settings', c), true, c);
  assert.equal(canReadData('runway', 'settings', 'ui'), false);
  assert.equal(canReadData('runway', 'settings', 'connections'), false);
});

test('another app\'s own collections are refused, nested names too', () => {
  assert.equal(canReadData('home', 'prioritizer', 'tasks'), false);
  assert.equal(canReadData('slate', 'runway', 'roadmaps'), false);
  assert.equal(canReadData('prioritizer', 'receipts', 'entries/person-one/2026'), false);
  assert.equal(canReadData('notes', 'prioritizer', 'summary/extra'), false, 'only the summary collection itself');
});

test('the contract list is frozen', () => {
  assert.throws(() => { CONTRACT_READS.any.push('tasks'); });
  assert.throws(() => { CONTRACT_READS.extra = []; });
});

test('a retired app\'s data is readable only by the app that took it over', () => {
  assert.equal(RETIRED_READS.oneonones.by, 'receipts');
  assert.equal(canReadData('receipts', 'oneonones', 'people'), true);
  assert.equal(canReadData('receipts', 'oneonones', 'settings'), true);
  assert.equal(canReadData('receipts', 'oneonones', 'other'), false);
  assert.equal(canReadData('prioritizer', 'oneonones', 'people'), false);
});

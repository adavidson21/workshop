// Settings, Data: where your data can go (js/storage-page.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinations, humanBytes } from '../js/storage-page.js';

test('with nothing on, nothing leaves the computer', () => {
  const rows = destinations({ backend: 'agent', conns: [{ id: 'ado', enabled: false }, { id: 'opencode', enabled: false }], st: { synced: null } });
  assert.deepEqual(rows.map(r => [r.id, r.on]), [['folder', false], ['ado', false], ['opencode', false]]);
  assert.match(rows[0].text, /Stays on this computer/);
});

test('each way out is named: a synced folder, connectors that are on, and the AI provider', () => {
  const rows = destinations({ backend: 'agent', conns: [{ id: 'ado', enabled: true }, { id: 'github', enabled: true }, { id: 'opencode', enabled: true }], st: { synced: 'OneDrive' }, providers: ['anthropic'] });
  assert.ok(rows.every(r => r.on));
  assert.match(rows[0].text, /Inside OneDrive, so OneDrive uploads it\. Workshop never does\./);
  assert.match(rows.find(r => r.id === 'ado').text, /Writes only when you click/);
  assert.match(rows.find(r => r.id === 'opencode').text, /goes to anthropic/);
});

test('without the agent there is only this browser or its folder', () => {
  const rows = destinations({ backend: 'browser', storage: 'indexeddb' });
  assert.deepEqual(rows.map(r => r.label), ['This browser']);
  assert.equal(rows[0].on, false);
});

test('sizes read as short text', () => {
  assert.equal(humanBytes(900), '900 B');
  assert.equal(humanBytes(5 * 1024 * 1024), '5.0 MB');
});

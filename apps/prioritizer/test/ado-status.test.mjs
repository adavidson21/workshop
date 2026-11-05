import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectorNote, prMatchKey, reachNote, shouldAutoConnect } from '../js/ado-status.js';

const ready = (extra = {}) => ({ id: 'ado', enabled: true, status: { state: 'ready', message: null, details: {}, ...extra } });

test('no connector, or turned off, is an error', () => {
  assert.match(connectorNote(undefined).error, /no ADO connector/);
  assert.match(connectorNote({ enabled: false, status: { state: 'disabled' } }).error, /turned off/);
});

test('a missing PAT gives the connector message as the error', () => {
  const c = { enabled: true, status: { state: 'error', message: 'ADO_PAT is not set. Run: workshop pat ADO_PAT', details: { patsMissing: ['ADO_PAT'] } } };
  assert.deepEqual(connectorNote(c), { error: 'ADO_PAT is not set. Run: workshop pat ADO_PAT', warn: '' });
});

test('a rejected PAT is an error even though the state is ready', () => {
  const c = ready({ message: 'ADO rejected the PAT in ADO_PAT.', details: { patsRejected: [{ patEnv: 'ADO_PAT' }] } });
  assert.equal(connectorNote(c).error, 'ADO rejected the PAT in ADO_PAT.');
});

test('an expiring PAT is a warning, not an error', () => {
  const c = ready({ message: 'The PAT in ADO_PAT expires in 5 days.', details: { patsExpiring: [{ patEnv: 'ADO_PAT', days: 5 }] } });
  assert.deepEqual(connectorNote(c), { error: '', warn: 'The PAT in ADO_PAT expires in 5 days.' });
  assert.deepEqual(connectorNote(ready()), { error: '', warn: '' });
});

test('auto connect only when ready, not on yet, and never turned off here', () => {
  assert.equal(shouldAutoConnect(ready(), { on: false }), true);
  assert.equal(shouldAutoConnect(ready(), { on: true }), false);
  assert.equal(shouldAutoConnect(ready(), { on: false, offByUser: true }), false);
  assert.equal(shouldAutoConnect({ enabled: true, status: { state: 'error', message: 'x' } }, { on: false }), false);
  assert.equal(shouldAutoConnect(ready({ details: { patsRejected: [{}] } }), { on: false }), false);
  assert.equal(shouldAutoConnect(undefined, { on: false }), false);
});

test('reachable: Workshop on this computer answers, so no message', () => {
  assert.equal(reachNote({ mode: 'hosted', backend: 'agent', online: true }), '');
  assert.equal(reachNote({ mode: 'local', backend: 'agent', online: true }, { embedded: true }), '');
});

test('not reachable: own site, not paired, says to install or start Workshop, pair, and turn on the connector', () => {
  for (const w of [null, { mode: 'browser', backend: 'browser', storage: 'indexeddb' }, { mode: 'browser', backend: 'browser', storage: 'folder' }]) {
    const m = reachNote(w);
    assert.match(m, /Install or start Workshop/);
    assert.match(m, /pair this site/);
    assert.match(m, /turn on the ADO connector in Workshop Settings/);
  }
});

test('not reachable: paired before, but Workshop does not answer', () => {
  const m = reachNote({ mode: 'browser', backend: 'browser', storage: 'indexeddb' }, { pairSaved: true });
  assert.match(m, /Can't reach Workshop on this computer/);
  assert.match(m, /workshop open/);
  assert.match(m, /reload/);
});

test('not reachable: inside Workshop with no agent', () => {
  const m = reachNote({ mode: 'browser', backend: 'browser', storage: 'folder' }, { embedded: true, pairSaved: true });
  assert.match(m, /Install or start Workshop/);
  assert.match(m, /turn on the ADO connector/);
});

test('not reachable: Workshop stopped answering after the page loaded', () => {
  assert.match(reachNote({ mode: 'hosted', backend: 'agent', online: false }), /stopped answering/);
});

test('not reachable: the phone app has no ADO sync', () => {
  assert.match(reachNote({ mode: 'browser', backend: 'browser', storage: 'device' }), /phone app/);
});

test('no message mentions the retired helper or uses an em dash', () => {
  const all = [reachNote(null), reachNote(null, { pairSaved: true }), reachNote(null, { embedded: true }),
    reachNote({ backend: 'agent', online: false }), reachNote({ backend: 'browser', storage: 'device' }), connectorNote(undefined).error,
    connectorNote({ enabled: false, status: { state: 'disabled' } }).error];
  for (const m of all) { assert.ok(m); assert.doesNotMatch(m, /helper|ado_helper|\u2014/); }
});

test('PR keys from the helper and the connector match despite how the collection URL is written', () => {
  const connector = 'https://tfs.example.test/tfs/Main Collection|Platform|701';
  assert.equal(prMatchKey('https://TFS.example.test/tfs/Main%20Collection/|Platform|701'), prMatchKey(connector));
  assert.equal(prMatchKey('https://tfs.example.test/tfs/Main Collection//|platform|701'), prMatchKey(connector));
  assert.notEqual(prMatchKey('https://tfs.example.test/tfs/Main Collection|Platform|702'), prMatchKey(connector));
  assert.notEqual(prMatchKey('https://tfs.example.test/tfs/Other|Platform|701'), prMatchKey(connector));
  assert.equal(prMatchKey('odd'), 'odd');
  assert.equal(prMatchKey('https://x.test/c%E0%A4%A|P|5'), 'https://x.test/c%e0%a4%a|p|5');   // bad %-encoding kept as written
});

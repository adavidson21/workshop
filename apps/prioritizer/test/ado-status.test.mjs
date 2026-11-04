import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectorNote, shouldAutoConnect } from '../js/ado-status.js';

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

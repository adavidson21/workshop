import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noAdo, adoIsOn, watchAdo } from '../ado.js';

test('noAdo keeps the text while ADO is on', () => {
  assert.equal(noAdo('Sync from Azure DevOps. Then sort.', true), 'Sync from Azure DevOps. Then sort.');
});

test('noAdo drops the sentences and lines that name ADO while it is off', () => {
  assert.equal(noAdo('Team roadmaps: drag the timeline. Optionally from Azure DevOps.', false), 'Team roadmaps: drag the timeline.');
  assert.equal(noAdo('Link an ADO item later! Or not.', false), 'Or not.');
  assert.equal(noAdo('one\nan ADO line\nthree', false), 'one\nthree');
  assert.equal(noAdo('Nothing to drop here.', false), 'Nothing to drop here.');
  assert.equal(noAdo(null, false), null);
});

test('watchAdo asks the connectors once and follows their status', async () => {
  let enabled = false, status = null;
  const ws = { connectors: { list: async () => [{ id: 'ado', enabled }], onStatus: (id, fn) => { status = fn; } } };
  const seen = [];
  assert.equal(await watchAdo(ws, v => seen.push(v)), false);
  assert.equal(adoIsOn(), false);
  enabled = true; status({ state: 'ready' }); await new Promise(r => setTimeout(r, 0));
  assert.equal(adoIsOn(), true);
  assert.deepEqual(seen, [false, true]);
});

test('browser mode (no connectors) is off', async () => {
  const ws = { connectors: { list: async () => { throw new Error('unavailable'); }, onStatus: () => {} } };
  assert.equal(await watchAdo(ws), false);
});

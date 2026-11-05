import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendersFrom, useSenders } from '../handoffs.js';

test('sendersFrom: manifests add to the built-in senders, never the receiver itself', () => {
  const apps = [
    { id: 'home', name: 'Home', handoffs: { sends: ['notes', 'prioritizer'] } },
    { id: 'newapp', name: 'New app', handoffs: { sends: ['notes'] } },
    { id: 'notes', name: 'Notes', handoffs: { sends: ['notes'] } },
    { id: 'other', name: 'Other', handoffs: { sends: [] } }
  ];
  assert.deepEqual(sendersFrom(apps, 'notes', { home: 'Home', agents: 'Dispatch' }), { home: 'Home', agents: 'Dispatch', newapp: 'New app' });
  assert.deepEqual(sendersFrom(null, 'notes', { home: 'Home' }), { home: 'Home' });
  assert.deepEqual(sendersFrom(apps, 'notes', { notes: 'Notes' }), { home: 'Home', newapp: 'New app' });
});

test('useSenders: updates the object in place', () => {
  const S = { home: 'Home' };
  const same = useSenders(S, [{ id: 'x', name: 'X', handoffs: { sends: ['r'] } }], 'r');
  assert.equal(same, S);
  assert.deepEqual(S, { home: 'Home', x: 'X' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appsFromRegistry } from '../workshop-sdk.js';

test('ws.apps.list(): manifests from the registry, sorted by order, with only the finding fields', () => {
  const reg = { apps: [
    { base: '/apps/notes/', manifest: { id: 'notes', name: 'Notes', version: '1.3.0', order: 40, capture: ['note'] } },
    { base: '/apps/home/', manifest: { id: 'home', name: 'Home', version: '1.5.0', order: 0, handoffs: { sends: ['prioritizer', 'notes'] }, icon: 'x.svg' } },
    { base: '/apps/prioritizer/', manifest: { id: 'prioritizer', name: 'Docket', version: '4.19.0', order: 10, capture: ['task', 'waiting'], aliases: ['docket', { name: 'today', path: 'today' }, 3] } },
    { base: '/apps/x/', manifest: { id: 'Bad' } },
    { base: '/apps/y/' }
  ] };
  const list = appsFromRegistry(reg);
  assert.deepEqual(list.map(a => a.id), ['home', 'prioritizer', 'notes']);
  assert.deepEqual(list[0], { id: 'home', name: 'Home', version: '1.5.0', order: 0, handoffs: { sends: ['prioritizer', 'notes'] }, capture: [], aliases: [], privateFiles: null });
  assert.deepEqual(list[1].aliases, ['docket', { name: 'today', path: 'today' }]);
  assert.deepEqual(appsFromRegistry(null), []);
  assert.deepEqual(appsFromRegistry({ apps: 'no' }), []);
});

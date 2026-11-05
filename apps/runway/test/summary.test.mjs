import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, roadmapsCard } from '../js/summary.js';
import { sendersFrom, SENDERS } from '../js/pending.js';
import { teamDefaults } from '../js/ado/index.js';
import { SchemaSet } from './workshop/schema.mjs';

test('summary: the roadmaps as capture targets for ideas, matching docs/summaries.md', () => {
  const card = roadmapsCard([{ id: 'm_a', title: 'Platform', changed: 5 }, { id: 'm_b', title: '' }]);
  assert.deepEqual(card, { id: 'roadmaps', kind: 'targets', title: 'Roadmaps', capture: 'idea', rows: [{ id: 'm_a', title: 'Platform' }, { id: 'm_b', title: 'Untitled roadmap' }] });
  const schemas = SchemaSet.fromDir(new URL('./workshop/schemas/', import.meta.url).pathname);
  assert.deepEqual(schemas.validate('summary-card', { ...card, updatedAt: 1 }), []);
  assert.equal(buildSummary({ loaded: false, list: [] }), null);
  assert.equal(buildSummary({ loaded: true, readOnly: 'newer', list: [] }), null);
  assert.equal(buildSummary({ loaded: true, list: [] })[0].rows.length, 0);
});

test('sendersFrom: senders of ideas come from manifests, with Home and Dispatch as the fallback', () => {
  const apps = [{ id: 'home', name: 'Home', handoffs: { sends: ['runway', 'notes'] } }, { id: 'notes', name: 'Notes', handoffs: { sends: [] } }, { id: 'runway', name: 'Runway', handoffs: { sends: ['runway'] } }];
  assert.deepEqual(sendersFrom(apps), { home: 'Home', agents: 'Dispatch' });
  assert.deepEqual(sendersFrom([{ id: 'other', name: 'Other', handoffs: { sends: ['runway'] } }]), { home: 'Home', agents: 'Dispatch', other: 'Other' });
  assert.deepEqual(sendersFrom([]), SENDERS);
});

test('teamDefaults: area paths from Workshop settings.teams v1', () => {
  const env = { schema: 'settings.teams', version: 1, rev: 1, items: [{ id: 't_mine', name: 'Mine', areas: ['Project\\Team', ' ', 3], connection: 'work' }] };
  assert.deepEqual(teamDefaults(env), { areas: ['Project\\Team'], connection: 'work' });
  assert.equal(teamDefaults({ ...env, version: 2 }), null);
  assert.equal(teamDefaults({ ...env, items: [{ id: 't_mine', name: 'Mine', areas: [] }] }), null);
  assert.equal(teamDefaults(null), null);
});

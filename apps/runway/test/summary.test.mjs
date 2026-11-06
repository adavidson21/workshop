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

test('summary: the Pending assignment list as a list card, once Pending has loaded', async () => {
  const { pendingCard } = await import('../js/summary.js');
  const p = { loaded: true, readOnly: false, items: [{ id: 'p_1', title: 'Bulk export', notes: 'CSV and Excel', date: '2026-11-06' }, { id: 'p_2', title: 'Dark mode', notes: '', date: '' }] };
  const card = pendingCard(p);
  assert.deepEqual(card, { id: 'pending', kind: 'list', title: 'Pending assignment', count: 2, route: 'pending', rows: [
    { id: 'p_1', title: 'Bulk export', route: 'pending', due: '2026-11-06', note: 'CSV and Excel' },
    { id: 'p_2', title: 'Dark mode', route: 'pending' }] });
  const schemas = SchemaSet.fromDir(new URL('./workshop/schemas/', import.meta.url).pathname);
  assert.deepEqual(schemas.validate('summary-card', { ...card, updatedAt: 1 }), []);
  assert.equal(pendingCard({ loaded: true, items: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, title: 't' })) }).rows.length, 50);
  const v = { loaded: true, list: [] };
  assert.deepEqual(buildSummary(v, p).map(c => c.id), ['roadmaps', 'pending']);
  assert.deepEqual(buildSummary(v, { loaded: false, items: [] }).map(c => c.id), ['roadmaps'], 'not loaded yet: no card, so readers do not see an empty list by mistake');
  assert.deepEqual(buildSummary(v, { loaded: true, readOnly: true, items: [] }).map(c => c.id), ['roadmaps']);
});

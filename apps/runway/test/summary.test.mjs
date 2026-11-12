import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, roadmapsCard } from '../js/summary.js';
import { sendersFrom, SENDERS } from '../js/pending.js';
import { teamDefaults } from '../js/ado/index.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';

test('summary: the roadmaps as capture targets for ideas, matching docs/summaries.md', () => {
  const card = roadmapsCard([{ id: 'm_a', title: 'Platform', changed: 5 }, { id: 'm_b', title: '' }]);
  assert.deepEqual(card, { id: 'roadmaps', kind: 'targets', title: 'Roadmaps', capture: 'idea', rows: [{ id: 'm_a', title: 'Platform' }, { id: 'm_b', title: 'Untitled roadmap' }] });
  const schemas = SchemaSet.fromDir(new URL('../../../docs/schemas/', import.meta.url).pathname);
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
  const schemas = SchemaSet.fromDir(new URL('../../../docs/schemas/', import.meta.url).pathname);
  assert.deepEqual(schemas.validate('summary-card', { ...card, updatedAt: 1 }), []);
  assert.equal(pendingCard({ loaded: true, items: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, title: 't' })) }).rows.length, 50);
  const v = { loaded: true, list: [] };
  assert.deepEqual(buildSummary(v, p).map(c => c.id), ['roadmaps', 'pending']);
  assert.deepEqual(buildSummary(v, { loaded: false, items: [] }).map(c => c.id), ['roadmaps'], 'not loaded yet: no card, so readers do not see an empty list by mistake');
  assert.deepEqual(buildSummary(v, { loaded: true, readOnly: true, items: [] }).map(c => c.id), ['roadmaps']);
});

test('upcoming: milestones and goals in the next 14 days across roadmaps, from each roadmap\'s soon', async () => {
  const { upcomingCard } = await import('../js/summary.js');
  const { soonOf, blankDoc } = await import('../js/model.js');
  const list = [
    { id: 'm1', title: 'Platform', soon: [{ date: '2026-11-20', title: 'Search live', kind: 'milestone' }, { date: '2026-12-30', title: 'Far', kind: 'goal' }] },
    { id: 'm2', title: 'Infra', soon: [{ date: '2026-11-12', title: 'Runbooks done', kind: 'goal' }, { date: '2026-11-01', title: 'Past', kind: 'milestone' }] },
    { id: 'm3', title: 'None' }];
  const c = upcomingCard(list, '2026-11-10');
  assert.equal(c.kind, 'list');
  assert.deepEqual(c.rows.map(r => [r.title, r.due, r.note, r.route]), [['Runbooks done', '2026-11-12', 'Goal, Infra', 'm2'], ['Search live', '2026-11-20', 'Milestone, Platform', 'm1']]);
  assert.deepEqual(buildSummary({ loaded: true, list }, null, '2026-11-10').map(x => x.id), ['roadmaps', 'upcoming']);
  const doc = blankDoc('T', new Date(2026, 10, 1));
  doc.items.push({ id: 'i1', kind: 'item', lane: null, order: 0, parent: null, title: 'Launch', start: '2026-11-25', end: '2026-11-25', size: null, milestone: true, status: '', color: '', notes: '' });
  doc.meta.goals = [{ date: '2026-12-01', text: 'Ship it' }, { date: '2026-09-01', text: 'Old' }];
  assert.deepEqual(soonOf(doc, '2026-11-10'), [{ date: '2026-11-25', title: 'Launch', kind: 'milestone' }, { date: '2026-12-01', title: 'Ship it', kind: 'goal' }]);
});

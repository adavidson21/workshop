// Slate's pure model: stages and columns, the .work file parsers (eng-agents templates), and the publish plan.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cards, changedInAdo, cleanItem, devColumn, draftState, filterCards, newItem, parseMilestones, parseRefine, parseTriage,
  pmColumn, publishPlan, roadmapIdea, setStage, statusOf, waitingTask
} from '../js/model.js';

const NOW = new Date('2026-11-05T15:00:00Z');

const TRIAGE = `# Triage: 41207 Export orders to CSV

Date: 2026-11-05
Route: delegate
Size: M

<!-- Written by /triage. -->

## Summary

Finance wants the orders page to export a CSV.

## Products and repos

- Orders (\`web-app\`): \`web-app/src/orders/OrdersPage.tsx\`

## Questions for the requester

- Which columns?
- Should it include cancelled orders?

## Suggested route

Delegate to the orders area.
`;

const REFINE = `# Refine: Export orders to CSV

Status: DRAFT
Type: User Story
Parent: #700

## Description

As a finance lead, I want a CSV of orders, so that I can reconcile.

## Acceptance criteria

\`\`\`gherkin
Scenario: Export
  Given orders exist
  When I click Export
  Then a CSV downloads
\`\`\`

## Notes for the builder

- \`web-app/src/orders/OrdersPage.tsx\`

## Open questions

- Time zone of dates? (accepted risk)
`;

const MILESTONES = `# Milestones: change request

Status: APPROVED

<!-- comment -->

Epic: Orders v2.1

The second orders release.

## Feature 1: Export

- Goal: export

### Story 1.1: CSV export

As a buyer, I want a CSV.

#### Acceptance criteria

\`\`\`gherkin
Scenario: one
  Given x
\`\`\`

#### Work item

- Repos: \`web-app\`

### Story 1.2: PDF export

As a buyer, I want a PDF.

#### Acceptance criteria

Scenario: two

## Feature 2: Import

### Story 2.1: CSV import

As a buyer, I want to import.

## Coverage

| a | b |
`;

test('new items start New; ADO items take their level from the type; stages keep a history', () => {
  const a = newItem({ title: '  Export   orders ' }, NOW);
  assert.equal(a.title, 'Export orders');
  assert.equal(a.stage, 'new');
  assert.equal(a.level, 'story');
  assert.deepEqual(a.history, [{ stage: 'new', at: '2026-11-05' }]);
  const b = newItem({ title: 'X', ado: { id: 41207, rev: 3, type: 'Feature', url: 'u', area: 'A\\B', state: 'New' } }, NOW);
  assert.equal(b.level, 'feature');
  assert.equal(b.ado.id, 41207);
  setStage(b, 'triaged', NOW);
  setStage(b, 'triaged', NOW);
  assert.equal(b.history.length, 2);
  assert.throws(() => setStage(b, 'nope'));
  const c = cleanItem({ id: 'w_1', title: '', stage: 'weird', level: 'saga', ado: { id: 'x' }, extra: 1 });
  assert.deepEqual([c.title, c.stage, c.level, c.ado, c.extra], ['Untitled', 'new', 'story', null, 1]);
});

test('the board lists stored items, then untouched ADO items, and notices changes made in ADO', () => {
  const stored = newItem({ title: 'Stored', ado: { id: 1, rev: 2, type: 'User Story' } }, NOW);
  const list = cards([stored], [{ id: 1, rev: 5, type: 'User Story', title: 'Stored' }, { id: 2, rev: 1, type: 'Bug', title: 'Login fails', changed: '2026-11-01T00:00:00Z' }]);
  assert.equal(list.length, 2);
  assert.equal(list[1].virtual, true);
  assert.equal(list[1].id, 'ado_2');
  assert.equal(list[1].level, 'bug');
  assert.equal(changedInAdo(list[0]), true);
  assert.deepEqual(filterCards(list, { q: 'login' }).map(c => c.id), ['ado_2']);
  assert.deepEqual(filterCards(list, { q: '#1' }).map(c => c.title), ['Stored']);
  assert.deepEqual(filterCards(list, { level: 'bug' }).map(c => c.id), ['ado_2']);
});

test('PM and Dev columns', () => {
  const it = newItem({ title: 'x' }, NOW);
  assert.equal(pmColumn(it), 'new');
  it.sessions.triage = 'ses_1';
  assert.equal(pmColumn(it, {}, { busy: true }), 'triage');
  for (const [stage, col] of [['triaged', 'triage'], ['waiting', 'waiting'], ['defining', 'define'], ['ready', 'publish'], ['decide', 'decide'], ['delegated', 'delegated']]) {
    it.stage = stage;
    assert.equal(pmColumn(it), col, stage);
  }
  it.stage = 'defining';
  assert.equal(pmColumn(it, { ready: true }), 'publish');
  assert.equal(devColumn(null), 'ready');
  assert.equal(devColumn({ next: { stage: 'spec' } }), 'spec');
  assert.equal(devColumn({ next: { stage: 'plan' } }), 'spec');
  assert.equal(devColumn({ next: { stage: 'build' } }), 'build');
  assert.equal(devColumn({ next: { stage: 'review' } }), 'ship');
  assert.equal(devColumn({ next: { stage: 'ship' } }), 'ship');
  assert.equal(devColumn({ bucket: 'done' }), 'done');
});

test('triage.md: route, size, summary and the questions for the requester', () => {
  const t = parseTriage(TRIAGE);
  assert.equal(t.route, 'delegate');
  assert.equal(t.size, 'M');
  assert.equal(t.summary, 'Finance wants the orders page to export a CSV.');
  assert.deepEqual(t.questions, ['Which columns?', 'Should it include cancelled orders?']);
  assert.equal(t.repos.length, 1);
  assert.deepEqual(parseTriage(TRIAGE.replace(/- Which columns\?\n- Should it include cancelled orders\?/, '- None.')).questions, []);
  assert.equal(parseTriage(''), null);
});

test('refine.md: status, type, parent, description and acceptance criteria without fences', () => {
  const r = parseRefine(REFINE);
  assert.equal(r.status, 'DRAFT');
  assert.equal(r.type, 'User Story');
  assert.equal(r.parent, 700);
  assert.match(r.description, /^As a finance lead/);
  assert.equal(r.acceptance, 'Scenario: Export\n  Given orders exist\n  When I click Export\n  Then a CSV downloads');
  assert.deepEqual(r.open, [], 'accepted risks are not open');
  assert.equal(statusOf(REFINE.replace('DRAFT', 'APPROVED')), 'APPROVED');
});

test('milestones.md is read the way Export-Backlog.ps1 reads it', () => {
  const m = parseMilestones(MILESTONES);
  assert.deepEqual(m.errors, []);
  assert.equal(m.status, 'APPROVED');
  assert.equal(m.epic.title, 'Orders v2.1');
  assert.equal(m.epic.description, 'The second orders release.');
  assert.deepEqual(m.features.map(f => [f.num, f.title, f.stories.map(s => s.ref)]), [[1, 'Export', ['1.1', '1.2']], [2, 'Import', ['2.1']]]);
  assert.equal(m.features[0].stories[0].acceptance, 'Scenario: one\n  Given x');
  assert.equal(m.features[0].stories[0].work, '- Repos: `web-app`');
  const existing = parseMilestones(MILESTONES.replace('Epic: Orders v2.1', 'Epic: #900 Orders v2.1'));
  assert.equal(existing.epic.id, 900);
  assert.deepEqual(parseMilestones('Status: DRAFT\n\n## Feature 1: A\n').errors, ['No "Epic:" line.', 'Feature 1 has no stories.']);
});

test('draft state follows the gate files', () => {
  const r = newItem({ title: 'x' }, NOW);
  assert.equal(draftState(r).kind, null);
  r.work.define = 'refine-export-orders';
  assert.equal(draftState(r, {}).step, 'drafting');
  assert.equal(draftState(r, { 'refine.md': REFINE }).step, 'approve');
  assert.equal(draftState(r, { 'refine.md': REFINE.replace('DRAFT', 'APPROVED') }).ready, true);
  const s = newItem({ title: 'y' }, NOW);
  s.work.define = 'scope-change-request';
  assert.equal(draftState(s, { 'stories.md': 'Status: DRAFT' }).step, 'approve-stories');
  assert.equal(draftState(s, { 'stories.md': 'Status: APPROVED' }).step, 'slice');
  assert.equal(draftState(s, { 'stories.md': 'Status: APPROVED', 'milestones.md': 'Status: DRAFT' }).step, 'approve-milestones');
  assert.equal(draftState(s, { 'stories.md': 'Status: APPROVED', 'milestones.md': MILESTONES }).ready, true);
});

test('publish plan: one create or update for a refined story; parents first for a scope; resumes', () => {
  const r = newItem({ title: 'Export orders to CSV' }, NOW);
  r.work.define = 'refine-export-orders';
  const files = { 'refine.md': REFINE.replace('DRAFT', 'APPROVED') };
  const [one] = publishPlan(r, files, { area: 'Web\\Team' });
  assert.deepEqual([one.op, one.type, one.parentId, one.fields.area, one.fields.tags], ['create', 'User Story', 700, 'Web\\Team', ['slate']]);
  assert.match(one.fields.acceptance, /^Scenario: Export/);
  r.ado = { id: 41207, rev: 4, type: 'User Story' };
  const [upd] = publishPlan(r, files);
  assert.deepEqual([upd.op, upd.id, upd.rev], ['update', 41207, 4]);

  const s = newItem({ title: 'Change request' }, NOW);
  s.work.define = 'scope-change-request';
  const sf = { 'stories.md': 'Status: APPROVED', 'milestones.md': MILESTONES };
  const plan = publishPlan(s, sf);
  assert.deepEqual(plan.map(p => [p.ref, p.op, p.type, p.parentRef || p.parentId || null]), [
    ['epic', 'create', 'Epic', null], ['feature 1', 'create', 'Feature', 'epic'], ['story 1.1', 'create', 'User Story', 'feature 1'],
    ['story 1.2', 'create', 'User Story', 'feature 1'], ['feature 2', 'create', 'Feature', 'epic'], ['story 2.1', 'create', 'User Story', 'feature 2']
  ]);
  s.published = { epic: 10, 'feature 1': 11 };
  assert.deepEqual(publishPlan(s, sf).slice(0, 2).map(p => [p.op, p.id]), [['skip', 10], ['skip', 11]]);
  const ex = publishPlan(newItem({ title: 'z' }, NOW), {});
  assert.deepEqual(ex, []);
  const withEpic = publishPlan(s, { ...sf, 'milestones.md': MILESTONES.replace('Epic: Orders v2.1', 'Epic: #900 Orders v2.1') });
  assert.equal(withEpic[0].ref, 'feature 1');
  assert.equal(withEpic[0].parentId, 900);
});

test('handoff offers for Docket and Runway follow docs/handoffs.md', () => {
  const it = newItem({ title: 'Export orders', description: 'For finance', ado: { id: 5, type: 'User Story', url: 'https://ado/5' } }, NOW);
  const t = waitingTask(it, 'p_dev1', NOW);
  assert.deepEqual([t.to, t.accepted, t.payload.kind, t.payload.waiting, t.payload.who, t.payload.title], ['prioritizer', true, 'task', true, ['p_dev1'], '#5 Export orders']);
  const idea = roadmapIdea(it, NOW);
  assert.deepEqual([idea.to, idea.payload.kind, idea.text], ['runway', 'idea', 'Export orders\nFor finance']);
});

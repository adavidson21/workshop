// Slate's pure model: stages and columns, the .work file parsers (eng-agents templates), and the publish plan.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backTargets, forwardTargets, cards, changedInAdo, cleanItem, devColumn, moveBack, draftState, filterCards, newItem, parseMilestones, parseRefine, parseTriage,
  areaOptions, areaOf, inArea, underArea, NO_AREA, pmColumn, publishPlan, roadmapIdea, setStage, statusOf, waitingTask, cleanPrefs, cardFacts, detailRows, customRefs, fieldLabel, DEFAULT_PREFS,
  applyRequest, needsAdoTitle, needsAdoConnection, adoFromFind, mergeBacklogs, sameAdo, virtualAdoId, questionsText, repliesSince, sourceComment, suggestsScope, timeline
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

Buyers can take their orders out of the app.

#### Release note

You can now export your orders.

### Story 1.1: CSV export

As a buyer, I want a CSV.

#### Acceptance criteria

\`\`\`gherkin
Scenario: one
  Given x
\`\`\`

#### Notes for the builder

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
  assert.equal(devColumn(null), 'building');
  assert.equal(devColumn({ next: { stage: 'spec' } }), 'building');
  assert.equal(devColumn({ next: { stage: 'plan' } }), 'building');
  assert.equal(devColumn({ next: { stage: 'build' } }), 'building');
  assert.equal(devColumn({ next: { stage: 'review' } }), 'review');
  assert.equal(devColumn({ next: { stage: 'ship' } }), 'review');
  assert.equal(devColumn({ bucket: 'done' }), 'review');
  assert.equal(devColumn({ next: { stage: 'build' } }, { stage: 'dev', merged: '2026-11-05' }), 'merged');
  assert.equal(devColumn(null, { stage: 'resolved', merged: '2026-11-05' }), 'resolved');
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
  assert.equal(m.features[0].description, 'Buyers can take their orders out of the app.');
  assert.equal(m.features[0].releaseNote, 'You can now export your orders.');
  assert.equal(m.features[1].releaseNote, '');
  assert.equal(parseMilestones(MILESTONES.replace('#### Notes for the builder', '#### Work item')).features[0].stories[0].work, '- Repos: `web-app`', 'older files still read');
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
  assert.equal(plan[1].fields.custom, undefined, 'no release notes field set: nothing extra is sent');
  assert.doesNotMatch(plan[2].fields.description, /web-app|Notes for the builder/, 'builder notes stay local');
  const withNotes = publishPlan(s, sf, { releaseNotesField: 'Custom.ReleaseNotes' });
  assert.deepEqual(withNotes[1].fields.custom, { 'Custom.ReleaseNotes': 'You can now export your orders.' });
  assert.equal(withNotes[4].fields.custom, undefined, 'a feature with no release note sends none');
  assert.equal(withNotes[2].fields.custom, undefined, 'stories carry no release note');
  const placeholder = publishPlan(s, { ...sf, 'milestones.md': MILESTONES.replace('You can now export your orders.', '<What customers can do now.>') }, { releaseNotesField: 'Custom.ReleaseNotes' });
  assert.equal(placeholder[1].fields.custom, undefined, 'a template placeholder is not sent');
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

test('aging: days in the current stage, and stale past the column limit', async () => {
  const { daysInStage, isStale, stageSince } = await import('../js/model.js');
  const it = newItem({ title: 'x', requester: '  Finance   lead ' }, new Date('2026-11-01T12:00:00'));
  assert.equal(it.requester, 'Finance lead');
  setStage(it, 'waiting', new Date('2026-11-02T12:00:00'));
  assert.equal(stageSince(it), '2026-11-02');
  assert.equal(daysInStage(it, new Date('2026-11-09T12:00:00')), 7);
  assert.equal(isStale(it, 'waiting', new Date('2026-11-06T12:00:00')), false);
  assert.equal(isStale(it, 'waiting', new Date('2026-11-09T12:00:00')), true);
});

test('owners: whole owned terms found in what the item touches, best match first', async () => {
  const { ownersFor, aboutText } = await import('../js/model.js');
  const owners = [{ id: 'p_a', name: 'Ana', owns: ['Lighthouse', 'web-app'] }, { id: 'p_b', name: 'Bo', owns: ['catalog-api', 'Web\\Team A'] }, { id: 'p_c', name: 'Cy', owns: ['app'] }];
  const it = newItem({ title: 'Lighthouse export', ado: { id: 1, type: 'User Story', area: 'Web\\Team A' } }, NOW);
  const text = aboutText(it, { repos: ['Orders (`web-app`): `web-app/src/x.ts`'] });
  const found = ownersFor(owners, text);
  assert.deepEqual(found.map(o => [o.id, o.hits.length]), [['p_a', 2], ['p_b', 1]]);
  assert.deepEqual(ownersFor(owners, 'nothing here'), []);
});

test('health: counts, stale and median days per lane; request to decision', async () => {
  const { health } = await import('../js/model.js');
  const a = newItem({ title: 'a' }, new Date('2026-11-01T12:00:00'));
  const b = newItem({ title: 'b' }, new Date('2026-11-03T12:00:00'));
  const c = newItem({ title: 'c' }, new Date('2026-11-01T12:00:00')); setStage(c, 'decide', new Date('2026-11-04T12:00:00'));
  const d = newItem({ title: 'd' }, new Date('2026-11-01T12:00:00')); setStage(d, 'delegated', new Date('2026-11-02T12:00:00')); d.assignee = 'p_1';
  const h = health([a, b, c, d], it => (it.stage === 'decide' ? 'decide' : it.stage === 'delegated' ? 'delegated' : 'new'), new Date('2026-11-06T12:00:00'));
  assert.deepEqual(h.cols.shape, { count: 2, stale: 1, medianDays: 3 }, 'counted by board lane, stale by step');
  assert.equal(h.cols.decide.count, 2, 'delegated waits in Decide');
  assert.equal(h.oldest[0].column, 'Shape: new');
  assert.deepEqual(h.load, { p_1: 1 });
  assert.deepEqual(h.toDecision, { n: 2, median: 1 });
  assert.equal(h.oldest[0].it.title, 'a');
});

test('summary cards: needs, delegated people, decisions this week, ADO ids', async () => {
  const { summaryCards } = await import('../js/model.js');
  const now = new Date('2026-11-06T12:00:00');
  const dec = newItem({ title: 'Decide me', ado: { id: 7, type: 'User Story' } }, now); setStage(dec, 'decide', now);
  const del = newItem({ title: 'With Ana', ado: { id: 8, type: 'Bug' }, requester: 'Finance' }, now); setStage(del, 'delegated', now); del.assignee = 'p_ana';
  const ask = newItem({ title: 'Asking' }, now); ask.sessions.current = 's1';
  const cols = { [dec.id]: 'decide', [del.id]: 'delegated', [ask.id]: 'new' };
  const cards = summaryCards([dec, del, ask], { columnOf: it => cols[it.id], agentOf: it => (it.id === ask.id ? { waiting: true } : null), now });
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  assert.deepEqual(by.needs.rows.map(r => [r.title, r.note, r.flag || '']), [['#7 Decide me', 'Decide who builds it', ''], ['Asking', 'An agent is asking you something', 'urgent']]);
  assert.deepEqual(by.delegated.rows, [{ id: 'p_ana', open: [{ id: del.id, title: '#8 With Ana', due: '', nudgeOn: '', via: '' }], waiting: [] }]);
  assert.deepEqual(by['done-week'].rows.map(r => r.note), ['Defined and published', 'Delegated']);
  assert.deepEqual(by.ado.rows.map(r => [r.id, r.note || '']), [['7', ''], ['8', 'Asked by Finance']]);
  for (const c of cards) assert.ok(c.rows.length <= 200 && c.kind && c.updatedAt);
});

test('decision notes for Notes and win offers for Rapport follow docs/handoffs.md', async () => {
  const { decisionNote, winOffer } = await import('../js/model.js');
  const it = newItem({ title: 'Export orders', ado: { id: 5, type: 'User Story' }, requester: 'Finance' }, NOW);
  const n = decisionNote(it, 'Delegated to Ana', NOW);
  assert.deepEqual([n.to, n.accepted, n.payload.kind, n.payload.title], ['notes', true, 'note', 'Decision: Export orders']);
  assert.match(n.text, /^Decision: Delegated to Ana\n\n- Item: Export orders \(ADO #5\)\n- Asked by: Finance/);
  const w = winOffer(it, 'p_ana', NOW);
  assert.deepEqual([w.to, w.accepted, w.payload.kind, w.payload.about], ['receipts', undefined, 'win', 'p_ana']);
});

test('sprints: items by iteration and load per assignee', async () => {
  const { bySprint, sprintLoad } = await import('../js/model.js');
  const a = newItem({ title: 'a', ado: { id: 1, type: 'User Story' } }, NOW); a.adoNow = { iteration: 'P\\S1', assignee: { name: 'Ana' } };
  const b = newItem({ title: 'b', ado: { id: 2, type: 'User Story' } }, NOW); b.adoNow = { iteration: 'P\\S1', assignee: null };
  const c = newItem({ title: 'c' }, NOW);
  const g = bySprint([a, b, c]);
  assert.deepEqual(Object.keys(g), ['P\\S1']);
  assert.deepEqual(sprintLoad(g['P\\S1']), [{ name: 'Ana', count: 1 }, { name: 'Unassigned', count: 1 }]);
});

test('field settings: defaults, unknown keys dropped, reference names checked', () => {
  assert.deepEqual(cleanPrefs({}), cleanPrefs(DEFAULT_PREFS));
  const p = cleanPrefs({ card: ['tags', 'nope'], detail: { bug: ['repro', 'x'] }, custom: { story: 'Custom.Risk, bad name!, Custom.Risk' }, releaseNotesField: '', pointsFields: '' });
  assert.deepEqual(p.card, ['tags']);
  assert.deepEqual(p.detail.bug, ['repro']);
  assert.deepEqual(p.detail.story, ['description', 'acceptance', 'priority', 'points', 'links', 'comments'], 'a level not given keeps its defaults');
  assert.deepEqual(p.custom.story, ['Custom.Risk']);
  assert.equal(p.releaseNotesField, '');
  assert.deepEqual(p.pointsFields, DEFAULT_PREFS.pointsFields, 'never empty');
  assert.deepEqual(customRefs(cleanPrefs({ custom: { bug: ['Custom.Found'] } })), ['Custom.ReleaseNotes', 'Custom.Found']);
  assert.equal(fieldLabel('Custom.ReleaseNotes'), 'Release Notes');
});

test('cards show assignee, priority and tags by default; points, iteration and area when picked in Fields', () => {
  const b = { assignee: { name: 'Dev One' }, priority: 2, storyPoints: 3, commentCount: 4, iteration: 'Web App\\Sprint 12', area: 'Web App\\Team A', tags: ['api'] };
  const dflt = cardFacts(b, cleanPrefs({}));
  assert.deepEqual(dflt.facts.map(f => f.text), ['Dev One', 'P2']);
  assert.deepEqual(dflt.tags, ['api']);
  const all = cardFacts(b, cleanPrefs({ card: ['assignee', 'iteration', 'area', 'tags', 'priority', 'points'] }));
  assert.deepEqual(all.facts.map(f => f.text), ['Dev One', 'P2', '3 pts', 'Sprint 12', 'Team A'], 'a saved Fields choice is kept');
  assert.equal(all.facts.find(f => f.key === 'iteration').title, 'Web App\\Sprint 12');
  assert.deepEqual(all.tags, ['api']);
  const some = cardFacts({ ...b, assignee: null }, cleanPrefs({ card: ['assignee', 'comments'] }));
  assert.deepEqual(some.facts.map(f => f.text), ['Unassigned', '4 comments']);
  assert.deepEqual(some.tags, []);
  assert.deepEqual(cards([], [{ id: 9, title: 'x', type: 'Bug', rev: 1 }])[0].adoNow.id, 9);
});

test('the panel shows each level\'s fields, empty ones included', () => {
  const w = { description: 'D', acceptanceCriteria: '', reproSteps: 'R', systemInfo: 'Edge', priority: 1, storyPoints: 5, severity: '', commentCount: 2,
    links: { items: [{ id: 2 }], hyperlinks: [], attachments: [], pullRequests: 0 }, custom: { 'Custom.ReleaseNotes': 'Notes', 'Custom.Risk': 'High' } };
  const prefs = cleanPrefs({ custom: { story: ['Custom.Risk'] } });
  const story = detailRows(w, 'story', prefs);
  assert.deepEqual(story.map(r => [r.key, r.value === '' ? '' : typeof r.value === 'object' ? 'obj' : r.value]),
    [['description', 'D'], ['acceptance', ''], ['priority', '1'], ['points', '5'], ['links', 'obj'], ['comments', 2], ['custom:Custom.Risk', 'High']]);
  assert.deepEqual(detailRows(w, 'bug', prefs).map(r => r.key), ['repro', 'systemInfo', 'priority', 'severity', 'points', 'links', 'comments']);
  const feat = detailRows(w, 'feature', prefs);
  assert.equal(feat.find(r => r.key === 'releaseNotes').value, 'Notes');
  assert.equal(detailRows(w, 'feature', cleanPrefs({ releaseNotesField: '' })).some(r => r.key === 'releaseNotes'), false);
});

test('backTargets: earlier stages from history, New always, never the other end of the decision', () => {
  const at = '2026-11-01';
  const it = cleanItem({ stage: 'decide', history: ['new', 'triaged', 'defining', 'decide'].map(stage => ({ stage, at })) });
  assert.deepEqual(backTargets(it), ['new', 'triaged', 'defining']);
  const dev = cleanItem({ stage: 'dev', history: ['new', 'decide', 'delegated', 'dev'].map(stage => ({ stage, at })) });
  assert.deepEqual(backTargets(dev), ['new', 'decide']);
  const del = cleanItem({ stage: 'delegated', history: [{ stage: 'decide', at }] });
  assert.deepEqual(backTargets(del), ['new', 'decide']);
  assert.deepEqual(backTargets(cleanItem({ stage: 'new' })), []);
  const approved = cleanItem({ stage: 'defining', history: [{ stage: 'new', at }, { stage: 'defining', at }] });
  assert.deepEqual(backTargets(approved, 'define'), ['new']);
  assert.deepEqual(backTargets(approved, 'publish'), ['new', 'defining']);
});

test('moveBack: Define holds an approved draft until you act; a forward move clears it', () => {
  const it = cleanItem({ stage: 'decide', work: { define: 'refine-x' }, history: [{ stage: 'defining', at: '2026-11-01' }] });
  moveBack(it, 'defining', new Date(2026, 10, 6));
  assert.equal(it.stage, 'defining');
  assert.equal(it.reopened, 'defining');
  assert.equal(it.history.at(-1).stage, 'defining');
  assert.equal(pmColumn(it, { ready: true }), 'define');
  assert.equal(cleanItem(it).reopened, 'defining');
  setStage(it, 'decide');
  assert.equal(it.reopened, undefined);
  const pub = cleanItem({ stage: 'defining', history: [{ stage: 'defining', at: '2026-11-01' }] });
  moveBack(pub, 'defining', new Date(2026, 10, 6));
  assert.equal(pub.history.length, 2);
  assert.equal(cleanItem({ stage: 'new', reopened: 'defining' }).reopened, undefined);
});

test('area paths: under, filter and the view tree', () => {
  assert.equal(underArea('Proj\\Platform\\Wiki', 'proj\\platform'), true);
  assert.equal(underArea('Proj\\Platform', 'Proj\\Platform'), true);
  assert.equal(underArea('Proj\\PlatformX', 'Proj\\Platform'), false);
  assert.equal(underArea('Proj', ''), false);
  const backlog = [
    { id: 1, rev: 1, type: 'User Story', title: 'A', area: 'Proj\\Platform\\Wiki\\Edge' },
    { id: 2, rev: 1, type: 'Bug', title: 'B', area: 'Proj\\Platform\\Search' },
    { id: 3, rev: 1, type: 'Bug', title: 'C', area: 'Proj\\Platform' },
    { id: 4, rev: 1, type: 'Bug', title: 'D', area: 'Other\\Team' }
  ];
  const local = newItem({ title: 'Request' }, NOW);
  const list = cards([local], backlog);
  assert.equal(areaOf(list[0]), '');
  assert.deepEqual(filterCards(list, { area: 'Proj\\Platform\\Wiki' }).map(c => c.id), ['ado_1']);
  assert.deepEqual(filterCards(list, { area: 'Proj\\Platform' }).map(c => c.id), ['ado_1', 'ado_2', 'ado_3']);
  assert.deepEqual(filterCards(list, { area: NO_AREA }).map(c => c.id), [local.id]);
  assert.equal(filterCards(list, {}).length, 5);
  assert.equal(inArea(list[1], ''), true);

  const opts = areaOptions(list, ['Proj\\Platform']);
  assert.deepEqual(opts.map(o => [o.path, o.label, o.depth, o.count]), [
    ['Other\\Team', 'Other\\Team', 0, 1],
    ['Proj\\Platform', 'Proj\\Platform', 0, 3],
    ['Proj\\Platform\\Search', 'Search', 1, 1],
    ['Proj\\Platform\\Wiki', 'Wiki', 1, 1],
    ['Proj\\Platform\\Wiki\\Edge', 'Edge', 2, 1],
    [NO_AREA, 'No area path', 0, 1]
  ]);
  // A saved view with nothing in it stays listed.
  assert.ok(areaOptions([], ['Proj'], 'Proj\\Gone').some(o => o.path === 'Proj\\Gone' && o.count === 0));
  // A stored item uses the area ADO has now.
  const moved = cards([newItem({ title: 'x', ado: { id: 9, rev: 1, type: 'Bug', area: 'Proj\\Old' } }, NOW)], [{ id: 9, rev: 2, type: 'Bug', title: 'x', area: 'Proj\\New' }]);
  assert.equal(areaOf(moved[0]), 'Proj\\New');
});

test('forwardTargets: skip ahead to Define or Who builds it? only before Who builds it?', () => {
  const at = (stage) => forwardTargets(cleanItem({ stage }));
  assert.deepEqual(at('new'), ['defining', 'decide']);
  assert.deepEqual(at('triaged'), ['defining', 'decide']);
  assert.deepEqual(at('defining'), ['decide']);
  assert.deepEqual(at('ready'), ['decide']);
  for (const st of ['decide', 'delegated', 'dev', 'done']) assert.deepEqual(at(st), [], st);
  const it = newItem({ title: 'Feature with stories' }, NOW);
  it.stage = 'triaged'; it.reopened = 'triaged';
  setStage(it, 'decide', NOW);
  assert.equal(pmColumn(it), 'decide');
  assert.equal(it.reopened, undefined);
});

test('asksFor: prompts from the item\'s sessions, folders and run, nothing else', async () => {
  const { asksFor } = await import('../js/model.js');
  const it = cleanItem({ id: 'w_1', title: 'X', sessions: { triage: 's1', current: 's2' }, work: { define: 'refine-x' } });
  const live = {
    permissions: [{ id: 'p1', sessionID: 's1', permission: 'bash' }, { id: 'p2', sessionID: 'other' }],
    questions: [{ id: 'q1', sessionID: 'zz', folder: 'refine-x', questions: [] }, { id: 'q2', sessionID: 'zz', folder: '41207-run' }, { id: 'q3', sessionID: 's2' }]
  };
  const a = asksFor(it, live);
  assert.deepEqual(a.permissions.map(x => x.id), ['p1']);
  assert.deepEqual(a.questions.map(x => x.id), ['q1', 'q3']);
  assert.equal(a.count, 3);
  assert.deepEqual(asksFor(it, live, { folder: '41207-run' }).questions.map(x => x.id), ['q1', 'q2', 'q3']);
  assert.equal(asksFor(it, null).count, 0);
  assert.equal(asksFor(cleanItem({ id: 'w_2', title: 'Y' }), live).count, 0);
});

test('questionAnswers: picks plus typed text, null until every question has one', async () => {
  const { questionAnswers } = await import('../js/model.js');
  const q = { questions: [{ question: 'A?' }, { question: 'B?', multiple: true }] };
  assert.equal(questionAnswers(q, { 0: ['Yes'] }, {}), null);
  assert.deepEqual(questionAnswers(q, { 0: ['Yes'], 1: ['One', 'Two'] }, { 1: ' and three ' }), [['Yes'], ['One', 'Two', 'and three']]);
  assert.deepEqual(questionAnswers(q, {}, { 0: 'typed', 1: 'also' }), [['typed'], ['also']]);
  assert.equal(questionAnswers({ questions: [] }), null);
});

/* ---------- shaping: triage, interview and brief (Slate 1.6.0) ---------- */

test('Board: four lanes; every step maps to its lane', async () => {
  const { BOARD_COLUMNS, STEP_COLUMN, boardColumn, STEP_CHIP } = await import('../js/model.js');
  assert.deepEqual(BOARD_COLUMNS.map(c => c.key), ['shape', 'decide', 'build', 'done']);
  assert.deepEqual(BOARD_COLUMNS.map(c => c.title), ['Shape', 'Decide', 'Build', 'Done']);
  const want = { new: 'shape', triage: 'shape', waiting: 'shape', interview: 'shape', brief: 'shape', define: 'decide', publish: 'decide', decide: 'decide', delegated: 'decide', building: 'build', review: 'build', merged: 'build', resolved: 'done' };
  for (const [st, col] of Object.entries(want)) assert.equal(boardColumn(st), col, st);
  const keys = new Set(BOARD_COLUMNS.map(c => c.key));
  for (const col of Object.values(STEP_COLUMN)) assert.ok(keys.has(col), col);
  assert.equal(STEP_CHIP.publish, 'Not in ADO');
  assert.equal(STEP_CHIP.new, 'New');
  assert.equal(STEP_CHIP.decide, 'Who builds it?');
  assert.equal(STEP_CHIP.brief, 'Brief ready');
  assert.equal(STEP_CHIP.merged, 'Merged');
  assert.equal(pmColumn(cleanItem({ stage: 'shaping' })), 'interview');
  assert.equal(pmColumn(cleanItem({ stage: 'brief' })), 'brief');
});

test('every stored stage lands in a column (stored data did not change with the board)', async () => {
  const { STAGES, BOARD_COLUMNS, boardColumn, devColumn } = await import('../js/model.js');
  const keys = new Set(BOARD_COLUMNS.map(c => c.key));
  for (const stage of STAGES.filter(x => x !== 'done')) {
    const it = cleanItem({ title: 'x', stage });
    const st = ['dev', 'resolved'].includes(stage) ? devColumn(null, it) : pmColumn(it);
    assert.ok(keys.has(boardColumn(st)), `${stage} -> ${st}`);
  }
});

test('ideas: kind and runwayPending are kept clean; own ideas are never stale in New', async () => {
  const { isStale } = await import('../js/model.js');
  const idea = newItem({ title: 'Bulk export', kind: 'idea', runwayPending: 'p_abc' }, new Date('2026-10-01T12:00:00'));
  assert.equal(idea.kind, 'idea');
  assert.equal(idea.runwayPending, 'p_abc');
  assert.equal(cleanItem({ kind: 'other', runwayPending: '../x' }).kind, undefined);
  assert.equal(cleanItem({ kind: 'other', runwayPending: '../x' }).runwayPending, undefined);
  assert.equal(isStale(idea, 'new', new Date('2026-11-06T12:00:00')), false);
  const req = newItem({ title: 'A request' }, new Date('2026-10-01T12:00:00'));
  assert.equal(isStale(req, 'new', new Date('2026-11-06T12:00:00')), true);
  const shaping = setStage(newItem({ title: 'x' }, new Date('2026-11-01T12:00:00')), 'shaping', new Date('2026-11-01T12:00:00'));
  assert.equal(isStale(shaping, 'interview', new Date('2026-11-06T12:00:00')), false, '5 days is the limit');
  assert.equal(isStale(shaping, 'interview', new Date('2026-11-07T12:00:00')), true);
});

const QUESTIONS = `# Shape: Bulk export

Status: ASKING
Round: 2

<!-- Written by /shape. ## Q9: not a question -->

## Q1: Who needs the export first?

- A) Account managers
- B) Customers, from the portal
- C) Both

Recommended: A
Why: The reports page is internal today (\`portal/Reports.cs\`).

## Q2: Which formats?

- A) CSV
- B) CSV and Excel

Recommended: B
Why: Finance asked for Excel.

## Q3: <question>

- A) <option>
`;

test('parseShapeQuestions reads the round, each question, its options and the recommendation', async () => {
  const { parseShapeQuestions } = await import('../js/model.js');
  const q = parseShapeQuestions(QUESTIONS);
  assert.equal(q.status, 'ASKING');
  assert.equal(q.round, 2);
  assert.equal(q.questions.length, 2, 'template placeholders and comments are not questions');
  assert.deepEqual(q.questions[0], { n: 1, text: 'Who needs the export first?', options: [{ key: 'A', text: 'Account managers' }, { key: 'B', text: 'Customers, from the portal' }, { key: 'C', text: 'Both' }], recommended: 'A', why: 'The reports page is internal today (`portal/Reports.cs`).' });
  assert.equal(parseShapeQuestions(''), null);
  const ready = parseShapeQuestions('# Shape: x\n\nStatus: READY\nRound: 3\n');
  assert.deepEqual(ready, { status: 'READY', round: 3, questions: [] });
  const odd = parseShapeQuestions('Status: maybe\n\n## Q1: Free text only?\n\nNo options here.\n\n## Q2: One\n\n- a. yes\nRecommended: Z\n');
  assert.equal(odd.status, null);
  assert.deepEqual(odd.questions.map(x => [x.n, x.options.length, x.recommended]), [[2, 1, null]], 'a question with no options is dropped; a recommendation that is not an option is ignored');
});

test('shapeState: asking only when the agent is idle and there are questions; ready needs READY and a brief', async () => {
  const { shapeState } = await import('../js/model.js');
  assert.equal(shapeState({ 'questions.md': QUESTIONS }).asking, true);
  assert.equal(shapeState({ 'questions.md': QUESTIONS }, { busy: true }).asking, false);
  assert.equal(shapeState({}).asking, false);
  const r = '# Shape: x\nStatus: READY\nRound: 3\n';
  assert.equal(shapeState({ 'questions.md': r }).ready, false, 'no brief yet');
  assert.equal(shapeState({ 'questions.md': r, 'brief.md': '# Brief: x\n' }).ready, true);
});

test('answersBlock and appendAnswers: one block per round, options, Other and Skipped', async () => {
  const { answersBlock, appendAnswers, notesBlock, parseShapeQuestions } = await import('../js/model.js');
  const q = parseShapeQuestions(QUESTIONS);
  const block = answersBlock(q.round, q.questions, { 1: { pick: 'B', other: 'only admins' }, 2: { pick: 'other', other: 'PDF too' } }, 'Ship before Q1.');
  assert.equal(block, '## Round 2\n\n### Q1: Who needs the export first?\n\nAnswer: B) Customers, from the portal. only admins\n\n### Q2: Which formats?\n\nAnswer: PDF too\n\n### Notes\n\nShip before Q1.\n');
  assert.match(answersBlock(1, q.questions, {}), /Answer: Skipped[\s\S]*Answer: Skipped/);
  assert.match(answersBlock(1, q.questions, { 1: { pick: 'other', other: '  ' } }), /### Q1[^\n]*\n\nAnswer: Skipped/, 'Other with no text is a skip');
  const first = appendAnswers(undefined, block);
  assert.match(first, /^# Answers\n/);
  assert.ok(first.endsWith('Ship before Q1.\n'));
  const second = appendAnswers(first, notesBlock(3, 'Look at permissions'));
  assert.ok(second.startsWith(first.trimEnd() + '\n\n## Round 3 notes, after the brief\n\nLook at permissions'));
  assert.equal(notesBlock(3, '  '), '');
});

test('parseBrief reads the level, size and product', async () => {
  const { parseBrief } = await import('../js/model.js');
  const b = parseBrief('# Brief: Bulk export\n\nProduct: Reports\nRepos: portal\nLevel: User Story\nSize: M\n\n<!-- Level: Epic -->\n\n## Problem\n\nNo way to export.\n\n## Open questions\n\n- Who can export?\n- none\n');
  assert.deepEqual(b, { title: 'Bulk export', product: 'Reports', level: 'story', size: 'M', problem: 'No way to export.', open: ['Who can export?'] });
  assert.equal(parseBrief('Level: Feature').level, 'feature');
  assert.equal(parseBrief('Level: <Epic | Feature>').level, null);
  assert.equal(parseBrief(''), null);
});

test('skipToDecide: straight to Who builds it? from Shape or Define, marked skipped, and Move back can undo it', async () => {
  const { skipToDecide } = await import('../js/model.js');
  const it = newItem({ title: 'Known work' }, new Date('2026-11-01T12:00:00'));
  setStage(it, 'triaged', new Date('2026-11-02T12:00:00'));
  skipToDecide(it, new Date('2026-11-03T12:00:00'));
  assert.equal(it.stage, 'decide');
  assert.deepEqual(it.history.at(-1), { stage: 'decide', at: '2026-11-03', skipped: true });
  assert.equal(pmColumn(it), 'decide');
  assert.deepEqual(backTargets(it), ['new', 'triaged']);
  assert.equal(cleanItem(it).history.at(-1).skipped, true, 'kept when stored');
  assert.throws(() => skipToDecide(cleanItem({ stage: 'delegated' })), /Shape, Define or Publish/);
  assert.doesNotThrow(() => skipToDecide(cleanItem({ stage: 'defining' })));
});

test('backTargets: a brief can go back to the interview, and Define back to the brief', () => {
  const it = newItem({ title: 'x', kind: 'idea' });
  setStage(it, 'shaping'); setStage(it, 'brief');
  assert.deepEqual(backTargets(it), ['new', 'shaping']);
  setStage(it, 'defining');
  assert.deepEqual(backTargets(it, 'define'), ['new', 'shaping', 'brief']);
});

test('summary: interview and brief items need you, and Runway ideas being shaped are listed for Runway', async () => {
  const { summaryCards } = await import('../js/model.js');
  const a = { ...newItem({ title: 'Asking', kind: 'idea', runwayPending: 'p_1' }), stage: 'shaping', shapeAsking: true };
  const b = { ...newItem({ title: 'Briefed', kind: 'idea' }), stage: 'brief' };
  const cols = { [a.id]: 'interview', [b.id]: 'brief' };
  const cards = summaryCards([a, b], { columnOf: it => cols[it.id] });
  const needs = cards.find(c => c.id === 'needs');
  assert.deepEqual(needs.rows.map(r => r.note), ['Answer the interview questions', 'Brief ready: send it to Define']);
  const shaping = cards.find(c => c.id === 'shaping');
  assert.deepEqual(shaping.rows, [{ id: 'p_1', title: 'Asking', route: `item/${a.id}` }]);
  assert.equal(shaping.kind, 'list');
});

test('pendingIdeaCards: Runway ideas as New cards, minus taken and hidden ones', async () => {
  const { pendingIdeaCards } = await import('../js/model.js');
  const rows = [{ id: 'p_1', title: 'Bulk export', note: 'CSV', due: '2026-11-05', route: 'pending' }, { id: 'p_2', title: 'Dark mode' }, { id: 'p_3', title: 'Hidden' }, { id: '../bad', title: 'x' }, { id: 'p_4' }];
  const items = [newItem({ title: 'Taken', kind: 'idea', runwayPending: 'p_2' })];
  const out = pendingIdeaCards(rows, items, ['p_3'], new Date('2026-11-06T12:00:00'));
  assert.deepEqual(out.map(c => [c.id, c.title, c.description, c.kind, c.virtual, c.fromRunway, c.createdAt, c.stage]), [['rw_p_1', 'Bulk export', 'CSV', 'idea', true, 'p_1', '2026-11-05', 'new']]);
  assert.deepEqual(pendingIdeaCards(null), []);
});

test('forwardTargets: Interview and Brief can skip ahead to Define or Who builds it? too', async () => {
  const { forwardTargets } = await import('../js/model.js');
  assert.deepEqual(forwardTargets(cleanItem({ stage: 'shaping' })), ['defining', 'decide']);
  assert.deepEqual(forwardTargets(cleanItem({ stage: 'brief' })), ['defining', 'decide']);
  assert.deepEqual(forwardTargets(cleanItem({ stage: 'decide' })), []);
});

/* ---------- Slate 1.7.0: idea to resolved (claude/slate-dispatch-e2e-v1-plan.md) ---------- */

test('cleanItem keeps the run folder, merged, the pull request check and after; drops bad values', async () => {
  const it = cleanItem({ title: 'x', run: { folder: 'L3-thing', id: 'L3' }, merged: '2026-11-05', mergedHow: 'manual', after: 'build',
    prs: { status: 'open', at: 't', list: [{ id: 1, status: 'active', url: 'javascript:alert(1)', title: 't' }, { id: 'x' }] } });
  assert.deepEqual(it.run, { folder: 'L3-thing', id: 'L3' });
  assert.equal(it.merged, '2026-11-05');
  assert.equal(it.mergedHow, 'manual');
  assert.equal(it.after, 'build');
  assert.deepEqual(it.prs.list.map(p => [p.id, p.url]), [[1, '']]);
  const bad = cleanItem({ title: 'x', run: { folder: '../up' }, merged: 'soon', prs: { status: 'weird' }, after: 'later' });
  for (const k of ['run', 'merged', 'mergedHow', 'prs', 'after']) assert.equal(k in bad, false, k);
  assert.equal(cleanItem({ stage: 'resolved' }).stage, 'resolved');
});

test('runStep names what a Building card is at', async () => {
  const { runStep } = await import('../js/model.js');
  assert.equal(runStep(null), 'Not started');
  assert.equal(runStep({ next: { stage: 'spec', needsYou: true } }), 'Waiting on you');
  assert.deepEqual(['spec', 'plan', 'build'].map(st => runStep({ next: { stage: st } })), ['Spec', 'Plan', 'Build']);
});

test('applyWork: a run started in Dispatch adds a card in Building, or links the card it belongs to', async () => {
  const { applyWork } = await import('../js/model.js');
  const list = [];
  const offer = (payload, id = 'h1') => ({ id, to: 'slate', accepted: true, text: payload.title || 'x', payload: { kind: 'work', ...payload }, source: { app: 'agents' } });
  const id = applyWork(list, offer({ title: 'Local thing', folder: 'L4-local-thing', id: 'L4', lane: 'bug' }), NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].stage, 'dev');
  assert.equal(list[0].level, 'bug');
  assert.equal(list[0].route, 'myself');
  assert.deepEqual(list[0].run, { folder: 'L4-local-thing', id: 'L4' });
  assert.equal(list[0].history[0].from, 'dispatch');
  // An ADO start links the card already on the board and moves it to Building.
  const req = cleanItem({ ...newItem({ title: 'Req', ado: { id: 77, type: 'User Story' } }, NOW), stage: 'decide' });
  list.push(req);
  assert.equal(applyWork(list, offer({ title: 'Req', ado: 77 }, 'h2'), NOW), req.id);
  assert.equal(list.length, 2);
  assert.equal(req.stage, 'dev');
  assert.equal(req.history[req.history.length - 1].from, 'dispatch');
  // Not for Slate, or nothing to find the run by: ignored.
  assert.equal(applyWork(list, { ...offer({ folder: 'L5-x' }), to: 'notes' }), null);
  assert.equal(applyWork(list, offer({ title: 'nothing' }, 'h3')), null);
  assert.equal(list.length, 2);
});

test('releaseGroups and releaseNotesMd: resolved items by area path, notes as Markdown', async () => {
  const { releaseGroups, releaseNotesMd } = await import('../js/model.js');
  const r = (id, area, adoId, title) => cleanItem({ id, title, stage: 'resolved', ado: { id: adoId, url: `https://ado.example.com/${adoId}`, area } });
  const groups = releaseGroups([r('a', 'Web\\B', 2, 'Two'), r('b', 'Web\\A', 1, 'One'), r('c', '', 3, 'Three'), cleanItem({ id: 'd', stage: 'dev' })]);
  assert.deepEqual(groups.map(g => g.label), ['Web\\A', 'Web\\B', 'No area path']);
  const md = releaseNotesMd(groups[0], { b: 'Faster *renewals*\nSecond line' });
  assert.equal(md, '## Web\\A\n\n- **One** ([#1](https://ado.example.com/1))\n  Faster *renewals*\n  Second line\n');
});

test('summary: runs card links runs by ADO id or folder and flags merged; needs asks to resolve what merged', async () => {
  const { summaryCards } = await import('../js/model.js');
  const a = cleanItem({ id: 'w_a', title: 'Local', stage: 'dev', run: { folder: 'L1-local', id: 'L1' } });
  const b = cleanItem({ id: 'w_b', title: 'In ADO', stage: 'dev', merged: '2026-11-05', ado: { id: 5 } });
  const c = cleanItem({ id: 'w_c', title: 'Released', stage: 'resolved', ado: { id: 6 } });
  const cards = summaryCards([a, b, c], { columnOf: () => 'building', now: NOW });
  const runs = cards.find(x => x.id === 'runs');
  assert.deepEqual(runs.rows.map(r => [r.id, r.folder || '', r.flag || '']), [['L1-local', 'L1-local', ''], ['5', '', 'done'], ['6', '', 'done']]);
  assert.deepEqual(cards.find(x => x.id === 'needs').rows.map(r => r.note), ['Merged: mark it resolved']);
});

test('health: request to resolved and closed items', async () => {
  const { health } = await import('../js/model.js');
  const it = cleanItem({ title: 'x', createdAt: '2026-11-01', stage: 'done', history: [{ stage: 'new', at: '2026-11-01' }, { stage: 'resolved', at: '2026-11-04' }, { stage: 'done', at: '2026-11-06' }] });
  const h = health([it], () => 'new', NOW);
  assert.equal(h.toResolved.median, 3);
  assert.equal(h.closed, 1);
});

test('backTargets: a resolved item goes back to Building, never to Resolved itself', () => {
  const it = cleanItem({ title: 'x', stage: 'resolved', history: [{ stage: 'new', at: '2026-11-01' }, { stage: 'dev', at: '2026-11-02' }, { stage: 'resolved', at: '2026-11-03' }] });
  assert.deepEqual(backTargets(it), ['new', 'dev']);
});

test('Inbox leaves out a Runway pending idea that Slate itself sent (Add to roadmap): the card is already on the board', async () => {
  const { pendingIdeaCards, roadmapIdea, sentIdeaTitles } = await import('../js/model.js');
  const it = newItem({ title: 'Export   orders', description: 'Finance asked' }, NOW);
  const env = { schema: 'slate.handoffs', version: 1, items: [roadmapIdea(it, NOW), { id: 'h_t', to: 'prioritizer', text: 'A task', payload: { kind: 'task' } }] };
  assert.deepEqual(sentIdeaTitles(env), ['Export orders']);
  const rows = [{ id: 'p_1', title: 'Export orders' }, { id: 'p_2', title: 'Someone else\'s idea' }];
  assert.deepEqual(pendingIdeaCards(rows, [it], [], NOW, sentIdeaTitles(env)).map(c => c.title), ['Someone else\'s idea']);
  assert.equal(pendingIdeaCards(rows, [it], [], NOW).length, 2, 'without the list, both show (as before)');
});

/* ---------- request intake (claude/request-intake-v1-plan.md) ---------- */


const offer = (payload, extra = {}) => ({ id: 'c_1', to: 'slate', text: payload.note || '', payload: { kind: 'request', ...payload }, source: { app: 'home', id: 'c_1' }, accepted: true, ...extra });

test('applyRequest: an ADO id links to its card or makes one titled #id; plain text makes a request card', () => {
  const list = [];
  const id = applyRequest(list, offer({ ado: 1234, note: 'customers want CSV' }), NOW);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].id, list[0].title, list[0].stage, list[0].ado.id, list[0].history[0].from], [id, '#1234', 'new', 1234, 'capture']);
  assert.match(list[0].description, /Note \(2026-11-05\): customers want CSV/);
  assert.equal(needsAdoTitle(list[0]), true);
  // Again, same item: no second card, the note is added once.
  assert.equal(applyRequest(list, offer({ ado: 1234, note: 'also PDF' }), NOW), id);
  applyRequest(list, offer({ ado: 1234, note: 'also PDF' }), NOW);
  assert.equal(list.length, 1);
  assert.equal((list[0].description.match(/also PDF/g) || []).length, 1);
  const n = applyRequest(list, offer({ note: 'Export to CSV for billing\nFinance asked twice' }), NOW);
  const r = list.find(x => x.id === n);
  assert.deepEqual([r.title, r.description, r.ado], ['Export to CSV for billing', 'Finance asked twice', null]);
  assert.equal(timeline(r)[0].text, 'Captured on Home');
  assert.equal(timeline(list[0])[0].text, 'Captured on Home: ADO #1234');
  assert.equal(applyRequest(list, offer({}, { text: '' }), NOW), null, 'nothing to add');
  assert.equal(applyRequest(list, { ...offer({ ado: 5 }), to: 'runway' }, NOW), null, 'not for Slate');
  assert.equal(needsAdoTitle(cleanItem({ title: 'Real', ado: { id: 9, type: 'Issue' } })), false);
});

test('publish plan: a scope from an existing Issue links the Issue to the new epic, once', () => {
  const s = newItem({ title: 'Customers want CSV', ado: { id: 77, rev: 3, type: 'Issue' } }, NOW);
  s.work.define = 'scope-csv';
  const sf = { 'stories.md': 'Status: APPROVED', 'milestones.md': MILESTONES };
  const plan = publishPlan(s, sf);
  const link = plan.at(-1);
  assert.deepEqual([link.ref, link.op, link.id, link.to, link.toType, link.toTitle], ['source', 'link', 77, 'epic', 'Epic', 'Orders v2.1']);
  s.published = { epic: 10, source: 77 };
  assert.equal(publishPlan(s, sf).at(-1).op, 'skip');
  // An epic item is the epic: nothing to link. Neither is one milestones.md names.
  const e = newItem({ title: 'E', ado: { id: 900, rev: 1, type: 'Epic' } }, NOW);
  e.work.define = 'scope-e';
  assert.ok(!publishPlan(e, sf).some(p => p.ref === 'source'));
  const named = newItem({ title: 'N', ado: { id: 900, rev: 1, type: 'Issue' } }, NOW);
  named.work.define = 'scope-n';
  assert.ok(!publishPlan(named, { ...sf, 'milestones.md': MILESTONES.replace('Epic: Orders v2.1', 'Epic: #900 Orders v2.1') }).some(p => p.ref === 'source'));
  // A refined story updates the item itself: no link.
  assert.match(sourceComment({ id: 10, type: 'Epic', title: 'Orders v2.1' }), /^Shaped in Slate into Epic #10: Orders v2\.1\. /);
});

test('suggestsScope, questionsText, repliesSince', () => {
  const story = newItem({ title: 'x', ado: { id: 3, type: 'Issue' } }, NOW);
  assert.equal(suggestsScope(story, null), false);
  assert.equal(suggestsScope(story, { size: 'M' }), false);
  assert.equal(suggestsScope(story, { size: 'L' }), true);
  assert.equal(suggestsScope(newItem({ title: 'f', level: 'feature' }, NOW), null), true);
  assert.equal(questionsText(story, { questions: ['Who?', 'When?'] }), 'x (#3)\n\nA few questions before we start:\n1. Who?\n2. When?');
  const comments = [
    { text: 'old', date: '2026-11-01T00:00:00Z', by: { name: 'A' } },
    { text: 'x (#3)\n\nA few questions before we start:\n1. Who?', date: '2026-11-06T10:00:00Z', by: { name: 'Me' } },
    { text: 'Finance, by Q1', date: '2026-11-06T12:00:00Z', by: { name: 'Pat Lee' } }
  ];
  assert.equal(repliesSince(comments, '2026-11-06T09:00:00Z'), 'Pat Lee (2026-11-06):\nFinance, by Q1');
  assert.equal(repliesSince(comments, '2026-11-07T00:00:00Z'), '');
});

test('cleanItem keeps source and asked only in shape', () => {
  const it = cleanItem({ title: 't', source: { id: 5, url: 'javascript:x', type: 'Issue' }, asked: { id: 5, at: '2026-11-06T10:00:00Z' } });
  assert.deepEqual(it.source, { id: 5, url: '', type: 'Issue' });
  assert.deepEqual(it.asked, { id: 5, at: '2026-11-06T10:00:00Z' });
  const bad = cleanItem({ title: 't', source: { id: 'x' }, asked: { id: 5 } });
  assert.equal(bad.source, undefined); assert.equal(bad.asked, undefined);
});

test('summary: tracked lists every ADO item on the board with its column, and linked sources', async () => {
  const { summaryCards } = await import('../js/model.js');
  const now = new Date('2026-11-06T12:00:00');
  const a = newItem({ title: 'In shape', ado: { id: 7, type: 'Issue' } }, now); setStage(a, 'triaged', now);
  const b = newItem({ title: 'Scoped', ado: { id: 90, type: 'Epic' } }, now); setStage(b, 'decide', now); b.source = { id: 77, url: '', type: 'Issue' };
  const c = newItem({ title: 'Closed', ado: { id: 8, type: 'Bug' } }, now); setStage(c, 'done', now);
  const d = newItem({ title: 'No ADO' }, now);
  const cols = { [a.id]: 'triage', [b.id]: 'decide', [c.id]: 'resolved', [d.id]: 'new' };
  const t = summaryCards([a, b, c, d], { columnOf: it => cols[it.id], now }).find(x => x.id === 'tracked');
  assert.deepEqual(t.rows.map(r => [r.id, r.note]), [['7', 'Shape'], ['90', 'Decide'], ['77', 'Source of #90']]);
  assert.equal(t.rows[0].route, `item/${a.id}`);
});

test('pendingIdeaCards: rows from Slate itself are left out by `from`; titles only matter for rows with no `from`', async () => {
  const { pendingIdeaCards } = await import('../js/model.js');
  const NOW = new Date('2026-11-07T12:00:00');
  const rows = [
    { id: 'p_1', title: 'Mine, new Runway', from: 'slate' },
    { id: 'p_2', title: 'Mine, old Runway' },
    { id: 'p_3', title: 'Mine, old Runway', from: 'home' },
    { id: 'p_4', title: 'From Home', from: 'home' }
  ];
  assert.deepEqual(pendingIdeaCards(rows, [], [], NOW, ['Mine, old Runway']).map(c => c.fromRunway), ['p_3', 'p_4']);
});

test('applyRoadmapItem: a card from Runway\'s roadmap-item offer, once per roadmap item', async () => {
  const { applyRoadmapItem } = await import('../js/model.js');
  const NOW = new Date('2026-11-07T12:00:00');
  const offer = { id: 'h_m_a_f1_slate', to: 'slate', text: 'Refunds', accepted: true, source: { app: 'runway', id: 'f1' },
    payload: { kind: 'roadmap-item', map: 'm_a', item: 'f1', title: 'Refunds', notes: 'Partial too', level: 'feature', ado: { id: 42, rev: 3, type: 'Feature', url: 'https://example.test/42', connection: 'work', state: 'New' } } };
  const list = [];
  const id = applyRoadmapItem(list, offer, NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].title, 'Refunds');
  assert.equal(list[0].description, 'Partial too');
  assert.equal(list[0].level, 'feature');
  assert.equal(list[0].stage, 'new');
  assert.deepEqual(list[0].runway, { map: 'm_a', item: 'f1' });
  assert.deepEqual(list[0].ado, { id: 42, rev: 3, type: 'Feature', url: 'https://example.test/42', connection: 'work', area: '', state: 'New' });
  assert.equal(applyRoadmapItem(list, offer, NOW), id);
  assert.equal(list.length, 1);
  assert.equal(applyRoadmapItem(list, { ...offer, source: { app: 'home' } }, NOW), null);
  assert.equal(applyRoadmapItem(list, { ...offer, payload: { ...offer.payload, kind: 'work' } }, NOW), null);
  assert.equal(applyRoadmapItem(list, { ...offer, payload: { ...offer.payload, map: '' } }, NOW), null);
  const noAdo = { ...offer, payload: { kind: 'roadmap-item', map: 'm_a', item: 's9', title: 'Story', level: 'weird' } };
  applyRoadmapItem(list, noAdo, NOW);
  assert.equal(list[1].level, 'story');
  assert.equal(list[1].ado, null);
});

test('manual drafts: templates parse, Status flips, and cleanItem keeps only the draft files', async () => {
  const { manualDraft, withStatus } = await import('../js/model.js');
  const it = newItem({ title: 'CSV export', description: 'Pat needs it' }, NOW);
  const r = manualDraft('refine', it);
  assert.equal(draftState({ work: { define: 'refine-manual-x' } }, r).step, 'approve');
  assert.match(parseRefine(r['refine.md']).acceptance, /^Scenario:/);
  const sc = manualDraft('scope', it);
  assert.equal(draftState({ work: { define: 'scope-manual-x' } }, sc).step, 'approve-milestones');
  assert.equal(parseMilestones(sc['milestones.md']).features.length, 1);
  assert.equal(draftState({ work: { define: 'scope-manual-x' } }, { ...sc, 'milestones.md': withStatus(sc['milestones.md'], 'APPROVED') }).step, 'publish');
  assert.equal(withStatus('no status', 'DRAFT').split('\n')[0], 'Status: DRAFT');
  const kept = cleanItem({ title: 't', manual: { folder: 'refine-manual-w_1', files: { 'refine.md': 'x', 'evil.sh': 'y' } } });
  assert.deepEqual(kept.manual, { folder: 'refine-manual-w_1', files: { 'refine.md': 'x' } });
  assert.equal(cleanItem({ title: 't', manual: { folder: '../x', files: {} } }).manual, undefined);
  // A manual epic from an Issue publishes the same plan as an agent's, source link included.
  const src = newItem({ title: 'Customers want CSV', ado: { id: 77, rev: 1, type: 'Issue' } }, NOW);
  src.work.define = 'scope-manual-w';
  const plan = publishPlan(src, { ...sc, 'milestones.md': withStatus(sc['milestones.md'], 'APPROVED') });
  assert.deepEqual(plan.map(p => p.ref), ['epic', 'feature 1', 'story 1.1', 'source']);
});

test('two collections: backlogs merge with their connection, a repeated id gets its own card', () => {
  const backlog = mergeBacklogs([
    { connection: 'main', items: [{ id: 500, title: 'Main 500', type: 'User Story', rev: 2 }, { id: 501, title: 'Main 501', type: 'Bug', rev: 1 }] },
    { connection: 'apps', items: [{ id: 500, title: 'Apps 500', type: 'User Story', rev: 7 }] }
  ]);
  assert.deepEqual(backlog.map(b => [b.id, b.connection, !!b.dupe]), [[500, 'main', false], [501, 'main', false], [500, 'apps', true]]);
  assert.deepEqual(backlog.map(virtualAdoId), ['ado_500', 'ado_501', 'ado_500_apps']);
  // A stored card on apps 500 is matched to the apps row only; main 500 stays a card of its own.
  const stored = newItem({ title: 'Mine', ado: { id: 500, type: 'User Story', connection: 'apps' } }, NOW);
  const list = cards([stored], backlog);
  assert.equal(list.length, 3);
  assert.equal(list[0].adoNow.title, 'Apps 500');
  assert.deepEqual(list.slice(1).map(c => c.id), ['ado_500', 'ado_501']);
  assert.equal(list[1].ado.connection, 'main');
});

test('sameAdo: both connections known must match; one unknown matches on the id', () => {
  assert.equal(sameAdo({ id: 1, connection: 'a' }, { id: 1, connection: 'a' }), true);
  assert.equal(sameAdo({ id: 1, connection: 'a' }, { id: 1, connection: 'b' }), false);
  assert.equal(sameAdo({ id: 1, connection: '' }, { id: 1, connection: 'b' }), true);
  assert.equal(sameAdo({ id: 1 }, { id: 2 }), false);
});

test('a bare #id on a team with two collections: one match fills it, two wait for a pick', () => {
  const it = applyRequestItem();
  assert.equal(needsAdoConnection(it, false), false);
  assert.equal(needsAdoConnection(it, true), true);
  const m = (connection, title) => ({ id: 500, connection, title, type: 'User Story', state: 'New', project: 'P', url: 'https://ado.example/x', area: 'P\\T', rev: 3 });
  const one = adoFromFind(it.ado, { matches: [m('apps', 'Apps 500')], failed: [] });
  assert.equal(one.connection, 'apps');
  assert.equal(one.rev, 3);
  assert.equal(adoFromFind(it.ado, { matches: [], failed: [] }), null);
  const two = adoFromFind(it.ado, { matches: [m('main', 'Main 500'), m('apps', 'Apps 500')], failed: [] });
  assert.deepEqual(two.choices.map(c => c.connection), ['main', 'apps']);
  // Kept through a save while there is no connection, gone once one is set.
  const kept = cleanItem({ ...it, ado: two });
  assert.equal(kept.ado.choices.length, 2);
  assert.equal(needsAdoConnection(kept, true), false);
  assert.equal(needsAdoTitle(kept), false);
  assert.equal(cleanItem({ ...it, ado: { ...two, connection: 'main' } }).ado.choices, undefined);
});

function applyRequestItem() {
  const list = [];
  applyRequest(list, { to: 'slate', payload: { kind: 'request', ado: 500, note: 'upgrade' } }, NOW);
  return list[0];
}

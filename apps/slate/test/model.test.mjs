// Slate's pure model: stages and columns, the .work file parsers (eng-agents templates), and the publish plan.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backTargets, forwardTargets, cards, changedInAdo, cleanItem, devColumn, moveBack, draftState, filterCards, newItem, parseMilestones, parseRefine, parseTriage,
  areaOptions, areaOf, inArea, underArea, NO_AREA, pmColumn, publishPlan, roadmapIdea, setStage, statusOf, waitingTask, cleanPrefs, cardFacts, detailRows, customRefs, fieldLabel, DEFAULT_PREFS
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

test('health: counts, stale and median days per column; request to decision', async () => {
  const { health } = await import('../js/model.js');
  const a = newItem({ title: 'a' }, new Date('2026-11-01T12:00:00'));
  const b = newItem({ title: 'b' }, new Date('2026-11-03T12:00:00'));
  const c = newItem({ title: 'c' }, new Date('2026-11-01T12:00:00')); setStage(c, 'decide', new Date('2026-11-04T12:00:00'));
  const d = newItem({ title: 'd' }, new Date('2026-11-01T12:00:00')); setStage(d, 'delegated', new Date('2026-11-02T12:00:00')); d.assignee = 'p_1';
  const h = health([a, b, c, d], it => (it.stage === 'decide' ? 'decide' : it.stage === 'delegated' ? 'delegated' : 'new'), new Date('2026-11-06T12:00:00'));
  assert.deepEqual(h.cols.new, { count: 2, stale: 1, medianDays: 3 });
  assert.equal(h.cols.decide.count, 1);
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

test('cards show assignee, priority, points, iteration, area and tags from the backlog', () => {
  const b = { assignee: { name: 'Dev One' }, priority: 2, storyPoints: 3, commentCount: 4, iteration: 'Web App\\Sprint 12', area: 'Web App\\Team A', tags: ['api'] };
  const all = cardFacts(b, cleanPrefs({}));
  assert.deepEqual(all.facts.map(f => f.text), ['Dev One', 'P2', '3 pts', 'Sprint 12', 'Team A']);
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

test('forwardTargets: skip ahead to Define or Who builds it? from the PM lane only', () => {
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

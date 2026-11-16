// Dispatch 3.0 flows (js/flows.js) and the pages that use them: the presets follow eng-agents' suggested flows,
// where each kind of .work folder is in its flow, which steps stop for you, what waits in the Inbox, sending a draft
// back with a note, and Go through them. On the synthetic fixture (fixtures/state.json).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/dispatch/state.js';
import { render } from '../js/dispatch/view.js';
import { FLOWS, PICKER, flowOf, flowTag, stepsOf, stepIndex, currentStep, atGate, isFinished, gateFile, sendBackCommand, addOpenQuestion, docsCheckCommand,
  folderCommand, turnHtml, stepLine, youCount, shownSteps, stepsLine, flowCardHtml, forkHtml, miniTrack } from '../js/dispatch/flows.js';
import { inboxData, inboxCount, walkList, wantedFiles, workGroup, isStopped, inboxFolders } from '../js/dispatch/pages.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
function load() {
  S.D = clone(FIXTURE);
  S.L = S.D.liveMode.live;
  S.conn = 'on';
  S.connector = { state: 'ready', message: null };
  S.mode = 'local'; S.embedded = true; S.canNotify = false;
  S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20';
  S.copyStore = []; S.files = {}; S.slate = new Map();
  resetUi();
}
const item = folder => S.D.items.find(i => i.folder === folder);
const folder = (name, kind, extra) => ({ folder: name, kind, id: null, title: name, bucket: 'notes', modifiedMs: S.now - 3600e3, files: [], ...extra });
beforeEach(load);

test('the flow cards: seven to pick from, each step named, the ones that stop for you marked (flow cards v1)', () => {
  assert.deepEqual(PICKER.map(f => f.id), ['request', 'feature', 'bug', 'spike', 'epic', 'handoff', 'docs']);
  assert.deepEqual(FLOWS.filter(f => f.picker === false).map(f => f.id), ['diagnose', 'tsd', 'small'], 'kept for runs: Diagnose is Fix a bug from an error log, Technical spec a Write docs type, Small change a Build a feature size');
  const keys = id => stepsOf(FLOWS.find(f => f.id === id), 'feature').map(s => s.key + (s.you === true ? '*' : s.you ? '?' : '') + (s.quiet ? '~' : ''));
  assert.deepEqual(keys('request'), ['triage*', 'interview*', 'brief*'], 'triage, interview, brief; triage and brief are forks');
  assert.deepEqual(keys('feature'), ['start~', 'spec*', 'build', 'review?', 'ship*'], 'Set up is quiet; Review stops only on blockers; Ship has the PR text');
  assert.deepEqual(keys('bug'), ['start~', 'bug*', 'build', 'review?', 'ship*']);
  assert.deepEqual(keys('spike'), ['investigate', 'findings*']);
  assert.deepEqual(keys('epic'), ['scope', 'stories*', 'slice', 'milestones*', 'backlog*'], 'Create in ADO is your click');
  assert.deepEqual(keys('handoff'), ['define*', 'assign*', 'with', 'resolve*']);
  assert.deepEqual(keys('docs'), ['draft', 'read*', 'check', 'final*', 'save*']);
  assert.deepEqual(keys('tsd'), ['draft', 'read*', 'check', 'final*', 'save*']);
  assert.ok(FLOWS.find(f => f.id === 'spike').steps[1].fork && FLOWS.find(f => f.id === 'docs').steps[4].fork, 'findings and Save end with path cards');
  assert.equal(youCount(stepsOf(FLOWS.find(f => f.id === 'feature'))), 2, 'Review is not counted: it stops only sometimes');
  assert.equal(shownSteps(stepsOf(FLOWS.find(f => f.id === 'feature'))).length, 4, 'Set up is not a dot');
  assert.equal(stepsLine(stepsOf(FLOWS.find(f => f.id === 'bug'))), 'Root cause (you), Fix, Review (you, only on blockers), Ship (you)');
  const card = flowCardHtml(FLOWS.find(f => f.id === 'feature'));
  assert.match(card, /<i class="maybe" title="Review \(you, only on blockers\)">/);
  assert.match(card, /4 steps, 2 stops for you/);
  assert.match(flowCardHtml(FLOWS.find(f => f.id === 'request')), /Runs on the board/);
  for (const f of FLOWS) for (const s of stepsOf(f, 'feature')) assert.ok(s.name && s.what, f.id + '.' + s.key + ' says what it does');
});

test('path cards: a title and a line each, the suggested one tagged, attributes as given', () => {
  const html = forkHtml([{ label: 'Build it', desc: 'Start a <feature>.', attrs: 'data-x="1"', primary: true }, null, { label: 'Close', desc: '', disabled: true }], 'Next');
  assert.match(html, /^<div class="forks" role="group" aria-label="Next">/);
  assert.match(html, /<button type="button" class="fork rec" data-x="1"><span class="fk-t">Build it<span class="fk-rec">Suggested<\/span><\/span><span class="fk-d">Start a &lt;feature&gt;\.<\/span><\/button>/);
  assert.match(html, /class="fork" disabled>/);
  assert.equal(forkHtml([]), '');
});

test('each .work folder is in a flow: work items by lane, the rest by kind; Slate folders and PR reviews by none', () => {
  assert.equal(flowOf(item('41207-fix-login-timeout')).id, 'feature');
  assert.equal(flowOf(item('41300-export-retry-fails')).id, 'bug');
  assert.equal(flowOf(item('spike-cache-options')).id, 'spike');
  assert.equal(flowOf(item('tsd-billing-api')).id, 'tsd');
  assert.equal(flowOf(folder('scope-change-requests', 'scope')).id, 'epic');
  assert.equal(flowOf(folder('docs-run-gateway', 'docs')).id, 'docs');
  assert.equal(flowOf(folder('pr-812', 'pr')), null);
  assert.equal(flowOf(folder('triage-41207', 'other')), null);
  assert.equal(flowTag({ ...item('41207-fix-login-timeout'), id: 'L3' }), 'Quick feature', 'a described run shows it was a quick change');
  assert.equal(flowTag(folder('pr-812', 'pr')), 'PR review');
});

test('where a run is: the stage for work items, the parser state for the rest', () => {
  assert.equal(stepIndex(item('41207-fix-login-timeout')), 2, 'build');
  assert.equal(stepLine(item('41207-fix-login-timeout')), 'Step 2 of 4: Build 2/3', 'Set up is not counted');
  assert.equal(stepIndex({ ...item('41207-fix-login-timeout'), stage: 'plan' }), 1, 'one feature gate: the plan stage is in Spec and plan');
  assert.equal(stepIndex({ ...item('41207-fix-login-timeout'), stage: 'tasks' }), 1, 'and so is tasks');
  assert.equal(stepIndex({ ...item('41207-fix-login-timeout'), stage: 'pr' }), 4, 'PR text is part of Ship');
  assert.equal(stepLine({ ...item('41207-fix-login-timeout'), stage: 'start' }), 'Setting up, then 4 steps');
  assert.match(miniTrack({ ...item('41207-fix-login-timeout'), stage: 'start' }), /aria-label="Setting up".*<span class="mstep">Set up<\/span>/s);
  assert.equal(stepIndex(item('41610-rate-limit-headers')), 4, 'a bug at Ship: the last step');
  assert.equal(currentStep(item('41300-export-retry-fails')).key, 'bug');
  const epic = st => stepIndex(folder('scope-x', 'scope', { state: st }));
  assert.deepEqual(['Scoping', 'Stories in review', 'Stories approved', 'Milestones in review', 'Milestones approved', 'Import file ready', 'Work items created'].map(epic), [0, 1, 2, 3, 4, 4, 5],
    'an import file is not in ADO yet: still Create in ADO');
  assert.ok(isFinished(folder('scope-x', 'scope', { state: 'Work items created' })));
  assert.ok(!isFinished(folder('scope-x', 'scope', { state: 'Import file ready' })));
  const tsd = st => stepIndex(folder('tsd-x', 'tsd', { state: st }));
  assert.deepEqual(['In progress', 'Draft, not fact-checked', 'Draft, fact-check found 2 wrong or outdated', 'Draft, fact-checked', 'Published'].map(tsd), [0, 1, 3, 3, 5]);
  const docs = st => stepIndex(folder('docs-x', 'docs', { state: st }));
  assert.deepEqual(['In progress', 'Written, not checked yet', 'Fact-checked', 'Saved'].map(docs), [0, 1, 3, 5]);
  S.L.sessions.ses_chk = { id: 'ses_chk', status: 'busy', command: '/check-docs docs/x.md' };
  S.L.items['docs-x'] = { current: 'ses_chk', sessions: [{ id: 'ses_chk' }] };
  assert.equal(docs('Written, not checked yet'), 2, 'the fact-check running: at Fact-check');
  assert.ok(isFinished(folder('docs-x', 'docs', { state: 'Saved' })));
  assert.ok(!isFinished(item('spike-cache-options')), 'a spike with findings waits at its fork');
  assert.equal(stepIndex(folder('spike-x', 'spike', { state: 'Closed' })), 2);
  assert.ok(isFinished(folder('spike-x', 'spike', { state: 'Closed' })));
});

test('what waits in the Inbox: work-item gates, and every step that stops for you on the rest (flow cards v1)', () => {
  assert.ok(atGate(item('41300-export-retry-fails')));
  assert.ok(!atGate(item('41207-fix-login-timeout')));
  for (const [st, want] of [['Stories in review', true], ['Stories approved', false], ['Milestones in review', true], ['Milestones approved', true], ['Import file ready', true], ['Work items created', false], ['Scoping', false]]) {
    assert.equal(atGate(folder('scope-x', 'scope', { state: st })), want, st);
  }
  for (const [st, want] of [['Draft, not fact-checked', true], ['Draft, fact-check found 1 wrong or outdated', true], ['Draft, fact-checked', true], ['Published', false]]) {
    assert.equal(atGate(folder('tsd-x', 'tsd', { state: st })), want, st);
  }
  for (const [st, want] of [['Written, not checked yet', true], ['Fact-checked', true], ['Saved', false]]) {
    assert.equal(atGate(folder('docs-x', 'docs', { state: st })), want, 'docs ' + st);
  }
  assert.ok(atGate(item('spike-cache-options')), 'findings wait for you to pick the path');
  assert.ok(!atGate(folder('spike-x', 'spike', { state: 'Closed' })));
  S.D.items.push(folder('scope-change-requests', 'scope', { state: 'Stories in review', title: 'Change requests', files: ['epics.md', 'stories.md'], nextText: 'Review epics.md and stories.md, then `/approve scope-change-requests`.' }));
  const d = inboxData();
  assert.deepEqual(d.gates.map(i => i.folder).sort(), ['41300-export-retry-fails', 'scope-change-requests', 'spike-cache-options', 'tsd-billing-api'], 'a TSD draft to read waits too');
  assert.deepEqual(d.failed.map(i => i.folder), ['41502-csv-export'], 'blocked runs are Stopped, not Ready for your review');
  assert.ok(isStopped(item('41502-csv-export')));
  assert.equal(inboxCount(d), 6);
  const html = render();
  assert.match(html, /id="item-scope-change-requests".*<span class="turnw t-you">Your turn:<\/span>.*data-cmd="\/approve scope-change-requests"[^>]*>Approve<.*data-sb-toggle="scope-change-requests"[^>]*>Send back</s);
  assert.match(html, /id="item-spike-cache-options".*<div class="forks" role="group" aria-label="What next for this spike">.*data-doc-flow="feature".*data-doc-flow="bug".*data-doc-flow="docs".*data-doc-note="spike-cache-options".*data-spike-close="spike-cache-options"/s, 'the findings fork');
  assert.ok(inboxFolders(d).has('scope-change-requests'));
  S.ui.tab = 'work';
  assert.doesNotMatch(render(), /id="item-scope-change-requests"/, 'not on Work while it waits on you');
});

test('forks at a folder step: Create in ADO, a doc\'s read and its save, a TSD\'s reads', () => {
  const add = x => { S.D.items.push(x); return x; };
  add(folder('scope-y', 'scope', { state: 'Milestones approved', files: ['milestones.md'] }));
  add(folder('docs-y', 'docs', { state: 'Fact-checked', files: ['sources.md', 'check.md'] }));
  add(folder('tsd-y', 'tsd', { state: 'Draft, not fact-checked', files: ['tsd.md'], nextText: 'Start a new session, then `/check-docs .work/tsd-y/tsd.md`.' }));
  const html = render();
  assert.match(html, /id="item-scope-y".*data-cmd="\/backlog scope-y ado"[^>]*>Create in ADO<.*data-cmd="\/backlog scope-y csv"[^>]*>Make an import file instead</s);
  assert.match(html, /id="item-docs-y".*aria-label="Where the doc goes".*data-run="docs-y" data-cmd="\/publish docs-y".*Save in the repo.*data-docs-folio="docs-y".*Save to Folio/s);
  assert.match(html, /id="item-tsd-y".*data-cmd="\/check-docs \.work\/tsd-y\/tsd\.md"[^>]*>Fact-check it<.*data-name="tsd\.md" data-mode="edit">Edit tsd\.md</s);
  assert.match(turnHtml(folder('docs-y', 'docs', { state: 'Fact-checked' })), /Your turn:<\/span> fix what check\.md flags, then pick where it goes\./);
  assert.match(turnHtml(folder('scope-y', 'scope', { state: 'Milestones approved' })), /Your turn:<\/span> create the items in ADO\./);
});

test('the file to read at a gate: the Inbox card opens it on Read, then Read all', () => {
  assert.equal(gateFile(item('41300-export-retry-fails')), 'bug.md');
  assert.equal(gateFile(item('41207-fix-login-timeout')), null, 'no gate, no file');
  // One feature gate (eng-agents Core 4.0.0): spec and plan are drafts together; read the spec first, send back with /spec.
  const both = { ...item('41207-fix-login-timeout'), stage: 'plan', gates: { spec: 'DRAFT', plan: 'DRAFT' }, files: ['spec.md', 'plan.md', 'tasks.md'], next: { stage: 'plan', command: '/approve 41207', needsYou: true } };
  assert.equal(gateFile(both), 'spec.md');
  assert.equal(sendBackCommand(both), '/spec 41207');
  assert.equal(sendBackCommand({ ...both, gates: { spec: 'APPROVED', plan: 'DRAFT' } }), '/plan 41207', 'an older item with the spec approved alone');
  assert.equal(gateFile(folder('scope-x', 'scope', { state: 'Milestones in review', files: ['milestones.md'] })), 'milestones.md');
  assert.equal(gateFile(folder('tsd-x', 'tsd', { state: 'Draft, fact-checked', files: ['tsd.md', 'check.md'] })), 'check.md', 'the final read: what the fact-check found');
  assert.equal(gateFile(folder('tsd-x', 'tsd', { state: 'Draft, not fact-checked', files: ['tsd.md'] })), 'tsd.md', 'the first read: the draft');
  assert.deepEqual(wantedFiles().sort(), [['41300-export-retry-fails', 'bug.md'], ['spike-cache-options', 'findings.md'], ['tsd-billing-api', 'tsd.md']], 'the Inbox asks for its gate files');
  S.files['41300-export-retry-fails/bug.md'] = { text: '# Bug\n\n' + Array.from({ length: 20 }, (_, i) => `- line ${i}`).join('\n'), at: 1 };
  let html = render();
  assert.doesNotMatch(html, /<section class="finline/, 'collapsed until you open it');
  assert.match(html, /data-peek="card:41300-export-retry-fails" aria-expanded="false">Read bug\.md</);
  S.ui.open['card:41300-export-retry-fails'] = true;
  html = render();
  assert.match(html, /<section class="finline peek" aria-label="bug\.md">.*data-peek="peek:41300-export-retry-fails\/bug\.md" aria-expanded="false">Read all</s);
  S.ui.open['peek:41300-export-retry-fails/bug.md'] = true;
  html = render();
  assert.match(html, /<section class="finline" aria-label="bug\.md">.*>Show less</s);
  assert.match(html, /data-file="41300-export-retry-fails" data-name="bug\.md" data-mode="edit">Edit</);
});

test('send back with a note: the command that redoes the draft, and the note under Open questions', () => {
  assert.equal(sendBackCommand(item('41300-export-retry-fails')), '/bug 41300');
  const spec = { ...item('41455-audit-log-filter'), paused: null };
  assert.equal(sendBackCommand(spec), '/spec 41455');
  assert.equal(sendBackCommand(item('41455-audit-log-filter')), null, 'not while paused');
  assert.equal(sendBackCommand(folder('scope-x', 'scope', { state: 'Stories in review' })), '/scope scope-x');
  assert.equal(sendBackCommand(folder('scope-x', 'scope', { state: 'Milestones in review' })), '/slice scope-x');
  assert.equal(sendBackCommand(item('41207-fix-login-timeout')), null);

  assert.equal(addOpenQuestion('# Spec\n\n## Goal\n\nX\n', 'Cover\n  retries too'), '# Spec\n\n## Goal\n\nX\n\n## Open questions\n\n- From you: Cover retries too\n', 'no section: added at the end');
  assert.equal(addOpenQuestion('# Spec\n\n## Open questions\n\n- None.\n\n## Plan\n\nY\n', 'Why 30?'), '# Spec\n\n## Open questions\n\n- From you: Why 30?\n\n## Plan\n\nY\n', '"None" goes, the next section stays');
  assert.equal(addOpenQuestion('## Open questions\n- Q1 (accepted risk)\n', 'Q2'), '## Open questions\n\n- Q1 (accepted risk)\n- From you: Q2\n', 'after the questions already there');
  assert.equal(addOpenQuestion('text', '   '), 'text', 'an empty note changes nothing');
});

test('docs: the fact-check command comes from what /docs said; without it, a path box', () => {
  const d = folder('docs-run-gateway', 'docs', { state: 'Written, not checked yet', files: ['sources.md'] });
  S.D.items.push(d);
  assert.equal(docsCheckCommand(d), null);
  assert.equal(folderCommand(d), null);
  S.L.sessions.ses_docs = { id: 'ses_docs', status: 'idle', text: 'Done. Start a new session and run `/check-docs docs/run-gateway.md` to fact-check it.' };
  S.L.items['docs-run-gateway'] = { current: 'ses_docs', sessions: [{ id: 'ses_docs' }] };
  assert.equal(docsCheckCommand(d), '/check-docs docs/run-gateway.md');
  S.ui.tab = 'inbox';
  assert.match(render(), /id="item-docs-run-gateway".*Your turn:<\/span> read the draft, then send it to the fact-check\..*data-cmd="\/check-docs docs\/run-gateway\.md"[^>]*>Looks right: fact-check it</s, 'Read draft waits on you in the Inbox');
  delete S.L.items['docs-run-gateway'];
  S.ui.run = 'docs-run-gateway';
  assert.match(render(), /data-draft="dc:docs-run-gateway".*data-docs-check="docs-run-gateway">Fact-check</s, 'its page asks for the path');
});

test('whose turn, in plain words', () => {
  assert.match(turnHtml(item('41300-export-retry-fails')), /^<span class="turnw t-you">Your turn:<\/span> Review bug\.md and tasks\.md/);
  assert.match(turnHtml(item('41207-fix-login-timeout')), /^<span class="turnw t-tandem">Tandem:<\/span>/);
  assert.match(turnHtml(item('41502-csv-export')), /^<span class="turnw t-stop">Stopped:<\/span> The date format test expects UTC\./);
  assert.match(turnHtml(item('41455-audit-log-filter')), /^<span class="turnw t-hold">Paused:<\/span> Waiting on design/);
  assert.match(turnHtml(item('spike-cache-options')), /^<span class="turnw t-you">Your turn:<\/span> read the findings, then pick what is next\. Use the in-memory cache/);
  assert.match(turnHtml(folder('spike-x', 'spike', { state: 'Closed', nextText: 'started L12 as a feature on 2026-11-16.' })), /Closed\.<\/span> started L12 as a feature/);
  assert.equal(workGroup(item('41207-fix-login-timeout')), 'working');
  assert.equal(workGroup(item('41455-audit-log-filter')), 'paused');
  assert.equal(workGroup(item('spike-cache-options')), 'next');
  assert.equal(workGroup(folder('spike-x', 'spike', { state: 'Closed' })), 'done');
});

test('Go through them: one row at a time with keys, a row you acted on leaves, and it ends on "That is everything"', () => {
  const list = walkList();
  assert.deepEqual(list.map(x => x.key), ['failed:41502-csv-export', 'gate:41300-export-retry-fails', 'gate:spike-cache-options', 'gate:tsd-billing-api', 'code:41610-rate-limit-headers'], 'most urgent first');
  S.ui.walk = { i: 1, done: {} };
  let html = render();
  assert.match(html, /<section class="walk" aria-label="Go through them" data-walk-key="gate:41300-export-retry-fails"><div class="walk-head"><span class="walk-n">2 of 5<\/span>/);
  assert.match(html, /data-walk="prev">Previous.*data-walk="next">Skip.*data-walk="stop">Done/s);
  assert.match(html, /<button data-hot="a" type="button" class="btn primary" data-auto="41300-export-retry-fails" data-act="approve-start"/, 'A presses the main button');
  assert.match(html, /data-hot="s" data-sb-toggle="41300-export-retry-fails"/);
  assert.match(html, /<kbd>A<\/kbd> approve/);
  assert.equal((html.match(/class="icard/g) || []).length, 1, 'one at a time');
  S.ui.walk.i = 2;
  assert.match(render(), /3 of 5.*aria-label="What next for this spike"/s, 'a fork shows its path cards');
  S.ui.walk.i = 4;
  assert.match(render(), /5 of 5.*data-hot="a" href="review\.html\?id=41610&amp;repo=gateway"/s);
  S.ui.walk.done = Object.fromEntries(list.map(x => [x.key, 1]));
  assert.match(render(), /That is everything\..*data-walk="stop">Back to the Inbox/s);
});

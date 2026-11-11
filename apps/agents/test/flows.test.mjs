// Dispatch 3.0 flows (js/flows.js) and the pages that use them: the presets follow eng-agents' suggested flows,
// where each kind of .work folder is in its flow, which steps stop for you, what waits in the Inbox, sending a draft
// back with a note, and Go through them. On the synthetic fixture (fixtures/state.json).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/state.js';
import { render } from '../js/view.js';
import { FLOWS, flowOf, flowTag, stepsOf, stepIndex, currentStep, atGate, isFinished, gateFile, sendBackCommand, addOpenQuestion, docsCheckCommand,
  folderCommand, turnHtml, stepLine, youCount } from '../js/flows.js';
import { inboxData, inboxCount, walkList, wantedFiles, workGroup, isStopped, inboxFolders } from '../js/pages.js';

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

test('the presets follow eng-agents: seven flows, each step named, the ones that stop for you marked', () => {
  assert.deepEqual(FLOWS.map(f => f.id), ['feature', 'bug', 'quick', 'spike', 'epic', 'docs', 'tsd']);
  const keys = id => stepsOf(FLOWS.find(f => f.id === id), 'feature').map(s => s.key + (s.you ? '*' : ''));
  assert.deepEqual(keys('feature'), ['start', 'spec*', 'plan*', 'tasks', 'build', 'review', 'pr', 'ship*'], 'README: /start, /spec, /approve, /plan, /approve, /tasks, /do-task, /review, /pr, then you push');
  assert.deepEqual(keys('bug'), ['start', 'bug*', 'build', 'review', 'pr', 'ship*']);
  assert.deepEqual(stepsOf(FLOWS.find(f => f.id === 'quick'), 'bug').map(s => s.key), keys('bug').map(k => k.replace('*', '')), 'Quick change runs as the lane you pick');
  assert.deepEqual(keys('epic'), ['scope', 'stories*', 'slice', 'milestones*', 'backlog'], '/scope, /approve, /slice, /approve milestones, /backlog');
  assert.deepEqual(keys('docs'), ['draft*', 'check', 'fix*'], '/docs, new session, /check-docs');
  assert.deepEqual(keys('tsd'), ['draft*', 'check', 'revise*', 'publish*'], '/tsd, /check-docs, revise, /publish');
  assert.equal(youCount(stepsOf(FLOWS[0])), 3);
  for (const f of FLOWS) for (const s of stepsOf(f, 'feature')) assert.ok(s.name && s.what, f.id + '.' + s.key + ' says what it does');
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
  assert.equal(stepIndex(item('41207-fix-login-timeout')), 4, 'build');
  assert.equal(stepLine(item('41207-fix-login-timeout')), 'Step 5 of 8: Build 2/3');
  assert.equal(stepIndex(item('41610-rate-limit-headers')), 5, 'a bug at Ship: the last step');
  assert.equal(currentStep(item('41300-export-retry-fails')).key, 'bug');
  const epic = st => stepIndex(folder('scope-x', 'scope', { state: st }));
  assert.deepEqual(['Scoping', 'Stories in review', 'Stories approved', 'Milestones in review', 'Milestones approved', 'Import file ready', 'Work items created'].map(epic), [0, 1, 2, 3, 4, 5, 5]);
  assert.ok(isFinished(folder('scope-x', 'scope', { state: 'Import file ready' })));
  const tsd = st => stepIndex(folder('tsd-x', 'tsd', { state: st }));
  assert.deepEqual(['In progress', 'Draft, not fact-checked', 'Draft, fact-check found 2 wrong or outdated', 'Draft, fact-checked', 'Published'].map(tsd), [0, 1, 2, 3, 4]);
  assert.equal(stepIndex(folder('docs-x', 'docs', { state: 'Written, not checked yet' })), 1);
  assert.ok(isFinished(folder('docs-x', 'docs', { state: 'Fact-checked' })));
  assert.ok(isFinished(item('spike-cache-options')), 'a spike with findings has nothing more to run');
});

test('what waits in the Inbox: work-item gates, an epic\'s two approvals, a TSD to revise or publish; not spikes or docs', () => {
  assert.ok(atGate(item('41300-export-retry-fails')));
  assert.ok(!atGate(item('41207-fix-login-timeout')));
  for (const [st, want] of [['Stories in review', true], ['Stories approved', false], ['Milestones in review', true], ['Scoping', false]]) {
    assert.equal(atGate(folder('scope-x', 'scope', { state: st })), want, st);
  }
  for (const [st, want] of [['Draft, not fact-checked', false], ['Draft, fact-check found 1 wrong or outdated', true], ['Draft, fact-checked', true], ['Published', false]]) {
    assert.equal(atGate(folder('tsd-x', 'tsd', { state: st })), want, st);
  }
  assert.ok(!atGate(item('spike-cache-options')));
  S.D.items.push(folder('scope-change-requests', 'scope', { state: 'Stories in review', title: 'Change requests', files: ['epics.md', 'stories.md'], nextText: 'Review epics.md and stories.md, then `/approve scope-change-requests`.' }));
  const d = inboxData();
  assert.deepEqual(d.gates.map(i => i.folder).sort(), ['41300-export-retry-fails', 'scope-change-requests']);
  assert.deepEqual(d.failed.map(i => i.folder), ['41502-csv-export'], 'blocked runs are Stopped, not Ready for your review');
  assert.ok(isStopped(item('41502-csv-export')));
  assert.equal(inboxCount(d), 4);
  const html = render();
  assert.match(html, /id="item-scope-change-requests".*<span class="turnw t-you">Your turn:<\/span>.*data-cmd="\/approve scope-change-requests"[^>]*>Approve<.*data-sb-toggle="scope-change-requests"[^>]*>Send back</s);
  assert.ok(inboxFolders(d).has('scope-change-requests'));
  S.ui.tab = 'work';
  assert.doesNotMatch(render(), /id="item-scope-change-requests"/, 'not on Work while it waits on you');
});

test('the file to read at a gate, shown in the Inbox card with Read all', () => {
  assert.equal(gateFile(item('41300-export-retry-fails')), 'bug.md');
  assert.equal(gateFile(item('41207-fix-login-timeout')), null, 'no gate, no file');
  assert.equal(gateFile(folder('scope-x', 'scope', { state: 'Milestones in review', files: ['milestones.md'] })), 'milestones.md');
  assert.equal(gateFile(folder('tsd-x', 'tsd', { state: 'Draft, fact-checked', files: ['tsd.md', 'check.md'] })), 'tsd.md');
  assert.equal(gateFile(folder('tsd-x', 'tsd', { state: 'Draft, fact-check found 1 wrong or outdated', files: ['tsd.md', 'check.md'] })), 'check.md');
  assert.deepEqual(wantedFiles(), [['41300-export-retry-fails', 'bug.md']], 'the Inbox asks for its gate files');
  S.files['41300-export-retry-fails/bug.md'] = { text: '# Bug\n\n' + Array.from({ length: 20 }, (_, i) => `- line ${i}`).join('\n'), at: 1 };
  let html = render();
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
  S.ui.tab = 'work';
  assert.match(render(), /id="item-docs-run-gateway".*data-cmd="\/check-docs docs\/run-gateway\.md"[^>]*>Fact-check</s);
  delete S.L.items['docs-run-gateway'];
  S.ui.run = 'docs-run-gateway';
  assert.match(render(), /data-draft="dc:docs-run-gateway".*data-docs-check="docs-run-gateway">Fact-check</s, 'its page asks for the path');
});

test('whose turn, in plain words', () => {
  assert.match(turnHtml(item('41300-export-retry-fails')), /^<span class="turnw t-you">Your turn:<\/span> Review bug\.md and tasks\.md/);
  assert.match(turnHtml(item('41207-fix-login-timeout')), /^<span class="turnw t-tandem">Tandem:<\/span>/);
  assert.match(turnHtml(item('41502-csv-export')), /^<span class="turnw t-stop">Stopped:<\/span> The date format test expects UTC\./);
  assert.match(turnHtml(item('41455-audit-log-filter')), /^<span class="turnw t-hold">Paused:<\/span> Waiting on design/);
  assert.match(turnHtml(item('spike-cache-options')), /Findings are ready\./);
  assert.equal(workGroup(item('41207-fix-login-timeout')), 'working');
  assert.equal(workGroup(item('41455-audit-log-filter')), 'paused');
  assert.equal(workGroup(item('spike-cache-options')), 'done');
});

test('Go through them: one row at a time with keys, a row you acted on leaves, and it ends on "That is everything"', () => {
  const list = walkList();
  assert.deepEqual(list.map(x => x.key), ['gate:41300-export-retry-fails', 'code:41610-rate-limit-headers', 'failed:41502-csv-export']);
  S.ui.walk = { i: 0, done: {} };
  let html = render();
  assert.match(html, /<section class="walk" aria-label="Go through them" data-walk-key="gate:41300-export-retry-fails"><div class="walk-head"><span class="walk-n">1 of 3<\/span>/);
  assert.match(html, /data-walk="prev" disabled>Previous.*data-walk="next">Skip.*data-walk="stop">Done/s);
  assert.match(html, /<button data-hot="a" type="button" class="btn primary" data-auto="41300-export-retry-fails" data-act="approve-start"/, 'A presses the main button');
  assert.match(html, /data-hot="s" data-sb-toggle="41300-export-retry-fails"/);
  assert.match(html, /<kbd>A<\/kbd> approve/);
  assert.equal((html.match(/class="icard/g) || []).length, 1, 'one at a time');
  assert.deepEqual(wantedFiles(), [['41300-export-retry-fails', 'bug.md']]);
  S.ui.walk.i = 1;
  assert.match(render(), /2 of 3.*data-hot="a" href="review\.html\?id=41610&amp;repo=gateway"/s);
  S.ui.walk.done = { 'gate:41300-export-retry-fails': 1, 'code:41610-rate-limit-headers': 1, 'failed:41502-csv-export': 1 };
  assert.match(render(), /That is everything\..*data-walk="stop">Back to the Inbox/s);
});

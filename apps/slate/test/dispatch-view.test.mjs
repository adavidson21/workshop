// Agents view: the page-only parity items from connectors/opencode/PARITY.md (marked WS6), on a state the
// opencode connector returned for docs/examples/work (fixtures/state.json, synthetic). Each test names the
// changelog item it covers. The browser checks (clicks, theme, #/agents/<id>) are in tests/e2e.py.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/dispatch/state.js';
import { render, briefHtml, briefOpen, guideDefaults, track, nextHtml, autoHtml, itemCard, pickupHtml, removeSheetHtml, setupHtml, prompts, pill, liveNote, removeKey, cfgBuild, startCheck, startRequest, repoUrlCheck, repoCategories, repoCategoryCheck, NEW_CATEGORY, onboardSteps, aiState, looseSessions } from '../js/dispatch/view.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));

function load(state = FIXTURE) {
  S.D = clone(state);
  S.L = S.D.liveMode.live;
  S.conn = 'on';
  S.connector = { state: 'ready', message: null };
  S.mode = 'local';
  S.embedded = true;
  S.canNotify = false;
  S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20';
  S.copyStore = [];
  resetUi();
}
const item = folder => S.D.items.find(i => i.folder === folder);
const count = (html, re) => (html.match(re) || []).length;

beforeEach(() => load());

test('Loom 4.0 the page is a header with five tabs; every folder is in one place: the Inbox, Work or Reviews', () => {
  const html = render();
  assert.match(html, /<nav class="tabs" aria-label="Loom">/);
  assert.deepEqual([...html.matchAll(/class="tab[^"]*" data-tab="(\w+)"/g)].map(m => m[1]), ['inbox', 'board', 'health', 'chat', 'reviews']);
  assert.match(html, /class="tab on" data-tab="inbox" aria-current="page"/, 'Inbox is the default tab');
  assert.match(html, /class="pill on"[^>]*><span class="led"><\/span>Live/);
  assert.doesNotMatch(html, /class="side|<aside|Repos with work in progress|Recent activity/, 'no sidebar and no side column');
  for (const it of S.D.items) {
    const tabs = ['inbox', 'work', 'reviews'].filter(t => { S.ui.tab = t; return new RegExp(`id="item-${it.id || it.folder}"`).test(render()); });
    assert.equal(tabs.length, 1, it.folder + ' is in exactly one place: ' + tabs.join(', '));
  }
});
test('1.2.0 clearer track: checked, current and faint stages', () => {
  const t = track(item('41207-fix-login-timeout')); // feature at build, 2 of 3 tasks
  assert.equal(count(t, /class="stop done"/g), 4, 'start, spec, plan, tasks are checked');
  assert.match(t, /class="stop here"[^>]*><span class="dot"><\/span><span class="name">Build<\/span><span class="sub">Working<\/span>/, 'build is current; its session is busy');
  assert.equal(count(t, /class="stop "/g), 2, 'review and PR are faint');
  const ship = track(item('41610-rate-limit-headers'));
  assert.match(ship, /class="stop here"[^>]*>.*?<span class="name">PR<\/span><span class="sub">Ready to open<\/span>/);
  assert.match(t, /aria-label="Stage 5 of 7: Build, Working"/);
});

test('1.4.0 one main button per step, command in the tooltip, plain words', () => {
  const blocked = nextHtml(item('41502-csv-export'), false);
  assert.equal(count(blocked, /class="btn primary"/g), 1, 'one main button');
  // 41300 waits for bug.md approval: Approve and build is the main button, Approve only is secondary.
  const gate = nextHtml(item('41300-export-retry-fails'), true);
  assert.match(gate, /class="btn primary" data-auto="41300-export-retry-fails" data-act="approve-start"[^>]*>Approve and build</);
  assert.match(gate, /class="btn" data-run="41300-export-retry-fails" data-cmd="\/approve 41300"[^>]*title="Runs \/approve 41300 in opencode[^"]*"[^>]*>Approve only</);
  assert.match(gate, /data-file="41300-export-retry-fails" data-name="bug.md">Open bug.md</, 'the file to read opens in the app');
  const words = nextHtml(item('41207-fix-login-timeout'), false);
  assert.match(words, /<span class="act">Task 3: Use the setting on the renewal page<\/span>/, 'the step in plain words, not the command');
  assert.doesNotMatch(words, /<code>\/do-task/, 'the command is not in the text');
  assert.match(words, /data-cmd="\/do-task 41207 3"/);
});

test('1.4.0 no terminal hints: "start a new session" advice is dropped', () => {
  assert.equal(liveNote('Start a new session (/new) first.'), '');
  assert.equal(liveNote('Start a new session, then /plan 41207.'), 'Run /plan 41207.');
  assert.doesNotMatch(itemCard(item('41207-fix-login-timeout'), false), /Start a new session|After a restart, paste/);
});

test('1.4.0 the autopilot box shows only while autopilot runs or waits for you', () => {
  const it = item('41207-fix-login-timeout');
  assert.equal(autoHtml(it), '');
  S.L.autopilot[it.folder] = { status: 'running', command: '/do-task 41207 3 auto', log: [{ at: '2026-10-21T11:00:00Z', text: 'Started' }] };
  assert.match(autoHtml(it), /class="auto run".*Task 3: Use the setting.*>Stop after this step</s);
  assert.doesNotMatch(nextHtml(it, false), /data-run=/, 'no Run button while autopilot runs');
  S.L.autopilot[it.folder] = { status: 'waiting', message: 'Review found a **Blocker**.' };
  assert.match(autoHtml(it), /Autopilot needs you.*data-act="resume".*<strong>Blocker<\/strong>/s);
  S.L.autopilot[it.folder] = { status: 'done' };
  assert.equal(autoHtml(it), '');
});

test('3.0 Work: rows grouped Tandem working, Up next, Shipping, Paused and Done, with the flow, the step and whose turn', () => {
  S.ui.tab = 'work';
  const html = render();
  assert.match(html, /<div class="inbox-prs waiting"><span><b>3 things are waiting on you<\/b> in the Inbox\.<\/span><button type="button" class="btn primary" data-tab="inbox">Open Inbox/);
  assert.match(html, /<h3 id="gh-working">Tandem working <span class="n">1<\/span>/, '41207 has a busy session');
  assert.match(html, /<h3 id="gh-paused">Paused <span class="n">1<\/span>/);
  assert.match(html, /<article class="rrow" id="item-41207"[^>]*><span class="sd running"[^>]*><\/span><button type="button" class="rr-t" data-open-run="41207-fix-login-timeout"><span class="num">#41207<\/span>/);
  assert.match(html, /<span class="tag">Feature<\/span> · Step 5 of 8: Build 2\/3/);
  assert.match(html, /<span class="turnw t-tandem">Tandem:<\/span>/);
  assert.match(html, /<span class="turnw t-hold">Paused:<\/span> Waiting on design/);
  assert.doesNotMatch(html, /id="item-41300"|id="item-41502"|id="item-41610"/, 'what waits on you is only in the Inbox');
  assert.match(html, /class="filters" role="group" aria-label="Flow"><button type="button" class="fchip on" data-filter-flow="all"/);
  S.ui.flow = 'spike';
  assert.doesNotMatch(render(), /id="item-41207"/, 'the flow filter narrows the rows');
  assert.match(render(), /id="item-spike-cache-options"/);
  assert.match(html, /<h3 id="gh-next">Up next <span class="n">1<\/span>.*id="item-tsd-billing-api".*Step 2 of 4: Fact-check.*data-cmd="\/check-docs \.work\/tsd-billing-api\/tsd\.md"[^>]*>Fact-check</s);
  assert.match(html, /id="item-41207".*?<span class="rr-act"><\/span>/s, 'no buttons while Tandem works on it: its page has Stop');
});
test('3.0 a run opens its own page: the flow track is its navigation, the step shows its file and buttons, details folded', () => {
  S.ui.tab = 'work'; S.ui.run = '41207-fix-login-timeout';
  let html = render();
  assert.match(html, /data-close-run="board">&larr; Board</);
  assert.match(html, /<article class="item run-page" id="item-41207"/);
  assert.deepEqual([...html.matchAll(/data-step="(\w+)"/g)].map(m => m[1]), ['start', 'spec', 'plan', 'tasks', 'build', 'review', 'pr', 'ship']);
  assert.match(html, /<ol class="flow" aria-label="Step 5 of 8: Build, Working">/);
  assert.match(html, /<li class="fstep done you"><button type="button" data-step="spec" aria-pressed="false"/, 'a ring on the steps that stop for you');
  assert.match(html, /<li class="fstep here sel"><button type="button" data-step="build" aria-pressed="true"/, 'the step it is at is in view');
  assert.match(html, /<section class="spanel here" aria-label="Build">.*Tasks <span class="bar"/s);
  assert.match(html, /<details class="run-details" data-key="det:41207-fix-login-timeout"><summary>Repos, files and activity<\/summary>.*<th>Repo<\/th>.*<ul class="timeline">/s);
  assert.doesNotMatch(html, /data-run-tab=/, 'no sub-tabs');
  // A done step shows what it wrote, read through file.read.
  S.ui.step['41207-fix-login-timeout'] = 'spec';
  html = render();
  assert.match(html, /<section class="spanel done" aria-label="Spec">.*<span class="mono">spec\.md<\/span>.*Loading\./s);
  S.files['41207-fix-login-timeout/spec.md'] = { text: '# Spec\n\nRenewal lasts **30 minutes**.', at: 1 };
  assert.match(render(), /Renewal lasts <strong>30 minutes<\/strong>/);
  S.ui.step['41207-fix-login-timeout'] = 'review';
  assert.match(render(), /<section class="spanel later" aria-label="Review">.*Tandem runs this step\. It has not started\./s);
  S.files = {};
  // A run at a gate, opened from the Inbox: the gate file inline, its buttons, Send back with a note.
  S.ui.tab = 'inbox'; S.ui.back = 'inbox'; S.ui.run = '41300-export-retry-fails';
  html = render();
  assert.match(html, /data-close-run="inbox">&larr; Inbox</);
  assert.match(html, /<section class="spanel here" aria-label="Root cause">/);
  assert.match(html, /data-act="approve-start"[^>]*>Approve and build</);
  assert.match(html, /<span class="mono">bug\.md<\/span>/);
  assert.match(html, /data-sb-toggle="41300-export-retry-fails" aria-expanded="false">Send back with a note</);
  S.ui.open['sb:41300-export-retry-fails'] = true;
  assert.match(render(), /<textarea rows="3" data-draft="sb:41300-export-retry-fails".*data-sendback="41300-export-retry-fails"[^>]*>Send back to Tandem<.*Runs <code>\/bug 41300<\/code>/s);
  assert.match(pickupHtml(item('41300-export-retry-fails')), /class="btn remove" data-remove="41300-export-retry-fails"[^>]*>Abandon</);
});
test('1.2.0 the remove dialog lists work still in the repos and the commands to delete branches', () => {
  const it = item('41207-fix-login-timeout');
  it.repos[0].git = { exists: true, isGit: true, branch: it.repos[0].branch, changed: 2, ahead: 1, upstream: 'origin/x', defaultBranch: 'main' };
  S.ui.remove = it.folder;
  const sheet = removeSheetHtml();
  assert.match(sheet, /permanently deletes <code>\.work\/41207-fix-login-timeout<\/code>/);
  assert.match(sheet, /auth-lib: 2 uncommitted files on dev\/feature\/41207-fix-login-timeout/);
  assert.match(sheet, /auth-lib: 1 commit not pushed/);
  assert.match(sheet, /git -C auth-lib switch main/);
  assert.match(sheet, /git -C web-app branch -D dev\/feature\/41207-fix-login-timeout/);
  assert.match(sheet, /Type <code>41207<\/code> to confirm/);
  assert.match(sheet, /data-remove-go="41207-fix-login-timeout" data-confirm="41207" disabled/, 'disabled until the id is typed');
  S.ui.drafts['rm:' + it.folder] = '41207';
  assert.doesNotMatch(removeSheetHtml(), /data-confirm="41207" disabled/);
  assert.equal(removeKey(item('spike-cache-options')), 'spike-cache-options', 'spikes confirm with the folder name');
});

test('1.2.0 PR cards: copy buttons, Create PR in ADO, and Review (not Push) when a branch is not pushed', () => {
  const it = item('41610-rate-limit-headers');
  const card = itemCard(it, false);
  assert.match(card, /<span class="flag warn">Not pushed yet<\/span>/);
  assert.match(card, /Review before you push:<\/span><a class="btn primary" href="review.html\?id=41610&amp;repo=gateway" data-review/);
  assert.doesNotMatch(card, /data-push|git -C gateway push/, 'connected, nothing pushes before Approve');
  const titleIdx = S.copyStore.indexOf(it.pr[0].title);
  assert.ok(titleIdx >= 0 && new RegExp(`data-copy="${titleIdx}"[^>]*>Copy title<`).test(card), 'Copy title');
  assert.match(card, />Copy description</);
  it.pr[0].links = { pr: 'https://ado.example.com/coll/proj/_git/gateway/pullrequestcreate?sourceRef=x' };
  assert.match(itemCard(it, false), /<a class="btn" href="https:\/\/ado\.example\.com\/coll\/proj\/_git\/gateway\/pullrequestcreate\?sourceRef=x" target="_blank" rel="noopener"[^>]*>Create PR in ADO<\/a>/);
  S.D.reviews = { [it.folder]: { gateway: { status: 'revising', revision: 1, started: true, run: { status: 'running' } } } };
  assert.match(itemCard(it, false), /The agent is revising<\/span><a class="btn" href="review.html\?id=41610&amp;repo=gateway" data-review>Open review/);
  S.D.reviews[it.folder].gateway = { status: 'revising', revision: 2, started: true, run: { status: 'failed' } };
  assert.match(itemCard(it, false), /flag bad">The revision needs you/);
  S.D.reviews[it.folder].gateway = { status: 'awaiting_review', revision: 2, started: true, run: null };
  assert.match(itemCard(it, false), /Review before you push \(revision 2\):/);
  S.D.reviews[it.folder].gateway = { status: 'approved', revision: 2, started: true, run: null };
  assert.match(itemCard(it, false), /Approved \(revision 2\)\. Push from the review\./);
  delete S.D.reviews;
  S.conn = 'off';
  assert.match(itemCard(it, false), /Push first:.*?>Copy</s, 'without a connection, the command can still be copied');
});

test('the agent panel: state, Stop, the terminal command, reply, and earlier sessions', () => {
  const it = item('41207-fix-login-timeout');
  const card = itemCard(it, false);
  assert.match(card, /class="agent busy".*<span class="spin"[^>]*><\/span>Working.*\/plan 41207.*data-abort="ses_0001abc"/s);
  assert.match(card, />Copy terminal command</);
  assert.doesNotMatch(card, /data-term=/, 'no Open in terminal where the connector cannot open one');
  S.L.canOpenTerminal = true;
  S.L.sessions.ses_0001abc.status = 'idle';
  S.L.sessions.ses_0001abc.text = 'Plan written.';
  S.L.items[it.folder].sessions.unshift({ id: 'ses_old', command: '/spec 41207', title: '41207: /spec 41207' });
  const idle = itemCard(it, false);
  assert.match(idle, /data-term="ses_0001abc"/);
  assert.match(idle, /Agent said<\/p><pre class="say">Plan written\.<\/pre>/);
  assert.match(idle, /<textarea data-draft="r:ses_0001abc" data-sid="ses_0001abc"/);
  assert.match(idle, /Earlier sessions for this item \(1\)/);
});

test('2.0 Inbox: every prompt answerable in place with where it came from, then runs and code reviews waiting on you', () => {
  S.L.permissions.push({ id: 'per_1', sessionID: 'ses_0001abc', permission: 'bash', title: 'git push', folder: '41207-fix-login-timeout' });
  S.L.permissions.push({ id: 'per_2', sessionID: 'ses_tui', permission: 'edit', title: 'README.md', folder: null });
  S.L.questions.push({ id: 'que_1', sessionID: 'ses_0001abc', folder: '41207-fix-login-timeout', questions: [{ header: 'Branch', question: 'Which branch?', options: [{ label: 'main' }, { label: 'dev', description: 'the dev branch' }] }] });
  const html = render();
  assert.match(html, /<h3 id="gh-asks">Agents asking you <span class="n">3<\/span>/);
  assert.match(html, /<span class="tag">Feature<\/span><span class="st">#41207 Fix login timeout on renewal<\/span><button type="button" class="lnk plain" data-hot="o" data-open-run="41207-fix-login-timeout">Open<\/button>/);
  assert.match(html, /data-perm="per_2" data-answer="once"/);
  assert.match(html, /<span class="tag">Conversation<\/span>.*data-open-chat="ses_tui"/s);
  assert.match(html, /<input type="radio" name="que_1-0" value="dev" data-qpick="que_1" data-qi="0">.*the dev branch/s);
  assert.match(html, /data-qsend="que_1">Answer</);
  assert.match(html, /<h3 id="gh-gates">Ready for your review <span class="n">1<\/span>/, '41300 waits for bug.md');
  assert.match(html, /<h3 id="gh-code">Code reviews to do <span class="n">1<\/span>/);
  assert.match(html, /<h3 id="gh-failed">Stopped or blocked <span class="n">1<\/span>/, '41502 is blocked');
  assert.match(html, /data-tab="inbox" aria-current="page"><span>Inbox<\/span><span class="cnt gate">6<\/span>/);
  assert.match(html, /<b>6 things need you\.<\/b>.*data-walk="start"[^>]*>Go through them</s);
  assert.deepEqual(prompts().map(p => p.id), ['per_1', 'per_2', 'que_1']);
});

test('2.0 Inbox with nothing waiting: says so and offers Pick up here', () => {
  for (const it of S.D.items) { if (it.bucket === 'needs') it.bucket = 'active'; delete it.blocked; }
  S.D.items = S.D.items.filter(it => it.stage !== 'ship');
  const html = render();
  assert.match(html, /Nothing needs you right now/);
  assert.match(html, /<section class="pickup" id="item-/);
  assert.doesNotMatch(html, /class="cnt gate">/);
});
test('.work files open in the app through file.read, not as links', () => {
  const card = itemCard(item('41207-fix-login-timeout'), false);
  assert.match(card, /<button type="button" class="lnk" data-file="41207-fix-login-timeout" data-name="plan.md">plan.md<\/button>/);
  assert.doesNotMatch(card, /href="files\//);
  S.ui.file = { folder: '41207-fix-login-timeout', name: 'plan.md', text: '# Plan <b>x</b>', error: null };
  const html = render();
  assert.match(html, /<div class="doc"><h2>Plan &lt;b&gt;x&lt;\/b&gt;<\/h2><\/div>/, 'preview, escaped');
  assert.match(html, /data-file-mode="edit"/);
  // Edit mode: a textarea holding the text; Save stays off until it changes.
  S.ui.file.mode = 'edit';
  const busy = render();
  if (/data-file-mode="edit" disabled/.test(busy)) assert.doesNotMatch(busy, /<textarea class="doc-edit"/, 'locked while Tandem works: preview only');
  S.ui.file = { folder: 'spike-cache-options', name: 'findings.md', text: '# F', error: null, mode: 'edit' };
  const ed = render();
  assert.match(ed, /<textarea class="doc-edit" data-draft="file:spike-cache-options\/findings.md"[^>]*># F<\/textarea>/);
  assert.match(ed, /data-file-save="1" disabled/);
  S.ui.drafts['file:spike-cache-options/findings.md'] = '# F\n\nMore';
  assert.match(render(), /data-file-save="1">Save/);
  assert.match(render(), /Unsaved changes/);
  S.hasNotes = true;
  assert.match(render(), /data-open-notebook="1"/);
  delete S.ui.drafts['file:spike-cache-options/findings.md'];
  S.hasNotes = false; S.ui.file = null;
});

test('text from .work and opencode is escaped, and only http(s) links are links', () => {
  const it = item('41207-fix-login-timeout');
  it.title = '<img src=x onerror=alert(1)>';
  it.url = 'javascript:alert(1)';
  it.repos[0].links = { branch: 'javascript:alert(2)', pr: 'https://ado.example.com/_git/x' };
  it.repos[0].git = { exists: true, isGit: true, branch: 'x' };
  S.L.sessions.ses_0001abc.activity = '"><script>alert(3)</script>';
  const card = itemCard(it, false);
  assert.doesNotMatch(card, /<img src=x|<script>|javascript:/);
  assert.match(card, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(card, /href="https:\/\/ado\.example\.com\/_git\/x"/);
});

test('header: Live only when Workshop and opencode are both connected', () => {
  assert.deepEqual(pill(), ['on', 'Live']);
  S.L.opencode.connected = false;
  assert.deepEqual(pill(), ['off', 'opencode not connected']);
  S.conn = 'off';
  assert.deepEqual(pill(), ['off', 'Workshop not reachable']);
  assert.match(render(), /Workshop is not answering\. Start it with/);
});

test('in the shell, the shell owns the name and theme; on its own, the page has its name (the top bar has the toggle)', () => {
  assert.doesNotMatch(render(), /class="brand"|data-theme-menu/);
  S.embedded = false;
  S.version = '1.0.0';
  assert.match(render(), /<h1>Loom<\/h1><span class="ver">v1\.0\.0<\/span>/);
  assert.doesNotMatch(render(), /data-theme-menu/);
});

test('before the connector is ready, the page says what is wrong and how to fix it', () => {
  S.mode = 'browser'; S.connector = null; S.D = null;
  assert.match(render(), /Connect Loom to your computer/, 'browser mode shows the setup guide');
  S.mode = 'local'; S.connector = { state: 'disabled', message: null };
  assert.match(setupHtml(), /Turn on the opencode connector.*data-cfg-open="1">Open opencode settings/s, 'local: the settings sheet can turn it on');
  S.connector = { state: 'error', message: 'No PowerShell found. Install `pwsh`.' };
  assert.match(setupHtml(), /can't start.*No PowerShell found\. Install <code>pwsh<\/code>\./s);
  S.mode = 'hosted';
  assert.match(setupHtml(), /data-cfg-open="1"/, 'hosted: settings are fixed here too');
  S.connector = { state: 'disabled', message: null };
  assert.doesNotMatch(setupHtml(), /data-cfg-open/, 'a hosted page cannot turn the connector on');
  S.agentUrl = 'http://127.0.0.1:4380';
  assert.match(setupHtml(), /href="http:\/\/127\.0\.0\.1:4380\/#\/settings"[^>]*>Open Settings in Workshop/, 'paired: a link to Settings on this computer');
  S.agentUrl = null;
  S.connector = { state: 'missing', message: null };
  assert.match(setupHtml(), /Loom is not set up on this computer/);
  assert.doesNotMatch(setupHtml(), /connectors\/opencode/, 'no folder names for someone new');
});

test('an empty .work says how to start', () => {
  const empty = clone(FIXTURE);
  empty.items = []; empty.activity = [];
  empty.liveMode.live.opencode.ai = { known: true, providers: ['Anthropic'] };
  load(empty);
  let html = render();
  assert.match(html, /Getting set up, 2 of 3 done.*class="gstep open">.*Start your first piece of work.*data-start-open="1">Start work/s, 'the checklist leads to the first piece of work');
  assert.match(html, /AI connected: Anthropic/);
  S.L.opencode.ai = { known: false, providers: [] };
  S.D.repos = [];
  html = render();
  assert.match(html, /class="gstep open">.*Add a repo.*data-repo-open="1"/s, 'no repos: adding one is next');
  S.ui.tab = 'work';
  assert.match(render(), /No work yet.*data-start-open="1">Start work/s);
});
test('the setup guide is one install command, then connect', () => {
  S.mode = 'browser'; S.connector = null; S.D = null; S.origin = 'https://dispatch.example.org';
  S.setup = guideDefaults();
  let html = render();
  assert.equal(count(html, /<li class="gstep/g), 2, 'two steps');
  assert.match(html, /Set up, 0 of 2 done/);
  assert.match(html, /class="gstep open">.*Install Tandem and Workshop/s, 'the first step is open');
  assert.match(html, /<code>irm https:\/\/dispatch\.example\.org\/install\.ps1 \| iex<\/code>/, 'Windows command by default, for this site');
  assert.doesNotMatch(html, /git clone|onboarding-/, 'no manual steps');
  assert.match(html, /data-gcheck/);
  S.setup = { ...guideDefaults(), os: 'mac', port: 4555 };
  html = render();
  assert.match(html, /<code>curl -fsSL https:\/\/dispatch\.example\.org\/install\.sh \| bash<\/code>/, 'Mac or Linux command');
  assert.match(html, /value="4555"/);
  S.setup = { ...guideDefaults(), done: { install: true } };
  html = render();
  assert.match(html, /Set up, 1 of 2 done/);
  assert.match(html, /class="gstep open">.*data-gpair>Connect to Workshop/s, 'the next step opens');
  assert.match(html, /workshop open/);
  S.setup = { ...guideDefaults(), open: 'tandem' };
  assert.match(render(), /class="gstep open">.*Install Tandem and Workshop/s, 'an old saved step falls back to the first open one');
  S.wasPaired = true;
  assert.match(render(), /was connected to Workshop before/);
  S.wasPaired = false;
});

test('opencode settings: a form from the connector schema; hosted pages edit only marked fields', () => {
  const schema = {
    type: 'object', required: ['workspace'],
    properties: {
      workspace: { type: 'string', title: 'Workspace folder', 'x-workshop-hosted': true },
      opencode: { type: 'object', title: 'opencode', properties: {
        command: { type: 'string', title: 'Command that runs opencode', default: 'opencode' },
        startServer: { type: 'boolean', title: 'Start opencode if it is not running', default: true, 'x-workshop-hosted': true },
        passwordEnv: { type: 'string', title: 'Password variable', 'x-workshop-env': true }
      } },
      pollSeconds: { type: 'integer', title: 'Re-read every (seconds)', minimum: 5, maximum: 3600, 'x-workshop-hosted': true }
    }
  };
  const view = { id: 'opencode', schema, config: { workspace: '~/work', opencode: { command: 'opencode', startServer: true, passwordEnv: 'OC_PW' }, pollSeconds: 20 }, env: { OC_PW: { set: false } } };
  S.mode = 'hosted'; S.agentUrl = 'http://127.0.0.1:4380';
  S.ui.settings = { view, error: null, saving: false, enabled: true };
  let html = render();
  assert.match(html, /<h3 id="cfg-h">opencode settings<\/h3>/);
  assert.match(html, /data-cfg="workspace" data-draft="cfg:workspace" value="~\/work"(?! disabled)/, 'workspace is editable from a hosted page');
  assert.match(html, /data-cfg="opencode\.command"[^>]* disabled/, 'the command is not');
  assert.match(html, /data-cfg="opencode\.startServer" checked>/, 'a marked checkbox is editable');
  assert.match(html, /Not set on this computer/, 'env variables say whether they are set, never their value');
  assert.match(html, /href="http:\/\/127\.0\.0\.1:4380\/#\/settings"/, 'greyed out fields link to Workshop');
  assert.doesNotMatch(html, /data-cfg-enabled/, 'a hosted page cannot turn the connector on or off');
  S.mode = 'local';
  html = render();
  assert.doesNotMatch(html, /data-cfg="opencode\.command"[^>]* disabled/, 'everything is editable locally');
  assert.match(html, /data-cfg-enabled="1" checked/);

  S.ui.drafts['cfg:workspace'] = ' ~/code ';
  S.ui.drafts['cfg:opencode.startServer'] = false;
  S.ui.drafts['cfg:pollSeconds'] = '45';
  assert.deepEqual(cfgBuild(), { config: { workspace: '~/code', opencode: { command: 'opencode', startServer: false, passwordEnv: 'OC_PW' }, pollSeconds: 45 } });
  S.ui.drafts['cfg:opencode.command'] = '';
  assert.equal(cfgBuild().config.opencode.command, undefined, 'an emptied optional field goes back to its default');
  S.ui.drafts['cfg:pollSeconds'] = '2';
  assert.match(cfgBuild().error, /from 5 to 3600/);
  S.ui.drafts['cfg:pollSeconds'] = '45';
  S.ui.drafts['cfg:workspace'] = '  ';
  assert.match(cfgBuild().error, /Workspace folder is needed/);
  S.agentUrl = null;
});

test('3.0 start work: pick a flow, then fill it in; each flow sends its own action', () => {
  load(clone(FIXTURE));
  let html = render();
  assert.match(html, /<header class="top">.*data-start-open="1"[^>]*>Start work/s, 'the header has the button');
  S.ui.start = { flow: null, lane: 'feature', busy: false, error: null };
  S.L.opencode = { ...(S.L.opencode || {}), connected: true };
  html = render();
  assert.match(html, /<h3 id="start-h">Start work<\/h3>/);
  assert.deepEqual([...html.matchAll(/class="fcard" data-flow="(\w+)"/g)].map(m => m[1]), ['feature', 'bug', 'quick', 'spike', 'epic', 'docs', 'tsd']);
  assert.match(html, /data-flow="feature".*8 steps, 3 stops for you.*Hands-off after you approve/s);
  assert.match(html, /data-flow="spike"[^>]*>.*2 steps, 1 stop for you/s);
  // Feature: no ADO set up, so it is described.
  S.ui.start.flow = 'feature';
  html = render();
  assert.match(html, /<h3 id="start-h">Build a feature<\/h3>.*data-flow="">&larr; All flows/s);
  assert.match(html, /<ol class="fline"><li class="">Set up<\/li><li class="you">Spec<\/li>/);
  assert.doesNotMatch(html, /data-start-src/, 'no ADO choice when Tandem has no ADO set up');
  assert.match(html, /data-draft="start:title"/);
  assert.doesNotMatch(html, /start:repro|data-start-lane/, 'no repro steps and no lane pick for a feature');
  S.ui.start.flow = 'bug';
  assert.match(render(), /data-draft="start:repro"/);
  S.ui.start.flow = 'quick';
  assert.match(render(), /data-start-lane="feature" aria-pressed="true"/, 'Quick change picks the lane');
  S.D.tandem = { ado: true };
  S.ui.start.flow = 'feature';
  html = render();
  assert.match(html, /data-start-src="ado" aria-pressed="true".*Work item number/s, 'ADO first when it is set up');
  S.ui.start.src = 'describe';
  assert.match(render(), /data-start-src="describe" aria-pressed="true".*data-draft="start:title"/s);
  S.ui.start.flow = 'spike';
  assert.match(render(), /data-draft="start:topic".*data-start-go="1">Investigate</s);
  S.ui.start.flow = 'epic';
  assert.match(render(), /data-draft="start:idea"/);
  S.ui.start.flow = 'docs';
  assert.match(render(), /data-draft="start:target"/);
  S.ui.start.flow = 'tsd';
  assert.match(render(), /Product or repos.*data-draft="start:target"/s);
  S.L.opencode.connected = false;
  assert.match(render(), /opencode is not connected.*data-start-go="1" disabled/s, 'no start without opencode');

  const req = (st, drafts) => startRequest({ lane: 'feature', ...st }, drafts);
  assert.match(req({ flow: null }, {}).error, /Pick a flow/);
  assert.deepEqual(req({ flow: 'quick' }, { 'start:title': '  Add  CSV export ', 'start:desc': 'For the reports page.' }), { action: 'start.local', args: { title: 'Add CSV export', lane: 'feature', description: 'For the reports page.' } });
  assert.deepEqual(req({ flow: 'quick', lane: 'bug' }, { 'start:title': 'Export fails', 'start:repro': '1. Export twice' }), { action: 'start.local', args: { title: 'Export fails', lane: 'bug', repro: '1. Export twice' } });
  assert.deepEqual(req({ flow: 'bug', src: 'describe' }, { 'start:title': 'Export fails' }), { action: 'start.local', args: { title: 'Export fails', lane: 'bug' } }, 'the flow sets the lane');
  assert.match(req({ flow: 'quick' }, {}).error, /title/);
  assert.deepEqual(req({ flow: 'feature', src: 'ado' }, { 'start:id': '#9988776' }), { action: 'start', args: { id: '9988776', lane: 'feature' } });
  assert.deepEqual(req({ flow: 'bug', src: 'ado' }, { 'start:id': '9988776' }), { action: 'start', args: { id: '9988776', lane: 'bug' } });
  assert.deepEqual(req({ flow: 'spike' }, { 'start:topic': 'How does\nlogin work?' }), { action: 'spike', args: { topic: 'How does login work?' } });
  assert.match(req({ flow: 'spike' }, {}).error, /investigate/);
  assert.deepEqual(req({ flow: 'epic' }, { 'start:idea': 'Change request tickets' }), { action: 'scope.start', args: { idea: 'Change request tickets' } });
  assert.deepEqual(req({ flow: 'docs' }, { 'start:target': 'How to run\nthe gateway' }), { action: 'docs.start', args: { target: 'How to run the gateway' } });
  assert.deepEqual(req({ flow: 'tsd' }, { 'start:target': 'Billing  gateway' }), { action: 'tsd.start', args: { target: 'Billing gateway' } });
  assert.match(req({ flow: 'tsd' }, { 'start:target': 'a;b' }).error, /product name/);
  assert.deepEqual(req({ mode: 'describe' }, { 'start:title': 'Old' }), { action: 'start.local', args: { title: 'Old', lane: 'feature' } }, "Dispatch 2.x's modes still work");

  assert.deepEqual(startCheck(' #9988776 ', 'bug'), { id: '9988776', lane: 'bug' });
  assert.match(startCheck('abc', 'feature').error, /work item number/);
  assert.match(startCheck('1', 'other').error, /Feature or Bug/);
  const taken = (S.D.items || []).find(it => /^\d+$/.test(String(it.id)));
  if (taken) assert.match(startCheck(String(taken.id), 'feature').error, /already started/);
});

test('add a repo: a clone URL, then an offer to draft its guide', () => {
  load(clone(FIXTURE));
  S.ui.menu = { kind: 'more', top: 0, right: 0 };
  assert.match(render(), /<div class="sep"><\/div><button type="button" role="menuitem" data-repos-open="1">Repos</, 'the menu has Repos (and Projects when the connector has them)');
  S.ui.menu = null; S.ui.repos = true;
  assert.match(render(), /<h3 id="repos-h">Repos with work in progress.*data-repo-open="1">Add a repo.*data-guide="gateway">Draft guide/s, 'the Repos sheet can add a repo and draft guides');
  S.ui.repos = false; S.ui.repo = { busy: false, error: null, added: null };
  assert.match(render(), /<h3 id="repo-h">Add a repo<\/h3>.*data-draft="repo:url".*data-repo-go="1">Add repo/s);
  S.ui.repo.added = { folder: 'web-app', repoMap: 'created' };
  assert.match(render(), /Repo added.*started a repo map.*data-guide="web-app">Draft its guide/s);
  assert.deepEqual(repoUrlCheck(' https://github.com/owner/repo.git '), { url: 'https://github.com/owner/repo.git' });
  assert.deepEqual(repoUrlCheck('git@github.com:owner/repo.git'), { url: 'git@github.com:owner/repo.git' });
  assert.match(repoUrlCheck('owner/repo').error, /git URL/);
  assert.match(repoUrlCheck('').error, /clone URL/);
});
test('add a repo: a category picker with the workspace folders, top of the workspace, or a new one', () => {
  load(clone(FIXTURE));
  S.D.repoCategories = ['Tools', 'Platform'];
  S.D.repos = (S.D.repos || []).concat([{ folder: 'Billing/invoices', git: {} }, { folder: 'Tools/Lighthouse Edge/ui', git: {} }]);
  assert.deepEqual(repoCategories(), ['Billing', 'Platform', 'Tools', 'Tools/Lighthouse Edge'], 'parser categories plus every parent folder in repo names, sorted');
  S.ui.repo = { busy: false, error: null, added: null };
  let html = render();
  assert.match(html, /data-repo-cat="1"><option value="" selected>None \(top of the workspace\)<\/option><option value="Billing">Billing<\/option>.*<option value="__new">New category<\/option>/s);
  assert.doesNotMatch(html, /repo-newcat/, 'no name box until New category is picked');
  S.ui.drafts['repo:category'] = NEW_CATEGORY;
  assert.match(render(), /<option value="__new" selected>New category.*class="mono repo-newcat" data-draft="repo:newcat"/s);
  assert.deepEqual(repoCategoryCheck('', ''), { category: '' });
  assert.deepEqual(repoCategoryCheck('Platform', 'ignored'), { category: 'Platform' });
  assert.deepEqual(repoCategoryCheck(NEW_CATEGORY, ' Data '), { category: 'Data' });
  assert.match(repoCategoryCheck(NEW_CATEGORY, '').error, /Name the new category/);
  assert.deepEqual(repoCategoryCheck(NEW_CATEGORY, 'Platform/Lighthouse Edge'), { category: 'Platform/Lighthouse Edge' });
  assert.deepEqual(repoCategoryCheck(NEW_CATEGORY, 'Platform\\Lighthouse'), { category: 'Platform/Lighthouse' });
  for (const bad of ['a/b/c/d', '.hidden', '-x', 'a/', 'a/ b', 'a/../b']) assert.match(repoCategoryCheck(NEW_CATEGORY, bad).error, /folder name/, bad);
  S.ui.repo.added = { folder: 'Platform/web-app', repoMap: 'added' };
  assert.match(render(), /<b>Platform\/web-app<\/b>.*data-guide="Platform\/web-app">Draft its guide/s);
});

test('AI: the checklist and a banner say how to connect one; unknown is not treated as missing', () => {
  load(clone(FIXTURE));
  S.L.opencode.ai = { known: true, providers: [] };
  assert.equal(aiState(), 'off');
  let html = render();
  assert.match(html, /Getting set up, 2 of 3 done.*class="gstep open">.*Connect an AI model.*opencode auth login.*data-ai-check="1"/s);
  assert.match(html, /console\.anthropic\.com/, 'says how to use Claude');
  S.L.opencode.ai = { known: false, providers: [] };
  assert.equal(aiState(), 'unknown');
  assert.equal(onboardSteps()[0].done, true);
  assert.doesNotMatch(render(), /Getting set up/, 'all set: no checklist');
  S.L.opencode.ai = { known: true, providers: ['OpenAI'] };
  assert.equal(aiState(), 'on');
});

test("3.0 Work: sessions starting with a reply box, spikes and TSDs as rows, and a spike's page with its findings", () => {
  load(clone(FIXTURE));
  S.L.sessions.ses_loose = { id: 'ses_loose', title: '/spike how does login work', status: 'idle', command: '/spike how does login work', text: 'Two options.', folder: null };
  S.L.others = [{ session: 'ses_loose', command: '/spike how does login work', at: S.now - 60000 }];
  assert.equal(looseSessions().length, 1);
  S.ui.tab = 'work';
  let html = render();
  assert.match(html, /<h3 id="gh-starting">Starting <span class="n">1<\/span>.*\/spike how does login work.*data-dismiss="ses_loose".*Two options\..*data-reply="ses_loose"/s);
  assert.match(html, /<h3 id="gh-done">Done <span class="n">1<\/span>.*data-open-run="spike-cache-options">Cache options for the catalog/s);
  assert.match(html, /<span class="tag">Spike<\/span> · Step 2 of 2: Read the findings/);
  assert.match(html, /<span class="tag">TSD<\/span> · Step 2 of 4: Fact-check/);
  S.L.sessions.ses_loose.folder = 'spike-login';
  assert.equal(looseSessions().length, 0, 'once its folder exists, it is drawn with that item');
  S.ui.run = 'spike-cache-options';
  S.files['spike-cache-options/findings.md'] = { text: '# Findings\n\nUse **memory**.', at: 1 };
  html = render();
  assert.match(html, /data-close-run="board">&larr; Board</);
  assert.match(html, /<article class="item run-page" id="item-spike-cache-options"/);
  assert.match(html, /<ol class="flow" aria-label="Step 2 of 2: Read the findings, Done">/);
  assert.match(html, /data-doc-start="spike-cache-options"[^>]*>Start work from this</);
  assert.match(html, /data-doc-note="spike-cache-options">Save as note</);
  assert.match(html, /<strong>memory<\/strong>/, 'the findings render as escaped markdown');
  S.files = {};
});
test('brief.md from /start: a Brief card at the top of the item, escaped, open until the spec stage', () => {
  load(clone(FIXTURE));
  const fresh = item('41455-audit-log-filter');
  assert.equal(briefHtml(fresh), '', 'no card without brief.md');
  // A fresh item: repos set up, no spec yet.
  Object.assign(fresh, { stage: 'spec', gates: { spec: null, plan: null, bug: null, review: null }, files: ['workitem.md', 'brief.md', 'repos.md'] });
  assert.match(briefHtml(fresh), /Loading the brief\./, 'loading until file.read answers');
  S.files[fresh.folder + '/brief.md'] = { text: '# Brief: 41455 Audit log filter\n\n<!-- note for the agent -->\n## Goal\n\nFilter by `person-one` <script>alert(1)</script>\n\n## Done means\n\n- [ ] **Filter** works\n', error: null };
  const card = briefHtml(fresh);
  assert.match(card, /^<details class="brief" data-key="b:41455-audit-log-filter" open><summary>Brief<\/summary>/, 'open by default before the spec');
  assert.match(card, /<p class="sub-h">Goal<\/p><div class="pre">Filter by <code>person-one<\/code> &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/div>/, 'escaped, inline code kept');
  assert.match(card, /<p class="sub-h">Done means<\/p><div class="pre">• \[ \] <strong>Filter<\/strong> works<\/div>/);
  assert.doesNotMatch(card, /<script>|note for the agent|# Brief/, 'no raw HTML, comments or the title line');
  assert.match(card, /data-file="41455-audit-log-filter" data-name="brief.md">Open brief.md</, 'opens in the file sheet');
  assert.match(itemCard(fresh), /<\/h4><div class="meta">.*?<\/div><\/div><details class="brief"/s, 'first thing under the title');
  // Spec written: still there, but closed.
  fresh.gates.spec = 'DRAFT';
  assert.equal(briefOpen(fresh), false);
  assert.match(briefHtml(fresh), /^<details class="brief" data-key="b:41455-audit-log-filter"><summary>/);
  S.ui.open['b:' + fresh.folder] = true;
  assert.match(briefHtml(fresh), /data-key="b:41455-audit-log-filter" open>/, 'a hand toggle wins');
  // Bug lane: closed once bug.md exists.
  assert.equal(briefOpen(item('41300-export-retry-fails')), false);
  S.files[fresh.folder + '/brief.md'] = { text: null, error: 'Not found.' };
  assert.match(briefHtml(fresh), /<p class="err">Not found\.<\/p>/);
  S.files = {};
});

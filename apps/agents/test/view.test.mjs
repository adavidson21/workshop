// Agents view: the page-only parity items from connectors/opencode/PARITY.md (marked WS6), on a state the
// opencode connector returned for docs/examples/work (fixtures/state.json, synthetic). Each test names the
// changelog item it covers. The browser checks (clicks, theme, #/agents/<id>) are in tests/e2e.py.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/state.js';
import { render, track, nextHtml, autoHtml, itemCard, pickupHtml, removeSheetHtml, setupHtml, prompts, pill, liveNote, removeKey } from '../js/view.js';

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

test('the whole page renders every item, the sidebar and the header', () => {
  const html = render();
  for (const it of S.D.items) assert.match(html, new RegExp(`id="item-${it.id || it.folder}"`), it.folder);
  assert.match(html, /Repos with work in progress/);
  assert.match(html, /Recent activity/);
  assert.match(html, /class="pill on"[^>]*><span class="led"><\/span>Live/);
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

test('1.4.0 count chips appear over 8 items', () => {
  assert.doesNotMatch(render(), /class="counts"/, `${S.D.items.length} items: no chips`);
  const more = clone(FIXTURE);
  for (let i = 0; i < 3; i++) more.items.push({ ...clone(more.items[0]), id: String(50000 + i), folder: `${50000 + i}-extra`, title: `Extra ${i}` });
  load(more);
  const html = render();
  assert.match(html, /<ul class="counts"/);
  assert.match(html, /data-b="active" class="">In progress <b>4<\/b>/);
});

test('1.2.1 Pick up here is not repeated in its group, and has its own Abandon button', () => {
  const html = render();
  // 41300 needs you (approve bug.md) and is the newest moving item.
  assert.match(html, /<section class="pickup" id="item-41300"/);
  assert.equal(count(html, /id="item-41300"/g), 1, 'drawn once');
  assert.match(html, /class="picked"[^>]*>.*?#41300.*?In Pick up here/s);
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

test('1.2.0 PR cards: copy buttons, Create PR in ADO, and the push command when a branch is not pushed', () => {
  const it = item('41610-rate-limit-headers');
  const card = itemCard(it, false);
  assert.match(card, /<span class="flag warn">Not pushed yet<\/span>/);
  assert.match(card, /Push first:<\/span><code>git -C gateway push -u origin dev\/bug\/41610-rate-limit-headers<\/code><button type="button" class="btn primary" data-push="41610-rate-limit-headers" data-repo="gateway"/);
  const titleIdx = S.copyStore.indexOf(it.pr[0].title);
  assert.ok(titleIdx >= 0 && new RegExp(`data-copy="${titleIdx}"[^>]*>Copy title<`).test(card), 'Copy title');
  assert.match(card, />Copy description</);
  it.pr[0].links = { pr: 'https://ado.example.com/coll/proj/_git/gateway/pullrequestcreate?sourceRef=x' };
  assert.match(itemCard(it, false), /<a class="btn" href="https:\/\/ado\.example\.com\/coll\/proj\/_git\/gateway\/pullrequestcreate\?sourceRef=x" target="_blank" rel="noopener"[^>]*>Create PR in ADO<\/a>/);
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

test('prompts: shown with their item, or under Waiting for you when no item; counted for the badge', () => {
  S.L.permissions.push({ id: 'per_1', sessionID: 'ses_0001abc', permission: 'bash', title: 'git push', folder: '41207-fix-login-timeout' });
  S.L.permissions.push({ id: 'per_2', sessionID: 'ses_tui', permission: 'edit', title: 'README.md', folder: null });
  S.L.questions.push({ id: 'que_1', sessionID: 'ses_0001abc', folder: '41207-fix-login-timeout', questions: [{ header: 'Branch', question: 'Which branch?', options: [{ label: 'main' }, { label: 'dev', description: 'the dev branch' }] }] });
  const html = render();
  assert.match(html, /<section class="waiting"[^>]*>.*data-perm="per_2" data-answer="once"/s);
  assert.match(html, /<section class="pickup" id="item-41207"/, 'an item whose agent is waiting is picked up first');
  assert.match(html, /data-perm="per_1" data-answer="always"/);
  assert.match(html, /<input type="radio" name="que_1-0" value="dev" data-qpick="que_1" data-qi="0">.*the dev branch/s);
  assert.match(html, /data-qsend="que_1">Answer</);
  assert.deepEqual(prompts().map(p => p.id), ['per_1', 'per_2', 'que_1']);
});

test('.work files open in the app through file.read, not as links', () => {
  const card = itemCard(item('41207-fix-login-timeout'), false);
  assert.match(card, /<button type="button" class="lnk" data-file="41207-fix-login-timeout" data-name="plan.md">plan.md<\/button>/);
  assert.doesNotMatch(card, /href="files\//);
  S.ui.file = { folder: '41207-fix-login-timeout', name: 'plan.md', text: '# Plan <b>x</b>', error: null };
  assert.match(render(), /<pre class="filetext"># Plan &lt;b&gt;x&lt;\/b&gt;<\/pre>/);
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
  assert.match(render(), /Workshop stopped or restarted/);
});

test('in the shell, the shell owns the name and theme; on its own, the page has both', () => {
  assert.doesNotMatch(render(), /class="brand"|data-theme-menu/);
  S.embedded = false;
  S.version = '1.0.0';
  assert.match(render(), /<h1>Agents<\/h1><span class="ver">v1\.0\.0<\/span>.*data-theme-menu="1"/s);
});

test('before the connector is ready, the page says what is wrong and how to fix it', () => {
  S.mode = 'browser'; S.connector = null; S.D = null;
  assert.match(render(), /Agents needs Workshop running on this computer/);
  S.mode = 'local'; S.connector = { state: 'disabled', message: null };
  assert.match(setupHtml(), /Turn on the opencode connector.*data-settings="1">Open Settings/s);
  S.connector = { state: 'error', message: 'No PowerShell found. Install `pwsh`.' };
  assert.match(setupHtml(), /can't start.*No PowerShell found\. Install <code>pwsh<\/code>\./s);
  S.mode = 'hosted';
  assert.doesNotMatch(setupHtml(), /data-settings/, 'a hosted page cannot change settings');
  S.connector = { state: 'missing', message: null };
  assert.match(setupHtml(), /not installed/);
});

test('an empty .work says how to start', () => {
  const empty = clone(FIXTURE);
  empty.items = []; empty.activity = [];
  load(empty);
  assert.match(render(), /No work in \.work yet.*\/start &lt;id&gt; feature/s);
});

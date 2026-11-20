// Loom 5.0.0 lanes (js/dispatch/lanes.js; plan: claude/loom-lanes-v1-plan.md in the Workshop project): every run is
// a card in Clarify, Plan, Work or Ready, by its flow and step; the drop box guesses Build, Diagnose or Ask and turns
// what was pasted into the Start work request the connector already takes. On the synthetic fixture.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/dispatch/state.js';
import { startRequest } from '../js/dispatch/view.js';
import { LANES, KINDS, kindOf, laneOf, laneDots, lanesData, lanesHtml, guessKind, adoIdOf, dropStart, lanesCount, pickRows, kindOfAdoType } from '../js/dispatch/lanes.js';
import { setPickable, setBoardFeed } from '../js/loom.js';
import { wantedFiles } from '../js/dispatch/pages.js';

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
  S.ui.tab = 'lanes';
  S.view = { project: 'all', lanes: 'list' }; // these tests read the List view (rows since 6.7.0); floor.test.mjs reads the Floor
}
const item = folder => S.D.items.find(i => i.folder === folder);
const drafts = d => Object.fromEntries(Object.entries(d).map(([k, v]) => ['start:' + k, v]));
beforeEach(load);

test('four lanes in order, and the lanes each kind goes through (Diagnose and Ask skip Plan)', () => {
  assert.deepEqual(LANES.map(l => l.id), ['clarify', 'plan', 'work', 'ready']);
  assert.deepEqual(KINDS.build.lanes, ['clarify', 'plan', 'work', 'ready']);
  assert.deepEqual(KINDS.diagnose.lanes, ['clarify', 'work', 'ready']);
  assert.deepEqual(KINDS.ask.lanes, ['clarify', 'work', 'ready']);
});

test('every run is in the lane its flow and step say: a spec or root cause in Plan, building in Work, PR text in Ready', () => {
  const lanes = Object.fromEntries(S.D.items.map(it => [it.folder, laneOf(it)]));
  assert.deepEqual(lanes, {
    '41207-fix-login-timeout': 'work',
    '41300-export-retry-fails': 'plan',
    '41455-audit-log-filter': 'plan',
    '41502-csv-export': 'work',
    '41610-rate-limit-headers': 'ready',
    'spike-cache-options': 'ready',
    'tsd-billing-api': 'plan'
  });
  assert.equal(kindOf(item('41300-export-retry-fails')), 'build', 'a bug fix is Build');
  assert.equal(kindOf(item('spike-cache-options')), 'ask', 'an investigation is Ask');
  assert.equal(kindOf(item('tsd-billing-api')), 'docs');
});

test('a run at Set up is in Clarify; a log diagnosis is Diagnose, in Work then Ready; done runs leave the lanes', () => {
  const it = item('41207-fix-login-timeout');
  it.stage = 'start';
  assert.equal(laneOf(it), 'clarify');
  const log = item('spike-cache-options');
  log.fromLog = true; log.state = 'Investigating';
  assert.equal(kindOf(log), 'diagnose');
  assert.equal(laneOf(log), 'work');
  log.state = 'Findings written';
  assert.equal(laneOf(log), 'ready');
  log.state = 'Closed: applied the configuration change';
  assert.equal(laneOf(log), 'done');
  it.stage = 'ship'; it.bucket = 'done';
  assert.equal(laneOf(it), 'done');
});

test('lane dots: skipped lanes dashed, done ones faded, the current one filled', () => {
  assert.deepEqual(laneDots('diagnose', 'ready').map(d => d.st), ['done', 'skip', 'done', 'now']);
  assert.deepEqual(laneDots('build', 'plan').map(d => d.st), ['done', 'now', 'next', 'next']);
  assert.equal(laneDots('ask', 'work')[1].title, 'Plan (skipped)');
});

test('your turn first in each lane, with the action named; the tab counts what waits on you', () => {
  const d = lanesData();
  const plan = d.lanes.find(l => l.id === 'plan').cards;
  assert.ok(plan.length >= 2);
  const mine = d.cards.filter(c => c.mine);
  assert.ok(mine.length >= 1, 'something in the fixture waits on you');
  for (const l of d.lanes) {
    const firstNotMine = l.cards.findIndex(c => !c.mine);
    if (firstNotMine >= 0) assert.ok(l.cards.slice(firstNotMine).every(c => !c.mine), l.id + ': your turn sorts first');
  }
  const spec = d.cards.find(c => c.folder === '41300-export-retry-fails');
  assert.equal(spec.mine, true);
  assert.equal(spec.action, 'Review root cause');
  assert.equal(lanesCount(), mine.length);
});

test('filters: Your turn and each kind', () => {
  assert.ok(lanesData('mine').lanes.every(l => l.cards.every(c => c.mine)));
  assert.ok(lanesData('ask').lanes.every(l => l.cards.every(c => c.kind === 'ask')));
  assert.equal(lanesData('diagnose').cards.length, lanesData('all').cards.length, 'counts cover every card');
  assert.equal(lanesData('diagnose').lanes.reduce((n, l) => n + l.cards.length, 0), 0);
});

test('the page: the drop box, chips, the List of rows; a card opens the run\'s own card in the panel, with an X to close', () => {
  let html = lanesHtml();
  assert.match(html, /data-draft="lanes:drop"/);
  assert.match(html, /data-lane-start="1"/);
  assert.deepEqual([...html.matchAll(/<section class="fl-rgroup" aria-label="([^"]+)"/g)].map(m => m[1]), ['Needs you', 'Running'], 'List (6.7.0): rows grouped, no lanes');
  assert.doesNotMatch(html, /class="ln-lanes"|data-lane-view="rows"/);
  assert.doesNotMatch(html, /ln-kindpick/, 'the kind picker shows once there is text');
  assert.doesNotMatch(html, /class="ln-panel"/);
  S.ui.drafts['lanes:drop'] = 'Why does the export retry only once?';
  html = lanesHtml();
  assert.match(html, /<option value="ask" selected>Ask<\/option>/);
  S.ui.laneSel = '41300-export-retry-fails';
  html = lanesHtml();
  assert.match(html, /class="ln-panel"/);
  assert.match(html, /data-lane-close="1" aria-label="Close panel"/);
  assert.match(html, /data-open-run="41300-export-retry-fails"/);
  assert.match(html, /class="loom-run ln-run"><article class="icard gate"/, 'the panel holds the same gate card as the Inbox');
});

test('the open card\'s gate file is read for the panel', () => {
  S.ui.laneSel = '41300-export-retry-fails';
  const it = item('41300-export-retry-fails');
  it.files = [...(it.files || []), 'bug.md'];
  assert.ok(wantedFiles().some(([f, n]) => f === '41300-export-retry-fails' && n === 'bug.md'));
});

test('the drop box guesses the kind: a stack trace is Diagnose, a question Ask, a story Build', () => {
  assert.equal(guessKind('System.NullReferenceException: Object reference not set\n   at Scribe.Rendering.TemplateBinder.Bind(Template t) line 212'), 'diagnose');
  assert.equal(guessKind('Traceback (most recent call last):\n  File "app.py", line 3'), 'diagnose');
  assert.equal(guessKind('Which services still call the v1 auth endpoint?'), 'ask');
  assert.equal(guessKind('how do other teams handle feature flags'), 'ask');
  assert.equal(guessKind('As a support agent, I want to resend a failed welcome email from the member page.'), 'build');
  assert.equal(guessKind('48213'), 'build');
  assert.equal(guessKind(''), 'build');
  assert.equal(adoIdOf('#48213'), '48213');
  assert.equal(adoIdOf('ADO 48213'), '48213');
  assert.equal(adoIdOf('48213 and more'), null);
});

test('the drop box becomes the Start work request the connector already takes', () => {
  // Build, described: the first line is the title, the whole text the description.
  let r = dropStart('Bulk resend for failed notifications\nAs a support agent I want to resend them all at once.', 'build', { ado: false });
  let q = startRequest(r.st, drafts(r.drafts));
  assert.equal(q.action, 'start.local');
  assert.equal(q.args.lane, 'feature');
  assert.equal(q.args.title, 'Bulk resend for failed notifications');
  assert.match(q.args.description, /all at once/);
  // Build, an ADO number with ADO set up.
  S.D.tandem = { ...(S.D.tandem || {}), ado: true };
  r = dropStart('#48213', 'build');
  q = startRequest(r.st, drafts(r.drafts));
  assert.deepEqual([q.action, q.args.id, q.args.lane], ['start', '48213', 'feature']);
  // Diagnose: Fix a bug from an error log.
  r = dropStart('Error: boom\n  at x (a.js:1)', 'diagnose');
  q = startRequest(r.st, drafts(r.drafts));
  assert.equal(q.action, 'spike');
  assert.match(q.args.log, /boom/);
  // Ask: Investigate.
  r = dropStart('Which services still call v1?', 'ask');
  q = startRequest(r.st, drafts(r.drafts));
  assert.deepEqual([q.action, q.args.topic], ['spike', 'Which services still call v1?']);
  assert.equal(dropStart('   ', 'build').error, 'Paste a story, an error log or a question first.');
  // A long single line is cut to a title, with the whole text kept as the description.
  r = dropStart('x'.repeat(260), 'build', { ado: false });
  assert.ok(r.drafts.title.length <= 200);
  assert.equal(r.drafts.desc.length, 260);
});

test('a card that says Answer opens on Tandem\'s question, answerable in the panel (5.0.1)', () => {
  S.L.questions.push({ id: 'que_1', sessionID: 'ses_0001abc', folder: '41207-fix-login-timeout', questions: [{ header: 'Branch', question: 'Which branch?', options: [{ label: 'main' }, { label: 'dev' }] }] });
  const c = lanesData().cards.find(x => x.folder === '41207-fix-login-timeout');
  assert.equal(c.mine, true);
  assert.equal(c.action, 'Answer');
  S.ui.laneSel = '41207-fix-login-timeout';
  const html = lanesHtml();
  assert.match(html, /class="ln-asks"><div class="asks inline">/);
  assert.match(html, /Which branch\?/);
});

test('From ADO (5.1): the picker lists the board\'s unstarted backlog, searchable; a pick starts that item, a Bug as a fix', () => {
  const list = [
    { id: '48240', title: 'Export retries only once on timeout', type: 'Bug' },
    { id: '48213', title: 'Resend a failed welcome email', type: 'User Story' },
    { id: '48266', title: 'Spike: v1 auth callers', type: 'Spike' }
  ];
  assert.deepEqual(pickRows(list, '').map(r => r.id), ['48240', '48213', '48266']);
  assert.deepEqual(pickRows(list, 'welcome email').map(r => r.id), ['48213']);
  assert.deepEqual(pickRows(list, '#4824').map(r => r.id), ['48240']);
  assert.equal(kindOfAdoType('Bug'), 'build');
  assert.equal(kindOfAdoType('Spike'), 'ask');
  assert.equal(adoIdOf('#48240 Export retries only once on timeout'), '48240');
  assert.equal(adoIdOf('48240 is broken'), null, 'a bare number then words is a story, not an item');
  S.D.tandem = { ...(S.D.tandem || {}), ado: true };
  const r = dropStart('#48240 Export retries only once on timeout', 'build', { ado: true, adoType: 'Bug' });
  const q = startRequest(r.st, drafts(r.drafts));
  assert.deepEqual([q.action, q.args.id, q.args.lane], ['start', '48240', 'bug']);
  setPickable([]);
  assert.doesNotMatch(lanesHtml(), /data-ado-toggle/, 'no backlog, no From ADO');
  setPickable(list);
  assert.match(lanesHtml(), /data-ado-toggle="1" aria-expanded="false"><span>From ADO/);
  S.ui.dropPick = true;
  S.ui.drafts['lanes:adoq'] = 'export';
  const html = lanesHtml();
  assert.match(html, /data-ado-pick="48240"/);
  assert.doesNotMatch(html, /data-ado-pick="48213"/);
  setPickable([]);
});

test('Done today (5.1) opens a list of what finished today', () => {
  const it = item('spike-cache-options');
  it.state = 'Closed: saved as a note';
  it.modifiedMs = Date.parse('2026-10-21T10:00:00');
  let html = lanesHtml();
  assert.match(html, /<section class="fl-rgroup" aria-label="Done today"><h2>Done today <span class="fl-ln">1<\/span><\/h2><ul class="fl-rows ln-donelist" role="list"><li><button type="button" class="fl-rowb fl-done" data-open-run="spike-cache-options">/, 'List: a Done today group (6.7.0)');
  S.view.lanes = 'floor';
  html = lanesHtml();
  assert.match(html, /data-lane-done="1" aria-expanded="false">Shipped today: 1</, 'Floor: Shipped today under the code line');
  S.ui.laneDone = true;
  html = lanesHtml();
  assert.match(html, /class="fl-shipped">.*?class="ln-donelist"[^]*data-open-run="spike-cache-options"/);
});

test('the panel has a Chat button for the run\'s conversation (Chat is off the rail since 3.0.0)', () => {
  S.ui.laneSel = '41207-fix-login-timeout';
  assert.match(lanesHtml(), /data-open-chat="[^"]+" aria-label="Open the conversation in Chat"/);
});

test('board items are lane cards (5.2): a request in Clarify, a draft in Plan, a hand-off With them in Work; they open the board\'s drawer', () => {
  setBoardFeed([
    { id: 'w_1', title: 'Bulk resend for failed notifications', adoId: null, kind: 'request', lane: 'clarify', mine: true, action: 'Brief ready: send it to Define', status: 'Brief', at: 2 },
    { id: 'w_2', title: 'Page history diff view', adoId: '48251', kind: 'handoff', lane: 'plan', mine: true, action: 'Decide who builds it', status: 'Who builds it?', at: 1 },
    { id: 'w_3', title: 'Audit export', adoId: '48300', kind: 'handoff', lane: 'work', mine: false, action: '', status: 'With Sam', at: 0 }
  ]);
  const d = lanesData();
  const req = d.cards.find(c => c.board === 'w_1');
  assert.deepEqual([req.lane, req.kind, req.mine, req.status], ['clarify', 'request', true, 'Brief ready: send it to Define']);
  assert.equal(d.cards.find(c => c.board === 'w_3').status, 'With Sam');
  const html = lanesHtml();
  assert.match(html, /data-lane-open="board:w_2"/);
  S.ui.laneSel = 'board:w_2';
  assert.doesNotMatch(lanesHtml(), /class="ln-panel"/, 'a board item opens the board\'s own panel, not the runs panel');
  setBoardFeed([]);
});

test('teammates\' PRs are one Review card in Ready that opens the review list (5.2)', () => {
  S.inbox = { state: 'ok', items: [{ id: '812', title: 'Add retry', waiting: false }, { id: '813', title: 'Fix typo', waiting: false }] };
  const card = lanesData().cards.find(c => c.reviews);
  assert.deepEqual([card.lane, card.kind, card.mine, card.title], ['ready', 'review', true, "2 teammates' PRs to review"]);
  S.ui.laneSel = 'reviews';
  assert.match(lanesHtml(), /class="ln-reviews"/);
  S.inbox = null;
});

test('Hand off is a drop box kind (5.2): the board\'s Hand to a person flow', () => {
  const r = dropStart('Audit export for finance\nThey need the monthly export with totals.', 'handoff');
  const q = startRequest(r.st, drafts(r.drafts));
  assert.equal(q.board, 'handoff');
  assert.equal(q.args.title, 'Audit export for finance');
  assert.match(q.args.description, /monthly export/);
});

test('a spike\'s first look (Core 4.6.0) is on its card and at the top of its panel while it keeps digging', () => {
  const it = item('spike-cache-options');
  it.state = 'Investigating';
  it.files = ['first-look.md'];
  S.files = { 'spike-cache-options/first-look.md': { text: 'Quick answer: Redis fits.\nConfidence: Medium\nDigging into: cache layer' } };
  const c = lanesData().cards.find(x => x.folder === 'spike-cache-options');
  assert.equal(c.lane, 'work');
  assert.equal(c.status, 'First look ready; still digging');
  S.ui.laneSel = 'spike-cache-options';
  assert.match(lanesHtml(), /class="ln-first"><p class="ln-fh">First look<\/p>[^]*Redis fits/);
  assert.ok(wantedFiles().some(([f, n]) => f === 'spike-cache-options' && n === 'first-look.md'));
});

test('Loom 6.0: a prompt from a session no card holds (a Chat, the terminal) is its own card in Clarify, answerable in the panel', () => {
  S.L.permissions.push({ id: 'per_2', sessionID: 'ses_tui', permission: 'edit', title: 'README.md', folder: null });
  const c = lanesData().cards.find(x => x.session === 'ses_tui' && !x.folder);
  assert.ok(c, 'the terminal session\'s prompt has a card');
  assert.deepEqual([c.lane, c.mine, c.action], ['clarify', true, 'Answer']);
  S.ui.laneSel = 'session:ses_tui';
  assert.match(lanesHtml(), /class="ln-asks"><div class="asks inline">[^]*data-perm="per_2"/);
});

test('Right now (6.13.0): the popup shows the newest turn\'s thinking and tool calls; filters with nothing hide', async () => {
  const { pickLive, liveHtml } = await import('../js/dispatch/live.js');
  const r = { busy: true, activity: 'Running npm test', turns: [
    { role: 'you', parts: [] },
    { role: 'tandem', parts: [{ type: 'reasoning', text: 'old' }] },
    { role: 'you', parts: [] },
    { role: 'tandem', parts: [{ type: 'reasoning', text: 'The test fails because mapfile is missing.' }, { type: 'tool', tool: 'bash', title: 'npm run check', status: 'running' }] }
  ] };
  const f = pickLive(r);
  assert.equal(f.think, 'The test fails because mapfile is missing.');
  assert.deepEqual(f.tools, [{ name: 'npm run check', status: 'running' }]);
  S.liveFeed = { s1: f };
  const html = liveHtml('s1', true);
  assert.match(html, /Right now<span class="ln-lact">Running npm test<\/span>/);
  assert.match(html, /<li class="s-running"><span class="ln-lst" aria-hidden="true"><\/span>npm run check<\/li>/);
  assert.equal(liveHtml(null, true), '');
  delete S.liveFeed;
  assert.doesNotMatch(lanesHtml(), /data-lane-filter="diagnose"/, 'an empty kind filter hides');
  assert.match(lanesHtml(), /data-lane-filter="mine"/, 'Your turn always shows');
});

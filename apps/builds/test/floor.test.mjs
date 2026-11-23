// Builds 6.4.0 floor (js/runs/floor.js; plan: claude/loom-floor-v1-plan.md in the Workshop project): the lanes'
// cards drawn as stations on a code line and a research line, stuck cards in their own bin, Floor or List. On the
// synthetic fixture.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/runs/state.js';
import { lanesData, lanesHtml, laneView } from '../js/runs/lanes.js';
import { CODE, PAPER, STACK_MAX, motionOf, lineOf, stationOf, floorData, floorHtml, epicPanelHtml, rowsData, rowsHtml, onboardPickHtml, coverPickHtml, testsBadge, toldStep, flowSummary, floorEmpty } from '../js/runs/floor.js';
import { setBoardFeed } from '../js/board.js';
import { setAdo } from '../../../shared/ado.js';
import { setFlowsAdo } from '../js/runs/flows.js';
// These checks are written for Azure DevOps on; no-ado.test.mjs covers it off.
setAdo(true); setFlowsAdo(true);

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
  S.copyStore = []; S.files = {}; S.builds = new Map();
  S.view = { project: 'all', lanes: 'floor' };
  resetUi();
  S.ui.tab = 'lanes';
}
beforeEach(load);
afterEach(() => setBoardFeed([]));
const card = folder => lanesData('all').cards.find(c => c.folder === folder);
const where = () => {
  const fd = floorData(lanesData('all'));
  const out = {};
  for (const [line, list] of [['code', fd.code], ['paper', fd.paper]]) for (const s of list) for (const c of s.cards) out[c.folder] = line + ':' + s.id;
  for (const c of fd.stuck) out[c.folder] = 'stuck';
  for (const c of fd.express) out[c.folder] = 'express:' + c.station;
  return out;
};

test('two lines: the code line ends at the Loading dock, the research line at the Out tray; your gates are the ends', () => {
  assert.deepEqual(CODE.map(s => s.id), ['plan', 'build', 'test', 'ui', 'review', 'fix', 'dock', 'transit']);
  assert.deepEqual(PAPER.map(s => s.id), ['plan', 'research', 'write', 'review', 'out']);
  assert.deepEqual(CODE.filter(s => s.you).map(s => s.id), ['plan', 'dock']);
  assert.deepEqual(PAPER.filter(s => s.you).map(s => s.id), ['plan', 'out']);
  assert.equal(lineOf({ kind: 'build' }), 'code');
  for (const k of ['ask', 'diagnose', 'docs', 'epic']) assert.equal(lineOf({ kind: k }), 'paper', k);
  for (const k of ['request', 'handoff', 'review', 'other']) assert.equal(lineOf({ kind: k }), 'other', k);
});

test('every fixture run is at the station its lane and step say; a stopped one is pulled off the line', () => {
  assert.deepEqual(where(), {
    '41455-audit-log-filter': 'code:plan',
    '41300-export-retry-fails': 'code:plan',
    '41207-fix-login-timeout': 'code:build',
    '41610-rate-limit-headers': 'code:dock',
    '41502-csv-export': 'stuck',
    'tsd-billing-api': 'paper:review',
    'spike-cache-options': 'paper:out'
  });
});

test('what the session is doing picks Test bench, UI check and the Fix shop', () => {
  const it = S.D.items.find(i => i.folder === '41207-fix-login-timeout');
  S.L.sessions.ses_0001abc.activity = 'Running the tests (npm test)';
  assert.equal(stationOf(card(it.folder)), 'test');
  it.stage = 'review';
  S.L.sessions.ses_0001abc.activity = 'Taking UI screenshots';
  assert.equal(stationOf(card(it.folder)), 'ui');
  S.L.sessions.ses_0001abc.activity = 'Reading the diff';
  assert.equal(stationOf(card(it.folder)), 'review');
  S.L.autopilot = { [it.folder]: { status: 'running', fixRounds: 1 } };
  assert.equal(stationOf(card(it.folder)), 'fix', 'a review round after the first is the Fix shop');
  S.L.autopilot[it.folder].status = 'stopped';
  assert.equal(stationOf(card(it.folder)), 'stuck', 'a stopped autopilot is pulled off the line');
});

test('a running autopilot moves the card with the command it runs, before the item files catch up (6.14.0)', async () => {
  const { laneOf } = await import('../js/runs/lanes.js');
  const it = S.D.items.find(i => i.folder === '41207-fix-login-timeout');
  it.stage = 'plan';
  S.L.sessions.ses_0001abc.activity = '';
  S.L.autopilot = { [it.folder]: { status: 'running', command: '/spec 41207 auto', fixRounds: 0 } };
  assert.equal(stationOf(card(it.folder)), 'plan', 'still planning');
  for (const [cmd, st] of [['/approve 41207 plan', 'build'], ['/do-task 41207 2', 'build'], ['/review 41207 auto', 'review'], ['/pr 41207', 'review'], ['/revise 41207 auto', 'fix']]) {
    S.L.autopilot[it.folder].command = cmd;
    assert.equal(stationOf(card(it.folder)), st, cmd);
  }
  S.L.autopilot[it.folder].command = '/approve 41207 plan';
  assert.equal(laneOf(it), 'work', 'its lane is Work too');
  S.L.sessions.ses_0001abc.activity = 'Running the tests (npm test)';
  S.L.autopilot[it.folder].command = '/do-task 41207 2';
  assert.equal(stationOf(card(it.folder)), 'test');
  S.L.autopilot[it.folder].fixRounds = 1;
  assert.equal(stationOf(card(it.folder)), 'fix', 'fix tasks after a review are the Fix shop');
  S.L.autopilot[it.folder].status = 'queued';
  assert.equal(stationOf(card(it.folder)), 'plan', 'queued waits where its files say');
});

test('express lane: a quick change autopilot is building rides above the line; at a gate it is back on the line', () => {
  const it = S.D.items.find(i => i.folder === '41207-fix-login-timeout');
  it.lane = 'quick';
  S.L.autopilot = { [it.folder]: { status: 'running' } };
  assert.equal(where()[it.folder], 'express:build');
  const html = lanesHtml();
  assert.match(html, /class="fl-express"[^>]*aria-label="Express lane/);
  it.stage = 'quick';
  assert.equal(where()[it.folder], 'code:plan', 'a quick plan that was not clean waits at the Plan desk');
});

test('the build bay plate counts running and queued autopilot builds and turns busy with a queue', () => {
  S.L.autopilot = { a: { status: 'running' }, b: { status: 'running' }, c: { status: 'queued' } };
  const html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /<div class="fl-plate busy whirr"><span class="fl-name"><svg class="fl-gear"[^]*?<\/svg>Build bay<\/span><span class="fl-sub">2 building, 1 queued<\/span>/);
  assert.match(html, /<div class="fl-plate you"><span class="fl-name">Plan desk/);
});

test(`a station shows ${STACK_MAX} cards, then +N more; opening it shows them all`, () => {
  const base = S.D.items.find(i => i.folder === '41455-audit-log-filter');
  for (let n = 0; n < 8; n++) S.D.items.push({ ...clone(base), folder: `5000${n}-extra`, id: `5000${n}`, title: `Extra ${n}`, paused: false });
  let html = floorHtml(lanesData('all'), '', '');
  const plan = html.slice(html.indexOf('st-plan'), html.indexOf('st-build'));
  assert.equal((plan.match(/class="fl-card/g) || []).length, STACK_MAX);
  assert.match(plan, /data-floor-more="code:plan" aria-expanded="false">\+4 more</);
  S.ui.floorOpen = { 'code:plan': true };
  html = floorHtml(lanesData('all'), '', '');
  const all = html.slice(html.indexOf('st-plan'), html.indexOf('st-build'));
  assert.equal((all.match(/class="fl-card/g) || []).length, 10);
  assert.match(all, /aria-expanded="true">Show fewer</);
});

test('Floor is the default; List is the other view (no lanes since 6.7.0); a card opens the same panel either way', () => {
  assert.equal(laneView(), 'floor');
  let html = lanesHtml();
  assert.match(html, /data-lane-view="floor" aria-pressed="true"/);
  assert.equal([...html.matchAll(/data-lane-view="(\w+)"/g)].map(m => m[1]).join(','), 'floor,list');
  assert.match(html, /class="fl-floor"/);
  assert.doesNotMatch(html, /class="ln-lanes"/);
  assert.match(html, /<button type="button" class="fl-card k-build mine m-gate" data-lane-open="41610-rate-limit-headers"[^>]*>.*?<span class="fl-act">Publish<\/span>/);
  S.ui.laneSel = '41610-rate-limit-headers';
  html = lanesHtml();
  // Builds 6.12.0: on the floor the panel pops out of the card, stamped with where it is and how it moves.
  assert.match(html, /class="ln-body fl-body"><div class="fl-floor">/);
  assert.match(html, /<div class="fl-pop k-build" role="dialog" aria-label="Details" data-pop-for="41610-rate-limit-headers"><div class="fl-pin"><p class="fl-stamp m-gate"><span class="fl-sdot" aria-hidden="true"><\/span>Code line, Loading dock<span class="fl-sword">Waiting at the gate for you<\/span><\/p><aside class="ln-panel"/);
  S.view.lanes = 'list';
  assert.equal(laneView(), 'list');
  html = lanesHtml();
  assert.match(html, /class="fl-list"/);
  assert.match(html, /<aside class="ln-panel"/);
  S.view.lanes = 'rows';
  assert.equal(laneView(), 'list', "6.6's List value still opens List");
});

test('Publish all ready sits by the code line on the floor, and atop Needs you in List', () => {
  S.D.publish = { '41610-rate-limit-headers': { ready: true, questions: [], published: null, pushed: false, ui: [] } };
  const pub = /data-publish-all="1"[^>]*>Publish all ready \(1\)</;
  const html = floorHtml(lanesData('all'), '', '');
  assert.match(html.slice(html.indexOf('fl-code'), html.indexOf('fl-stations')), pub);
  S.view.lanes = 'list';
  const list = lanesHtml();
  assert.match(list.slice(list.indexOf('aria-label="Needs you"'), list.indexOf('fl-rows')), pub);
});

test('the research line always shows, even with nothing on it; requests, hand-offs and reviews sit under the lines', () => {
  S.D.items = S.D.items.filter(i => i.kind === 'item');
  let html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /<section class="fl-line fl-paper" aria-label="Research line"><header class="fl-lh"><h2>Research line<\/h2>/);
  assert.match(html, /<span class="fl-name">Investigate<\/span>/);
  assert.match(html, /<span class="fl-ln">0 items<\/span>/);
  assert.doesNotMatch(html, /data-floor-paper/);
  setBoardFeed([{ id: 'w_1', title: 'Bulk resend <b>', adoId: null, kind: 'request', lane: 'clarify', mine: true, action: 'Brief ready', status: 'Brief', at: 2 }]);
  html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /<section class="fl-other" aria-label="Also waiting"><h2>Also on the floor<\/h2>/);
  assert.match(html, /data-lane-open="board:w_1"/);
  assert.match(html, /Bulk resend &lt;b&gt;/, 'titles are escaped');
});

// Builds 6.5.0 (eng-agents Core 4.10.0, connector 1.23.0): epics hand off to builds; products onboard as new lines.
function addStory(folder, id, n, stage, deps = []) {
  const base = S.D.items.find(i => i.folder === '41207-fix-login-timeout');
  S.D.items.push({ ...clone(base), folder, id, title: 'Story ' + n, stage, bucket: 'active', paused: false, blocked: null,
    story: { epic: 'scope-ws', story: n, dependsOn: deps, repos: ['api'], areas: ['api/src'], breakdown: true } });
}

test('stories wear the brand outline; one not started yet rides the hand-off belt; a tracker card per epic', () => {
  addStory('L50-create', 'L50', '1.1', 'build');
  addStory('L51-invite', 'L51', '1.2', 'start', ['L50']);
  S.D.epics = [{ folder: 'scope-ws', title: 'Team workspaces', asked: '2026-11-19T10:00:00Z', total: 2, ready: 0,
    stories: [{ folder: 'L50-create', id: 'L50', story: '1.1', title: 'Story 1.1', stage: 'build' }, { folder: 'L51-invite', id: 'L51', story: '1.2', title: 'Story 1.2', stage: 'start' }] }];
  const fd = floorData(lanesData('all'));
  assert.deepEqual(fd.belt.map(c => c.folder), ['L51-invite']);
  assert.ok(fd.code.find(s => s.id === 'build').cards.some(c => c.folder === 'L50-create'));
  assert.deepEqual(fd.epics[0].stories.map(x => [x.story, x.at, x.atName]), [['1.1', 'build', 'Build bay'], ['1.2', 'belt', 'On the belt']]);
  const html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /class="fl-card k-build story m-idle"[^>]*data-lane-open="L50-create"[^>]*>.*?Story 1\.1/);
  assert.match(html, /aria-label="Hand-off belt: stories from approved breakdowns, waiting to start"/);
  assert.match(html, /<article class="fl-epic" aria-label="Epic Team workspaces">.*?<span class="fl-eready">0 of 2 ready<\/span>/);
  assert.match(html, /data-lane-open="L51-invite"><span class="fl-sid">1\.2<\/span><span class="fl-stitle">Story 1\.2<\/span><span class="fl-sat at-belt">On the belt<\/span>/);
  assert.ok(html.indexOf('fl-handoff') > html.indexOf('fl-code') && html.indexOf('fl-handoff') < html.indexOf('fl-paper'), 'between the code line and the paper line');
});

test('an epic with an approved breakdown offers Build the stories here; once asked, it says how far along it is', () => {
  const ep = { folder: 'scope-ws', kind: 'scope', title: 'Team workspaces', state: 'Milestones approved', files: [] };
  assert.match(epicPanelHtml(ep), /data-epic-build="scope-ws">Build the stories here</);
  assert.equal(epicPanelHtml({ ...ep, state: 'Stories in review' }), '', 'not before the breakdown is approved');
  S.D.epics = [{ folder: 'scope-ws', title: 'Team workspaces', asked: '2026-11-19T10:00:00Z', total: 3, ready: 1, stories: [] }];
  const html = epicPanelHtml(ep);
  assert.match(html, /1 of 3 stories ready to publish/);
  assert.doesNotMatch(html, /data-epic-build/);
  assert.equal(epicPanelHtml(S.D.items.find(i => i.folder === '41207-fix-login-timeout')), '', 'only epics');
});

test('products being onboarded are new lines on top, their five steps lit, gaps and the trial run one click away', () => {
  S.D.onboarding = [{ product: 'Sample <Portal>', gaps: 2, repos: ['api'], live: null, trial: { folder: '41207-fix-login-timeout', id: 'L52', stage: 'build' },
    steps: [{ id: 'add', name: 'Add', st: 'done' }, { id: 'scan', name: 'Scan', st: 'done' }, { id: 'gaps', name: 'Fill the gaps', st: 'now' }, { id: 'trial', name: 'Trial run', st: 'now' }, { id: 'live', name: 'Live', st: 'next' }] },
    { product: 'Billing', gaps: 0, live: '2026-11-19', trial: null, steps: [{ id: 'add', name: 'Add', st: 'done' }, { id: 'live', name: 'Live', st: 'done' }] }];
  const html = floorHtml(lanesData('all'), '', '');
  assert.ok(html.indexOf('fl-stage') < html.indexOf('fl-new'), 'the stage (both lines) comes first; new lines sit under it (Builds 6.12.0)');
  assert.match(html, /<span class="fl-nlname">Sample &lt;Portal&gt;<\/span>/);
  assert.match(html, /<li class="fl-step now" aria-label="Fill the gaps: now">/);
  assert.match(html, /<li class="fl-step next" aria-label="Live: next">/);
  assert.match(html, /data-lane-filter="teach">2 gaps to answer</);
  assert.match(html, /data-lane-open="41207-fix-login-timeout">Trial run L52</);
  assert.match(html, /<span class="fl-live">Live<\/span><button type="button" class="lnk plain" data-onboard-dismiss="Billing">Hide</);
});

test('Hide on setup hides every onboarding section at once: New lines and Getting set up', async () => {
  const { onboardHtml } = await import('../js/runs/view.js');
  S.D.onboarding = [{ product: 'Billing', gaps: 0, live: null, trial: null, steps: [{ id: 'add', name: 'Add', st: 'done' }] }];
  assert.match(floorHtml(lanesData('all'), '', ''), /<h2>New lines<\/h2><button type="button" class="lnk plain" data-setup-hide="1"/);
  S.view.hideSetup = true;
  assert.doesNotMatch(floorHtml(lanesData('all'), '', ''), /fl-new/);
  assert.equal(onboardHtml(), '');
});

// Builds 6.6.0 (eng-agents Core 4.12.0, connector 1.24.0).
test("Tandem's step.md places a build at its station, when it fits the item's stage", () => {
  const it = S.D.items.find(i => i.folder === '41207-fix-login-timeout');
  S.L.sessions.ses_0001abc.activity = 'Reading files';
  it.step = { name: 'test', at: '2026-10-21T11:50:00Z' };
  assert.equal(stationOf(card(it.folder)), 'test', 'no guessing: step.md says test');
  it.step = { name: 'ui', at: '2026-10-21T11:50:00Z' };
  assert.equal(toldStep(it), 'ui', 'eng-agents Core 4.15.0: a task checks its own pages while it builds');
  assert.equal(stationOf(card(it.folder)), 'ui');
  it.step = { name: 'build', at: '2026-10-21T11:50:00Z' };
  S.D.reviews = { [it.folder]: { 'web-app': { status: 'revising', revision: 1, sentBack: 2 } } };
  assert.equal(stationOf(card(it.folder)), 'fix', 'a Send back builds its fix tasks in the Fix shop');
  assert.match(floorHtml(lanesData('all'), '', ''), /class="fl-tst sb" aria-hidden="true">Your comments: 2</);
  delete S.D.reviews;
  it.step = { name: 'ui', at: '2026-10-21T11:50:00Z' };
  it.stage = 'review';
  assert.equal(stationOf(card(it.folder)), 'ui');
  it.step = { name: 'fix', at: '2026-10-21T11:50:00Z' };
  assert.equal(stationOf(card(it.folder)), 'fix');
});

test('cards carry their project color once you have projects', () => {
  let html = floorHtml(lanesData('all'), '', '');
  assert.doesNotMatch(html, /class="fl-proj"/, 'no projects: no swatch');
  S.D.projects = { projects: [{ id: 'inbox', name: 'Inbox', color: 'slate', builtIn: true }, { id: 'atlas', name: 'Atlas', color: 'teal' }], runs: { '41207-fix-login-timeout': 'atlas' }, colors: ['slate', 'teal'] };
  html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /data-lane-open="41207-fix-login-timeout"[^>]*><span class="fl-ctop"><span class="fl-proj" title="Atlas"><span class="sw" data-c="teal"/);
  assert.match(html, /data-lane-open="41300-export-retry-fails"[^>]*><span class="fl-ctop"><span class="fl-id">/, 'a run in no project has none');
});

test('List is rows grouped Needs you, Running and Also waiting, each with its station track', () => {
  const groups = rowsData(lanesData('all'));
  assert.deepEqual(groups.map(g => g.id), ['mine', 'running']);
  const pub = groups[0].rows.find(r => r.c.folder === '41610-rate-limit-headers');
  assert.equal(pub.where, 'Loading dock');
  assert.deepEqual(pub.track.map(t => t.st), ['done', 'done', 'done', 'done', 'done', 'done', 'now', 'next']);
  const stuck = groups[0].rows.find(r => r.c.folder === '41502-csv-export');
  assert.equal(stuck.where, 'Pulled off the line');
  assert.ok(stuck.track.some(t => t.st === 'stuck'), 'the station it stopped at is marked');
  const spike = groups[0].rows.find(r => r.c.folder === 'spike-cache-options');
  assert.equal(spike.track.length, 5, 'paper runs use the research line');
  S.view.lanes = 'list';
  let html = lanesHtml();
  assert.match(html, /data-lane-view="list" aria-pressed="true">List</);
  assert.match(html, /<section class="fl-rgroup" aria-label="Needs you"><h2>Needs you <span class="fl-ln">\d+<\/span><\/h2>/);
  assert.match(html, /class="fl-rowb mine" data-lane-open="41610-rate-limit-headers" data-lane="ready"[^>]*>.*?<span class="fl-rwhere">Loading dock<\/span>/);
});

test('Onboard a product lists your products with repos that are not onboarding yet; a pick starts it', () => {
  let html = lanesHtml();
  assert.match(html, /data-onboard-toggle="1" aria-expanded="false"><span>Onboard a product</);
  assert.equal(onboardPickHtml(), '', 'closed until opened');
  S.ui.onboardPick = true;
  S.products = [{ name: 'Sample Portal', repos: ['api'] }, { name: 'No repos', repos: [] }, { name: 'Old', repos: ['x'], archived: true }, { name: 'Billing', repos: ['b', 'c'] }];
  S.D.onboarding = [{ product: 'billing', steps: [] }];
  html = onboardPickHtml();
  assert.match(html, /data-onboard-go="Sample Portal"><span class="ln-ptitle">Sample Portal<\/span><span class="ln-ptype">1 repo<\/span>/);
  assert.doesNotMatch(html, /No repos|Old|Billing/);
  S.products = [];
  assert.match(onboardPickHtml(), /All onboarded/);
  assert.doesNotMatch(onboardPickHtml(), /ln-pnote/, 'the explanation is behind a ? hint, not a paragraph');
});

test('regression tests on the floor (Builds 6.8.0): cards show failing, flaky or added tests; backfill items are marked Tests', () => {
  const it = S.D.items.find(i => i.folder === '41207-fix-login-timeout');
  assert.equal(testsBadge(it), null, 'no badge before the suite runs');
  it.tests = { verdict: 'fail', passed: 40, failed: 2, flaky: 0, newTests: 1, acceptance: ['AC-1'], at: '2026-10-21T11:50:00Z' };
  assert.match(floorHtml(lanesData('all'), '', ''), /<span class="fl-title">[^<]*<\/span><span class="fl-tst bad" aria-hidden="true">2 tests failing<\/span>/);
  assert.match(floorHtml(lanesData('all'), '', ''), /aria-label="[^"]*\. 2 tests failing/);
  it.tests = { ...it.tests, verdict: 'pass', failed: 0, flaky: 1 };
  assert.deepEqual(testsBadge(it), { cls: 'warn', text: '1 flaky' });
  it.tests = { ...it.tests, flaky: 0, newTests: 3 };
  assert.deepEqual(testsBadge(it), { cls: 'ok', text: '+3 tests' });
  it.tests = { ...it.tests, verdict: 'skipped' };
  assert.equal(testsBadge(it), null, 'a skipped suite says nothing on the card');
  it.coverage = 'Sample Portal';
  assert.match(floorHtml(lanesData('all'), '', ''), /<span class="fl-type">Tests<\/span>/);
});

test('Add regression tests lists your products with repos; a pick runs tests.cover with the optional area', () => {
  let html = lanesHtml();
  assert.match(html, /data-cover-toggle="1" aria-expanded="false"><span>Add regression tests</);
  assert.equal(coverPickHtml(), '', 'closed until opened');
  S.ui.coverPick = true;
  S.products = [{ name: 'Sample Portal', repos: ['api'] }, { name: 'No repos', repos: [] }, { name: 'Old', repos: ['x'], archived: true }];
  html = coverPickHtml();
  assert.match(html, /data-cover-go="Sample Portal"><span class="ln-ptitle">Sample Portal<\/span>/);
  assert.match(html, /id="ln-cover-area" data-draft="lanes:cover"/);
  assert.doesNotMatch(html, /No repos|Old/);
  assert.match(lanesHtml(), /ln-cover/);
  S.products = [];
  assert.match(coverPickHtml(), /No products with repos yet/);
  assert.doesNotMatch(coverPickHtml(), /ln-pnote/);
});

test('after Publish (connector 1.28.0): In transit with what its PR waits on, Push fix is your turn, merged today is Delivered', async () => {
  const { transitBadge, shippedState } = await import('../js/runs/floor.js');
  const { agentQueue } = await import('../js/runs/summary.js');
  const { publishHtml } = await import('../js/runs/factory.js');
  const F = '41610-rate-limit-headers';
  const it = S.D.items.find(i => i.folder === F);
  const watch = over => ({ found: true, checkedAt: '2026-10-21T11:58:00Z', pr: { id: 12, url: 'https://github.com/acme/gateway/pull/12' }, ci: 'running', checks: [], review: 'waiting', comments: 0, conflict: false, merged: false, fix: null, ...over });
  S.D.publish = { [F]: { ready: true, questions: [], ui: [], published: { at: '2026-10-21T11:00:00Z', repos: [{ repo: 'gateway', branch: 'b', target: 'main', pr: null, watch: watch() }] } } };
  assert.equal(shippedState(it), 'transit');
  assert.equal(where()[F], 'code:transit');
  assert.deepEqual(transitBadge(it), { cls: 'ok', text: 'CI running' });
  const rec = S.D.publish[F].published.repos[0];
  rec.watch = watch({ ci: 'failed', checks: [{ name: 'test', state: 'failed', url: 'https://github.com/acme/gateway/runs/1' }], fix: { state: 'working', kind: 'ci' } });
  assert.deepEqual(transitBadge(it), { cls: 'bad', text: 'CI failed: fixing' });
  assert.match(publishHtml(it), /Tandem is fixing the failing CI\./);
  rec.watch.fix = { state: 'ready', text: 'bbb222 the test read the old constant' };
  assert.deepEqual(transitBadge(it), { cls: 'warn', text: 'Fix ready to push' });
  const html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /class="fl-card k-build mine m-gate"[^>]*data-lane-open="41610-rate-limit-headers"[\s\S]*?Fix ready to push[\s\S]*?<span class="fl-act">Push fix<\/span>/);
  assert.match(publishHtml(it), /data-push-fix="41610-rate-limit-headers" data-repo="gateway" data-out>Push fix <span class="out-mark" data-out="git"/);
  assert.equal(agentQueue({ items: S.D.items, publish: S.D.publish })[0].note, 'Push fix: Tandem fixed the failing CI', 'first: urgent');
  rec.watch = watch({ ci: 'passed', review: 'changes', comments: 2 });
  assert.match(publishHtml(it), /Changes requested<\/span> <a class="lnk" href="review\.html\?id=41610&amp;repo=gateway" data-review[^>]*>2 comments<\/a>/);
  assert.ok(agentQueue({ items: S.D.items, publish: S.D.publish }).some(r => r.note === 'Comments on your PR: 2'));
  // Merged today: off the line, Delivered today, Resolve in ADO for a linked item.
  rec.watch = watch({ merged: true });
  S.D.publish[F].published.merged = '2026-10-21T11:59:00Z';
  S.D.adoLinks = { [F]: { linked: true, ado: '41610', was: null } };
  const fd = floorHtml(lanesData('all'), '', '');
  assert.doesNotMatch(fd, /data-lane-open="41610-rate-limit-headers"/);
  assert.match(fd, /data-lane-delivered="1" aria-expanded="false">Delivered today: 1</);
  assert.match(publishHtml(it), /Merged<\/span>[\s\S]*data-ado-resolve="41610-rate-limit-headers" data-ado="41610" data-out>Resolve in ADO/);
  delete S.D.publish;
  delete S.D.adoLinks;
});

test('motion (Builds 6.12.0): working cards bob on a moving belt, your turn waits at a gate, stopped is pulled off', () => {
  const fd = floorData(lanesData('all'));
  const at = id => fd.code.concat(fd.paper).flatMap(s => s.cards).concat(fd.stuck).find(c => c.folder === id);
  assert.equal(motionOf(at('41207-fix-login-timeout')), 'run');
  assert.equal(motionOf(at('41610-rate-limit-headers')), 'gate');
  assert.equal(motionOf(at('41455-audit-log-filter')), 'idle');
  assert.equal(motionOf(at('41502-csv-export')), 'stuck', 'stuck wins over your turn');
  assert.equal(motionOf(null), 'idle');
  const html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /<section class="fl-line fl-code"[^]*?<div class="fl-belt moving"/, 'the code line runs while a build works');
  assert.match(html, /<section class="fl-line fl-paper"[^]*?<div class="fl-belt" aria-hidden/, 'the research line stands still with nothing working');
  assert.match(html, /data-lane-open="41207-fix-login-timeout"[^>]*>[^]*?<span class="fl-prog" aria-hidden="true"><\/span><\/button>/);
  assert.match(html, /class="fl-card k-build mine m-gate" data-lane-open="41610-rate-limit-headers"/);
  assert.doesNotMatch(html, /fl-gatebar|fl-arm/, 'no striped gate bars (6.13.0)');
  assert.match(html, /<div class="fl-plate you gated"><span class="fl-name">/);
});

test('needs you (Builds 6.15.0): each line says how many cards wait on you', () => {
  const html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /<section class="fl-line fl-code"[^]*?<span class="fl-need"><span class="fl-ndot" aria-hidden="true"><\/span>\d+ needs? you<\/span>[^]*?<section class="fl-line fl-paper"/);
  assert.match(html, /<section class="fl-line fl-paper"[^]*?<span class="fl-need">/);
});

test("Builds 6.17.0: the open card shows its docs (Notes' links, Builds' own, the product note); Link a doc opens a search", async () => {
  const { readNotes, linksOf, withLink, blank } = await import('../js/runs/docs.js');
  S.products = [{ id: 'p_shop', name: 'Shop', slug: 'shop', repos: [], areas: [] }];
  S.docs = {
    notesDocs: readNotes({ schema: 'notes.summary', version: 1, items: [
      { id: 'docs', kind: 'list', title: 'Docs', rows: [{ id: 'plans/limits.md', title: 'Rate limits plan', note: 'Plan', product: 'shop' }, { id: 'products/shop.md', title: 'Shop', note: 'Product note', product: 'shop' }] },
      { id: 'mentions', kind: 'list', title: 'M', rows: [{ id: 'x', title: 'Rate limits plan', route: 'plans/limits.md', note: 'builds/41610' }] }] }),
    links: linksOf(withLink(blank(), '41610-rate-limit-headers', 'plans/more.md', true))
  };
  S.ui.laneSel = '41610-rate-limit-headers';
  let html = lanesHtml();
  assert.match(html, /class="dc-row" aria-label="Docs"/);
  assert.match(html, /data-doc-open="products\/shop.md"/, "the plan doc's product names the product note");
  assert.match(html, /data-doc-open="plans\/limits.md"/);
  assert.match(html, /data-doc-unlink="plans\/more.md"/);
  assert.doesNotMatch(html, /data-doc-unlink="plans\/limits.md"/, 'a link written in the doc is changed in the doc');
  assert.doesNotMatch(html, /dc-pick/);
  S.ui.docPick = '41610-rate-limit-headers';
  html = lanesHtml();
  assert.match(html, /class="ln-pick dc-pick"/);
  // Without Notes: no Link a doc, and nothing when nothing is linked.
  S.docs = { notesDocs: readNotes(null), links: new Map() };
  S.products = [];
  assert.doesNotMatch(lanesHtml(), /class="dc-row"/);
  delete S.docs; S.ui.docPick = null;
});

test('flowSummary: the floor for the shell\'s agents dock, every card with its line, station index and state (Builds 6.21.0)', () => {
  const fd = floorData(lanesData('all'));
  const f = flowSummary(fd);
  assert.deepEqual(f.lines.code, CODE.map(s => s.name));
  assert.deepEqual(f.lines.paper, PAPER.map(s => s.name));
  const onLines = fd.code.concat(fd.paper).reduce((n, s) => n + s.cards.length, 0) + fd.express.length + fd.belt.length + fd.stuck.length;
  assert.equal(f.items.length, onLines, 'every card on a line, the belt or the stuck bin; nothing from Also on the floor');
  for (const it of f.items) {
    assert.ok(['run', 'gate', 'stuck', 'idle'].includes(it.state), it.state);
    assert.ok(it.at >= -1 && it.at < f.lines[it.line].length, `${it.title} at ${it.at}`);
    if (it.at >= 0) assert.equal(it.station, f.lines[it.line][it.at]);
  }
  for (const c of fd.stuck) assert.ok(f.items.some(it => it.title === c.title && it.state === 'stuck' && it.at === -1), c.title);
  const gate = fd.code.concat(fd.paper).flatMap(s => s.cards).find(c => c.mine);
  if (gate) assert.equal(f.items.find(it => it.title === gate.title).state, 'gate');
  assert.equal(floorEmpty(fd), false);
});

test('an empty floor is calm: one row of station names per line, not thirteen stations of 0 (Builds 6.21.0)', () => {
  S.D.items = [];
  S.L.sessions = {};
  const data = lanesData('all');
  const fd = floorData(data);
  assert.ok(floorEmpty(fd), JSON.stringify({ other: fd.other.map(c => c.kind), epics: (fd.epics || []).length, onb: (fd.onboarding || []).length }));
  const html = floorHtml(data, '', '');
  assert.match(html, /The floor is quiet\./);
  assert.doesNotMatch(html, /fl-stage/);
  assert.match(html, /<span class="fl-calm-name">Code line<\/span>/);
  assert.equal(flowSummary(fd).items.length, 0);
});

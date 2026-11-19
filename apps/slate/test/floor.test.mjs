// Loom 6.4.0 floor (js/dispatch/floor.js; plan: claude/loom-floor-v1-plan.md in the Workshop project): the lanes'
// cards drawn as stations on a code line and a paper line, stuck cards in their own bin, Floor or List. On the
// synthetic fixture.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/dispatch/state.js';
import { lanesData, lanesHtml, laneView } from '../js/dispatch/lanes.js';
import { CODE, PAPER, STACK_MAX, lineOf, stationOf, floorData, floorHtml, epicPanelHtml } from '../js/dispatch/floor.js';
import { setBoardFeed } from '../js/loom.js';

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

test('two lines: the code line ends at the Loading dock, the paper line at the Out tray; your gates are the ends', () => {
  assert.deepEqual(CODE.map(s => s.id), ['plan', 'build', 'test', 'ui', 'review', 'fix', 'dock']);
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
  assert.match(html, /<div class="fl-plate busy"><span class="fl-name">Build bay<\/span><span class="fl-sub">2 building, 1 queued<\/span>/);
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

test('Floor is the default; List shows the four lanes; a card opens the same panel either way', () => {
  assert.equal(laneView(), 'floor');
  let html = lanesHtml();
  assert.match(html, /data-lane-view="floor" aria-pressed="true"/);
  assert.match(html, /class="fl-floor"/);
  assert.doesNotMatch(html, /class="ln-lanes"/);
  assert.match(html, /<button type="button" class="fl-card k-build mine" data-lane-open="41610-rate-limit-headers"[^>]*>.*?<span class="fl-act">Publish<\/span>/);
  S.ui.laneSel = '41610-rate-limit-headers';
  html = lanesHtml();
  assert.match(html, /class="ln-body fl-body has-panel"/);
  assert.match(html, /<aside class="ln-panel"/);
  S.view.lanes = 'list';
  assert.equal(laneView(), 'list');
  html = lanesHtml();
  assert.match(html, /class="ln-lanes"/);
  assert.match(html, /data-lane-view="list" aria-pressed="true"/);
});

test('the paper line folds when nothing is on it; requests, hand-offs and reviews sit under the lines', () => {
  S.D.items = S.D.items.filter(i => i.kind === 'item');
  let html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /Paper line: nothing running\. <button type="button" class="lnk plain" data-floor-paper="1">Show it<\/button>/);
  S.ui.floorPaper = true;
  html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /class="fl-line fl-paper"/);
  setBoardFeed([{ id: 'w_1', title: 'Bulk resend <b>', adoId: null, kind: 'request', lane: 'clarify', mine: true, action: 'Brief ready', status: 'Brief', at: 2 }]);
  html = floorHtml(lanesData('all'), '', '');
  assert.match(html, /<section class="fl-other" aria-label="Also waiting"><h2>Also on the floor<\/h2>/);
  assert.match(html, /data-lane-open="board:w_1"/);
  assert.match(html, /Bulk resend &lt;b&gt;/, 'titles are escaped');
});

// Loom 6.5.0 (eng-agents Core 4.10.0, connector 1.23.0): epics hand off to builds; products onboard as new lines.
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
  assert.match(html, /class="fl-card k-build story"[^>]*data-lane-open="L50-create"[^>]*>.*?Story 1\.1/);
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
  assert.ok(html.indexOf('fl-new') < html.indexOf('fl-code'), 'new lines sit above the code line');
  assert.match(html, /<span class="fl-nlname">Sample &lt;Portal&gt;<\/span>/);
  assert.match(html, /<li class="fl-step now" aria-label="Fill the gaps: now">/);
  assert.match(html, /<li class="fl-step next" aria-label="Live: next">/);
  assert.match(html, /data-lane-filter="teach">2 gaps to answer</);
  assert.match(html, /data-lane-open="41207-fix-login-timeout">Trial run L52</);
  assert.match(html, /<span class="fl-live">Live<\/span><button type="button" class="lnk plain" data-onboard-dismiss="Billing">Hide</);
});

// Builds 6.2.0: the software factory's views (js/runs/factory.js) on the connector's state for docs/examples/work
// (fixtures/state.json) plus 1.21.0's gaps, publish and overlaps.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/runs/state.js';
import { teachHtml, teachCount, teachBlocking, publishHtml, publishAllHtml, readyClean, overlapHtml, publishItems } from '../js/runs/factory.js';
import { lanesHtml } from '../js/runs/lanes.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const item = folder => S.D.items.find(i => i.folder === folder);
const READY = '41610-rate-limit-headers';

beforeEach(() => {
  S.D = clone(FIXTURE);
  S.L = S.D.liveMode.live;
  S.conn = 'on';
  S.connector = { state: 'ready', message: null };
  S.mode = 'local';
  S.embedded = true;
  S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20';
  resetUi();
  S.D.gaps = { open: [
    { id: 'G2', n: 2, date: '2026-11-18', kind: 'term', product: null, source: null, question: 'What is a plan year?', assumed: 'CoverageYear', status: 'open', sent: null },
    { id: 'G1', n: 1, date: '2026-11-18', kind: 'fact', product: 'Portal', source: '41207', question: 'May a refund exceed the total?', assumed: null, status: 'open', sent: null }
  ], answered: 0 };
  S.D.publish = { [READY]: { ready: true, questions: [], published: null, pushed: false, ui: [
    { name: 'after', verdict: 'pass', reason: '1 page at 2 widths, 1 changed since before', changed: ['/ at 1280px'], problems: [], pages: [{ path: '/', width: 1280, file: 'after/home-1280.png', diff: 'diff/home-1280.png', changedPct: 2.5 }] },
    { name: 'before', verdict: 'pass', reason: null, changed: [], problems: [], pages: [{ path: '/', width: 1280, file: 'before/home-1280.png', diff: null, changedPct: null }] }
  ] } };
});

test('Teach: blocking gaps first, an answer box each, and the chip count', () => {
  assert.equal(teachCount(), 2);
  assert.equal(teachBlocking(), 1);
  const html = teachHtml();
  assert.ok(html.indexOf('May a refund') < html.indexOf('What is a plan year'), 'the gap a build waits on comes first');
  assert.match(html, /A build is waiting on this/);
  assert.match(html, /Tandem assumed: CoverageYear/);
  assert.match(html, /data-draft="teach:G1"/);
  assert.match(html, /data-teach="G1"/);
  S.D.gaps.open[1].sent = '2026-11-18T10:00:00Z';
  assert.match(teachHtml(), /Saving your answer/);
  assert.equal(teachBlocking(), 0);
  S.ui.laneFilter = 'teach';
  assert.match(lanesHtml(), /data-lane-filter="teach" aria-pressed="true">Teach<span class="n">2</);
});

test('Publish: a ready build shows its UI checks and one Publish button; Publish all ready counts it', () => {
  const it = item(READY);
  const html = publishHtml(it);
  assert.match(html, /Ready to publish/);
  assert.match(html, /UI checks passed/);
  assert.match(html, /data-ui-shot="41610-rate-limit-headers\|after\/home-1280.png" data-ui-before="before\/home-1280.png" data-ui-diff="diff\/home-1280.png"/);
  assert.match(html, /2.5% changed/);
  assert.match(html, /data-publish="41610-rate-limit-headers"/);
  assert.equal(readyClean(it), true);
  assert.match(publishAllHtml(S.D.items), /Publish all ready \(1\)/);
  assert.ok(publishItems(it).length >= 1);
  // A question from the review keeps it out of Publish all ready, but not out of Publish.
  S.D.publish[READY].questions = ['`api/a.cs:3`: is a null total possible?'];
  assert.equal(readyClean(it), false);
  assert.equal(publishAllHtml(S.D.items), '');
  assert.match(publishHtml(it), /Questions from the review/);
  // Published: the PR links, no button.
  S.D.publish[READY].published = { at: '2026-11-18T12:00:00Z', repos: [{ repo: 'gateway', branch: 'b', target: 'main', pr: 'https://dev.azure.com/x/_git/gateway/pullrequestcreate?sourceRef=b&targetRef=main' }] };
  const done = publishHtml(it);
  assert.match(done, /Published/);
  assert.match(done, /In transit: Workshop follows each PR until it merges/);
  assert.match(done, /<a class="btn small" href="https:\/\/dev\.azure\.com\/x\/_git\/gateway\/pullrequestcreate[^"]*" target="_blank" rel="noopener">Create the PR<\/a>/, 'until the watcher finds the PR');
  assert.doesNotMatch(done, /data-publish=/);
});

test('Overlap: at approval, Approve and build after the other run', () => {
  const gate = S.D.items.find(i => i.next && i.next.command && /^\/approve\b/.test(i.next.command));
  const other = S.D.items.find(i => i.kind === 'item' && i !== gate);
  assert.equal(overlapHtml(gate), '');
  S.D.overlaps = { [gate.folder]: [{ with: other.folder, files: ['web-app/src/renew.ts'] }] };
  const html = overlapHtml(gate);
  assert.match(html, /Same files as another build/);
  assert.match(html, new RegExp(`data-auto-after="${gate.folder}" data-after="${other.folder}"`));
  assert.match(html, /web-app\/src\/renew.ts/);
  assert.equal(overlapHtml(other), '', 'only at an approval');
});

test('Publish: the regression suite shows passed, new tests and the criteria they cover; a failure keeps it out of Publish all ready (Builds 6.8.0)', () => {
  const p = S.D.publish[READY];
  const run = (over) => ({ name: 'after', verdict: 'pass', reason: null, passed: 48, failed: 0, flaky: 1, skipped: 0, failures: [], preExisting: [], flakyTests: [{ file: 'orders.spec.ts', title: 'Orders > lists' }], newTests: [{ file: 'refund.spec.ts', title: 'saves [AC-1]' }, { file: 'refund.spec.ts', title: 'shows [AC-2]' }], acceptance: ['AC-1', 'AC-2'], ...over });
  p.tests = [run({ name: 'before', verdict: 'fail' }), run()];
  let html = publishHtml(item(READY));
  assert.match(html, /Regression tests passed<\/span> 48 passed, 2 new tests covering AC-1, AC-2, 1 flaky\./);
  assert.match(html, /Flaky \(passed on a retry\)/);
  assert.ok(readyClean(item(READY)), 'a failing before run does not hold Publish all ready');
  p.tests = [run({ verdict: 'fail', failed: 1, failures: [{ file: 'orders.spec.ts', title: 'Orders > exports csv', error: 'Expected 3 rows' }] })];
  html = publishHtml(item(READY));
  assert.match(html, /1 test failing/);
  assert.match(html, /Orders &gt; exports csv/);
  assert.equal(readyClean(item(READY)), false);
  p.tests = [run({ verdict: 'skipped', reason: 'no Playwright report' })];
  assert.match(publishHtml(item(READY)), /Regression tests skipped<\/span> no Playwright report/);
  p.tests = [];
  assert.doesNotMatch(publishHtml(item(READY)), /Regression tests/);
});

test('Publish: the code per repo (connector 1.28.0): its size, Review the code, and what keeps it out of Publish all ready', () => {
  const p = S.D.publish[READY];
  const it = item(READY);
  const was = S.conn;
  S.conn = 'on';
  p.published = null;
  p.questions = [];
  p.diff = [{ repo: 'gateway', files: 8, additions: 214, deletions: 37 }];
  p.review = { gateway: { status: 'awaiting_review', revision: 2, sentBack: 0, openMustFix: 0 } };
  let html = publishHtml(it);
  assert.match(html, /<span class="mono">gateway<\/span> 8 files, <span class="add">\+214<\/span> <span class="del">-37<\/span> <span class="dim">revision 2<\/span><a class="btn small" href="review\.html\?id=41610&amp;repo=gateway" data-review/);
  assert.match(html, /Optional: Publish works without opening it\./);
  assert.equal(readyClean(it), true);
  p.openMustFix = 1;
  assert.match(publishHtml(it), /Tandem declined 1 must fix comment\./);
  assert.equal(readyClean(it), false, 'a declined must fix keeps it out of Publish all ready');
  p.openMustFix = 0;
  p.revising = true;
  assert.equal(readyClean(it), false, 'comments waiting on Tandem');
  p.revising = false;
  p.diff = [{ repo: 'gateway', files: null, additions: null, deletions: null }];
  assert.match(publishHtml(it), /counting the change/);
  S.conn = 'off';
  assert.doesNotMatch(publishHtml(it), /Review the code/, 'the code review needs the connector');
  S.conn = was;
  delete p.diff;
  delete p.review;
});

test('Try it (connector 1.28.0): start, starting, Open the app and Stop, a failure with Try again', async () => {
  const { tryItHtml } = await import('../js/runs/factory.js');
  const it = item(READY);
  assert.match(tryItHtml(it), /data-try="41610-rate-limit-headers"[^>]*>Try it</);
  S.D.previews = { [READY]: { status: 'starting', url: null } };
  assert.match(tryItHtml(it), /Starting the app/);
  S.D.previews[READY] = { status: 'running', url: 'http://127.0.0.1:5173' };
  assert.match(tryItHtml(it), /<a class="btn" href="http:\/\/127\.0\.0\.1:5173" target="_blank" rel="noopener"[^>]*>Open the app<\/a>/);
  assert.match(tryItHtml(it), /data-try-stop="41610-rate-limit-headers"/);
  S.D.previews[READY] = { status: 'failed', message: 'No UI checks table.' };
  assert.match(tryItHtml(it), />Try again<\/button><span class="flag warn">No UI checks table\.<\/span>/);
  assert.match(publishHtml(it), /Try again/, 'in the Publish block too');
  S.conn = 'off';
  assert.equal(tryItHtml(it), '');
  S.conn = 'on';
  assert.equal(tryItHtml({ ...it, stage: 'plan' }), '', 'nothing to run before the build');
  delete S.D.previews;
});

test('merge without a PR (connector 1.29.0): Merge into main, Tandem\'s conflict fix, then merged with no PR to follow', async () => {
  const { mergeLabel } = await import('../js/runs/factory.js');
  const it = item(READY);
  S.D.publish[READY].mode = 'merge';
  let html = publishHtml(it);
  assert.match(html, /Ready to merge/);
  assert.equal(mergeLabel(it), 'Merge into main');
  assert.match(html, /data-publish="41610-rate-limit-headers"[^>]*>Merge into main <span class="out-mark" data-out="git"/);
  assert.match(html, /No PR: Settings, Factory, When you publish\./);
  S.D.publish[READY].mergeFix = { repo: 'gateway', target: 'main', state: 'working' };
  html = publishHtml(it);
  assert.match(html, /Tandem is merging main into gateway's branch\. Publish again when it is done\./);
  assert.match(html, /data-publish="41610-rate-limit-headers" disabled/);
  S.D.publish[READY].mergeFix = { repo: 'gateway', target: 'main', state: 'ready', text: 'abc1234 merged main' };
  assert.match(publishHtml(it), /Tandem merged main in<\/span> abc1234 merged main Publish again to merge\./);
  S.D.publish[READY].published = { at: '2026-11-19T12:00:00Z', mode: 'merge', merged: '2026-11-19T12:00:00Z', repos: [{ repo: 'gateway', branch: 'b', target: 'main', pr: null, merged: '0123456789abcdef' }] };
  html = publishHtml(it);
  assert.match(html, /Merged<\/span> [^<]*, no PR\. Done:/);
  assert.match(html, /<span class="mono">gateway<\/span> <span class="dim">b into main<\/span> <span class="mono dim">01234567<\/span>/);
  assert.doesNotMatch(html, /In transit|Create the PR/);
});

// Loom 6.2.0: the software factory's views (js/dispatch/factory.js) on the connector's state for docs/examples/work
// (fixtures/state.json) plus 1.21.0's gaps, publish and overlaps.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/dispatch/state.js';
import { teachHtml, teachCount, teachBlocking, publishHtml, publishAllHtml, readyClean, overlapHtml, publishItems } from '../js/dispatch/factory.js';
import { lanesHtml } from '../js/dispatch/lanes.js';

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
  assert.match(done, /Open the PR for gateway/);
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

// Builds 6.1.0 (plan: claude/diraigent-ideas-v1-plan.md in the Workshop project): the Noticed chip lists what Tandem
// spotted out of scope (state.observations), hands-off Quick changes show Build with autopilot before the plan
// exists, and a queued build says so. On the synthetic fixture.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/runs/state.js';
import { autoStartKind, autoHtml, nextBtns } from '../js/runs/view.js';
import { lanesHtml } from '../js/runs/lanes.js';
import { noticedHtml, noticedCount, observationTask, startArgsOf } from '../js/runs/noticed.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const OBS = [
  { id: 'O2', n: 2, date: '2026-11-18', kind: 'docs', repo: null, source: null, text: 'README still says <Node 18>' },
  { id: 'O1', n: 1, date: '2026-11-18', kind: 'bug', repo: 'gateway', source: '41207', text: 'Timeout is swallowed in RetryPolicy' }
];
beforeEach(() => {
  S.D = clone(FIXTURE);
  S.L = S.D.liveMode.live;
  S.conn = 'on';
  S.connector = { state: 'ready', message: null };
  S.mode = 'local'; S.embedded = true; S.canNotify = false;
  S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20';
  S.copyStore = []; S.files = {}; S.builds = new Map();
  resetUi();
  S.ui.tab = 'lanes';
  S.view = { project: 'all', lanes: 'list' }; // these tests read the List view (rows since 6.7.0); floor.test.mjs reads the Floor
});

test('Noticed: a chip with the count, and the list in place of the lanes, escaped, with Start, To Tasks and Dismiss', () => {
  S.D.observations = { open: OBS, handled: 3 };
  assert.equal(noticedCount(), 2);
  let html = lanesHtml();
  assert.match(html, /data-lane-filter="noticed"[^>]*>Noticed<span class="n">2<\/span>/);
  assert.match(html, /class="fl-list"/, 'the list shows until the chip is on');
  S.ui.laneFilter = 'noticed';
  html = lanesHtml();
  assert.doesNotMatch(html, /class="fl-list"/);
  assert.match(html, /README still says &lt;Node 18&gt;/);
  assert.match(html, /gateway · from 41207 · 2026-11-18/);
  for (const a of ['data-obs-start="O1"', 'data-obs-tasks="O1"', 'data-obs-dismiss="O2"']) assert.ok(html.includes(a), a);
});

test('Noticed: empty says what it is for; no observations in state counts 0', () => {
  delete S.D.observations;
  assert.equal(noticedCount(), 0);
  assert.match(noticedHtml(), /Nothing noticed right now/);
});

test('To Tasks is an accepted task offer; Start sends the same title and description as the connector', () => {
  const offer = observationTask(OBS[1], new Date('2026-11-18T15:00:00Z'));
  assert.deepEqual(offer, {
    id: 'h_obs_O1', to: 'tasks', date: '2026-11-18', createdAt: '2026-11-18T15:00:00.000Z', text: 'Timeout is swallowed in RetryPolicy', accepted: true,
    payload: { kind: 'task', title: 'Timeout is swallowed in RetryPolicy', notes: 'Noticed by Tandem (O1, 2026-11-18, while working on 41207).\nRepo: gateway' },
    source: { app: 'builds', id: 'obs-O1' }
  });
  assert.deepEqual(startArgsOf(OBS[1]), { title: 'Timeout is swallowed in RetryPolicy', description: 'Timeout is swallowed in RetryPolicy\n\nNoticed by Tandem (O1, 2026-11-18, while working on 41207).\nRepo: gateway', lane: 'quick' });
});

test('hands-off Quick change: Build with autopilot on a quick item before its plan is approved, only with the setting on', () => {
  const it = { kind: 'item', folder: '9-q', id: '9', lane: 'quick', gates: { quick: null }, next: { stage: 'quick', command: '/quick 9' } };
  S.D.autopilotOptions = { maxRuns: 2, quickHandsOff: false };
  assert.equal(autoStartKind(it), null);
  S.D.autopilotOptions.quickHandsOff = true;
  assert.equal(autoStartKind(it), 'start');
  assert.equal(autoStartKind({ ...it, gates: { quick: 'DRAFT' }, next: { stage: 'quick', command: '/approve 9' } }), 'start', 'a draft plan: autopilot approves it only if clean');
  assert.equal(autoStartKind({ ...it, lane: 'feature', gates: { plan: null }, next: { stage: 'spec', command: '/spec 9' } }), null, 'other lanes keep their gate');
});

test('a queued build shows Autopilot queued with its message and Cancel, and no start buttons', () => {
  const it = S.D.items.find(i => i.kind === 'item');
  S.L.autopilot = { [it.folder]: { status: 'queued', message: 'Queued: 2 builds are running. It starts when one finishes.', log: [] } };
  const html = autoHtml(it);
  assert.match(html, /Autopilot queued/);
  assert.match(html, /Queued: 2 builds are running/);
  assert.match(html, /data-act="stop"[^>]*>Cancel</);
  assert.equal(nextBtns(it), '');
});

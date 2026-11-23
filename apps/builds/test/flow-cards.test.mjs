// Builds flow cards v1 (claude/loom-flow-cards-v1-plan.md in the Workshop project): the board's forks (triage, brief,
// Who builds it?), the hand-off nudge, triage's suggested path, Start work filled in from findings or a route, and
// the seam that hands the board flows (Handle a request, Hand to a person) to the board half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOf, panelHtml } from '../js/view.js';
import { cleanItem, cleanPrefs, newItem, parseTriage, setStage, shapeState, stalledHandoffs, workingDaysBetween, NUDGE_DAYS } from '../js/model.js';
import { prefillFor, closedLine, closedWith, safeDecode } from '../js/runs/start-prefill.js';
import { boardCommand, onBoardCommand, setNudges, currentNudges, onNudges } from '../js/board.js';

const base = (item, extra = {}) => ({
  item, dev: false, files: {}, draft: { kind: null }, editing: false, shapeEditing: null, shape: shapeState({}), back: [], triage: null,
  agent: null, column: 'new', run: null, assigneeName: '', owners: [], age: 0, details: null, prefs: cleanPrefs(), error: '', ...extra
});
const acts = n => (n.shown || []).map(b => /data-act="([^"]+)"/.exec(b)[1]);

test('triage fork: interview, skip to the brief, or decline; the Path line picks the suggested one', () => {
  const it = cleanItem({ ...newItem({ title: 't' }), stage: 'triaged' });
  const t = (path) => ({ summary: 's', route: 'delegate', size: 'S', repos: [], questions: [], path });
  const n = nextOf(base(it, { column: 'triage', triage: t(null) }));
  assert.ok(n.fork);
  assert.deepEqual(acts(n), ['shape', 'skip-brief', 'decline']);
  assert.match(n.shown[1], /class="fork rec"/, 'no Path line: skip to the brief is suggested');
  const iv = nextOf(base(it, { column: 'triage', triage: t('interview') }));
  assert.match(iv.shown[0], /class="fork rec" data-act="shape"/);
  assert.doesNotMatch(iv.shown[1], /rec/);
  assert.deepEqual(acts({ shown: nextOf(base(it, { column: 'triage', triage: t('decline') })).shown.filter(b => /rec/.test(b)) }), ['decline']);
  assert.ok((n.more || []).some(b => /data-act="define"/.test(b)), 'Define now is under More');
  // With questions for the requester, the step stays a pause: post or copy them, and wait.
  const q = nextOf(base(it, { column: 'triage', triage: { ...t(null), questions: ['Who uses it?'] } }));
  assert.ok(!q.fork);
  assert.ok((q.more || []).some(b => /data-act="decline"/.test(b)));
});

test('triage.md: the Path line (Core 4.2.0), first word only', () => {
  assert.equal(parseTriage('# Triage: x\n\nRoute: delegate\nSize: S\nPath: brief (the request is clear)\n').path, 'brief');
  assert.equal(parseTriage('Path: Interview\n').path, 'interview');
  assert.equal(parseTriage('Path: <interview | brief | decline>\n').path, null, 'the template placeholder');
  assert.equal(parseTriage('Route: myself\n').path, null, 'older triages have none');
});

test('brief fork: a bug brief suggests Fix it; Investigate and Hand to a person are there too', () => {
  const it = setStage(newItem({ title: 'x' }), 'brief');
  it.work = { shape: 'shape-x' };
  const files = { 'brief.md': '# Brief: x\n\nLevel: Bug\nSize: S\n\n## Problem\n\nBroken.\n' };
  const n = nextOf(base(it, { column: 'brief', files }));
  assert.deepEqual(acts(n), ['build-it', 'fix-it', 'investigate', 'hand-off', 'decline']);
  assert.match(n.shown[1], /class="fork rec" data-act="fix-it"/);
  const none = nextOf(base(it, { column: 'brief', files: {} }));
  assert.ok(!none.fork, 'no brief yet: nothing to pick');
});

test('Who builds it?: Hand to a person or Build it myself, as path cards; the route suggests one', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'decide', route: 'delegate' });
  const n = nextOf(base(it, { column: 'decide', canAdo: true, canLocal: true }));
  assert.ok(n.fork);
  assert.deepEqual(acts(n), ['delegate', 'build-local']);
  assert.match(n.shown[0], /class="fork rec" data-act="delegate"/);
});

test('the nudge: hand-offs with no movement in 3 working days, counted from the stage or your last follow-up', () => {
  assert.equal(NUDGE_DAYS, 3);
  assert.equal(workingDaysBetween('2026-11-13', '2026-11-16'), 1, 'Friday to Monday is one working day');
  assert.equal(workingDaysBetween('2026-11-10', '2026-11-13'), 3);
  assert.equal(workingDaysBetween('2026-11-16', '2026-11-16'), 0);
  assert.equal(workingDaysBetween('bad', '2026-11-16'), 0);
  const d = (id, at, extra = {}) => cleanItem({ ...newItem({ title: id }), id, stage: 'delegated', assignee: 'p_sam', history: [{ stage: 'delegated', at }], ...extra });
  const now = new Date(2026, 10, 16, 12); // Monday
  const items = [
    d('old', '2026-11-10'),
    d('fresh', '2026-11-13'),
    d('followed', '2026-11-03', { followedUp: '2026-11-13' }),
    d('merged', '2026-11-03', { merged: '2026-11-14' }),
    cleanItem({ ...newItem({ title: 'not delegated' }), stage: 'decide', history: [{ stage: 'decide', at: '2026-11-01' }] }),
    d('ado moved', '2026-11-03', { ado: { id: 5, rev: 1 }, adoNow: { rev: 2 } })
  ];
  assert.deepEqual(stalledHandoffs(items, now).map(x => [x.id, x.days]), [['old', 4]]);
  assert.deepEqual(stalledHandoffs(items, now, 1).map(x => x.id), ['old', 'fresh', 'followed']);
  assert.equal(cleanItem({ followedUp: 'nope' }).followedUp, undefined);
  // The panel says so and offers Followed up.
  const p = base(items[0], { column: 'delegated', assigneeName: 'Sam', stalled: { days: 4 } });
  const n = nextOf(p);
  assert.match(n.text, /No movement in 4 working days\. Check in with Sam/);
  assert.equal(acts(n)[0], 'followed-up');
  assert.doesNotMatch(nextOf(base(items[1], { column: 'delegated' })).text, /No movement/);
});

test('Start work filled in: from a spike\'s findings, and from a route', () => {
  const it = { folder: 'spike-cache', title: 'Cache options', summary: 'Use memory.' };
  const f = prefillFor('feature', it, '# Findings\n\nUse memory.');
  assert.equal(f.title, 'Cache options');
  assert.match(f.desc, /^Use memory\.\n\nFrom \.work\/spike-cache\/findings\.md:\n\n# Findings/);
  assert.deepEqual(prefillFor('docs', it, 'x'), { target: 'Cache options' });
  assert.deepEqual(prefillFor('spike', { title: 'Why slow?' }, ''), { topic: 'Why slow?' });
  assert.deepEqual(prefillFor('request', { title: 'Audit export', summary: 'Billing asked.' }, ''), { title: 'Audit export', desc: 'Billing asked.' });
  assert.equal(prefillFor('feature', { title: 'x'.repeat(300) }, '').title.length, 200);
  const now = new Date(2026, 10, 16);
  assert.equal(closedLine({ action: 'start.local', args: { lane: 'bug' } }, { id: 'L12' }, now), 'Closed: started L12 as a bug fix on 2026-11-16.');
  assert.equal(closedLine({ action: 'docs.start', args: {} }, null, now), 'Closed: started docs on 2026-11-16.');
  assert.equal(closedWith('nothing more to do', now), 'Closed: nothing more to do on 2026-11-16.');
  assert.equal(safeDecode('a%2Fb'), 'a/b');
  assert.equal(safeDecode('100%'), '100%', 'never throws');
});

test('the board seam: board flows go to the board half; nudges go to the Inbox', async () => {
  await assert.rejects(boardCommand('request', {}), /still loading/);
  const got = [];
  onBoardCommand((name, args) => { got.push([name, args]); return { id: 'w_1' }; });
  assert.deepEqual(await boardCommand('handoff', { title: 'x' }), { id: 'w_1' });
  assert.deepEqual(got, [['handoff', { title: 'x' }]]);
  let seen = null;
  onNudges(list => { seen = list; });
  setNudges([{ id: 'w_1', title: 'x', days: 4 }]);
  assert.equal(seen.length, 1);
  assert.equal(currentNudges()[0].days, 4);
  setNudges(null);
  assert.deepEqual(currentNudges(), []);
});

test('the panel draws a fork as path cards under the step line', () => {
  const it = cleanItem({ ...newItem({ title: 't' }), stage: 'triaged' });
  const h = panelHtml(base(it, { column: 'triage', triage: { summary: 's', route: 'delegate', size: 'S', repos: [], questions: [], path: 'brief' }, forward: [] }));
  assert.match(h, /<div class="next"><p>Triage is done and nothing is missing for the requester\. Pick the path\.<\/p><div class="forks" role="group" aria-label="Pick the next path">/);
  assert.match(h, /<span class="fk-t">Skip to the brief<span class="fk-rec">Suggested<\/span><\/span><span class="fk-d">Write the brief from the triage now, no questions\.<\/span>/);
});

test('Fix a bug from an error log: a diagnosis, configuration first (Core 4.3.0)', async () => {
  const { S, resetUi } = await import('../js/runs/state.js');
  const { render, startRequest } = await import('../js/runs/view.js');
  const { flowOf, flowTag, stepIndex, atGate, turnHtml, gateFile } = await import('../js/runs/flows.js');
  const { looksLikeLog } = await import('../js/runs/start-prefill.js');
  const fs = await import('node:fs');
  S.D = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
  S.L = S.D.liveMode.live; S.conn = 'on'; S.connector = { state: 'ready', message: null }; S.mode = 'local'; S.embedded = true;
  S.now = Date.parse('2026-10-21T12:00:00Z'); S.files = {}; S.builds = new Map(); S.copyStore = [];
  resetUi();
  S.L.opencode = { ...(S.L.opencode || {}), connected: true };
  // The form: Error log is a source on Fix a bug only.
  S.ui.start = { flow: 'bug', src: 'log', busy: false, error: null };
  let html = render();
  assert.match(html, /data-start-src="log" aria-pressed="true" class="on">Error log/);
  assert.match(html, /<li class="">Diagnose<\/li><li class="you">Diagnosis<\/li>/);
  assert.match(html, /data-draft="start:log".*data-draft="start:where".*data-start-go="1">Diagnose</s);
  S.ui.start = { flow: 'feature', src: 'log', busy: false, error: null };
  assert.doesNotMatch(render(), /data-start-src="log"/, 'not on Build a feature');
  const req = (st, d) => startRequest(st, d);
  assert.deepEqual(req({ flow: 'bug', src: 'log' }, { 'start:log': 'System.TimeoutException: x\n  at A.B()', 'start:where': ' api,  prod ' }), { action: 'spike', args: { log: 'System.TimeoutException: x\n  at A.B()', where: 'api, prod' } });
  assert.match(req({ flow: 'bug', src: 'log' }, {}).error, /Paste the error log/);
  assert.match(req({ flow: 'bug', src: 'log' }, { 'start:log': 'x'.repeat(100001) }).error, /under 100k/);
  // The run: its own flow, in the Inbox at the diagnosis, with the fork.
  const diag = (fixType) => ({ folder: 'spike-log-timeout', kind: 'spike', fromLog: true, fixType, id: null, title: 'Eligibility timeout', state: 'Findings written', bucket: 'notes', files: ['log.md', 'findings.md'], summary: 'The timeout is 5 seconds.', modifiedMs: S.now });
  const d = diag('Configuration');
  assert.equal(flowOf(d).id, 'diagnose');
  assert.equal(flowTag(d), 'Error log');
  assert.equal(stepIndex(d), 1);
  assert.ok(atGate(d));
  assert.equal(gateFile(d), 'findings.md');
  assert.match(turnHtml(d), /read the diagnosis, then pick what is next\. <b>Configuration fix\.<\/b> The timeout is 5 seconds\./);
  S.D.items.push(d);
  S.ui.start = null; S.ui.tab = 'inbox';
  html = render();
  assert.match(html, /aria-label="What next for this error"><button (?:data-hot="a" )?type="button" class="fork rec" data-spike-close="spike-log-timeout" data-close-how="applied the configuration change"><span class="fk-t">Apply the change.*data-doc-flow="bug"[^>]*><span class="fk-t">Fix it in code instead.*data-doc-flow="spike".*data-doc-note.*data-spike-close="spike-log-timeout"><span class="fk-t">Close/s);
  S.D.items[S.D.items.length - 1] = diag('Code');
  html = render();
  assert.doesNotMatch(html, /Apply the change/, 'a code fix has no change to apply');
  assert.match(html, /class="fork rec" data-doc-start="spike-log-timeout" data-doc-flow="bug"[^>]*><span class="fk-t">Fix it<span class="fk-rec">Suggested/);
  // Pasted into Chat: a log goes to the Error log box.
  assert.ok(looksLikeLog('2026-11-16 07:01 ERROR failed\nSystem.TimeoutException: x\n   at A.B() in C.cs:line 4'));
  assert.ok(looksLikeLog('System.NullReferenceException: Object reference not set to an instance of an object.'));
  assert.ok(!looksLikeLog('Export fails after one retry'));
  assert.ok(!looksLikeLog('Add CSV export\nto the reports page'));
});

// view.js is pure HTML builders: check the Shape lane's panel parts render and escape what comes from files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardHtml, closeGroupDialogHtml, linkAdoDialogHtml, panelHtml, publishDialogHtml, topHtml } from '../js/view.js';
import { cleanItem, cleanPrefs, newItem, setStage, shapeState, timeline } from '../js/model.js';

const base = (item, extra = {}) => ({
  item, lane: 'shape', files: {}, draft: { kind: null }, editing: false, shapeEditing: null, shape: shapeState({}), back: [], triage: null,
  agent: null, column: 'new', run: null, assigneeName: '', owners: [], age: 0, details: null, prefs: cleanPrefs(), error: '', ...extra
});

test('top bar: three lanes and both New buttons', () => {
  const h = topHtml({ tab: 'board', lane: 'shape', q: '', level: '' }, []);
  assert.deepEqual([...h.matchAll(/data-act="lane" data-id="(\w+)"/g)].map(m => m[1]), ['shape', 'pm', 'dev']);
  assert.match(h, /data-act="new-idea"/);
  assert.match(h, /data-act="new"/);
});

test('board: Shape has three columns, PM three, Dev four; a Shaping card names its step', () => {
  const it = { ...newItem({ title: 'An idea', kind: 'idea' }), age: 0, facts: null };
  const h = boardHtml({ new: [it], shaping: [{ ...it, id: 'w_2', step: 'Waiting on requester' }] }, { lane: 'shape', open: null });
  assert.deepEqual([...h.matchAll(/<section class="col" aria-label="([^"]+)"/g)].map(m => m[1]), ['New', 'Shaping', 'Brief']);
  assert.match(h, />Idea</);
  assert.match(h, /class="chip step">Waiting on requester</);
  const pm = boardHtml({ define: [it] }, { lane: 'pm', open: null });
  assert.deepEqual([...pm.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]), ['Define', 'Who builds it?', 'Delegated']);
  const dev = boardHtml({ building: [{ ...it, id: 'w_3', stage: 'dev', step: 'Spec' }] }, { lane: 'dev', open: null });
  assert.deepEqual([...dev.matchAll(/<section class="col" aria-label="([^"]+)"/g)].map(m => m[1]), ['Building', 'Review and PR', 'Merged', 'Resolved']);
});

test('panel: an idea in New offers Shape it and Already shaped; a request offers Triage and Interview me', () => {
  const idea = newItem({ title: 'An idea', kind: 'idea' });
  const h = panelHtml(base(idea));
  assert.match(h, /data-act="shape"[^>]*>Shape it</);
  assert.match(h, /data-act="skip"/);
  const req = panelHtml(base(newItem({ title: 'A request' })));
  assert.match(req, /data-act="triage"/);
  assert.match(req, /data-act="shape"[^>]*>Interview me</);
  const delegated = panelHtml(base(setStage(newItem({ title: 'x' }), 'delegated'), { column: 'delegated', lane: 'pm' }));
  assert.doesNotMatch(delegated, /data-act="skip"/, 'only Shape and Define items can skip');
});

const Q = `Status: ASKING\nRound: 2\n\n## Q1: Who <b>needs</b> it?\n\n- A) Account managers\n- B) <script>x</script>\n\nRecommended: A\nWhy: internal today\n`;

test('panel: the interview round is a form with options, Other, Skip and notes, escaped', () => {
  const it = setStage(newItem({ title: 'An idea', kind: 'idea' }), 'shaping');
  it.work = { shape: 'shape-an-idea' };
  const files = { 'questions.md': Q, 'understanding.md': '# Understanding\n\nProblem: <img src=x>' };
  const h = panelHtml(base(it, { column: 'interview', files, shape: shapeState(files) }));
  assert.match(h, /Round 2\./);
  assert.match(h, /<input type="radio" name="qa-1" value="A" data-rec>/);
  assert.match(h, /name="qa-1" value="other"/);
  assert.match(h, /name="qa-1" value="skip"/);
  assert.match(h, /id="qo-1"/);
  assert.match(h, /id="qnotes"/);
  assert.match(h, /data-act="send-answers"/);
  assert.match(h, /data-act="use-recommended"/);
  assert.match(h, /data-act="write-brief"/);
  assert.doesNotMatch(h, /<script>|<b>needs|<img src/);
  assert.match(h, /What the agent understands/);
  assert.match(h, /data-act="edit-understanding"/);
  const busy = panelHtml(base(it, { column: 'interview', files, shape: shapeState(files, { busy: true }), agent: { busy: true } }));
  assert.doesNotMatch(busy, /data-act="send-answers"/, 'no form while the agent works');
});

test('panel: the brief offers Send to Define, Keep going and Edit', () => {
  const it = setStage(newItem({ title: 'An idea', kind: 'idea' }), 'brief');
  it.work = { shape: 'shape-an-idea' };
  const files = { 'brief.md': '# Brief: An idea\n\nProduct: Reports\nLevel: User Story\nSize: S\n\n## Problem\n\nNo export.\n' };
  const h = panelHtml(base(it, { column: 'brief', files }));
  assert.match(h, /refine \(one story\)/);
  assert.match(h, /data-act="send-define"/);
  assert.match(h, /data-act="keep-going"/);
  assert.match(h, /id="bnotes"/);
  assert.match(h, /data-act="edit-brief"/);
  assert.match(h, /<dt>Level<\/dt><dd>Story<\/dd>/);
  const editing = panelHtml(base(it, { column: 'brief', files, shapeEditing: 'brief.md' }));
  assert.match(editing, /id="shapeEdit"/);
  assert.match(editing, /data-act="save-shape-file"/);
});

test('panel: a skipped item says so in its history', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'decide', history: [{ stage: 'new', at: '2026-11-01' }, { stage: 'decide', at: '2026-11-02', skipped: true }] });
  assert.match(panelHtml(base(it, { column: 'decide', lane: 'pm', timeline: timeline(it) })), /Who builds it\? \(skipped shaping\)/);
});

/* ---------- Slate 1.7.0: idea to resolved (claude/slate-dispatch-e2e-v1-plan.md) ---------- */

const resolved = (id, title, area, adoId) => cleanItem({ id, title, stage: 'resolved', createdAt: '2026-11-01', history: [{ stage: 'resolved', at: '2026-11-05' }], ado: { id: adoId, rev: 3, url: `https://ado.example.com/_workitems/edit/${adoId}`, area } });

test('board: Resolved groups by area path, each with Copy release notes and Close as released', () => {
  const a = { ...resolved('w_a', 'Feature A', 'Web\\Team A', 11), age: 0, facts: null };
  const b = { ...resolved('w_b', 'Feature B', 'Web\\Team B', 12), age: 0, facts: null };
  const c = { ...resolved('w_c', 'Feature C', 'Web\\Team A', 13), age: 0, facts: null };
  const h = boardHtml({ resolved: [b, a, c] }, { lane: 'dev', open: null });
  assert.deepEqual([...h.matchAll(/class="rarea"[^>]*>([^<]+)</g)].map(m => m[1]), ['Team A', 'Team B']);
  assert.deepEqual([...h.matchAll(/data-act="close-group"[^>]*data-area="([^"]+)"/g)].map(m => m[1]), ['web\\team a', 'web\\team b']);
  assert.equal([...h.matchAll(/data-act="copy-notes"/g)].length, 2);
});

test('panel: Build it myself as a skip ahead; skip ADO when it has no ADO item', () => {
  const req = newItem({ title: 'A request', requester: 'Ops' });
  assert.match(panelHtml(base(req, { canLocal: true })), /data-act="build-local"[^>]*>Build it myself, skip ADO</);
  assert.doesNotMatch(panelHtml(base(req, { canLocal: false })), /build-local/);
  const inAdo = newItem({ title: 'In ADO', ado: { id: 42, type: 'User Story' } });
  assert.match(panelHtml(base(inAdo, { canLocal: true })), /data-act="myself"[^>]*>Build it myself</);
});

test('panel: Define offers Approve and publish; the approved step offers Publish and build', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'defining', work: { define: 'refine-x' } });
  const h = panelHtml(base(it, { lane: 'pm', column: 'define', draft: { kind: 'refine', file: 'refine.md', step: 'approve', ready: false } }));
  assert.match(h, /data-act="approve-publish"[^>]*>Approve and publish</);
  assert.match(h, /data-act="approve-build"/);
  assert.match(h, /data-act="approve"[^>]*>Approve only</);
  const pub = panelHtml(base(it, { lane: 'pm', column: 'publish', draft: { kind: 'refine', file: 'refine.md', step: 'publish', ready: true } }));
  assert.match(pub, /data-act="publish-build"/);
  assert.match(pub, /data-act="build-local"/);
  assert.match(publishDialogHtml([{ op: 'create', type: 'User Story', title: 'x' }], { area: '', build: true }), /Publish and build/);
});

test('panel: the Dev lane by column, with Link ADO item when there is none', () => {
  const local = cleanItem({ ...newItem({ title: 'Local work' }), stage: 'dev', run: { folder: 'L3-local-work', id: 'L3' } });
  const review = panelHtml(base(local, { lane: 'dev', column: 'review', canAdo: true, run: { folder: 'L3-local-work', next: { stage: 'ship' } } }));
  assert.match(review, /id="linkAdo"/);
  assert.match(review, /data-act="mark-merged"/);
  assert.doesNotMatch(review, /data-act="check-prs"/);
  const merged = cleanItem({ ...newItem({ title: 'Merged', ado: { id: 7, type: 'Feature' } }), stage: 'dev', merged: '2026-11-05' });
  const m = panelHtml(base(merged, { lane: 'dev', column: 'merged' }));
  assert.match(m, /data-act="mark-resolved"[^>]*>Mark resolved</);
  assert.doesNotMatch(m, /id="linkAdo"/);
  const r = panelHtml(base(resolved('w_r', 'Done', 'Web', 9), { lane: 'dev', column: 'resolved' }));
  assert.match(r, /data-act="close-one"[^>]*>Close as released</);
  const start = panelHtml(base(cleanItem({ ...newItem({ title: 'No run' }), stage: 'dev' }), { lane: 'dev', column: 'building' }));
  assert.match(start, /data-act="start"[^>]*>Start as local work</);
});

test('dialogs: Link ADO item shows what was found; Close as released lists every item', () => {
  const l = linkAdoDialogHtml({ id: 5, title: '<b>t</b>', type: 'Feature', state: 'Active', project: 'Web', area: 'Web\\A' });
  assert.match(l, /&lt;b&gt;t&lt;\/b&gt;/);
  const items = [resolved('w_1', 'One', 'Web', 1), resolved('w_2', 'Two', 'Web', 2)];
  const c = closeGroupDialogHtml(items, 'Web');
  assert.match(c, /#1 One/);
  assert.match(c, /Close all 2/);
});

test('panel: the timeline links the pull requests and says where the work came from', () => {
  const it = cleanItem({ ...newItem({ title: 'From Dispatch' }), stage: 'dev', history: [{ stage: 'dev', at: '2026-11-06', from: 'dispatch' }], prs: { status: 'merged', at: 'x', list: [{ id: 9, status: 'completed', repository: 'web-api', url: 'https://ado.example.com/pr/9' }] }, merged: '2026-11-07' });
  const h = panelHtml(base(it, { lane: 'dev', column: 'merged', timeline: timeline(it) }));
  assert.match(h, /Started in Dispatch/);
  assert.match(h, /href="https:\/\/ado.example.com\/pr\/9"[^>]*>Pull request 9 in web-api: merged</);
  assert.match(h, /All pull requests merged/);
});

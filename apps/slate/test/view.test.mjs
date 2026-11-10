// view.js is pure HTML builders: check the board, the panel's steps and More render, and escape what comes from files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHOWN, boardHtml, closeGroupDialogHtml, delegateDialogHtml, linkAdoDialogHtml, nextOf, panelHtml, publishDialogHtml, topHtml } from '../js/view.js';
import { cleanItem, cleanPrefs, newItem, setStage, shapeState, timeline } from '../js/model.js';

const base = (item, extra = {}) => ({
  item, dev: false, files: {}, draft: { kind: null }, editing: false, shapeEditing: null, shape: shapeState({}), back: [], triage: null,
  agent: null, column: 'new', run: null, assigneeName: '', owners: [], age: 0, details: null, prefs: cleanPrefs(), error: '', ...extra
});

test('top bar: Board and Health tabs, no lane switcher, both New buttons', () => {
  const h = topHtml({ tab: 'board', q: '', level: '' }, []);
  assert.deepEqual([...h.matchAll(/data-act="tab" data-id="(\w+)"/g)].map(m => m[1]), ['board', 'health']);
  assert.doesNotMatch(h, /data-act="lane"/);
  assert.match(h, /data-act="new-idea"/);
  assert.match(h, /data-act="new"/);
});

test('board: one board of six columns; cards name their step', () => {
  const it = { ...newItem({ title: 'An idea', kind: 'idea' }), age: 0, facts: null };
  const h = boardHtml({ inbox: [it], shape: [{ ...it, id: 'w_2', step: 'Waiting on requester' }], inflight: [{ ...it, id: 'w_3', stage: 'delegated', step: 'With Sam' }] }, { open: null });
  assert.deepEqual([...h.matchAll(/<section class="col[^"]*" aria-label="([^"]+)"/g)].map(m => m[1]), ['Inbox', 'Shape', 'Define', 'Who builds it?', 'In flight', 'Resolved']);
  assert.deepEqual([...h.matchAll(/<section class="col empty-col" aria-label="([^"]+)"/g)].map(m => m[1]), ['Define', 'Who builds it?', 'Resolved'], 'empty columns are narrow strips');
  assert.match(h, /grid-template-columns:minmax\(13\.75rem,1fr\) minmax\(13\.75rem,1fr\) minmax\(8\.5rem,\.45fr\)/);
  assert.match(h, />Idea</);
  assert.match(h, /class="chip step">Waiting on requester</);
  assert.match(h, /class="chip step">With Sam</);
  assert.match(h, /--cols:6/);
});

test('panel: an idea in Inbox offers Shape it; a request offers Triage and Interview me, the rest in More', () => {
  const idea = newItem({ title: 'An idea', kind: 'idea' });
  const h = panelHtml(base(idea));
  assert.match(h, /data-act="shape"[^>]*>Shape it</);
  assert.doesNotMatch(h, /data-act="skip"/, 'Already shaped is gone: Move to in More does it');
  const req = panelHtml(base(newItem({ title: 'A request' }), { canLocal: true, forward: ['defining', 'decide'] }));
  const next = req.slice(req.indexOf('<div class="next">'));
  assert.match(next, /data-act="triage"/);
  assert.match(next, /data-act="shape"[^>]*>Interview me</);
  const more = req.slice(req.indexOf('<details class="more">'), req.indexOf('</details>'));
  assert.match(more, /data-act="define"[^>]*>Define now</);
  assert.match(more, /data-act="build-local"/);
  assert.match(more, /data-act="roadmap-add"/);
  assert.match(more, /<optgroup label="Skip ahead"><option value="decide">Who builds it\?<\/option><option value="defining">Define<\/option>/);
  assert.match(more, /data-act="done"[^>]*>Mark closed</);
  assert.match(more, /data-act="remove"/);
});

/* Every step the panel can show, as panel state: no "next" box shows more than MAX_SHOWN buttons. */
const STEPS = () => {
  const ado = { id: 42, type: 'User Story', url: 'https://ado.example.com/_workitems/edit/42' };
  const plain = (stage, extra = {}) => cleanItem({ ...newItem({ title: 'x' }), stage, ...extra });
  const triage = (questions) => ({ summary: 's', route: 'delegate', size: 'S', repos: [], questions });
  const run = { folder: 'f', next: { stage: 'review', command: '/ship', needsYou: true, text: 'Ship it' } };
  return [
    ['inbox request', base(newItem({ title: 'r' }), { canLocal: true })],
    ['inbox idea', base(newItem({ title: 'i', kind: 'idea' }), { canLocal: true })],
    ['inbox ADO item', base(newItem({ title: 'a', ado }), { canLocal: true })],
    ['triage, questions', base(plain('triaged'), { column: 'triage', triage: triage(['q1']), canLocal: true })],
    ['triage, none', base(plain('triaged'), { column: 'triage', triage: triage([]), canLocal: true })],
    ['triage, waiting for file', base(plain('triaged'), { column: 'triage', canLocal: true })],
    ['waiting', base(plain('waiting'), { column: 'waiting' })],
    ['triage, questions, on ADO', base(plain('triaged', { ado }), { column: 'triage', triage: triage(['q1']), canLocal: true, canAdo: true })],
    ['waiting, asked on ADO', base(plain('waiting', { ado, asked: { id: 42, at: '2026-11-06T10:00:00Z' } }), { column: 'waiting', canAdo: true })],
    ['inbox request, Tandem off', base(newItem({ title: 'r' }), { tandemOff: 'Dispatch is not set up on this computer.' })],
    ['interview, waiting', base(plain('shaping'), { column: 'interview', canLocal: true })],
    ['brief', base(plain('brief'), { column: 'brief', files: { 'brief.md': '# Brief\n\nLevel: Feature\n' }, canLocal: true })],
    ['define, pick', base(plain('defining'), { column: 'define', canLocal: true })],
    ['define, approve', base(plain('defining'), { column: 'define', draft: { kind: 'refine', file: 'refine.md', step: 'approve' } })],
    ['define, approve stories', base(plain('defining'), { column: 'define', draft: { kind: 'scope', file: 'stories.md', step: 'approve-stories' } })],
    ['define, approved again', base(plain('defining'), { column: 'define', draft: { kind: 'refine', file: 'refine.md', ready: true } })],
    ['define, slice', base(plain('defining'), { column: 'define', draft: { kind: 'scope', file: 'stories.md', step: 'slice' } })],
    ['publish', base(plain('ready'), { column: 'publish', draft: { kind: 'refine', file: 'refine.md', ready: true } })],
    ['decide', base(plain('decide', { ado }), { column: 'decide' })],
    ['delegated', base(plain('delegated', { ado }), { column: 'delegated' })],
    ['building, not started', base(plain('dev', { ado }), { dev: true, column: 'building' })],
    ['building, run', base(plain('dev', { ado }), { dev: true, column: 'building', run })],
    ['review, ADO', base(plain('dev', { ado }), { dev: true, column: 'review', run })],
    ['review, local', base(plain('dev'), { dev: true, column: 'review', run })],
    ['merged, ADO', base(plain('dev', { ado, merged: '2026-11-05' }), { dev: true, column: 'merged' })],
    ['merged, local', base(plain('dev', { merged: '2026-11-05' }), { dev: true, column: 'merged' })],
    ['resolved', base(resolved('w_r', 'Done', 'Web', 9), { dev: true, column: 'resolved' })],
    ['agent busy', base(plain('triaged'), { column: 'triage', agent: { busy: true } })]
  ];
};

test(`panel: no step shows more than ${MAX_SHOWN} buttons; the rest are in More`, () => {
  for (const [name, p] of STEPS()) {
    const n = nextOf(p);
    assert.ok((n.shown || []).length <= MAX_SHOWN, `${name}: ${(n.shown || []).length} shown`);
    const h = panelHtml(p);
    const box = /<div class="next">[\s\S]*?<div class="acts">([\s\S]*?)<\/div><\/div>/.exec(h);
    if (box) assert.ok((box[1].match(/<button/g) || []).length <= MAX_SHOWN, `${name}: next box`);
    if (!p.item.virtual) assert.match(h, /<details class="more">/, `${name}: More`);
  }
});

test('panel: Define approve shows Approve and publish and Revise; the other two approvals are in More', () => {
  const p = STEPS().find(([n]) => n === 'define, approve')[1];
  const n = nextOf(p);
  assert.deepEqual(n.shown.map(b => /data-act="([^"]+)"/.exec(b)[1]), ['approve-publish', 'revise']);
  assert.deepEqual(n.more.map(b => /data-act="([^"]+)"/.exec(b)[1]), ['approve-build', 'approve']);
});

test('panel: an agent question takes the box over and Open in Dispatch moves to More', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'triaged' });
  const asks = { count: 1, permissions: [{ id: 'p1', permission: 'bash', patterns: ['ls'] }], questions: [] };
  const h = panelHtml(base(it, { column: 'triage', asks, ui: {} }));
  const box = h.slice(h.indexOf('<div class="next asking">'));
  assert.equal((box.slice(0, box.indexOf('</div></div>')).match(/<button/g) || []).length, 3, 'Allow once, Always allow, Reject');
  const more = h.slice(h.indexOf('<details class="more">'), h.indexOf('</details>'));
  assert.match(more, /data-act="dispatch"/);
});

test('panel: the current step\'s file is open; Details and Timeline fold, closed until opened', () => {
  const it = cleanItem({ ...newItem({ title: 'x', requester: 'Ops' }), stage: 'triaged', history: [{ stage: 'new', at: '2026-11-01' }, { stage: 'triaged', at: '2026-11-02' }] });
  const t = { summary: 'Needs export', route: 'delegate', size: 'S', repos: [], questions: [] };
  const h = panelHtml(base(it, { column: 'triage', triage: t, timeline: timeline(it) }));
  assert.match(h, /<details class="ps fold" open><summary><h3>Triage<\/h3>/);
  assert.match(h, /<details class="ps fold" data-fold="details"><summary><h3>Details<\/h3>/);
  assert.match(h, /<details class="ps fold" data-fold="timeline"><summary><h3>Timeline<\/h3>/);
  const opened = panelHtml(base(it, { column: 'triage', triage: t, timeline: timeline(it), ui: { folds: { details: true } } }));
  assert.match(opened, /data-fold="details" open>/, 'remembered open');
  const later = panelHtml(base(setStage(it, 'decide'), { column: 'decide', triage: t }));
  assert.match(later, /<details class="ps fold"><summary><h3>Triage<\/h3>/, 'an earlier step\'s file is closed');
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
  assert.match(panelHtml(base(it, { column: 'decide', timeline: timeline(it) })), /Who builds it\? \(skipped shaping\)/);
});

/* ---------- Slate 1.7.0: idea to resolved (claude/slate-dispatch-e2e-v1-plan.md) ---------- */

const resolved = (id, title, area, adoId) => cleanItem({ id, title, stage: 'resolved', createdAt: '2026-11-01', history: [{ stage: 'resolved', at: '2026-11-05' }], ado: { id: adoId, rev: 3, url: `https://ado.example.com/_workitems/edit/${adoId}`, area } });

test('board: Resolved groups by area path, each with Copy release notes and Close as released', () => {
  const a = { ...resolved('w_a', 'Feature A', 'Web\\Team A', 11), age: 0, facts: null };
  const b = { ...resolved('w_b', 'Feature B', 'Web\\Team B', 12), age: 0, facts: null };
  const c = { ...resolved('w_c', 'Feature C', 'Web\\Team A', 13), age: 0, facts: null };
  const h = boardHtml({ resolved: [b, a, c] }, { open: null });
  assert.deepEqual([...h.matchAll(/class="rarea"[^>]*>([^<]+)</g)].map(m => m[1]), ['Team A', 'Team B']);
  assert.deepEqual([...h.matchAll(/data-act="close-group"[^>]*data-area="([^"]+)"/g)].map(m => m[1]), ['web\\team a', 'web\\team b']);
  assert.equal([...h.matchAll(/data-act="copy-notes"/g)].length, 2);
});

test('panel: Build it myself as a skip ahead (in More); skip ADO when it has no ADO item', () => {
  const req = newItem({ title: 'A request', requester: 'Ops' });
  assert.match(panelHtml(base(req, { canLocal: true })), /data-act="build-local"[^>]*>Build it myself, skip ADO</);
  assert.doesNotMatch(panelHtml(base(req, { canLocal: false })), /build-local/);
  const inAdo = newItem({ title: 'In ADO', ado: { id: 42, type: 'User Story' } });
  assert.match(panelHtml(base(inAdo, { canLocal: true })), /data-act="myself"[^>]*>Build it myself</);
});

test('panel: Define offers Approve and publish; the approved step offers Publish and build', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'defining', work: { define: 'refine-x' } });
  const h = panelHtml(base(it, { column: 'define', draft: { kind: 'refine', file: 'refine.md', step: 'approve', ready: false } }));
  assert.match(h, /data-act="approve-publish"[^>]*>Approve and publish <span class="out-mark" data-out="ado"/);
  assert.match(h, /data-act="approve-build"/);
  assert.match(h, /data-act="approve"[^>]*>Approve only</);
  const pub = panelHtml(base(it, { column: 'publish', canAdo: true, draft: { kind: 'refine', file: 'refine.md', step: 'publish', ready: true } }));
  const local = panelHtml(base(it, { column: 'publish', canAdo: false, draft: { kind: 'refine', file: 'refine.md', step: 'publish', ready: true } }));
  assert.match(local, /data-act="to-decide"/, 'no ADO: approved drafts go on to Who builds it?');
  assert.doesNotMatch(local, /data-act="publish"/);
  assert.match(pub, /data-act="publish-build"/);
  assert.match(pub, /data-act="build-local"/);
  assert.match(publishDialogHtml([{ op: 'create', type: 'User Story', title: 'x' }], { area: '', build: true }), /Publish and build/);
});

test('panel: In flight and Resolved by step, with Link ADO item when there is none', () => {
  const local = cleanItem({ ...newItem({ title: 'Local work' }), stage: 'dev', run: { folder: 'L3-local-work', id: 'L3' } });
  const review = panelHtml(base(local, { dev: true, column: 'review', canAdo: true, run: { folder: 'L3-local-work', next: { stage: 'ship' } } }));
  assert.match(review, /id="linkAdo"/);
  assert.match(review, /data-act="mark-merged"/);
  assert.doesNotMatch(review, /data-act="check-prs"/);
  const merged = cleanItem({ ...newItem({ title: 'Merged', ado: { id: 7, type: 'Feature' } }), stage: 'dev', merged: '2026-11-05' });
  const m = panelHtml(base(merged, { dev: true, column: 'merged' }));
  assert.match(m, /data-act="mark-resolved"[^>]*>Mark resolved <span class="out-mark" data-out="ado"/);
  assert.doesNotMatch(m, /id="linkAdo"/);
  const r = panelHtml(base(resolved('w_r', 'Done', 'Web', 9), { dev: true, column: 'resolved' }));
  assert.match(r, /data-act="close-one"[^>]*>Close as released <span class="out-mark" data-out="ado"/);
  const start = panelHtml(base(cleanItem({ ...newItem({ title: 'No run' }), stage: 'dev' }), { dev: true, column: 'building' }));
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
  const h = panelHtml(base(it, { dev: true, column: 'merged', timeline: timeline(it) }));
  assert.match(h, /Started in Dispatch/);
  assert.match(h, /href="https:\/\/ado.example.com\/pr\/9"[^>]*>Pull request 9 in web-api: merged</);
  assert.match(h, /All pull requests merged/);
});

const acts = (list) => (list || []).map(b => /data-act="([^"]+)"/.exec(b)[1]);

test('panel: triage questions on an ADO item can be posted there; Waiting reads the replies', () => {
  const steps = Object.fromEntries(STEPS());
  const t = nextOf(steps['triage, questions, on ADO']);
  assert.deepEqual(acts(t.shown), ['post-questions', 'ask', 'define']);
  assert.match(t.shown[0], />Post on #42 <span class="out-mark" data-out="ado"/);
  assert.deepEqual(acts(nextOf(steps['triage, questions']).shown), ['ask', 'define'], 'no ADO item: copy only');
  const w = nextOf(steps['waiting, asked on ADO']);
  assert.deepEqual(acts(w.shown), ['answers', 'read-replies', 'define']);
  assert.match(w.text, /The questions are on #42/);
  assert.deepEqual(acts(nextOf(steps.waiting).shown), ['answers', 'define']);
});

test('panel: with Tandem off, agent buttons stay but are disabled with the reason; Inbox offers Write it myself', () => {
  const steps = Object.fromEntries(STEPS());
  const n = nextOf(steps['inbox request, Tandem off']);
  assert.deepEqual(acts(n.shown), ['write-myself', 'to-decide']);
  assert.ok(n.shown.every(b => !/ disabled/.test(b)), 'nothing here needs an agent');
  const off = 'Dispatch is not set up on this computer.';
  const tri = nextOf(base(cleanItem({ ...newItem({ title: 't' }), stage: 'triaged' }), { column: 'triage', triage: { summary: 's', route: 'delegate', size: 'S', repos: [], questions: [] }, tandemOff: off }));
  for (const b of tri.shown) assert.match(b, /^<button disabled title="Needs Dispatch: Dispatch is not set up on this computer\."/);
  assert.match(tri.text, /Agent steps need Dispatch, which is not set up here\./);
  const on = nextOf(steps['inbox request']);
  assert.ok(on.shown.every(b => !/ disabled/.test(b)), 'Tandem on: nothing disabled');
});

test('Write it myself: Define offers both drafts; a manual draft approves, and publishes only with ADO', () => {
  const it = cleanItem({ ...newItem({ title: 'CSV' }), stage: 'defining' });
  const pick = nextOf(base(it, { column: 'define', tandemOff: 'Dispatch is not set up on this computer.' }));
  assert.deepEqual(acts(pick.shown), ['write-refine', 'write-scope']);
  const onPick = nextOf(base(it, { column: 'define', canLocal: true }));
  assert.ok(acts(onPick.more).includes('write-refine') && acts(onPick.more).includes('write-scope'), 'with agents on, in More');
  const draft = { kind: 'refine', file: 'refine.md', step: 'approve', ready: false, manual: true };
  assert.deepEqual(acts(nextOf(base(it, { column: 'define', draft, canAdo: true })).shown), ['approve-manual-publish', 'edit-draft', 'approve-manual']);
  assert.deepEqual(acts(nextOf(base(it, { column: 'define', draft, canAdo: false })).shown), ['approve-manual', 'edit-draft']);
  const h = panelHtml(base(it, { column: 'define', draft, files: {} }));
  assert.match(h, /Your draft: refine\.md/);
  assert.match(h, /data-act="edit-draft"/);
});

test('without ADO: board hints and search say nothing about ADO; delegated and merged resolve here', () => {
  const b = topHtml({ tab: 'board', q: '', level: '', noAdo: true }, [{ text: 'Slate works without Azure DevOps.', acts: [{ act: 'ado-note-seen', label: 'Got it' }] }]);
  assert.match(b, /placeholder="Search titles"/);
  assert.match(b, /data-act="ado-note-seen"[^>]*>Got it</);
  const del = cleanItem({ ...newItem({ title: 'With Sam' }), stage: 'delegated' });
  assert.ok(acts(nextOf(base(del, { column: 'delegated' })).shown).includes('mark-resolved'));
});


test('panel: Define picks scope when triage sized it L, and says why', () => {
  const it = cleanItem({ ...newItem({ title: 'x', ado: { id: 7, type: 'Issue' } }), stage: 'defining' });
  const n = nextOf(base(it, { column: 'define', suggestScope: true, triage: { size: 'L', questions: [], repos: [] }, canLocal: true }));
  assert.match(n.text, /Triage sized it L/);
  assert.match(n.shown.find(b => /data-act="scope"/.test(b)), /class="btn primary"/);
  assert.doesNotMatch(n.shown.find(b => /data-act="refine"/.test(b)), /primary/);
});

test('publish dialog: the source link row says what happens to the first item', () => {
  const h = publishDialogHtml([{ ref: 'epic', op: 'create', type: 'Epic', title: 'Export' }, { ref: 'source', op: 'link', id: 7, type: 'Issue', title: 'Customers want CSV', to: 'epic', toType: 'Epic', toTitle: 'Export' }], { area: '' });
  assert.match(h, /Link #7/);
  assert.match(h, /a Related link to the new Epic \(Export\)/);
  assert.match(h, /Changes Azure DevOps\.<\/strong> 2 changes\. Nothing is sent until you click Publish\./);
  assert.match(h, /type="submit" value="ok" data-out-ok>Publish <span class="out-mark" data-out="ado"/);
});

test('cards and the panel show the ADO type; your notes show on ADO cards too', async () => {
  const { typeLabel } = await import('../js/view.js');
  assert.equal(typeLabel({ level: 'story', ado: { id: 7, type: 'Issue' } }), 'Issue');
  assert.equal(typeLabel({ level: 'feature' }), 'Feature');
  const it = cleanItem({ ...newItem({ title: 'CSV', ado: { id: 7, type: 'Issue' } }), description: 'Note (2026-11-07): Pat needs it before renewal' });
  const h = panelHtml(base(it, { canLocal: true }));
  assert.match(h, /class="chip lv-story">Issue</);
  assert.match(h, /Your notes/);
  assert.match(h, /Pat needs it before renewal/);
  assert.match(boardHtml({ inbox: [{ ...it, age: 0, facts: null }] }, { open: null }), />Issue</);
});

test('notes above the board: errors stay in view; two or more setup notes fold into one line', async () => {
  const { notesHtml } = await import('../js/view.js');
  const a = { text: 'Connect ADO', acts: [{ act: 'x', label: 'Got it' }] }, b = { text: 'Dispatch is off', acts: [{ act: 'y', label: 'How' }] };
  assert.equal(notesHtml([]), '');
  assert.doesNotMatch(notesHtml([a]), /ws-notices/, 'one setup note stays a line');
  const h = notesHtml(['Azure DevOps: PAT rejected', a, b]);
  assert.match(h, /<div class="notes"><p class="note">Azure DevOps: PAT rejected<\/p><\/div>/);
  assert.match(h, /<details class="ws-notices slate-notices"><summary>2 setup notes<\/summary>/);
  assert.match(notesHtml([a, b], true), /slate-notices" open>/);
});

test('outside writes: every button that changes ADO carries the mark, and local ones never do', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'defining', work: { define: 'refine-x' } });
  const pub = panelHtml(base(it, { column: 'publish', canAdo: true, draft: { kind: 'refine', file: 'refine.md', step: 'publish', ready: true } }));
  assert.match(pub, /data-act="publish"[^>]*data-out>Publish to ADO <span class="out-mark"/);
  assert.match(pub, /data-act="publish-build"[^>]*data-out>/);
  assert.doesNotMatch(pub.match(/<button[^>]*data-act="build-local"[\s\S]*?<\/button>/)[0], /out-mark/, 'skip ADO has no mark');
  const unmerged = cleanItem({ ...newItem({ title: 'Local' }), stage: 'dev', merged: '2026-11-05' });
  const m = panelHtml(base(unmerged, { dev: true, column: 'merged' }));
  assert.doesNotMatch(m.match(/<button[^>]*data-act="mark-resolved"[\s\S]*?<\/button>/)[0], /out-mark/, 'no ADO item: resolved here only');
});

test('outside writes: Who builds it? says when Build it myself publishes first', () => {
  const it = cleanItem({ ...newItem({ title: 'x' }), stage: 'decide' });
  const ready = panelHtml(base(it, { column: 'decide', canAdo: true, draft: { ready: true } }));
  assert.match(ready, /data-act="myself"[^>]*data-out>Publish and build it myself <span class="out-mark"/);
  const notReady = panelHtml(base(it, { column: 'decide', canAdo: true, draft: { ready: false } }));
  assert.match(notReady, /data-act="build-local"[^>]*>Build it myself, skip ADO</);
  assert.doesNotMatch(notReady, /data-act="myself"/);
});

test('outside writes: Delegate never assigns in ADO unless you tick it', () => {
  const h = delegateDialogHtml([{ id: 'p1', name: 'Sam' }], { canBrief: true, canAssign: true });
  assert.match(h, /<input type="checkbox" name="assign"> Also assign it to them in Azure DevOps <span class="out-mark"/);
  assert.match(h, /class="out-banner when-assign"/);
  assert.match(h, /<span class="when-assign">and assign in ADO <span class="out-mark"/);
  const off = delegateDialogHtml([{ id: 'p1', name: 'Sam' }], { canBrief: false, canAssign: false });
  assert.match(off, /name="assign" disabled/);
  assert.doesNotMatch(off, /out-banner/);
});

test('outside writes: Close as released has the ADO banner and a marked button', () => {
  const h = closeGroupDialogHtml([{ ado: { id: 3 }, title: 'A' }], 'Web <b>');
  assert.match(h, /Changes Azure DevOps\.<\/strong> Sets this item in Web &lt;b&gt; to Closed/);
  assert.match(h, /data-out-ok>Close it <span class="out-mark"/);
});

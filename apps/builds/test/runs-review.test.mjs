// Code review screen: the logic (js/review-state.js), the HTML (js/review-view.js) and the mock API
// (js/review-api.js), in Node. The page itself is tested in a browser by tests/review-e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHash, formatHash, select, draftKey, loadDraft, saveDraft, nextCommentId, upsertComment, removeComment,
  canRequestChanges, quoteLines, buildFeedback, fileTree, commentCounts, previousRows, visibleFiles, sidesFor, languageFor,
} from '../js/runs/review-state.js';
import { esc, topBar, banner, filesPane, commentBox, panel } from '../js/runs/review-view.js';
import { mockReviewApi } from '../js/runs/review-api.js';

const memStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), size: () => m.size };
};
const comment = (over = {}) => ({ id: 'c1', path: 'src/a.ts', side: 'new', startLine: 2, endLine: 3, type: 'must_fix', body: 'Fix this.', ...over });
const session = (over = {}) => ({
  workItemId: '12', repo: 'api', revision: 1, branch: 'dev/feature/12-x', baseBranch: 'origin/main',
  baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), status: 'awaiting_review',
  files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, binary: false }],
  ...over,
});

test('hash: parse and format a linkable selection', () => {
  assert.deepEqual(parseHash('#file=src/x.ts&L=12-18'), { file: 'src/x.ts', side: 'new', start: 12, end: 18 });
  assert.deepEqual(parseHash('#file=src/x.ts&L=18-12&side=old'), { file: 'src/x.ts', side: 'old', start: 12, end: 18 });
  assert.deepEqual(parseHash('#file=a.md&L=5'), { file: 'a.md', side: 'new', start: 5, end: 5 });
  assert.deepEqual(parseHash('#file=a.md&L=nope'), { file: 'a.md', side: 'new', start: null, end: null });
  assert.equal(parseHash('#L=3'), null);
  assert.equal(parseHash(''), null);
  assert.equal(formatHash({ file: 'src/x.ts', side: 'new', start: 12, end: 18 }), '#file=src/x.ts&L=12-18');
  assert.equal(formatHash({ file: 'src/x.ts', side: 'old', start: 4, end: 4 }), '#file=src/x.ts&L=4&side=old');
  assert.equal(formatHash({ file: 'a b/c&d.ts', side: 'new', start: 1, end: 2 }), '#file=a+b/c%26d.ts&L=1-2');
  assert.deepEqual(parseHash(formatHash({ file: 'a b/c&d.ts', side: 'new', start: 1, end: 2 })), { file: 'a b/c&d.ts', side: 'new', start: 1, end: 2 });
});

test('selection: shift-click extends on the same side and file only', () => {
  let s = select(null, { file: 'a', side: 'new', line: 10, extend: false });
  assert.deepEqual(s, { file: 'a', side: 'new', anchor: 10, start: 10, end: 10 });
  s = select(s, { file: 'a', side: 'new', line: 4, extend: true });
  assert.deepEqual([s.start, s.end, s.anchor], [4, 10, 10]);
  s = select(s, { file: 'a', side: 'new', line: 14, extend: true });
  assert.deepEqual([s.start, s.end], [10, 14], 'extends from the anchor, not the last end');
  assert.deepEqual(select(s, { file: 'a', side: 'old', line: 20, extend: true }), { file: 'a', side: 'old', anchor: 20, start: 20, end: 20 }, 'other side starts over');
  assert.equal(select(s, { file: 'b', side: 'new', line: 2, extend: true }).start, 2, 'other file starts over');
});

test('drafts: saved per work item, repo and revision; bad data is dropped; empty drafts are removed', () => {
  const store = memStore();
  const key = draftKey('L3', 'api', 2);
  assert.equal(key, 'builds.runs.review.L3.api.r2');
  assert.deepEqual(loadDraft(store, key), { comments: [], summary: '' });
  assert.equal(saveDraft(store, key, { comments: [comment()], summary: 'x' }), true);
  assert.deepEqual(loadDraft(store, key), { comments: [comment()], summary: 'x' });
  store.setItem(key, JSON.stringify({ comments: [comment(), { id: 'c2', path: 'a', side: 'both' }, comment({ id: 'c3', type: 'nit' })], summary: 5 }));
  const d = loadDraft(store, key);
  assert.deepEqual(d.comments.map(c => [c.id, c.type]), [['c1', 'must_fix'], ['c3', 'must_fix']]);
  assert.equal(d.summary, '');
  store.setItem(key, 'not json');
  assert.deepEqual(loadDraft(store, key), { comments: [], summary: '' });
  saveDraft(store, key, { comments: [], summary: '  ' });
  assert.equal(store.size(), 0);
  const broken = { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} };
  assert.equal(saveDraft(broken, key, { comments: [comment()], summary: '' }), false);
});

test('comments: ids, ordering, edit, delete, and when Request changes is allowed', () => {
  assert.equal(nextCommentId([]), 'c1');
  assert.equal(nextCommentId([{ id: 'c2' }, { id: 'c7' }, { id: 'x' }]), 'c8');
  let d = { comments: [], summary: '' };
  assert.equal(canRequestChanges(d), false);
  assert.equal(canRequestChanges({ ...d, summary: ' ok ' }), true);
  d = upsertComment(d, comment({ id: 'c1', path: 'b.ts', startLine: 9, endLine: 9 }));
  d = upsertComment(d, comment({ id: 'c2', path: 'a.ts', startLine: 5, endLine: 5 }));
  d = upsertComment(d, comment({ id: 'c3', path: 'a.ts', side: 'old', startLine: 7, endLine: 7 }));
  assert.deepEqual(d.comments.map(c => c.id), ['c3', 'c2', 'c1'], 'by file, old side first, then line');
  d = upsertComment(d, { ...d.comments[1], body: 'Edited.' });
  assert.equal(d.comments.length, 3);
  assert.equal(d.comments.find(c => c.id === 'c2').body, 'Edited.');
  d = removeComment(d, 'c3');
  assert.deepEqual(d.comments.map(c => c.id), ['c2', 'c1']);
  assert.equal(canRequestChanges(d), true);
  assert.deepEqual(commentCounts(d.comments), { 'a.ts': 1, 'b.ts': 1 });
});

test('quoteLines: exact lines, CRLF, ranges outside the file', () => {
  const t = 'one\ntwo\nthree\n';
  assert.equal(quoteLines(t, 2, 3), 'two\nthree');
  assert.equal(quoteLines('a\r\nb\r\nc', 1, 2), 'a\nb');
  assert.equal(quoteLines(t, 3, 4), null, 'the trailing newline is not a line');
  assert.equal(quoteLines(t, 0, 1), null);
  assert.equal(quoteLines(null, 1, 1), null);
  assert.equal(quoteLines('', 1, 1), '', 'an empty file has one empty line');
});

test('buildFeedback: quoted code from the reviewed commits, approve sends no comments, problems are named', () => {
  const s = session();
  const texts = { 'src/a.ts|new': 'l1\nl2\nl3\nl4\n', 'src/a.ts|old': 'o1\no2\n' };
  const textFor = (p, side) => texts[`${p}|${side}`];
  const draft = { comments: [comment({ body: '  Fix this.  ', suggestedCode: 'L2' }), comment({ id: 'c2', side: 'old', startLine: 1, endLine: 1, type: 'question', body: 'Why?' })], summary: '  Overall fine. ' };

  const r = buildFeedback(s, draft, 'request_changes', textFor);
  assert.deepEqual(r.feedback, {
    workItemId: '12', repo: 'api', revision: 1, headSha: 'a'.repeat(40), verdict: 'request_changes', summary: 'Overall fine.',
    comments: [
      { id: 'c1', path: 'src/a.ts', side: 'new', startLine: 2, endLine: 3, quotedCode: 'l2\nl3', type: 'must_fix', body: 'Fix this.', suggestedCode: 'L2' },
      { id: 'c2', path: 'src/a.ts', side: 'old', startLine: 1, endLine: 1, quotedCode: 'o1', type: 'question', body: 'Why?' },
    ],
  });
  assert.equal('submittedAt' in r.feedback, false, 'the connector sets submittedAt');

  const a = buildFeedback(s, draft, 'approve', textFor);
  assert.deepEqual(a.feedback.comments, []);
  assert.equal(a.feedback.summary, 'Overall fine.');
  assert.equal('summary' in buildFeedback(s, { comments: [], summary: '' }, 'approve', textFor).feedback, false);

  assert.match(buildFeedback(s, { comments: [], summary: ' ' }, 'request_changes', textFor).problem, /comment or a summary/);
  const empty = buildFeedback(s, { comments: [comment({ body: ' ' })], summary: '' }, 'request_changes', textFor);
  assert.equal(empty.commentId, 'c1');
  assert.match(empty.problem, /empty/);
  const gone = buildFeedback(s, { comments: [comment({ startLine: 4, endLine: 9 })], summary: '' }, 'request_changes', textFor);
  assert.match(gone.problem, /no longer in the file/);
});

test('fileTree: folders first, single-child folders joined, depth for indent', () => {
  const rows = fileTree([
    { path: 'src/server/lib/a.ts' }, { path: 'src/server/lib/b.ts' }, { path: 'src/ui/c.ts' }, { path: 'README.md' }, { path: 'docs/x/y/z.md' },
  ]);
  assert.deepEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.type === 'dir' ? r.name + '/' : r.name}`), [
    'docs/x/y/', '  z.md',
    'src/', '  server/lib/', '    a.ts', '    b.ts', '  ui/', '    c.ts',
    'README.md',
  ]);
});

test('round 2: previous comments with answers, files since the last review, and which sides to fetch', () => {
  const prevFb = { comments: [comment(), comment({ id: 'c2' })], summary: 'x' };
  const s = session({ revision: 2, previousFeedback: prevFb, previousResponses: [{ commentId: 'c2', status: 'declined', note: 'Kept it.' }], sinceLastReview: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, binary: false }] });
  assert.deepEqual(previousRows(s).map(r => [r.comment.id, r.response && r.response.status]), [['c1', null], ['c2', 'declined']]);
  assert.deepEqual(previousRows(session()), []);
  assert.equal(visibleFiles(s, true), s.sinceLastReview);
  assert.equal(visibleFiles(s, false), s.files);
  assert.deepEqual(visibleFiles(session(), true), session().files, 'no sinceLastReview: the whole review');
  const renamed = { path: 'new.md', oldPath: 'old.md', status: 'renamed' };
  assert.deepEqual(sidesFor(renamed, false), { left: { side: 'old', path: 'old.md' }, right: { side: 'new', path: 'new.md' }, commentSides: ['old', 'new'] });
  assert.deepEqual(sidesFor(renamed, true), { left: { side: 'prev', path: 'new.md' }, right: { side: 'new', path: 'new.md' }, commentSides: ['new'] });
});

test('languageFor: syntax colors from the file name', () => {
  assert.equal(languageFor('src/a.ts'), 'typescript');
  assert.equal(languageFor('x/Program.CS'), 'csharp');
  assert.equal(languageFor('Dockerfile'), 'dockerfile');
  assert.equal(languageFor('notes'), 'plaintext');
  assert.equal(languageFor('a.unknownext'), 'plaintext');
});

test('view: everything from the agent or the reviewer is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = session({ branch: evil, baseBranch: evil, files: [{ path: `src/${evil}.ts`, status: 'modified', additions: 1, deletions: 0, binary: false }] });
  const item = { title: evil, repos: [evil, 'other'] };
  const draft = { comments: [comment({ path: `src/${evil}.ts`, body: evil, suggestedCode: evil })], summary: evil };
  const ui = { sideBySide: true, sinceLast: false, panelOpen: true, file: `src/${evil}.ts`, backHref: 'index.html', approveLabel: 'Approve' };
  const html = [
    topBar(s, item, ui), filesPane(s, draft, ui), panel(s, draft, ui),
    commentBox(draft.comments[0], { editing: false, expanded: true }), commentBox(draft.comments[0], { editing: true }),
    banner(session({ status: 'revising', revisionRun: { status: 'failed', message: evil } }), {}),
  ].join('');
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes(esc(evil)));
});

test('view: top bar, files, panel and banners say the right things', () => {
  const s = session({ files: [
    { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, binary: false },
    { path: 'img/logo.png', status: 'added', additions: 0, deletions: 0, binary: true },
    { path: 'docs/new.md', oldPath: 'docs/old.md', status: 'renamed', additions: 1, deletions: 1, binary: false },
  ] });
  const ui = { sideBySide: true, sinceLast: false, panelOpen: true, file: 'src/a.ts', backHref: 'index.html#12', approveLabel: 'Approve' };
  const top = topBar(s, { title: 'Fix totals', repos: ['api'] }, ui);
  assert.match(top, /Revision 1/);
  assert.match(top, /3 files/);
  assert.match(top, /href="index.html#12"/);
  assert.doesNotMatch(top, /<select/, 'one repo: no switcher');
  assert.match(topBar(s, { title: 'x', repos: ['api', 'web'] }, ui), /<select data-act="repo"><option value="api" selected>api<\/option><option value="web">web<\/option>/);
  assert.doesNotMatch(top, /data-act="since"/, 'revision 1 has no since toggle');

  const files = filesPane(s, { comments: [comment()], summary: '' }, ui);
  assert.match(files, /rv-badge s-modified[^>]*>M</);
  assert.match(files, /Renamed from docs\/old.md/);
  assert.match(files, />binary</);
  assert.match(files, /rv-ccount[^>]*>1</);

  const empty = panel(s, { comments: [], summary: '' }, ui);
  assert.match(empty, /data-act="request" disabled/);
  assert.match(empty, /Click a line number to comment/);
  const full = panel(s, { comments: [comment()], summary: '' }, ui);
  assert.doesNotMatch(full, /data-act="request" disabled/);
  assert.match(panel(s, { comments: [comment()], summary: '' }, { ...ui, confirmApprove: true }), /Discard 1 draft comment and publish\?/);
  assert.match(full, />Send back</);
  assert.match(panel(s, { comments: [], summary: '' }, ui), /data-act="approve" data-out disabled title="Not ready to publish/, 'Approve and publish needs the build at Publish');
  assert.match(panel(s, { comments: [], summary: '' }, { ...ui, canPublish: true }), /data-act="approve" data-out title="Pushes every branch[^"]*">Approve <span class="out-mark" data-out="git"/);
  assert.doesNotMatch(panel(session({ status: 'approved' }), { comments: [], summary: '' }, ui), /data-act="approve"/);
  assert.equal(panel(s, { comments: [], summary: '' }, { ...ui, panelOpen: false }), '');

  assert.equal(banner(s, {}), '');
  assert.match(banner(session({ status: 'approved' }), {}), /Approved\. Publish from Builds when you are ready\./);
  assert.match(banner(session({ status: 'approved' }), { publishError: 'Push failed.' }), /Publishing did not go through: Push failed\./);
  assert.match(banner(session({ status: 'approved' }), { published: true }), /Approved and published/);
  const approved = { ...ui, canPublish: true };
  assert.match(panel(session({ status: 'approved' }), { comments: [], summary: '' }, approved), /data-act="publish" data-out>Publish <span class="out-mark" data-out="git"/, 'publish again after a failed try');
  assert.match(panel(session({ status: 'approved' }), { comments: [], summary: '' }, { ...approved, publishing: true }), /data-act="publish" data-out disabled>Publishing\.\.\.</);
  assert.doesNotMatch(panel(session({ status: 'approved' }), { comments: [], summary: '' }, { ...approved, published: true }), /data-act="publish"/);
  assert.doesNotMatch(panel(s, { comments: [], summary: '' }, approved), /data-act="publish"/, 'Approve publishes; no separate button before it');
  assert.match(banner(session({ status: 'revising', revision: 1 }), {}), /Tandem is working on your comments.*revision 2/s);
  assert.match(banner(session({ status: 'revising', revisionRun: { status: 'failed', message: 'opencode is not connected.' } }), {}), /not working on your comments.*opencode is not connected\..*data-act="revise"/s);
  assert.match(banner(s, { error: 'Nope.' }), /role="alert">Nope\./);
});

test('mock API: request changes comes back as revision 2 with answers; stale heads and second verdicts are refused', async () => {
  const api = mockReviewApi({ agentDelayMs: 10 });
  const item = await api.item('L1');
  assert.deepEqual(item.repos, ['shop-api', 'shop-web']);
  assert.equal(item.ready, true);
  assert.deepEqual(item.prItems, ['shop-api: dev/feature/L1-round-order-totals → main', 'shop-web: dev/feature/L1-round-order-totals → main']);
  api.failNextPublish();
  await assert.rejects(api.publish(item.folder), e => e.code === 'unavailable');
  assert.deepEqual((await api.publish(item.folder)).repos.map(r => r.repo), ['shop-api', 'shop-web']);
  assert.equal((await api.item('L1')).published, true);
  const s1 = await api.session('L1', 'shop-api');
  assert.equal(s1.files.length, 3);
  assert.deepEqual((await api.file('L1', 'shop-api', 'docs/notes.md', 'old')).kind, 'text');
  assert.deepEqual(await api.file('L1', 'shop-api', 'src/orders/rounding.ts', 'old'), { kind: 'absent' });
  await assert.rejects(api.file('L1', 'shop-api', 'src/orders/totals.ts', 'prev'), e => e.code === 'bad_request');
  await assert.rejects(api.item('99'), e => e.code === 'not_found');

  let changes = 0;
  api.onChange('L1', 'shop-api', () => changes++);
  const fb = { workItemId: 'L1', repo: 'shop-api', revision: 1, headSha: s1.headSha, verdict: 'request_changes', comments: [{ id: 'c1', path: 'src/orders/totals.ts', side: 'new', startLine: 14, endLine: 14, quotedCode: 'x', type: 'question', body: 'Why?' }] };
  assert.equal((await api.submit('L1', 'shop-api', fb)).status, 'revising');
  await assert.rejects(api.submit('L1', 'shop-api', fb), e => e.code === 'conflict');
  await new Promise(r => setTimeout(r, 40));
  const s2 = await api.session('L1', 'shop-api');
  assert.equal(s2.revision, 2);
  assert.equal(s2.status, 'awaiting_review');
  assert.notEqual(s2.headSha, s1.headSha);
  assert.deepEqual(s2.previousResponses, [{ commentId: 'c1', status: 'answered', note: 'Answered in the response file.' }]);
  assert.deepEqual(s2.sinceLastReview.map(f => f.path), ['src/orders/totals.ts']);
  assert.match((await api.file('L1', 'shop-api', 'src/orders/totals.ts', 'prev')).text, /Math\.round\(tax \* 100\)/);
  assert.ok(changes >= 2);

  api.moveHead('shop-api');
  await assert.rejects(api.submit('L1', 'shop-api', { ...fb, revision: 2, headSha: s2.headSha }), e => e.code === 'conflict' && /changed since/.test(e.message));
});

test('reading order, Tandem\'s notes, teammates\' threads and Make it a rule (connector 1.28.0)', async () => {
  const { readingGroups, notesByLine, threadRows, commentFromThread, hasDraft, buildFeedback: build } = await import('../js/runs/review-state.js');
  const files = [
    { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, binary: false, task: { n: 1, title: 'Add it' }, folded: false },
    { path: 'src/a.test.ts', status: 'added', additions: 3, deletions: 0, binary: false, task: { n: 1, title: 'Add it' }, folded: false },
    { path: 'src/b.ts', status: 'modified', additions: 1, deletions: 1, binary: false, task: null, folded: false },
    { path: 'package-lock.json', status: 'modified', additions: 90, deletions: 2, binary: false, task: null, folded: true },
  ];
  assert.deepEqual(readingGroups(files).map(g => [g.label, g.files.length, g.folded]), [['Task 1: Add it', 2, false], ['Not in a task', 1, false], ['Generated and lock files', 1, true]]);
  assert.equal(readingGroups([{ path: 'x', status: 'added' }]), null, 'no labels: the folder tree');
  const s = session({ files, notes: [{ id: 'r#1', path: 'src/a.ts', line: 3, severity: 'nit', text: 'Name', state: 'open', round: 2 }, { id: 'h#1', path: 'src/a.ts', line: 3, severity: 'blocker', text: 'Bug', state: 'fixed', round: 1 }],
    threads: [{ id: 't2', path: 'src/b.ts', line: 1, author: 'Ana', text: 'Done', resolved: true }, { id: 't1', path: 'src/a.ts', line: 2, author: 'Sam', text: 'Use the helper' }] });
  assert.deepEqual([...notesByLine(s, 'src/a.ts').keys()], [3]);
  assert.equal(notesByLine(s, 'src/a.ts').get(3).length, 2);
  assert.deepEqual(threadRows(s).map(t => t.id), ['t1', 't2'], 'open threads first');
  const ui = { sideBySide: true, sinceLast: false, panelOpen: true, file: 'src/a.ts', backHref: 'index.html', approveLabel: 'Approve', canPublish: true };
  const pane = filesPane(s, { comments: [], summary: '' }, ui);
  assert.match(pane, /Task 1: Add it/);
  assert.match(pane, /data-act="folded" aria-expanded="false">Generated and lock files \(1\)/);
  assert.doesNotMatch(pane, /package-lock\.json/, 'folded until opened');
  assert.match(filesPane(s, { comments: [], summary: '' }, { ...ui, showFolded: true }), /package-lock\.json/);
  assert.match(pane, /rv-ncount[^>]*>1</, 'one open note on src/a.ts');
  const p = panel(s, { comments: [], summary: '' }, ui);
  assert.match(p, /Tandem's review \(2\)/);
  assert.match(p, /data-act="jump-note" data-path="src\/a.ts" data-line="3"/);
  assert.match(p, /Fixed<\/span> in review round 1/);
  assert.match(p, /On the PR \(2\)/);
  assert.match(p, /data-act="thread-add" data-id="t1"/);
  const c = commentFromThread({ comments: [comment({ id: 'c1' })], summary: '' }, s.threads[1]);
  assert.deepEqual(c, { id: 'c2', path: 'src/a.ts', side: 'new', startLine: 2, endLine: 2, type: 'must_fix', body: 'Sam on the PR: Use the helper', from: 't1' });
  assert.match(panel(s, { comments: [c], summary: '' }, ui), /data-act="thread-add" data-id="t1" disabled>In your comments/);
  assert.match(commentBox({ ...comment(), rule: true }, { editing: false, expanded: false }), /class="rv-rule"/);
  assert.match(commentBox(comment(), { editing: true }), /name="rule" data-act="c-rule"> Make it a rule/);
  const fb = build(session({}), { comments: [{ ...comment({ path: 'a.ts', startLine: 1, endLine: 1, body: 'x' }), rule: true, from: 't1' }], summary: '' }, 'request_changes', () => 'line\n');
  assert.equal(fb.feedback.comments[0].rule, true);
  assert.equal(fb.feedback.comments[0].from, undefined, 'only the contract\'s fields go to the connector');
  const store = new Map([['builds.runs.review.L1.shop-api.r1', JSON.stringify({ comments: [comment()], summary: '' })], ['other', 'x']]);
  const ls = { get length() { return store.size; }, key: i => [...store.keys()][i], getItem: k => store.get(k) ?? null };
  assert.equal(hasDraft(ls, 'L1'), true);
  assert.equal(hasDraft(ls, 'L2'), false);
});

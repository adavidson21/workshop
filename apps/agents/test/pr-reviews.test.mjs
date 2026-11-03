// Dispatch PR reviews (js/pr-reviews.js): first-pass reviews of teammates' PRs by Tandem's pr-reviewer agent.
// The synthetic fixture plus a pr-<id> item shaped like the parser's output (kind "pr", items[].prReview), a
// /pr-review session that has no folder yet, and an inbox shaped like the ADO connector's sync.prs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { S, resetUi } from '../js/state.js';
import { render } from '../js/view.js';
import { sidebarHtml, inScope } from '../js/sidebar.js';
import { reviewItems, reviewsHtml, reviewCard, reviewUrlCheck, startingReviews, toReviewCount, reviewAllList, prArg, queueHtml } from '../js/pr-reviews.js';
import { emptyLocal } from '../js/local.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/state.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const LINK = 'https://ado.example.test/tfs/Coll/Shop/_git/orders-api/pullrequest/812';
const PR_ITEM = {
  folder: 'pr-812', kind: 'pr', id: null, title: 'Add discount to cart total', bucket: 'notes',
  modifiedMs: Date.parse('2026-10-21T11:00:00Z'), files: ['context.md', 'review.md', 'threads.md'],
  state: 'Request changes, 2 comments', nextText: 'Read the drafts in review.md and post the ones you agree with on the PR.',
  prReview: {
    id: '812', title: 'Add discount to cart total', repo: 'orders-api', folder: 'orders-api', author: 'Dev One',
    branch: 'dev/feature/812-discount -> main', url: LINK, commit: '4b16cacb238ad944fc6f56fb40447dc4a6aff3fa', size: '1 files, +3 -2, 1 commits',
    reviewed: true, reviewedCommit: '4b16cac', reviewedOn: '2026-10-21', recommendation: 'Request changes', risk: 'medium',
    summary: 'Adds a percent discount to the cart total.', counts: { blocking: 1, 'should-fix': 1, optional: 0 },
    comments: [
      { id: 'C1', file: 'src/cart.js', line: '1-3', severity: 'blocking', why: 'Negative discounts raise the total.', comment: 'Can we reject a negative discount here?' },
      { id: 'C2', file: 'src/cart.js', line: '3', severity: 'should-fix', why: 'No test for the new parameter.', comment: 'Could you add a test for 0, 10 and <script>?' }
    ],
    questions: ['Should `discount` default to 0?'], history: 1, state: 'Request changes, 2 comments', nextText: ''
  }
};
const INBOX_OK = {
  state: 'ok', at: Date.parse('2026-10-21T11:58:00Z'), notes: [], error: null,
  items: [
    { key: 'k1', id: 812, title: 'Add discount to cart total', repo: 'orders-api', author: 'Dev One', created: '2026-10-20', url: LINK, tier: 'blocking', via: [], lastBlocker: false },
    { key: 'k2', id: 900, title: 'Retry webhooks', repo: 'hooks', author: 'Dev Two', created: '2026-10-19', url: 'https://ado.example.test/tfs/Coll/Shop/_git/hooks/pullrequest/900', tier: 'pool', via: ['Platform'], lastBlocker: false },
    { key: 'k3', id: 901, title: 'Old one', repo: 'hooks', author: 'Dev Two', created: '2026-10-01', url: 'https://ado.example.test/tfs/Coll/Shop/_git/hooks/pullrequest/901', tier: 'asked', via: [], waiting: true }
  ]
};

function load() {
  S.D = clone(FIXTURE);
  S.D.items.push(clone(PR_ITEM));
  S.L = S.D.liveMode.live;
  S.conn = 'on';
  S.connector = { state: 'ready', message: null };
  S.mode = 'local';
  S.embedded = true;
  S.now = Date.parse('2026-10-21T12:00:00Z');
  S.today = '2026-10-21'; S.yest = '2026-10-20';
  S.copyStore = [];
  S.local = emptyLocal();
  S.inbox = clone(INBOX_OK);
  resetUi();
}
beforeEach(load);

test('PR reviews have their own page: not in All runs or the run counts, listed under PR reviews', () => {
  const pr = S.D.items.find(i => i.folder === 'pr-812');
  assert.equal(inScope(pr), false, 'not in All runs');
  const all = render();
  assert.doesNotMatch(all, /id="item-pr-812"/);
  assert.match(sidebarHtml(), /data-side-scope="reviews" title="[^"]*"><span class="sl">PR reviews<\/span><span class="cnt" title="1 PR waiting on you with no review yet">1<\/span>/);
  S.ui.scope = { kind: 'reviews' };
  assert.equal(inScope(pr), true);
  const page = render();
  assert.match(page, /<h2>PR reviews<\/h2>/);
  assert.match(page, /id="item-pr-812"/);
  assert.equal(reviewItems().length, 1);
});

test('a review card: verdict, risk, comments with Copy, questions, files, and the PR link; drafts are escaped', () => {
  const html = reviewCard(S.D.items.find(i => i.folder === 'pr-812'));
  assert.match(html, /<span class="num">!812<\/span><a href="https:\/\/ado\.example\.test[^"]+812" target="_blank" rel="noopener">Add discount to cart total<\/a>/);
  assert.match(html, /<span class="rec" data-rec="changes">Request changes<\/span>/);
  assert.match(html, /medium risk/);
  assert.match(html, /<span class="sev" data-sev="blocking">1 blocking<\/span><span class="sev" data-sev="should-fix">1 should fix<\/span>/);
  assert.match(html, /<code class="rv-where">src\/cart\.js:1-3<\/code>/);
  assert.match(html, /<blockquote class="rv-say">Can we reject a negative discount here\?<\/blockquote>/);
  assert.match(html, /Copy comment/);
  assert.ok(S.copyStore.includes('Can we reject a negative discount here?'), 'the comment is what gets copied');
  assert.match(html, /&lt;script&gt;/, 'agent text is escaped');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Should <code>discount<\/code> default to 0\?/);
  assert.match(html, /data-file="pr-812" data-name="review\.md"/);
  assert.match(html, /1 earlier review/);
  assert.match(html, /data-rv-url="https:[^"]+812" data-rv-again="1">Review again</);
  assert.match(html, /data-remove="pr-812"/);
  assert.doesNotMatch(html, /post|Post/, 'nothing offers to post');
});

test('new commits since the review: the card says so and offers to review again', () => {
  S.D.items.find(i => i.folder === 'pr-812').prReview.commit = '9999999aaaa';
  const html = reviewCard(S.D.items.find(i => i.folder === 'pr-812'));
  assert.match(html, /New commits since this review \(reviewed <code>4b16cac<\/code>, now <code>9999999<\/code>\)/);
  assert.match(html, /data-rv-again="1">Review the new commits</);
});

test('an unfinished review with no agent working offers to run it again', () => {
  const it = S.D.items.find(i => i.folder === 'pr-812');
  it.prReview = { ...it.prReview, reviewed: false, recommendation: null, comments: [], counts: {} };
  it.state = 'Reviewing';
  const html = reviewCard(it);
  assert.match(html, /<strong>Reviewing<\/strong>/);
  assert.match(html, /The review did not finish\..*Run the review again/s);
});

test('waiting on you: the inbox with Review buttons, See review for reviewed ones, and Waiting for author', () => {
  const html = reviewsHtml();
  assert.match(html, /Waiting on you <span class="n">3<\/span>/);
  assert.match(html, /<a class="btn" href="#item-pr-812" data-jump="item-pr-812">See review<\/a>/);
  assert.match(html, /data-rv-url="https:[^"]+hooks\/pullrequest\/900">Review<\/button>/);
  assert.match(html, /<span class="tier" data-tier="pool"[^>]*>Team<\/span>/);
  assert.match(html, /via Platform/);
  assert.match(html, /Waiting for author/);
  assert.ok(html.indexOf('!812') < html.indexOf('!900') && html.indexOf('!900') < html.indexOf('!901'), 'required first, waiting last');
  assert.equal(toReviewCount(), 1, 'only PRs with no review and not waiting on the author');
});

test('the inbox says how to turn on ADO when the connector is off, and shows errors', () => {
  S.inbox = { state: 'off', items: [], notes: [], error: null, at: 1 };
  let html = reviewsHtml();
  assert.match(html, /Turn on the <strong>ADO connector<\/strong>/);
  assert.match(html, /data-settings="1"/);
  assert.match(html, /paste|by its link/i, 'review by link still works');
  S.mode = 'hosted';
  assert.doesNotMatch(reviewsHtml(), /data-settings="1"/, 'no Settings button from a hosted page');
  S.inbox = { state: 'error', items: [], notes: [], error: 'ADO rejected the PAT.', at: 1 };
  assert.match(reviewsHtml(), /<p class="err">ADO rejected the PAT\.<\/p>/);
  assert.equal(toReviewCount(), 0);
});

test('a /pr-review session with no folder yet shows under Starting with its agent box, not under Investigations', () => {
  S.L.sessions.ses_rv1 = { id: 'ses_rv1', status: 'idle', title: '/pr-review ' + LINK.replace('812', '913'), command: '/pr-review ' + LINK.replace('812', '913'), error: null, text: 'NOREPO: hooks is not cloned in the workspace.', folder: null };
  S.L.others = (S.L.others || []).concat([{ session: 'ses_rv1', command: '/pr-review ' + LINK.replace('812', '913'), at: S.now - 60e3 }]);
  assert.equal(startingReviews().length, 1);
  S.ui.scope = { kind: 'reviews' };
  const page = render();
  assert.match(page, /Starting <span class="n">1<\/span>/);
  assert.match(page, /<span class="num">!913<\/span>Fetching the pull request/);
  assert.match(page, /NOREPO: hooks is not cloned/);
  assert.match(page, /data-dismiss="ses_rv1"/);
  S.ui.scope = { kind: 'all' };
  assert.doesNotMatch(render(), /Fetching the pull request/, 'not in the runs list');
});

test('a review in progress: the inbox row says Reviewing and Review again is disabled', () => {
  S.L.items['pr-812'] = { current: 'ses_rv2', sessions: [{ id: 'ses_rv2', command: '/pr-review ' + LINK }] };
  S.L.sessions.ses_rv2 = { id: 'ses_rv2', status: 'busy', command: '/pr-review ' + LINK, activity: 'git diff', folder: 'pr-812' };
  const html = reviewsHtml();
  assert.match(html, /<span class="rv-busy"><span class="spin" aria-hidden="true"><\/span>Reviewing<\/span>/);
  assert.match(html, /<div class="agent busy">/);
  assert.match(html, /data-abort="ses_rv2"/);
});

test('the paste box checks the link before asking the agent', () => {
  assert.deepEqual(reviewUrlCheck(' ' + LINK + '?_a=files '), { ok: true, id: '812', url: LINK + '?_a=files' });
  assert.match(reviewUrlCheck('').error, /Paste/);
  assert.match(reviewUrlCheck('812').error, /not a link/);
  assert.match(reviewUrlCheck('https://github.com/o/r/pull/3').error, /pullrequest/);
  S.ui.prReview = { busy: false, error: 'That is not a link.' };
  assert.match(reviewsHtml(), /<p class="err">That is not a link\.<\/p>/);
});

const QUEUE = (over = {}) => ({
  status: 'running', source: 'manual', message: null, started: '2026-10-21T11:59:00Z', finished: null,
  counts: { queued: 1, running: 1, done: 1, asking: 0, failed: 0, skipped: 0 },
  items: [
    { id: '812', url: LINK, title: 'Add discount to cart total', state: 'done', message: null },
    { id: '900', url: INBOX_OK.items[1].url, title: 'Retry <webhooks>', state: 'running', message: null, session: 'ses_q1' },
    { id: '905', url: 'https://ado.example.test/tfs/Coll/Shop/_git/hooks/pullrequest/905', title: 'Later', state: 'queued', message: null }
  ],
  nightly: { at: null, last: null }, inbox: null, ...over
});

test('Review all lists inbox PRs not waiting on the author, not reviewed at their latest commit, and not queued', () => {
  // 812 is reviewed at 4b16cac; with no commit from ADO, the review's own commit decides.
  assert.deepEqual(reviewAllList().map(p => p.id), [900]);
  S.inbox.items[0].commit = 'ffffffffffffffffffffffffffffffffffffffff'; // new commits since the review
  assert.deepEqual(reviewAllList().map(p => p.id), [812, 900]);
  S.L.prQueue = QUEUE();
  assert.deepEqual(reviewAllList().map(p => p.id), [812], '900 is already running in the queue');
  const html = reviewsHtml();
  assert.match(html, /data-rv-all="1"[^>]*>Review all 1</);
  assert.match(html, /Queued|Reviewing/);
  S.inbox.items[0].commit = '4b16cacb238ad944fc6f56fb40447dc4a6aff3fa';
  assert.doesNotMatch(reviewsHtml(), /data-rv-all/, 'nothing to queue: no button');
});

test('prArg sends only the fields pr.reviewAll accepts', () => {
  assert.deepEqual(prArg({ ...INBOX_OK.items[2], commit: null }), { url: INBOX_OK.items[2].url, title: 'Old one', waiting: true });
  assert.deepEqual(prArg({ url: LINK, title: 'T', commit: 'abc1234', tier: 'pool', via: ['x'] }), { url: LINK, title: 'T', commit: 'abc1234' });
});

test('the queue panel: progress, current PR, Stop, and escaped titles; finished runs offer Dismiss', () => {
  S.L.prQueue = QUEUE();
  let html = queueHtml();
  assert.match(html, /Review all: 2 of 3/);
  assert.match(html, /!900 Retry &lt;webhooks&gt;/);
  assert.match(html, /data-rv-q="stop"/);
  assert.doesNotMatch(html, /data-rv-q="clear"/);
  assert.match(html, /href="#item-pr-812"/, 'a reviewed PR jumps to its card');
  assert.match(reviewsHtml(), /class="rv-queue"/);

  S.L.prQueue = QUEUE({ status: 'done', source: 'nightly', finished: '2026-10-21T07:10:00Z', counts: { done: 2, asking: 1, failed: 0, skipped: 0, queued: 0, running: 0 },
    items: [{ id: '812', url: LINK, state: 'done' }, { id: '905', url: LINK, state: 'asking', message: 'The reviewer is asking you something.' }] });
  html = queueHtml();
  assert.match(html, /Nightly review finished/);
  assert.match(html, /2 reviewed/);
  assert.match(html, /1 need you/);
  assert.match(html, /The reviewer is asking you something/);
  assert.match(html, /data-rv-q="clear"/);
  assert.doesNotMatch(html, /data-rv-q="stop"/);

  S.L.prQueue = QUEUE({ status: 'paused', message: 'Workshop restarted the opencode connector. Resume to carry on.' });
  html = queueHtml();
  assert.match(html, /is paused/);
  assert.match(html, /data-rv-q="resume"/);

  S.L.prQueue = QUEUE({ status: 'idle', items: [], counts: {} });
  assert.equal(queueHtml(), '');
  S.L.prQueue = null;
  assert.equal(queueHtml(), '');
});

test('the nightly line: how to turn it on, or when it runs', () => {
  S.L.prQueue = QUEUE({ status: 'idle', items: [], counts: {} });
  assert.match(reviewsHtml(), /Set a nightly review time in <button[^>]*data-cfg-open="1"/);
  S.L.prQueue.nightly = { at: '02:00', last: '2026-10-21' };
  const html = reviewsHtml();
  assert.match(html, /Nightly review at <strong>02:00<\/strong>/);
  assert.match(html, /Last ran 2026-10-21/);
});

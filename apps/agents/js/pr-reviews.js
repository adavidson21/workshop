/* Dispatch: PR reviews. First-pass reviews of teammates' pull requests by Tandem's pr-reviewer agent
   (eng-agents /pr-review, Core 2.6.0). HTML strings from S, tested in Node.
   - Reviews: .work/pr-<id> folders, read by the parser as kind "pr" (items[].prReview: recommendation, risk,
     comments, questions). Drafts only: nothing here posts to Azure DevOps. Each comment has a Copy button
     so the person pastes the ones they agree with into the PR themselves.
   - Starting: /pr-review sessions not yet tied to a pr-<id> folder (liveMode.live.others), so a failure
     before the folder exists (repo not cloned, ADO not set up) still shows.
   - Waiting on you: the ADO connector's sync.prs (S.inbox, loaded by main.js), with a Review button each.
   - Review a PR: paste a link (the opencode connector's `pr.review` action).
   - Review all: queues the inbox's PRs that need a first pass (`pr.reviewAll`); the connector runs them
     one at a time and keeps going with Dispatch closed. Its progress is liveMode.live.prQueue (S.L.prQueue),
     shown above the inbox. The same queue runs the optional nightly review (opencode settings, PR reviews).
   - One list: each PR waiting on you is one entry. A PR with a review shows the review card (with its
     tier); a PR with none shows a row with Review. Reviews of PRs no longer waiting on you are listed
     after it, under Earlier reviews.
   - Your runs' pull requests (pr.md, at Ship): where each repo's code review stands (mineState). The Inbox lists the
     code reviews to do; a run's page has its PR box; Work shows the rest under Shipping. */
import { S } from './state.js';
import { h, md, copyBtn, plural, ago, link, fileBtn, removeBtn, sessionBox, looseSessions, itemSession, itemPerms, itemQs, isBusy, asking, prHtml, itemKey, idLink, safeUrl, stateVar, stamp, slateOf } from './view.js';
import { projectChip } from './projects.js';

const SEV = [['blocking', 'Blocking'], ['should-fix', 'Should fix'], ['optional', 'Optional']];
const SEV_NAME = Object.fromEntries(SEV);
const TIER = { blocking: 'Required', asked: 'Asked', pool: 'Team' };
const TIER_TIP = {
  blocking: 'You were added by name as a required reviewer',
  asked: 'You were added by name as an optional reviewer',
  pool: 'One of your teams was added; any teammate can take it',
};

/** The PR reviews in .work, newest first. */
export function reviewItems() {
  return ((S.D && S.D.items) || []).filter(it => it.kind === 'pr').sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0));
}
export const isReviewSession = o => /^\/pr-review(\s|$)/.test(String((o && (o.command || (o.s && o.s.command))) || ''));
/** /pr-review sessions started here that have no pr-<id> folder yet. */
export function startingReviews() { return looseSessions().filter(isReviewSession); }
const reviewFolder = id => ((S.D && S.D.items) || []).find(it => it.folder === 'pr-' + id) || null;
const linkPrId = u => { const m = /\/pullrequest\/(\d+)/i.exec(String(u || '')); return m ? m[1] : null; };
/** A review session for this PR that is still working, started here (folder or not). */
function reviewRunning(id) {
  const it = reviewFolder(id);
  if (it && isBusy(itemSession(it))) return true;
  return startingReviews().some(o => isBusy(o.s) && linkPrId(o.command) === String(id));
}

/** PRs waiting on you that have no review in .work yet (the Reviews tab count). */
export function toReviewCount() {
  const inbox = S.inbox || {};
  if (inbox.state !== 'ok') return 0;
  return (inbox.items || []).filter(p => !p.waiting && !reviewFolder(p.id)).length;
}
/** The connector's PR review queue (Review all, nightly), or null. */
export const prQueue = () => (S.L && S.L.prQueue) || null;
const queueItem = id => { const q = prQueue(); return q ? (q.items || []).find(i => i.id === String(id) && (i.state === 'queued' || i.state === 'running')) || null : null; };
/** A review in .work already covers this PR's latest commit. */
export function reviewedAtLatest(p) {
  const it = reviewFolder(p.id);
  const pr = it && it.prReview;
  if (!pr || !pr.reviewed || !pr.reviewedCommit) return false;
  const commit = p.commit || pr.commit;
  return !!commit && String(commit).toLowerCase().startsWith(String(pr.reviewedCommit).toLowerCase());
}
/** The inbox PRs that Review all would queue: not waiting on the author, not reviewed at their latest commit, not already queued or running. */
export function reviewAllList() {
  const inbox = S.inbox || {};
  if (inbox.state !== 'ok') return [];
  return (inbox.items || []).filter(p => !p.waiting && !reviewedAtLatest(p) && !queueItem(p.id) && !reviewRunning(p.id));
}
/** What pr.reviewAll and pr.inbox.save take for a PR: only the fields their schema allows. */
export function prArg(p) {
  const out = { url: String(p.url || '') };
  if (p.title) out.title = String(p.title).slice(0, 500);
  if (typeof p.commit === 'string' && p.commit) out.commit = p.commit.slice(0, 40);
  if (p.waiting) out.waiting = true;
  if (['blocking', 'asked', 'pool'].includes(p.tier)) out.tier = p.tier;
  return out;
}

/** Reviews where the agent waits for an answer (they also show under Needs you). */
export function askingReviews() { return reviewItems().filter(asking); }
export function askingStarts() { return startingReviews().filter(o => promptsFor(o.session).length); }
export function reviewsAsking() { return askingReviews().length + askingStarts().length; }
function promptsFor(sid) {
  const L = S.L;
  if (!L) return [];
  return L.permissions.filter(p => p.sessionID === sid).concat(L.questions.filter(q => q.sessionID === sid));
}

/** A link check for the paste box: the PR number, or what is wrong. */
export function reviewUrlCheck(raw) {
  const u = String(raw || '').trim();
  if (!u) return { ok: false, error: 'Paste the pull request link from Azure DevOps.' };
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'That is not a link. Copy it from the browser address bar on the PR page.' };
  const id = linkPrId(u);
  if (!id || !/\/_git\//i.test(u)) return { ok: false, error: 'That is not an Azure DevOps pull request link. It ends in /pullrequest/<number>.' };
  return { ok: true, id, url: u };
}

// ------------------------------------------------------------------ pieces
function recClass(rec) {
  const r = String(rec || '').toLowerCase();
  if (r.startsWith('request')) return 'changes';
  if (r.startsWith('needs')) return 'clarify';
  if (r.startsWith('approve after')) return 'cleanup';
  if (r.startsWith('approve')) return 'approve';
  return '';
}
function stale(pr) { return !!(pr.reviewed && pr.commit && pr.reviewedCommit && !String(pr.commit).startsWith(pr.reviewedCommit)); }
function stateColor(it) {
  const pr = it.prReview || {};
  if (asking(it)) return 'var(--gate)';
  if (isBusy(itemSession(it))) return 'var(--go)';
  if (!pr.reviewed || stale(pr)) return 'var(--hold)';
  const c = recClass(pr.recommendation);
  return c === 'changes' ? 'var(--stop)' : c === 'clarify' ? 'var(--gate)' : 'var(--go)';
}
function againBtn(pr, label, cls) {
  if (!pr.url) return '';
  const busy = reviewRunning(pr.id) || S.ui.busy['rv:' + pr.id];
  return `<button type="button" class="btn${cls ? ' ' + cls : ''}" data-rv-url="${h(pr.url)}" data-rv-again="1"${busy ? ' disabled' : ''}>${h(label)}</button>`;
}

function commentHtml(c) {
  const where = c.file ? c.file + (c.line ? ':' + c.line : '') : 'General';
  return `<li class="rv-c" data-sev="${h(c.severity)}">` +
    `<div class="rv-ch"><span class="sev" data-sev="${h(c.severity)}">${h(SEV_NAME[c.severity] || c.severity)}</span>` +
    `<code class="rv-where">${h(where)}</code>${c.file ? copyBtn(where, 'Copy path') : ''}</div>` +
    (c.why ? `<p class="rv-why">${md(c.why)}</p>` : '') +
    (c.comment ? `<blockquote class="rv-say">${md(c.comment)}</blockquote><div class="rv-copy">${copyBtn(c.comment, 'Copy comment')}</div>` : '') +
    '</li>';
}

function verdictHtml(pr) {
  const parts = [`<span class="rec" data-rec="${recClass(pr.recommendation)}">${h(pr.recommendation)}</span>`];
  if (pr.risk) parts.push(`<span class="risk" data-risk="${h(String(pr.risk).toLowerCase())}">${h(pr.risk)} risk</span>`);
  const counts = SEV.map(([k, name]) => (pr.counts && pr.counts[k] ? `<span class="sev" data-sev="${k}">${pr.counts[k]} ${h(name.toLowerCase())}</span>` : '')).join('');
  parts.push(counts || '<span class="dim">No comments</span>');
  return `<div class="rv-verdict">${parts.join('')}</div>`;
}

/** One review card. p: the PR's entry in Waiting on you, if it has one (adds its tier and flags). */
export function reviewCard(it, p) {
  const pr = it.prReview || { id: it.folder.replace(/^pr-/, ''), counts: {}, comments: [], questions: [] };
  const s = itemSession(it);
  const perms = itemPerms(it), qs = itemQs(it);
  const meta = [p ? tierHtml(p) : '<span class="tag">PR review</span>'];
  if (p) meta.push(...inboxFlags(p));
  if (pr.repo) meta.push(`<span class="mono">${h(pr.repo)}</span>`);
  if (pr.author) meta.push(`<span>by ${h(pr.author)}</span>`);
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">${pr.reviewed ? 'Reviewed' : 'Touched'} ${ago(it.modifiedMs)}</span>`);
  meta.push(removeBtn(it));
  let body = '';
  if (pr.reviewed) {
    body += verdictHtml(pr);
    if (stale(pr)) body += `<div class="rv-stale"><span>New commits since this review (reviewed <code>${h(pr.reviewedCommit)}</code>, now <code>${h(String(pr.commit).slice(0, 7))}</code>).</span>${againBtn(pr, 'Review the new commits', 'warn')}</div>`;
    if (pr.summary) body += `<p class="rv-sum">${md(pr.summary)}</p>`;
    const list = (pr.comments || []);
    if (list.length) {
      body += `<details class="rv-list"${openKey('rv:' + it.folder, true)}><summary>${plural(list.length, 'draft comment')}</summary><ol class="rv-cs">${list.map(commentHtml).join('')}</ol></details>`;
    }
    if (pr.questions && pr.questions.length) {
      body += `<div class="rv-qs"><p class="sub-h">Questions for the author</p><ul>${pr.questions.map(q => `<li><span>${md(q)}</span>${copyBtn(q, 'Copy')}</li>`).join('')}</ul></div>`;
    }
  } else {
    body += `<p class="rv-state"><strong>${h(it.state || 'Reviewing')}</strong>${pr.size ? ` <span class="dim">· ${h(pr.size)}</span>` : ''}</p>`;
    if (!isBusy(s) && !perms.length && !qs.length) body += `<div class="next-line"><span class="lbl">Next</span><span>The review did not finish.</span>${againBtn(pr, 'Run the review again', 'primary')}</div>`;
  }
  if (isBusy(s) || perms.length || qs.length || (s && s.error)) body += sessionBox(s, perms, qs, 'Reply to the agent. Ctrl+Enter sends.');
  const files = (it.files || []);
  const foot = [];
  if (safe(pr.url)) foot.push(link(pr.url, 'Open the PR in Azure DevOps', 'btn'));
  if (files.includes('review.md')) foot.push(fileBtn(it.folder, 'review.md', 'plain', 'review.md'));
  if (files.includes('context.md')) foot.push(fileBtn(it.folder, 'context.md', 'plain', 'context.md'));
  if (pr.history) foot.push(`<span class="dim">${plural(pr.history, 'earlier review')} in <code>history/</code></span>`);
  if (pr.reviewed && !stale(pr)) foot.push(againBtn(pr, 'Review again', 'ghost'));
  const title = safe(pr.url) ? link(pr.url, it.title) : h(it.title);
  return `<article class="item rv" id="item-${h(it.folder)}" style="--state:${stateColor(it)}">` +
    `<div class="item-head"><h4 class="t"><span class="num">!${h(pr.id)}</span>${title}</h4><div class="meta">${meta.join('')}</div></div>` +
    (pr.branch ? `<p class="rv-branch mono">${h(pr.branch)}</p>` : '') +
    body + (foot.length ? `<div class="rv-foot">${foot.join('')}</div>` : '') + '</article>';
}
const safe = u => /^https?:\/\//i.test(String(u || ''));
function openKey(key, dflt) {
  const v = Object.prototype.hasOwnProperty.call(S.ui.open, key) ? S.ui.open[key] : dflt;
  return ` data-key="${h(key)}"` + (v ? ' open' : '');
}

const tierHtml = p => `<span class="tier" data-tier="${h(p.tier)}" title="${h(TIER_TIP[p.tier] || '')}">${h(TIER[p.tier] || p.tier || '')}</span>`;
function inboxFlags(p) {
  const out = [];
  if (p.waiting) out.push('<span class="flag info" title="You voted Waiting for author">Waiting for author</span>');
  if (p.lastBlocker) out.push('<span class="flag warn" title="Every other required reviewer approved">Last one holding it</span>');
  return out;
}
// A PR waiting on you that has no review yet: one row with Review (or where its review stands).
function todoRow(p) {
  const running = reviewRunning(p.id) || S.ui.busy['rv:' + p.id];
  const bits = [p.repo ? `<span class="mono">${h(p.repo)}</span>` : '', p.author ? `by ${h(p.author)}` : '', p.created ? `opened ${h(p.created)}` : '', (p.via || []).length ? `via ${h(p.via.join(', '))}` : ''].filter(Boolean);
  let act;
  if (running) act = '<span class="rv-busy"><span class="spin" aria-hidden="true"></span>Reviewing</span>';
  else if (queueItem(p.id)) act = '<span class="rv-busy" title="Review all will get to it">Queued</span>';
  else act = `<button type="button" class="btn primary" data-rv-url="${h(p.url)}">Review</button>`;
  return `<article class="item rv rv-todo" id="rvp-${h(p.id)}" style="--state:var(--${running ? 'go' : 'hold'})"><div class="rv-row">` + tierHtml(p) +
    `<div class="rv-main"><span class="rv-t">${link(p.url, '!' + p.id + ' ' + p.title)}</span><span class="dim">${bits.join(' · ')}</span></div>` +
    `<div class="rv-act">${inboxFlags(p).join('')}${act}</div></div></article>`;
}

// A /pr-review session started here with no pr-<id> folder yet.
function startingCard(o) {
  const s = o.s;
  const perms = S.L.permissions.filter(p => p.sessionID === o.session), qs = S.L.questions.filter(q => q.sessionID === o.session);
  const id = linkPrId(o.command);
  const dismiss = !isBusy(s) && !perms.length && !qs.length ? `<button type="button" class="btn remove" data-dismiss="${h(o.session)}" title="Stop showing this here. The session stays in opencode.">Dismiss</button>` : '';
  return `<article class="item rv" style="--state:var(--${isBusy(s) ? 'go' : 'hold'})"><div class="item-head"><h4 class="t">${id ? `<span class="num">!${h(id)}</span>` : ''}Fetching the pull request</h4>` +
    `<div class="meta"><span class="tag">Starting</span><span title="${h(stamp(o.at))}">Started ${ago(o.at)}</span>${dismiss}</div></div>` +
    sessionBox(s, perms, qs, 'Reply to the agent. Ctrl+Enter sends.') + '</article>';
}

const ORDER = { blocking: 0, asked: 1, pool: 2 };
const inboxOrder = (a, b) => (Number(!!a.waiting) - Number(!!b.waiting)) || ((ORDER[a.tier] ?? 3) - (ORDER[b.tier] ?? 3)) || String(a.created || '').localeCompare(String(b.created || ''));

// Waiting on you: one entry per PR. Reviewed (or being reviewed) PRs show their review card; the rest a row.
function inboxHtml() {
  const inbox = S.inbox || { state: 'idle' };
  const refresh = `<button type="button" class="lnk plain" data-rv-inbox="1"${inbox.state === 'loading' ? ' disabled' : ''}>${inbox.state === 'loading' ? 'Checking' : 'Check again'}</button>`;
  const todo = reviewAllList();
  const all = todo.length ? `<button type="button" class="btn primary sm" data-rv-all="1"${S.ui.busy['rv:all'] ? ' disabled' : ''} title="First-pass review each one, one at a time. Keeps going with Dispatch closed.">Review all ${todo.length}</button>` : '';
  const head = `<h3 id="gh-rvin">Waiting on you${inbox.state === 'ok' ? ` <span class="n">${(inbox.items || []).length}</span>` : ''}<span class="sh-r">${all}${inbox.state === 'off' ? '' : refresh}</span></h3>`;
  const starts = startingReviews().map(startingCard).join('');
  let body;
  if (inbox.state === 'off') {
    body = '<div class="rv-note"><p>Turn on the <strong>ADO connector</strong> and add a PR source to list PRs waiting on you. Or review one by its link.</p>' +
      (S.mode === 'local' ? '<button type="button" class="btn" data-settings="1">Open Settings</button>' : '') + '</div>';
  } else if (inbox.state === 'error') {
    body = `<p class="err">${h(inbox.error || 'Could not check Azure DevOps.')}</p>`;
  } else if (inbox.state !== 'ok') {
    body = '<p class="dim rv-loading"><span class="spin" aria-hidden="true"></span>Checking Azure DevOps.</p>';
  } else if (!(inbox.items || []).length) {
    body = `<p class="dim">Nothing is waiting on you${inbox.at ? ` (checked ${ago(inbox.at)})` : ''}.</p>`;
  } else {
    body = '';
  }
  const list = inbox.state === 'ok' ? (inbox.items || []).slice().sort(inboxOrder).map(p => { const it = reviewFolder(p.id); return it ? reviewCard(it, p) : todoRow(p); }).join('') : '';
  const items = starts + list ? `<div class="items">${starts}${list}</div>` : '';
  const notes = (inbox.notes || []).map(n => `<p class="note">${h(n)}</p>`).join('');
  return `<section class="group rv-inbox" aria-labelledby="gh-rvin">${head}${body}${items}${notes}${inbox.state === 'off' ? '' : nightlyHtml()}</section>`;
}

const Q_STATE = { queued: 'Queued', running: 'Reviewing', done: 'Reviewed', asking: 'Needs you', failed: 'Failed', skipped: 'Skipped' };
const dayTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };

/** Review all's progress, above the inbox. Hidden when the queue is empty. */
export function queueHtml() {
  const q = prQueue();
  if (!q || q.status === 'idle' || !(q.items || []).length) {
    return q && q.message && q.status === 'idle' ? `<p class="note rv-qnote">${h(q.message)}</p>` : '';
  }
  const c = q.counts || {};
  const total = (q.items || []).length;
  const finished = (c.done || 0) + (c.asking || 0) + (c.failed || 0) + (c.skipped || 0);
  const label = q.source === 'nightly' ? 'Nightly review' : 'Review all';
  let title;
  if (q.status === 'running') {
    const cur = (q.items || []).find(i => i.state === 'running');
    title = `${label}: ${Math.min(finished + 1, total)} of ${total}` + (cur ? ` <span class="dim">· !${h(cur.id)}${cur.title ? ' ' + h(cur.title) : ''}</span>` : '');
  } else if (q.status === 'paused') title = `${label} is paused`;
  else if (q.status === 'stopped') title = `${label} stopped`;
  else title = `${label} finished${q.finished ? ` <span class="dim">· ${h(dayTime(q.finished))}</span>` : ''}`;
  const tally = [['done', 'reviewed'], ['asking', 'need you'], ['failed', 'failed'], ['skipped', 'skipped'], ['queued', 'to go']]
    .filter(([k]) => c[k]).map(([k, w]) => `<span class="qn" data-q="${k}">${c[k]} ${w}</span>`).join('');
  const busy = S.ui.busy['rv:q'] ? ' disabled' : '';
  const acts = [];
  if (q.status === 'running' || q.status === 'paused') acts.push(`<button type="button" class="btn sm" data-rv-q="stop"${busy}>Stop</button>`);
  if (q.status === 'paused' || (q.status === 'stopped' && (c.skipped || c.queued))) acts.push(`<button type="button" class="btn primary sm" data-rv-q="resume"${busy}>Resume</button>`);
  if (q.status === 'done' || q.status === 'stopped') acts.push(`<button type="button" class="btn ghost sm" data-rv-q="clear"${busy}>Dismiss</button>`);
  const rows = (q.items || []).map(i => {
    const it = reviewFolder(i.id);
    const name = `!${h(i.id)}${i.title ? ' ' + h(i.title) : ''}`;
    const t = it && (i.state === 'done' || i.state === 'asking') ? `<a href="#item-${h(it.folder)}" data-jump="item-${h(it.folder)}">${name}</a>` : `<span>${name}</span>`;
    return `<li data-q="${h(i.state)}"><span class="qs" data-q="${h(i.state)}">${i.state === 'running' ? '<span class="spin" aria-hidden="true"></span>' : ''}${h(Q_STATE[i.state] || i.state)}</span>${t}${i.message && i.state !== 'skipped' ? `<span class="dim qm">${h(i.message)}</span>` : ''}</li>`;
  }).join('');
  return `<section class="rv-queue" data-status="${h(q.status)}" aria-label="${h(label)}">` +
    `<div class="rv-qh"><strong>${title}</strong><span class="rv-qacts">${acts.join('')}</span></div>` +
    (q.message ? `<p class="rv-qmsg">${h(q.message)}</p>` : '') +
    (tally ? `<div class="rv-qtally">${tally}</div>` : '') +
    `<details class="rv-qlist"${openKey('rv:queue', q.status === 'running' || q.status === 'paused')}><summary>${total === 1 ? '1 pull request' : total + ' pull requests'}</summary><ol>${rows}</ol></details>` +
    '</section>';
}

/** "HH:MM" on a 12-hour clock ("2:00 AM"); anything else as is. */
const clock12 = s => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s || ''); return m ? `${+m[1] % 12 || 12}:${m[2]} ${+m[1] < 12 ? 'AM' : 'PM'}` : (s || ''); };
/** The nightly review's line under the inbox. */
function nightlyHtml() {
  const q = prQueue();
  if (!q) return '';
  const n = q.nightly || {};
  if (!n.at) return '<p class="hint rv-night">Want these ready in the morning? Set a nightly review time in <button type="button" class="lnk" data-cfg-open="1">opencode settings</button>.</p>';
  const last = n.last ? ` Last ran ${h(n.last)}.` : '';
  return `<p class="hint rv-night">Nightly review at <strong>${h(clock12(n.at))}</strong> on the PRs listed here.${last} <button type="button" class="lnk" data-cfg-open="1">Change</button></p>`;
}

// Review a pull request by its link. Hidden behind "Review a link" unless open, typed in, or showing an error.
function pasteHtml() {
  const st = S.ui.prReview || {};
  const val = S.ui.drafts['rv:url'] || '';
  if (!st.open && !st.busy && !st.error && !val) return '';
  const busy = !!st.busy;
  return '<div class="rv-new">' +
    '<label class="rv-new-l" for="rv-url">Review a pull request by its link</label>' +
    `<div class="rv-new-row"><input id="rv-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…/_git/<repo>/pullrequest/<number>" data-draft="rv:url" value="${h(val)}">` +
    `<button type="button" class="btn primary" data-rv-go="1"${busy ? ' disabled' : ''}>${busy ? 'Starting' : 'Review'}</button></div>` +
    (st.error ? `<p class="err">${h(st.error)}</p>` : '<p class="hint">Any PR, not only the ones waiting on you. The repo must be cloned in your workspace.</p>') +
    '</div>';
}

/** The Reviews tab: teammates' PRs and their first-pass reviews. */
export function reviewsHtml() {
  const inbox = S.inbox || {};
  const listed = new Set(inbox.state === 'ok' ? (inbox.items || []).map(p => String(p.id)) : []);
  const earlier = reviewItems().filter(it => !listed.has(String((it.prReview && it.prReview.id) || it.folder.replace(/^pr-/, ''))));
  const st = S.ui.prReview || {};
  const linkBtn = st.open ? '' : '<button type="button" class="btn" data-rv-open="1">Review a link</button>';
  let html = `<div class="scope-head"><h2>Reviews</h2><span class="dim">Teammates' PRs. Drafts only: nothing is posted to Azure DevOps.</span>${linkBtn}</div>`;
  html += pasteHtml() + queueHtml() + inboxHtml();
  if (earlier.length) {
    const name = inbox.state === 'ok' ? 'Earlier reviews' : 'Reviews';
    html += `<section class="group" aria-labelledby="gh-rvl"><h3 id="gh-rvl">${name} <span class="n">${earlier.length}</span></h3>` +
      (inbox.state === 'ok' ? '<p class="hint">No longer waiting on you, or reviewed by link.</p>' : '') +
      `<div class="items">${earlier.map(it => reviewCard(it)).join('')}</div></section>`;
  } else if (inbox.state !== 'ok' && !startingReviews().length) {
    html += '<div class="empty small"><p>No reviews yet. Review a PR by its link.</p></div>';
  }
  return html;
}

// ------------------------------------------------------------------ My PRs
// Where one repo's PR of a run stands. Connected, a branch is pushed only from the code review (review.html).
export const MINE_STATE = {
  review: 'Review before you push', fix: 'The revision needs you', revising: 'The agent is revising',
  approved: 'Approved, push from the review', push: 'Not pushed yet', pushed: 'Pushed, create the PR', missing: 'Repo or branch not found'
};
const MINE_RANK = ['fix', 'review', 'push', 'missing', 'revising', 'approved', 'pushed'];
export function minePrState(it, p) {
  const ps = p.push;
  if (!ps || (!ps.local && !ps.remote)) return 'missing';
  if (ps.remote && !ps.unpushed) return 'pushed';
  if (S.conn !== 'on') return 'push';
  const r = (((S.D && S.D.reviews) || {})[it.folder] || {})[p.repo];
  if (r && r.status === 'approved') return 'approved';
  if (r && r.status === 'revising') return r.run && r.run.status === 'failed' ? 'fix' : 'revising';
  return 'review';
}
/** The state of a run's PRs as a whole: the one that most needs you. */
export function mineState(it) {
  const st = (it.pr || []).map(p => minePrState(it, p));
  return MINE_RANK.find(k => st.includes(k)) || 'pushed';
}
/** Your runs that have PRs (pr.md, at Ship), newest first. */
export function mineItems() {
  return ((S.D && S.D.items) || []).filter(it => it.kind === 'item' && it.stage === 'ship' && (it.pr || []).length)
    .sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0));
}
/** Runs whose PR is waiting on you (a code review to do, or a revision that needs you): the Inbox's Code reviews to do. */
export function mineNeedsCount() { return mineItems().filter(it => ['fix', 'review'].includes(mineState(it))).length; }

const MINE_GROUPS = [
  ['you', 'Your turn', 'Read the diff, comment, then approve and push, or send the comments to the agent.', ['fix', 'review', 'push', 'missing']],
  ['agent', 'With the agent', '', ['revising']],
  ['ready', 'Ready for a PR', 'Push from the review, create the PR, then Remove the run once it merges.', ['approved', 'pushed']]
];
function mineCard(it) {
  const st = mineState(it);
  const meta = [`<span class="flag ${['fix', 'missing'].includes(st) ? 'bad' : ['review', 'push'].includes(st) ? 'warn' : 'ok'}">${h(MINE_STATE[st])}</span>`];
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">Touched ${ago(it.modifiedMs)}</span>`);
  meta.push(projectChip(it));
  meta.push(`<button type="button" class="lnk plain" data-open-run="${h(it.folder)}">Open run</button>`);
  meta.push(removeBtn(it));
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  return `<article class="item mine" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">` +
    `<div class="item-head"><h4 class="t">${it.id ? idLink(it) : ''}${title}</h4><div class="meta">${meta.join('')}</div></div>` + prHtml(it) + '</article>';
}

/** Dispatch 2.x's Ship tab PR groups, for the runs in `list` (default: every run with PRs). Runs Slate saw merge come first.
 *  Dispatch 3.0 shows a run's PR box on its page and its code review in the Inbox; this stays for other callers. */
export function mineHtml(list = mineItems()) {
  let html = '';
  if (!list.length) return '';
  const merged = list.filter(it => { const sl = slateOf(it); return !!(sl && sl.merged); });
  if (merged.length) {
    html += `<section class="group" aria-labelledby="gh-mine-merged"><h3 id="gh-mine-merged">Merged <span class="n">${merged.length}</span></h3>` +
      '<p class="hint">Slate saw every pull request for these merge. Remove the run to clean up its folder.</p>' +
      `<div class="items">${merged.map(mineCard).join('')}</div></section>`;
  }
  for (const [key, name, hint, states] of MINE_GROUPS) {
    const g = list.filter(it => !merged.includes(it) && states.includes(mineState(it)));
    if (!g.length) continue;
    html += `<section class="group" aria-labelledby="gh-mine-${key}"><h3 id="gh-mine-${key}">${h(name)} <span class="n">${g.length}</span></h3>` +
      (hint ? `<p class="hint">${h(hint)}</p>` : '') + `<div class="items">${g.map(mineCard).join('')}</div></section>`;
  }
  return html;
}

/* Dispatch 2.0: the tabs, as HTML strings from S (plan: claude/dispatch-ui-v2-plan.md in the Workshop project).
   One job per tab, full width, no inner sidebar:
   - Inbox: everything waiting on you, answerable in place. The rail badge counts it.
   - Chat: the hub and conversations with Tandem (chat.js draws it; main.js moves its element into #chat-slot).
   - Runs: work items in progress as rows; a run opens its own page (S.ui.run).
   - Ship: runs at Ship, their PRs grouped by whose turn it is (pr-reviews.js mineHtml).
   - Reviews: teammates' PRs and first-pass reviews (pr-reviews.js reviewsHtml).
   - Research: spikes, docs, TSDs and repo guides; a folder opens a reader (S.ui.doc).
   No DOM: main.js paints what these return and handles the clicks. */
import { S } from './state.js';
import { h, md, plural, ago, stamp, fileBtn, bucketOf, asking, itemSession, isBusy, itemKey, itemForFolder, stateVar, track, nextHtml, nextBtns, nextText, autoHtml, agentHtml, leftOffHtml,
  permHtml, questionHtml, sessionBox, reposTable, tasksHtml, kitHtml, filesHtml, prHtml, removeBtn, briefText, slateChip, idLink, safeUrl, link, noteCommand, runBtn, liveNote,
  activityHtml, onboardHtml, pickItem, pickupHtml, looseSessions, GROUPS, reviewHref } from './view.js';
import { projectChip, projectFilterHtml, inProject, runStatus, statusDot, STATUS, runLabel } from './projects.js';
import { reviewsHtml, isReviewSession, mineHtml, mineItems, mineState, mineNeedsCount, toReviewCount, reviewsAsking } from './pr-reviews.js';
import { answerHtml, isHubCommand } from './hub-model.js';

export const TABS = [['inbox', 'Inbox'], ['chat', 'Chat'], ['runs', 'Runs'], ['ship', 'Ship'], ['reviews', 'Reviews'], ['research', 'Research']];
export const TAB_IDS = TABS.map(t => t[0]);
const L = () => S.L;
const all = () => (S.D && S.D.items) || [];
const newest = list => list.slice().sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0));

// ------------------------------------------------------------------ what goes where
/** A run that has reached Ship (PR text written) or is done: the Ship tab, not Runs. */
export const isShip = it => it.kind === 'item' && (it.stage === 'ship' || it.bucket === 'ship' || it.bucket === 'done');
export const runItems = () => all().filter(it => it.kind === 'item' && !isShip(it));
export const shipItems = () => newest(all().filter(isShip));
export const researchItems = () => newest(all().filter(it => it.kind !== 'item' && it.kind !== 'pr'));
/** Spikes before their folder exists and repo guides: sessions Dispatch started that have no .work item yet. */
export const researchSessions = () => looseSessions().filter(o => !isReviewSession(o) && !isHubCommand(o.command));

// ------------------------------------------------------------------ Inbox
/** Everything waiting on you. asks: agent prompts and questions from any session. gates: runs at a gate or with
 *  autopilot waiting (not ones that are asking: their ask is the row). code: runs with a code review to do.
 *  failed: runs that stopped. prs: teammates' PRs with no first pass yet (one row, the Reviews tab has them). */
export function inboxData() {
  const asks = L() ? L().permissions.map(p => ({ kind: 'perm', x: p })).concat(L().questions.map(q => ({ kind: 'q', x: q }))) : [];
  const code = mineItems().filter(it => ['fix', 'review'].includes(mineState(it)));
  const codeSet = new Set(code);
  const runs = all().filter(it => it.kind === 'item');
  const gates = newest(runs.filter(it => bucketOf(it) === 'needs' && !asking(it) && !codeSet.has(it)));
  const failed = newest(runItems().filter(it => runStatus(it) === 'failed' && bucketOf(it) !== 'needs'));
  return { asks, gates, code, failed, prs: toReviewCount() };
}
/** The rail badge and the Inbox tab count: rows that need you (teammates' PRs are counted on Reviews). */
export function inboxCount(d = inboxData()) { return d.asks.length + d.gates.length + d.code.length + d.failed.length; }

/** Where an agent's prompt comes from, and the button that opens it. */
export function askSource(sessionID, folder) {
  const it = folder ? itemForFolder(folder) : null;
  if (it && it.kind === 'item') return { label: runLabel(it), open: `data-open-run="${h(it.folder)}"`, what: 'Run' };
  if (it && it.kind === 'pr') return { label: it.title, open: `data-open-item="${h(it.folder)}"`, what: 'PR review' };
  if (it) return { label: it.title, open: `data-open-doc="${h(it.folder)}"`, what: { spike: 'Spike', docs: 'Docs', tsd: 'TSD' }[it.kind] || 'Research' };
  const o = looseSessions().find(x => x.session === sessionID);
  const s = L() && L().sessions[sessionID];
  const title = (s && s.title) || (o && o.command) || 'opencode session';
  if (o && isHubCommand(o.command)) return { label: title, open: 'data-tab="chat"', what: 'Hub' };
  if (o && isReviewSession(o)) return { label: title, open: 'data-tab="reviews"', what: 'PR review' };
  if (o) return { label: title, open: 'data-tab="research"', what: 'Research' };
  return { label: title, open: `data-open-chat="${h(sessionID)}"`, what: 'Conversation' };
}
/** One session's open prompts and questions, answerable in place (Chat threads and hub cards). */
export function sessionAsksHtml(sid) {
  if (!L() || !sid) return '';
  const perms = L().permissions.filter(p => p.sessionID === sid), qs = L().questions.filter(q => q.sessionID === sid);
  return perms.length || qs.length ? `<div class="asks inline">${perms.map(p => permHtml(p, false)).join('')}${qs.map(q => questionHtml(q, false)).join('')}</div>` : '';
}
function askHtml(a) {
  const src = askSource(a.x.sessionID, a.x.folder);
  return `<div class="inbox-ask" data-ask="${h(a.x.id)}"><p class="src"><span class="tag">${h(src.what)}</span><span class="st">${h(src.label)}</span>` +
    `<button type="button" class="lnk plain" ${src.open}>Open</button></p>${a.kind === 'perm' ? permHtml(a.x, false) : questionHtml(a.x, false)}</div>`;
}
function section(id, title, n, body, hint) {
  return `<section class="group" id="g-${id}" aria-labelledby="gh-${id}"><h3 id="gh-${id}">${h(title)} <span class="n">${n}</span></h3>` + (hint ? `<p class="hint">${md(hint)}</p>` : '') + body + '</section>';
}
export function inboxHtml() {
  const d = inboxData();
  let html = onboardHtml();
  if (d.asks.length) html += section('asks', 'Agents asking you', d.asks.length, `<div class="asks">${d.asks.map(askHtml).join('')}</div>`);
  if (d.gates.length) html += section('gates', 'Runs waiting on you', d.gates.length, `<div class="rows">${d.gates.map(it => runRow(it)).join('')}</div>`);
  if (d.code.length) html += section('code', 'Code reviews to do', d.code.length, `<div class="rows">${d.code.map(codeRow).join('')}</div>`, 'Read the diff before anything is pushed.');
  if (d.failed.length) html += section('failed', 'Stopped or blocked', d.failed.length, `<div class="rows">${d.failed.map(it => runRow(it)).join('')}</div>`);
  if (d.prs) {
    html += `<div class="inbox-prs"><span>${plural(d.prs, "teammate's PR", "teammates' PRs")} waiting on you with no review yet.</span><button type="button" class="btn" data-tab="reviews">Open Reviews</button></div>`;
  }
  if (!inboxCount(d)) {
    html += '<div class="empty small"><p>Nothing needs you right now.</p></div>';
    const runs = runItems().filter(it => it.kind === 'item');
    const by = {};
    runs.forEach(it => { const b = bucketOf(it); (by[b] = by[b] || []).push(it); });
    const pick = pickItem(runs, by);
    if (pick) html += pickupHtml(pick);
    else if (!all().length && !onboardHtml()) html += startEmpty('No work yet', 'Describe a change or ask a question about the code.');
  }
  return html;
}
function codeRow(it) {
  const st = mineState(it);
  const repo = ((it.pr || []).find(p => p.push && p.push.local && !(p.push.remote && !p.push.unpushed)) || (it.pr || [])[0] || {}).repo;
  const review = repo && S.conn === 'on' ? `<a class="btn primary" href="${h(reviewHref(it, repo))}" data-review>${st === 'fix' ? 'Open review' : 'Review'}</a>` : '';
  return `<article class="rrow" style="--state:${stateVar(it)}">${statusDot(st === 'fix' ? 'failed' : 'review')}` +
    `<button type="button" class="rr-t" data-open-run="${h(it.folder)}">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</button>` +
    `<span class="rr-m">${st === 'fix' ? 'The revision needs you' : 'Review before you push'}${repo ? ` · <span class="mono">${h(repo)}</span>` : ''}</span>` +
    `<span class="rr-act">${review}<button type="button" class="btn ghost" data-tab="ship">Ship</button></span></article>`;
}
function startEmpty(title, text) {
  return `<div class="empty"><h2>${h(title)}</h2><p>${h(text)}</p><div class="do"><button type="button" class="btn primary" data-start-open="1">Start work</button></div>` +
    '<p class="hint">Or type <span class="cmd">/start new feature</span> in opencode.</p></div>';
}

// ------------------------------------------------------------------ Runs
const STAGE = { start: 'Start', spec: 'Spec', plan: 'Plan', tasks: 'Tasks', build: 'Build', review: 'Review', pr: 'PR', ship: 'Ship', bug: 'Bug' };
export const stageName = it => STAGE[it.stage] || it.stage || '';
/** One run as a row: status, title (opens the run page), where it is, project, and its main button. */
export function runRow(it) {
  const st = runStatus(it);
  const s = itemSession(it);
  const where = [STATUS[st]];
  if (stageName(it)) where.push(stageName(it) + (it.stage === 'build' && it.tasks && it.tasks.total ? ` ${it.tasks.done}/${it.tasks.total}` : ''));
  if (isBusy(s) && s.activity) where.push(s.activity);
  where.push(`<span title="${h(stamp(it.modifiedMs))}">${ago(it.modifiedMs)}</span>`);
  const text = nextText(it);
  return `<article class="rrow" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">${statusDot(st)}` +
    `<button type="button" class="rr-t" data-open-run="${h(it.folder)}">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</button>` +
    `<span class="rr-m">${where.map(x => (x.startsWith('<') ? x : h(x))).join(' · ')}</span>` +
    (text ? `<span class="rr-next" title="Next">${text}</span>` : '') +
    `<span class="rr-act">${projectChip(it)}${nextBtns(it, true)}</span></article>`;
}
export function runsHtml() {
  const runs = runItems();
  const shown = runs.filter(inProject);
  let html = `<div class="scope-head"><h2>Runs</h2><span class="dim">Work items in progress. Ready to ship is on Ship; spikes and docs are in Research.</span></div>` + projectFilterHtml(runs);
  if (!runs.length) return html + startEmpty('No runs in progress', 'Describe a change or start an ADO work item.');
  if (!shown.length) return html + '<div class="empty small"><p>No runs in this project.</p><div class="do"><button type="button" class="btn primary" data-start-open="1">Start work</button></div></div>';
  const by = {};
  shown.forEach(it => { const b = bucketOf(it); (by[b] = by[b] || []).push(it); });
  GROUPS.forEach(g => {
    const list = newest(by[g[0]] || []);
    if (list.length) html += section(g[0], g[1], list.length, `<div class="rows">${list.map(it => runRow(it)).join('')}</div>`, g[2]);
  });
  // Anything with a bucket the groups do not name still shows.
  const rest = shown.filter(it => !GROUPS.some(g => g[0] === bucketOf(it)));
  if (rest.length) html += section('other', 'Other', rest.length, `<div class="rows">${newest(rest).map(it => runRow(it)).join('')}</div>`);
  return html;
}

// ------------------------------------------------------------------ the run page
/** The sections under a run's header, and which one is in view. */
export function runSections(it) {
  const list = [];
  if ((it.files || []).includes('brief.md')) list.push(['brief', 'Brief']);
  list.push(['tasks', 'Tasks' + (it.tasks && it.tasks.total ? ` ${it.tasks.done}/${it.tasks.total}` : '')], ['repos', 'Repos'], ['files', 'Files'], ['activity', 'Activity']);
  return list;
}
export function runPageHtml(it) {
  const secs = runSections(it);
  const cur = secs.some(x => x[0] === S.ui.runTab) ? S.ui.runTab : secs[0][0];
  const back = isShip(it) ? ['ship', 'Ship'] : ['runs', 'Runs'];
  const meta = [`<span class="tag ${h(it.lane)}">${h(it.lane)}${it.laneGuessed ? '?' : ''}</span>`];
  if (it.adoState) meta.push(`<span title="ADO state when the item was fetched">ADO: ${h(it.adoState)}</span>`);
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">Touched ${ago(it.modifiedMs)}</span>`, projectChip(it), slateChip(it), removeBtn(it));
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  let body = '';
  if (cur === 'brief') {
    const b = S.briefs[it.folder];
    body = !b || (b.text == null && !b.error) ? '<p class="dim">Loading the brief.</p>' : b.text == null ? `<p class="err">${h(b.error)}</p>` : `<div class="brief-body">${briefText(b.text)}</div>`;
    body += `<p class="brief-foot">${fileBtn(it.folder, 'brief.md', 'plain', 'Open brief.md')}</p>`;
  } else if (cur === 'tasks') body = tasksHtml(it) || '<p class="dim">No tasks yet. They are written after the plan is approved.</p>';
  else if (cur === 'repos') body = reposTable(it) + kitHtml(it);
  else if (cur === 'files') body = filesHtml(it) || '<p class="dim">No files yet.</p>';
  else body = activityHtml(it.folder) || '<p class="dim">No activity logged yet.</p>';
  return `<button type="button" class="lnk back" data-close-run="${back[0]}">&larr; ${back[1]}</button>` +
    `<article class="item run-page" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">` +
    `<div class="item-head"><h2 class="t">${idLink(it)}${title}</h2><div class="meta">${meta.join('')}</div></div>` +
    track(it) + nextHtml(it, true) + (isShip(it) ? prHtml(it) : '') + autoHtml(it) + agentHtml(it) + leftOffHtml(it) +
    `<nav class="rtabs" aria-label="Run details">${secs.map(([k, n]) => `<button type="button" class="rtab${k === cur ? ' on' : ''}" data-run-tab="${k}" aria-pressed="${k === cur}">${h(n)}</button>`).join('')}</nav>` +
    `<div class="rtab-body">${body}</div></article>`;
}

// ------------------------------------------------------------------ Ship
export function shipHtml() {
  const ship = shipItems();
  const shown = ship.filter(inProject);
  const prs = mineItems().filter(inProject);
  const rest = shown.filter(it => !prs.includes(it));
  let html = '<div class="scope-head"><h2>Ship</h2><span class="dim">Runs with PR text: review the diff, push, create the PR, then Remove the run once it merges.</span></div>' + projectFilterHtml(ship);
  if (!ship.length) return html + '<div class="empty small"><p>Nothing to ship yet. When a run writes its PR text, it shows here.</p></div>';
  html += mineHtml(prs);
  if (rest.length) html += section('noprs', 'No PR text yet', rest.length, `<div class="rows">${rest.map(it => runRow(it)).join('')}</div>`);
  if (!prs.length && !rest.length) html += '<div class="empty small"><p>Nothing to ship in this project.</p></div>';
  return html;
}

// ------------------------------------------------------------------ Research
const KIND = { spike: 'Spike', docs: 'Docs', tsd: 'TSD' };
/** The file a Research folder opens on: the findings or the document it is about. */
export function docFile(it) {
  const f = (it.files || []).filter(x => /\.md$/i.test(x));
  const want = ['findings.md', 'answer.md', it.kind + '.md', 'tsd.md', 'docs.md', 'draft.md', 'README.md'];
  return want.find(x => f.includes(x)) || f.find(x => !/^(progress|notes|repos)\.md$/i.test(x)) || null;
}
function docRow(it) {
  const s = itemSession(it);
  const meta = [`<span class="tag">${KIND[it.kind] || 'Folder'}</span>`];
  if (it.state) meta.push(h(it.state));
  if (asking(it)) meta.push('<span class="flag warn">Asking you</span>');
  else if (isBusy(s)) meta.push('Working');
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">${ago(it.modifiedMs)}</span>`);
  return `<article class="rrow" id="item-${h(it.folder)}" style="--state:${asking(it) ? 'var(--gate)' : isBusy(s) ? 'var(--go)' : 'var(--line)'}">` +
    `<span class="sd ${asking(it) ? 'review' : isBusy(s) ? 'running' : 'idle'}" aria-hidden="true"></span>` +
    `<button type="button" class="rr-t" data-open-doc="${h(it.folder)}">${h(it.title)}</button><span class="rr-m">${meta.join(' · ')}</span>` +
    `<span class="rr-act">${projectChip(it)}${removeBtn(it)}</span></article>`;
}
function sessionCard(o) {
  const s = o.s;
  const perms = L().permissions.filter(p => p.sessionID === o.session), qs = L().questions.filter(q => q.sessionID === o.session);
  const dismiss = !isBusy(s) && !perms.length && !qs.length ? `<button type="button" class="btn remove" data-dismiss="${h(o.session)}" title="Stop showing this here. The session stays in opencode.">Dismiss</button>` : '';
  return `<article class="item" style="--state:var(--${isBusy(s) ? 'go' : 'hold'})"><div class="item-head"><h4 class="t">${h(s.title || o.command)}</h4><div class="meta"><span title="${h(stamp(o.at))}">Started ${ago(o.at)}</span>${dismiss}</div></div>` +
    sessionBox(s, perms, qs, 'Reply to the agent. Ctrl+Enter sends.') + '</article>';
}
export function researchHtml() {
  const docs = researchItems(), live = researchSessions();
  let html = '<div class="scope-head"><h2>Research</h2><span class="dim">Spikes, docs, TSDs and repo guides. Findings are for reading; turn one into work when it is ready.</span>' +
    '<button type="button" class="btn" data-start-open="spike">Investigate a question</button></div>';
  if (live.length) html += section('live', 'Running', live.length, `<div class="items">${live.map(sessionCard).join('')}</div>`, 'Spikes before their folder exists, and repo guides.');
  if (docs.length) html += section('docs', 'Findings and documents', docs.length, `<div class="rows">${docs.map(docRow).join('')}</div>`);
  if (!live.length && !docs.length) html += '<div class="empty small"><p>No research yet. Investigate a question, or draft a repo guide from Repos in the menu.</p></div>';
  return html;
}
export function docPageHtml(it) {
  const s = itemSession(it);
  const meta = [`<span class="tag">${KIND[it.kind] || 'Folder'}</span>`, `<span title="${h(stamp(it.modifiedMs))}">Touched ${ago(it.modifiedMs)}</span>`, projectChip(it), removeBtn(it)];
  let body = '';
  if (it.state) body += `<p class="doc-state"><strong>${h(it.state)}</strong></p>`;
  if (it.summary) body += `<p class="pre">${md(it.summary)}</p>`;
  if (it.nextText) body += `<div class="next-line"><span class="lbl">Next</span><span>${md(liveNote(it.nextText))}</span>${runBtn(it, noteCommand(it))}</div>`;
  const file = docFile(it);
  const d = S.docs[it.folder];
  let doc = '';
  if (file) {
    doc = !d || (d.text == null && !d.error) ? '<p class="dim">Loading.</p>' : d.text == null ? `<p class="err">${h(d.error)}</p>` : `<div class="hub-answer doc-text">${answerHtml(d.text)}</div>`;
    doc = `<section class="doc-body" aria-label="${h(file)}"><p class="sub-h">${h(file)} ${fileBtn(it.folder, file, 'plain', 'Open raw')}</p>${doc}</section>`;
  }
  const acts = `<p class="hub-actions"><button type="button" class="btn primary" data-doc-start="${h(it.folder)}" title="Opens Start work with this as the description">Start work from this</button>` +
    (d && d.text ? `<button type="button" class="btn ghost" data-doc-note="${h(it.folder)}">Save as note</button>` : '') + '</p>';
  return '<button type="button" class="lnk back" data-close-doc="1">&larr; Research</button>' +
    `<article class="item doc-page" id="item-${h(it.folder)}" style="--state:${asking(it) ? 'var(--gate)' : 'var(--line)'}">` +
    `<div class="item-head"><h2 class="t">${h(it.title)}</h2><div class="meta">${meta.join('')}</div></div>${body}${agentHtml(it)}${isBusy(s) ? '' : acts}${doc}` +
    (it.files && it.files.length ? `<div class="doc-files">${filesHtml(it)}</div>` : '') + '</article>';
}

// ------------------------------------------------------------------ the tab bar and the page
function tabCount(id) {
  if (id === 'inbox') { const n = inboxCount(); return n ? `<span class="cnt gate">${n}</span>` : ''; }
  if (id === 'runs') { const n = runItems().length; return n ? `<span class="n">${n}</span>` : ''; }
  if (id === 'ship') { const g = mineNeedsCount(), n = shipItems().length; return g ? `<span class="cnt gate" title="${plural(g, 'code review')} to do">${g}</span>` : n ? `<span class="n">${n}</span>` : ''; }
  if (id === 'reviews') { const a = reviewsAsking(), n = toReviewCount(); return a ? `<span class="cnt gate" title="The reviewer is waiting for you">${a}</span>` : n ? `<span class="cnt" title="${plural(n, 'PR')} waiting on you with no review yet">${n}</span>` : ''; }
  if (id === 'research') { const n = researchSessions().filter(o => isBusy(o.s)).length + researchItems().filter(it => isBusy(itemSession(it))).length; return n ? `<span class="n" title="Running">${n}</span>` : ''; }
  return '';
}
export function tabsHtml() {
  return '<nav class="tabs" aria-label="Dispatch">' + TABS.map(([id, name]) => {
    const on = S.ui.tab === id;
    return `<button type="button" class="tab${on ? ' on' : ''}" data-tab="${id}"${on ? ' aria-current="page"' : ''}><span>${h(name)}</span>${tabCount(id)}</button>`;
  }).join('') + '</nav>';
}
/** The tab in view. A run page or a Research reader replaces its tab's list. */
export function pageHtml() {
  const t = S.ui.tab;
  if (t === 'chat') return '<div id="chat-slot"></div>';
  if (t === 'runs' || t === 'ship') {
    const it = S.ui.run ? itemForFolder(S.ui.run) : null;
    if (it && it.kind === 'item') return runPageHtml(it);
    return t === 'runs' ? runsHtml() : shipHtml();
  }
  if (t === 'reviews') return reviewsHtml();
  if (t === 'research') {
    const it = S.ui.doc ? itemForFolder(S.ui.doc) : null;
    return it ? docPageHtml(it) : researchHtml();
  }
  return inboxHtml();
}

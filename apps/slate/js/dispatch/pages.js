/* Dispatch 3.0: the tabs, as HTML strings from S (plans: claude/dispatch-ui-v2-plan.md and
   claude/dispatch-flows-v1-plan.md in the Workshop project). Four tabs, one job each:
   - Inbox: everything waiting on you, answerable in place, with the file you are approving. A run that needs you is
     only here. Go through them shows one at a time, with keys. The rail badge counts it.
   - Chat: the hub and conversations with Tandem (chat.js draws it; main.js moves its element into #chat-slot).
   - Work: everything else in flight, every flow (builds, spikes, epics, docs, TSDs), as rows. A row opens its page.
   - Reviews: teammates' PRs and first-pass reviews (pr-reviews.js reviewsHtml).
   A run's page is driven by its flow (flows.js): the step track is the navigation, the current step shows its file
   and its buttons. No DOM: main.js paints what these return and handles the clicks. */
import { S } from './state.js';
import { h, md, plural, ago, stamp, fileBtn, fileOf, asking, itemSession, isBusy, itemKey, itemForFolder, stateVar, track, nextHtml, nextBtns, autoHtml, agentHtml, leftOffHtml,
  permHtml, questionHtml, sessionBox, reposTable, tasksHtml, kitHtml, filesHtml, prHtml, removeBtn, briefText, slateChip, slateOf, idLink, safeUrl, link, runBtn, autoIs,
  activityHtml, onboardHtml, pickItem, pickupHtml, looseSessions, openAttr, bucketOf, reviewHref } from './view.js';
import { projectChip, projectFilterHtml, inProject, runStatus, statusDot, runLabel } from './projects.js';
import { reviewsHtml, isReviewSession, mineItems, mineState, MINE_STATE, toReviewCount, reviewsAsking } from './pr-reviews.js';
import { isHubCommand } from './hub-model.js';
import { docHtml } from './doc.js';
import { FLOWS, flowOf, flowTag, flowById, stepsOf, stepIndex, currentStep, hereWords, atGate, isFinished, turnHtml, gateFile, sendBackCommand,
  folderCommand, flowTrackHtml, stepLine, miniTrack, isSlateFolder } from './flows.js';

export { TABS } from '../loom.js';
import { TABS, BOARD_TABS, panelRun } from '../loom.js';
// `work` is All runs: under Board on the tab bar (the board's toolbar opens it), every run in one list.
export const TAB_IDS = [...TABS.map(t => t[0]), 'work'];
/** Dispatch 2.x's tabs: Runs, Ship and Research are all Work now. */
export const OLD_TABS = { runs: 'work', ship: 'work', research: 'work' };
const L = () => S.L;
const all = () => (S.D && S.D.items) || [];
const newest = list => list.slice().sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0));

// ------------------------------------------------------------------ what goes where
/** A run that has reached Ship (PR text written) or is done. */
export const isShip = it => it.kind === 'item' && (it.stage === 'ship' || it.bucket === 'ship' || it.bucket === 'done');
/** Everything a flow knows, plus folders no flow knows (not PR reviews, which are on Reviews, and not Slate's own). */
export const workItems = () => all().filter(it => it.kind !== 'pr' && !isSlateFolder(it));
/** Sessions Dispatch started that have no .work folder yet: a spike, epic, doc or TSD before its folder exists, and repo guides. */
export const startingSessions = () => looseSessions().filter(o => !isReviewSession(o) && !isHubCommand(o.command));

// ------------------------------------------------------------------ Inbox
/** Everything waiting on you. asks: agent prompts and questions from any session. gates: runs at a gate (a work item
 *  waiting for approval or autopilot waiting, an epic's approvals, a TSD to revise or publish; not ones asking you:
 *  their ask is the row). code: runs with a code review to do. failed: runs that stopped. prs: teammates' PRs with
 *  no first pass yet (one line; the Reviews tab has them). */
export function inboxData() {
  const asks = L() ? L().permissions.map(p => ({ kind: 'perm', x: p })).concat(L().questions.map(q => ({ kind: 'q', x: q }))) : [];
  const code = mineItems().filter(it => ['fix', 'review'].includes(mineState(it)));
  const codeSet = new Set(code);
  const failed = newest(workItems().filter(it => it.kind === 'item' && !isShip(it) && !it.paused && !asking(it) && isStopped(it)));
  const stopped = new Set(failed);
  const gates = newest(workItems().filter(it => atGate(it) && !codeSet.has(it) && !stopped.has(it)));
  return { asks, gates, code, failed, prs: toReviewCount() };
}
/** A run whose last step failed or says it is blocked, or whose session stopped with an error. */
export function isStopped(it) {
  const s = itemSession(it);
  return !!it.blocked || (!!s && !!s.error && !isBusy(s) && !autoIs(it, 'running'));
}
/** The rail badge and the Inbox tab count: rows that need you (teammates' PRs are counted on Reviews). */
export function inboxCount(d = inboxData()) { return d.asks.length + d.gates.length + d.code.length + d.failed.length; }
/** Folders that are in the Inbox (asking, at a gate, a code review, stopped): Work leaves them out. */
export function inboxFolders(d = inboxData()) {
  const set = new Set([...d.gates, ...d.code, ...d.failed].map(it => it.folder));
  for (const a of d.asks) if (a.x.folder) set.add(a.x.folder);
  return set;
}
/** The Inbox as one list, for Go through them: every row with a key that stays the same across repaints. */
export function walkList(d = inboxData()) {
  const done = (S.ui.walk && S.ui.walk.done) || {};
  return [].concat(
    d.asks.map(a => ({ key: 'ask:' + a.x.id, kind: 'ask', a })),
    d.gates.map(it => ({ key: 'gate:' + it.folder, kind: 'gate', it })),
    d.code.map(it => ({ key: 'code:' + it.folder, kind: 'code', it })),
    d.failed.map(it => ({ key: 'failed:' + it.folder, kind: 'failed', it }))
  ).filter(x => !done[x.key]);
}

/** Where an agent's prompt comes from, and the button that opens it. */
export function askSource(sessionID, folder) {
  const it = folder ? itemForFolder(folder) : null;
  if (it && it.kind === 'pr') return { label: it.title, open: `data-open-item="${h(it.folder)}"`, what: 'PR review' };
  if (it) return { label: runLabel(it), open: `data-open-run="${h(it.folder)}"`, what: flowTag(it) };
  const o = looseSessions().find(x => x.session === sessionID);
  const s = L() && L().sessions[sessionID];
  const title = (s && s.title) || (o && o.command) || 'opencode session';
  if (o && isHubCommand(o.command)) return { label: title, open: 'data-tab="chat"', what: 'Hub' };
  if (o && isReviewSession(o)) return { label: title, open: 'data-tab="reviews"', what: 'PR review' };
  if (o) return { label: title, open: 'data-tab="work"', what: 'Starting' };
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
  return `<div class="inbox-ask icard" data-ask="${h(a.x.id)}"><p class="src"><span class="tag">${h(src.what)}</span><span class="st">${h(src.label)}</span>` +
    `<button type="button" class="lnk plain" data-hot="o" ${src.open}>Open</button></p>${a.kind === 'perm' ? permHtml(a.x, false) : questionHtml(a.x, false)}</div>`;
}
function section(id, title, n, body, hint) {
  return `<section class="group" id="g-${id}" aria-labelledby="gh-${id}"><h3 id="gh-${id}">${h(title)} <span class="n">${n}</span></h3>` + (hint ? `<p class="hint">${md(hint)}</p>` : '') + body + '</section>';
}
/** The first button gets the A key in Go through them. */
const hot = (html, key) => html.replace(/<(button|a) /, `<$1 data-hot="${key}" `);

/** A .work file shown inline: rendered, with Open (the file sheet) and, when it may be edited, Edit. peek: only the
 *  first part, with Read all to open the rest. */
export function fileInline(it, name, peek) {
  if (!name) return '';
  const f = fileOf(it.folder, name);
  const body = !f || (f.text == null && !f.error) ? '<p class="dim">Loading.</p>' : f.text == null ? `<p class="err">${h(f.error)}</p>`
    : f.text.trim() ? `<div class="doc">${docHtml(f.text)}</div>` : '<p class="dim">This file is empty.</p>';
  const key = 'peek:' + it.folder + '/' + name;
  const open = !peek || !!S.ui.open[key];
  const long = f && f.text && f.text.split('\n').length > 14;
  const more = peek && long ? `<button type="button" class="lnk plain" data-peek="${h(key)}" aria-expanded="${open}">${open ? 'Show less' : 'Read all'}</button>` : '';
  return `<section class="finline${peek && long && !open ? ' peek' : ''}" aria-label="${h(name)}"><p class="fi-h"><span class="mono">${h(name)}</span>` +
    `${fileBtn(it.folder, name, 'plain', 'Open')}<button type="button" class="lnk plain" data-file="${h(it.folder)}" data-name="${h(name)}" data-mode="edit">Edit</button></p>` +
    `<div class="fi-body">${body}</div>${more ? `<p class="fi-more">${more}</p>` : ''}</section>`;
}
/** Send back with a note: the note goes under the gate file's Open questions, then the step runs again. */
export function sendBackHtml(it) {
  const cmd = sendBackCommand(it);
  if (!cmd) return '';
  const key = 'sb:' + it.folder;
  if (!S.ui.open[key]) return '';
  const file = gateFile(it);
  return `<div class="sendback"><label><span class="cfg-t">What should change?</span>` +
    `<textarea rows="3" data-draft="${h(key)}" placeholder="Say what is wrong or missing. It goes under Open questions in ${h(file || 'the file')}, then Tandem redoes the draft.">${h(S.ui.drafts[key] || '')}</textarea></label>` +
    `<div class="row"><button type="button" class="btn primary" data-sendback="${h(it.folder)}"${S.ui.busy['sb:' + it.folder] ? ' disabled' : ''}>Send back to Tandem</button>` +
    `<button type="button" class="btn" data-sb-toggle="${h(it.folder)}">Cancel</button><span class="dim">Runs <code>${h(cmd)}</code></span></div></div>`;
}
const CMD_LABEL = { approve: 'Approve', slice: 'Slice', backlog: 'Make the backlog', 'check-docs': 'Fact-check', publish: 'Publish', tsd: 'Run /tsd', scope: 'Scope' };
function cmdLabel(cmd) { const n = String(cmd || '').split(/\s+/)[0].replace(/^\//, ''); return CMD_LABEL[n] || 'Run'; }
/** The buttons at a folder's current step (epic, docs, TSD, spike): its next command, and what else fits there. */
export function folderActs(it, inline) {
  const f = flowOf(it);
  const i = stepIndex(it);
  const out = [];
  if (f && f.id === 'tsd' && i === 2) {
    out.push(`<button type="button" class="btn primary" data-file="${h(it.folder)}" data-name="tsd.md" data-mode="edit">Edit tsd.md</button>`);
    out.push(runBtn(it, `/publish ${it.folder}`, 'Publish', true));
  } else if (f && f.id === 'tsd' && i === 3) {
    out.push(runBtn(it, `/publish ${it.folder}`, 'Publish'));
  } else if (f && f.id === 'spike') {
    if (i === 1) out.push(`<button type="button" class="btn primary" data-doc-start="${h(it.folder)}" title="Opens Start work with the findings as the description">Start work from this</button>`);
    const d = fileOf(it.folder, 'findings.md');
    if (inline && d && d.text) out.push(`<button type="button" class="btn ghost" data-doc-note="${h(it.folder)}">Save as note</button>`);
  } else if (f && f.id === 'docs' && i === 1) {
    const cmd = folderCommand(it);
    if (cmd) out.push(runBtn(it, cmd, 'Fact-check'));
    else if (inline) out.push(`<span class="docs-path"><input type="text" class="mono" data-draft="dc:${h(it.folder)}" value="${h(S.ui.drafts['dc:' + it.folder] || '')}" placeholder="Path of the doc, like docs/run-locally.md" spellcheck="false" autocomplete="off" aria-label="Path of the doc to fact-check">` +
      `<button type="button" class="btn primary" data-docs-check="${h(it.folder)}">Fact-check</button></span>`);
  } else {
    const cmd = folderCommand(it);
    if (cmd && !isFinished(it)) out.push(runBtn(it, cmd, cmdLabel(cmd)));
  }
  return out.join('');
}
/** One run waiting on you at a gate, as a card: whose turn and what for, the flow so far, the file to read (the first
 *  part; Read all for the rest), and its buttons: approve, send back with a note, edit the file, open the run. */
function gateCard(it) {
  const file = gateFile(it);
  const sb = sendBackCommand(it);
  const btns = it.kind === 'item' ? nextBtns(it, false) : folderActs(it, false);
  return `<article class="icard gate" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">` +
    `<p class="src"><span class="tag">${h(flowTag(it))}</span><button type="button" class="st lnk plain" data-open-run="${h(it.folder)}">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</button>` +
    `${miniTrack(it)}<button type="button" class="lnk plain" data-hot="o" data-open-run="${h(it.folder)}">Open</button></p>` +
    `<p class="iturn">${turnHtml(it)}</p>` + (it.kind === 'item' ? autoHtml(it) : '') + fileInline(it, file, true) +
    `<div class="row acts">${hot(btns, 'a')}` + (sb ? `<button type="button" class="btn ghost" data-hot="s" data-sb-toggle="${h(it.folder)}" aria-expanded="${!!S.ui.open['sb:' + it.folder]}">Send back</button>` : '') + '</div>' +
    sendBackHtml(it) + '</article>';
}
function failedCard(it) {
  return `<article class="icard failed" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">` +
    `<p class="src"><span class="tag">${h(flowTag(it))}</span><button type="button" class="st lnk plain" data-open-run="${h(it.folder)}">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</button>` +
    `${miniTrack(it)}<button type="button" class="lnk plain" data-hot="o" data-open-run="${h(it.folder)}">Open</button></p>` +
    `<p class="iturn">${turnHtml(it)}</p><div class="row acts">${hot(nextBtns(it, false), 'a')}</div></article>`;
}
function codeRow(it) {
  const st = mineState(it);
  const repo = ((it.pr || []).find(p => p.push && p.push.local && !(p.push.remote && !p.push.unpushed)) || (it.pr || [])[0] || {}).repo;
  const review = repo && S.conn === 'on' ? `<a class="btn primary" data-hot="a" href="${h(reviewHref(it, repo))}" data-review>${st === 'fix' ? 'Open review' : 'Review'}</a>` : '';
  return `<article class="rrow" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">${statusDot(st === 'fix' ? 'failed' : 'review')}` +
    `<button type="button" class="rr-t" data-open-run="${h(it.folder)}">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</button>` +
    `<span class="rr-m">${st === 'fix' ? 'The revision needs you' : 'Review the diff before you push'}${repo ? ` · <span class="mono">${h(repo)}</span>` : ''}</span>` +
    `<span class="rr-act">${review}<button type="button" class="btn ghost" data-hot="o" data-open-run="${h(it.folder)}">Open</button></span></article>`;
}
/** A run inside its card on the board (Loom, .loom-run): at a gate, its gate card (file, Approve, Send back); stopped,
 *  its next step; otherwise its row (step, whose turn, main button). '' when there is no such run. */
export function runCardHtml(folder) {
  const it = itemForFolder(folder);
  if (!it || it.kind === 'pr') return '';
  const d = inboxData();
  if (d.gates.includes(it)) return gateCard(it);
  if (d.failed.includes(it)) return failedCard(it);
  return `<div class="rows">${workRow(it)}</div>`;
}
function walkRowHtml(x) {
  if (x.kind === 'ask') return askHtml(x.a);
  if (x.kind === 'gate') return gateCard(x.it);
  if (x.kind === 'code') return `<div class="rows">${codeRow(x.it)}</div>`;
  return failedCard(x.it);
}
/** Go through them: one row at a time, full width. */
function walkHtml(d) {
  const list = walkList(d);
  const w = S.ui.walk;
  if (!list.length) {
    return '<section class="walk done" aria-label="Go through them"><p class="walk-n">That is everything.</p><p class="dim">Nothing else is waiting on you.</p>' +
      '<div class="row"><button type="button" class="btn primary" data-walk="stop">Back to the Inbox</button></div></section>';
  }
  const i = Math.min(Math.max(0, w.i || 0), list.length - 1);
  const x = list[i];
  return `<section class="walk" aria-label="Go through them" data-walk-key="${h(x.key)}"><div class="walk-head"><span class="walk-n">${i + 1} of ${list.length}</span>` +
    `<span class="row"><button type="button" class="btn ghost" data-walk="prev"${i ? '' : ' disabled'}>Previous</button><button type="button" class="btn ghost" data-walk="next"${i < list.length - 1 ? '' : ' disabled'}>Skip</button>` +
    `<button type="button" class="btn" data-walk="stop">Done</button></span></div>${walkRowHtml(x)}` +
    '<p class="walk-keys"><kbd>A</kbd> approve or the main button <kbd>S</kbd> send back <kbd>N</kbd> skip <kbd>P</kbd> previous <kbd>O</kbd> open <kbd>Esc</kbd> stop</p></section>';
}
export function inboxHtml() {
  const d = inboxData();
  const n = inboxCount(d);
  let html = (S.digestHtml ? S.digestHtml(h) : '') + onboardHtml();
  if (n && S.ui.walk) return html + walkHtml(d);
  if (n) {
    html += `<div class="inbox-head"><p><b>${plural(n, 'thing needs', 'things need')} you.</b> Approve what you have read; send back what needs another pass.</p>` +
      (n > 1 ? '<button type="button" class="btn primary" data-walk="start" title="One at a time, with keys">Go through them</button>' : '') + '</div>';
  }
  if (d.asks.length) html += section('asks', 'Agents asking you', d.asks.length, `<div class="asks">${d.asks.map(askHtml).join('')}</div>`);
  if (d.gates.length) html += section('gates', 'Ready for your review', d.gates.length, `<div class="icards">${d.gates.map(gateCard).join('')}</div>`);
  if (d.code.length) html += section('code', 'Code reviews to do', d.code.length, `<div class="rows">${d.code.map(codeRow).join('')}</div>`, 'Read the diff before anything is pushed.');
  if (d.failed.length) html += section('failed', 'Stopped or blocked', d.failed.length, `<div class="icards">${d.failed.map(failedCard).join('')}</div>`);
  if (d.prs) {
    html += `<div class="inbox-prs"><span>${plural(d.prs, "teammate's PR", "teammates' PRs")} waiting on you with no review yet.</span><button type="button" class="btn" data-tab="reviews">Open Reviews</button></div>`;
  }
  if (!n) {
    html += '<div class="empty small"><p>Nothing needs you right now.</p></div>';
    const runs = workItems().filter(it => it.kind === 'item' && !isShip(it));
    const by = {};
    runs.forEach(it => { const b = bucketOf(it); (by[b] = by[b] || []).push(it); });
    const pick = pickItem(runs, by);
    if (pick) html += pickupHtml(pick);
    else if (!all().length && !onboardHtml()) html += startEmpty('No work yet', 'Pick a flow: build a feature, fix a bug, investigate a question, plan an epic, or write docs.');
  }
  return html;
}
function startEmpty(title, text) {
  return `<div class="empty"><h2>${h(title)}</h2><p>${h(text)}</p><div class="do"><button type="button" class="btn primary" data-start-open="1">Start work</button></div>` +
    '<p class="hint">Or type <span class="cmd">/start new feature</span> in opencode.</p></div>';
}

// ------------------------------------------------------------------ Work
/** Which group a row is in on Work. */
export function workGroup(it) {
  if (isFinished(it)) return 'done';
  if (it.paused || it.bucket === 'paused') return 'paused';
  if (isShip(it)) return 'ship';
  if (autoIs(it, 'running') || isBusy(itemSession(it))) return 'working';
  return 'next';
}
const WORK_GROUPS = [
  ['working', 'Tandem working', ''],
  ['next', 'Up next', 'Nothing is running. The button starts the next step.'],
  ['ship', 'Shipping', 'PR text is written. Push from the code review, create the PR, then Remove the run once it merges.'],
  ['paused', 'Paused', ''],
  ['done', 'Done', 'Findings to read, published specs, backlogs made. Remove a folder when you no longer need it.']
];
/** The flow filter: All, then each flow with work in it. */
function flowFilterHtml(list) {
  const n = id => list.filter(it => (flowOf(it) || {}).id === id).length;
  const cur = S.ui.flow || 'all';
  const shown = FLOWS.filter(f => f.id !== 'quick' && n(f.id));
  const other = list.filter(it => !flowOf(it)).length;
  if (shown.length + (other ? 1 : 0) < 2) return '';
  const chip = (id, label, c) => `<button type="button" class="fchip${cur === id ? ' on' : ''}" data-filter-flow="${h(id)}" aria-pressed="${cur === id}"><span>${h(label)}</span><span class="n">${c}</span></button>`;
  return `<div class="filters" role="group" aria-label="Flow">${chip('all', 'All', list.length)}${shown.map(f => chip(f.id, f.tag + 's', n(f.id))).join('')}${other ? chip('other', 'Other', other) : ''}</div>`;
}
function inFlow(it) {
  const cur = S.ui.flow || 'all';
  if (cur === 'all') return true;
  const f = flowOf(it);
  return cur === 'other' ? !f : !!f && f.id === cur;
}
function folderDot(it) {
  const s = itemSession(it);
  const st = asking(it) ? ['review', 'Asking you'] : isBusy(s) ? ['running', 'Running'] : isFinished(it) ? ['done', 'Done'] : ['idle', 'Up next'];
  return `<span class="sd ${st[0]}" aria-hidden="true" title="${st[1]}"></span>`;
}
/** One piece of work as a row: status, flow, title (opens its page), the step it is at, whose turn, and its main button. */
export function workRow(it) {
  const meta = [`<span class="tag">${h(flowTag(it))}</span>`];
  const sl = stepLine(it);
  if (sl) meta.push(h(sl));
  else if (it.state) meta.push(h(it.state));
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">${ago(it.modifiedMs)}</span>`);
  const merged = isShip(it) && (slateOf(it) || {}).merged;
  let turn = turnHtml(it);
  if (merged) turn = '<span class="turnw t-done">Merged.</span> Remove the run to clean up its folder.';
  else if (isShip(it) && (it.pr || []).length) turn = `<span class="turnw t-you">Your turn:</span> ${h(MINE_STATE[mineState(it)] || '')}`;
  let act;
  if (workGroup(it) === 'working') act = ''; // its page has Stop
  else if (it.kind === 'item') act = merged ? removeBtn(it) : isShip(it) ? `<button type="button" class="btn" data-open-run="${h(it.folder)}">Open</button>` : nextBtns(it, true);
  else act = folderActs(it, false);
  const state = it.kind === 'item' ? stateVar(it) : asking(it) ? 'var(--gate)' : isBusy(itemSession(it)) ? 'var(--go)' : 'var(--line)';
  return `<article class="rrow" id="item-${h(itemKey(it))}" style="--state:${state}">${it.kind === 'item' ? statusDot(runStatus(it)) : folderDot(it)}` +
    `<button type="button" class="rr-t" data-open-run="${h(it.folder)}">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</button>` +
    `<span class="rr-m">${meta.join(' · ')}</span>` + (turn ? `<span class="rr-next">${turn}</span>` : '') +
    `<span class="rr-act">${projectChip(it)}${act}</span></article>`;
}
function sessionCard(o) {
  const s = o.s;
  const perms = L().permissions.filter(p => p.sessionID === o.session), qs = L().questions.filter(q => q.sessionID === o.session);
  const dismiss = !isBusy(s) && !perms.length && !qs.length ? `<button type="button" class="btn remove" data-dismiss="${h(o.session)}" title="Stop showing this here. The session stays in opencode.">Dismiss</button>` : '';
  return `<article class="item" style="--state:var(--${isBusy(s) ? 'go' : 'hold'})"><div class="item-head"><h4 class="t">${h(s.title || o.command)}</h4><div class="meta"><span title="${h(stamp(o.at))}">Started ${ago(o.at)}</span>${dismiss}</div></div>` +
    sessionBox(s, perms, qs, 'Reply to the agent. Ctrl+Enter sends.') + '</article>';
}
export function workHtml() {
  const list = workItems();
  const inbox = inboxFolders();
  const waiting = inboxCount();
  const mine = list.filter(it => !inbox.has(it.folder));
  const shown = mine.filter(it => inProject(it) && inFlow(it));
  const live = startingSessions();
  let html = '<div class="scope-head"><h2>All runs</h2><span class="dim">Everything Tandem has in flight, every flow. Each run is on the board too; what needs you is in the Inbox.</span><button type="button" class="btn ghost sm" data-tab="board">Back to the board</button></div>';
  if (waiting) html += `<div class="inbox-prs waiting"><span><b>${plural(waiting, 'thing is', 'things are')} waiting on you</b> in the Inbox.</span><button type="button" class="btn primary" data-tab="inbox">Open Inbox</button></div>`;
  html += flowFilterHtml(mine) + projectFilterHtml(mine);
  if (live.length) html += section('starting', 'Starting', live.length, `<div class="items">${live.map(sessionCard).join('')}</div>`, 'Sessions with no folder yet: a spike, epic, doc or TSD until its folder exists, and repo guides.');
  if (!mine.length && !live.length) return html + startEmpty(list.length ? 'Nothing else in flight' : 'No work yet', 'Pick a flow: build a feature, fix a bug, investigate a question, plan an epic, or write docs.');
  if (!shown.length && mine.length) html += '<div class="empty small"><p>Nothing here with these filters.</p></div>';
  const by = {};
  shown.forEach(it => { const g = workGroup(it); (by[g] = by[g] || []).push(it); });
  WORK_GROUPS.forEach(([k, name, hint]) => {
    const g = by[k] || [];
    if (!g.length) return;
    const sorted = k === 'ship' ? newest(g).sort((a, b) => (+!!(slateOf(b) || {}).merged) - (+!!(slateOf(a) || {}).merged)) : newest(g);
    html += section(k, name, g.length, `<div class="rows">${sorted.map(workRow).join('')}</div>`, hint);
  });
  return html;
}

// ------------------------------------------------------------------ a run's page, driven by its flow
/** The step in view on a run's page: the one picked, else the one the run is at. */
export function selectedStep(it) {
  const steps = stepsOf(flowOf(it), it.lane);
  const want = S.ui.step[it.folder];
  if (want && steps.some(s => s.key === want)) return steps.find(s => s.key === want);
  return currentStep(it) || steps[0] || null;
}
/** done, here or later: where a step is relative to the run. */
export function stepRel(it, step) {
  const steps = stepsOf(flowOf(it), it.lane);
  const i = stepIndex(it), j = steps.findIndex(s => s.key === step.key);
  if (i >= steps.length) return j === steps.length - 1 && !isFinished(it) ? 'here' : 'done';
  return j < i ? 'done' : j === i ? 'here' : 'later';
}
/** The file a step shows inline. Here: the file to read at a gate, else the step's own. Done: what the step wrote. */
export function stepFile(it, step, rel) {
  if (!step) return null;
  const files = it.files || [];
  if (rel === 'later') return null;
  if (rel === 'here') {
    const g = gateFile(it);
    if (g) return g;
    if (it.kind === 'item' && ['build', 'ship', 'pr'].includes(step.key)) return null; // tasks, the PR box
  } else if (it.kind === 'item' && step.key === 'build') return null; // its tasks list
  if (it.kind === 'item' && step.key === 'start') return files.includes('brief.md') ? 'brief.md' : null;
  if (it.kind === 'item' && step.key === 'review') return files.includes('review.md') ? 'review.md' : null;
  if (it.kind === 'item' && step.key === 'pr' && rel === 'done') return null; // shown on Ship
  return step.file && files.includes(step.file) ? step.file : null;
}
function stepPanelHtml(it, step) {
  const rel = stepRel(it, step);
  const sub = rel === 'here' ? hereWords(it, step) : rel === 'done' ? 'Done' : step.you ? 'Stops for you' : 'Tandem runs this';
  let body = '';
  const file = stepFile(it, step, rel);
  if (rel === 'here') {
    if (it.kind === 'item') {
      body += autoHtml(it) + nextHtml(it, true);
      if (sendBackCommand(it)) body += `<div class="row acts"><button type="button" class="btn ghost" data-sb-toggle="${h(it.folder)}" aria-expanded="${!!S.ui.open['sb:' + it.folder]}">Send back with a note</button></div>` + sendBackHtml(it);
      if (step.key === 'ship' || it.stage === 'ship') body += prHtml(it);
      if (step.key === 'build') body += tasksHtml(it);
    } else {
      const acts = folderActs(it, true);
      const turn = turnHtml(it);
      if (!file && it.summary) body += `<p class="pre">${md(it.summary)}</p>`;
      body += `<div class="do"><span class="act">${turn || h(step.what)}</span>${acts ? `<span class="row" style="margin-left:auto">${acts}</span>` : ''}</div>`;
      if (sendBackCommand(it)) body += `<div class="row acts"><button type="button" class="btn ghost" data-sb-toggle="${h(it.folder)}" aria-expanded="${!!S.ui.open['sb:' + it.folder]}">Send back with a note</button></div>` + sendBackHtml(it);
    }
    body += fileInline(it, file, false) + agentHtml(it);
    if (it.kind === 'item') body += leftOffHtml(it);
  } else if (rel === 'done') {
    if (it.kind === 'item' && step.key === 'build') body += tasksHtml(it);
    body += file ? fileInline(it, file, false) : '';
    if (!file && !(it.kind === 'item' && step.key === 'build')) body += '<p class="dim">Nothing to show for this step.</p>';
  } else {
    body += `<p class="dim">${step.you ? 'This step stops for you.' : 'Tandem runs this step.'} It has not started.</p>`;
  }
  return `<section class="spanel ${rel}" aria-label="${h(step.name)}"><div class="sp-head"><h3>${h(step.name)}</h3><span class="sp-sub">${h(sub)}</span></div>` +
    `<p class="sp-what">${h(step.what)}</p>${body}</section>`;
}
/** A folder no flow knows (Slate's folders, anything else in .work): its state, next step and files. */
function plainPageBody(it) {
  let body = '';
  if (it.state) body += `<p class="doc-state"><strong>${h(it.state)}</strong></p>`;
  if (it.summary) body += `<p class="pre">${md(it.summary)}</p>`;
  const cmd = folderCommand(it);
  if (it.nextText) body += `<div class="next-line"><span class="lbl">Next</span><span>${md(it.nextText)}</span>${runBtn(it, cmd)}</div>`;
  return body + agentHtml(it);
}
export function runPageHtml(it) {
  const f = flowOf(it);
  const back = { inbox: ['inbox', 'Inbox'], work: ['work', 'All runs'], health: ['health', 'Health'] }[S.ui.back] || ['board', 'Board'];
  const meta = [`<span class="tag">${h(flowTag(it))}</span>`];
  if (it.adoState) meta.push(`<span title="ADO state when the item was fetched">ADO: ${h(it.adoState)}</span>`);
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">Touched ${ago(it.modifiedMs)}</span>`, projectChip(it), slateChip(it), removeBtn(it));
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  let main;
  if (f && stepIndex(it) >= 0) {
    const sel = selectedStep(it);
    main = flowTrackHtml(it, sel && sel.key) + (sel ? stepPanelHtml(it, sel) : '');
  } else main = plainPageBody(it);
  const details = [];
  if (it.kind === 'item') details.push(`<div class="dsec"><p class="sub-h">Repos</p>${reposTable(it)}${kitHtml(it)}</div>`);
  const files = filesHtml(it);
  if (files) details.push(`<div class="dsec">${files}</div>`);
  const act = it.kind === 'item' ? activityHtml(it.folder) : '';
  if (act) details.push(`<div class="dsec"><p class="sub-h">Activity</p>${act}</div>`);
  return `<button type="button" class="lnk back" data-close-run="${back[0]}">&larr; ${back[1]}</button>` +
    `<article class="item run-page" id="item-${h(itemKey(it))}" style="--state:${it.kind === 'item' ? stateVar(it) : asking(it) ? 'var(--gate)' : 'var(--line)'}">` +
    `<div class="item-head"><h2 class="t">${it.id ? idLink(it) : ''}${title}</h2><div class="meta">${meta.join('')}</div></div>${main}` +
    (details.length ? `<details class="run-details"${openAttr('det:' + it.folder, false)}><summary>${it.kind === 'item' ? 'Repos, files and activity' : 'Files'}</summary><div class="detail-body">${details.join('')}</div></details>` : '') +
    '</article>';
}

/** The .work files the page in view shows inline, as [folder, file] pairs, for main.js to read (file.read). */
export function wantedFiles() {
  const out = [];
  const add = (it, name) => { if (it && name) out.push([it.folder, name]); };
  const t = S.ui.tab;
  // The run in the board's open card (Loom): its gate's file, shown inline in the panel.
  const pr = panelRun() && itemForFolder(panelRun());
  if (pr && pr.kind !== 'pr' && atGate(pr)) add(pr, gateFile(pr));
  if (S.ui.run && (BOARD_TABS.includes(t) || t === 'work' || t === 'inbox')) {
    const it = itemForFolder(S.ui.run);
    if (it && it.kind !== 'pr') {
      const sel = flowOf(it) && stepIndex(it) >= 0 ? selectedStep(it) : null;
      if (sel) add(it, stepFile(it, sel, stepRel(it, sel)));
      if (it.kind === 'spike') add(it, (it.files || []).includes('findings.md') ? 'findings.md' : null);
    }
    return out;
  }
  if (t === 'inbox') {
    const d = inboxData();
    const rows = S.ui.walk ? walkList(d).slice(Math.max(0, S.ui.walk.i || 0), (S.ui.walk.i || 0) + 2).filter(x => x.kind === 'gate').map(x => x.it) : d.gates;
    rows.forEach(it => add(it, gateFile(it)));
  }
  return out;
}

// ------------------------------------------------------------------ the tab bar and the page
function tabCount(id) {
  if (id === 'inbox') { const n = inboxCount(); return n ? `<span class="cnt gate">${n}</span>` : ''; }
  if (id === 'work') {
    const inbox = inboxFolders();
    const n = workItems().filter(it => !inbox.has(it.folder) && !isFinished(it)).length;
    return n ? `<span class="n" title="In flight">${n}</span>` : '';
  }
  if (id === 'reviews') { const a = reviewsAsking(), n = toReviewCount(); return a ? `<span class="cnt gate" title="The reviewer is waiting for you">${a}</span>` : n ? `<span class="cnt" title="${plural(n, 'PR')} waiting on you with no review yet">${n}</span>` : ''; }
  return '';
}
export function tabsHtml() {
  return '<nav class="tabs" aria-label="Loom">' + TABS.map(([id, name]) => {
    const on = S.ui.tab === id || (id === 'board' && S.ui.tab === 'work');
    return `<button type="button" class="tab${on ? ' on' : ''}" data-tab="${id}"${on ? ' aria-current="page"' : ''}><span>${h(name)}</span>${S.D ? tabCount(id) : ''}</button>`;
  }).join('') + '</nav>';
}
/** The tab in view. A run's page replaces the list it was opened from. */
export function pageHtml() {
  const t = S.ui.tab;
  if (t === 'chat') return '<div id="chat-slot"></div>';
  if (t === 'reviews') return reviewsHtml();
  const it = S.ui.run ? itemForFolder(S.ui.run) : null;
  if (it && it.kind !== 'pr') return runPageHtml(it);
  // Board and Health are the board half's page (#board-root), shown under the tab bar.
  if (BOARD_TABS.includes(t)) return '';
  // All runs (Dispatch's Work tab until Loom 4.0.0): every run in one list, with the flow and project filters.
  if (t === 'work') return workHtml();
  return inboxHtml();
}

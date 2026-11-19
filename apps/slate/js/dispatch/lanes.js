/* Loom lanes (Loom 5.0.0; plan: claude/loom-lanes-v1-plan.md in the Workshop project). One drop box and four lanes that
   every kind of work moves through, skipping the ones it does not need:
   - Clarify: Tandem is setting up or asking you something before it plans.
   - Plan: a spec, a root cause or a draft for you to approve (builds, bug fixes, epics, docs).
   - Work: Tandem works; nothing is needed from you.
   - Ready: the result, with what to do next (PR text, a diagnosis, findings, a doc to save).
   A card moves on its own as the run moves: the lane follows from the run's flow and step (flows.js), nothing is stored.
   The panel beside the lanes holds the run's own card (pages.js runCardHtml), so every button there is the one the
   Inbox and the board already use. No DOM: main.js paints what these return and handles the clicks. */
import { S } from './state.js';
import { h, plural, asking, itemSession, isBusy, autoIs, itemForFolder, adoOn } from './view.js';
import { flowOf, stepIndex, isFinished, turnHtml, stepLine } from './flows.js';
import { workItems, startingSessions, inboxData, inboxFolders, isShip, runCardHtml, asksFor, fileInline } from './pages.js';
import { pickable, boardFeed } from '../loom.js';
import { projectFilterHtml, inProject, projectFilter, projectChip } from './projects.js';
import { reviewsHtml } from './pr-reviews.js';
import { noticedHtml, noticedCount } from './noticed.js';
import { floorHtml, epicPanelHtml, rowsHtml, onboardPickHtml } from './floor.js';
import { teachHtml, teachCount, teachBlocking, publishAllHtml, publishOf, adoLinkOf, adoLinkHtml, adoNoticeHtml } from './factory.js';
// Set by pages.js (it imports this module): the onboarding guide and an ask's source, for Loom 6.0.0's Lanes.
// var, no initializer: pages.js may run this setter before this module's body (they import each other).
var onboardTop, askLabel; // eslint-disable-line no-var
export function setLaneHelpers(o) { onboardTop = o.onboard || null; askLabel = o.askSource || null; }

export const LANES = [
  { id: 'clarify', name: 'Clarify', desc: 'A first look, then any questions for you' },
  { id: 'plan', name: 'Plan', desc: 'A spec or draft to approve' },
  { id: 'work', name: 'Work', desc: 'Tandem works. Nothing needed from you.' },
  { id: 'ready', name: 'Ready', desc: 'Results to check and send on' }
];
export const LANE_IDS = LANES.map(l => l.id);

/** The kinds of work, as the drop box and the cards name them. `lanes`: the lanes the kind goes through. */
export const KINDS = {
  build: { name: 'Build', lanes: ['clarify', 'plan', 'work', 'ready'] },
  diagnose: { name: 'Diagnose', lanes: ['clarify', 'work', 'ready'] },
  ask: { name: 'Ask', lanes: ['clarify', 'work', 'ready'] },
  docs: { name: 'Docs', lanes: ['plan', 'work', 'ready'] },
  epic: { name: 'Epic', lanes: ['clarify', 'plan', 'work', 'ready'] },
  handoff: { name: 'Hand off', lanes: ['clarify', 'plan', 'work', 'ready'] },
  request: { name: 'Request', lanes: ['clarify', 'plan', 'work', 'ready'] },
  review: { name: 'Review', lanes: ['ready'] },
  other: { name: 'Run', lanes: ['clarify', 'work', 'ready'] }
};
/** The kinds the drop box starts (the other flows are under Other flows). */
export const DROP_KINDS = ['build', 'diagnose', 'ask', 'handoff'];

/** Which kind a run is: a feature, bug or small change is Build; a log diagnosis Diagnose; an investigation Ask. */
export function kindOf(it) {
  const f = flowOf(it);
  if (!f) return 'other';
  if (['feature', 'bug', 'small'].includes(f.id)) return 'build';
  if (f.id === 'diagnose') return 'diagnose';
  if (f.id === 'spike') return 'ask';
  if (f.id === 'docs' || f.id === 'tsd') return 'docs';
  if (f.id === 'epic') return 'epic';
  return 'other';
}

/** The lane a run is in, or 'done' once nothing is left (a closed spike, a saved doc, a merged or resolved build). */
export function laneOf(it) {
  if (!it) return 'clarify';
  const f = flowOf(it);
  if (it.kind === 'item') {
    if (it.bucket === 'done') return 'done';
    if (isShip(it)) return 'ready';
    const st = it.stage;
    if (!st || st === 'start') return 'clarify';
    if (['spec', 'plan', 'tasks', 'quick', 'bug'].includes(st)) {
      // /spec asks its questions before it writes the spec: while it asks, the card is still clarifying.
      return asking(it) && !(it.next && it.next.needsYou) ? 'clarify' : 'plan';
    }
    return 'work'; // build and review
  }
  if (!f) return isFinished(it) ? 'done' : asking(it) ? 'clarify' : 'work';
  if (isFinished(it)) return 'done';
  const i = stepIndex(it);
  if (f.id === 'spike' || f.id === 'diagnose') return i >= 1 ? 'ready' : asking(it) ? 'clarify' : 'work';
  if (f.id === 'epic') return i <= 0 ? (asking(it) ? 'clarify' : 'work') : i === 1 || i === 3 ? 'plan' : i === 2 ? 'work' : 'ready';
  if (f.id === 'docs' || f.id === 'tsd') return i === 1 ? 'plan' : i === 3 || i === 4 ? 'ready' : 'work';
  return 'work';
}

/** True when the card waits on you: it is in the Inbox (asking, at a gate, a code review, stopped). */
export function yourTurn(it, folders) {
  return !!it && (folders || inboxFolders()).has(it.folder);
}

/** The lane dots on a card: one per lane, skipped lanes dashed, done ones faded, the current one filled. */
export function laneDots(kind, lane) {
  const used = (KINDS[kind] || KINDS.other).lanes;
  const cur = LANE_IDS.indexOf(lane === 'done' ? 'ready' : lane);
  return LANES.map((l, i) => {
    const st = !used.includes(l.id) ? 'skip' : lane === 'done' || i < cur ? 'done' : i === cur ? 'now' : 'next';
    const word = { skip: ' (skipped)', done: ' (done)', now: ' (now)', next: '' }[st];
    return { lane: l.id, st, title: l.name + word };
  });
}

/** What a card says under its title, in a few words. */
function statusOf(it, lane) {
  if (it.paused) return 'Paused';
  if (it.blocked) return 'Stopped: ' + String(it.blocked).replace(/\s+/g, ' ').slice(0, 90);
  const s = itemSession(it);
  if (s && s.error && !isBusy(s)) return 'Stopped: ' + String(s.error).slice(0, 90);
  if (asking(it)) return 'Tandem has a question for you';
  if (autoIs(it, 'queued')) return 'Queued for autopilot';
  if (autoIs(it, 'running') || isBusy(s)) return (s && s.activity) || stepLine(it) || 'Working';
  if (lane === 'clarify') return it.kind === 'item' ? 'Setting up' : 'Up next';
  // Core 4.6.0: a spike's first look is on the card while it keeps digging.
  if (lane === 'work' && hasFirstLook(it)) return 'First look ready; still digging';
  const sl = stepLine(it);
  return sl || String(it.state || '');
}
/** A spike that wrote its first look (Core 4.6.0) and has no findings yet. */
export const hasFirstLook = it => !!it && it.kind === 'spike' && (it.files || []).includes('first-look.md') && !(it.files || []).includes('findings.md');
/** The action named on a card that waits on you. */
function actionOf(it, kind, lane) {
  if (it.blocked || (itemSession(it) && itemSession(it).error && !isBusy(itemSession(it)))) return 'See why it stopped';
  if (asking(it)) return 'Answer';
  if (lane === 'plan') return kind === 'build' && it.stage === 'bug' ? 'Review root cause' : kind === 'docs' ? 'Read the draft' : 'Review spec';
  if (lane === 'ready') return kind === 'build' ? (publishOf(it) && publishOf(it).published ? 'Open PR' : 'Publish') : kind === 'diagnose' ? 'See the fix' : kind === 'ask' ? 'Read the answer' : kind === 'epic' ? 'Create in ADO' : 'Pick what is next';
  return 'Open';
}

/** Everything the lanes show: each run as a card in its lane (your turn first, then newest), starting sessions in
 *  Clarify, and how many finished today. `filter`: all, mine, or a kind. */
export function lanesData(filter = 'all') {
  const d = inboxData();
  const folders = inboxFolders(d);
  const today = S.today;
  const dayOf = ms => { const x = new Date(ms); return isNaN(x) ? '' : x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const cards = [];
  let done = 0;
  const doneList = [];
  for (const it of workItems()) {
    const lane = laneOf(it);
    // Projects (All runs' filter until Loom 6.0.0): filtered to a project, only its runs show.
    if (!inProject(it)) continue;
    if (lane === 'done') { if (it.modifiedMs && dayOf(it.modifiedMs) === today) { done++; doneList.push({ folder: it.folder, title: it.title || it.folder, kind: kindOf(it), id: it.id || null }); } continue; }
    const kind = kindOf(it);
    const mine = yourTurn(it, folders);
    const ses = itemSession(it);
    const link = adoLinkOf(it);
    cards.push({ it, ado: !!(link && link.linked), sid: ses && ses.id ? ses.id : null, folder: it.folder, kind, lane, mine, title: it.title || it.folder, id: it.id || null, status: statusOf(it, lane), action: mine ? actionOf(it, kind, lane) : '', dots: laneDots(kind, lane), at: it.modifiedMs || 0 });
  }
  for (const o of startingSessions()) {
    const s = o.s || {};
    const kind = /^\/spike\b/.test(o.command || '') ? (/--log\b/.test(o.command || '') ? 'diagnose' : 'ask') : /^\/(docs|tsd)\b/.test(o.command || '') ? 'docs' : /^\/scope\b/.test(o.command || '') ? 'epic' : 'build';
    const perms = S.L ? S.L.permissions.filter(p => p.sessionID === o.session).length + S.L.questions.filter(q => q.sessionID === o.session).length : 0;
    cards.push({ it: null, session: o.session, folder: '', kind, lane: 'clarify', mine: perms > 0, title: s.title || o.command || 'Starting', id: null,
      status: perms ? 'Tandem has a question for you' : isBusy(s) ? 'Taking a first look' : 'Starting', action: perms ? 'Answer' : '', dots: laneDots(kind, 'clarify'), at: o.at || 0 });
  }
  // Prompts and questions from sessions no card holds (Chat, a PR review, the terminal): a card each, in Clarify,
  // so nothing that waits on you is only in a retired Inbox (Loom 6.0.0).
  const held = new Set(cards.map(c => c.session).filter(Boolean));
  const heldFolders = new Set(cards.map(c => c.folder).filter(Boolean));
  for (const a of d.asks || []) {
    const x = a.x || {};
    if ((x.folder && heldFolders.has(x.folder)) || held.has(x.sessionID)) continue;
    held.add(x.sessionID);
    const src = askLabel ? askLabel(x) : { what: 'Agent', label: 'A session' };
    cards.push({ it: null, session: x.sessionID, folder: '', kind: 'other', lane: 'clarify', mine: true, title: src.label || 'A session is asking', id: null, status: `${src.what || 'Tandem'} is asking you something`, action: 'Answer', dots: laneDots('other', 'clarify'), at: Date.now() });
  }
  const projOnly = projectFilter() !== 'all';
  // The board's own items (Loom 5.2.0): requests, hand-offs and drafts to approve; they open the board's panel.
  for (const b of (projOnly ? [] : boardFeed())) {
    const kind = KINDS[b.kind] ? b.kind : 'request';
    const lane = LANE_IDS.includes(b.lane) ? b.lane : 'clarify';
    cards.push({ it: null, board: b.id, folder: '', kind, lane, mine: !!b.mine, title: b.title, id: b.adoId || null, status: b.mine && b.action ? b.action : b.status, action: b.mine ? 'Open' : '', dots: laneDots(kind, lane), at: b.at || 0 });
  }
  // Teammates' PRs waiting on your review: one card in Ready that opens the review list.
  if (d.prs && !projOnly) cards.push({ it: null, reviews: true, folder: '', kind: 'review', lane: 'ready', mine: true, title: plural(d.prs, "teammate's PR to review", "teammates' PRs to review"), id: null, status: 'Waiting on your review', action: 'Review', dots: laneDots('review', 'ready'), at: 0 });
  const shown = cards.filter(c => filter === 'all' ? true : filter === 'mine' ? c.mine : c.kind === filter);
  const lanes = LANES.map(l => ({ ...l, cards: shown.filter(c => c.lane === l.id).sort((a, b) => (b.mine - a.mine) || (b.at - a.at)) }));
  const counts = { all: cards.length, mine: cards.filter(c => c.mine).length };
  for (const k of Object.keys(KINDS)) counts[k] = cards.filter(c => c.kind === k).length;
  return { lanes, done, doneList, counts, cards, prs: d.prs || 0 };
}

// ------------------------------------------------------------------ the drop box
const LOG_RE = /(exception|traceback|stack ?trace|\bat [A-Za-z_$][\w$.<>]*\(|^\s+at\s|\berror\b[:\s]|\bfailed\b|status code 5\d\d|\bfatal\b)/im;
const ASK_RE = /^(what|how|why|which|where|who|when|does|do|is|are|can|could|should|would|will|has|have)\b/i;
/** The kind the drop box guesses from what you pasted: a log is Diagnose, a question Ask, anything else Build. */
export function guessKind(text) {
  const t = String(text || '').trim();
  if (!t) return 'build';
  if (LOG_RE.test(t) && (t.split('\n').length > 1 || /exception|traceback|stack ?trace/i.test(t))) return 'diagnose';
  if (/\?\s*$/.test(t) || (ASK_RE.test(t) && t.split('\n').length <= 2 && t.length <= 500)) return 'ask';
  return 'build';
}
/** An ADO work item number on its own ("12345", "#12345", "ADO 12345"), or null. */
export function adoIdOf(text) {
  const t = String(text || '');
  const m = /^\s*(?:ado\s*|#)?([0-9]{3,10})\s*$/i.exec(t) || /^\s*(?:ado\s*#?|#)([0-9]{3,10})(?:\s|$)/i.exec(t);
  return m ? m[1] : null;
}
/** The kind an ADO item starts as: a bug is fixed (Build), a spike investigated (Ask), anything else built. */
export function kindOfAdoType(type) { return /spike|research|investigat/i.test(String(type || '')) ? 'ask' : 'build'; }
/** The From ADO picker's rows for a search: by number or every word of the title, at most `max`. */
export function pickRows(list, q = '', max = 8) {
  const words = String(q || '').toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean);
  const hit = it => !words.length || words.every(w => String(it.id).startsWith(w) || String(it.title || '').toLowerCase().includes(w));
  return (Array.isArray(list) ? list : []).filter(hit).slice(0, max);
}
/** What Start work runs for the drop box: a Start work state and its drafts, for view.js startRequest. A Build with
 *  only an ADO number starts that item (when Tandem has ADO set up); otherwise the first line is the title and the
 *  whole text the description. Diagnose is Fix a bug from an error log; Ask is Investigate. */
export function dropStart(text, kind, opts = {}) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const t = raw.trim();
  if (!t) return { error: 'Paste a story, an error log or a question first.' };
  const base = { src: null, size: 'normal', type: 'docs', timebox: '', project: opts.project || null, busy: false, error: null, back: 'lanes' };
  if (kind === 'diagnose') return { st: { ...base, flow: 'bug', src: 'log' }, drafts: { log: raw } };
  if (kind === 'ask') return { st: { ...base, flow: 'spike' }, drafts: { topic: t.replace(/\s+/g, ' ').slice(0, 500) } };
  const lines0 = t.split('\n').map(l => l.trim()).filter(Boolean);
  if (kind === 'handoff') {
    // Hand off: the board's Hand to a person flow. Tandem drafts what to build; you pick who builds it.
    let title = lines0[0].replace(/^#+\s*/, '');
    if (title.length > 255) title = title.slice(0, 252).replace(/\s+\S*$/, '') + '...';
    const drafts = { title };
    if (lines0.length > 1) drafts.desc = t;
    return { st: { ...base, flow: 'handoff' }, drafts };
  }
  const id = adoIdOf(t);
  // An ADO item: a Bug is fixed (Fix a bug from the item), anything else built (Build a feature).
  if (id && (opts.ado === undefined ? adoOn() : opts.ado)) return { st: { ...base, flow: /bug/i.test(opts.adoType || '') ? 'bug' : 'feature', src: 'ado' }, drafts: { id } };
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  let title = lines[0].replace(/^#+\s*/, '');
  if (title.length > 200) title = title.slice(0, 197).replace(/\s+\S*$/, '') + '...';
  const drafts = { title };
  if (lines.length > 1 || lines[0].length > 200) drafts.desc = t;
  return { st: { ...base, flow: 'feature', src: 'describe' }, drafts };
}

// ------------------------------------------------------------------ drawing
const CHAT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function dotsHtml(dots) {
  return `<span class="ln-dots" aria-hidden="true">${dots.map(d => `<i class="ln-${d.lane} ${d.st}" title="${h(d.title)}"></i>`).join('')}</span>`;
}
/** A card's key in the lanes (its folder; board:<id>, reviews or session:<id> for the rest). */
export const keyOf = c => c.folder || (c.board ? 'board:' + c.board : c.reviews ? 'reviews' : 'session:' + c.session);
function cardHtml(c, sel) {
  const key = keyOf(c);
  const on = sel && sel === key;
  const label = `${KINDS[c.kind].name}: ${c.title}. ${c.status}${c.mine ? '. Your turn: ' + c.action : ''}`;
  return `<button type="button" class="ln-card${c.mine ? ' mine' : ''}${on ? ' on' : ''}" data-lane-open="${h(key)}" aria-pressed="${!!on}" aria-label="${h(label)}">` +
    `<span class="ln-top"><span class="ln-kind k-${c.kind}">${h(KINDS[c.kind].name)}</span>${c.id ? `<span class="ln-id">#${h(c.id)}</span>` : ''}${c.ado ? '<span class="ln-ado" title="Linked to ADO">ADO</span>' : ''}<span class="grow"></span>${dotsHtml(c.dots)}</span>` +
    `<span class="ln-title">${h(c.title)}</span><span class="ln-status">${h(c.status)}</span>` +
    (c.mine ? `<span class="ln-act">${h(c.action)}</span>` : '') + '</button>';
}
function laneHtml(l, sel, done) {
  // Ready: Publish all ready (Gate 2 for every build with nothing to answer).
  const extra = l.id === 'ready' ? publishAllHtml(l.cards.map(c => c.it).filter(Boolean)) : '';
  return `<section class="ln-lane ln-${l.id}" aria-label="${h(l.name)}"><header><span class="ln-dot" aria-hidden="true"></span><h2>${h(l.name)}</h2><span class="ln-n">${l.cards.length}</span></header>${extra}` +
    `<p class="ln-desc">${h(l.desc)}</p>` +
    (l.cards.length ? l.cards.map(c => cardHtml(c, sel)).join('') : '<p class="ln-empty">Nothing here.</p>') +
    (l.id === 'ready' && done.length ? `<button type="button" class="lnk plain ln-done" data-lane-done="1" aria-expanded="${!!S.ui.laneDone}">${done.length} done today</button>` +
      (S.ui.laneDone ? `<ul class="ln-donelist" role="list">${done.map(d => `<li><button type="button" class="lnk plain" data-open-run="${h(d.folder)}">${d.id ? '#' + h(d.id) + ' ' : ''}${h(d.title)}</button></li>`).join('')}</ul>` : '') : '') + '</section>';
}
function panelHtml(key, data) {
  // The Review card opens even when no teammate's PR waits (the old Reviews address, Review a link).
  const c = data.cards.find(x => keyOf(x) === key) || (key === 'reviews' ? { reviews: true, kind: 'review', lane: 'ready', title: "Teammates' PRs", id: null } : null);
  // A board item opens the board's own panel as a drawer (loom.js setBoardDrawer), not this one.
  if (!c || c.board) return '';
  const pills = laneDots(c.kind, c.lane).map(d => `<span class="ln-pill ln-${d.lane} ${d.st}" title="${h(d.title)}">${h(LANES.find(l => l.id === d.lane).name)}</span>`).join('');
  // Tandem's questions first: a card that says Answer opens on them, answerable here (not only in the Inbox).
  const asks = asksFor(c.folder, c.session);
  let body = asks ? `<div class="ln-asks">${asks}</div>` : '';
  if (c.reviews) {
    body = `<div class="ln-reviews">${reviewsHtml()}</div>`;
  } else if (c.it) {
    if (hasFirstLook(c.it)) body += `<div class="ln-first"><p class="ln-fh">First look</p>${fileInline(c.it, 'first-look.md')}</div>`;
    body += `<div class="loom-run ln-run">${runCardHtml(c.folder)}</div>` + epicPanelHtml(c.it) +
      adoLinkHtml(c.it, adoOn()) +
      `<div class="ln-foot"><button type="button" class="btn ghost" data-open-run="${h(c.folder)}">Open the run</button>${projectChip(c.it)}` +
      (c.sid ? `<button type="button" class="ibtn" data-open-chat="${h(c.sid)}" aria-label="Open the conversation in Chat" title="Open the conversation in Chat">${CHAT}</button>` : '') + '</div>';
  } else {
    body += asks ? '' : '<p class="dim">Tandem is taking a first look. The card gets its folder in a moment; any question it has shows here.</p>';
  }
  return `<aside class="ln-panel" aria-label="${h(c.title)}"><div class="ln-ph"><div class="ln-pt"><span class="ln-kind k-${c.kind}">${h(KINDS[c.kind].name)}</span>` +
    `<h3>${c.id ? `<span class="num">#${h(c.id)}</span> ` : ''}${h(c.title)}</h3></div><button type="button" class="ibtn" data-lane-close="1" aria-label="Close panel" title="Close">${X}</button></div>` +
    `<div class="ln-pills">${pills}</div>${c.it ? `<p class="iturn">${turnHtml(c.it)}</p>` : ''}${body}</aside>`;
}
export const LANE_FILTERS = [['all', 'All'], ['mine', 'Your turn'], ['build', 'Build'], ['diagnose', 'Diagnose'], ['ask', 'Ask'], ['teach', 'Teach'], ['noticed', 'Noticed']];
/** The drop box: one text box, the guessed kind (shown once there is text), Start, and Other flows. */
export function dropHtml() {
  const text = S.ui.drafts['lanes:drop'] || '';
  const kind = S.ui.dropKind || guessKind(text);
  // Hand off is a board flow: it needs no Tandem to add the card (Loom 6.0.0).
  const ready = (S.connector && S.connector.state === 'ready') || kind === 'handoff';
  const pick = text.trim() ? `<select class="ln-kindpick" data-lane-kind="1" aria-label="Kind of work (guessed from what you pasted)" title="Guessed from what you pasted. Change it if it is wrong.">` +
    DROP_KINDS.map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${h(KINDS[k].name)}</option>`).join('') + '</select>' : '';
  const list = pickable();
  const ado = list.length ? `<button type="button" class="lnk plain ln-adobtn" data-ado-toggle="1" aria-expanded="${!!S.ui.dropPick}">From ADO</button>` : '';
  return `<section class="ln-drop" aria-label="Start something"><label for="ln-drop" class="ln-dl">Drop anything: a user story or ADO number, an error log, or a question</label>` +
    `<textarea id="ln-drop" rows="3" data-draft="lanes:drop" placeholder="Paste a story, a stack trace or a question. Enter starts it; Shift+Enter for a new line.">${h(text)}</textarea>` +
    `<div class="ln-drow">${ado}<button type="button" class="lnk plain" data-start-open="1" title="Plan an epic, write docs, handle a request">Other flows</button>` +
    `<button type="button" class="lnk plain" data-onboard-toggle="1" aria-expanded="${!!S.ui.onboardPick}" title="Get a product ready for its first build">Onboard a product</button><span class="grow"></span>${pick}` +
    `<button type="button" class="btn primary" data-lane-start="1"${ready ? '' : ' disabled title="Connect opencode to start work"'}${S.ui.dropBusy ? ' disabled' : ''}>${S.ui.dropBusy ? 'Starting…' : 'Start'}</button></div>` +
    (S.ui.dropAdo && text.trim() ? `<label class="ln-keep"><input type="checkbox" data-drop-keep="1"${S.ui.dropKeep ? ' checked' : ''}> Keep it linked to ADO #${h(S.ui.dropAdo.id)} (otherwise it starts as a local item)</label>` : '') +
    (S.ui.dropPick && list.length ? pickerHtml(list) : '') + onboardPickHtml() + '</section>';
}
/** The From ADO picker: your team's backlog items nobody has started, newest change first, with a search. */
function pickerHtml(list) {
  const q = S.ui.drafts['lanes:adoq'] || '';
  const rows = pickRows(list, q);
  return `<div class="ln-pick"><input type="search" id="ln-adoq" data-draft="lanes:adoq" value="${h(q)}" placeholder="Search by number or title" aria-label="Search your ADO backlog">` +
    (rows.length ? `<ul role="list">${rows.map(r => `<li><button type="button" class="ln-prow" data-ado-pick="${h(r.id)}"><span class="ln-pid">#${h(r.id)}</span><span class="ln-ptitle">${h(r.title)}</span>` +
      `${r.type ? `<span class="ln-ptype">${h(r.type)}</span>` : ''}</button></li>`).join('')}</ul>` : '<p class="dim">Nothing matches.</p>') +
    `<p class="ln-pnote">Your team's open backlog, not started in Loom yet.</p></div>`;
}
/** The Lanes tab: the drop box, the filter chips, the four lanes, and the open card's panel beside them. */
export function lanesHtml() {
  const filter = LANE_FILTERS.some(([k]) => k === S.ui.laneFilter) ? S.ui.laneFilter : 'all';
  // Noticed is not a filter on the cards: it shows what Tandem spotted out of scope in place of the lanes.
  const noticed = filter === 'noticed';
  const teach = filter === 'teach';
  const data = lanesData(noticed || teach ? 'all' : filter);
  data.counts.noticed = noticedCount();
  data.counts.teach = teachCount();
  const sel = noticed || teach ? '' : S.ui.laneSel || '';
  const panel = sel ? panelHtml(sel, data) : '';
  const chips = `<div class="chips ln-chips" role="group" aria-label="Show">${LANE_FILTERS.map(([k, label]) =>
    `<button type="button" class="chip${filter === k ? ' on' : ''}" data-lane-filter="${k}" aria-pressed="${filter === k}">${h(label)}<span class="n">${data.counts[k] || 0}</span></button>`).join('')}` +
    '</div>';
  // The afternoon digest and first-run onboarding sit on top (they were on the Inbox until Loom 6.0.0).
  const top = (S.digestHtml ? S.digestHtml(h) : '') + (onboardTop ? onboardTop() : '') + adoNoticeHtml();
  if (noticed) return `<div class="ln-page">${top}${dropHtml()}${chips}${noticedHtml()}</div>`;
  if (teach) return `<div class="ln-page">${top}${dropHtml()}${chips}${teachHtml()}</div>`;
  // Loom 6.4.0: Floor (default) draws the same cards as stations on a line (floor.js). Loom 6.6.0: List is rows with a
  // station track (floor.js rowsHtml); Lanes keeps the four lanes (stored as 'list', its value before 6.6.0).
  const view = laneView();
  const views = `<div class="seg ln-views" role="group" aria-label="View">${[['floor', 'Floor'], ['rows', 'List'], ['list', 'Lanes']].map(([k, label]) =>
    `<button type="button" class="seg-b${k === view ? ' on' : ''}" data-lane-view="${k}" aria-pressed="${k === view}">${label}</button>`).join('')}</div>`;
  const body = view === 'list' ? `<div class="ln-body${panel ? ' has-panel' : ''}"><div class="ln-lanes">${data.lanes.map(l => laneHtml(l, sel, data.doneList)).join('')}</div>${panel}</div>`
    : view === 'rows' ? rowsHtml(data, sel, panel) : floorHtml(data, sel, panel);
  return `<div class="ln-page">${top}${dropHtml()}<div class="ln-bar">${chips}${views}</div>${projectFilterHtml(workItems())}${body}</div>`;
}
/** Floor, List (rows) or Lanes ('list'), kept in this browser with the project filter. Floor is the default. */
export const laneView = () => (S.view && ['list', 'rows'].includes(S.view.lanes) ? S.view.lanes : 'floor');
/** The tab bar's count on Lanes: cards waiting on you. */
export function lanesCount() { return lanesData('all').counts.mine + teachBlocking(); }
/** The run open in the lanes' panel, for wantedFiles (its gate's file is read inline). */
export function laneRun() {
  const k = S.ui.laneSel || '';
  if (!k || k.startsWith('session:')) return null;
  return itemForFolder(k);
}

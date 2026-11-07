/* Slate: your ADO backlog as one board, from request to resolved. model.js is pure, data.js talks to Workshop,
   view.js builds HTML, host.js frames Runway's team reports in Health. This file owns the page: state,
   refreshing from ADO and Tandem, and what each button does. */
import { connect } from '../../../shared/workshop-sdk.js';
import { readCards } from '../../../shared/summary.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import * as People from '../../../shared/people.js';
import { sendersFrom } from '../../../shared/handoffs.js';
import { connectorState, createStore, ado, readFiles, readWorkOffers, tandem } from './data.js';
import { hostFrame } from './host.js';
import {
  APP, NO_AREA, applyRoadmapItem, SHAPE_FILES, STAGE_TITLE, STEP_CHIP, aboutText, areaOf, boardColumn, releaseGroups, releaseNotesMd, runStep, timeline, answersBlock, appendAnswers, asksFor, questionAnswers, areaOptions, backTargets, forwardTargets, bySprint, cardFacts, cards, cleanPrefs, customRefs, daysInStage, decisionNote, devColumn, draftState, filterCards, health, isStale, newItem, notesBlock, ownersFor, parseBrief, parseTriage,
  moveBack, pendingIdeaCards, pmColumn, publishPlan, roadmapIdea, setStage, shapeState, skipToDecide, summaryCards, waitingTask, winOffer,
  levelOfType, needsAdoTitle, questionsText, repliesSince, sourceComment, suggestsScope
} from './model.js';
import { boardHtml, closeGroupDialogHtml, confirmHtml, linkAdoDialogHtml, delegateDialogHtml, fieldsDialogHtml, newDialogHtml, newIdeaDialogHtml, panelHtml, publishDialogHtml, readFieldsForm, topHtml } from './view.js';
import { healthHtml, sprintsHtml } from './health.js';

const $ = (id) => document.getElementById(id);
const topEl = $('top'), mainEl = $('main'), panelEl = $('panel'), dlg = $('dlg');

const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Slate');

const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(`slate.${k}`); localStorage.setItem(`slate.${k}`, v); } catch { /* storage blocked */ } return null; };

const ui = {
  tab: 'board', q: '', level: '', area: remember('area') || '', open: null,
  editing: false, shapeEditing: null, busy: false, error: '',
  wide: remember('wide') === '1',
  picks: {},       // question id -> {index: [labels]}: what is ticked in the panel, kept across repaints
  drafts: {},      // typed answers (q:<id>:<i>) and replies (r:<session>), kept across repaints
  agentOpen: {},   // session id -> whether its Agent section is open, once you open or close it
  folds: Object.fromEntries(['details', 'timeline'].map(k => [k, remember(`fold.${k}`)]).filter(([, v]) => v === '1' || v === '0').map(([k, v]) => [k, v === '1']))
};
const TABS = ['board', 'health'];
const s = {
  conn: { ado: 'Checking…', opencode: 'Checking…' },
  team: { areas: [], connection: '' },
  people: People.EMPTY,
  backlog: [], backlogNote: '',
  pending: [],                 // Runway's Pending assignment ideas (its summary's `pending` card rows)
  tstate: null,                // the opencode connector's `state`
  files: new Map(),            // folder -> {file: text}
  apps: [],
  sprints: null, sprintNote: '',
  details: new Map()           // ADO id -> {rev, key, loading, data, error, comments, commentsLoading, commentsError}
};
const store = createStore(ws, { onChange: () => { paint(); publishSummary(); } });

/* ---------- reading ADO and Tandem ---------- */

let refreshing = null;
async function refresh({ backlog = true } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    s.conn = await connectorState(ws);
    try { s.team = await ws.teams.get(); } catch { s.team = { areas: [], connection: '' }; }
    await readWork();
    if (backlog) await readBacklog();
    if (backlog) await fillAdoTitles();
    await readPending();
    await readTandem();
    if (backlog) await checkPrs();
    paint();
    publishSummary();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/* Runway's Pending assignment ideas, from its summary (Workshop docs/summaries.md): shown in New until you act
   on one. Only for showing; Slate copies the title and description into its own item when you do. */
async function readPending() {
  if (!runwayOn()) { s.pending = []; return; }
  let c = null;
  try { c = readCards(await ws.data.get('summary', { app: 'runway' }), 'runway'); } catch { c = null; }
  const card = c && c.get('pending');
  s.pending = (card && Array.isArray(card.rows) ? card.rows : []).filter(r => r && typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(r.id) && typeof r.title === 'string');
}

/* Offers to Slate: work started in Dispatch (kind `work`, a card in Building, or linked to the card for the same
   run) and requests captured on Home or in the hub (kind `request`, a card in New, or the card for that ADO item).
   The person accepted each where they clicked or typed it, so Slate adds them without asking. */
async function readWork() {
  if (!store.v.loaded) return;
  const senders = sendersFrom(s.apps, APP, { agents: 'Dispatch', home: 'Home' });
  let offers = [];
  try { offers = await readWorkOffers(ws, senders); } catch { offers = []; }
  if (!offers.length) return;
  try { await store.takeWork(offers); } catch { /* next refresh tries again */ }
}

async function readBacklog() {
  s.backlogNote = '';
  if (s.conn.ado !== true) { s.backlog = []; return; }
  if (!s.team.areas.length) { s.backlog = []; s.backlogNote = 'Set your team\'s area paths (Settings, People & teams, Team area paths) so Slate can list your ADO backlog. Home\'s Get started has a step for it.'; return; }
  try {
    const r = await ado(ws, 'backlog', { areas: s.team.areas, pointsFields: store.v.prefs.pointsFields, ...(s.team.connection ? { connection: s.team.connection } : {}) });
    s.backlog = r.items || [];
    if (r.truncated) s.backlogNote = `Showing the newest ${s.backlog.length} of ${r.total} open items.`;
    else await closeFinished();
  } catch (e) {
    s.backlog = [];
    s.backlogNote = `Could not read the ADO backlog: ${e.message}`;
  }
}

/**
 * Cards made from `#<id>` (quick capture, or work started in Dispatch) before Slate read the item: their title, type
 * and level from the backlog when the item is there, else read one at a time (up to 5 a refresh).
 */
async function fillAdoTitles() {
  if (s.conn.ado !== true) return;
  const want = store.v.items.filter(needsAdoTitle).slice(0, 5);
  for (const it of want) {
    let w = s.backlog.find(b => b.id === it.ado.id) || null;
    if (!w) { try { w = await ado(ws, 'workitem.get', { id: it.ado.id, ...(s.team.connection ? { connection: s.team.connection } : {}) }); } catch { w = null; } }
    if (!w || !w.title) continue;
    await store.update(it.id, x => {
      const was = x.title === `#${x.ado.id}`;
      if (was) x.title = String(w.title).slice(0, 255);
      x.ado = { ...x.ado, rev: w.rev || x.ado.rev, type: w.type || x.ado.type, url: x.ado.url || w.url || '', area: w.area || x.ado.area, state: w.state || x.ado.state, connection: x.ado.connection || w.connection || '' };
      if (was && w.type) x.level = levelOfType(w.type);
    }).catch(() => {});
  }
}

/**
 * Delegated, own and resolved items whose ADO item is not in the open backlog (which leaves out Resolved and Closed):
 * read each one's state. Resolved: the Resolved column (a delegated one offers Rapport a win about the person, once).
 * Closed, Done or Removed: off the board. The oldest checked go first, up to 15 a read, so a long Resolved column is
 * covered over a few refreshes. Runs only on a complete backlog read.
 */
const stateChecked = new Map(); // item id -> ms of the last read
async function closeFinished() {
  const open = new Set(s.backlog.map(b => b.id));
  const gone = store.v.items.filter(it => it.ado && ['delegated', 'dev', 'resolved'].includes(it.stage) && !open.has(it.ado.id))
    .sort((a, b) => (stateChecked.get(a.id) || 0) - (stateChecked.get(b.id) || 0)).slice(0, 15);
  for (const it of gone) {
    let w = null;
    stateChecked.set(it.id, Date.now());
    try { w = await ado(ws, 'workitem.get', { id: it.ado.id, details: true, ...(it.ado.connection ? { connection: it.ado.connection } : {}) }); } catch { continue; }
    if (!w) continue;
    const resolved = /^resolved$/i.test(w.state || '');
    const closed = /^(closed|done|removed)$/i.test(w.state || '');
    const win = it.stage === 'delegated' && !it.offered.win && (resolved || /^(closed|done)$/i.test(w.state || ''));
    if (win) await store.offer(winOffer(it, it.assignee)).catch(() => {});
    await store.update(it.id, x => {
      x.ado = { ...x.ado, state: w.state || x.ado.state, rev: w.rev || x.ado.rev, url: x.ado.url || w.url || '', area: w.area || x.ado.area, type: x.ado.type || w.type || '' };
      if (closed) setStage(x, 'done');
      else if (resolved && x.stage !== 'resolved') setStage(x, 'resolved');
      if (win) x.offered = { ...x.offered, win: today() };
    }).catch(() => {});
  }
}

/**
 * The pull requests linked to what you build (workitem.prs, read only): once every linked PR has completed, the card
 * moves to Merged. Each item at most every 15 minutes, up to 10 a read.
 */
const prsChecked = new Map(); // item id -> ms of the last check
async function checkPrs({ only = null } = {}) {
  if (s.conn.ado !== true) return;
  const due = (it) => only ? it.id === only : Date.now() - (prsChecked.get(it.id) || 0) > 15 * 60000;
  const list = store.v.items.filter(it => it.stage === 'dev' && it.ado && !it.merged && due(it)).slice(0, 10);
  for (const it of list) {
    prsChecked.set(it.id, Date.now());
    let r = null;
    try { r = await ado(ws, 'workitem.prs', { id: it.ado.id, ...(it.ado.connection ? { connection: it.ado.connection } : {}) }); } catch (e) { if (only) throw e; continue; }
    const prs = { status: r.status, at: new Date().toISOString(), list: (r.prs || []).filter(p => p.status !== 'missing').map(p => ({ id: p.id, status: p.status, title: p.title, repository: p.repository, url: p.url })) };
    const same = JSON.stringify({ ...(it.prs || {}), at: '' }) === JSON.stringify({ ...prs, at: '' });
    if (same && r.status !== 'merged') continue;
    await store.update(it.id, x => { x.prs = prs; if (r.status === 'merged' && !x.merged) { x.merged = today(); x.mergedHow = 'prs'; } }).catch(() => {});
  }
}
const today = () => new Date().toISOString().slice(0, 10);

async function readTandem() {
  if (s.conn.opencode !== true) { s.tstate = null; return; }
  try { s.tstate = await tandem(ws, 'state'); } catch { s.tstate = null; return; }
  await linkFolders();
  await readAllFiles();
  await advance();
}

const live = () => (s.tstate && s.tstate.liveMode && s.tstate.liveMode.live) || { items: {}, sessions: {}, questions: [], permissions: [] };

/** A session's state: {busy, waiting, error} or null when it is unknown or idle with nothing to say. */
function agentOf(sid) {
  if (!sid) return null;
  const L = live();
  const ses = (L.sessions || {})[sid];
  const waiting = (L.questions || []).some(q => q.sessionID === sid) || (L.permissions || []).some(p => p.sessionID === sid);
  if (!ses && !waiting) return null;
  const busy = !!ses && ses.status && ses.status !== 'idle';
  if (!busy && !waiting && !(ses && ses.error)) return null;
  return { busy, waiting, error: ses && ses.error || null };
}

/** What the agents are asking about an item, from any of its sessions, folders or its Tandem run. */
const asksOf = (it) => asksFor(it, live(), runFor(it) || it.run || null);

/** The item's agent state for cards, badges and the panel: its current session, and waiting when anything asks. */
function itemAgent(it) {
  const a = agentOf(it.sessions && it.sessions.current);
  if (!asksOf(it).count) return a;
  return { busy: false, error: null, ...(a || {}), waiting: true };
}

/** Folders the agents created: the session ids Slate started, found in the connector's links. */
async function linkFolders() {
  const L = live();
  const found = [];
  for (const it of store.v.items) {
    for (const k of ['triage', 'shape', 'define', 'handoff']) {
      const sid = it.sessions[k];
      if (!sid || it.work[k]) continue;
      for (const [folder, e] of Object.entries(L.items || {})) {
        if ((e.sessions || []).some(x => x.id === sid)) { found.push([it.id, k, folder]); break; }
      }
    }
  }
  if (found.length) await store.change(list => { for (const [id, k, folder] of found) { const it = list.find(x => x.id === id); if (it) { it.work = { ...(it.work || {}), [k]: folder }; } } }).catch(() => {});
}

const FILES = { triage: ['triage.md', 'answers.md'], refine: ['refine.md'], scope: ['stories.md', 'milestones.md'], handoff: ['handoff.md'] };
async function readAllFiles() {
  const want = new Map();
  for (const it of store.v.items) {
    if (it.work.triage) want.set(it.work.triage, FILES.triage);
    if (it.work.shape) want.set(it.work.shape, SHAPE_FILES);
    if (it.work.define) want.set(it.work.define, it.work.define.startsWith('refine-') ? FILES.refine : FILES.scope);
  }
  await Promise.all([...want].map(async ([folder, names]) => s.files.set(folder, await readFiles(ws, folder, names))));
}
const filesOf = (folder) => (folder && s.files.get(folder)) || {};

/** Stages the files settle: a triage that finished moves its item on, and so does an interview that wrote its brief. */
async function advance() {
  const moves = [];
  for (const it of store.v.items) {
    const t = parseTriage(filesOf(it.work.triage)['triage.md']);
    const working = agentOf(it.sessions.triage);
    if (it.stage === 'new' && it.reopened !== 'new' && t && !(working && (working.busy || working.waiting))) moves.push([it.id, 'triaged', t.route]);
    if (it.stage === 'shaping' && it.reopened !== 'shaping' && shapeState(filesOf(it.work.shape), agentOf(it.sessions.shape)).ready && !agentOf(it.sessions.shape)) moves.push([it.id, 'brief', null]);
  }
  if (moves.length) await store.change(list => { for (const [id, stage, route] of moves) { const it = list.find(x => x.id === id); if (it) { setStage(it, stage); if (route && route !== 'undecided' && !it.route) it.route = route; } } }).catch(() => {});
  // Approve and publish (or build): the draft is approved now, so show the publish confirm. Only while you are here.
  if (document.visibilityState !== 'visible' || dlg.open || ui.busy) return;
  const next = store.v.items.find(it => it.after && it.stage === 'defining' && draftState(it, filesOf(it.work.define)).ready && !(agentOf(it.sessions.define) || {}).busy);
  if (!next) return;
  const then = next.after;
  await store.update(next.id, x => { delete x.after; }).catch(() => {});
  ui.open = next.id; ui.tab = 'board';
  if (then === 'build') ACT['publish-build'](next);
  else ACT.publish(next);
}

/* ---------- what the board shows ---------- */

function personName(id) { return id ? People.label(s.people, id, '') : ''; }

function runFor(it) {
  const items = (s.tstate && s.tstate.items) || [];
  if (it.run && it.run.folder) { const r = items.find(x => x.kind === 'item' && x.folder === it.run.folder); if (r) return r; }
  if (it.ado) return items.find(x => x.kind === 'item' && String(x.id) === String(it.ado.id)) || null;
  return null;
}

function enrich(c) {
  const out = { ...c };
  out.triage = parseTriage(filesOf(c.work && c.work.triage)['triage.md']);
  out.agent = itemAgent(c);
  out.assigneeName = personName(c.assignee);
  out.age = daysInStage(c);
  out.facts = cardFacts(c.adoNow || null, store.v.prefs);
  if (c.stage === 'shaping' && !out.agent) { const sh = shapeState(filesOf(c.work && c.work.shape)); out.shapeAsking = sh.asking; out.shapeRound = sh.round; }
  const last = (c.history || [])[(c.history || []).length - 1];
  out.skipped = !!(last && last.skipped && c.stage === 'decide');
  out.fromDispatch = !!(last && last.from === 'dispatch' && c.stage === 'dev');
  return out;
}

/** Runway's pending ideas not taken or hidden, as cards in New (not stored until you act on one). */
const pendingCards = () => pendingIdeaCards(s.pending, store.v.items, store.v.dismissed, new Date(), store.v.sentIdeas || []);

/** Every card before any filter: stored items, ADO backlog items nobody has acted on, and Runway's pending ideas. */
function allCards() {
  return [...cards(store.v.items, s.backlog), ...pendingCards()];
}

/** The board: each card in its column (BOARD_COLUMNS), with the step on its chip. Closed items are off the board. */
function columns() {
  const cols = {};
  const push = (k, c) => (cols[k] ||= []).push(c);
  const list = filterCards(allCards(), { q: ui.q, level: ui.level, area: ui.area });
  const inflight = [];
  for (const c of list) {
    if (c.stage === 'done') continue;
    const e = enrich(c);
    if (c.stage === 'dev' || c.stage === 'resolved' || c.virtualRun) {
      // What you build yourself (and resolved work, delegated or not), with its Tandem stage. Every run's prompts and
      // code review stay Dispatch's.
      const run = runFor(c);
      const st = devColumn(run, c);
      if (st === 'building') e.step = runStep(run);
      else e.step = STEP_CHIP[st] || '';
      if (['review', 'merged'].includes(st) && !c.ado) e.noAdo = true;
      if (st === 'review' && c.prs && c.prs.list.length) e.step = `${c.prs.list.filter(p => p.status === 'completed').length} of ${c.prs.list.length} PRs merged`;
      if (boardColumn(st) === 'inflight') inflight.push([e, e.step === 'Waiting on you' || (e.agent && e.agent.waiting) ? 0 : 1]);
      else push(boardColumn(st), e);
      continue;
    }
    const st = pmColumn(c, draftState(c, filesOf(c.work.define)), e.agent);
    e.stale = !c.virtual && isStale(c, st);
    e.step = st === 'delegated' ? (e.assigneeName ? `With ${e.assigneeName}` : 'Delegated') : (STEP_CHIP[st] || '');
    if (boardColumn(st) === 'inflight') inflight.push([e, e.agent && e.agent.waiting ? 0 : 2]);
    else push(boardColumn(st), e);
  }
  // In flight: waiting on you first, then your own builds, then delegated work.
  for (const [e] of inflight.sort((a, b) => a[1] - b[1])) push('inflight', e);
  return cols;
}

function findCard(id) {
  if (!id) return null;
  const stored = store.v.items.find(x => x.id === id);
  if (stored) return stored;
  if (id.startsWith('ado_')) { const b = s.backlog.find(x => `ado_${x.id}` === id); return b ? cards([], [b])[0] : null; }
  if (id.startsWith('rw_')) return pendingCards().find(x => x.id === id) || null;
  return null;
}

/** People who own what the item touches (People's `owns`), best match first. */
function ownersOf(c) {
  const list = (s.people.people || []).filter(p => !p.archived && Array.isArray(p.owns) && p.owns.length).map(p => ({ id: p.id, name: p.name, owns: p.owns }));
  return ownersFor(list, aboutText(c, parseTriage(filesOf(c.work && c.work.triage)['triage.md'])));
}

function columnOf(it) {
  if (it.stage === 'done') return 'done';
  if (['dev', 'resolved'].includes(it.stage)) return devColumn(runFor(it), it);
  return pmColumn(it, draftState(it, filesOf(it.work.define)), agentOf(it.sessions.current));
}

let summaryTimer = null;
function publishSummary() {
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    const items = store.v.items.map(it => ({ ...it, draftReady: ['approve', 'approve-stories', 'approve-milestones'].includes(draftState(it, filesOf(it.work.define)).step), shapeAsking: it.stage === 'shaping' && shapeState(filesOf(it.work.shape), itemAgent(it)).asking, adoNow: (s.backlog.find(b => it.ado && b.id === it.ado.id)) || null }));
    store.writeSummary(summaryCards(items, { columnOf, agentOf: itemAgent })).catch(() => {});
  }, 300);
}

const sessionOf = (sid) => { const x = sid && (live().sessions || {})[sid]; return x ? { ...x, id: sid } : null; };

function panelState(c) {
  const files = { ...filesOf(c.work && c.work.triage), ...filesOf(c.work && c.work.shape), ...filesOf(c.work && c.work.define) };
  const draft = draftState(c, filesOf(c.work && c.work.define));
  const dev = c.virtualRun || ['dev', 'resolved', 'done'].includes(c.stage);
  const run = c.virtualRun ? c.run : runFor(c);
  const column = dev ? (c.stage === 'done' ? 'done' : devColumn(run, c)) : pmColumn(c, draft, agentOf(c.sessions && c.sessions.current));
  return {
    item: c, dev, files, draft, editing: ui.editing, shapeEditing: ui.shapeEditing,
    shape: shapeState(filesOf(c.work && c.work.shape), agentOf(c.sessions && c.sessions.current)),
    back: c.virtual || c.virtualRun ? [] : backTargets(c, column),
    forward: c.virtualRun ? [] : forwardTargets(c),
    triage: parseTriage(filesOf(c.work && c.work.triage)['triage.md']),
    agent: itemAgent(c),
    asks: asksOf(c),
    session: sessionOf(c.sessions && c.sessions.current),
    ui: { picks: ui.picks, drafts: ui.drafts, agentOpen: ui.agentOpen, folds: ui.folds },
    wide: ui.wide,
    column,
    run,
    timeline: c.virtual ? [] : timeline(c, { run, assigneeName: personName(c.assignee) }),
    canLocal: s.conn.opencode === true,
    tandemOff: s.conn.opencode !== true && s.conn.opencode !== 'Checking…' ? String(s.conn.opencode || 'Tandem is not ready.') : '',
    suggestScope: suggestsScope(c, parseTriage(filesOf(c.work && c.work.triage)['triage.md'])),
    canAdo: s.conn.ado === true,
    assigneeName: personName(c.assignee),
    owners: ownersOf(c),
    age: daysInStage(c),
    details: c.ado ? s.details.get(String(c.ado.id)) || null : null,
    prefs: store.v.prefs,
    error: ui.error
  };
}

/* ---------- painting ---------- */

function notes() {
  const n = [];
  if (s.conn.ado !== true && s.conn.ado !== 'Checking…') n.push(`Azure DevOps: ${s.conn.ado}`);
  if (s.conn.opencode !== true && s.conn.opencode !== 'Checking…') n.push(`Tandem: ${s.conn.opencode} Without it, the agent steps (triage, define, handoff, build) are off.`);
  if (store.v.error) n.push(store.v.error);
  if (s.backlogNote) n.push(s.backlogNote);
  return n;
}

// Set an element's markup only when it changed. Rebuilding the same markup under the pointer drops and
// re-applies :hover, which flickers (repaints come with every agent event and once a minute).
const drawn = new WeakMap();
function setHtml(el, html) {
  const was = drawn.get(el);
  if (was && was.html === html && was.first === el.firstChild && (el.firstChild || !html)) return;
  el.innerHTML = html;
  drawn.set(el, { html, first: el.firstChild });
}

function paint() {
  const focus = document.activeElement && document.activeElement.id;
  const board = ui.tab === 'board' && store.v.loaded;
  setHtml(topEl, topHtml(ui, ui.tab === 'board' ? notes() : [], board ? areaOptions(allCards(), s.team.areas, ui.area) : []));
  if (ui.tab !== 'health' && reportsHost) { reportsHost.stop(); reportsHost = null; }
  if (ui.tab === 'health') {
    if (!mainEl.querySelector('.health')) mountHealth();
    if ($('sprintsBox')) setHtml($('sprintsBox'), sprintsView());
  } else {
    setHtml(mainEl, store.v.loaded ? boardHtml(columns(), { open: ui.open, backlogNote: s.backlogNote, filtered: !!(ui.area || ui.level || ui.q.trim()) }) : '<p class="loading">Loading…</p>');
  }
  paintPanel();
  const waiting = store.v.items.filter(it => { const a = itemAgent(it); return (a && a.waiting) || (it.stage === 'shaping' && shapeState(filesOf(it.work.shape), a).asking); }).length;
  ws.badge(waiting || null).catch(() => {});
  if (focus && $(focus) && focus !== 'draft' && focus !== 'answers') {
    const el = $(focus);
    el.focus();
    // A typed answer or reply was put back by the repaint: keep the caret at the end of it.
    if (el.dataset.draft && typeof el.setSelectionRange === 'function') { const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* not a text field */ } }
  }
}

function paintPanel() {
  const c = findCard(ui.open);
  if (!c) { panelEl.hidden = true; setHtml(panelEl, ''); delete panelEl.dataset.item; return; }
  // Keep text the person is typing, and the interview's picks and notes for the same item.
  const keep = ['draft', 'answers', 'linkAdo'].map(id => [id, $(id) && $(id).value]);
  const same = panelEl.dataset.item === c.id;
  const shapeKeep = same ? [...panelEl.querySelectorAll('#qnotes, #bnotes, #shapeEdit, .iq .qo')].map(el => [el.id, el.value]) : [];
  const picked = same ? [...panelEl.querySelectorAll('.iq input[type=radio]:checked')].map(el => [el.name, el.value]) : [];
  panelEl.hidden = false;
  panelEl.parentElement.classList.toggle('wide', ui.wide);
  setHtml(panelEl, panelHtml(panelState(c)));
  for (const [id, val] of keep) if (val != null && $(id)) $(id).value = val;
  for (const [id, val] of shapeKeep) if ($(id) && $(id).value !== val) $(id).value = val;
  for (const [name, val] of picked) { const el = panelEl.querySelector(`.iq input[type=radio][name="${CSS.escape(name)}"][value="${CSS.escape(val)}"]`); if (el) el.checked = true; }
  panelEl.dataset.item = c.id;
  panelEl.classList.toggle('busy', ui.busy);
  wantDetails(c);
}

/* ---------- the open item's ADO fields (workitem.get with extras), read when the panel opens ---------- */

const connOf = (c) => (c.ado && c.ado.connection) || s.team.connection || '';
const prefsKey = () => JSON.stringify([customRefs(store.v.prefs), store.v.prefs.pointsFields]);

/** Read the item from ADO unless what is cached is for this rev and these field settings. Repaints when done. */
function wantDetails(c) {
  if (!c || !c.ado || s.conn.ado !== true) return;
  const key = String(c.ado.id);
  const rev = Number((c.adoNow && c.adoNow.rev) || c.ado.rev) || 0;
  const have = s.details.get(key);
  if (have && (have.loading || (have.rev === rev && have.key === prefsKey()))) return;
  const d = { rev, key: prefsKey(), loading: true, data: have ? have.data : null, error: '', comments: null };
  s.details.set(key, d);
  const conn = connOf(c);
  ado(ws, 'workitem.get', { id: c.ado.id, details: true, extras: true, pointsFields: store.v.prefs.pointsFields, fields: customRefs(store.v.prefs), ...(conn ? { connection: conn } : {}) })
    .then(w => { d.data = w; })
    .catch(e => { d.error = `Could not read #${key} from ADO: ${e && e.message ? e.message : 'unknown error'}`; })
    .finally(() => { d.loading = false; const o = findCard(ui.open); if (o && o.ado && String(o.ado.id) === key) paintPanel(); });
}

let reportsHost = null;
const runwayOn = () => s.apps.some(a => a.id === 'runway') || !s.apps.length;
function mountHealth() {
  const items = store.v.items;
  const names = Object.fromEntries((s.people.people || []).map(p => [p.id, p.name]));
  mainEl.innerHTML = healthHtml(health(items, columnOf), { names, reports: runwayOn() });
  const frame = $('reports');
  if (frame) reportsHost = hostFrame(frame, { ws, onOpenSlate: (path) => route(path), getRoute: () => 'reports' });
}

function sprintsView() {
  if (s.conn.ado !== true) return sprintsHtml({ note: typeof s.conn.ado === 'string' ? `Sprints come from Azure DevOps. ${s.conn.ado}` : 'Checking Azure DevOps…' });
  if (!s.sprints) { loadSprints(); return '<p class="loading">Reading sprints…</p>'; }
  const items = store.v.items.filter(it => it.ado && !['done'].includes(it.stage)).map(it => ({ ...it, adoNow: s.backlog.find(b => b.id === it.ado.id) || it.adoNow || null }));
  const people = (s.people.people || []).filter(p => !p.archived && p.adoIdentity);
  return sprintsHtml({ sprints: s.sprints, groups: bySprint(items), people, note: s.sprintNote });
}
async function loadSprints() {
  if (s.loadingSprints) return;
  s.loadingSprints = true;
  try {
    const project = (s.backlog[0] && s.backlog[0].url && decodeURIComponent((/\/([^/]+)\/_workitems\//.exec(s.backlog[0].url) || [])[1] || '')) || undefined;
    const r = await ado(ws, 'iterations.list', { ...(project ? { project } : {}), ...(s.team.connection ? { connection: s.team.connection } : {}) });
    s.sprints = (r.iterations || []).filter(x => x.path);
    s.sprintNote = s.sprints.length ? '' : 'No sprints in this project yet.';
  } catch (e) { s.sprints = []; s.sprintNote = `Could not read sprints: ${e.message}`; }
  s.loadingSprints = false;
  if (ui.tab === 'health') paint();
}

/* ---------- actions ---------- */

const toastErr = (e) => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

/** A card that came from ADO, stored the first time you act on it. Returns the stored item. */
async function ensureStored(c) {
  if (!c.virtual && !c.virtualRun) return store.v.items.find(x => x.id === c.id) || c;
  if (c.fromRunway) {
    const r = s.pending.find(x => x.id === c.fromRunway);
    const it = newItem({ title: r ? r.title : c.title, description: r ? r.note || '' : c.description, kind: 'idea', runwayPending: c.fromRunway });
    await store.change(list => list.push(it));
    ui.open = it.id;
    return store.v.items.find(x => x.id === it.id);
  }
  const b = c.virtual ? s.backlog.find(x => `ado_${x.id}` === c.id) : null;
  const it = b ? newItem({ title: b.title, ado: { ...b, connection: s.team.connection || '' } }) : newItem({ title: c.title, ado: c.ado && c.ado.id ? { id: c.ado.id, type: 'User Story' } : null });
  if (c.virtualRun) setStage(it, 'dev');
  await store.change(list => list.push(it));
  ui.open = it.id;
  return store.v.items.find(x => x.id === it.id);
}

async function startSession(it, kind, action, args) {
  const r = await tandem(ws, action, args, { confirm: true });
  await store.update(it.id, x => {
    x.sessions = { ...x.sessions, [kind]: r.session, current: r.session };
    delete x.reopened;
    if (r.folder) x.work = { ...x.work, [kind]: r.folder };
  });
  return r;
}

const ACT = {
  tab: (id) => { if (TABS.includes(id)) { ui.tab = id; paint(); } },
  'open-item': (c) => { if (c) { ui.open = c.id; ui.tab = 'board'; paint(); } },
  refresh: () => { s.details.clear(); return refresh().then(() => ws.toast('Up to date.', { kind: 'success' })); },
  fields: () => {
    showDialog(fieldsDialogHtml(store.v.prefs), async (form) => {
      const before = JSON.stringify(store.v.prefs.pointsFields);
      await store.savePrefs(readFieldsForm(form));
      s.details.clear();
      if (JSON.stringify(store.v.prefs.pointsFields) !== before) await refresh();
      else paint();
      ws.toast('Fields saved.', { kind: 'success' });
    });
    const reset = dlg.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', () => { const f = dlg.querySelector('form'); const fresh = fieldsDialogHtml(cleanPrefs({})); const tmp = document.createElement('div'); tmp.innerHTML = fresh; for (const el of f.querySelectorAll('input')) { const twin = tmp.querySelector(`input[name="${el.name}"]${el.type === 'checkbox' ? `[value="${el.value}"]` : ''}`); if (!twin) continue; if (el.type === 'checkbox') el.checked = twin.checked; else el.value = twin.value; } });
  },
  async comments(c) {
    if (!c || !c.ado) return;
    const d = s.details.get(String(c.ado.id));
    if (!d) return;
    d.commentsLoading = true; d.commentsError = ''; paintPanel();
    const conn = connOf(c);
    try { d.comments = (await ado(ws, 'workitem.get', { id: c.ado.id, comments: true, ...(conn ? { connection: conn } : {}) })).comments || []; }
    catch (e) { d.commentsError = `Could not read the comments: ${e && e.message ? e.message : 'unknown error'}`; }
    finally { d.commentsLoading = false; }
  },
  new: () => showDialog(newDialogHtml((s.people.people || []).filter(p => !p.archived).map(p => p.name)), async (form) => {
    const asked = form.requester.value.trim();
    const match = (s.people.people || []).find(p => !p.archived && p.name.toLowerCase() === asked.toLowerCase());
    const it = newItem({ title: form.title.value, description: form.description.value, level: form.level.value, requester: asked, requesterId: match ? match.id : null });
    await store.change(list => list.push(it));
    ui.open = it.id; paint();
  }),
  'new-idea': () => showDialog(newIdeaDialogHtml(), async (form) => {
    const it = newItem({ title: form.title.value, description: form.description.value, kind: 'idea' });
    await store.change(list => list.push(it));
    ui.open = it.id; paint();
  }),
  open: (id) => { ui.open = ui.open === id ? null : id; ui.editing = false; ui.shapeEditing = null; ui.error = ''; paint(); },
  close: () => { ui.open = null; ui.editing = false; ui.shapeEditing = null; paint(); },
  /* ---------- the Shape interview (/shape) ---------- */
  async shape(c) {
    const it = await ensureStored(c);
    if (it.work.shape) {
      await startSession(it, 'shape', 'shape.start', { folder: it.work.shape });
    } else if (it.work.triage) {
      await startSession(it, 'shape', 'shape.start', { from: it.work.triage });
    } else {
      const idea = [it.title, it.ado ? `(ADO #${it.ado.id}, an existing ${it.ado.type || 'item'})` : '', it.requester ? `Asked by ${it.requester}.` : '', it.description].filter(Boolean).join('. ');
      await startSession(it, 'shape', 'shape.start', { idea: idea.slice(0, 4000) });
    }
    await store.update(it.id, x => setStage(x, 'shaping'));
   
    ws.toast('The interview started. Its first questions show here when the agent is done.', { kind: 'success' });
  },
  'use-recommended': () => {
    for (const fs of panelEl.querySelectorAll('fieldset.iq')) {
      if (fs.querySelector('input[type=radio]:checked')) continue;
      const rec = fs.querySelector('input[type=radio][data-rec]');
      if (rec) rec.checked = true;
    }
  },
  async 'send-answers'(c) {
    const sh = shapeState(filesOf(c.work.shape));
    if (!sh.asking) return ws.toast('There are no questions to answer right now.', { kind: 'warn' });
    const answers = {};
    for (const q of sh.q.questions) {
      const r = panelEl.querySelector(`input[type=radio][name="qa-${q.n}"]:checked`);
      const other = ($(`qo-${q.n}`) && $(`qo-${q.n}`).value || '').trim();
      answers[q.n] = { pick: r ? r.value : other ? 'other' : 'skip', other };
    }
    const notes = $('qnotes') ? $('qnotes').value : '';
    const before = filesOf(c.work.shape)['answers.md'];
    const text = appendAnswers(before, answersBlock(sh.round, sh.q.questions, answers, notes));
    await writeShapeFile(c, 'answers.md', text, before);
    await startSession(c, 'shape', 'shape.start', { folder: c.work.shape });
    ws.toast('Answers sent. The next round shows here when the agent is done.', { kind: 'success' });
  },
  async 'write-brief'(c) {
    if (!c.work.shape) return;
    await startSession(c, 'shape', 'shape.start', { folder: c.work.shape, mode: 'brief' });
    ws.toast('Writing the brief.', { kind: 'success' });
  },
  async 'to-brief'(c) { await store.update(c.id, x => setStage(x, 'brief')); },
  async 'keep-going'(c) {
    if (!c.work.shape) return;
    const notes = $('bnotes') ? $('bnotes').value : '';
    const sh = shapeState(filesOf(c.work.shape));
    const block = notesBlock(sh.round, notes);
    if (block) { const before = filesOf(c.work.shape)['answers.md']; await writeShapeFile(c, 'answers.md', appendAnswers(before, block), before); }
    await startSession(c, 'shape', 'shape.start', { folder: c.work.shape, mode: 'more' });
    await store.update(c.id, x => setStage(x, 'shaping'));
    ws.toast('Another round is coming.', { kind: 'success' });
  },
  async 'send-define'(c) {
    const b = parseBrief(filesOf(c.work.shape)['brief.md']);
    if (!b) return ws.toast('There is no brief yet.', { kind: 'warn' });
    const one = b.level === 'story' || b.level === 'bug';
    await startSession(c, 'define', one ? 'refine.start' : 'scope.start', { from: c.work.shape });
    await store.update(c.id, x => { if (b.level && !x.ado) x.level = b.level; setStage(x, 'defining'); });
   
    ws.toast(`Sent to Define: ${one ? 'refining one story' : 'scoping'} from the brief.`, { kind: 'success' });
  },
  async dismiss(c) {
    if (!c || !c.fromRunway) return;
    await store.dismiss(c.fromRunway);
    ui.open = null;
    ws.toast('Hidden from Slate. It stays in Runway.', { kind: 'success' });
  },
  'edit-understanding': () => { ui.shapeEditing = 'understanding.md'; paint(); },
  'edit-brief': () => { ui.shapeEditing = 'brief.md'; paint(); },
  async 'save-shape-file'(c) {
    const file = ui.shapeEditing;
    if (!file || !c.work.shape) return;
    const before = filesOf(c.work.shape)[file];
    await writeShapeFile(c, file, $('shapeEdit').value, before);
    ui.shapeEditing = null; paint();
  },
  async triage(c) {
    const it = await ensureStored(c);
    // With an ADO item, your notes (the note typed with #1234 in quick capture, say) go along too: /triage keeps them.
    await startSession(it, 'triage', 'triage.start', it.ado ? { id: String(it.ado.id), ...(it.description ? { text: it.description.slice(0, 1000) } : {}) } : { text: [it.title, it.description].filter(Boolean).join('. ').slice(0, 2000) });
    ws.toast('Triage started. It shows here when the agent is done.', { kind: 'success' });
  },
  async ask(c) {
    const t = parseTriage(filesOf(c.work.triage)['triage.md']);
    const text = questionsText(c, t);
    try { await navigator.clipboard.writeText(text); ws.toast('Questions copied. Send them, then paste the answers here.', { kind: 'success' }); }
    catch { ws.toast('Could not copy. Select the questions in the panel instead.', { kind: 'warn' }); }
    await store.update(c.id, x => setStage(x, 'waiting'));
  },
  /** Post the triage questions on the ADO item as a comment (one confirm that shows them), then wait for replies. */
  async 'post-questions'(c) {
    if (!c.ado) return;
    const t = parseTriage(filesOf(c.work.triage)['triage.md']);
    const text = questionsText(c, t);
    showDialog(confirmHtml(`Post the questions on #${c.ado.id}?`, `Adds this comment to its Discussion in Azure DevOps, where whoever asked can answer:\n\n${text}`, 'Post them'), async () => {
      const conn = c.ado.connection ? { connection: c.ado.connection } : s.team.connection ? { connection: s.team.connection } : {};
      const w = await ado(ws, 'workitem.get', { id: c.ado.id, ...conn });
      const out = await ado(ws, 'workitem.update', { id: c.ado.id, rev: w.rev, changes: { comment: text }, ...conn }, { confirm: true });
      await store.update(c.id, x => { x.ado = { ...x.ado, rev: out.rev || x.ado.rev }; x.asked = { id: c.ado.id, at: new Date().toISOString() }; setStage(x, 'waiting'); });
      ws.toast(`Posted on #${c.ado.id}. Read replies brings their answers in.`, { kind: 'success' });
    });
  },
  /** Comments on the ADO item since the questions were posted, into the answers box (nothing is saved yet). */
  async 'read-replies'(c) {
    if (!c.ado) return;
    const w = await ado(ws, 'workitem.get', { id: c.ado.id, comments: true, ...(c.ado.connection ? { connection: c.ado.connection } : s.team.connection ? { connection: s.team.connection } : {}) });
    const text = repliesSince(w.comments || [], c.asked && c.asked.at);
    if (!text) return ws.toast(`No replies on #${c.ado.id} since the questions went up.`, { kind: 'info' });
    const box = $('answers');
    if (box) box.value = box.value.trim() ? `${box.value.trim()}\n\n${text}` : text;
    ws.toast('Replies added below. Check them, then save.', { kind: 'success' });
  },
  async answers(c) {
    const text = ($('answers') && $('answers').value || '').trim();
    if (!text) return ws.toast('Paste the answers first.', { kind: 'warn' });
    const before = filesOf(c.work.triage)['answers.md'];
    await tandem(ws, 'file.write', { folder: c.work.triage, file: 'answers.md', text, ...(before !== undefined ? { expected: before } : {}) }, { confirm: true });
    await startSession(c, 'triage', 'triage.start', { folder: c.work.triage });
    await store.update(c.id, x => setStage(x, 'new'));
    ws.toast('Answers saved. Triage is running again.', { kind: 'success' });
  },
  async define(c) {
    const it = await ensureStored(c);
    const t = parseTriage(filesOf(it.work.triage)['triage.md']);
    return suggestsScope(it, t) ? ACT.scope(it) : ACT.refine(it);
  },
  async refine(c) {
    const it = await ensureStored(c);
    const t = parseTriage(filesOf(it.work.triage)['triage.md']);
    const parent = it.adoNow && it.adoNow.parentId;
    const description = [it.ado ? `Work item #${it.ado.id}.` : '', it.description, t && t.summary].filter(Boolean).join(' ');
    await startSession(it, 'define', 'refine.start', { title: it.title, ...(description ? { description: description.slice(0, 4000) } : {}), ...(parent ? { parent: String(parent) } : {}) });
    await store.update(it.id, x => setStage(x, 'defining'));
  },
  async scope(c) {
    const it = await ensureStored(c);
    const t = parseTriage(filesOf(it.work.triage)['triage.md']);
    const idea = [it.title, it.ado ? `(ADO #${it.ado.id}, an existing ${it.ado.type || 'item'}: use it as the epic if it is one)` : '', it.description, t && t.summary].filter(Boolean).join('. ');
    await startSession(it, 'define', 'scope.start', { idea: idea.slice(0, 4000) });
    await store.update(it.id, x => setStage(x, 'defining'));
  },
  /** Approve, then publish (or publish and build it myself) as soon as the draft is approved: one click and the publish confirm. */
  async 'approve-publish'(c) { await store.update(c.id, x => { x.after = 'publish'; }); return ACT.approve(store.v.items.find(x => x.id === c.id) || c); },
  async 'approve-build'(c) { await store.update(c.id, x => { x.after = 'build'; }); return ACT.approve(store.v.items.find(x => x.id === c.id) || c); },
  async approve(c) {
    const d = draftState(c, filesOf(c.work.define));
    await startSession(c, 'define', 'approve', { folder: c.work.define, ...(d.step === 'approve-stories' ? { what: 'stories' } : d.step === 'approve-milestones' ? { what: 'milestones' } : {}) });
    ws.toast('Approving. If there are open questions, the agent asks first.', { kind: 'success' });
  },
  async revise(c) {
    await startSession(c, 'define', c.work.define.startsWith('refine-') ? 'refine.start' : 'scope.start', { folder: c.work.define });
  },
  async slice(c) { await startSession(c, 'define', 'slice.start', { folder: c.work.define }); },
  'edit-draft': () => { ui.editing = true; paint(); },
  'cancel-edit': () => { ui.editing = false; ui.shapeEditing = null; paint(); },
  async 'save-draft'(c) {
    const d = draftState(c, filesOf(c.work.define));
    const before = filesOf(c.work.define)[d.file];
    const text = $('draft').value;
    try { await tandem(ws, 'file.write', { folder: c.work.define, file: d.file, text, expected: before }, { confirm: true }); }
    catch (e) { if (e.code === 'conflict') { await readTandem(); throw new Error('The agent changed the file since you opened it. Your edit is still in the box: copy it, then try again.'); } throw e; }
    s.files.set(c.work.define, { ...filesOf(c.work.define), [d.file]: text });
    ui.editing = false; paint();
  },
  async publish(c) {
    const files = filesOf(c.work.define);
    // A new request goes to the area you are looking at, else your team's first area path.
    const area = (ui.area && ui.area !== NO_AREA ? ui.area : '') || s.team.areas[0] || '';
    const plan = publishPlan(c, files, { area });
    if (!plan.length) return ws.toast('Nothing to publish yet.', { kind: 'warn' });
    showDialog(publishDialogHtml(plan, { area }), () => runPublish(c, plan));
  },
  /** Publish, then build it myself: one confirm that lists both. */
  async 'publish-build'(c) {
    const area = (ui.area && ui.area !== NO_AREA ? ui.area : '') || s.team.areas[0] || '';
    const plan = publishPlan(c, filesOf(c.work.define), { area });
    if (!plan.length) return ws.toast('Nothing to publish yet.', { kind: 'warn' });
    showDialog(publishDialogHtml(plan, { area, build: true }), () => runPublish(c, plan, { then: 'build' }));
  },
  async delegate(c) {
    const owners = ownersOf(c);
    const base = People.team(s.people).concat(People.withRelation(s.people, 'peer')).filter(p => p.relation !== 'self');
    const ppl = [...owners.map(o => base.find(p => p.id === o.id) || (s.people.people || []).find(p => p.id === o.id)).filter(Boolean), ...base.filter(p => !owners.some(o => o.id === p.id))];
    const label = (p) => { const o = owners.find(x => x.id === p.id); return o ? `${p.name} (owns ${o.hits.join(', ')})` : p.name; };
    showDialog(delegateDialogHtml(ppl.map(p => ({ id: p.id, name: label(p) })), { canBrief: s.conn.opencode === true && !!c.ado, canAssign: s.conn.ado === true && !!c.ado, pick: owners[0] && owners[0].id }), async (form) => {
      const person = ppl.find(p => p.id === form.person.value);
      if (!person) throw new Error('Pick someone to delegate to.');
      if (form.brief.checked && c.ado) await startSession(c, 'handoff', 'handoff.start', { id: String(c.ado.id), assignee: person.name });
      if (form.assign.checked && c.ado) {
        if (!person.adoIdentity) ws.toast(`${person.name} has no ADO identity in People, so ADO was not changed.`, { kind: 'warn' });
        else {
          const out = await ado(ws, 'workitem.update', { id: c.ado.id, rev: (c.adoNow || c.ado).rev, changes: { assignedTo: person.adoIdentity }, ...(c.ado.connection ? { connection: c.ado.connection } : {}) }, { confirm: true });
          await store.update(c.id, x => { x.ado = { ...x.ado, rev: out.rev }; });
        }
      }
      if (form.task.checked) await store.offer(waitingTask(c, person.id));
      await store.update(c.id, x => { x.assignee = person.id; x.route = 'delegate'; setStage(x, 'delegated'); });
      await logDecision(c, `Delegated to ${person.name}`);
      ws.toast(`Delegated to ${person.name}.`, { kind: 'success' });
    });
  },
  /**
   * Build it myself: from Who builds it?, or skipping ahead from New, Brief or Define. In ADO already: starts Tandem on
   * it. An approved draft not in ADO yet: publish first (one confirm), then start. Otherwise: local work, no ADO.
   */
  async myself(c) {
    const it = await ensureStored(c);
    if (!it.ado && draftState(it, filesOf(it.work.define)).ready) return ACT['publish-build'](it);
    if (!it.ado) return ACT['build-local'](it);
    await buildMyself(it);
  },
  /** Take it back from a teammate: In flight as your own build, without starting Tandem (Start is in the panel). */
  async 'take-back'(c) {
    await store.update(c.id, x => { x.route = 'myself'; x.assignee = null; setStage(x, 'dev'); });
    await logDecision(c, 'Took it back to build myself');
   
  },
  /** Build it myself, skip ADO: local work in Tandem (start.local) from the brief, triage or request. Link an ADO item later. */
  async 'build-local'(c) {
    const it = await ensureStored(c);
    if (s.conn.opencode !== true) return ws.toast('Turn on the opencode connector to start local work.', { kind: 'warn' });
    const brief = parseBrief(filesOf(it.work.shape)['brief.md']);
    const t = parseTriage(filesOf(it.work.triage)['triage.md']);
    const text = [it.description, t && t.summary, filesOf(it.work.shape)['brief.md'] ? `Brief: .work/${it.work.shape}/brief.md` : '', it.work.define ? `Defined in .work/${it.work.define}` : ''].filter(Boolean).join('\n\n');
    const lane = it.level === 'bug' || (brief && brief.level === 'bug') ? 'bug' : 'feature';
    const r = await tandem(ws, 'start.local', { title: it.title.slice(0, 200), lane, ...(text ? { description: text.slice(0, 20000) } : {}) }, { confirm: true });
    await store.update(it.id, x => { x.route = 'myself'; x.assignee = null; if (r && r.folder) x.run = { folder: r.folder, id: String(r.id || '') }; setStage(x, 'dev'); });
    await logDecision(it, 'Building it myself (local work, no ADO item yet)');
   
    ws.toast(`Started ${r && r.id ? r.id : 'it'} as local work. Link an ADO item when you have one.`, { kind: 'success' });
  },
  async start(c) {
    const it = await ensureStored(c);
    if (!it.ado) return ACT['build-local'](it);
    await tandem(ws, 'start', { id: String(it.ado.id), lane: it.level === 'bug' ? 'bug' : 'feature' }, { confirm: true });
    ws.toast('Started in Tandem. Follow it here or in Dispatch.', { kind: 'success' });
  },
  /** Link an ADO item to a card that has none: look it up, show title, type and project, then save. */
  async 'link-ado'(c) {
    const raw = String(($('linkAdo') && $('linkAdo').value) || '').trim().replace(/^#/, '');
    if (!/^\d{1,10}$/.test(raw)) return ws.toast('Type the work item number, like 12345.', { kind: 'warn' });
    if (s.conn.ado !== true) return ws.toast('Turn on the Azure DevOps connector to link an item.', { kind: 'warn' });
    const conn = s.team.connection ? { connection: s.team.connection } : {};
    const w = await ado(ws, 'workitem.get', { id: Number(raw), details: true, ...conn });
    const other = store.v.items.find(x => x.id !== c.id && x.ado && x.ado.id === w.id);
    if (other) return ws.toast(`#${w.id} is already on the card "${other.title}".`, { kind: 'warn' });
    showDialog(linkAdoDialogHtml(w), async () => {
      await store.update(c.id, x => { x.ado = { id: w.id, rev: 0, type: w.type || '', url: w.url || '', connection: w.connection || '', area: w.area || '', state: w.state || '' }; });
      prsChecked.delete(c.id);
      ws.toast(`Linked #${w.id}.`, { kind: 'success' });
      refresh().catch(() => {});
    });
  },
  async 'check-prs'(c) {
    await checkPrs({ only: c.id });
    const it = store.v.items.find(x => x.id === c.id);
    ws.toast(it && it.merged ? 'Everything is merged.' : it && it.prs ? `Pull requests: ${it.prs.status === 'none' ? 'none linked yet' : it.prs.status}.` : 'Checked.', { kind: 'success' });
  },
  async 'mark-merged'(c) { await store.update(c.id, x => { x.merged = today(); x.mergedHow = 'manual'; }); },
  async unmerge(c) { await store.update(c.id, x => { delete x.merged; delete x.mergedHow; }); prsChecked.delete(c.id); },
  /** Mark resolved: the ADO item's state to Resolved (merged to main, waiting for a release), after a confirm. */
  'mark-resolved': (c) => {
    if (!c.ado) return ws.toast('Link an ADO item first.', { kind: 'warn' });
    showDialog(confirmHtml(`Resolve #${c.ado.id} in Azure DevOps?`, `Sets its state to Resolved: merged to main and waiting for a release. The card moves to Resolved under ${areaOf(c) || 'No area path'}.`, 'Resolve it'), async () => {
      const out = await setAdoState(c, 'Resolved');
      await store.update(c.id, x => { x.ado = { ...x.ado, rev: out.rev, state: 'Resolved' }; setStage(x, 'resolved'); });
      ws.toast(`#${c.ado.id} is resolved.`, { kind: 'success' });
    });
  },
  /** Close one resolved item as released (panel). */
  'close-one': (c) => closeAsReleased([c], `#${c.ado ? c.ado.id : ''} ${c.title}`),
  /** Close as released: every ADO item in a Resolved group, one confirm. */
  'close-group': (c, b) => { const g = groupOf(b && b.dataset.area); if (g) closeAsReleased(g.items, g.label); },
  /** Copy release notes for a Resolved group as Markdown (titles, ADO links, and each item's release notes field). */
  async 'copy-notes'(c, b) {
    const g = groupOf(b && b.dataset.area);
    if (!g) return;
    const ref = store.v.prefs.releaseNotesField;
    const notes = {};
    if (ref && s.conn.ado === true) {
      for (const it of g.items.filter(x => x.ado).slice(0, 50)) {
        try { const w = await ado(ws, 'workitem.get', { id: it.ado.id, extras: true, fields: [ref], ...(it.ado.connection ? { connection: it.ado.connection } : {}) }); notes[it.id] = (w.custom || {})[ref] || ''; } catch { /* the title still goes in */ }
      }
    }
    const md = releaseNotesMd(g, notes);
    try { await navigator.clipboard.writeText(md); ws.toast(`Release notes for ${g.label} copied.`, { kind: 'success' }); }
    catch { ws.toast('Could not copy to the clipboard.', { kind: 'warn' }); }
  },
  async 'run-next'(c) {
    const run = runFor(c);
    if (!run || !run.next || !run.next.command) return;
    await tandem(ws, 'run', { folder: run.folder, command: run.next.command }, { confirm: true });
  },
  wide: () => { ui.wide = !ui.wide; remember('wide', ui.wide ? '1' : '0'); },
  async perm(c, b) {
    await tandem(ws, 'answer', { kind: 'permission', id: b.dataset.perm, reply: b.dataset.answer }, { confirm: true });
    await refresh({ backlog: false });
  },
  async qsend(c, b) {
    const id = b.dataset.q;
    const q = (live().questions || []).find(x => x.id === id);
    if (!q) { await refresh({ backlog: false }); return ws.toast('That question was already answered or dismissed.', { kind: 'warn' }); }
    const typed = Object.fromEntries((q.questions || []).map((_, i) => [i, ui.drafts[`q:${id}:${i}`] || '']));
    const answers = questionAnswers(q, ui.picks[id] || {}, typed);
    if (!answers) return ws.toast('Pick or type an answer for each question.', { kind: 'warn' });
    await tandem(ws, 'answer', { kind: 'question', id, answers }, { confirm: true });
    forgetQuestion(id);
    await refresh({ backlog: false });
  },
  async qreject(c, b) {
    await tandem(ws, 'answer', { kind: 'question', id: b.dataset.q, reject: true }, { confirm: true });
    forgetQuestion(b.dataset.q);
    await refresh({ backlog: false });
  },
  async reply(c, b) {
    const sid = b.dataset.sid;
    const text = (ui.drafts[`r:${sid}`] || '').trim();
    if (!text) return ws.toast('Type a reply first.', { kind: 'warn' });
    await tandem(ws, 'reply', { session: sid, text }, { confirm: true });
    delete ui.drafts[`r:${sid}`];
    ws.toast('Sent to the agent.', { kind: 'success' });
    await refresh({ backlog: false });
  },
  dispatch: (c) => { const run = c && (runFor(c) || c.run); return ws.open({ app: 'agents', path: run ? String(run.id || run.folder || '') : '' }); },
  ado: (c) => { if (c.ado && c.ado.url) window.open(c.ado.url, '_blank', 'noopener'); },
  async 'roadmap-add'(c) {
    const it = await ensureStored(c);
    await store.offer(roadmapIdea(it));
    ws.toast('Sent to Runway. Assign it to a roadmap from its Pending list.', { kind: 'success' });
  },
  async done(c) { await store.update(c.id, x => setStage(x, 'done')); ws.toast('Marked closed. It is off the board; Move back brings it back.', { kind: 'success' }); },
  back(c) {
    const to = $('backTo') && $('backTo').value;
    if (!c || !to) return;
    const a = agentOf(c.sessions && c.sessions.current);
    if (a && a.busy) return ws.toast('An agent is running on it. Move it when the run stops.', { kind: 'warn' });
    if (forwardTargets(c).includes(to)) {
      const skip = to === 'decide'
        ? 'Slate skips the steps before it, so nothing is triaged, drafted or published from here. Use this when the stories already exist in ADO.'
        : 'Slate skips the steps before it. Start the draft from the panel when you are ready.';
      const waiting = a && a.waiting ? ' The agent waiting on you is left as it is: answer or stop it in Dispatch.' : '';
      return showDialog(confirmHtml(`Skip ahead to ${STAGE_TITLE[to] || to}?`, `${skip}${waiting} Nothing changes in ADO.`, 'Skip ahead'), async () => {
        const it = await ensureStored(c);
        await store.update(it.id, x => (to === 'decide' ? skipToDecide(x) : setStage(x, to)));
        ui.open = it.id; ui.editing = false; ui.shapeEditing = null;
        paint();
        { const t = String(STAGE_TITLE[to] || to); ws.toast(`Moved to ${t}${/[.?!]$/.test(t) ? '' : '.'}`, { kind: 'success' }); }
      });
    }
    const notes = [];
    if (c.stage === 'delegated') notes.push('It stays assigned in ADO, and any Docket task stays: change those yourself if needed.');
    if (c.stage === 'dev' || (c.stage === 'done' && c.route === 'myself')) notes.push('Its Tandem run is not changed: pause or stop it in Dispatch.');
    if (['ready', 'decide', 'delegated', 'dev', 'done'].includes(c.stage) && c.published && Object.keys(c.published).length && ['new', 'triaged', 'waiting', 'defining'].includes(to)) notes.push('What it published stays in ADO; publishing again updates or skips those items.');
    showDialog(confirmHtml(`Move back to ${STAGE_TITLE[to] || to}?`, ['Slate moves the card back and keeps its drafts, triage and history.', ...notes].join(' '), 'Move back'), async () => {
      await store.update(c.id, x => moveBack(x, to));
      ui.editing = false; ui.shapeEditing = null;
      paint();
      ws.toast(`Moved back to ${STAGE_TITLE[to] || to}.`, { kind: 'success' });
    });
  },
  async keep(c) { await store.update(c.id, x => { delete x.reopened; }); },
  remove: (c) => showDialog(confirmHtml('Remove from Slate?', 'Slate forgets this item. Nothing changes in ADO or in .work.', 'Remove'), async () => {
    await store.change(list => { const i = list.findIndex(x => x.id === c.id); if (i >= 0) list.splice(i, 1); });
    ui.open = null; paint();
  })
};

/** Build it myself, for an item in ADO: the decision, In flight, and Tandem started on it (the click is the approval). */
async function buildMyself(it) {
  await store.update(it.id, x => { x.route = 'myself'; x.assignee = null; delete x.after; setStage(x, 'dev'); });
  await logDecision(it, 'Building it myself');
 
  if (s.conn.opencode !== true || runFor(it)) { paint(); return; }
  try {
    await tandem(ws, 'start', { id: String(it.ado.id), lane: it.level === 'bug' ? 'bug' : 'feature' }, { confirm: true });
    ws.toast(`Building #${it.ado.id}: Tandem started on it.`, { kind: 'success' });
  } catch (e) { ws.toast(`In flight, but Tandem did not start: ${e.message}. Use Start in the panel.`, { kind: 'warn' }); }
}

/** The Resolved group for an area key (lower case area path, or '' for none). */
function groupOf(key) {
  const k = String(key || '');
  return releaseGroups(filterCards(store.v.items, { q: ui.q, level: ui.level, area: ui.area })).find(g => g.area.toLowerCase() === k) || null;
}

/** Change an ADO item's state, with the rev read just before (someone may have changed it since the board loaded). */
async function setAdoState(it, state) {
  const conn = it.ado.connection ? { connection: it.ado.connection } : {};
  let rev = it.ado.rev;
  try { const w = await ado(ws, 'workitem.get', { id: it.ado.id, extras: true, ...conn }); rev = w.rev || rev; } catch { /* try with what we have */ }
  if (!rev) { const w = await ado(ws, 'workitem.get', { id: it.ado.id, ...conn }); rev = w.rev; }
  return ado(ws, 'workitem.update', { id: it.ado.id, rev, changes: { state }, ...conn }, { confirm: true });
}

/** Close resolved items in ADO, one at a time, after one confirm. A failure stops there and says what closed. */
function closeAsReleased(list, label) {
  const items = list.filter(it => it.ado);
  if (!items.length) return ws.toast('Nothing here is linked to ADO.', { kind: 'warn' });
  showDialog(closeGroupDialogHtml(items, label), async () => {
    const closed = [];
    for (const it of items) {
      try {
        const out = await setAdoState(it, 'Closed');
        await store.update(it.id, x => { x.ado = { ...x.ado, rev: out.rev, state: 'Closed' }; setStage(x, 'done'); });
        closed.push(it.ado.id);
      } catch (e) {
        throw new Error(`Closed ${closed.length ? closed.map(n => `#${n}`).join(', ') : 'nothing'}. #${it.ado.id} failed: ${e.message}`);
      }
    }
    ws.toast(`Closed ${closed.length} item${closed.length === 1 ? '' : 's'} as released.`, { kind: 'success' });
  });
}

function forgetQuestion(id) {
  delete ui.picks[id];
  for (const k of Object.keys(ui.drafts)) if (k.startsWith(`q:${id}:`)) delete ui.drafts[k];
}

/** Write one file in the item's shape folder; a conflict (the agent wrote it since) keeps the text and says so. */
async function writeShapeFile(c, file, text, before) {
  try { await tandem(ws, 'file.write', { folder: c.work.shape, file, text, ...(before !== undefined ? { expected: before } : {}) }, { confirm: true }); }
  catch (e) { if (e.code === 'conflict') { await readTandem(); throw new Error('The agent changed the file since you opened it. Your text is still in the box: copy it, then try again.'); } throw e; }
  s.files.set(c.work.shape, { ...filesOf(c.work.shape), [file]: text });
}

/** The decision log: one note in Notes for each decision (Notes' inbox), never posted anywhere. */
async function logDecision(it, decision) {
  try { await store.offer(decisionNote(it, decision)); } catch { /* the board still has it */ }
}

async function runPublish(c, plan, { then = null } = {}) {
  const ids = { ...(c.published || {}) };
  const conn = c.ado && c.ado.connection ? { connection: c.ado.connection } : s.team.connection ? { connection: s.team.connection } : {};
  let first = null;
  let linkTo = null;
  for (const p of plan) {
    if (p.op === 'skip') { ids[p.ref] = p.id; continue; }
    if (p.op === 'link') { linkTo = p; continue; } // after everything is made, below
    if (p.op === 'update') {
      const out = await ado(ws, 'workitem.update', { id: p.id, rev: (c.adoNow || c.ado).rev, changes: p.fields, ...conn }, { confirm: true });
      await store.update(c.id, x => { x.ado = { ...x.ado, rev: out.rev }; });
      continue;
    }
    const parent = p.parentId || (p.parentRef ? ids[p.parentRef] : null);
    const out = await ado(ws, 'workitem.create', { type: p.type, title: p.title, ...(parent ? { parent } : {}), fields: p.fields, ...conn }, { confirm: true });
    ids[p.ref] = out.id;
    first = first || out;
    // Saved after each one, so a run that stops part way resumes without making the same item twice.
    await store.update(c.id, x => { x.published = { ...x.published, [p.ref]: out.id }; if (!x.ado && (p.ref === 'item' || p.ref === 'epic')) x.ado = { id: out.id, rev: out.rev, type: out.type, url: out.url, connection: out.connection, area: out.area, state: out.state }; });
  }
  // The card's own item (an Issue, say) gets a Related link to the top item made and a comment saying so; the card
  // then follows the top item, keeping the first one as its source.
  if (linkTo && ids[linkTo.to]) {
    const topId = ids[linkTo.to];
    const top = await ado(ws, 'workitem.get', { id: topId, ...conn });
    const w = await ado(ws, 'workitem.get', { id: linkTo.id, ...conn });
    try { await ado(ws, 'workitem.update', { id: linkTo.id, rev: w.rev, changes: { comment: sourceComment({ id: topId, type: top.type || linkTo.toType, title: top.title || linkTo.toTitle }), related: [topId] }, ...conn }, { confirm: true }); }
    catch (e) { if (!/already linked/i.test(e.message || '')) throw e; }
    await store.update(c.id, x => {
      x.published = { ...x.published, source: linkTo.id };
      x.source = { id: x.ado.id, url: x.ado.url || '', type: x.ado.type || '' };
      x.ado = { id: top.id || topId, rev: top.rev || 0, type: top.type || linkTo.toType, url: top.url || '', connection: top.connection || x.ado.connection, area: top.area || x.ado.area, state: top.state || '' };
      x.title = top.title || x.title;
      x.level = levelOfType(top.type || linkTo.toType);
    });
  }
  await store.update(c.id, x => { if (!x.ado && first) x.ado = { id: first.id, rev: first.rev, type: first.type, url: first.url, connection: first.connection, area: first.area, state: first.state }; delete x.after; setStage(x, 'decide'); });
  const made = Object.keys(ids).filter(k => k !== 'source').length;
  await logDecision(store.v.items.find(x => x.id === c.id) || c, `Defined and published to ADO (${made} item${made === 1 ? '' : 's'})`);
  ws.toast('Published to ADO.', { kind: 'success' });
  const now = store.v.items.find(x => x.id === c.id);
  if (then === 'build' && now && now.ado) await buildMyself(now);
  refresh().catch(() => {});
}

/* ---------- dialogs ---------- */

function showDialog(html, onOk) {
  dlg.innerHTML = html;
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]');
    if (b) b.disabled = true;
    try { await onOk(form); dlg.close(); }
    catch (err) { toastErr(err); if (b) b.disabled = false; }
  });
  form.addEventListener('click', (e) => { if (e.target.closest('[data-act=cancel]')) dlg.close(); });
  dlg.showModal();
  const first = form.querySelector('input,select,textarea');
  if (first) first.focus();
}

/* ---------- events ---------- */

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || dlg.contains(b)) return;
  const act = b.dataset.act;
  const fn = ACT[act];
  if (!fn) return;
  const inPanel = panelEl.contains(b);
  const target = b.dataset.id && !['tab', 'open'].includes(act) ? findCard(b.dataset.id) : inPanel ? findCard(ui.open) : null;
  const menu = b.closest('details.more');
  if (menu) menu.open = false;
  if (['tab', 'open'].includes(act)) return fn(b.dataset.id);
  if (ui.busy) return;
  ui.busy = true; ui.error = ''; b.disabled = true;
  try { await fn(target || findCard(ui.open), b); }
  catch (err) { ui.error = err && err.message || ''; toastErr(err); }
  finally { ui.busy = false; if (document.contains(b)) b.disabled = false; paint(); }
});

let qTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.draft) { ui.drafts[e.target.dataset.draft] = e.target.value; return; }
  if (e.target.id === 'q') { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.q = e.target.value; paint(); }, 150); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'lvl') { ui.level = e.target.value; paint(); return; }
  if (e.target.id === 'area') { ui.area = e.target.value; remember('area', ui.area); paint(); return; }
  if (e.target.dataset.qpick) {
    const id = e.target.dataset.qpick, i = Number(e.target.dataset.qi);
    const ticked = [...panelEl.querySelectorAll(`input[data-qpick="${CSS.escape(id)}"][data-qi="${i}"]:checked`)].map(x => x.value);
    ui.picks[id] = { ...(ui.picks[id] || {}), [i]: ticked };
    return;
  }
  if (e.target.dataset.sprint || e.target.dataset.assign) { sprintChange(e.target); return; }
  const c = findCard(ui.open);
  if (!c || c.virtual) return;
  try {
    if (e.target.dataset.f === 'level') await store.update(c.id, x => { x.level = e.target.value; });
    if (e.target.id === 'ptitle' && e.target.value.trim()) await store.update(c.id, x => { x.title = e.target.value; });
  } catch (err) { toastErr(err); }
});
/** Sprints tab: move an item to a sprint, or assign it, in ADO after a confirm. The select goes back on Cancel. */
function sprintChange(sel) {
  const it = store.v.items.find(x => x.id === (sel.dataset.sprint || sel.dataset.assign));
  if (!it || !it.ado) return;
  const now = s.backlog.find(b => b.id === it.ado.id) || {};
  const rev = now.rev || it.ado.rev;
  const conn = it.ado.connection ? { connection: it.ado.connection } : {};
  let changes, what;
  if (sel.dataset.sprint) {
    if (!sel.value) { ws.toast('Pick a sprint. To take it out of every sprint, change it in ADO.', { kind: 'warn' }); paint(); return; }
    changes = { iteration: sel.value }; what = `Move #${it.ado.id} to ${sel.value.split('\\').pop()}?`;
  } else {
    const p = (s.people.people || []).find(x => x.id === sel.value);
    changes = { assignedTo: p ? p.adoIdentity : '' }; what = p ? `Assign #${it.ado.id} to ${p.name}?` : `Unassign #${it.ado.id}?`;
  }
  showDialog(confirmHtml('Change in Azure DevOps', what, 'Change it'), async () => {
    await ado(ws, 'workitem.update', { id: it.ado.id, rev, changes, ...conn }, { confirm: true });
    await readBacklog(); paint();
  });
  dlg.addEventListener('close', () => { if (ui.tab === 'health') paint(); }, { once: true });
}

document.addEventListener('keydown', (e) => {
  // Ctrl+Enter sends a reply or an answer from the panel.
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.dataset && e.target.dataset.draft) {
    const box = e.target.closest('[data-qform]') || e.target.closest('.agent-box');
    const send = box && box.querySelector('[data-act=qsend],[data-act=reply]');
    if (send) { e.preventDefault(); send.click(); }
    return;
  }
  if (e.key === 'Escape' && ui.open && !dlg.open && !['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName)) { ui.open = null; ui.editing = false; paint(); }
});

// Remember an Agent, Details or Timeline section you opened or closed, so a refresh does not undo it.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d && d.classList && d.classList.contains('agent-box') && d.dataset.sid) ui.agentOpen[d.dataset.sid] = d.open;
  // Details and Timeline: remembered in this browser, open or closed.
  if (d && d.classList && d.classList.contains('fold') && d.dataset.fold && panelEl.contains(d)) { ui.folds[d.dataset.fold] = d.open; remember(`fold.${d.dataset.fold}`, d.open ? '1' : '0'); }
}, true);

/* ---------- routes: item/<id>, health (sprints), runway/<map>/<item> (Runway's Open in Slate button) ---------- */

async function route(path) {
  let raw = String(path || '');
  try { raw = decodeURIComponent(raw); } catch { /* keep it as it came */ }
  const parts = raw.split('/').filter(Boolean);
  // Roadmaps lived in Slate until 2.0.0: old links open Runway itself.
  if (parts[0] === 'roadmaps' || parts[0] === 'roadmap') { ws.open({ app: 'runway', path: parts.slice(1).join('/') }).catch(() => {}); return; }
  if (parts[0] === 'sprints') { ui.tab = 'health'; paint(); const el = $('sprints'); if (el) el.scrollIntoView({ block: 'start' }); return; }
  if (parts[0] === 'health' || parts[0] === 'board') { ui.tab = parts[0]; paint(); return; }
  if (parts[0] === 'item' && parts[1]) { ui.tab = 'board'; ui.open = parts[1]; paint(); return; }
  if (parts[0] === 'runway' && parts[1] && parts[2]) { await fromRunway(parts[1], parts[2]); return; }
  if (parts[0] === 'runway') { ws.open({ app: 'runway', path: parts.slice(1).join('/') }).catch(() => {}); }
}

/** Runway's Work item button: the Slate item for a roadmap item, made the first time from Runway's `roadmap-item`
    offer (docs/handoffs.md). Slate never reads Runway's roadmaps. */
async function fromRunway(map, item) {
  let it = store.v.items.find(x => x.runway && x.runway.map === map && x.runway.item === item);
  if (!it) {
    let offers = [];
    try { offers = await readWorkOffers(ws, { runway: 'Runway' }, ['roadmap-item']); } catch { offers = []; }
    const offer = offers.find(o => o.payload.map === map && o.payload.item === item);
    if (!offer) return ws.toast('Runway did not send that roadmap item. Update Runway and click Work item again.', { kind: 'warn' });
    let id = null;
    await store.change(list => { id = applyRoadmapItem(list, offer); });
    it = store.v.items.find(x => x.id === id);
    if (!it) return ws.toast('That roadmap item is not there any more.', { kind: 'warn' });
  }
  ui.tab = 'board'; ui.open = it.id;
  paint();
}

ws.on('route', (p) => route((p && p.path) || ''));
ws.on('command', (p) => {
  if (p.id === 'new') ACT.new();
  if (p.id === 'new-idea') ACT['new-idea']();
  if (p.id === 'refresh') ACT.refresh();
  if (p.id === 'health' || p.id === 'sprints') route(p.id);
});
ws.on('visible', (p) => { if (p && p.visible) refresh({ backlog: false }).catch(() => {}); });
ws.on('online', () => { store.load().then(() => refresh()).catch(() => {}); });
let ocTimer = null;
try { ws.connectors.on('opencode', '*', () => { clearTimeout(ocTimer); ocTimer = setTimeout(() => refresh({ backlog: false }).catch(() => {}), 400); }); } catch { /* browser mode */ }
try { ws.people.subscribe((d) => { s.people = d; paint(); }); } catch { /* no directory */ }
try { ws.data.subscribe('summary', () => readPending().then(paint).catch(() => {}), { app: 'runway' }); } catch { /* no data backend */ }
// Captures from Home and the Dispatch hub show up as soon as they are accepted, not at the next refresh.
for (const app of ['home', 'agents']) { try { ws.data.subscribe('handoffs', () => readWork().then(paint).catch(() => {}), { app }); } catch { /* no data backend */ } }

/* ---------- start ---------- */

try { s.apps = await ws.apps.list(); } catch { s.apps = []; }
try { s.people = await ws.people.get(); } catch { s.people = People.EMPTY; }
await store.load();
paint();
if (!ws.embedded) route(location.hash.replace(/^#\/?/, ''));
refresh().catch(() => {});
// Every minute while visible: Tandem and handoffs; pull requests too (each item at most every 15 minutes).
setInterval(() => { if (document.visibilityState === 'visible') refresh({ backlog: false }).then(() => checkPrs()).catch(() => {}); }, 60000);

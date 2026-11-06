/* Slate: your ADO backlog as a board, from request to "who builds it?". model.js is pure, data.js talks to
   Workshop, view.js builds HTML, host.js runs Runway in the Roadmap tab. This file owns the page: state,
   refreshing from ADO and Tandem, and what each button does. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import * as People from '../../../shared/people.js';
import { connectorState, createStore, ado, readFiles, tandem } from './data.js';
import { hostFrame } from './host.js';
import {
  APP, NO_AREA, STAGE_TITLE, aboutText, asksFor, questionAnswers, areaOptions, backTargets, forwardTargets, bySprint, cardFacts, cards, cleanPrefs, customRefs, daysInStage, decisionNote, devColumn, draftState, filterCards, health, isStale, newItem, ownersFor, parseTriage,
  moveBack, pmColumn, publishPlan, roadmapIdea, setStage, summaryCards, waitingTask, winOffer
} from './model.js';
import { boardHtml, confirmHtml, delegateDialogHtml, fieldsDialogHtml, newDialogHtml, panelHtml, publishDialogHtml, readFieldsForm, roadmapHtml, topHtml } from './view.js';
import { healthHtml, sprintsHtml } from './health.js';

const $ = (id) => document.getElementById(id);
const topEl = $('top'), mainEl = $('main'), panelEl = $('panel'), dlg = $('dlg');

const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Slate');

const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(`slate.${k}`); localStorage.setItem(`slate.${k}`, v); } catch { /* storage blocked */ } return null; };

const ui = {
  tab: 'board', lane: remember('lane') === 'dev' ? 'dev' : 'pm', q: '', level: '', area: remember('area') || '', open: null,
  editing: false, busy: false, error: '', roadmapRoute: '',
  wide: remember('wide') === '1',
  picks: {},       // question id -> {index: [labels]}: what is ticked in the panel, kept across repaints
  drafts: {},      // typed answers (q:<id>:<i>) and replies (r:<session>), kept across repaints
  agentOpen: {}    // session id -> whether its Agent section is open, once you open or close it
};
const TABS = ['board', 'roadmaps', 'sprints', 'health'];
const s = {
  conn: { ado: 'Checking…', opencode: 'Checking…' },
  team: { areas: [], connection: '' },
  people: People.EMPTY,
  backlog: [], backlogNote: '',
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
    if (backlog) await readBacklog();
    await readTandem();
    paint();
    publishSummary();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function readBacklog() {
  s.backlogNote = '';
  if (s.conn.ado !== true) { s.backlog = []; return; }
  if (!s.team.areas.length) { s.backlog = []; s.backlogNote = 'Set your team\'s area paths in People so Slate can list your ADO backlog.'; return; }
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
 * Delegated and own items whose ADO item left the open backlog: read it, and if it is closed, the work is done.
 * A delegated one offers Rapport a win about the person (once). Runs only on a complete backlog read.
 */
async function closeFinished() {
  const open = new Set(s.backlog.map(b => b.id));
  const gone = store.v.items.filter(it => it.ado && ['delegated', 'dev'].includes(it.stage) && !open.has(it.ado.id)).slice(0, 10);
  for (const it of gone) {
    let w = null;
    try { w = await ado(ws, 'workitem.get', { id: it.ado.id, ...(it.ado.connection ? { connection: it.ado.connection } : {}) }); } catch { continue; }
    if (!w || !/^(closed|done|resolved|removed)$/i.test(w.state || '')) continue;
    if (it.stage === 'delegated' && !it.offered.win && !/removed/i.test(w.state)) await store.offer(winOffer(it, it.assignee)).catch(() => {});
    await store.update(it.id, x => { setStage(x, 'done'); if (x.stage === 'done' && it.stage === 'delegated') x.offered = { ...x.offered, win: today() }; }).catch(() => {});
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
const asksOf = (it) => asksFor(it, live(), it.run || runFor(it));

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
    for (const k of ['triage', 'define', 'handoff']) {
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
    if (it.work.define) want.set(it.work.define, it.work.define.startsWith('refine-') ? FILES.refine : FILES.scope);
  }
  await Promise.all([...want].map(async ([folder, names]) => s.files.set(folder, await readFiles(ws, folder, names))));
}
const filesOf = (folder) => (folder && s.files.get(folder)) || {};

/** Stages the files settle: a triage that finished moves its item on. */
async function advance() {
  const moves = [];
  for (const it of store.v.items) {
    const t = parseTriage(filesOf(it.work.triage)['triage.md']);
    const working = agentOf(it.sessions.triage);
    if (it.stage === 'new' && it.reopened !== 'new' && t && !(working && (working.busy || working.waiting))) moves.push([it.id, 'triaged', t.route]);
  }
  if (moves.length) await store.change(list => { for (const [id, stage, route] of moves) { const it = list.find(x => x.id === id); if (it) { setStage(it, stage); if (route && route !== 'undecided' && !it.route) it.route = route; } } }).catch(() => {});
}

/* ---------- what the board shows ---------- */

function personName(id) { return id ? People.label(s.people, id, '') : ''; }

function runFor(it) {
  const items = (s.tstate && s.tstate.items) || [];
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
  return out;
}

/** The lane's cards before any filter: the PM lane is everything not yours to build; the Dev lane is the rest. */
function laneCards() {
  const dev = (c) => c.stage === 'dev' || c.stage === 'done';
  return cards(store.v.items, s.backlog).filter(c => ui.lane === 'dev' ? dev(c) : !dev(c));
}

function columns() {
  const cols = {};
  const push = (k, c) => (cols[k] ||= []).push(c);
  const list = filterCards(laneCards(), { q: ui.q, level: ui.level, area: ui.area });
  if (ui.lane === 'pm') {
    for (const c of list) {
      if (['dev', 'done'].includes(c.stage)) continue;
      const e = enrich(c);
      const col = pmColumn(c, draftState(c, filesOf(c.work.define)), e.agent);
      e.stale = !c.virtual && isStale(c, col);
      push(col, e);
    }
  } else {
    // Only what you chose to build yourself. Every Tandem run, with its prompts and review, is Dispatch's.
    for (const c of list.filter(x => x.stage === 'dev' || x.stage === 'done')) push(c.stage === 'done' ? 'done' : devColumn(runFor(c)), enrich(c));
  }
  return cols;
}

function findCard(id) {
  if (!id) return null;
  const stored = store.v.items.find(x => x.id === id);
  if (stored) return stored;
  if (id.startsWith('ado_')) { const b = s.backlog.find(x => `ado_${x.id}` === id); return b ? cards([], [b])[0] : null; }
  return null;
}

/** People who own what the item touches (People's `owns`), best match first. */
function ownersOf(c) {
  const list = (s.people.people || []).filter(p => !p.archived && Array.isArray(p.owns) && p.owns.length).map(p => ({ id: p.id, name: p.name, owns: p.owns }));
  return ownersFor(list, aboutText(c, parseTriage(filesOf(c.work && c.work.triage)['triage.md'])));
}

function columnOf(it) { return ['dev', 'done'].includes(it.stage) ? it.stage : pmColumn(it, draftState(it, filesOf(it.work.define)), agentOf(it.sessions.current)); }

let summaryTimer = null;
function publishSummary() {
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    const items = store.v.items.map(it => ({ ...it, draftReady: ['approve', 'approve-stories', 'approve-milestones'].includes(draftState(it, filesOf(it.work.define)).step), adoNow: (s.backlog.find(b => it.ado && b.id === it.ado.id)) || null }));
    store.writeSummary(summaryCards(items, { columnOf, agentOf: itemAgent })).catch(() => {});
  }, 300);
}

const sessionOf = (sid) => { const x = sid && (live().sessions || {})[sid]; return x ? { ...x, id: sid } : null; };

function panelState(c) {
  const files = { ...filesOf(c.work && c.work.triage), ...filesOf(c.work && c.work.define) };
  const draft = draftState(c, filesOf(c.work && c.work.define));
  const lane = c.virtualRun || c.stage === 'dev' || c.stage === 'done' ? 'dev' : 'pm';
  const column = lane === 'pm' ? pmColumn(c, draft, agentOf(c.sessions && c.sessions.current)) : null;
  return {
    item: c, lane, files, draft, editing: ui.editing,
    back: c.virtual || c.virtualRun ? [] : backTargets(c, column),
    forward: c.virtualRun ? [] : forwardTargets(c),
    triage: parseTriage(filesOf(c.work && c.work.triage)['triage.md']),
    agent: itemAgent(c),
    asks: asksOf(c),
    session: sessionOf(c.sessions && c.sessions.current),
    ui: { picks: ui.picks, drafts: ui.drafts, agentOpen: ui.agentOpen },
    wide: ui.wide,
    column,
    run: c.run || runFor(c),
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
  if (s.backlogNote && ui.lane === 'pm') n.push(s.backlogNote);
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

let host = null;
function paint() {
  const focus = document.activeElement && document.activeElement.id;
  const board = ui.tab === 'board' && store.v.loaded;
  setHtml(topEl, topHtml(ui, ui.tab === 'board' ? notes() : [], board ? areaOptions(laneCards(), s.team.areas, ui.area) : []));
  if (ui.tab !== 'roadmaps' && host) { host.stop(); host = null; }
  if (ui.tab !== 'health' && reportsHost) { reportsHost.stop(); reportsHost = null; }
  if (ui.tab === 'roadmaps') {
    if (!mainEl.querySelector('#runway') && !mainEl.querySelector('.empty')) mountRoadmap();
  } else if (ui.tab === 'health') {
    if (!mainEl.querySelector('.health')) mountHealth();
  } else if (ui.tab === 'sprints') {
    setHtml(mainEl, sprintsView());
  } else {
    setHtml(mainEl, store.v.loaded ? boardHtml(columns(), { lane: ui.lane, open: ui.open, backlogNote: s.backlogNote, filtered: !!(ui.area || ui.level || ui.q.trim()) }) : '<p class="loading">Loading…</p>');
  }
  paintPanel();
  const waiting = store.v.items.filter(it => { const a = itemAgent(it); return a && a.waiting; }).length;
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
  if (!c) { panelEl.hidden = true; setHtml(panelEl, ''); return; }
  // Keep text the person is typing.
  const keep = ['draft', 'answers'].map(id => [id, $(id) && $(id).value]);
  panelEl.hidden = false;
  panelEl.parentElement.classList.toggle('wide', ui.wide);
  setHtml(panelEl, panelHtml(panelState(c)));
  for (const [id, val] of keep) if (val != null && $(id)) $(id).value = val;
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
  if (ui.tab === 'sprints') paint();
}

function mountRoadmap() {
  mainEl.innerHTML = roadmapHtml(runwayOn() ? 'on' : 'off');
  const frame = $('runway');
  if (!frame) return;
  host = hostFrame(frame, { ws, onOpenSlate: (path) => route(path), getRoute: () => ui.roadmapRoute });
}

/* ---------- actions ---------- */

const toastErr = (e) => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

/** A card that came from ADO, stored the first time you act on it. Returns the stored item. */
async function ensureStored(c) {
  if (!c.virtual && !c.virtualRun) return store.v.items.find(x => x.id === c.id) || c;
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
  'open-item': (c) => { if (c) { ui.open = c.id; ui.lane = ['dev', 'done'].includes(c.stage) ? 'dev' : 'pm'; paint(); } },
  lane: (id) => { ui.lane = id; remember('lane', id); ui.open = null; paint(); },
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
  open: (id) => { ui.open = ui.open === id ? null : id; ui.editing = false; ui.error = ''; paint(); },
  close: () => { ui.open = null; ui.editing = false; paint(); },
  async triage(c) {
    const it = await ensureStored(c);
    await startSession(it, 'triage', 'triage.start', it.ado ? { id: String(it.ado.id) } : { text: [it.title, it.description].filter(Boolean).join('. ').slice(0, 2000) });
    ws.toast('Triage started. It shows here when the agent is done.', { kind: 'success' });
  },
  async ask(c) {
    const t = parseTriage(filesOf(c.work.triage)['triage.md']);
    const text = `${c.title}${c.ado ? ` (#${c.ado.id})` : ''}\n\nA few questions before we start:\n${t.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
    try { await navigator.clipboard.writeText(text); ws.toast('Questions copied. Send them, then paste the answers here.', { kind: 'success' }); }
    catch { ws.toast('Could not copy. Select the questions in the panel instead.', { kind: 'warn' }); }
    await store.update(c.id, x => setStage(x, 'waiting'));
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
    return (it.level === 'epic' || it.level === 'feature' || (t && t.size === 'XL')) ? ACT.scope(it) : ACT.refine(it);
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
  'cancel-edit': () => { ui.editing = false; paint(); },
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
  async myself(c) {
    const it = await ensureStored(c);
    await store.update(it.id, x => { x.route = 'myself'; x.assignee = null; setStage(x, 'dev'); });
    await logDecision(it, 'Building it myself');
    ui.lane = 'dev'; remember('lane', 'dev'); paint();
  },
  async start(c) {
    const it = await ensureStored(c);
    if (!it.ado) return ws.toast('Publish it to ADO first.', { kind: 'warn' });
    await tandem(ws, 'start', { id: String(it.ado.id), lane: it.level === 'bug' ? 'bug' : 'feature' }, { confirm: true });
    ws.toast('Started in Tandem. Follow it here or in Dispatch.', { kind: 'success' });
  },
  async 'run-next'(c) {
    const run = c.run || runFor(c);
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
  dispatch: (c) => { const run = c && (c.run || runFor(c)); return ws.open({ app: 'agents', path: run ? String(run.id || '') : '' }); },
  ado: (c) => { if (c.ado && c.ado.url) window.open(c.ado.url, '_blank', 'noopener'); },
  async 'roadmap-add'(c) {
    const it = await ensureStored(c);
    await store.offer(roadmapIdea(it));
    ws.toast('Sent to Runway. Assign it to a roadmap from its Pending list.', { kind: 'success' });
  },
  async done(c) { await store.update(c.id, x => setStage(x, 'done')); },
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
        await store.update(it.id, x => setStage(x, to));
        ui.open = it.id; ui.editing = false; ui.lane = 'pm'; remember('lane', 'pm');
        paint();
        ws.toast(`Moved to ${STAGE_TITLE[to] || to}.`, { kind: 'success' });
      });
    }
    const notes = [];
    if (c.stage === 'delegated') notes.push('It stays assigned in ADO, and any Docket task stays: change those yourself if needed.');
    if (c.stage === 'dev' || (c.stage === 'done' && c.route === 'myself')) notes.push('Its Tandem run is not changed: pause or stop it in Dispatch.');
    if (['ready', 'decide', 'delegated', 'dev', 'done'].includes(c.stage) && c.published && Object.keys(c.published).length && ['new', 'triaged', 'waiting', 'defining'].includes(to)) notes.push('What it published stays in ADO; publishing again updates or skips those items.');
    showDialog(confirmHtml(`Move back to ${STAGE_TITLE[to] || to}?`, ['Slate moves the card back and keeps its drafts, triage and history.', ...notes].join(' '), 'Move back'), async () => {
      await store.update(c.id, x => moveBack(x, to));
      ui.editing = false;
      ui.lane = ['dev', 'done'].includes(to) ? 'dev' : 'pm';
      remember('lane', ui.lane);
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

function forgetQuestion(id) {
  delete ui.picks[id];
  for (const k of Object.keys(ui.drafts)) if (k.startsWith(`q:${id}:`)) delete ui.drafts[k];
}

/** The decision log: one note in Notes for each decision (Notes' inbox), never posted anywhere. */
async function logDecision(it, decision) {
  try { await store.offer(decisionNote(it, decision)); } catch { /* the board still has it */ }
}

async function runPublish(c, plan) {
  const ids = { ...(c.published || {}) };
  const conn = c.ado && c.ado.connection ? { connection: c.ado.connection } : s.team.connection ? { connection: s.team.connection } : {};
  let first = null;
  for (const p of plan) {
    if (p.op === 'skip') { ids[p.ref] = p.id; continue; }
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
  await store.update(c.id, x => { if (!x.ado && first) x.ado = { id: first.id, rev: first.rev, type: first.type, url: first.url, connection: first.connection, area: first.area, state: first.state }; setStage(x, 'decide'); });
  await logDecision(store.v.items.find(x => x.id === c.id) || c, `Defined and published to ADO (${Object.keys(ids).length} item${Object.keys(ids).length === 1 ? '' : 's'})`);
  ws.toast('Published to ADO.', { kind: 'success' });
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
  const target = b.dataset.id && !['tab', 'lane', 'open'].includes(act) ? findCard(b.dataset.id) : inPanel ? findCard(ui.open) : null;
  if (['tab', 'lane', 'open'].includes(act)) return fn(b.dataset.id);
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
  dlg.addEventListener('close', () => { if (ui.tab === 'sprints') paint(); }, { once: true });
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

// Remember an Agent section you opened or closed, so a refresh does not undo it.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d && d.classList && d.classList.contains('agent-box') && d.dataset.sid) ui.agentOpen[d.dataset.sid] = d.open;
}, true);

/* ---------- routes: item/<id>, roadmap, runway/<map>/<item> (Runway's Work item button) ---------- */

async function route(path) {
  let raw = String(path || '');
  try { raw = decodeURIComponent(raw); } catch { /* keep it as it came */ }
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'roadmaps' || parts[0] === 'roadmap') {
    ui.tab = 'roadmaps'; ui.roadmapRoute = parts.slice(1).join('/');
    if (host && host.ready) host.route(ui.roadmapRoute);
    paint(); return;
  }
  if (parts[0] === 'health' || parts[0] === 'sprints' || parts[0] === 'board') { ui.tab = parts[0]; paint(); return; }
  if (parts[0] === 'item' && parts[1]) { ui.tab = 'board'; ui.open = parts[1]; const c = findCard(parts[1]); if (c && (c.stage === 'dev' || c.stage === 'done')) ui.lane = 'dev'; paint(); return; }
  if (parts[0] === 'runway' && parts[1] && parts[2]) { await fromRunway(parts[1], parts[2]); return; }
}

/** Runway's Work item button: the Slate item for a roadmap item, made the first time. */
async function fromRunway(map, item) {
  let it = store.v.items.find(x => x.runway && x.runway.map === map && x.runway.item === item);
  if (!it) {
    let doc = null;
    try { doc = await ws.data.get(`maps/${map}`, { app: 'runway' }); } catch { doc = null; }
    const items = (doc && doc.items) || [];
    const ri = items.find(x => x.id === item && x.kind === 'item');
    if (!ri) return ws.toast('That roadmap item is not there any more.', { kind: 'warn' });
    let depth = 0, p = ri;
    while (p && p.parent && depth < 4) { p = items.find(x => x.id === p.parent); depth++; }
    const fresh = newItem({ title: ri.title, description: ri.notes || '', level: ['epic', 'feature', 'story', 'story'][depth] || 'story' });
    fresh.runway = { map, item };
    if (ri.ado && Number.isInteger(ri.ado.id)) fresh.ado = { id: ri.ado.id, rev: ri.ado.rev || 0, type: ri.ado.type || '', url: ri.ado.url || '', connection: ri.ado.connection || '', area: '', state: ri.ado.state || '' };
    await store.change(list => list.push(fresh));
    it = store.v.items.find(x => x.id === fresh.id);
  }
  ui.tab = 'board'; ui.lane = it.stage === 'dev' || it.stage === 'done' ? 'dev' : 'pm'; ui.open = it.id;
  paint();
}

ws.on('route', (p) => route((p && p.path) || ''));
ws.on('command', (p) => {
  if (p.id === 'new') ACT.new();
  if (p.id === 'refresh') ACT.refresh();
  if (p.id === 'roadmaps' || p.id === 'roadmap') route('roadmaps');
  if (p.id === 'health' || p.id === 'sprints') route(p.id);
  if (p.id === 'new-roadmap') { route('roadmaps'); setTimeout(() => host && host.command('new-roadmap'), 50); }
});
ws.on('visible', (p) => { if (p && p.visible) refresh({ backlog: false }).catch(() => {}); });
ws.on('online', () => { store.load().then(() => refresh()).catch(() => {}); });
let ocTimer = null;
try { ws.connectors.on('opencode', '*', () => { clearTimeout(ocTimer); ocTimer = setTimeout(() => refresh({ backlog: false }).catch(() => {}), 400); }); } catch { /* browser mode */ }
try { ws.people.subscribe((d) => { s.people = d; paint(); }); } catch { /* no directory */ }

/* ---------- start ---------- */

try { s.apps = await ws.apps.list(); } catch { s.apps = []; }
try { s.people = await ws.people.get(); } catch { s.people = People.EMPTY; }
await store.load();
paint();
if (!ws.embedded) route(location.hash.replace(/^#\/?/, ''));
refresh().catch(() => {});
setInterval(() => { if (document.visibilityState === 'visible') refresh({ backlog: false }).catch(() => {}); }, 60000);

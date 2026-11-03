/* Agents: the eng-agents live dashboard as a Workshop app. Everything goes through the SDK:
   - data: the opencode connector's `state` action, fetched again after its small events
     (model, live, autopilot, agent.waiting, agent.done) and its status changes;
   - buttons: the connector's actions. Write actions send confirm: true, only from the click that
     says what will happen (docs/sdk.md, Connectors);
   - shell: routes (#/agents/<id> focuses an item), the rail badge (open prompts), toasts and
     notifications. The theme comes from shared/theme.js and the SDK, with no messages of our own.
   view.js builds the HTML; this file paints it and handles input. */
// On its own page on alexisdavidson.org, Dispatch lives at dispatch.alexisdavidson.org (worker/index.js
// serves it there). The old address forwards; inside the Workshop shell (an iframe) it stays put.
const HOME = 'https://dispatch.alexisdavidson.org/';
if (window.parent === window && location.hostname === 'workshop.alexisdavidson.org') location.replace(HOME + location.hash);

import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { S } from './state.js';
import { render, prompts, itemForFolder, itemKey, isBusy, dayKey, guideDefaults, GUIDE_STEPS, cfgBuild, startRequest, repoUrlCheck } from './view.js';
import { INBOX, projectById, projectArgs, scopeProject } from './sidebar.js';
import { loadLocal, saveLocal, addFolder, renameFolder, removeFolder, placeProject, togglePin, toggleClosed, pruneLocal } from './local.js';

const OC = 'opencode';
const app = document.getElementById('app');
const ws = await connect({ app: 'agents' });
S.mode = ws.mode;
S.embedded = ws.embedded;
S.canNotify = typeof window.Notification === 'function';
document.documentElement.classList.toggle('embed', ws.embedded);
// On its own page: the same top bar as the other tools (crumbs and the light/dark toggle).
if (!ws.embedded) mountBar('Dispatch');

/* ---------- the setup guide (view.js guideHtml), shown while this page can't reach Workshop ----------
   Progress, the port and the computer type are kept per browser. Pairing works like the shell's Connect
   (docs/run-modes.md, Pairing): the agent's /pair window posts {url, token} back, stored as workshop.agent. */
const PAIR_KEY = 'workshop.agent', GUIDE_KEY = 'dispatch.setup';
const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const paired = readJson(PAIR_KEY);
const savedGuide = readJson(GUIDE_KEY);
S.origin = location.origin;
// Sidebar folders and pins: this browser only (local.js). Reading localStorage can throw (blocked site data).
const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const memStore = { getItem: () => null, setItem: () => {} };
S.local = loadLocal(store || memStore);
const saveSide = () => saveLocal(store || memStore, S.local);
S.agentUrl = ws.mode === 'hosted' && paired && paired.url ? paired.url : null;
S.wasPaired = ws.mode === 'browser' && !!(paired && paired.url);
S.setup = Object.assign(guideDefaults(), savedGuide || {}, { check: null, pair: null });
// Progress saved by the older four-step guide does not carry over.
if (S.setup.open && S.setup.open !== 'none' && !GUIDE_STEPS.includes(S.setup.open)) S.setup.open = null;
S.setup.done = Object.fromEntries(Object.entries(S.setup.done || {}).filter(([k]) => GUIDE_STEPS.includes(k)));
if (!savedGuide && !/Win/i.test(navigator.platform || navigator.userAgent || '')) S.setup.os = 'mac';
if (S.wasPaired) { try { S.setup.port = +new URL(paired.url).port || S.setup.port; } catch (e) { /* keep the saved port */ } }
function saveGuide() {
  const { done, open, port, os } = S.setup;
  try { localStorage.setItem(GUIDE_KEY, JSON.stringify({ done, open, port, os })); } catch (e) { /* private mode: this visit only */ }
}
const nextStep = () => GUIDE_STEPS.find(k => !S.setup.done[k]) || 'connect';
function stepDone(k) { S.setup.done[k] = true; S.setup.open = nextStep(); saveGuide(); }

// Is Workshop answering on this port? A no-cors request succeeds whenever the agent is up, before this
// site is allowed (a CORS request would fail either way until then).
// silent: the background check while the install step is open, which only speaks up when it finds Workshop.
async function checkWorkshop(silent) {
  const port = S.setup.port;
  if (!silent) { S.setup.check = { ok: null, text: `Looking for Workshop on port ${port}.` }; paint(); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal, targetAddressSpace: 'loopback' });
    S.setup.check = { ok: true, text: `Found Workshop on port ${port}.` };
    stepDone('install');
  } catch (e) {
    if (silent) return;
    S.setup.check = { ok: false, text: `Workshop is not answering on port ${port} yet. If the install command is still running, wait for it to say Done. If your browser asked to allow access to your local network, allow it and check again.` };
  } finally { clearTimeout(timer); }
  paint();
}
// While the install step is open, look for Workshop every few seconds so the step ticks itself off.
let polling = false;
setInterval(async () => {
  if (polling || S.mode !== 'browser' || document.hidden || S.setup.done.install || (S.setup.open && S.setup.open !== 'install')) return;
  polling = true;
  try { await checkWorkshop(true); } finally { polling = false; }
}, 4000);

let pairWin = null;
function startPairing() {
  const base = `http://127.0.0.1:${S.setup.port}`;
  pairWin = window.open(`${base}/pair?origin=${encodeURIComponent(location.origin)}`, 'workshop-pair', 'popup,width=520,height=420');
  S.setup.pair = pairWin
    ? { ok: null, text: 'Waiting for you to allow this site in the Workshop window.' }
    : { ok: false, text: 'Your browser blocked the window. Allow pop-ups for this site and try again.' };
  paint();
}
window.addEventListener('message', e => {
  const m = e.data;
  if (!pairWin || e.source !== pairWin || !m || m.type !== 'workshop-pair' || m.api !== 1) return;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(e.origin) || m.url !== e.origin || typeof m.token !== 'string' || !m.token) return;
  try { localStorage.setItem(PAIR_KEY, JSON.stringify({ url: m.url, token: m.token })); }
  catch (err) { S.setup.pair = { ok: false, text: 'This browser would not save the connection.' }; paint(); return; }
  pairWin = null;
  stepDone('connect');
  (ws.embedded ? window.top : window).location.reload();
});

const errText = e => (e && e.message) || 'Something went wrong.';
const toast = (text, bad) => ws.toast(text, { kind: bad ? 'error' : 'info' });
// Write actions: the click that called this is the approval.
const write = (action, args) => ws.connectors.call(OC, action, args, { confirm: true });
const read = (action, args) => ws.connectors.call(OC, action, args);

/* ---------- the connector's status and state ---------- */
async function loadStatus() {
  if (ws.backend !== 'agent') { S.connector = null; return; }
  try {
    const c = (await ws.connectors.list()).find(x => x.id === OC);
    S.connector = c ? c.status : { state: 'missing', message: null };
    S.version = c ? c.version : '';
    S.conn = 'on';
  } catch (e) {
    S.conn = 'off';
  }
}

// One `state` call at a time; events that arrive meanwhile ask for one more when it finishes.
let fetching = false, again = false;
async function fetchState() {
  if (ws.backend !== 'agent' || !S.connector || S.connector.state !== 'ready') return schedule();
  if (fetching) { again = true; return; }
  fetching = true;
  try {
    const d = await read('state');
    S.D = d; S.L = d.liveMode ? d.liveMode.live : null; S.conn = 'on';
    watchPrompts();
    if (d.projects && pruneLocal(S.local, new Set(d.projects.projects.map(p => p.id)), new Set((d.items || []).map(i => i.folder)))) saveSide();
  } catch (e) {
    if (e.code === 'unavailable' && /Workshop is not running|fetch/i.test(errText(e))) S.conn = 'off';
    else if (e.code === 'disabled' || e.code === 'unavailable') await loadStatus();
  } finally {
    fetching = false;
    schedule();
    if (again) { again = false; fetchState(); }
  }
}
let soon = null;
function fetchSoon() { clearTimeout(soon); soon = setTimeout(fetchState, 120); }

ws.connectors.on(OC, '*', fetchSoon);
ws.connectors.onStatus(OC, status => {
  const was = S.connector && S.connector.state;
  S.connector = status;
  if (status.state === 'ready') fetchSoon();
  else if (was === 'ready') { S.D = null; S.L = null; }
  schedule();
});
ws.on('online', ({ online }) => {
  S.conn = online ? 'on' : 'off';
  if (online) loadStatus().then(fetchState); else schedule();
});

/* ---------- alerts and the rail badge ----------
   A notification when an agent starts waiting for you, finishes, or autopilot needs you, while this
   app is out of sight (another app in the shell, or the window in the background). */
let visible = true;
ws.on('visible', p => { visible = !!p.visible; if (visible) schedule(); });
const outOfSight = () => !visible || document.hidden || !document.hasFocus();
function label(folder, fallback) {
  const it = folder ? itemForFolder(folder) : null;
  return it ? (it.id ? '#' + it.id + ' ' + it.title : it.title) : fallback;
}
function alertUser(title, body, folder) {
  if (!S.canNotify || Notification.permission !== 'granted' || !outOfSight()) return;
  const it = folder ? itemForFolder(folder) : null;
  ws.notify({ title, body: String(body || '').slice(0, 180), route: it ? itemKey(it) : '' }).catch(() => {});
}
let seen = null, wasBusy = {}, wasAuto = {}, lastBadge = -1;
function watchPrompts() {
  if (!S.L) return;
  const list = prompts();
  if (list.length !== lastBadge) { lastBadge = list.length; ws.badge(list.length || null).catch(() => {}); }
  const first = seen === null;
  if (first) seen = {};
  const fresh = list.filter(p => !seen[p.id]);
  list.forEach(p => { seen[p.id] = 1; });
  const finished = [];
  for (const [id, s] of Object.entries(S.L.sessions || {})) {
    const busy = isBusy(s);
    const ap = s.folder && S.L.autopilot ? S.L.autopilot[s.folder] : null;
    if (wasBusy[id] && !busy && s.folder && !(ap && ap.status === 'running' && ap.session === id)) finished.push(s);
    wasBusy[id] = busy;
  }
  const autoAlerts = [];
  for (const [f, a] of Object.entries(S.L.autopilot || {})) {
    if (wasAuto[f] && wasAuto[f] !== a.status && (a.status === 'waiting' || a.status === 'done')) autoAlerts.push([f, a]);
    wasAuto[f] = a.status;
  }
  if (first) return; // nothing on load, only what changes while the app is open
  autoAlerts.forEach(([f, a]) => alertUser((a.status === 'done' ? 'Ready for PR: ' : 'Autopilot needs you: ') + label(f, f), a.message || '', f));
  fresh.forEach(p => alertUser('Agent waiting: ' + label(p.folder, (S.L.sessions[p.sid] || {}).title || 'opencode session'), p.text, p.folder));
  finished.forEach(s => alertUser((s.error ? 'Agent stopped: ' : 'Agent finished: ') + label(s.folder, s.title || 'opencode session'), s.error || s.command || '', s.folder));
}

/* ---------- focus: #/agents/<id> scrolls to that item and flashes it ---------- */
let focusWanted = null;
function focusItem(id) {
  const el = document.getElementById('item-' + id);
  if (!el || !el.offsetParent) return false;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
  return true;
}
function wantFocus(path) {
  const id = String(path || '').split('/')[0];
  if (!id) return;
  S.ui.scope = { kind: 'all' }; // the item may be outside the project in view
  // The page may not have the item yet: keep trying for a while as data arrives.
  focusWanted = focusItem(id) ? null : { id, until: Date.now() + 15000 };
}
ws.on('route', p => wantFocus(p.path));
// Opened on its own: the hash is #<id> (the shell strips its own part before sending the route).
if (!ws.embedded && location.hash.length > 1) wantFocus(decodeURIComponent(location.hash.slice(1)));

/* ---------- painting ---------- */
// Elements with an entry animation, and how to tell the same one apart across a repaint.
const ENTERS = [
  ['.modal', el => (el.querySelector('[aria-labelledby]') || el).getAttribute('aria-labelledby')],
  ['.menu', el => el.getAttribute('style')],
  ['.pickup'],
  ['.guide'],
];
// Replace the page, keeping focus and the caret in whatever the user was typing in.
function paint() {
  S.now = Date.now();
  S.today = dayKey(new Date());
  S.yest = dayKey(new Date(S.now - 864e5));
  const html = render();
  let sh = app.querySelector('.sheet');
  const sheetTop = sh ? sh.scrollTop : 0;
  const a = document.activeElement;
  const key = a && a.getAttribute && a.getAttribute('data-draft');
  const sel = key && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  const shown = ENTERS.map(([q, id]) => { const el = app.querySelector(q); return el ? (id ? id(el) : true) : null; });
  app.innerHTML = html;
  // Entry animations play once: an element that was already on screen keeps still through repaints.
  ENTERS.forEach(([q, id], i) => { const el = app.querySelector(q); if (el && shown[i] !== null && shown[i] === (id ? id(el) : true)) el.classList.add('still'); });
  if (focusWanted && (Date.now() > focusWanted.until || focusItem(focusWanted.id))) focusWanted = null;
  sh = app.querySelector('.sheet');
  if (sh) sh.scrollTop = sheetTop;
  app.querySelectorAll('[data-follow]').forEach(el => { el.scrollTop = el.scrollHeight; });
  if (key) {
    const el = app.querySelector(`[data-draft="${CSS.escape(key)}"]`);
    if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
  }
}
// Coalesce bursts of updates into one paint per frame. Never repaint mid-click: the button under the
// pointer would be replaced and the click lost.
let pending = false, pointerDown = false, deferred = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (pointerDown) { deferred = true; return; }
    paint();
  });
}
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => {
  pointerDown = false;
  if (deferred) { deferred = false; setTimeout(schedule, 0); }
}, true);

/* ---------- input ---------- */
const ui = () => S.ui;
function closeOverlays() {
  ui().menu = null; ui().remove = null; ui().file = null; ui().start = null; ui().repo = null; ui().move = null;
  if (ui().project || ui().folder) { ui().project = null; ui().folder = null; for (const k of Object.keys(ui().drafts)) if (k.startsWith('proj:') || k.startsWith('folder:')) delete ui().drafts[k]; }
  if (ui().settings) { ui().settings = null; for (const k of Object.keys(ui().drafts)) if (k.startsWith('cfg:')) delete ui().drafts[k]; }
}

/* ---------- start work (view.js startSheetHtml) ---------- */
let lastMode = 'describe', lastLane = 'feature';
function focusFirst(sel) { const box = app.querySelector(sel); if (box) box.focus(); }
function openStart(mode) {
  closeOverlays();
  ui().start = { mode: mode || lastMode, lane: lastLane, project: scopeProject(), busy: false, error: null };
  ui().side = false;
  paint();
  focusFirst('.start-first');
}
// The click on Start is the approval for this write action.
async function startGo() {
  const st = ui().start;
  if (!st || st.busy) return;
  const r = startRequest(st, ui().drafts);
  if (r.error) { st.error = r.error; paint(); return; }
  st.busy = true; st.error = null; paint();
  try {
    const res = await write(r.action, r.args);
    for (const k of Object.keys(ui().drafts)) if (k.startsWith('start:')) delete ui().drafts[k];
    lastMode = st.mode; lastLane = st.lane;
    closeOverlays();
    const pname = r.args.project ? ' in ' + ((projectById(r.args.project) || {}).name || 'the project') : '';
    toast(r.action === 'spike' ? 'Investigating in opencode. Its answers show up here.'
      : r.action === 'start.local' ? `Started ${(res && res.id) || 'it'} as a ${r.args.lane}${pname}. The agent picks repos and may ask you to confirm them here.`
      : `Starting #${r.args.id} as a ${r.args.lane}${pname} in opencode. It shows up here when its folder is ready.`);
  } catch (e) {
    if (ui().start) { ui().start.busy = false; ui().start.error = errText(e); }
  }
  fetchSoon();
  schedule();
}

/* ---------- repos (view.js repoSheetHtml) ---------- */
function openRepo() {
  closeOverlays();
  ui().repo = { busy: false, error: null, added: null };
  paint();
  focusFirst('.repo-url');
}
async function repoGo() {
  const st = ui().repo;
  if (!st || st.busy) return;
  const r = repoUrlCheck(ui().drafts['repo:url']);
  if (r.error) { st.error = r.error; paint(); return; }
  st.busy = true; st.error = null; paint();
  try {
    const about = String(ui().drafts['repo:about'] || '').trim();
    const res = await write('repo.add', about ? { url: r.url, about } : { url: r.url });
    delete ui().drafts['repo:url']; delete ui().drafts['repo:about'];
    if (ui().repo) { ui().repo.busy = false; ui().repo.added = res; }
  } catch (e) {
    if (ui().repo) { ui().repo.busy = false; ui().repo.error = errText(e); }
  }
  fetchSoon();
  schedule();
}
function draftGuide(folder) {
  closeOverlays();
  act(() => write('repo.guide', { repo: folder }), () => toast(`An agent is reading ${folder} to draft its guide. Follow it under Investigations and repo guides.`));
}

/* ---------- opencode settings (view.js settingsSheetHtml) ---------- */
async function openSettings() {
  if (ws.backend !== 'agent') { toast('Connect this page to Workshop first.', true); return; }
  closeOverlays();
  ui().settings = { view: null, error: null, saving: false, enabled: !!(S.connector && S.connector.state !== 'disabled') };
  paint();
  try {
    const view = await ws.connectors.getConfig(OC);
    if (ui().settings) ui().settings.view = view;
  } catch (e) { if (ui().settings) ui().settings.error = errText(e); }
  schedule();
}
async function saveSettings() {
  const st = ui().settings;
  if (!st || !st.view || st.saving) return;
  const built = cfgBuild();
  if (built.error) { st.error = built.error; paint(); return; }
  st.saving = true; st.error = null; paint();
  try {
    await ws.connectors.putConfig(OC, built.config);
    const wasOn = !!(S.connector && S.connector.state !== 'disabled');
    if (S.mode === 'local' && st.enabled !== wasOn) await ws.config.put({ connectors: { [OC]: { enabled: st.enabled } } });
    closeOverlays();
    toast('Saved. The opencode connector restarts with the new settings.');
    await loadStatus();
    fetchSoon();
  } catch (e) {
    if (ui().settings) { ui().settings.saving = false; ui().settings.error = errText(e); }
  }
  schedule();
}

/* ---------- sidebar: scope, pins, projects, folders, moving runs (sidebar.js, local.js) ---------- */
function setScope(kind, id) {
  ui().scope = kind === 'project' ? { kind, id } : { kind };
  ui().side = false;
  paint();
  window.scrollTo(0, 0);
}
function openRunFromSide(folder) {
  const it = itemForFolder(folder);
  if (!it) return;
  // Show the run where it is: keep the current list if it has it, else its project's.
  const sc = ui().scope || { kind: 'all' };
  const pid = (S.D && S.D.projects && S.D.projects.runs[folder]) || INBOX;
  if (sc.kind === 'project' && sc.id !== pid) ui().scope = S.D && S.D.projects ? { kind: 'project', id: pid } : { kind: 'all' };
  if (sc.kind === 'needs' && !(app.querySelector('#item-' + CSS.escape(itemKey(it))))) ui().scope = { kind: 'all' };
  ui().side = false;
  paint();
  focusItem(itemKey(it));
}
function openProject(id) {
  closeOverlays();
  const cur = id ? projectById(id) : null;
  ui().project = { id: cur ? cur.id : null, color: cur ? cur.color : null, folder: undefined, busy: false, error: null, confirmDelete: false };
  ui().side = false;
  paint();
  focusFirst('.proj-first');
}
async function saveProject() {
  const st = ui().project;
  if (!st || st.busy) return;
  const cur = st.id ? projectById(st.id) : null;
  const r = projectArgs(st, ui().drafts, cur);
  if (r.error) { st.error = r.error; paint(); return; }
  st.busy = true; st.error = null; paint();
  try {
    const changed = Object.keys(r.args).filter(k => k !== 'id').length;
    const res = cur ? (changed ? await write('project.update', r.args) : { project: cur }) : await write('project.create', r.args);
    const pid = res.project.id;
    if (st.folder !== undefined) { placeProject(S.local, pid, st.folder); saveSide(); }
    closeOverlays();
    if (!cur) ui().scope = { kind: 'project', id: pid };
    toast(cur ? 'Saved ' + res.project.name + '.' : 'Added ' + res.project.name + '. Runs you start here get its instructions.');
  } catch (e) {
    if (ui().project) { ui().project.busy = false; ui().project.error = errText(e); }
  }
  fetchSoon();
  schedule();
}
async function deleteProject(id) {
  const st = ui().project;
  if (!st || st.busy) return;
  st.busy = true; paint();
  try {
    const res = await write('project.delete', { id });
    if ((ui().scope || {}).id === id) ui().scope = { kind: 'all' };
    closeOverlays();
    toast(res.movedToInbox ? `Removed. ${res.movedToInbox} run${res.movedToInbox === 1 ? '' : 's'} moved to Inbox.` : 'Removed.');
  } catch (e) {
    if (ui().project) { ui().project.busy = false; ui().project.error = errText(e); }
  }
  fetchSoon();
  schedule();
}
function openFolder(id) {
  closeOverlays();
  ui().folder = { id: id || null, error: null };
  ui().side = false;
  paint();
  focusFirst('.folder-first');
}
function saveFolder() {
  const st = ui().folder;
  if (!st) return;
  const name = ui().drafts['folder:name'];
  const cur = st.id ? S.local.folders.find(f => f.id === st.id) : null;
  const r = cur ? renameFolder(S.local, cur.id, name === undefined ? cur.name : name) : addFolder(S.local, name);
  if (r.error) { st.error = r.error; paint(); return; }
  saveSide();
  closeOverlays();
  paint();
}
async function moveRun(folder, project) {
  const st = ui().move;
  if (!st || st.busy) return;
  st.busy = true; st.error = null; paint();
  try {
    await write('run.assign', { folder, project });
    closeOverlays();
    toast('Moved to ' + ((projectById(project) || {}).name || 'Inbox') + '.');
  } catch (e) {
    if (ui().move) { ui().move.busy = false; ui().move.error = errText(e); }
  }
  fetchSoon();
  schedule();
}

async function act(fn, done, busyKey) {
  if (busyKey) { ui().busy[busyKey] = true; schedule(); }
  try { const r = await fn(); if (done) done(r); }
  catch (e) { toast(errText(e), true); }
  finally { if (busyKey) delete ui().busy[busyKey]; fetchSoon(); }
}

function sendReply(sid) {
  const key = 'r:' + sid;
  const text = (ui().drafts[key] || '').trim();
  if (!text) return;
  act(() => write('reply', { session: sid, text }), () => { ui().drafts[key] = ''; });
}
function sendQuestion(id) {
  const q = ((S.L && S.L.questions) || []).filter(x => x.id === id)[0];
  if (!q) return;
  const picks = ui().picks[id] || {};
  const answers = (q.questions || []).map((qq, i) => {
    const a = (picks[i] || []).slice();
    const typed = (ui().drafts['q:' + id + ':' + i] || '').trim();
    if (typed) a.push(typed);
    return a;
  });
  if (answers.some(a => !a.length)) { toast('Pick or type an answer for each question.', true); return; }
  act(() => write('answer', { kind: 'question', id, answers }), () => { delete ui().picks[id]; });
}
async function openFile(folder, name) {
  ui().file = { folder, name, text: null, error: null }; ui().menu = null; schedule();
  try { const r = await read('file.read', { folder, file: name }); if (ui().file && ui().file.name === name) ui().file.text = r.text; }
  catch (e) { if (ui().file) ui().file.error = errText(e); }
  schedule();
}

async function copy(b) {
  const text = S.copyStore[+b.getAttribute('data-copy')];
  const done = () => {
    const old = b.textContent; b.textContent = 'Copied'; b.classList.add('ok');
    setTimeout(() => { b.textContent = old; b.classList.remove('ok'); }, 1400);
  };
  try { await navigator.clipboard.writeText(text); done(); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast("Couldn't copy.", true); }
    ta.remove();
  }
}

app.addEventListener('change', ev => {
  const pi = ev.target.closest && ev.target.closest('[data-gport]');
  if (!pi) return;
  const n = Math.round(+pi.value);
  if (n >= 1024 && n <= 65535) { S.setup.port = n; S.setup.check = null; saveGuide(); schedule(); }
});
app.addEventListener('click', ev => {
  const t = ev.target;
  if (!t.closest) return;
  const go = t.closest('[data-gopen]');
  if (go) { const k = go.getAttribute('data-gopen'); const cur = S.setup.open || nextStep(); S.setup.open = cur === k ? 'none' : k; saveGuide(); paint(); return; }
  const gd = t.closest('[data-gdone]');
  if (gd) { stepDone(gd.getAttribute('data-gdone')); paint(); return; }
  const gos = t.closest('[data-gos]');
  if (gos) { S.setup.os = gos.getAttribute('data-gos'); saveGuide(); paint(); return; }
  if (t.closest('[data-gcheck]')) { checkWorkshop(false); return; }
  if (t.closest('[data-gpair]')) { startPairing(); return; }
  const cb = t.closest('button.copy');
  if (cb) { copy(cb); return; }
  const jump = t.closest('[data-jump]');
  if (jump) {
    ev.preventDefault();
    const el = document.getElementById(jump.getAttribute('data-jump'));
    if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); if (el.classList.contains('item') || el.classList.contains('pickup')) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
    return;
  }
  const mb = t.closest('[data-theme-menu], [data-more-menu]');
  if (mb) {
    const kind = mb.hasAttribute('data-more-menu') ? 'more' : 'theme';
    const r = mb.getBoundingClientRect();
    ui().menu = ui().menu && ui().menu.kind === kind ? null : { kind, top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) };
    paint(); return;
  }
  const th = t.closest('[data-th]');
  if (th && window.WorkshopTheme) { window.WorkshopTheme.set(th.getAttribute('data-th')); ui().menu = null; paint(); return; }
  if (ui().menu && !t.closest('.menu')) { ui().menu = null; paint(); }
  else if (ui().menu && t.closest('.menu button:not(.copy)')) { ui().menu = null; schedule(); } // the action below still runs

  // Sidebar
  if (t.closest('[data-side-open]')) { ui().side = true; paint(); const n = app.querySelector('.side .srow'); if (n) n.focus(); return; }
  if (t.closest('[data-side-close]')) { ui().side = false; paint(); return; }
  const sco = t.closest('[data-side-scope]');
  if (sco) { setScope(sco.getAttribute('data-side-scope'), sco.getAttribute('data-side-id')); return; }
  const srun = t.closest('[data-side-run]');
  if (srun) { openRunFromSide(srun.getAttribute('data-side-run')); return; }
  const stg = t.closest('[data-side-toggle]');
  if (stg) { toggleClosed(S.local, stg.getAttribute('data-side-toggle')); saveSide(); paint(); return; }
  const pin = t.closest('[data-pin]');
  if (pin) { togglePin(S.local, pin.getAttribute('data-pin'), pin.getAttribute('data-pin-id')); saveSide(); paint(); return; }
  if (t.closest('[data-proj-new]')) { openProject(null); return; }
  const pe = t.closest('[data-proj-edit]');
  if (pe) { openProject(pe.getAttribute('data-proj-edit')); return; }
  const pc = t.closest('[data-proj-color]');
  if (pc && ui().project) { ui().project.color = pc.getAttribute('data-proj-color'); paint(); return; }
  if (t.closest('[data-proj-save]')) { saveProject(); return; }
  if (t.closest('[data-proj-delete-ask]') && ui().project) { ui().project.confirmDelete = true; paint(); return; }
  const pdel = t.closest('[data-proj-delete]');
  if (pdel) { deleteProject(pdel.getAttribute('data-proj-delete')); return; }
  if (t.closest('[data-folder-new]')) { openFolder(null); return; }
  const fe = t.closest('[data-folder-edit]');
  if (fe) { openFolder(fe.getAttribute('data-folder-edit')); return; }
  if (t.closest('[data-folder-save]')) { saveFolder(); return; }
  const fdel = t.closest('[data-folder-delete]');
  if (fdel) { removeFolder(S.local, fdel.getAttribute('data-folder-delete')); saveSide(); closeOverlays(); paint(); return; }
  const mv = t.closest('[data-move]');
  if (mv) { closeOverlays(); ui().move = { folder: mv.getAttribute('data-move'), busy: false, error: null }; paint(); return; }
  const mvt = t.closest('[data-move-to]');
  if (mvt && ui().move) { moveRun(ui().move.folder, mvt.getAttribute('data-move-to')); return; }

  if (t.closest('[data-settings]')) { ws.open({ app: 'settings' }).catch(() => {}); return; }
  if (t.closest('[data-cfg-open]')) { openSettings(); return; }
  if (t.closest('[data-start-open]')) { openStart(); return; }
  if (t.closest('[data-start-go]')) { startGo(); return; }
  const sl = t.closest('[data-start-lane]');
  if (sl && ui().start) { ui().start.lane = sl.getAttribute('data-start-lane'); ui().start.error = null; paint(); return; }
  const sm = t.closest('[data-start-mode]');
  if (sm && ui().start) { ui().start.mode = sm.getAttribute('data-start-mode'); ui().start.error = null; paint(); focusFirst('.start-first'); return; }
  if (t.closest('[data-repo-open]')) { openRepo(); return; }
  if (t.closest('[data-repo-go]')) { repoGo(); return; }
  const gb = t.closest('[data-guide]');
  if (gb) { draftGuide(gb.getAttribute('data-guide')); return; }
  const dm = t.closest('[data-dismiss]');
  if (dm) { act(() => read('session.dismiss', { session: dm.getAttribute('data-dismiss') })); return; }
  const ac = t.closest('[data-ai-check]');
  if (ac) { act(() => read('refresh'), () => toast('Checked opencode for AI providers.'), 'ai'); return; }
  if (t.closest('[data-cfg-save]')) { saveSettings(); return; }
  if (t.closest('[data-close-sheet]')) { closeOverlays(); paint(); return; }
  const fb = t.closest('[data-file]');
  if (fb) { openFile(fb.getAttribute('data-file'), fb.getAttribute('data-name')); return; }
  const rm = t.closest('[data-remove]');
  if (rm) {
    closeOverlays(); ui().remove = rm.getAttribute('data-remove'); paint();
    const box = app.querySelector('.sheet input[data-draft^="rm:"]'); if (box) box.focus();
    return;
  }
  const rg = t.closest('[data-remove-go]');
  if (rg) {
    const folder = rg.getAttribute('data-remove-go');
    rg.disabled = true;
    act(() => write('remove', { folder, confirm: (ui().drafts['rm:' + folder] || '').trim() }), () => {
      toast('Deleted .work/' + folder);
      ui().remove = null; delete ui().drafts['rm:' + folder];
    }).then(() => { rg.disabled = false; });
    return;
  }
  const run = t.closest('[data-run]');
  if (run) {
    const folder = run.getAttribute('data-run'), command = run.getAttribute('data-cmd');
    act(() => write('run', { folder, command }), () => toast('Started ' + command), folder);
    return;
  }
  const pb = t.closest('[data-push]');
  if (pb) {
    const folder = pb.getAttribute('data-push'), repo = pb.getAttribute('data-repo'), key = 'p:' + folder + ':' + repo;
    if (ui().busy[key]) return;
    act(() => write('push', { folder, repo }), r => toast((r && r.message) || 'Pushed.'), key);
    return;
  }
  const ap = t.closest('[data-auto]');
  if (ap) {
    const folder = ap.getAttribute('data-auto'), action = ap.getAttribute('data-act');
    act(() => write('autopilot', { folder, action }), () => { if (/^(start|approve-start|resume)$/.test(action)) toast('Autopilot started'); }, 'a:' + folder);
    return;
  }
  const pm = t.closest('[data-perm]');
  if (pm) { act(() => write('answer', { kind: 'permission', id: pm.getAttribute('data-perm'), reply: pm.getAttribute('data-answer') })); return; }
  const qs = t.closest('[data-qsend]');
  if (qs) { sendQuestion(qs.getAttribute('data-qsend')); return; }
  const qr = t.closest('[data-qreject]');
  if (qr) { act(() => write('answer', { kind: 'question', id: qr.getAttribute('data-qreject'), reject: true })); return; }
  const rp = t.closest('[data-reply]');
  if (rp) { sendReply(rp.getAttribute('data-reply')); return; }
  const ab = t.closest('[data-abort]');
  if (ab) { act(() => write('abort', { session: ab.getAttribute('data-abort') }), () => toast('Stopping')); return; }
  const tm = t.closest('[data-term]');
  if (tm) { const session = tm.getAttribute('data-term'); act(() => read('terminal', session ? { session } : {}), () => toast('Opened a terminal')); return; }
  if (t.closest('[data-alerts]') && S.canNotify) { Notification.requestPermission().then(schedule, () => {}); return; }
  if (t.closest('[data-refresh]')) act(() => read('refresh'));
});
app.addEventListener('toggle', ev => {
  const k = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-key');
  if (k) ui().open[k] = ev.target.open;
}, true);
app.addEventListener('input', ev => {
  const k = ev.target.getAttribute('data-draft');
  if (k) ui().drafts[k] = ev.target.value;
  if (k && k.startsWith('rm:')) {
    const go = app.querySelector('[data-remove-go]');
    if (go) go.disabled = ev.target.value.trim() !== go.getAttribute('data-confirm');
  }
});
app.addEventListener('change', ev => {
  if (ev.target.hasAttribute('data-start-project') && ui().start) { ui().start.project = ev.target.value; return; }
  if (ev.target.hasAttribute('data-proj-folder') && ui().project) { ui().project.folder = ev.target.value; return; }
  if (ev.target.tagName === 'SELECT' && ev.target.getAttribute('data-draft')) { ui().drafts[ev.target.getAttribute('data-draft')] = ev.target.value; return; }
  if (ev.target.type === 'checkbox' && ui().settings) {
    if (ev.target.hasAttribute('data-cfg-enabled')) { ui().settings.enabled = ev.target.checked; return; }
    const p = ev.target.getAttribute('data-cfg');
    if (p) { ui().drafts['cfg:' + p] = ev.target.checked; return; }
  }
  const id = ev.target.getAttribute('data-qpick');
  if (!id) return;
  const i = +ev.target.getAttribute('data-qi');
  const p = ui().picks[id] = ui().picks[id] || {};
  const form = ev.target.closest('[data-qform]');
  p[i] = [...form.querySelectorAll(`input[name="${CSS.escape(ev.target.name)}"]:checked`)].map(x => x.value);
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (ui().menu || ui().remove || ui().file || ui().settings || ui().start || ui().repo || ui().project || ui().folder || ui().move) { closeOverlays(); paint(); }
  else if (ui().side) { ui().side = false; paint(); }
});
app.addEventListener('keydown', ev => {
  const dk = ev.target.getAttribute && ev.target.getAttribute('data-draft');
  if (ev.key === 'Enter' && dk && dk.startsWith('cfg:')) { ev.preventDefault(); saveSettings(); return; }
  if (ev.key === 'Enter' && (dk === 'start:id' || dk === 'start:title')) { ev.preventDefault(); startGo(); return; }
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && dk && dk.startsWith('start:')) { ev.preventDefault(); startGo(); return; }
  if (ev.key === 'Enter' && dk && dk.startsWith('repo:')) { ev.preventDefault(); repoGo(); return; }
  if (ev.key === 'Enter' && (dk === 'proj:name' || dk === 'proj:baseBranch')) { ev.preventDefault(); saveProject(); return; }
  if (ev.key === 'Enter' && dk === 'folder:name') { ev.preventDefault(); saveFolder(); return; }
  if (ev.key === 'Enter' && dk && dk.startsWith('rm:')) {
    ev.preventDefault();
    const go = app.querySelector('[data-remove-go]');
    if (go && !go.disabled) go.click();
    return;
  }
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && ev.target.getAttribute('data-sid')) {
    ev.preventDefault();
    sendReply(ev.target.getAttribute('data-sid'));
  }
});

/* ---------- palette commands ---------- */
ws.commands.register({ id: 'refresh', title: 'Refresh work items' });
ws.commands.register({ id: 'start', title: 'Start work' });
ws.commands.register({ id: 'repo', title: 'Add a repo' });
ws.commands.register({ id: 'project', title: 'New project' });
ws.on('command', ({ id }) => {
  if (id === 'refresh') act(() => read('refresh'));
  if (id === 'start' && S.connector && S.connector.state === 'ready') openStart();
  if (id === 'repo' && S.connector && S.connector.state === 'ready') openRepo();
  if (id === 'project' && S.D && S.D.projects) openProject(null);
});

/* ---------- start ---------- */
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSoon(); });
setInterval(() => { if (!document.hidden) schedule(); }, 30000); // keep "x min ago" fresh
schedule();
await loadStatus();
await fetchState();

// Test hook (tests/e2e.py): the state the page draws from.
window.__agents = { S, refetch: fetchState };

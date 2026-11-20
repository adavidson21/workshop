/* Agents: the eng-agents live dashboard as a Workshop app. Everything goes through the SDK:
   - data: the opencode connector's `state` action, fetched again after its small events
     (model, live, autopilot, agent.waiting, agent.done) and its status changes;
   - buttons: the connector's actions. Write actions send confirm: true, only from the click that
     says what will happen (docs/sdk.md, Connectors);
   - shell: routes (#/agents/<id> focuses an item), the rail badge (open prompts), toasts and
     notifications. The theme comes from shared/theme.js and the SDK, with no messages of our own.
   view.js builds the HTML; this file paints it and handles input. */
import { getWs, setBadge, setCards, setTab as loomTab, splitRoute, routeBoard, onTabRequest, setRunRenderer, runsPainted, onOpenRunPage, onPanelRun, boardCommand, onNudges, onPickable, pickable, onBoardFeed, onBoardDrawer, setBoardDrawer } from '../loom.js';
import { mountBar } from '../../../../shared/standalone-bar.js';
import { S } from './state.js';
import { render, prompts, itemForFolder, itemKey, isBusy, dayKey, fileDirty, fileDraft, fileDraftKey, fileLock, guideDefaults, GUIDE_STEPS, cfgBuild, startRequest, repoUrlCheck, repoCategoryCheck, NEW_CATEGORY } from './view.js';
import { INBOX, projectById, projectArgs, startProject } from './projects.js';
import { TAB_IDS, OLD_TABS, inboxCount, sessionAsksHtml, wantedFiles, walkList, runCardHtml } from './pages.js';
import { dropStart, guessKind, KINDS, kindOfAdoType, adoIdOf } from './lanes.js';
import { FLOW_IDS, addOpenQuestion, sendBackCommand, gateFile } from './flows.js';
import { closedLine, closedWith, looksLikeLog, prefillFor, safeDecode } from './start-prefill.js';
import { reviewUrlCheck, reviewAllList, prArg } from './pr-reviews.js';
import { createCaptureStore } from '../../../../shared/capture-box.js';
import { slateLinks, summaryCards } from './summary.js';
import { sendWork, workOffer } from './slate-handoff.js';
import { noticedList, observationTask, startArgsOf } from './noticed.js';
import { publishItems, readyClean, hasDrafts } from './factory.js';
import { confirmOutside } from '../../../../shared/outside.js';
import { useApps } from '../../../../shared/capture.js';
import { loadView, saveView, pruneView } from './local.js';
import { notebookRoute } from './doc.js';
import { digestCard, digestHtml } from './digest.js';
import { createHolder, heldFor, lastEndedFocusSpan, watchFocus, dateStr, toMin } from '../../../../shared/focus.js';
import { readCards } from '../../../../shared/summary.js';
import * as Products from '../../../../shared/products.js';

const OC = 'opencode';
const app = document.getElementById('app');
const ws = await getWs();
// Your products from Settings (Loom 6.6.0's Onboard a product picker). Read when the picker opens.
S.products = [];
function readProducts() {
  ws.data.get(Products.COLLECTION, { app: Products.APP }).then(env => { S.products = Products.list(env); schedule(); }, () => { S.products = []; });
}
S.mode = ws.mode;
// Loom opens on Lanes (Loom 5.0.0): the drop box and the four lanes; a route can open another tab.
S.ui.tab = 'lanes';
S.embedded = ws.embedded;
S.canNotify = typeof window.Notification === 'function';
// Focus hours: set up below (see focus hours and the afternoon digest), declared here so nothing reads them early.
let holder = null;
let digestBase = { span: null, held: [], spanMs: null };
document.documentElement.classList.toggle('embed', ws.embedded);
// On its own page: the same top bar as the other tools (crumbs and the light/dark toggle).
if (!ws.embedded) mountBar('Loom');

/* Chat and the hub are their own app since Loom 4.8.0 (apps/chat): Loom opens it for chat and hub routes. Save as
   note still sends a note to Notes from here, through Loom's handoffs. */
// Capture targets and places follow the apps on this site (their manifests, ws.apps.list()), without holding up the page.
ws.apps.list().then(list => { useApps(list); S.hasNotes = list.some(a => a.id === 'notes'); schedule(); }).catch(() => {});
const notesOut = createCaptureStore(ws, { sender: 'slate' });
async function noteOf(title, answer) {
  const t = String(title).slice(0, 120);
  const p = { kind: 'note', to: 'notes', text: `${title}\n\n${answer || ''}`.trim().slice(0, 2000), title: t, payload: { kind: 'note', title: t } };
  try { await notesOut.send([p]); ws.toast('Saved to Notes (inbox).', { kind: 'success' }); } catch (e) { ws.toast("Couldn't save that.", { kind: 'error' }); }
}
const openChat = path => ws.open(path ? { app: 'chat', path } : { app: 'chat' });

/* ---------- the setup guide (view.js guideHtml), shown while this page can't reach Workshop ----------
   Progress, the port and the computer type are kept per browser. Pairing works like the shell's Connect
   (docs/run-modes.md, Pairing): the agent's /pair window posts {url, token} back, stored as workshop.agent. */
const PAIR_KEY = 'workshop.agent', GUIDE_KEY = 'dispatch.setup';
const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const paired = readJson(PAIR_KEY);
const savedGuide = readJson(GUIDE_KEY);
S.origin = location.origin;
// The project filter: this browser only (local.js). Reading localStorage can throw (blocked site data).
const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const memStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
S.view = loadView(store || memStore);
const saveViewNow = () => saveView(store || memStore, S.view);
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
    S.setup.check = { ok: false, text: `Workshop is not answering on port ${port}. If the installer is still running, wait for Done. If your browser asked about local network access, allow it, then check again.` };
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

/* ---------- what Dispatch tells other apps (docs/summaries.md), and the Slate request behind each run ---------- */
let summaryKey = '', summaryTimer = null;
function publishSummary() {
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(async () => {
    const cards = summaryCards({ items: (S.D && S.D.items) || [], prompts: prompts(), prs: S.inbox.items || [], now: Date.now(), publish: (S.D && S.D.publish) || {}, gaps: (S.D && S.D.gaps && S.D.gaps.open) || [] });
    const held = holder && holder.card();
    if (held) cards.push(Object.assign({ updatedAt: Date.now() }, held));
    const key = JSON.stringify(cards.map(c => ({ ...c, updatedAt: 0 })));
    if (key === summaryKey) return;
    // Loom writes one summary for both halves (loom.js mergeCards).
    setCards('runs', cards);
    summaryKey = key;
  }, 500);
}
async function loadSlate() {
  try { S.slate = slateLinks(await ws.data.get('summary', { app: 'slate' })); schedule(); } catch (e) { /* no Slate here */ }
}
loadSlate();
try { ws.data.subscribe('summary', loadSlate, { app: 'slate' }); } catch (e) { /* no data backend */ }

/* ---------- PRs waiting on you: the tracker connectors' sync.prs (read-only) ----------
   ADO and GitHub, whichever are on and ready, merged into one list (each item carries its system).
   Checked once when Dispatch connects, when the PR reviews page opens (if older than five minutes),
   and from Check again. With neither connector on, the page says how to turn one on. */
const TRACKERS = ['ado', 'github'];
const TRACKER_NAMES = { ado: 'Azure DevOps', github: 'GitHub' };
const INBOX_FRESH_MS = 5 * 60e3;
async function loadInbox(force) {
  if (ws.backend !== 'agent' || S.inbox.state === 'loading') return;
  if (!force && S.inbox.at && Date.now() - S.inbox.at < INBOX_FRESH_MS) return;
  let list = [];
  try { list = (await ws.connectors.list()).filter(x => TRACKERS.includes(x.id) && x.status && x.status.state === 'ready'); } catch (e) { /* the agent is not reachable: try again later */ return; }
  if (!list.length) { S.inbox = { state: 'off', items: [], notes: [], error: null, at: Date.now() }; schedule(); return; }
  S.inbox = { ...S.inbox, state: 'loading' }; schedule();
  const items = [], notes = [], errors = [];
  for (const c of list) {
    try {
      const r = await ws.connectors.call(c.id, 'sync.prs', { knownPrs: [] });
      items.push(...((r && r.items) || []).map(p => ({ ...p, system: c.id })));
      notes.push(...((r && r.notes) || []));
    } catch (e) {
      errors.push(list.length > 1 ? `${TRACKER_NAMES[c.id]}: ${errText(e)}` : errText(e));
    }
  }
  if (errors.length === list.length) S.inbox = { state: 'error', items: [], notes: [], error: errors.join(' '), at: Date.now() };
  else {
    S.inbox = { state: 'ok', items, notes: [...errors, ...notes], error: null, at: Date.now() };
    saveInbox();
    updateBadge();
    publishSummary();
  }
  schedule();
}
for (const id of TRACKERS) ws.connectors.onStatus(id, status => { if (status.state === 'ready' && S.inbox.state === 'off') loadInbox(true); });

/* The nightly review (opencode connector) cannot ask ADO or GitHub itself: hand it the inbox each time we get it. */
function saveInbox() {
  if (!S.connector || S.connector.state !== 'ready') return;
  read('pr.inbox.save', { prs: (S.inbox.items || []).slice(0, 200).map(prArg) }).catch(() => {});
}

/* ---------- Review all: the opencode connector's queue runs /pr-review one PR at a time ---------- */
function reviewAll() {
  const list = reviewAllList();
  if (!list.length || ui().busy['rv:all']) return;
  act(() => write('pr.reviewAll', { prs: list.slice(0, 25).map(prArg) }), r => {
    const n = (r && r.added && r.added.length) || 0;
    const skipped = (r && r.skipped && r.skipped.length) || 0;
    toast(n ? `Queued ${n} review${n === 1 ? '' : 's'}. They run one at a time, even with Loom closed.${skipped ? ` ${skipped} skipped.` : ''}` : 'Nothing new to review.');
  }, 'rv:all');
}
function queueAction(what) {
  if (ui().busy['rv:q']) return;
  const run = what === 'resume' ? () => write('pr.reviewAll', { prs: [] }) : () => read(what === 'stop' ? 'pr.queue.stop' : 'pr.queue.clear', {});
  act(run, () => { if (what === 'stop') toast('Stopped. The review that is running finishes on its own.'); }, 'rv:q');
}

/* ---------- PR reviews: start one (the opencode connector's pr.review action) ---------- */
// "Review a link" on the To review page shows the paste box.
function openPaste() {
  ui().prReview = { ...(ui().prReview || {}), open: true };
  paint();
  focusFirst('#rv-url');
}
function startReview(url, again) {
  const ck = reviewUrlCheck(url);
  if (!ck.ok) { ui().prReview = { busy: false, error: ck.error }; paint(); return; }
  const key = 'rv:' + ck.id;
  if (ui().busy[key]) return;
  ui().prReview = { busy: true, error: null };
  act(() => write('pr.review', again ? { url: ck.url, again: true } : { url: ck.url }), () => {
    toast(again ? `Reviewing PR ${ck.id} again` : `Reviewing PR ${ck.id}`);
    if (ui().drafts['rv:url'] && reviewUrlCheck(ui().drafts['rv:url']).id === ck.id) ui().drafts['rv:url'] = '';
  }, key).finally(() => {
    if (ui().prReview && ui().prReview.busy) ui().prReview = { busy: false, error: null };
    schedule();
  });
}

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
    publishSummary();
    watchPrompts();
    if (d.projects && pruneView(S.view, new Set(d.projects.projects.map(p => p.id)))) saveViewNow();
  } catch (e) {
    if (e.code === 'unavailable' && /Workshop is not running|fetch/i.test(errText(e))) S.conn = 'off';
    else if (e.code === 'disabled' || e.code === 'unavailable') await loadStatus();
  } finally {
    fetching = false;
    schedule();
    if (again) { again = false; fetchState(); }
  }
}
// The .work files the page in view shows inline (pages.js wantedFiles: the run page's step, the Inbox's gate files),
// through file.read, the same action as the file sheet. Read again when the folder changes; dropped when it is gone.
function loadFiles() {
  const live = new Set(((S.D && S.D.items) || []).map(it => it.folder));
  for (const k of Object.keys(S.files)) if (!live.has(k.split('/')[0])) delete S.files[k];
  if (!S.D || !S.connector || S.connector.state !== 'ready') return;
  for (const [folder, name] of wantedFiles()) {
    const it = itemForFolder(folder);
    if (!it || !(it.files || []).includes(name)) continue;
    const key = folder + '/' + name;
    const f = S.files[key];
    if (f && (f.loading || f.at === it.modifiedMs)) continue;
    const next = S.files[key] = { text: f ? f.text : null, error: null, at: it.modifiedMs, loading: true };
    read('file.read', { folder, file: name })
      .then(r => { next.text = r.text; })
      .catch(e => { next.error = errText(e); })
      .finally(() => { next.loading = false; schedule(); });
  }
}
let soon = null;
function fetchSoon() { clearTimeout(soon); soon = setTimeout(fetchState, 120); }

ws.connectors.on(OC, '*', fetchSoon);
// After Publish (connector 1.27.0): a fix to push and a merge are worth a notification when Workshop is out of sight.
ws.connectors.on(OC, 'published', p => {
  if (!p || !p.folder) return;
  if (p.event === 'fix-ready') alertUser(`Push fix: ${label(p.folder, 'a published PR')}`, `Tandem fixed the failing CI on ${p.repo || 'the PR'}. Push it from Loom.`, p.folder);
  else if (p.event === 'merged') alertUser(`Merged: ${label(p.folder, 'a published PR')}`, 'Done. Tandem ran its retro and removed the worktrees.', p.folder);
});
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
  const it = folder ? itemForFolder(folder) : null;
  // Focus hours (Workshop docs/focus.md): held during focus and lunch, except a blocking PR's review during focus.
  const blockingPr = !!(it && it.kind === 'pr' && blockingIds().has(String(it.folder).replace(/^pr-/, '')));
  if (holder && holder.held && !(blockingPr && holder.focus.state === 'focus')) { holder.add(1); return; }
  if (!S.canNotify || Notification.permission !== 'granted' || !outOfSight()) return;
  ws.notify({ title, body: String(body || '').slice(0, 180), route: it ? itemKey(it) : '' }).catch(() => {});
}
let seen = null, wasBusy = {}, wasAuto = {};
// Pull requests blocked on you (required reviewer, not waiting on the author): their reviews break through focus.
const blockingIds = () => new Set((S.inbox.items || []).filter(p => p && p.tier === 'blocking' && !p.waiting).map(p => String(p.id)));
function updateBadge() {
  const count = S.L ? inboxCount() : 0;
  const bt = blockingIds().size;
  const key = count + '/' + bt;
  if (key !== S.badgeKey) { S.badgeKey = key; setBadge('runs', count, { breakThrough: bt }); }
}
function watchPrompts() {
  if (!S.L) return;
  const list = prompts();
  updateBadge();
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

/* ---------- focus hours (Workshop docs/focus.md) and the afternoon digest (digest.js) ----------
   During focus and lunch the rail badge is held by the shell and agent alerts are counted here instead, in
   Loom's `held` summary card. After a focus span ends, "While you were focused" sits on top of the Inbox. */
const DIGEST_KEY = 'workshop.dispatch.digestDismissed';
const focusWatch = watchFocus(ws, f => { if (holder) holder.sync(f); updateBadge(); refreshDigest(); schedule(); });
holder = createHolder(ws, { watch: focusWatch, label: n => `${n} Loom update${n === 1 ? '' : 's'} waiting`, route: 'lanes', onChange: () => publishSummary() });
let digestApps = null;
async function refreshDigest() {
  const f = focusWatch.current, d = new Date();
  const span = lastEndedFocusSpan(f, d);
  if (!span) { digestBase = { span: null, held: [], spanMs: null }; return; }
  try {
    if (!digestApps) digestApps = await ws.apps.list().catch(() => []);
    const sums = await Promise.all(digestApps.map(a => ws.data.get('summary', { app: a.id }).then(env => readCards(env, a.id)).catch(() => null)));
    const held = heldFor(digestApps.map((a, i) => ({ app: a.id, name: a.name, cards: sums[i] })), span.key);
    const at = m => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60).getTime();
    digestBase = { span, held, spanMs: [at(toMin(span.start)), at(toMin(span.end))] };
  } catch (e) { digestBase = { span, held: [], spanMs: null }; }
  schedule();
}
S.digestHtml = (h) => {
  let dismissed = '';
  try { dismissed = localStorage.getItem(DIGEST_KEY) || ''; } catch (e) { /* not remembered */ }
  const reviews = ((S.D && S.D.items) || []).filter(it => it.kind === 'pr');
  return digestHtml(digestCard({ ...digestBase, waiting: S.L ? inboxCount() : 0, reviews, blocking: blockingIds(), date: dateStr(new Date()), dismissed }), h);
};

/* ---------- routes ----------
   #/agents/<tab> opens a tab (inbox, chat, work, reviews; Loom 2.x's runs, ship and research open Work);
   #/agents/work/<id> a run's page (also runs/, ship/ and research/<folder>, from 2.x); #/agents/chat/<session> a
   conversation; #/agents/hub/<text> asks the hub (from Home's quick capture, where Enter was pressed).
   #/agents/<id> (Loom 1.x, notifications, Home and Docket's links) opens whatever that is: a run's page, or a
   review on Reviews. */
let focusWanted = null;
function focusItem(id) {
  const el = document.getElementById('item-' + id);
  if (!el || !el.offsetParent) return false;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
  return true;
}
// A work item id or folder name, as the old routes and notifications give it.
function itemByKey(key) { return ((S.D && S.D.items) || []).find(it => itemKey(it) === key || it.folder === key) || null; }
function openKey(key) {
  const it = itemByKey(key);
  if (!it) return false;
  if (it.kind === 'pr') { setTab('reviews'); focusWanted = { id: itemKey(it), until: Date.now() + 15000 }; schedule(); }
  // Loom 6.4.0: a run (Docket's agent queue, notifications) opens its panel beside the floor, not its own page.
  else { ui().run = null; ui().laneFilter = 'all'; ui().laneSel = it.folder; setBoardDrawer(''); setTab('lanes', true); }
  return true;
}
let keyWanted = null;
function wantFocus(path) {
  const p = String(path || '');
  // The board half's routes (item/<id>, health, sprints, board) open its tab and go to it (loom.js splitRoute).
  const sr = splitRoute(p);
  if (sr.half === 'board') { setTab(sr.tab); routeBoard(sr.path); return; }
  // Chat and the hub moved to the Chat app (Loom 4.8.0); Reviews is the Inbox's PRs chip.
  if (/^(hub|chat)(\/|$)/.test(p)) { openChat(p); setTab('lanes'); return; }
  if (/^reviews\/?$/.test(p)) { setTab('reviews'); return; }
  // teach: the Teach chip (Loom 6.2.0), where Docket's agent queue sends a knowledge gap.
  if (/^teach\/?$/.test(p)) { ui().laneFilter = 'teach'; setTab('lanes'); return; }
  // start/<flow>[/<text>]: Start work on that flow's card, filled in with the text (Chat's flow suggestions).
  const sm = /^start(?:\/([a-z]+))?(?:\/([\s\S]*))?$/.exec(p);
  if (sm) {
    const fl = sm[1] || ''; const text = sm[2] ? safeDecode(sm[2]) : '';
    setTab('lanes');
    // Loom 6.0.0: a build, fix, investigation or hand-off lands in the drop box, its kind picked; Start runs it.
    const dropKind = { feature: 'build', small: 'build', quick: 'build', bug: looksLikeLog(text) ? 'diagnose' : 'build', spike: 'ask', handoff: 'handoff' }[fl];
    if (dropKind) {
      if (text) ui().drafts['lanes:drop'] = text;
      ui().dropKind = dropKind; ui().dropGuess = dropKind;
      paint(); focusFirst('#ln-drop'); return;
    }
    // A pasted error log goes to Fix a bug's Error log box (Chat's flow cards).
    if (fl === 'bug' && looksLikeLog(text)) { openStart('bug', { log: text }); if (ui().start) ui().start.src = 'log'; paint(); return; }
    openStart(fl, text ? prefillFor(fl, { title: text, summary: text.length > 120 ? text : '' }, '') : null);
    return;
  }
  const [head, rest] = [p.split('/')[0], p.split('/').slice(1).join('/')];
  if (!head) return;
  if ((head === 'work' || OLD_TABS[head]) && rest) { keyWanted = { key: rest, until: Date.now() + 15000 }; tryKey(); return; }
  if (TAB_IDS.includes(head) || OLD_TABS[head]) { setTab(head); return; }
  // The page may not have the item yet: keep trying for a while as data arrives.
  keyWanted = { key: head, until: Date.now() + 15000 };
  tryKey();
}
function tryKey() {
  if (!keyWanted) return;
  if (openKey(keyWanted.key) || Date.now() > keyWanted.until) keyWanted = null;
}
ws.on('route', p => wantFocus(p.path));
onTabRequest(t => { if (ui().tab !== t || ui().run) setTab(t); });
onNudges(() => schedule());
onPickable(() => { if (ui().tab === 'lanes') schedule(); });
onBoardFeed(() => { if (ui().tab === 'lanes') schedule(); });
// The board item's drawer closed (its own Close, or it left the board): the card is no longer open.
onBoardDrawer(id => {
  if (id) { ui().laneSel = 'board:' + id; schedule(); return; }
  if (String(ui().laneSel || '').startsWith('board:')) { ui().laneSel = null; schedule(); }
});
// A run inside its card on the board (loom.js): its step and buttons, and its full page from the card.
setRunRenderer(folder => (S.D ? runCardHtml(folder) : ''));
onPanelRun(() => { loadFiles(); schedule(); });
onOpenRunPage(folder => { if (itemForFolder(folder)) openRun(folder, 'board'); else { keyWanted = { key: folder, until: Date.now() + 15000 }; tryKey(); } });
// Opened on its own, the hash is #<route> (the shell strips its own part before sending the route). Inside the shell
// the frame's own hash is set only by Back to Dispatch on the code review (review.html), which returns to the run.
// After this module's first await, so the state further down (ui, the paint queue) exists by then.
if (location.hash.length > 1) { const h = decodeURIComponent(location.hash.slice(1)); queueMicrotask(() => wantFocus(h)); }

/* ---------- painting ---------- */
// Elements with an entry animation, and how to tell the same one apart across a repaint.
const ENTERS = [
  ['.modal', el => (el.querySelector('[aria-labelledby]') || el).getAttribute('aria-labelledby')],
  ['.menu', el => el.getAttribute('style')],
  ['.pickup'],
  ['.guide'],
];
// Replace the page, keeping focus and the caret in whatever the user was typing in.
let lastHtml = null, lastFirst = null;
function paint() {
  S.now = Date.now();
  S.today = dayKey(new Date());
  S.yest = dayKey(new Date(S.now - 864e5));
  const html = render();
  runsPainted(); // the board half's panel shows runs too (loom.js)
  // Skip a repaint that would draw the same thing: rebuilding the view under the pointer drops and
  // re-applies :hover, which flickers (repaints come with every agent event and on timers).
  if (html === lastHtml && app.firstChild === lastFirst && app.firstChild && !focusWanted) return;
  let sh = app.querySelector('.sheet');
  const sheetTop = sh ? sh.scrollTop : 0;
  const a = document.activeElement;
  const key = a && a.getAttribute && a.getAttribute('data-draft');
  const sel = key && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  const draftTop = key ? a.scrollTop : 0;
  const shown = ENTERS.map(([q, id]) => { const el = app.querySelector(q); return el ? (id ? id(el) : true) : null; });
  app.innerHTML = html;
  lastHtml = html; lastFirst = app.firstChild;
  // Board and Health show the board half's page under the tab bar (loom.js); a run's page hides it.
  loomTab(S.ui.run ? 'run' : S.ui.tab);
  // Entry animations play once: an element that was already on screen keeps still through repaints.
  ENTERS.forEach(([q, id], i) => { const el = app.querySelector(q); if (el && shown[i] !== null && shown[i] === (id ? id(el) : true)) el.classList.add('still'); });
  loadFiles();
  if (keyWanted) tryKey();
  if (focusWanted && (Date.now() > focusWanted.until || focusItem(focusWanted.id))) focusWanted = null;
  sh = app.querySelector('.sheet');
  if (sh) sh.scrollTop = sheetTop;
  app.querySelectorAll('[data-follow]').forEach(el => { el.scrollTop = el.scrollHeight; });
  if (key) {
    const el = app.querySelector(`[data-draft="${CSS.escape(key)}"]`);
    if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } el.scrollTop = draftTop; }
  }
}
// Coalesce bursts of updates into one paint per frame. Never repaint mid-click: the button under the
// pointer would be replaced and the click lost.
// var, not let: connector and online events can call schedule() before this line has run.
var pending = false, pointerDown = false, deferred = false; // eslint-disable-line no-var
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
function closeOverlays(force) {
  // An edited .work file asks before its changes are dropped (view.js fileSheetHtml).
  if (!force && ui().file && fileDirty(ui().file)) { ui().file.confirmClose = true; ui().menu = null; return; }
  if (ui().file) delete ui().drafts[fileDraftKey(ui().file)];
  ui().menu = null; ui().remove = null; ui().file = null; ui().start = null; ui().repo = null; ui().repos = false; ui().move = null; ui().projects = false;
  if (ui().project) { ui().project = null; for (const k of Object.keys(ui().drafts)) if (k.startsWith('proj:')) delete ui().drafts[k]; }
  if (ui().settings) { ui().settings = null; for (const k of Object.keys(ui().drafts)) if (k.startsWith('cfg:')) delete ui().drafts[k]; }
}

/* ---------- start work: pick a flow (view.js startSheetHtml, flows.js) ---------- */
function focusFirst(sel) { const box = app.querySelector(sel); if (box) box.focus(); }
// Older flows and modes open the card that took them over (flow cards v1): Quick change and Small change are Build a
// feature (no ADO item, or the Small change size), Technical spec is Write docs (its type).
const LEGACY_START = { describe: ['feature', { src: 'describe' }], quick: ['feature', { src: 'describe' }], small: ['feature', { size: 'small' }],
  tsd: ['docs', { type: 'tsd' }], spike: ['spike', {}], ado: ['feature', { src: 'ado' }] };
/** Opens Start work: on the flow picker, or on one flow's form (a flow id, or an older flow or mode). `fill`: drafts. */
function openStart(flow, fill) {
  closeOverlays();
  const [f, extra] = LEGACY_START[flow] || (FLOW_IDS.includes(flow) ? [flow, {}] : [null, {}]);
  ui().start = { flow: f, src: null, size: 'normal', type: 'docs', timebox: '', project: startProject(), busy: false, error: null, ...extra };
  for (const [k, v] of Object.entries(fill || {})) ui().drafts['start:' + k] = v;
  paint();
  focusFirst(f ? '.start-first' : '.fcard');
}
const STARTED = {
  spike: () => 'Investigating. The first look shows on its card; the findings come to Ready.',
  'scope.start': () => 'Scoping the idea. Tandem may ask you a few questions; they show on its card on the floor.',
  'docs.start': () => 'Drafting the doc. The draft comes to you on the research line for your read.',
  'spike.log': () => 'Diagnosing the log. The first look shows on its card; the diagnosis comes to Ready with a fix, configuration first.',
  'tsd.start': () => 'Drafting the technical spec. Tandem asks you to confirm the repos and pick the flows; the questions show on its card in Lanes.'
};
const BOARD_STARTED = { request: 'On the floor. Triage is running; pick the path when it is done.', handoff: 'On the floor. Tandem is drafting the story for you to approve.' };
// The click on Start is the approval for this write action.
/** Starts what a Start work state and its drafts ask for (view.js startRequest): a board flow through the board half,
 *  else the connector's action, then tells the board about the run. Returns {board, msg}; throws on a bad form. */
async function startCore(st, drafts) {
  const r = startRequest(st, drafts);
  if (r.error) throw new Error(r.error);
  if (r.board) {
    // Handle a request, Hand to a person: the board half adds the card and starts its first step (loom.js).
    await boardCommand(r.board, r.args);
    return { board: true, msg: BOARD_STARTED[r.board] };
  }
  const res = await write(r.action, r.args);
  // Slate tracks every run from start to resolved: tell it about this one (Start was the person's click).
  try { await sendWork(ws, workOffer({ action: r.action, args: r.args, res, from: st.from })); } catch (e) { /* Slate is optional */ }
  // Started from a spike's findings: the spike is closed, with what came of it.
  if (st.from) await closeSpike(st.from, closedLine(r, res));
  const pname = r.args.project ? ' in ' + ((projectById(r.args.project) || {}).name || 'the project') : '';
  const msg = r.action === 'spike' && r.args.log ? STARTED['spike.log']() : STARTED[r.action] ? STARTED[r.action]()
    : r.action === 'start.local' ? `Started ${(res && res.id) || 'it'} as a ${r.args.lane === 'quick' ? 'small change' : r.args.lane}${pname}. It is on the floor; the agent may ask you to confirm repos.`
    : `Starting #${r.args.id} as a ${r.args.lane === 'quick' ? 'small change' : r.args.lane}${pname}. Its card is on the floor once its folder is ready.`;
  return { board: false, msg };
}
async function startGo() {
  const st = ui().start;
  if (!st || st.busy) return;
  const r = startRequest(st, ui().drafts);
  if (r.error) { st.error = r.error; paint(); return; }
  st.busy = true; st.error = null; paint();
  // Started from Lanes (Other flows): stay on Lanes, where the new card shows; a board flow goes to the board.
  const back = ui().tab === 'lanes' && !r.board ? 'lanes' : 'board';
  try {
    const out = await startCore(st, ui().drafts);
    for (const k of Object.keys(ui().drafts)) if (k.startsWith('start:')) delete ui().drafts[k];
    closeOverlays();
    toast(out.msg);
    setTab(back);
  } catch (e) {
    if (ui().start) { ui().start.busy = false; ui().start.error = errText(e); }
  }
  fetchSoon();
  schedule();
}
// What the drop box says once a card is started: where it is, and where the next thing shows up.
const DROP_STARTED = {
  build: 'Started. It is in Clarify; Tandem asks any questions there, then writes the spec for you in Plan.',
  handoff: 'Tandem is drafting what to build. Approve it, then pick who builds it.',
  diagnose: 'Diagnosing the log. The root cause and a fix come to Ready, configuration first.',
  ask: 'Looking into it. The answer comes to Ready.'
};
/** Lanes' drop box: start a Build, Diagnose or Ask from what was pasted (lanes.js dropStart). The click on Start (or
 *  Enter) is the approval for this write action. */
async function dropGo() {
  if (ui().dropBusy) return;
  const text = ui().drafts['lanes:drop'] || '';
  const kind = ui().dropKind || guessKind(text);
  const picked = ui().dropAdo && adoIdOf(text) === ui().dropAdo.id ? ui().dropAdo : null;
  // From ADO (Loom 6.3.0, claude/work-items-source-v1-plan.md): an import starts a local item from the ADO item's
  // title, unless Keep it linked is ticked (then /start <id>, linked as before).
  const imported = picked && !ui().dropKeep && kind === 'build';
  const r = imported
    ? dropStart(`${String(text).replace(/^\s*#?\d+\s*/, '') || 'ADO ' + picked.id}\n\nImported from ADO #${picked.id}.`, kind, { project: startProject(), ado: false })
    : dropStart(text, kind, { project: startProject(), ...(picked ? { ado: true, adoType: picked.type } : {}) });
  if (r.error) { toast(r.error, true); focusFirst('#ln-drop'); return; }
  const drafts = {};
  for (const [k, v] of Object.entries(r.drafts)) drafts['start:' + k] = v;
  ui().dropBusy = true; paint();
  try {
    await startCore(r.st, drafts);
    delete ui().drafts['lanes:drop'];
    ui().dropKind = null; ui().dropGuess = null; ui().dropAdo = null; ui().dropKeep = false;
    toast(DROP_STARTED[kind] || 'Started.');
  } catch (e) {
    toast(`Could not start the ${((KINDS[kind] || {}).name || 'work').toLowerCase()}: ${errText(e)}`, true);
  }
  ui().dropBusy = false;
  fetchSoon();
  schedule();
}
/** A spike's findings fork: write closed.md ("Closed: <what came of it>"), which takes it off the Inbox (workparser). */
async function closeSpike(folder, line) {
  try {
    let cur = null;
    try { cur = await read('file.read', { folder, file: 'closed.md' }); } catch (e) { cur = null; }
    await write('file.write', { folder, file: 'closed.md', text: line + '\n', ...(cur ? { expected: cur.text } : {}) });
  } catch (e) { toast('Could not close the spike: ' + errText(e), true); }
}
/** Write docs, Save to Folio: copy the doc into its .work folder as doc.md, where Folio's Tandem section shows it,
 *  and mark it saved. The click is the approval for the reads and both writes. */
async function saveDocToFolio(folder) {
  const key = 'folio:' + folder;
  if (ui().busy[key]) return;
  ui().busy[key] = true; schedule();
  try {
    const doc = await read('docs.doc', { folder });
    let cur = null;
    try { cur = await read('file.read', { folder, file: 'doc.md' }); } catch (e) { cur = null; }
    await write('file.write', { folder, file: 'doc.md', text: doc.text, ...(cur ? { expected: cur.text } : {}) });
    await write('file.write', { folder, file: 'saved.md', text: `Saved to Folio from ${doc.path} on ${dateStr(new Date())}. It is in Folio under Tandem, ${folder}/doc.md.\n` });
    toast(`Saved. Open Folio, Tandem, ${folder}, to read it.`);
  } catch (e) { toast(errText(e), true); }
  finally { delete ui().busy[key]; fetchSoon(); schedule(); }
}

/* ---------- send back with a note, and the Inbox one at a time (pages.js) ---------- */
// The note goes under the gate file's Open questions (written over the text just read, so nothing Tandem wrote is
// lost), then the step runs again (docs/pipeline.md, Gates). The click on Send back is the approval for both writes.
async function sendBack(folder) {
  const it = itemForFolder(folder);
  const key = 'sb:' + folder;
  const note = String(ui().drafts[key] || '').trim();
  const cmd = it && sendBackCommand(it);
  const file = it && gateFile(it);
  if (!it || !cmd || !file) { toast('There is nothing to send back here any more.', true); return; }
  if (!note) { toast('Say what should change first.', true); focusFirst(`[data-draft="${CSS.escape(key)}"]`); return; }
  if (ui().busy[key]) return;
  ui().busy[key] = true; schedule();
  try {
    const cur = await read('file.read', { folder, file });
    await write('file.write', { folder, file, text: addOpenQuestion(cur.text, note), expected: cur.text });
    await write('run', { folder, command: cmd });
    delete ui().drafts[key]; ui().open[key] = false;
    walkDone();
    toast(`Sent back. Tandem is redoing ${file} with your note.`);
  } catch (e) { toast(errText(e), true); }
  finally { delete ui().busy[key]; fetchSoon(); schedule(); }
}
// Go through them: a row you acted on leaves the list straight away (the next state confirms it).
function walkDone() {
  const w = ui().walk;
  const el = app.querySelector('.walk[data-walk-key]');
  if (w && el) { w.done = w.done || {}; w.done[el.getAttribute('data-walk-key')] = 1; }
}
function walk(what) {
  if (what === 'start') { ui().walk = { i: 0, done: {} }; ui().run = null; }
  else if (what === 'stop') ui().walk = null;
  else if (ui().walk) {
    const n = walkList().length;
    ui().walk.i = Math.max(0, Math.min(n - 1, (ui().walk.i || 0) + (what === 'prev' ? -1 : 1)));
  }
  paint();
  window.scrollTo(0, 0);
}

/* ---------- repos (view.js repoSheetHtml) ---------- */
function openRepo() {
  closeOverlays();
  // Inside Workshop, Settings > Repos adds a repo and sets up its Azure DevOps project and PRs in one go.
  // On its own page (no Settings next to it), this sheet clones it.
  if (ws.embedded) { ws.open({ app: 'settings', path: 'repos' }).catch(() => {}); return; }
  ui().repo = { busy: false, error: null, added: null };
  paint();
  focusFirst('.repo-url');
}
async function repoGo() {
  const st = ui().repo;
  if (!st || st.busy) return;
  const r = repoUrlCheck(ui().drafts['repo:url']);
  if (r.error) { st.error = r.error; paint(); return; }
  const c = repoCategoryCheck(ui().drafts['repo:category'], ui().drafts['repo:newcat']);
  if (c.error) { st.error = c.error; paint(); focusFirst('.repo-newcat'); return; }
  st.busy = true; st.error = null; paint();
  try {
    const about = String(ui().drafts['repo:about'] || '').trim();
    const args = { url: r.url };
    if (about) args.about = about;
    if (c.category) args.category = c.category;
    const res = await write('repo.add', args);
    delete ui().drafts['repo:url']; delete ui().drafts['repo:about']; delete ui().drafts['repo:category']; delete ui().drafts['repo:newcat'];
    if (ui().repo) { ui().repo.busy = false; ui().repo.added = res; }
  } catch (e) {
    if (ui().repo) { ui().repo.busy = false; ui().repo.error = errText(e); }
  }
  fetchSoon();
  schedule();
}
// Repos, from the menu. Inside Workshop that is Settings > Repos; on its own page, a sheet with the workspace's repos.
function openRepos() {
  closeOverlays();
  if (ws.embedded) { ws.open({ app: 'settings', path: 'repos' }).catch(() => {}); return; }
  ui().repos = true;
  paint();
}
// Start work from a spike's findings (the findings fork): Build it, Fix it or Write it up, filled in from the findings.
// Nothing starts until Start; then the spike is closed with what came of it.
function startFromDoc(folder, flow = 'feature') {
  const it = itemForFolder(folder);
  if (!it) return;
  const d = S.files[it.folder + '/findings.md'];
  openStart(flow, prefillFor(flow, it, d && d.text));
  if (ui().start) { ui().start.from = it.folder; if (flow !== 'docs') ui().start.src = 'describe'; }
}
function draftGuide(folder) {
  closeOverlays();
  act(() => write('repo.guide', { repo: folder }), () => toast(`Drafting the guide for ${folder}. Follow it on Work, under Starting.`));
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

/* ---------- tabs, a run's page, projects (pages.js, projects.js, local.js) ---------- */
function setTab(tab, keep) {
  // Reviews is a card in Lanes' Ready since Loom 6.0.0: its address opens it.
  if (tab === 'reviews') { ui().laneSel = 'reviews'; loadInbox(false); }
  tab = OLD_TABS[tab] || tab;
  if (!TAB_IDS.includes(tab)) tab = 'lanes';
  if (!keep) ui().run = null;
  if (tab !== 'inbox') ui().walk = null;
  ui().tab = tab;
  if (tab === 'reviews') loadInbox(false);
  paint();
  window.scrollTo(0, 0);
}
/** A run's page, on the tab it was opened from (the Inbox, else Work), which Back returns to. */
function openRun(folder, from) {
  const it = itemForFolder(folder);
  if (!it) return;
  const back = from || (['health', 'lanes'].includes(ui().tab) ? ui().tab : 'lanes');
  ui().run = folder; ui().back = back; ui().walk = null;
  setTab(back, true);
}
function setProjectFilter(id) {
  S.view.project = id || 'all';
  saveViewNow();
  paint();
}
function openProject(id) {
  closeOverlays();
  const cur = id ? projectById(id) : null;
  ui().project = { id: cur ? cur.id : null, color: cur ? cur.color : null, busy: false, error: null, confirmDelete: false };
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
    closeOverlays();
    if (!cur) { S.view.project = pid; saveViewNow(); }
    toast(cur ? 'Saved ' + res.project.name + '.' : 'Added ' + res.project.name + '.');
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
    if (S.view.project === id) { S.view.project = 'all'; saveViewNow(); }
    closeOverlays();
    toast(res.movedToInbox ? `Removed. ${res.movedToInbox} run${res.movedToInbox === 1 ? ' is' : 's are'} now in no project.` : 'Removed.');
  } catch (e) {
    if (ui().project) { ui().project.busy = false; ui().project.error = errText(e); }
  }
  fetchSoon();
  schedule();
}
async function moveRun(folder, project) {
  const st = ui().move;
  if (!st || st.busy) return;
  st.busy = true; st.error = null; paint();
  try {
    await write('run.assign', { folder, project });
    closeOverlays();
    const to = projectById(project);
    toast(to && !to.builtIn ? 'Moved to ' + to.name + '.' : 'Moved out of its project.');
  } catch (e) {
    if (ui().move) { ui().move.busy = false; ui().move.error = errText(e); }
  }
  fetchSoon();
  schedule();
}

// Open each published repo's create PR page (Publish, Publish all ready).
function openPrs(r) {
  for (const x of (r && r.repos) || []) if (x.pr && /^https:\/\//.test(x.pr)) { try { window.open(x.pr, '_blank', 'noopener'); } catch (e) { /* blocked: the links stay on the card */ } }
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
async function openFile(folder, name, mode) {
  ui().file = { folder, name, text: null, error: null, mode: mode || 'preview', saving: false, conflict: false, saved: false, confirmClose: false };
  ui().menu = null; schedule();
  try { const r = await read('file.read', { folder, file: name }); if (ui().file && ui().file.name === name) ui().file.text = r.text; }
  catch (e) { if (ui().file) ui().file.error = errText(e); }
  schedule();
}
// Save the open .work file with the text it was read at (file.write answers 409 if Tandem changed it since).
async function saveFile() {
  const f = ui().file;
  if (!f || f.saving || !fileDirty(f) || fileLock(f)) return;
  const text = fileDraft(f);
  f.saving = true; f.error = null; f.conflict = false; schedule();
  try {
    await write('file.write', { folder: f.folder, file: f.name, text, expected: f.text });
    if (ui().file === f) { f.text = text; delete ui().drafts[fileDraftKey(f)]; f.saved = true; }
    toast('Saved ' + f.name);
  } catch (e) {
    if (ui().file === f) { if (e && (e.status === 409 || e.code === 'conflict') && !/working|Autopilot/.test(errText(e))) f.conflict = true; else f.error = errText(e); }
  }
  f.saving = false; schedule();
}
async function reloadFile() {
  const f = ui().file;
  if (!f) return;
  delete ui().drafts[fileDraftKey(f)];
  openFile(f.folder, f.name, f.mode);
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

/* The runs half's input: its own page (#app), and the run cards inside the board's panel (.loom-run, loom.js). */
function listen(type, fn, opts) {
  app.addEventListener(type, fn, opts);
  const br = document.getElementById('board-root');
  if (br) br.addEventListener(type, ev => { if (ev.target && ev.target.closest && ev.target.closest('.loom-run')) fn(ev); }, opts);
}
listen('change', ev => {
  const pi = ev.target.closest && ev.target.closest('[data-gport]');
  if (!pi) return;
  const n = Math.round(+pi.value);
  if (n >= 1024 && n <= 65535) { S.setup.port = n; S.setup.check = null; saveGuide(); schedule(); }
});
listen('click', ev => {
  const dd = ev.target.closest('[data-digest-dismiss]');
  if (dd) { try { localStorage.setItem(DIGEST_KEY, dateStr(new Date())); } catch (e) { /* this page only */ } schedule(); return; }
  const dg = ev.target.closest('[data-digest-app]');
  if (dg) { if (dg.dataset.digestApp === 'slate') ws.open({ app: 'slate', path: dg.dataset.digestRoute || '' }); else ws.open({ app: dg.dataset.digestApp, path: dg.dataset.digestRoute || '' }); return; }
  const t = ev.target;
  if (!t.closest) return;
  const slOpen = t.closest('[data-open-slate]');
  if (slOpen) { ws.open({ app: 'slate', path: slOpen.getAttribute('data-open-slate') }).catch(() => {}); return; }
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

  // Tabs, the run page, Research folders, the project filter
  const tb = t.closest('[data-tab]');
  if (tb) { setTab(tb.getAttribute('data-tab')); return; }
  // Lanes (lanes.js): open or close a card's panel, filter, start from the drop box.
  const lo = t.closest('[data-lane-open]');
  if (lo) {
    const k = lo.getAttribute('data-lane-open');
    ui().laneSel = ui().laneSel === k ? null : k;
    // A board item opens the board's own panel as a drawer over Lanes.
    setBoardDrawer(ui().laneSel && ui().laneSel.startsWith('board:') ? ui().laneSel.slice(6) : '');
    paint(); return;
  }
  if (t.closest('[data-lane-close]')) { ui().laneSel = null; setBoardDrawer(''); paint(); return; }
  const lf = t.closest('[data-lane-filter]');
  if (lf) { ui().laneFilter = lf.getAttribute('data-lane-filter'); paint(); return; }
  // Floor or List (Loom 6.4.0), kept with the project filter; a station's +N more.
  const lv = t.closest('[data-lane-view]');
  if (lv) { S.view.lanes = lv.getAttribute('data-lane-view') === 'list' ? 'list' : 'floor'; saveViewNow(); paint(); return; }
  // Onboard a product from Loom (6.6.0): the picker lists your products from Settings; a pick runs product.onboard.
  if (t.closest('[data-onboard-toggle]')) { ui().onboardPick = !ui().onboardPick; if (ui().onboardPick) { ui().coverPick = false; readProducts(); } paint(); return; }
  // Add regression tests (6.8.0): the same product list; a pick runs tests.cover with the optional area.
  if (t.closest('[data-cover-toggle]')) { ui().coverPick = !ui().coverPick; if (ui().coverPick) { ui().onboardPick = false; readProducts(); } paint(); return; }
  const cg = t.closest('[data-cover-go]');
  if (cg) {
    const product = cg.getAttribute('data-cover-go');
    const box = document.getElementById('ln-cover-area');
    const area = box ? box.value.trim() : '';
    act(() => write('tests.cover', area ? { product, area } : { product }), () => { ui().coverPick = false; if (box) box.value = ''; if (ui().drafts) ui().drafts['lanes:cover'] = ''; toast(`Tandem is planning regression tests for ${product}. They show on the floor marked Tests.`); }, 'cover');
    return;
  }
  const og = t.closest('[data-onboard-go]');
  if (og) {
    const product = og.getAttribute('data-onboard-go');
    act(() => write('product.onboard', { product }), () => { ui().onboardPick = false; toast(`Tandem is onboarding ${product}. Its steps show as a new line on the floor.`); }, 'onboard');
    return;
  }
  const fmore = t.closest('[data-floor-more]');
  if (fmore) { const k = fmore.getAttribute('data-floor-more'); ui().floorOpen = { ...(ui().floorOpen || {}), [k]: !(ui().floorOpen || {})[k] }; paint(); return; }
  if (t.closest('[data-lane-start]')) { dropGo(); return; }
  // Noticed (Loom 6.1.0): start as a Quick change, send to Docket, or dismiss.
  const obsStart = t.closest('[data-obs-start]');
  if (obsStart) {
    const id = obsStart.getAttribute('data-obs-start');
    const o = noticedList().find(x => x.id === id);
    act(async () => {
      const res = await write('observation.start', { id });
      try { await sendWork(ws, workOffer({ action: 'start.local', args: startArgsOf(o), res })); } catch (e) { /* Slate is optional */ }
      return res;
    }, () => toast('Started as a Quick change'), 'obs:' + id);
    return;
  }
  const obsDocket = t.closest('[data-obs-docket]');
  if (obsDocket) {
    const id = obsDocket.getAttribute('data-obs-docket');
    const o = noticedList().find(x => x.id === id);
    if (!o) return;
    act(async () => { await sendWork(ws, observationTask(o)); return write('observation.sent', { id }); }, () => toast('Sent to Docket'), 'obs:' + id);
    return;
  }
  const obsDismiss = t.closest('[data-obs-dismiss]');
  if (obsDismiss) {
    const id = obsDismiss.getAttribute('data-obs-dismiss');
    act(() => write('observation.dismiss', { id }), null, 'obs:' + id);
    return;
  }
  // The software factory (Loom 6.2.0): Teach a gap, Publish a ready build (or all of them), see UI check shots,
  // approve a plan to build after an overlapping one.
  const teach = t.closest('[data-teach]');
  if (teach) {
    const id = teach.getAttribute('data-teach');
    const answer = (ui().drafts['teach:' + id] || '').trim();
    if (!answer) return;
    act(() => write('gap.answer', { id, answer }), () => { delete ui().drafts['teach:' + id]; toast('Saving your answer. Tandem writes it where it belongs.'); }, 'gap:' + id);
    return;
  }
  // Loom 6.5.0: build an epic's stories here (connector epic.build), and hide a live product's new line.
  const eb = t.closest('[data-epic-build]');
  if (eb) {
    const folder = eb.getAttribute('data-epic-build');
    act(() => write('epic.build', { folder }), r => toast(r && r.split ? 'Tandem is making the stories. They start building as soon as they exist.' : `Building ${r && r.started ? r.started.length : 0} stories, in order.`), 'epic:' + folder);
    return;
  }
  const od = t.closest('[data-onboard-dismiss]');
  if (od) { act(() => write('onboarding.dismiss', { product: od.getAttribute('data-onboard-dismiss') })); return; }
  const tr = t.closest('[data-try]');
  if (tr) { const folder = tr.getAttribute('data-try'); act(() => write('preview.open', { folder }), r => { if (r && r.status === 'starting') toast('Starting the app. Open the app shows here when it answers.'); }, 'try:' + folder); return; }
  const ts = t.closest('[data-try-stop]');
  if (ts) { const folder = ts.getAttribute('data-try-stop'); act(() => write('preview.stop', { folder }), () => toast('Stopping the app.'), 'try:' + folder); return; }
  const pub = t.closest('[data-publish]');
  if (pub) {
    const folder = pub.getAttribute('data-publish');
    const it = itemForFolder(folder);
    if (!it) return;
    confirmOutside({ system: 'git', title: `Publish ${it.id ? '#' + it.id + ' ' : ''}${it.title || folder}?`, body: 'Pushes each branch to its remote (never force), then opens the PR pages with the text filled in.', items: publishItems(it), ok: 'Publish' }).then(ok => {
      if (!ok) return;
      act(() => write('publish', { folder }), r => { openPrs(r); toast('Published. Create each PR on the page that opened.'); }, 'pub:' + folder);
    });
    return;
  }
  if (t.closest('[data-publish-all]')) {
    const list = ((S.D && S.D.items) || []).filter(readyClean);
    if (!list.length) return;
    confirmOutside({ system: 'git', title: `Publish ${list.length} ready build${list.length === 1 ? '' : 's'}?`, body: 'Each has passing checks and no review questions. Pushes every branch (never force), then opens the PR pages.', items: list.map(it => (it.id ? '#' + it.id + ' ' : '') + (it.title || it.folder)), ok: 'Publish all' }).then(ok => {
      if (!ok) return;
      // Builds with draft code review comments in this browser stay out (connector 1.27.0 `skip`).
      const skip = ((S.D && S.D.items) || []).filter(it => it.kind === 'item' && hasDrafts(it)).map(it => it.folder);
      act(() => write('publish.all', skip.length ? { skip } : {}), r => {
        for (const p of (r && r.published) || []) openPrs(p);
        toast(r && r.failed && r.failed.length ? `Published ${r.published.length}; ${r.failed.length} did not go through: ${r.failed.map(f => f.message).join(' ')}` : `Published ${(r && r.published.length) || 0}.`, !!(r && r.failed && r.failed.length));
      }, 'pub:all');
    });
    return;
  }
  const shot = t.closest('[data-ui-shot]');
  if (shot) {
    const k = shot.getAttribute('data-ui-shot');
    const key = 'shot:' + k;
    ui().open[key] = !ui().open[key];
    paint();
    if (ui().open[key]) {
      const [folder, file] = k.split('|');
      const want = [file, shot.getAttribute('data-ui-before'), shot.getAttribute('data-ui-diff')].filter(Boolean);
      ui().shots = ui().shots || {};
      for (const f of want) {
        if (ui().shots[folder + '|' + f]) continue;
        read('ui.image', { folder, file: f }).then(r => { ui().shots[folder + '|' + f] = r.dataUrl; paint(); }).catch(() => {});
      }
    }
    return;
  }
  const after = t.closest('[data-auto-after]');
  if (after) {
    const folder = after.getAttribute('data-auto-after');
    act(() => write('autopilot', { folder, action: 'approve-start', after: after.getAttribute('data-after') }), () => toast('Approved. It builds once the other one has its PR text.'), 'a:' + folder);
    return;
  }
  // Work items as the source (Loom 6.3.0): link, unlink, create in ADO, and the one-time notice.
  const keep = t.closest('[data-drop-keep]');
  if (keep) { ui().dropKeep = !!keep.checked; return; }
  if (t.closest('[data-ado-notice]')) { act(() => read('ado.notice.seen', {}), null); return; }
  const linkT = t.closest('[data-ado-link-toggle]');
  if (linkT) { const k = 'adolink:' + linkT.getAttribute('data-ado-link-toggle'); ui().open[k] = !ui().open[k]; paint(); return; }
  const linkB = t.closest('[data-ado-link]');
  if (linkB) {
    const folder = linkB.getAttribute('data-ado-link');
    const ado = (ui().drafts['adolink:' + folder] || linkB.getAttribute('data-was') || '').trim();
    if (!ado) { toast('Type the ADO work item number.', true); return; }
    act(() => write('item.link', { folder, ado }), () => { delete ui().open['adolink:' + folder]; toast('Linked to ADO #' + ado.replace(/^#|^AB#/i, '')); }, 'link:' + folder);
    return;
  }
  const unl = t.closest('[data-ado-unlink]');
  if (unl) {
    const folder = unl.getAttribute('data-ado-unlink');
    act(() => write('item.unlink', { folder }), () => toast('Unlinked. Nothing goes to ADO for it now.'), 'link:' + folder);
    return;
  }
  const cre = t.closest('[data-ado-create]');
  if (cre) {
    const folder = cre.getAttribute('data-ado-create');
    const it = itemForFolder(folder);
    if (!it) return;
    const type = it.lane === 'bug' ? 'Bug' : 'User Story';
    confirmOutside({ system: 'ado', title: `Create a ${type} in ADO for ${it.title || folder}?`, body: 'Creates one work item with this title, then links this build to it. Nothing else is sent.', items: [`${type}: ${it.title || folder}`], ok: 'Create and link' }).then(ok => {
      if (!ok) return;
      act(async () => {
        const made = await ws.connectors.call('ado', 'workitem.create', { type, title: String(it.title || folder).slice(0, 255), fields: { description: `From Workshop work item ${it.id || folder}.` } }, { confirm: true });
        return write('item.link', { folder, ado: String(made.id) });
      }, r => toast('Created and linked: ADO #' + (r && r.ado)), 'link:' + folder);
    });
    return;
  }
  if (t.closest('[data-lane-done]')) { ui().laneDone = !ui().laneDone; paint(); return; }
  if (t.closest('[data-lane-delivered]')) { ui().laneDelivered = !ui().laneDelivered; paint(); return; }
  // After Publish (connector 1.27.0): push the fix Tandem committed, after the git confirm.
  const pf = t.closest('[data-push-fix]');
  if (pf) {
    const folder = pf.getAttribute('data-push-fix'), repo = pf.getAttribute('data-repo');
    const it = itemForFolder(folder);
    const row = it && (it.pr || []).find(r => r.repo === repo);
    confirmOutside({ system: 'git', title: `Push Tandem's fix for ${repo}?`, body: 'Pushes the fix commit on top of the published branch (never force). CI runs again on the PR.', items: [`${repo}: ${(row && row.branch) || '?'}`], ok: 'Push' }).then(ok => {
      if (!ok) return;
      act(() => write('push', { folder, repo }), () => toast('Pushed. CI runs again on the PR.'), 'pushfix:' + folder + ':' + repo);
    });
    return;
  }
  // Merged and linked to ADO: set the ADO item to Resolved (your team: merged to main, slated for a release).
  const rs = t.closest('[data-ado-resolve]');
  if (rs) {
    const folder = rs.getAttribute('data-ado-resolve'), id = Number(rs.getAttribute('data-ado'));
    confirmOutside({ system: 'ado', title: `Resolve ADO #${id}?`, body: 'Sets the ADO work item to Resolved: merged to main and slated for a release.', items: [`#${id}: Resolved`], ok: 'Resolve' }).then(ok => {
      if (!ok) return;
      act(async () => {
        const w = await ws.connectors.call('ado', 'workitem.get', { id });
        return ws.connectors.call('ado', 'workitem.update', { id, rev: w.rev, changes: { state: 'Resolved' } }, { confirm: true });
      }, () => { ui().resolved = { ...(ui().resolved || {}), [folder]: true }; toast(`ADO #${id} is Resolved.`); }, 'resolve:' + folder);
    });
    return;
  }
  if (t.closest('[data-ado-toggle]')) { ui().dropPick = !ui().dropPick; paint(); if (ui().dropPick) focusFirst('#ln-adoq'); return; }
  const adoPick = t.closest('[data-ado-pick]');
  if (adoPick) {
    // From ADO: the item fills the drop box (number and title) and picks its kind; Start runs it.
    const it = pickable().find(x => x.id === adoPick.getAttribute('data-ado-pick'));
    if (it) {
      ui().drafts['lanes:drop'] = `#${it.id} ${it.title}`;
      ui().dropAdo = { id: it.id, type: it.type };
      ui().dropKind = kindOfAdoType(it.type); ui().dropGuess = ui().dropKind;
      ui().dropPick = false; delete ui().drafts['lanes:adoq'];
      paint(); focusFirst('#ln-drop');
    }
    return;
  }
  const orun = t.closest('[data-open-run]');
  if (orun) { openRun(orun.getAttribute('data-open-run')); return; }
  const stp = t.closest('[data-step]');
  if (stp && ui().run) { ui().step[ui().run] = stp.getAttribute('data-step'); paint(); return; }
  const wk = t.closest('[data-walk]');
  if (wk) { walk(wk.getAttribute('data-walk')); return; }
  const ic = t.closest('[data-inbox-chip]');
  // Loom 6.0.0: the Inbox is gone; its PRs chip is Lanes' Review card.
  if (ic) { if (ic.getAttribute('data-inbox-chip') === 'prs') { loadInbox(false); ui().laneSel = 'reviews'; } setTab('lanes'); return; }
  const pk = t.closest('[data-peek]');
  if (pk) { const k = pk.getAttribute('data-peek'); ui().open[k] = !ui().open[k]; paint(); return; }
  const sbt = t.closest('[data-sb-toggle]');
  if (sbt) { const k = 'sb:' + sbt.getAttribute('data-sb-toggle'); ui().open[k] = !ui().open[k]; paint(); if (ui().open[k]) focusFirst(`[data-draft="${CSS.escape(k)}"]`); return; }
  const sbg = t.closest('[data-sendback]');
  if (sbg) { sendBack(sbg.getAttribute('data-sendback')); return; }
  const dck = t.closest('[data-docs-check]');
  if (dck) {
    const folder = dck.getAttribute('data-docs-check');
    const path = String(ui().drafts['dc:' + folder] || '').trim();
    if (!/^[^\s`'"<>|;&]{1,300}$/.test(path)) { toast('Type the path of the doc to fact-check, like docs/run-locally.md.', true); return; }
    act(() => write('run', { folder, command: '/check-docs ' + path }), () => toast('Fact-checking ' + path + ' in a new session'), folder);
    return;
  }
  const ff = t.closest('[data-filter-flow]');
  if (ff) { ui().flow = ff.getAttribute('data-filter-flow') || 'all'; paint(); return; }
  const bit = t.closest('[data-board-item]');
  if (bit) { setTab('board'); routeBoard('item/' + bit.getAttribute('data-board-item')); return; }
  const oit = t.closest('[data-open-item]');
  if (oit) { openKey(oit.getAttribute('data-open-item')); return; }
  const odoc = t.closest('[data-open-doc]');
  if (odoc) { openRun(odoc.getAttribute('data-open-doc')); return; }
  const ochat = t.closest('[data-open-chat]');
  if (ochat) { openChat('chat/' + ochat.getAttribute('data-open-chat')); return; }
  const crun = t.closest('[data-close-run]');
  if (crun) { setTab(crun.getAttribute('data-close-run')); return; }
  const fp = t.closest('[data-filter-project]');
  if (fp) { setProjectFilter(fp.getAttribute('data-filter-project')); return; }
  if (t.closest('[data-projects-open]')) { closeOverlays(); ui().projects = true; paint(); return; }
  if (t.closest('[data-repos-open]')) { openRepos(); return; }
  const dst = t.closest('[data-doc-start]');
  if (dst) { startFromDoc(dst.getAttribute('data-doc-start'), dst.getAttribute('data-doc-flow') || 'feature'); return; }
  const dnote = t.closest('[data-doc-note]');
  if (dnote) {
    const it = itemForFolder(dnote.getAttribute('data-doc-note')); const d = it && S.files[it.folder + '/findings.md'];
    if (d && d.text) { noteOf(it.title, d.text); if (it.kind === 'spike') act(() => closeSpike(it.folder, closedWith('saved as a note')), null, it.folder); }
    return;
  }
  const sclose = t.closest('[data-spike-close]');
  if (sclose) {
    const f = sclose.getAttribute('data-spike-close');
    const how = sclose.getAttribute('data-close-how') || 'nothing more to do';
    act(() => closeSpike(f, closedWith(how)), () => toast(how === 'nothing more to do' ? 'Closed.' : `Closed: ${how}.`), f);
    return;
  }
  const dfolio = t.closest('[data-docs-folio]');
  if (dfolio) { saveDocToFolio(dfolio.getAttribute('data-docs-folio')); return; }
  if (t.closest('[data-proj-new]')) { openProject(null); return; }
  const pe = t.closest('[data-proj-edit]');
  if (pe) { openProject(pe.getAttribute('data-proj-edit')); return; }
  const pc = t.closest('[data-proj-color]');
  if (pc && ui().project) { ui().project.color = pc.getAttribute('data-proj-color'); paint(); return; }
  if (t.closest('[data-proj-save]')) { saveProject(); return; }
  if (t.closest('[data-proj-delete-ask]') && ui().project) { ui().project.confirmDelete = true; paint(); return; }
  const pdel = t.closest('[data-proj-delete]');
  if (pdel) { deleteProject(pdel.getAttribute('data-proj-delete')); return; }
  const mv = t.closest('[data-move]');
  if (mv) { closeOverlays(); ui().move = { folder: mv.getAttribute('data-move'), busy: false, error: null }; paint(); return; }
  const mvt = t.closest('[data-move-to]');
  if (mvt && ui().move) { moveRun(ui().move.folder, mvt.getAttribute('data-move-to')); return; }

  if (t.closest('[data-settings]')) { ws.open({ app: 'settings' }).catch(() => {}); return; }
  if (t.closest('[data-cfg-open]')) { openSettings(); return; }
  const so = t.closest('[data-start-open]');
  if (so) { openStart(so.getAttribute('data-start-open')); return; }
  if (t.closest('[data-start-go]')) { startGo(); return; }
  const fl = t.closest('[data-flow]');
  if (fl && ui().start) { ui().start.flow = fl.getAttribute('data-flow') || null; ui().start.error = null; paint(); focusFirst(ui().start.flow ? '.start-first' : '.fcard'); return; }
  const ssrc = t.closest('[data-start-src]');
  if (ssrc && ui().start) { ui().start.src = ssrc.getAttribute('data-start-src'); ui().start.error = null; paint(); focusFirst('.start-first'); return; }
  for (const [attr, k] of [['data-start-size', 'size'], ['data-start-type', 'type'], ['data-start-timebox', 'timebox']]) {
    const b = t.closest(`[${attr}]`);
    if (b && ui().start) { ui().start[k] = b.getAttribute(attr); ui().start.error = null; paint(); if (k !== 'timebox') focusFirst('.start-first'); return; }
  }
  if (t.closest('[data-repo-open]')) { openRepo(); return; }
  if (t.closest('[data-repo-go]')) { repoGo(); return; }
  const gb = t.closest('[data-guide]');
  if (gb) { draftGuide(gb.getAttribute('data-guide')); return; }
  if (t.closest('[data-rv-open]')) { openPaste(); return; }
  if (t.closest('[data-rv-go]')) { startReview(ui().drafts['rv:url'] || ''); return; }
  const rvu = t.closest('[data-rv-url]');
  if (rvu) { startReview(rvu.getAttribute('data-rv-url'), rvu.hasAttribute('data-rv-again')); return; }
  if (t.closest('[data-rv-inbox]')) { loadInbox(true); return; }
  if (t.closest('[data-rv-all]')) { reviewAll(); return; }
  const rvq = t.closest('[data-rv-q]');
  if (rvq) { queueAction(rvq.getAttribute('data-rv-q')); return; }
  const dm = t.closest('[data-dismiss]');
  if (dm) { act(() => read('session.dismiss', { session: dm.getAttribute('data-dismiss') })); return; }
  const ac = t.closest('[data-ai-check]');
  if (ac) { act(() => read('refresh'), () => toast('Checked opencode for AI providers.'), 'ai'); return; }
  if (t.closest('[data-cfg-save]')) { saveSettings(); return; }
  if (t.closest('[data-close-sheet]')) { closeOverlays(); paint(); return; }
  const fm = t.closest('[data-file-mode]');
  if (fm && ui().file) { ui().file.mode = fm.getAttribute('data-file-mode'); ui().file.saved = false; paint(); if (ui().file.mode === 'edit') focusFirst('.doc-edit'); return; }
  if (t.closest('[data-file-save]')) { saveFile(); return; }
  if (t.closest('[data-file-revert]') && ui().file) { delete ui().drafts[fileDraftKey(ui().file)]; paint(); return; }
  if (t.closest('[data-file-reload]')) { reloadFile(); return; }
  if (t.closest('[data-file-keep]') && ui().file) { ui().file.confirmClose = false; paint(); return; }
  if (t.closest('[data-file-discard]')) { closeOverlays(true); paint(); return; }
  if (t.closest('[data-open-notebook]') && ui().file) {
    const f = ui().file;
    if (fileDirty(f)) { toast('Save or revert your changes first.', true); return; }
    closeOverlays(true); paint();
    ws.open({ app: 'notes', path: notebookRoute(f.folder, f.name) }).catch(() => toast("Couldn't open Folio.", true));
    return;
  }
  const fb = t.closest('[data-file]');
  if (fb) { openFile(fb.getAttribute('data-file'), fb.getAttribute('data-name'), fb.getAttribute('data-mode')); return; }
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
  if (t.closest('.walk [data-hot="a"]') && t.closest('[data-run], [data-auto]')) walkDone();
  const run = t.closest('[data-run]');
  if (run) {
    const folder = run.getAttribute('data-run'), command = run.getAttribute('data-cmd');
    act(() => write('run', { folder, command }), () => toast('Started ' + command), folder);
    return;
  }
  const ap = t.closest('[data-auto]');
  if (ap) {
    const folder = ap.getAttribute('data-auto'), action = ap.getAttribute('data-act');
    act(() => write('autopilot', { folder, action }), r => { if (/^(start|approve-start|resume)$/.test(action)) toast(r && r.queued ? 'Queued: it starts when a running build finishes' : 'Autopilot started'); }, 'a:' + folder);
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
listen('toggle', ev => {
  const k = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-key');
  if (k) ui().open[k] = ev.target.open;
}, true);
listen('input', ev => {
  const k = ev.target.getAttribute('data-draft');
  if (k) ui().drafts[k] = ev.target.value;
  if (k === 'lanes:adoq') schedule();
  if (k === 'lanes:drop') {
    // The kind picker shows once there is text, preset to the guess; repaint only when that changes.
    if (!ev.target.value.trim()) ui().dropKind = null;
    const g = ev.target.value.trim() ? (ui().dropKind || guessKind(ev.target.value)) : '';
    if (g !== (ui().dropGuess || '')) { ui().dropGuess = g; schedule(); }
  }
  if (k && k.startsWith('file:') && ui().file) {
    const dirty = fileDirty(ui().file), f = ui().file;
    const save = app.querySelector('[data-file-save]'), rev = app.querySelector('[data-file-revert]'), st = app.querySelector('[data-file-state]');
    if (save) save.disabled = !dirty || !!fileLock(f) || f.saving;
    if (rev) rev.hidden = !dirty;
    if (st) st.textContent = dirty ? 'Unsaved changes' : '';
    f.saved = false;
  }
  if (k && k.startsWith('rm:')) {
    const go = app.querySelector('[data-remove-go]');
    if (go) go.disabled = ev.target.value.trim() !== go.getAttribute('data-confirm');
  }
});
listen('change', ev => {
  if (ev.target.hasAttribute('data-lane-kind')) { ui().dropKind = ev.target.value; return; }
  if (ev.target.hasAttribute('data-start-project') && ui().start) { ui().start.project = ev.target.value; return; }
  if (ev.target.hasAttribute('data-proj-folder') && ui().project) { ui().project.folder = ev.target.value; return; }
  if (ev.target.hasAttribute('data-repo-cat')) {
    ui().drafts['repo:category'] = ev.target.value;
    if (ui().repo) ui().repo.error = null;
    paint();
    if (ev.target.value === NEW_CATEGORY) focusFirst('.repo-newcat');
    return;
  }
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
  const overlay = ui().menu || ui().remove || ui().file || ui().settings || ui().start || ui().repo || ui().repos || ui().project || ui().projects || ui().move;
  if (ev.key === 'Escape' && overlay) { closeOverlays(); paint(); return; }
  // Go through them: keys for the row in view, unless you are typing.
  if (!ui().walk || overlay || ui().tab !== 'inbox' || ui().run || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const tg = ev.target;
  if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
  const k = ev.key.toLowerCase();
  const press = key => { const b = app.querySelector(`.walk [data-hot="${key}"]`); if (b && !b.disabled) { ev.preventDefault(); b.click(); } };
  if (ev.key === 'Escape') { ev.preventDefault(); walk('stop'); }
  else if (k === 'n' || ev.key === 'ArrowRight') { ev.preventDefault(); walk('next'); }
  else if (k === 'p' || ev.key === 'ArrowLeft') { ev.preventDefault(); walk('prev'); }
  else if (k === 'a') press('a');
  else if (k === 's') press('s');
  else if (k === 'o') press('o');
});
listen('keydown', ev => {
  const dk = ev.target.getAttribute && ev.target.getAttribute('data-draft');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && dk && dk.startsWith('file:')) { ev.preventDefault(); saveFile(); return; }
  if (ev.key === 'Enter' && dk && dk.startsWith('cfg:')) { ev.preventDefault(); saveSettings(); return; }
  if (ev.key === 'Enter' && !ev.shiftKey && dk === 'lanes:drop') { ev.preventDefault(); dropGo(); return; }
  if (ev.key === 'Enter' && (dk === 'start:id' || dk === 'start:title' || dk === 'start:target')) { ev.preventDefault(); startGo(); return; }
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && dk && dk.startsWith('sb:')) { ev.preventDefault(); sendBack(dk.slice(3)); return; }
  if (ev.key === 'Enter' && dk && dk.startsWith('dc:')) { ev.preventDefault(); const b = app.querySelector(`[data-docs-check="${CSS.escape(dk.slice(3))}"]`); if (b) b.click(); return; }
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && dk && dk.startsWith('start:')) { ev.preventDefault(); startGo(); return; }
  if (ev.key === 'Enter' && dk && dk.startsWith('repo:')) { ev.preventDefault(); repoGo(); return; }
  if (ev.key === 'Enter' && dk === 'rv:url') { ev.preventDefault(); startReview(ev.target.value); return; }
  if (ev.key === 'Enter' && (dk === 'proj:name' || dk === 'proj:baseBranch')) { ev.preventDefault(); saveProject(); return; }
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
ws.commands.register({ id: 'pr-review', title: 'Review a pull request' });
ws.on('command', ({ id }) => {
  if (id === 'refresh') act(() => read('refresh'));
  // Loom 6.0.0: Start work is the drop box.
  if (id === 'start') { setTab('lanes'); focusFirst('#ln-drop'); }
  if (id === 'repo' && S.connector && S.connector.state === 'ready') openRepo();
  if (id === 'project' && S.D && S.D.projects) openProject(null);
  if (id === 'pr-review' && S.connector && S.connector.state === 'ready') { setTab('reviews'); openPaste(); }
});

/* ---------- start ---------- */
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSoon(); });
setInterval(() => { if (!document.hidden) schedule(); }, 30000); // keep "x min ago" fresh
schedule();
await loadStatus();
await fetchState();
loadInbox(false); // for the sidebar count; never blocks the page

// Test hook (tests/e2e.py): the state the page draws from.
window.__agents = { S, refetch: fetchState };

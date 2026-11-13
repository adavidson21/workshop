/* Agents: the eng-agents live dashboard as a Workshop app. Everything goes through the SDK:
   - data: the opencode connector's `state` action, fetched again after its small events
     (model, live, autopilot, agent.waiting, agent.done) and its status changes;
   - buttons: the connector's actions. Write actions send confirm: true, only from the click that
     says what will happen (docs/sdk.md, Connectors);
   - shell: routes (#/agents/<id> focuses an item), the rail badge (open prompts), toasts and
     notifications. The theme comes from shared/theme.js and the SDK, with no messages of our own.
   view.js builds the HTML; this file paints it and handles input. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { S } from './state.js';
import { render, prompts, itemForFolder, itemKey, isBusy, dayKey, fileDirty, fileDraft, fileDraftKey, fileLock, guideDefaults, GUIDE_STEPS, cfgBuild, startRequest, repoUrlCheck, repoCategoryCheck, NEW_CATEGORY } from './view.js';
import { INBOX, projectById, projectArgs, startProject } from './projects.js';
import { TAB_IDS, OLD_TABS, inboxCount, sessionAsksHtml, wantedFiles, walkList } from './pages.js';
import { FLOW_IDS, addOpenQuestion, sendBackCommand, gateFile } from './flows.js';
import { reviewUrlCheck, reviewAllList, prArg } from './pr-reviews.js';
import { startHub } from './hub.js';
import { startChat } from './chat.js';
import { slateLinks, summaryCards } from './summary.js';
import { sendWork, workOffer } from './slate-handoff.js';
import { useApps } from '../../../shared/capture.js';
import { loadView, saveView, pruneView } from './local.js';
import { notebookRoute } from './doc.js';
import { digestCard, digestHtml } from './digest.js';
import { createHolder, heldFor, lastEndedFocusSpan, watchFocus, dateStr, toMin } from '../../../shared/focus.js';
import { readCards } from '../../../shared/summary.js';

const OC = 'opencode';
const app = document.getElementById('app');
const ws = await connect({ app: 'agents' });
S.mode = ws.mode;
S.embedded = ws.embedded;
S.canNotify = typeof window.Notification === 'function';
// Focus hours: set up below (see focus hours and the afternoon digest), declared here so nothing reads them early.
let holder = null;
let digestBase = { span: null, held: [], spanMs: null };
document.documentElement.classList.toggle('embed', ws.embedded);
// On its own page: the same top bar as the other tools (crumbs and the light/dark toggle).
if (!ws.embedded) mountBar('Dispatch');

/* ---------- the hub (hub.js) and the Chat tab (chat.js) ----------
   The hub is drawn once into #hub; chat.js keeps it in its New chat pane, and before Dispatch is connected
   paint() moves it under the setup page (#hub-slot), so captures always work. A hub message that is not a
   capture or go becomes a chat: chat.opened lists it and opens it. */
// Capture targets and places follow the apps on this site (their manifests, ws.apps.list()), without holding up the page.
ws.apps.list().then(list => { useApps(list); S.hasNotes = list.some(a => a.id === 'notes'); schedule(); }).catch(() => {});
let chat = null;
const hubEl = document.getElementById('hub');
const hub = startHub(ws, hubEl, {
  onThread: card => { if (chat) chat.opened(card); },
  onChange: () => { if (chat) chat.redraw(); },
  onStatus: () => { if (chat) chat.refresh(); },
  asksHtml: sid => sessionAsksHtml(sid)
});
chat = startChat(ws, { hub, hubEl, asksHtml: sid => sessionAsksHtml(sid), noteOf: (t, a) => hub.noteOf(t, a), aiReady: () => hub.status() });
chat.mountHub();

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
    const cards = summaryCards({ items: (S.D && S.D.items) || [], prompts: prompts(), prs: S.inbox.items || [], now: Date.now() });
    const held = holder && holder.card();
    if (held) cards.push(Object.assign({ updatedAt: Date.now() }, held));
    const key = JSON.stringify(cards.map(c => ({ ...c, updatedAt: 0 })));
    if (key === summaryKey) return;
    try {
      const before = (await ws.data.get('summary')) || { schema: 'agents.summary', version: 1, rev: 0, items: [], deleted: {} };
      if (before.schema !== 'agents.summary' || before.version !== 1) return;
      const after = ws.data.stamp(before, { ...structuredClone(before), items: cards });
      try { await ws.data.put('summary', after); }
      catch (e) { if (e.code === 'conflict' && e.current) await ws.data.put('summary', { ...ws.data.merge(after, e.current), items: cards }); else throw e; }
      summaryKey = key;
    } catch (e) { /* the next change tries again */ }
  }, 500);
}
async function loadSlate() {
  try { S.slate = slateLinks(await ws.data.get('summary', { app: 'slate' })); schedule(); } catch (e) { /* no Slate here */ }
}
loadSlate();
try { ws.data.subscribe('summary', loadSlate, { app: 'slate' }); } catch (e) { /* no data backend */ }

/* ---------- PRs waiting on you: the ADO connector's sync.prs (read-only) ----------
   Checked once when Dispatch connects, when the PR reviews page opens (if older than five minutes),
   and from Check again. Without the ADO connector (or with it off) the page says how to turn it on. */
const ADO = 'ado';
const INBOX_FRESH_MS = 5 * 60e3;
async function loadInbox(force) {
  if (ws.backend !== 'agent' || S.inbox.state === 'loading') return;
  if (!force && S.inbox.at && Date.now() - S.inbox.at < INBOX_FRESH_MS) return;
  let c = null;
  try { c = (await ws.connectors.list()).find(x => x.id === ADO) || null; } catch (e) { /* the agent is not reachable: try again later */ return; }
  if (!c || !c.status || c.status.state !== 'ready') { S.inbox = { state: 'off', items: [], notes: [], error: null, at: Date.now() }; schedule(); return; }
  S.inbox = { ...S.inbox, state: 'loading' }; schedule();
  try {
    const r = await ws.connectors.call(ADO, 'sync.prs', { knownPrs: [] });
    S.inbox = { state: 'ok', items: (r && r.items) || [], notes: (r && r.notes) || [], error: null, at: Date.now() };
    saveInbox();
    updateBadge();
    publishSummary();
  } catch (e) {
    S.inbox = { state: 'error', items: [], notes: [], error: errText(e), at: Date.now() };
  }
  schedule();
}
ws.connectors.onStatus(ADO, status => { if (status.state === 'ready' && S.inbox.state === 'off') loadInbox(true); });

/* The nightly review (opencode connector) cannot ask ADO itself: hand it the inbox each time we get it. */
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
    toast(n ? `Queued ${n} review${n === 1 ? '' : 's'}. They run one at a time, even with Dispatch closed.${skipped ? ` ${skipped} skipped.` : ''}` : 'Nothing new to review.');
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
    hub.redraw();
    chat.redraw();
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
  if (key !== S.badgeKey) { S.badgeKey = key; ws.badge(count || null, { breakThrough: bt }).catch(() => {}); }
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
   Dispatch's `held` summary card. After a focus span ends, "While you were focused" sits on top of the Inbox. */
const DIGEST_KEY = 'workshop.dispatch.digestDismissed';
const focusWatch = watchFocus(ws, f => { if (holder) holder.sync(f); updateBadge(); refreshDigest(); schedule(); });
holder = createHolder(ws, { watch: focusWatch, label: n => `${n} Dispatch update${n === 1 ? '' : 's'} waiting`, route: 'inbox', onChange: () => publishSummary() });
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
   #/agents/<tab> opens a tab (inbox, chat, work, reviews; Dispatch 2.x's runs, ship and research open Work);
   #/agents/work/<id> a run's page (also runs/, ship/ and research/<folder>, from 2.x); #/agents/chat/<session> a
   conversation; #/agents/hub/<text> asks the hub (from Home's quick capture, where Enter was pressed).
   #/agents/<id> (Dispatch 1.x, notifications, Home and Docket's links) opens whatever that is: a run's page, or a
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
  else openRun(it.folder, 'work');
  return true;
}
let keyWanted = null;
function wantFocus(path) {
  const p = String(path || '');
  if (/^hub(\/|$)/.test(p)) { const text = p.replace(/^hub\/?/, '').trim(); setTab('chat'); chat.open(null); if (text) hub.ask(text); else hub.focus(); return; }
  if (/^chat(\/|$)/.test(p)) { const sid = p.replace(/^chat\/?/, '').trim(); setTab('chat'); chat.open(sid || null); return; }
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
// Opened on its own, the hash is #<route> (the shell strips its own part before sending the route). Inside the shell
// the frame's own hash is set only by Back to Dispatch on the code review (review.html), which returns to the run.
if (location.hash.length > 1) wantFocus(decodeURIComponent(location.hash.slice(1)));

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
  const inChat = chat.el.contains(a) || hubEl.contains(a) ? a : null;
  const chatSel = inChat && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  app.innerHTML = html;
  lastHtml = html; lastFirst = app.firstChild;
  // The Chat tab is its own element (chat.js), moved in rather than redrawn, so typing survives. The hub lives in
  // it, except before Dispatch is connected, when it sits under the setup page.
  const slot = app.querySelector('#chat-slot');
  const hubSlot = app.querySelector('#hub-slot');
  if (slot) slot.replaceWith(chat.el);
  if (hubSlot) hubSlot.replaceWith(hubEl); else chat.mountHub();
  chat.show(!!slot);
  if (inChat && inChat.isConnected) { inChat.focus(); if (chatSel) try { inChat.setSelectionRange(chatSel[0], chatSel[1]); } catch (e) { /* not a text field */ } }
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
const LEGACY_START = { describe: 'quick', spike: 'spike', ado: 'feature' };
let lastLane = 'feature';
/** Opens Start work: on the flow picker, or on one flow's form (a flow id, or Dispatch 2.x's describe, ado, spike). */
function openStart(flow) {
  closeOverlays();
  const f = FLOW_IDS.includes(flow) ? flow : LEGACY_START[flow] || null;
  ui().start = { flow: f, src: null, lane: lastLane, project: startProject(), busy: false, error: null };
  paint();
  focusFirst(f ? '.start-first' : '.fcard');
}
const STARTED = {
  spike: () => 'Investigating. It is under Starting on Work until its folder exists.',
  'scope.start': () => 'Scoping the idea. Tandem may ask you a few questions; they show in the Inbox.',
  'docs.start': () => 'Drafting the doc. Tandem asks where it lives and who reads it; the questions show in the Inbox.',
  'tsd.start': () => 'Drafting the technical spec. Tandem asks you to confirm the repos and pick the flows; the questions show in the Inbox.'
};
// The click on Start is the approval for this write action.
async function startGo() {
  const st = ui().start;
  if (!st || st.busy) return;
  const r = startRequest(st, ui().drafts);
  if (r.error) { st.error = r.error; paint(); return; }
  st.busy = true; st.error = null; paint();
  try {
    const res = await write(r.action, r.args);
    // Slate tracks every run from start to resolved: tell it about this one (Start was the person's click).
    try { await sendWork(ws, workOffer({ action: r.action, args: r.args, res, from: st.from })); } catch (e) { /* Slate is optional */ }
    for (const k of Object.keys(ui().drafts)) if (k.startsWith('start:')) delete ui().drafts[k];
    if (st.flow === 'quick') lastLane = st.lane;
    closeOverlays();
    const pname = r.args.project ? ' in ' + ((projectById(r.args.project) || {}).name || 'the project') : '';
    toast(STARTED[r.action] ? STARTED[r.action]()
      : r.action === 'start.local' ? `Started ${(res && res.id) || 'it'} as a ${r.args.lane}${pname}. It is on Work; the agent may ask you to confirm repos.`
      : `Starting #${r.args.id} as a ${r.args.lane}${pname}. It shows up on Work when its folder is ready.`);
    setTab('work');
  } catch (e) {
    if (ui().start) { ui().start.busy = false; ui().start.error = errText(e); }
  }
  fetchSoon();
  schedule();
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
// Start work from a Research folder: Describe it, filled in from the findings. Nothing starts until Start.
function startFromDoc(folder) {
  const it = itemForFolder(folder);
  if (!it) return;
  const d = S.files[it.folder + '/findings.md'];
  ui().drafts['start:title'] = String(it.title || '').slice(0, 200);
  ui().drafts['start:desc'] = [it.summary || '', d && d.text ? `From .work/${it.folder}/findings.md:\n\n${d.text}` : `See .work/${it.folder}.`].filter(Boolean).join('\n\n').slice(0, 8000);
  openStart('quick');
  if (ui().start) ui().start.from = it.folder;
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
  tab = OLD_TABS[tab] || tab;
  if (!TAB_IDS.includes(tab)) tab = 'inbox';
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
  const back = from || (ui().tab === 'inbox' ? 'inbox' : 'work');
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

app.addEventListener('change', ev => {
  const pi = ev.target.closest && ev.target.closest('[data-gport]');
  if (!pi) return;
  const n = Math.round(+pi.value);
  if (n >= 1024 && n <= 65535) { S.setup.port = n; S.setup.check = null; saveGuide(); schedule(); }
});
app.addEventListener('click', ev => {
  const dd = ev.target.closest('[data-digest-dismiss]');
  if (dd) { try { localStorage.setItem(DIGEST_KEY, dateStr(new Date())); } catch (e) { /* this page only */ } schedule(); return; }
  const dg = ev.target.closest('[data-digest-app]');
  if (dg) { if (dg.dataset.digestApp === 'agents') ws.open({ app: 'agents', path: dg.dataset.digestRoute || '' }); else ws.open({ app: dg.dataset.digestApp, path: dg.dataset.digestRoute || '' }); return; }
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
  const orun = t.closest('[data-open-run]');
  if (orun) { openRun(orun.getAttribute('data-open-run')); return; }
  const stp = t.closest('[data-step]');
  if (stp && ui().run) { ui().step[ui().run] = stp.getAttribute('data-step'); paint(); return; }
  const wk = t.closest('[data-walk]');
  if (wk) { walk(wk.getAttribute('data-walk')); return; }
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
  const oit = t.closest('[data-open-item]');
  if (oit) { openKey(oit.getAttribute('data-open-item')); return; }
  const odoc = t.closest('[data-open-doc]');
  if (odoc) { openRun(odoc.getAttribute('data-open-doc')); return; }
  const ochat = t.closest('[data-open-chat]');
  if (ochat) { setTab('chat'); chat.open(ochat.getAttribute('data-open-chat')); return; }
  const crun = t.closest('[data-close-run]');
  if (crun) { setTab(crun.getAttribute('data-close-run')); return; }
  const fp = t.closest('[data-filter-project]');
  if (fp) { setProjectFilter(fp.getAttribute('data-filter-project')); return; }
  if (t.closest('[data-projects-open]')) { closeOverlays(); ui().projects = true; paint(); return; }
  if (t.closest('[data-repos-open]')) { openRepos(); return; }
  const dst = t.closest('[data-doc-start]');
  if (dst) { startFromDoc(dst.getAttribute('data-doc-start')); return; }
  const dnote = t.closest('[data-doc-note]');
  if (dnote) { const it = itemForFolder(dnote.getAttribute('data-doc-note')); const d = it && S.files[it.folder + '/findings.md']; if (d && d.text) hub.noteOf(it.title, d.text); return; }
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
  const sl = t.closest('[data-start-lane]');
  if (sl && ui().start) { ui().start.lane = sl.getAttribute('data-start-lane'); ui().start.error = null; paint(); return; }
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
app.addEventListener('change', ev => {
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
app.addEventListener('keydown', ev => {
  const dk = ev.target.getAttribute && ev.target.getAttribute('data-draft');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && dk && dk.startsWith('file:')) { ev.preventDefault(); saveFile(); return; }
  if (ev.key === 'Enter' && dk && dk.startsWith('cfg:')) { ev.preventDefault(); saveSettings(); return; }
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
  if (id === 'start' && S.connector && S.connector.state === 'ready') openStart();
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

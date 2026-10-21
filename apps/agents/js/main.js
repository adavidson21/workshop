/* Agents: the eng-agents live dashboard as a Workshop app. Everything goes through the SDK:
   - data: the opencode connector's `state` action, fetched again after its small events
     (model, live, autopilot, agent.waiting, agent.done) and its status changes;
   - buttons: the connector's actions. Write actions send confirm: true, only from the click that
     says what will happen (docs/sdk.md, Connectors);
   - shell: routes (#/agents/<id> focuses an item), the rail badge (open prompts), toasts and
     notifications. The theme comes from shared/theme.js and the SDK, with no messages of our own.
   view.js builds the HTML; this file paints it and handles input. */
import { connect } from '../../../shared/workshop-sdk.js';
import { S } from './state.js';
import { render, prompts, itemForFolder, itemKey, isBusy, dayKey } from './view.js';

const OC = 'opencode';
const app = document.getElementById('app');
const ws = await connect({ app: 'agents' });
S.mode = ws.mode;
S.embedded = ws.embedded;
S.canNotify = typeof window.Notification === 'function';
document.documentElement.classList.toggle('embed', ws.embedded);

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
  // The page may not have the item yet: keep trying for a while as data arrives.
  focusWanted = focusItem(id) ? null : { id, until: Date.now() + 15000 };
}
ws.on('route', p => wantFocus(p.path));
// Opened on its own: the hash is #<id> (the shell strips its own part before sending the route).
if (!ws.embedded && location.hash.length > 1) wantFocus(decodeURIComponent(location.hash.slice(1)));

/* ---------- painting ---------- */
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
  app.innerHTML = html;
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
function closeOverlays() { ui().menu = null; ui().remove = null; ui().file = null; }

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

app.addEventListener('click', ev => {
  const t = ev.target;
  if (!t.closest) return;
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

  if (t.closest('[data-settings]')) { ws.open({ app: 'settings' }).catch(() => {}); return; }
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
  const id = ev.target.getAttribute('data-qpick');
  if (!id) return;
  const i = +ev.target.getAttribute('data-qi');
  const p = ui().picks[id] = ui().picks[id] || {};
  const form = ev.target.closest('[data-qform]');
  p[i] = [...form.querySelectorAll(`input[name="${CSS.escape(ev.target.name)}"]:checked`)].map(x => x.value);
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (ui().menu || ui().remove || ui().file) { closeOverlays(); paint(); }
});
app.addEventListener('keydown', ev => {
  const dk = ev.target.getAttribute && ev.target.getAttribute('data-draft');
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
ws.on('command', ({ id }) => { if (id === 'refresh') act(() => read('refresh')); });

/* ---------- start ---------- */
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSoon(); });
setInterval(() => { if (!document.hidden) schedule(); }, 30000); // keep "x min ago" fresh
schedule();
await loadStatus();
await fetchState();

// Test hook (tests/e2e.py): the state the page draws from.
window.__agents = { S, refetch: fetchState };

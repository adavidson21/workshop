/* Home, the Needs you panel (app.json panel: true, Home 4.0.0): opened from the top bar on every app. What needs
   you across apps, what is coming up, what you finished this week, and Get started. Reads other apps through their
   summaries and the opencode connector, read only; keeps its own setup collection (home.setup v1). data.js loads,
   view.js builds the HTML, this file owns the page. */
import { connect } from '../../../shared/workshop-sdk.js';
import { createHome } from './data.js';
import { ICON, esc, heldInbox, render, statusDraft } from './view.js';
import { card as setupCard, createSetup, strip as setupStrip } from './setup.js';
import { watchFocus } from '../../../shared/focus.js';

const app = document.getElementById('app');
const ws = await connect({ app: 'home' });
document.documentElement.classList.toggle('embed', ws.embedded);

let visible = false;
const home = createHome(ws, { onChange: () => paint() });
const v = home.v;

/* ---------- Get started checklist (setup.js) ---------- */
const setup = createSetup(ws, { onChange: () => paint(), extra: () => ({ name: v.profile.name, tasks: v.board ? v.board.total : null }) });
// setupOpen: null follows the saved state (open until set up, unless you folded it); true or false for this window.
let openStep = null, copies = [], setupOpen = null, showDone = false;
const platform = (() => { const p = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''); return /win/i.test(p) ? 'win' : /mac/i.test(p) ? 'mac' : 'linux'; })();
// Where connector settings can be changed: in Workshop when this page is Workshop on this computer
// (ws.mode local), otherwise on that page, at the address this site paired with (Settings is read only here).
function settingsTarget() {
  if (ws.mode === 'local') return { inShell: true };
  try { const p = JSON.parse(localStorage.getItem('workshop.agent') || 'null'); if (p && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(p.url)) return { href: p.url + '/apps/settings/' }; } catch (e) { /* not paired */ }
  return null;
}
// Three forms: hidden (Get started in the header's More menu brings it back), one line under the greeting (the
// default: the next step and n of total), or the full card while you work through it (per window).
// The setup checklist's markup and where it goes: into the hello tools (hidden) or after the hello.
function setupPart() {
  if (home.waiting || !setup.s.loaded) return null;
  const view = setup.view();
  if (setup.s.hidden) {
    const label = view.complete ? 'Get started' : `Get started · ${view.finished} of ${view.total}`;
    return { into: 'menu', html: `<button class="mi${view.complete ? '' : ' acc'}" role="menuitem" data-setup-show>${ICON.ring}${esc(label)}</button>`, copies: [] };
  }
  const open = setupOpen !== null ? setupOpen : !(view.complete || setup.s.folded);
  if (!open) return { into: 'after', html: setupStrip(view), copies: [] };
  const out = setupCard(view, openStep, { facts: { ...setup.s.facts, name: v.profile.name }, platform, origin: location.origin, settings: settingsTarget(), showDone, machine: setup.s.machine });
  return { into: 'after', html: out.html, copies: out.copies };
}
function placeSetup(part) {
  copies = [];
  const hello = app.querySelector('.hello');
  if (!hello || !part) return;
  if (part.into === 'menu') { const menu = hello.querySelector('.hmenu'); if (menu) menu.insertAdjacentHTML('beforeend', part.html); return; }
  copies = part.copies;
  hello.insertAdjacentHTML('afterend', part.html);
}

// Sections that fade in. They play once: a section already on screen keeps still through repaints
// (a repaint comes with every agent event and once a minute).
const ENTERS = ['.hello', '.setup', '.su-strip', '.cols', '.card.note'];
let lastKey = null, lastFirst = null;
function paint() {
  const html = render(v);
  const part = setupPart();
  // Skip a repaint that would draw the same thing: rebuilding the page under the pointer drops and
  // re-applies :hover, which flickers (most repaints come from agent events and the minute timer).
  const key = html + '\u0000' + (part ? part.into + part.html : '');
  if (key === lastKey && app.firstChild === lastFirst && app.firstChild) return;
  const had = ENTERS.map(q => !!app.querySelector(q));
  app.innerHTML = html;
  placeSetup(part);
  lastKey = key; lastFirst = app.firstChild;
  ENTERS.forEach((q, i) => { if (had[i]) app.querySelectorAll(q).forEach(el => el.classList.add('still')); });
  badge();
}
// The count on the top bar button: what Needs you shows (during focus, only the blocking pull requests break
// through; the shell hides the rest of the count, docs/focus.md).
let lastBadge = null;
function badge() {
  if (home.waiting) return;
  const all = heldInbox(v.inbox || [], null, v.blocking || []).rows.length;
  const key = all + '/' + (v.blocking || []).length;
  if (key === lastBadge) return;
  lastBadge = key;
  ws.badge(all, { breakThrough: (v.blocking || []).length }).catch(() => {});
}

// Changes from other windows. Nothing to read while Home waits for the folder; Allow reloads everything.
const later = (fn, ms) => { let t = null; return () => { if (home.waiting) return; clearTimeout(t); t = setTimeout(fn, ms); }; };
const boardLater = later(home.loadBoard, 150);
ws.data.subscribe('summary', boardLater, { app: 'prioritizer' });
ws.people.subscribe(() => setupLater());
const OC = 'opencode';
const agentsLater = later(home.loadAgents, 200);
if (ws.backend === 'agent') { ws.connectors.on(OC, '*', agentsLater); ws.connectors.onStatus(OC, agentsLater); }
ws.data.subscribe('profile', () => { if (!home.waiting) home.loadProfile(); });
// Needs you and the week follow every app's summary.
const inboxLater = later(home.loadInbox, 300);
ws.apps.list().then(list => { for (const a of list) if (a.id !== 'home') ws.data.subscribe('summary', inboxLater, { app: a.id }); }).catch(() => {});
// The checklist follows the apps and connectors it checks, so steps tick themselves off.
const setupLater = later(setup.load, 300);
ws.data.subscribe('setup', setupLater);
ws.data.subscribe('summary', setupLater, { app: 'receipts' });
if (ws.backend === 'agent') for (const id of ['ado', 'opencode']) ws.connectors.onStatus(id, setupLater);
ws.on('online', p => { if (p && p.online) setup.load(); });

// Focus hours (docs/focus.md): Needs you holds what can wait during focus and lunch.
watchFocus(ws, f => { v.focus = f; paint(); });

/* ---------- input ---------- */
app.addEventListener('click', e => {
  const t = e.target;
  // The header's More menu closes after a choice, and on a click anywhere else.
  const menu = app.querySelector('details.hmore[open]');
  if (menu && (!t.closest('details.hmore') || t.closest('.mi'))) menu.open = false;
  const open = t.closest('[data-open]');
  if (open) { ws.open(open.dataset.path ? { app: open.dataset.open, path: open.dataset.path } : { app: open.dataset.open }); return; }
  const toggle = t.closest('[data-toggle-step]');
  if (toggle) { const id = toggle.dataset.toggleStep; const shown = openStep === null ? setup.view().current : openStep; openStep = shown === id ? '' : id; paint(); return; }
  const cp = t.closest('[data-copy]');
  if (cp) { copyText(copies[+cp.dataset.copy], cp); return; }
  const saving = fn => fn().catch(() => ws.toast("Couldn't save that. Try again.", { kind: 'error' }));
  if (t.closest('[data-skip]')) { const id = t.closest('[data-skip]').dataset.skip; openStep = null; saving(() => setup.skip(id)); return; }
  if (t.closest('[data-unskip]')) { const id = t.closest('[data-unskip]').dataset.unskip; openStep = id; saving(() => setup.unskip(id)); return; }
  if (t.closest('[data-setup-hide]')) { saving(setup.hide); return; }
  if (t.closest('[data-setup-show]')) { openStep = null; setupOpen = true; saving(setup.show); setup.load(); return; }
  if (t.closest('[data-setup-expand]')) { setupOpen = true; paint(); if (setup.s.folded) saving(() => setup.fold(false)); return; }
  if (t.closest('[data-setup-collapse]')) { setupOpen = false; openStep = null; paint(); saving(() => setup.fold(true)); return; }
  const mach = t.closest('[data-machine]');
  if (mach) { saving(() => setup.setMachine(mach.dataset.machine)); return; }
  if (t.closest('[data-apps-ok]')) { openStep = null; saving(setup.appsOk); return; }
  if (t.closest('[data-setup-done]')) { showDone = !showDone; paint(); return; }
  if (t.closest('[data-setup-check]')) { setup.load().then(() => ws.toast('Checked', { kind: 'success' })); home.loadBoard(); return; }
  if (t.closest('[data-status]')) { openStatus(); }
});
/* The weekly status draft: Markdown from every app's week, in a box to edit, then Copy. Nothing is sent. */
const statusDlg = document.getElementById('status');
function openStatus() {
  const text = statusDraft(v.week || [], { name: v.profile.name, now: new Date() });
  statusDlg.innerHTML = `<div class="sd"><h2>Weekly status</h2><p class="soft">From what you finished in Docket, decided in Slate and shipped with Dispatch this week. Edit it, then copy it into your update.</p>
    <label class="sr" for="statusText">Weekly status</label><textarea id="statusText" spellcheck="true">${esc(text)}</textarea>
    <div class="sd-acts"><button class="btn" data-status-close>Close</button><button class="btn primary" data-status-copy>Copy</button></div></div>`;
  statusDlg.showModal();
}
statusDlg.addEventListener('click', e => {
  if (e.target === statusDlg || e.target.closest('[data-status-close]')) statusDlg.close();
  const c = e.target.closest('[data-status-copy]');
  if (c) copyText(statusDlg.querySelector('textarea').value, c);
});

async function copyText(text, b) {
  if (typeof text !== 'string') return;
  const done = () => { const old = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = old; }, 1400); };
  try { await navigator.clipboard.writeText(text); done(); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { ws.toast("Couldn't copy. Select the text and copy it.", { kind: 'error' }); }
    ta.remove();
  }
}
document.addEventListener('keydown', e => {
  const menu = app.querySelector('details.hmore[open]');
  if (e.key === 'Escape' && menu) { menu.open = false; menu.querySelector('summary').focus(); e.stopPropagation(); }
}, true);

// Fresh rows when the panel opens, and every minute (it loads in the background, so the badge stays current).
const refresh = () => { if (!home.waiting) { home.loadAgents(); home.loadInbox(); if (visible) { home.loadBoard(); setup.load(); } } };
ws.on('visible', p => { visible = !!p.visible; if (visible) refresh(); });
setInterval(refresh, 60000);

paint();
await Promise.all([home.loadAll(), setup.load()]);
// Someone new: open the panel once on this browser, so Get started is seen (Workshop opens on the first app now).
try {
  const view = setup.view();
  if (ws.embedded && !setup.s.hidden && !view.complete && !localStorage.getItem('workshop.home.introduced')) {
    localStorage.setItem('workshop.home.introduced', '1');
    ws.open({ app: 'home' }).catch(() => {});
  }
} catch (e) { /* no storage: skip */ }

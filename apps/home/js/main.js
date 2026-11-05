/* Home: a summary of your day across Workshop, opened by the Workshop logo (app.json home: true).
   Reads Prioritizer's board and the opencode connector
   read-only through the SDK, and keeps one small
   collection of its own: profile (home.profile v1, no items; meta: {name, role}). data.js loads and saves,
   view.js builds the HTML, this file owns the page. */
import { connect } from '../../../shared/workshop-sdk.js';
import { createHome } from './data.js';
import { ICON, hbtn, profileForm, render } from './view.js';
import { card as setupCard, createSetup, strip as setupStrip } from './setup.js';
import { startCapture } from './capture.js';

const app = document.getElementById('app');
const ws = await connect({ app: 'home' });
document.documentElement.classList.toggle('embed', ws.embedded);

/* ---------- quick capture (capture.js), drawn once and never repainted, so typing is never lost ---------- */
const capture = startCapture(ws, document.getElementById('capture'));

let editing = false, visible = true;
const home = createHome(ws, { onChange: () => paint() });
const v = home.v;

/* ---------- Get started checklist (setup.js) ---------- */
const setup = createSetup(ws, { onChange: () => paint(), extra: () => ({ name: v.profile.name, tasks: v.board ? v.board.total : null }) });
let openStep = null, copies = [], setupOpen = false, showDone = false;
const platform = (() => { const p = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''); return /win/i.test(p) ? 'win' : /mac/i.test(p) ? 'mac' : 'linux'; })();
// Where connector settings can be changed: in Workshop when this page is Workshop on this computer
// (ws.mode local), otherwise on that page, at the address this site paired with (Settings is read only here).
function settingsTarget() {
  if (ws.mode === 'local') return { inShell: true };
  try { const p = JSON.parse(localStorage.getItem('workshop.agent') || 'null'); if (p && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(p.url)) return { href: p.url + '/apps/settings/' }; } catch (e) { /* not paired */ }
  return null;
}
// Three forms: hidden (a progress button in the header brings it back), one line under the greeting (the
// default: the next step and n of total), or the full card while you work through it (per window).
function placeSetup() {
  copies = [];
  const hello = app.querySelector('.hello');
  if (!hello || editing || home.waiting || !setup.s.loaded) return;
  const view = setup.view();
  if (setup.s.hidden) {
    const tools = hello.querySelector('.htools');
    const label = view.complete ? 'Get started' : `Get started · ${view.finished} of ${view.total}`;
    if (tools) tools.insertAdjacentHTML('beforeend', hbtn(ICON.ring, label, 'data-setup-show', view.complete ? '' : 'acc'));
    return;
  }
  if (!setupOpen) { hello.insertAdjacentHTML('afterend', setupStrip(view)); return; }
  const out = setupCard(view, openStep, { facts: setup.s.facts, platform, origin: location.origin, settings: settingsTarget(), showDone });
  copies = out.copies;
  hello.insertAdjacentHTML('afterend', out.html);
}

// Sections that fade in. They play once: a section already on screen keeps still through repaints
// (a repaint comes with every agent event and once a minute).
const ENTERS = ['.hello', '.setup', '.su-strip', '.tiles', '.cols', '.card.note'];
function paint() {
  if (home.waiting) editing = false;
  const had = ENTERS.map(q => !!app.querySelector(q));
  app.innerHTML = editing ? profileForm(v.profile) : render(v);
  placeSetup();
  ENTERS.forEach((q, i) => { if (had[i]) app.querySelectorAll(q).forEach(el => el.classList.add('still')); });
  if (editing) { const f = app.querySelector('input[name=name]'); if (f) f.focus(); }
}

// Changes from other windows. Nothing to read while Home waits for the folder; Allow reloads everything.
const later = (fn, ms) => { let t = null; return () => { if (home.waiting) return; clearTimeout(t); t = setTimeout(fn, ms); }; };
const boardLater = later(home.loadBoard, 150);
ws.data.subscribe('summary', boardLater, { app: 'prioritizer' });
ws.people.subscribe(() => { boardLater(); setupLater(); });
const OC = 'opencode';
const agentsLater = later(home.loadAgents, 200);
if (ws.backend === 'agent') { ws.connectors.on(OC, '*', agentsLater); ws.connectors.onStatus(OC, agentsLater); }
ws.data.subscribe('profile', () => { if (!home.waiting) home.loadProfile(); });
// The checklist follows the apps and connectors it checks, so steps tick themselves off.
const setupLater = later(setup.load, 300);
ws.data.subscribe('setup', setupLater);
ws.data.subscribe('summary', setupLater, { app: 'receipts' });
if (ws.backend === 'agent') for (const id of ['ado', 'opencode']) ws.connectors.onStatus(id, setupLater);
ws.on('online', p => { if (p && p.online) setup.load(); });

/* ---------- input ---------- */
app.addEventListener('click', e => {
  const t = e.target;
  const task = t.closest('[data-task]');
  if (task) { ws.open({ app: 'prioritizer', path: 'task/' + task.dataset.task }); return; }
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
  if (t.closest('[data-setup-expand]')) { setupOpen = true; paint(); return; }
  if (t.closest('[data-setup-collapse]')) { setupOpen = false; openStep = null; paint(); return; }
  if (t.closest('[data-setup-done]')) { showDone = !showDone; paint(); return; }
  if (t.closest('[data-setup-check]')) { setup.load().then(() => ws.toast('Checked', { kind: 'success' })); home.loadBoard(); return; }
  if (t.closest('[data-edit-profile]')) { if (!home.waiting) { editing = true; paint(); } return; }
  if (t.closest('[data-cancel]')) { editing = false; paint(); }
});
app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const next = { name: String(f.get('name') || '').trim().slice(0, 80), role: String(f.get('role') || '').trim().slice(0, 80) };
  try { await home.saveProfile(next); editing = false; paint(); }
  catch (err) {
    if (home.waiting) ws.toast('Allow Workshop to use your folder first, then edit your profile.', { kind: 'error' });
    else ws.toast("Couldn't save your profile. Try again.", { kind: 'error' });
  }
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
  if (e.key === 'Escape' && editing) { editing = false; paint(); return; }
  // "/" anywhere on Home (not while typing) jumps to quick capture.
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && !(e.target && e.target.isContentEditable)) { e.preventDefault(); capture.focus(); }
});

// Fresh numbers when Home comes back into view, and once a minute while it is shown (the date and
// "overdue" change at midnight; the counts change when you work in other apps).
const refresh = () => { if (visible && !editing && !home.waiting) { home.loadBoard(); home.loadAgents(); setup.load(); } };
ws.on('visible', p => { visible = !!p.visible; refresh(); });
setInterval(refresh, 60000);

paint();
await Promise.all([home.loadAll(), setup.load()]);

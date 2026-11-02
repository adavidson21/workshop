/* Home: a summary of your day across Workshop, opened by the Workshop logo (app.json home: true).
   Reads Prioritizer's board and the opencode connector read-only through the SDK, and keeps one small
   collection of its own: profile (home.profile v1, no items; meta: {name, role}). data.js loads and saves,
   view.js builds the HTML, this file owns the page. */
import { connect } from '../../../shared/workshop-sdk.js';
import { createHome } from './data.js';
import { profileForm, render } from './view.js';

const app = document.getElementById('app');
const ws = await connect({ app: 'home' });
document.documentElement.classList.toggle('embed', ws.embedded);

let editing = false, visible = true;
const home = createHome(ws, { onChange: () => paint() });
const v = home.v;

function paint() {
  if (home.waiting) editing = false;
  app.innerHTML = editing ? profileForm(v.profile) : render(v);
  if (editing) { const f = app.querySelector('input[name=name]'); if (f) f.focus(); }
}

// Changes from other windows. Nothing to read while Home waits for the folder; Allow reloads everything.
const later = (fn, ms) => { let t = null; return () => { if (home.waiting) return; clearTimeout(t); t = setTimeout(fn, ms); }; };
const boardLater = later(home.loadBoard, 150);
for (const c of ['tasks', 'lists', 'people']) ws.data.subscribe(c, boardLater, { app: 'prioritizer' });
const OC = 'opencode';
const agentsLater = later(home.loadAgents, 200);
if (ws.backend === 'agent') { ws.connectors.on(OC, '*', agentsLater); ws.connectors.onStatus(OC, agentsLater); }
ws.data.subscribe('profile', () => { if (!home.waiting) home.loadProfile(); });

/* ---------- input ---------- */
app.addEventListener('click', e => {
  const t = e.target;
  const task = t.closest('[data-task]');
  if (task) { ws.open({ app: 'prioritizer', path: 'task/' + task.dataset.task }); return; }
  const open = t.closest('[data-open]');
  if (open) { ws.open({ app: open.dataset.open }); return; }
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && editing) { editing = false; paint(); } });

// Fresh numbers when Home comes back into view, and once a minute while it is shown (the date and
// "overdue" change at midnight; the counts change when you work in other apps).
const refresh = () => { if (visible && !editing && !home.waiting) { home.loadBoard(); home.loadAgents(); } };
ws.on('visible', p => { visible = !!p.visible; refresh(); });
setInterval(refresh, 60000);

paint();
await home.loadAll();

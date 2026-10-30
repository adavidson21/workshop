/* Home: a summary of your day across Workshop, opened by the Workshop logo (app.json home: true).
   Reads Prioritizer's board and the opencode connector read-only through the SDK, and keeps one small
   collection of its own: profile (home.profile v1, no items; meta: {name, role}). view.js builds the HTML. */
import { connect } from '../../../shared/workshop-sdk.js';
import { TASKS_VERSION, agentCounts, profileForm, render, summarize } from './view.js';

const app = document.getElementById('app');
const ws = await connect({ app: 'home' });
document.documentElement.classList.toggle('embed', ws.embedded);

const P = { app: 'prioritizer' };
const v = { now: new Date(), profile: {}, board: null, boardNote: '', agents: { state: 'loading' } };
let profileEnv = null, editing = false, visible = true;

function paint() {
  v.now = new Date();
  app.innerHTML = editing ? profileForm(v.profile) : render(v);
  if (editing) { const f = app.querySelector('input[name=name]'); if (f) f.focus(); }
}

/* ---------- Prioritizer's board, read-only ---------- */
async function loadBoard() {
  try {
    const [tasks, lists, people] = await Promise.all(['tasks', 'lists', 'people'].map(c => ws.data.get(c, P)));
    if (tasks && (tasks.schema !== 'prioritizer.tasks' || tasks.version !== TASKS_VERSION)) {
      v.board = null; v.boardNote = 'Your board was saved by a newer Docket. Update Workshop to see it here.';
    } else {
      v.board = summarize({ tasks: tasks ? tasks.items : [], lists: lists ? lists.items : [], people: people ? people.items : [] }, dateKey());
      v.boardNote = '';
    }
  } catch (e) {
    v.board = null; v.boardNote = "Couldn't read your board right now.";
  }
  paint();
}
const dateKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let boardSoon = null;
const boardLater = () => { clearTimeout(boardSoon); boardSoon = setTimeout(loadBoard, 150); };
for (const c of ['tasks', 'lists', 'people']) ws.data.subscribe(c, boardLater, P);

/* ---------- agents, from the opencode connector ---------- */
const OC = 'opencode';
async function loadAgents() {
  if (ws.backend !== 'agent') { v.agents = { state: 'browser' }; return paint(); }
  try {
    const c = (await ws.connectors.list()).find(x => x.id === OC);
    if (!c || c.status.state !== 'ready') {
      v.agents = { state: 'off', message: !c ? 'The opencode connector is not installed.' : c.status.state === 'disabled' ? 'The opencode connector is off. Turn it on in Settings.' : c.status.message || 'The opencode connector is not ready yet.' };
    } else {
      v.agents = { state: 'ready', ...agentCounts(await ws.connectors.call(OC, 'state')) };
    }
  } catch (e) {
    v.agents = { state: 'off', message: "Couldn't reach Workshop on this computer." };
  }
  paint();
}
let agentsSoon = null;
const agentsLater = () => { clearTimeout(agentsSoon); agentsSoon = setTimeout(loadAgents, 200); };
if (ws.backend === 'agent') { ws.connectors.on(OC, '*', agentsLater); ws.connectors.onStatus(OC, agentsLater); }

/* ---------- profile, Home's own data ---------- */
async function loadProfile() {
  try {
    profileEnv = await ws.data.get('profile');
    const m = profileEnv && profileEnv.meta || {};
    v.profile = { name: typeof m.name === 'string' ? m.name : '', role: typeof m.role === 'string' ? m.role : '' };
  } catch (e) { /* keep the empty profile */ }
  paint();
}
async function saveProfile(next) {
  const build = base => ({
    schema: 'home.profile', version: 1, rev: base ? base.rev : 0, items: [], deleted: base && base.deleted || {},
    meta: Object.assign({}, base && base.meta, { updatedAt: Date.now(), name: next.name, role: next.role })
  });
  try {
    const env = build(profileEnv);
    const r = await ws.data.put('profile', env);
    profileEnv = Object.assign(env, { rev: r.rev });
  } catch (e) {
    if (e.code === 'conflict' && e.current) {
      const env = build(e.current);
      const r = await ws.data.put('profile', env);
      profileEnv = Object.assign(env, { rev: r.rev });
    } else throw e;
  }
  v.profile = next;
}
ws.data.subscribe('profile', loadProfile);

/* ---------- input ---------- */
app.addEventListener('click', e => {
  const t = e.target;
  const task = t.closest('[data-task]');
  if (task) { ws.open({ app: 'prioritizer', path: 'task/' + task.dataset.task }); return; }
  const open = t.closest('[data-open]');
  if (open) { ws.open({ app: open.dataset.open }); return; }
  if (t.closest('[data-edit-profile]')) { editing = true; paint(); return; }
  if (t.closest('[data-cancel]')) { editing = false; paint(); }
});
app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const next = { name: String(f.get('name') || '').trim().slice(0, 80), role: String(f.get('role') || '').trim().slice(0, 80) };
  try { await saveProfile(next); editing = false; paint(); }
  catch (err) { ws.toast("Couldn't save your profile. Try again.", { kind: 'error' }); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && editing) { editing = false; paint(); } });

// Fresh numbers when Home comes back into view, and once a minute while it is shown (the date and
// "overdue" change at midnight; the counts change when you work in other apps).
ws.on('visible', p => { visible = !!p.visible; if (visible && !editing) { loadBoard(); loadAgents(); } });
setInterval(() => { if (visible && !editing) { loadBoard(); loadAgents(); } }, 60000);

paint();
await Promise.all([loadProfile(), loadBoard(), loadAgents()]);

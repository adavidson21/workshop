/* Slate: your ADO backlog as a board, from request to "who builds it?". model.js is pure, data.js talks to
   Workshop, view.js builds HTML, host.js runs Runway in the Roadmap tab. This file owns the page: state,
   refreshing from ADO and Tandem, and what each button does. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import * as People from '../../../shared/people.js';
import { connectorState, createStore, ado, readFiles, tandem } from './data.js';
import { hostFrame } from './host.js';
import {
  APP, cards, devColumn, draftState, filterCards, newItem, parseTriage, pmColumn, publishPlan, roadmapIdea, setStage, waitingTask
} from './model.js';
import { boardHtml, confirmHtml, delegateDialogHtml, newDialogHtml, panelHtml, publishDialogHtml, roadmapHtml, topHtml } from './view.js';

const $ = (id) => document.getElementById(id);
const topEl = $('top'), mainEl = $('main'), panelEl = $('panel'), dlg = $('dlg');

const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Slate');

const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(`slate.${k}`); localStorage.setItem(`slate.${k}`, v); } catch { /* storage blocked */ } return null; };

const ui = {
  tab: 'board', lane: remember('lane') === 'dev' ? 'dev' : 'pm', q: '', level: '', open: null,
  editing: false, busy: false, error: '', roadmapRoute: ''
};
const s = {
  conn: { ado: 'Checking…', opencode: 'Checking…' },
  team: { areas: [], connection: '' },
  people: People.EMPTY,
  backlog: [], backlogNote: '',
  tstate: null,                // the opencode connector's `state`
  files: new Map(),            // folder -> {file: text}
  apps: []
};
const store = createStore(ws, { onChange: () => paint() });

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
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function readBacklog() {
  s.backlogNote = '';
  if (s.conn.ado !== true) { s.backlog = []; return; }
  if (!s.team.areas.length) { s.backlog = []; s.backlogNote = 'Set your team\'s area paths in People so Slate can list your ADO backlog.'; return; }
  try {
    const r = await ado(ws, 'backlog', { areas: s.team.areas, ...(s.team.connection ? { connection: s.team.connection } : {}) });
    s.backlog = r.items || [];
    if (r.truncated) s.backlogNote = `Showing the newest ${s.backlog.length} of ${r.total} open items.`;
  } catch (e) {
    s.backlog = [];
    s.backlogNote = `Could not read the ADO backlog: ${e.message}`;
  }
}

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
    if (it.stage === 'new' && t && !(working && (working.busy || working.waiting))) moves.push([it.id, 'triaged', t.route]);
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
  out.agent = agentOf(c.sessions && c.sessions.current);
  out.assigneeName = personName(c.assignee);
  return out;
}

function columns() {
  const cols = {};
  const push = (k, c) => (cols[k] ||= []).push(c);
  const list = filterCards(cards(store.v.items, s.backlog), { q: ui.q, level: ui.level });
  if (ui.lane === 'pm') {
    for (const c of list) {
      if (['dev', 'done'].includes(c.stage)) continue;
      const e = enrich(c);
      push(pmColumn(c, draftState(c, filesOf(c.work.define)), e.agent), e);
    }
  } else {
    const mine = list.filter(c => c.stage === 'dev' || c.stage === 'done');
    const seen = new Set();
    for (const c of mine) { const run = runFor(c); if (run) seen.add(run.folder); push(c.stage === 'done' ? 'done' : devColumn(run), enrich(c)); }
    // Tandem runs started elsewhere (Dispatch, the terminal) are part of the Dev picture too.
    for (const r of ((s.tstate && s.tstate.items) || []).filter(x => x.kind === 'item' && !seen.has(x.folder))) {
      const c = { id: `run_${r.folder}`, title: r.title || r.folder, level: r.lane === 'bug' ? 'bug' : 'story', stage: 'dev', virtualRun: true, run: r, work: {}, sessions: {}, history: [],
        ado: /^\d+$/.test(String(r.id)) ? { id: Number(r.id), url: '', rev: 0 } : null };
      if (filterCards([c], { q: ui.q, level: ui.level }).length) push(devColumn(r), c);
    }
  }
  return cols;
}

function findCard(id) {
  if (!id) return null;
  const stored = store.v.items.find(x => x.id === id);
  if (stored) return stored;
  if (id.startsWith('ado_')) { const b = s.backlog.find(x => `ado_${x.id}` === id); return b ? cards([], [b])[0] : null; }
  if (id.startsWith('run_')) return (columns()[Object.keys(columns()).find(k => (columns()[k] || []).some(c => c.id === id))] || []).find(c => c.id === id) || null;
  return null;
}

function panelState(c) {
  const files = { ...filesOf(c.work && c.work.triage), ...filesOf(c.work && c.work.define) };
  const draft = draftState(c, filesOf(c.work && c.work.define));
  const lane = c.virtualRun || c.stage === 'dev' || c.stage === 'done' ? 'dev' : 'pm';
  return {
    item: c, lane, files, draft, editing: ui.editing,
    triage: parseTriage(filesOf(c.work && c.work.triage)['triage.md']),
    agent: agentOf(c.sessions && c.sessions.current),
    column: lane === 'pm' ? pmColumn(c, draft, agentOf(c.sessions && c.sessions.current)) : null,
    run: c.run || runFor(c),
    assigneeName: personName(c.assignee),
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

let host = null;
function paint() {
  const focus = document.activeElement && document.activeElement.id;
  topEl.innerHTML = topHtml(ui, ui.tab === 'board' ? notes() : []);
  if (ui.tab === 'roadmap') {
    if (!mainEl.querySelector('#runway') && !mainEl.querySelector('.empty')) mountRoadmap();
    panelEl.hidden = !ui.open; if (ui.open) paintPanel();
  } else {
    if (host) { host.stop(); host = null; }
    mainEl.innerHTML = store.v.loaded ? boardHtml(columns(), { lane: ui.lane, open: ui.open, backlogNote: s.backlogNote }) : '<p class="loading">Loading…</p>';
    paintPanel();
  }
  const waiting = store.v.items.filter(it => { const a = agentOf(it.sessions.current); return a && a.waiting; }).length;
  ws.badge(waiting || null).catch(() => {});
  if (focus && $(focus) && focus !== 'draft' && focus !== 'answers') $(focus).focus();
}

function paintPanel() {
  const c = findCard(ui.open);
  if (!c) { panelEl.hidden = true; panelEl.innerHTML = ''; return; }
  // Keep text the person is typing.
  const keep = ['draft', 'answers'].map(id => [id, $(id) && $(id).value]);
  panelEl.hidden = false;
  panelEl.innerHTML = panelHtml(panelState(c));
  for (const [id, val] of keep) if (val != null && $(id)) $(id).value = val;
  panelEl.classList.toggle('busy', ui.busy);
}

function mountRoadmap() {
  const on = s.apps.some(a => a.id === 'runway') || !s.apps.length;
  mainEl.innerHTML = roadmapHtml(on ? 'on' : 'off');
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
    if (r.folder) x.work = { ...x.work, [kind]: r.folder };
  });
  return r;
}

const ACT = {
  tab: (id) => { ui.tab = id; paint(); },
  lane: (id) => { ui.lane = id; remember('lane', id); ui.open = null; paint(); },
  refresh: () => refresh().then(() => ws.toast('Up to date.', { kind: 'success' })),
  new: () => showDialog(newDialogHtml(), async (form) => {
    const it = newItem({ title: form.title.value, description: form.description.value, level: form.level.value });
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
    const area = s.team.areas[0] || '';
    const plan = publishPlan(c, files, { area });
    if (!plan.length) return ws.toast('Nothing to publish yet.', { kind: 'warn' });
    showDialog(publishDialogHtml(plan, { area }), () => runPublish(c, plan));
  },
  async delegate(c) {
    const ppl = People.team(s.people).concat(People.withRelation(s.people, 'peer')).filter(p => p.relation !== 'self');
    showDialog(delegateDialogHtml(ppl.map(p => ({ id: p.id, name: p.name })), { canBrief: s.conn.opencode === true && !!c.ado, canAssign: s.conn.ado === true && !!c.ado }), async (form) => {
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
      ws.toast(`Delegated to ${person.name}.`, { kind: 'success' });
    });
  },
  async myself(c) {
    const it = await ensureStored(c);
    await store.update(it.id, x => { x.route = 'myself'; x.assignee = null; setStage(x, 'dev'); });
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
  dispatch: (c) => { const run = c && (c.run || runFor(c)); return ws.open({ app: 'agents', path: run ? String(run.id || '') : '' }); },
  ado: (c) => { if (c.ado && c.ado.url) window.open(c.ado.url, '_blank', 'noopener'); },
  async 'roadmap-add'(c) {
    const it = await ensureStored(c);
    await store.offer(roadmapIdea(it));
    ws.toast('Sent to Runway. Assign it to a roadmap from its Pending list.', { kind: 'success' });
  },
  async done(c) { await store.update(c.id, x => setStage(x, 'done')); },
  remove: (c) => showDialog(confirmHtml('Remove from Slate?', 'Slate forgets this item. Nothing changes in ADO or in .work.', 'Remove'), async () => {
    await store.change(list => { const i = list.findIndex(x => x.id === c.id); if (i >= 0) list.splice(i, 1); });
    ui.open = null; paint();
  })
};

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
  try { await fn(target || findCard(ui.open)); }
  catch (err) { ui.error = err && err.message || ''; toastErr(err); }
  finally { ui.busy = false; if (document.contains(b)) b.disabled = false; paint(); }
});

let qTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.q = e.target.value; paint(); }, 150); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'lvl') { ui.level = e.target.value; paint(); return; }
  const c = findCard(ui.open);
  if (!c || c.virtual) return;
  try {
    if (e.target.dataset.f === 'level') await store.update(c.id, x => { x.level = e.target.value; });
    if (e.target.id === 'ptitle' && e.target.value.trim()) await store.update(c.id, x => { x.title = e.target.value; });
  } catch (err) { toastErr(err); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.open && !dlg.open && !['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName)) { ui.open = null; ui.editing = false; paint(); }
});

/* ---------- routes: item/<id>, roadmap, runway/<map>/<item> (Runway's Work item button) ---------- */

async function route(path) {
  let raw = String(path || '');
  try { raw = decodeURIComponent(raw); } catch { /* keep it as it came */ }
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'roadmap') { ui.tab = 'roadmap'; ui.roadmapRoute = parts.slice(1).join('/'); paint(); return; }
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
ws.on('command', (p) => { if (p.id === 'new') ACT.new(); if (p.id === 'refresh') ACT.refresh(); if (p.id === 'roadmap') route('roadmap'); });
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

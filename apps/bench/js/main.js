/* Bench: is Tandem helping, and is a prompt change better or worse? Reads Tandem's eval cases and results through the
   opencode connector (evals.* actions, docs/bench.md) and starts a run in a terminal window you can see.

   Bench stores nothing of its own: results live in your eng-agents folder (evals/results/), where you commit the
   ones you keep. Routes: '' (Lift), 'history', 'cases', 'result/<file>'. */
import { connect } from '../../../shared/workshop-sdk.js';
import { runCount, runRequest } from './model.js';
import { TABS, bodyHtml, esc, tabsHtml } from './view.js';

const $ = (s) => document.querySelector(s);
const ws = await connect({ app: 'bench' });

const st = {
  tab: 'lift', view: 'tab', loading: true, error: null, note: null,
  results: [], cases: [], source: null, detail: null, detailError: null, compare: [],
  form: { cases: ['feature-outcome'], arm: 'both', runs: 3, model: '', autoApprove: true }, formError: null
};

function errText(e) { return (e && (e.message || e.code)) || 'Something went wrong.'; }

function render() {
  $('#tabs').innerHTML = tabsHtml(st.view === 'result' ? 'history' : st.tab);
  $('#body').innerHTML = bodyHtml(st);
}

function setupNote(e) {
  if (ws.mode === 'browser') return { title: 'Bench needs Workshop on this computer', body: 'It reads Tandem\'s eval results from your eng-agents folder, which only Workshop on this computer can see. Install or start Workshop, then open Bench from it.' };
  const code = e && e.code;
  const msg = errText(e);
  if (code === 'not_found' || /not (found|running)|stopped|disabled|off/i.test(msg) && /connector/i.test(msg)) return { title: 'Turn on the opencode connector', body: 'Bench reads Tandem\'s evals through it. Settings, Connections, opencode.', action: { act: 'open-settings', label: 'Open Settings' } };
  if (/install record|install Tandem/i.test(msg)) return { title: 'Install Tandem from its repo', body: `${esc(msg)} Then press Refresh.` };
  return null;
}

async function load() {
  st.loading = true; st.error = null; st.note = null;
  render();
  try {
    const [cases, results] = await Promise.all([ws.connectors.call('opencode', 'evals.cases'), ws.connectors.call('opencode', 'evals.results')]);
    st.cases = cases.cases || [];
    st.source = cases.source || results.source || null;
    st.results = results.results || [];
    st.form.cases = st.form.cases.filter((n) => st.cases.some((c) => c.name === n));
    if (!st.form.cases.length) st.form.cases = st.cases.filter((c) => c.lift).map((c) => c.name).slice(0, 1);
  } catch (e) {
    st.note = setupNote(e);
    if (!st.note) st.error = errText(e);
  }
  st.loading = false;
  if (st.view === 'result' && st.detail === null && st.detailFile) await openResult(st.detailFile, { route: false });
  render();
}

async function openResult(file, { route = true } = {}) {
  st.view = 'result'; st.detailFile = file; st.detail = null; st.detailError = null;
  if (route) ws.route.set(`result/${encodeURIComponent(file)}`);
  render();
  try { st.detail = await ws.connectors.call('opencode', 'evals.result', { file }); }
  catch (e) { st.detailError = errText(e); }
  render();
}

function showTab(id, { route = true } = {}) {
  const t = TABS.find((x) => x.id === id) || TABS[0];
  st.tab = t.id; st.view = 'tab';
  if (route) ws.route.set(t.path);
  render();
}

function readForm() {
  const f = $('#runForm');
  if (!f) return;
  st.form = {
    cases: [...f.querySelectorAll('input[name=case]:checked')].map((x) => x.value),
    arm: f.arm.value, runs: f.runs.value, model: f.model.value, autoApprove: f.autoApprove.checked
  };
}

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); ws.toast(`${what} copied`, { kind: 'success' }); }
  catch { ws.toast(`Could not copy. ${text}`, { kind: 'warn' }); }
}

function confirmRun(args) {
  const dlg = $('#confirmDlg');
  const n = runCount(args, st.cases);
  $('#confirmText').innerHTML = `Opens a terminal in <code>${esc(st.source || 'your eng-agents folder')}</code> and runs <b>${n} model run${n === 1 ? '' : 's'}</b> on ${args.model ? `<code>${esc(args.model)}</code>` : 'your opencode default model'}. A whole feature lane can take several minutes per run and uses your model's quota.`;
  return new Promise((resolve) => {
    const done = (ok) => { dlg.close(); resolve(ok); };
    dlg.querySelector('[data-confirm=yes]').onclick = () => done(true);
    dlg.querySelector('[data-confirm=no]').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
    dlg.querySelector('[data-confirm=no]').focus();
  });
}

async function startRun() {
  readForm();
  const req = runRequest(st.form, st.cases);
  st.formError = req.ok ? null : req.error;
  if (!req.ok) { render(); return; }
  render();
  if (!(await confirmRun(req.args))) return;
  try {
    await ws.connectors.call('opencode', 'evals.run', req.args, { confirm: true });
    ws.toast('Running in a terminal. Press Refresh here when it finishes.', { kind: 'success' });
  } catch (e) {
    st.formError = `${errText(e)}`;
    render();
  }
}

async function copyCommand() {
  readForm();
  const req = runRequest(st.form, st.cases);
  st.formError = req.ok ? null : req.error;
  if (!req.ok) { render(); return; }
  try {
    const out = await ws.connectors.call('opencode', 'evals.command', req.args);
    await copy(`cd "${out.folder}"\n${out.command}`, 'Command');
  } catch (e) { st.formError = errText(e); render(); }
}

const ACTS = {
  'go-cases': () => showTab('cases'),
  'open-result': (el) => openResult(el.dataset.file),
  back: () => showTab('history'),
  'pick-compare': (el) => {
    const f = el.dataset.file;
    st.compare = el.checked ? [...st.compare.filter((x) => x !== f), f].slice(-2) : st.compare.filter((x) => x !== f);
    render();
  },
  'clear-compare': () => { st.compare = []; render(); },
  copy: (el) => copy(el.dataset.text, 'Path'),
  'copy-command': () => copyCommand(),
  'open-settings': () => ws.open({ app: 'settings', path: 'connections' }).catch(() => {})
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { showTab(tab.dataset.tab); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACTS[el.dataset.act]) {
    if (el.tagName !== 'INPUT') e.preventDefault();
    ACTS[el.dataset.act](el);
  }
});
document.addEventListener('change', (e) => { if (e.target.closest('#runForm')) readForm(); });
document.addEventListener('submit', (e) => { if (e.target.id === 'runForm') { e.preventDefault(); startRun(); } });
$('#refreshBtn').addEventListener('click', () => load());

function follow(path) {
  const p = String(path || '');
  if (p.startsWith('result/')) { st.view = 'result'; st.detailFile = decodeURIComponent(p.slice(7)); st.detail = null; if (!st.loading) openResult(st.detailFile, { route: false }); return; }
  const t = TABS.find((x) => x.path === p.split('/')[0]) || TABS[0];
  showTab(t.id, { route: false });
}
ws.on('route', ({ path } = {}) => follow(path));
ws.on('visible', ({ visible } = {}) => { if (visible && !st.loading) load(); });
ws.on('command', ({ id } = {}) => {
  if (id === 'refresh') load();
  else if (id === 'run') showTab('cases');
  else if (id === 'history') showTab('history');
});

load();

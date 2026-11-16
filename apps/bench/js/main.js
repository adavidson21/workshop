/* Bench: the test suite for Tandem's commands and agents. Is Tandem helping, which commands fail, what changed, what
   costs the most, and is a prompt change better or worse? Reads Tandem's evals through the opencode connector
   (evals.* actions, docs/bench.md) and starts runs and improve-loop scripts in a terminal window you can see.

   Results, cases and experiments live in your eng-agents folder. Bench keeps only its settings (which models to use,
   the run budget) in its own `settings` collection.
   Routes: '' (Overview), 'improve', 'history', 'run', 'lift', 'command/<name>', 'result/<file>'. */
import { connect } from '../../../shared/workshop-sdk.js';
import { runCount } from './model.js';
import { affectedCases, caseHashes, checkSettings, filesToInspect, readSettings, settingsEnvelope } from './suite.js';
import { TABS, bodyHtml, esc, tabsHtml } from './view.js';

const $ = (s) => document.querySelector(s);
const ws = await connect({ app: 'bench' });
const call = (action, args, opts) => ws.connectors.call('opencode', action, args, opts);

const st = {
  tab: 'overview', view: 'tab', loading: true, error: null, note: null,
  results: [], cases: [], commands: [], guards: null, experiments: [], hashes: new Map(), affected: [], details: [],
  source: null, detail: null, detailError: null, compare: [], commandName: null,
  settings: readSettings(null), settingsEnv: null, settingsError: null,
  form: { preset: 'affected', cases: [], arm: 'tandem', runs: 1, models: '', judge: false, autoApprove: true }, formError: null
};

function errText(e) { return (e && (e.message || e.code)) || 'Something went wrong.'; }

function render() {
  const tab = st.view === 'result' ? 'history' : st.view === 'command' || st.view === 'lift' ? 'overview' : st.tab;
  // Until Bench can read anything, its tabs would all show the same setup card: hide them (Bench UX v1).
  $('#tabs').innerHTML = st.note ? '' : tabsHtml(tab);
  $('#tabs').hidden = !!st.note;
  $('#body').innerHTML = bodyHtml(st);
}

function setupNote(e) {
  if (ws.mode === 'browser') return { title: 'Bench needs Workshop on this computer', body: 'It reads Tandem\'s evals from your eng-agents folder, which only Workshop on this computer can see. Install or start Workshop, then open Bench from it.' };
  const msg = errText(e);
  if ((e && e.code === 'not_found') || (/not (found|running)|stopped|disabled|off/i.test(msg) && /connector/i.test(msg))) return { title: 'Turn on the opencode connector', body: 'Bench reads Tandem\'s evals through it. Settings, Connections, opencode.', action: { act: 'open-settings', label: 'Open Settings' } };
  if (/install record|install Tandem|Update Tandem/i.test(msg)) return { title: 'Install Tandem from its repo', body: `${esc(msg)} Then press Refresh.` };
  return null;
}

async function loadSettings() {
  try {
    st.settingsEnv = await ws.data.get('settings');
    st.settings = readSettings(st.settingsEnv);
  } catch { st.settings = readSettings(null); }
}

async function load() {
  st.loading = true; st.error = null; st.note = null;
  render();
  await loadSettings();
  try {
    const [cases, results, commands, experiments] = await Promise.all([
      call('evals.cases'), call('evals.results'),
      call('evals.commands').catch(() => ({ commands: [], guards: null })),
      call('evals.experiments').catch(() => ({ experiments: [] }))
    ]);
    st.cases = cases.cases || [];
    st.source = cases.source || results.source || null;
    st.results = results.results || [];
    st.commands = commands.commands || [];
    st.guards = commands.guards || null;
    st.experiments = experiments.experiments || [];
    st.hashes = await caseHashes(st.cases, st.commands);
    st.affected = affectedCases(st.cases, st.results, st.hashes);
    st.form.cases = st.form.cases.filter((n) => st.cases.some((c) => c.name === n));
    if (!st.form.models && st.settings.testModel) st.form.models = st.settings.testModel;
  } catch (e) {
    st.note = setupNote(e);
    if (!st.note) st.error = errText(e);
  }
  st.loading = false;
  render();
  if (!st.note && !st.error) loadDetails();
  if (st.view === 'result' && st.detail === null && st.detailFile) openResult(st.detailFile, { route: false });
}

// Failure groups read the latest failing results files in full.
async function loadDetails() {
  const files = filesToInspect(st.results);
  const out = [];
  for (const file of files) {
    try { out.push(await call('evals.result', { file })); } catch { /* skip an unreadable file */ }
  }
  st.details = out;
  if (st.tab === 'improve' && st.view === 'tab') render();
}

async function openResult(file, { route = true } = {}) {
  st.view = 'result'; st.detailFile = file; st.detail = null; st.detailError = null;
  if (route) ws.route.set(`result/${encodeURIComponent(file)}`);
  render();
  try { st.detail = await call('evals.result', { file }); }
  catch (e) { st.detailError = errText(e); }
  render();
}

function showTab(id, { route = true } = {}) {
  const t = TABS.find((x) => x.id === id) || TABS[0];
  st.tab = t.id; st.view = 'tab';
  if (route) ws.route.set(t.path);
  render();
}

function openCommand(name, { route = true } = {}) {
  st.view = 'command'; st.commandName = name;
  if (route) ws.route.set(`command/${encodeURIComponent(name)}`);
  render();
}

function readForm() {
  const f = $('#runForm');
  if (!f) return;
  st.form = {
    ...st.form,
    cases: [...f.querySelectorAll('input[name=case]:checked')].map((x) => x.value),
    arm: f.arm ? f.arm.value : st.form.arm,
    runs: f.runs.value, models: f.models.value, judge: f.judge.checked, autoApprove: f.autoApprove.checked
  };
}

/** The run request for the connector, checked here first; {ok, error, args}. */
function runRequest() {
  const f = st.form;
  const runs = Number(f.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) return { ok: false, error: 'Runs per case must be 1 to 10.' };
  const models = String(f.models || st.settings.testModel || '').split(',').map((m) => m.trim()).filter(Boolean);
  if (models.length > 4) return { ok: false, error: 'At most 4 models at once.' };
  if (models.some((m) => !/^[A-Za-z0-9._-]{1,60}\/[A-Za-z0-9._:/-]{1,120}$/.test(m))) return { ok: false, error: 'Models must look like provider/model, separated by commas.' };
  const args = { preset: f.preset, runs, autoApprove: !!f.autoApprove, maxRuns: st.settings.maxRuns };
  if (models.length === 1) args.model = models[0];
  if (models.length > 1) args.models = models;
  if (f.judge && st.settings.judgeModel) args.judge = st.settings.judgeModel;
  if (f.preset === 'custom') {
    if (!f.cases.length) return { ok: false, error: 'Pick at least one case.' };
    args.cases = f.cases; args.arm = f.arm;
  }
  if (f.preset === 'lift') args.cases = f.cases.length ? f.cases : st.cases.filter((c) => c.lift).map((c) => c.name);
  if (f.preset === 'affected' && !st.affected.length) return { ok: false, error: 'Nothing changed since the last runs: every case is up to date.' };
  return { ok: true, args };
}

function plannedRuns(args) {
  const m = args.models ? args.models.length : 1;
  if (args.preset === 'affected') return st.affected.length * args.runs * m;
  if (args.preset === 'release') return st.cases.length * args.runs * m;
  return runCount({ cases: args.cases, arm: args.preset === 'lift' ? 'both' : args.arm, runs: args.runs }, st.cases) * m;
}

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); ws.toast(`${what} copied`, { kind: 'success' }); }
  catch { ws.toast(`Could not copy. ${text}`, { kind: 'warn' }); }
}

function confirmDialog(html, yesLabel = 'Open the terminal') {
  const dlg = $('#confirmDlg');
  $('#confirmText').innerHTML = html;
  dlg.querySelector('[data-confirm=yes]').textContent = yesLabel;
  return new Promise((resolve) => {
    const done = (ok) => { dlg.close(); resolve(ok); };
    dlg.querySelector('[data-confirm=yes]').onclick = () => done(true);
    dlg.querySelector('[data-confirm=no]').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
    dlg.querySelector('[data-confirm=no]').focus();
  });
}

async function startRun(extra = null) {
  if (!extra) readForm();
  const req = extra ? { ok: true, args: extra } : runRequest();
  st.formError = req.ok ? null : req.error;
  if (!req.ok) { render(); return; }
  const n = plannedRuns(req.args);
  if (n > st.settings.maxRuns) { st.formError = `That is ${n} model runs, more than your limit of ${st.settings.maxRuns}. Pick fewer, or raise the limit in Settings.`; render(); return; }
  render();
  const model = req.args.models ? req.args.models.map((m) => `<code>${esc(m)}</code>`).join(', ') : req.args.model ? `<code>${esc(req.args.model)}</code>` : 'your opencode default model';
  const ok = await confirmDialog(`Opens a terminal in <code>${esc(st.source || 'your eng-agents folder')}</code> and runs about <b>${n} model run${n === 1 ? '' : 's'}</b> on ${model}${req.args.judge ? `, judged by <code>${esc(req.args.judge)}</code>` : ''}${req.args.experiment ? `, with experiment <code>${esc(req.args.experiment)}</code> on a scratch copy of Tandem` : ''}. A whole lane can take several minutes per run and uses your models' quota.`);
  if (!ok) return;
  try {
    await call('evals.run', req.args, { confirm: true });
    ws.toast('Running in a terminal. Press Refresh here when it finishes.', { kind: 'success' });
  } catch (e) { st.formError = errText(e); render(); }
}

async function copyCommand() {
  readForm();
  const req = runRequest();
  st.formError = req.ok ? null : req.error;
  if (!req.ok) { render(); return; }
  try {
    const out = await call('evals.command', req.args);
    await copy(`cd "${out.folder}"\n${out.command}`, 'Command');
  } catch (e) { st.formError = errText(e); render(); }
}

async function runScript(args, html, yes) {
  if (!(await confirmDialog(html, yes))) return;
  try {
    await call('evals.script', args, { confirm: true });
    ws.toast('Running in a terminal. Press Refresh here when it finishes.', { kind: 'success' });
  } catch (e) { ws.toast(errText(e), { kind: 'warn' }); }
}

async function saveSettings() {
  const f = $('#settingsForm');
  const chk = checkSettings({ testModel: f.testModel.value, judgeModel: f.judgeModel.value, suggestModel: f.suggestModel.value, maxRuns: f.maxRuns.value });
  st.settingsError = chk.ok ? null : chk.error;
  if (!chk.ok) { render(); return; }
  try {
    const env = settingsEnvelope(st.settingsEnv, chk.settings);
    const res = await ws.data.put('settings', env);
    st.settingsEnv = { ...env, rev: res.rev };
    st.settings = readSettings(st.settingsEnv);
    if (!st.form.models || !st.form.models.includes(',')) st.form.models = st.settings.testModel;
    ws.toast('Settings saved', { kind: 'success' });
  } catch (e) {
    st.settingsError = e && e.code === 'conflict' ? 'Settings changed in another window. Press Refresh and save again.' : errText(e);
  }
  render();
}

function experimentCases(exp) {
  if (exp.case) return [exp.case];
  return st.cases.filter((c) => (c.commands || []).includes(exp.command)).map((c) => c.name);
}

const ACTS = {
  'go-run': () => showTab('run'),
  'back-overview': () => showTab('overview'),
  'open-lift': () => { st.view = 'lift'; ws.route.set('lift'); render(); },
  'open-command': (el) => openCommand(el.dataset.command),
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
  preset: (el) => { readForm(); st.form.preset = el.dataset.preset; st.form.runs = el.dataset.preset === 'affected' ? 1 : 3; st.formError = null; render(); },
  'run-command': (el) => {
    const cases = st.cases.filter((c) => (c.commands || []).includes(el.dataset.command)).map((c) => c.name);
    st.form = { ...st.form, preset: 'custom', cases, arm: 'tandem', runs: 1 };
    showTab('run');
  },
  trim: (el) => runScript({ script: 'trim', command: el.dataset.command },
    `Makes one experiment per section of <code>/${esc(el.dataset.command)}</code>, each with that section removed. No model runs yet: test them from Improve.`, 'Make trim experiments'),
  suggest: (el) => runScript({ script: 'suggest', file: el.dataset.file, case: el.dataset.case, model: st.settings.suggestModel },
    `Asks <code>${esc(st.settings.suggestModel)}</code> for one prompt fix from <code>${esc(el.dataset.case)}</code>'s failed runs, and saves it as an experiment. Your Tandem is not changed.`, 'Ask for a fix'),
  'test-exp': (el) => {
    const exp = st.experiments.find((x) => x.id === el.dataset.id);
    if (!exp) return;
    const cases = experimentCases(exp);
    if (!cases.length) { ws.toast('No case uses this command yet, so there is nothing to test it on.', { kind: 'warn' }); return; }
    startRun({ preset: 'custom', cases, arm: 'tandem', runs: 2, autoApprove: true, maxRuns: st.settings.maxRuns, experiment: exp.id, ...(st.settings.testModel ? { model: st.settings.testModel } : {}) });
  },
  'keep-exp': (el) => runScript({ script: 'keep', id: el.dataset.id },
    `Copies the experiment's file into <code>core/</code> in your eng-agents folder, for you to review and commit, then refreshes <code>evals/commands.json</code>. Run <code>./install.ps1</code> afterwards so your Tandem uses it.`, 'Keep it'),
  'drop-exp': (el) => runScript({ script: 'keep', id: el.dataset.id, drop: true }, 'Marks the experiment dropped. Nothing else changes.', 'Drop it'),
  'open-settings': () => ws.open({ app: 'settings', path: 'connections' }).catch(() => {})
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { showTab(tab.dataset.tab); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACTS[el.dataset.act] && !el.disabled) {
    if (el.tagName !== 'INPUT') e.preventDefault();
    ACTS[el.dataset.act](el);
  }
});
document.addEventListener('change', (e) => { if (e.target.closest('#runForm')) readForm(); });
document.addEventListener('submit', (e) => {
  if (e.target.id === 'runForm') { e.preventDefault(); startRun(); }
  if (e.target.id === 'settingsForm') { e.preventDefault(); saveSettings(); }
});
$('#refreshBtn').addEventListener('click', () => load());

function follow(path) {
  const p = String(path || '');
  if (p.startsWith('result/')) { st.view = 'result'; st.detailFile = decodeURIComponent(p.slice(7)); st.detail = null; if (!st.loading) openResult(st.detailFile, { route: false }); return; }
  if (p.startsWith('command/')) { openCommand(decodeURIComponent(p.slice(8)), { route: false }); return; }
  if (p === 'lift') { st.view = 'lift'; render(); return; }
  if (p === 'cases') { showTab('run', { route: false }); return; }
  const t = TABS.find((x) => x.path === p.split('/')[0]) || TABS[0];
  showTab(t.id, { route: false });
}
ws.on('route', ({ path } = {}) => follow(path));
ws.on('visible', ({ visible } = {}) => { if (visible && !st.loading) load(); });
ws.on('command', ({ id } = {}) => {
  if (id === 'refresh') load();
  else if (id === 'run') showTab('run');
  else if (id === 'history') showTab('history');
  else if (id === 'improve') showTab('improve');
});

load();

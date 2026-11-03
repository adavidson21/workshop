/* Settings: the data folder, Workshop's own settings (features, allowed sites, port), each connector's
   settings and on/off switch, and moving data between browsers and computers with bundle files.

   Everything goes through the SDK (shared/workshop-sdk.js). Connector forms are generated from each
   connector's configSchema (forms.js), so a new connector needs no Settings change. PATs and other secrets
   are never entered here: a connector's settings name the environment variable that holds one, and the
   form shows whether it is set on this computer.

   Local mode (served by the agent): everything can be changed, including the data folder (dataDir).
   Hosted mode (a paired site): read-only. The agent refuses config changes from other sites.
   Browser mode (no agent): the data folder Chrome uses (choose or change it) and the data section. */
import { connect } from '../../../shared/workshop-sdk.js';
import { render as renderForm, readValue } from './forms.js';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORIGIN = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(127\.0\.0\.1|localhost):\d{1,5})$/;
const FEATURES = {
  startAtLogin: ['Start at login', 'Start Workshop when you log in to this computer. No admin rights needed.'],
  hostedMode: ['Hosted mode', 'Let the allowed sites below pair with Workshop on this computer. Each site asks once, in a pairing window.'],
  workMode: ['Work mode', 'Run Workshop from the pinned copy on this computer (built with workshop pin) instead of its site. No site can pair while it is on, and the code only changes when you update it.']
};
const ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12"/></svg>';
const FOLDER = '<svg class="path-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 2h6.6a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg>';
// One line on what each connector is for. Unknown connectors show none.
const ABOUT = {
  ado: 'Your Azure DevOps work items and pull requests, for Docket, Queue and Home.',
  opencode: 'Runs coding agents on this computer, for Dispatch.'
};
const STATE_LABEL = { ready: 'Ready', starting: 'Starting', stopped: 'Stopped', error: 'Needs attention', disabled: 'Off' };

const ws = await connect({ app: 'settings' });
const readOnly = ws.mode === 'hosted';
const content = $('#content');

function toast(text, kind) { return ws.toast(text, { kind }); }
function card(title, sub) {
  const sec = document.createElement('section');
  sec.className = 'card';
  sec.innerHTML = `<h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}`;
  content.appendChild(sec);
  return sec;
}
const errText = e => (e && e.message) || 'Something went wrong.';

/* ---------- header ---------- */
// The agent's address, from this site's pairing (hosted mode), for the "change them on this computer" link.
function agentAddress() {
  try { const p = JSON.parse(localStorage.getItem('workshop.agent') || 'null'); return p && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(p.url) ? p.url : null; } catch (e) { return null; }
}

function header() {
  const note = $('#modeNote');
  // Local: this is the page the agent serves, Workshop on this computer. Workshop itself is the hosted site.
  if (ws.mode === 'local') note.textContent = 'Workshop on this computer: sign-in, pairing and the settings only this computer can change.';
  else if (readOnly) {
    const at = agentAddress();
    note.innerHTML = 'Read only. To change these, open Workshop on this computer'
      + (at ? ` at <a class="lnk" href="${esc(at)}/" target="_blank" rel="noopener">${esc(at)}</a>.` : ' (run <code>workshop open</code>).');
    document.body.classList.add('ro');
  }
  // Browser mode: no subtitle. The "Workshop on this computer" card says how to connect, the Data folder card where data is.
}

/* ---------- data folder (docs/run-modes.md; docs/config.md, Data folder) ----------
   Agent: the agent's dataDir, changed with PUT /api/config (own origin only) and used after a restart.
   Browser: the folder Chrome reads and writes (File System Access API); choosing one copies this browser's
   data in, keeps the old copy, and reloads. Workshop never moves files between folders. */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function moveSummary(m) {
  const name = esc(m.folder || 'the folder');
  if (m.alreadyMoved) return `<p>Now using <b>${name}</b>. Nothing was copied: this browser's data went to a folder before.</p>`;
  const c = m.collections, f = m.files;
  const lines = [];
  const copied = c.created.length + c.merged.length;
  lines.push(copied ? `${plural(copied, 'collection', 'collections')} copied in (${c.created.length} new, ${c.merged.length} merged with what the folder had).` : 'No collections to copy.');
  if (f.created.length || f.same.length) lines.push(`${plural(f.created.length, 'file', 'files')} copied in${f.same.length ? `, ${f.same.length} already the same` : ''}.`);
  for (const r of f.renamed) lines.push(`The folder already had a different <code>${esc(r.from)}</code>, so it was kept and this browser's copy is <code>${esc(r.to)}</code>.`);
  for (const k of c.skipped) lines.push(`Not copied: <code>${esc(k.name)}</code>, because ${esc(k.reason)}. Export it from this browser before you change anything if you need it.`);
  return `<p>Now using <b>${name}</b>.</p><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul><p>The copy in this browser is kept as it was.</p>`;
}

async function folderCard(cfg) {
  const sec = card('Data folder', 'Every app saves its files here, one subfolder per app. It is yours: Workshop never syncs it.');
  sec.dataset.folder = ws.storage;
  const body = document.createElement('div');
  sec.appendChild(body);

  if (ws.backend === 'agent') {
    // A browser cannot hand a web page the full path of a folder you pick, so the agent's folder is typed in.
    body.innerHTML = `<div class="path"><span class="path-box">${FOLDER}<span class="mono path-text" title="${esc(cfg.dataDir)}">${esc(cfg.dataDir)}</span></span>
        ${readOnly ? '' : '<button type="button" class="btn" data-change>Change</button>'}</div>
      <form class="cfg path-edit" hidden>
        <label class="sr" for="dataDir">Folder</label><input id="dataDir" class="cfg-input mono" type="text" spellcheck="false" value="${esc(cfg.dataDir)}">
        <p class="cfg-help">A full path on this computer, outside <code>${esc(cfg.home)}</code>. Used after Workshop restarts. Files are not moved: copy them over yourself.</p>
        <div class="acts"><span class="msg" aria-live="polite"></span><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Save</button></div>
      </form>`;
    const form = body.querySelector('form');
    const input = form.querySelector('#dataDir');
    if (readOnly) { input.disabled = true; form.querySelector('.acts').remove(); return; }
    const view = body.querySelector('.path');
    const edit = on => { form.hidden = !on; view.hidden = on; if (on) { input.focus(); input.select(); } };
    body.querySelector('[data-change]').addEventListener('click', () => edit(true));
    form.querySelector('[data-cancel]').addEventListener('click', () => { input.value = cfg.dataDir; form.querySelector('.msg').textContent = ''; edit(false); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = form.querySelector('.msg');
      const dataDir = input.value.trim();
      if (!ABSOLUTE.test(dataDir)) { msg.textContent = 'Use a full path, for example /Users/you/Workshop or C:\\Users\\you\\Workshop.'; return; }
      msg.textContent = 'Saving...';
      try {
        const res = await ws.config.put({ dataDir });
        cfg.dataDir = dataDir;
        view.querySelector('.path-text').textContent = dataDir;
        msg.textContent = res.restartRequired ? 'Saved. Restart Workshop to use the new folder.' : 'Saved.';
        toast('Data folder saved', 'success');
      } catch (err) { msg.textContent = errText(err); }
    });
    return;
  }

  const st = await ws.folder.status();
  const last = ws.folder.lastMove();
  if (last) body.insertAdjacentHTML('beforeend', `<div class="moved" role="status">${moveSummary(last)}</div>`);
  const canPick = typeof window.showDirectoryPicker === 'function';
  const state = st.storage === 'folder'
    ? (st.missing ? `<p class="err">The folder <b>${esc(st.name)}</b> is missing (moved, renamed or deleted). Choose it again.</p>`
      : st.permission === 'granted' ? `<div class="path"><span class="path-box">${FOLDER}<span class="mono path-text" data-folder-name>${esc(st.name)}</span></span></div>`
      : `<div class="path"><span class="path-box">${FOLDER}<span class="mono path-text" data-folder-name>${esc(st.name)}</span></span></div><p>Click Allow access so Chrome can use it again.</p>`)
    : `<p>Saved in this browser.${canPick ? ' Choose a folder to save as files instead. To share files with Workshop on this computer, choose <code>Workshop</code> in your home folder.' : ''}</p>`
      + (st.moved ? '<p class="cfg-help">This browser\'s data was copied to a folder before, so that folder may be newer.</p>' : '');
  body.insertAdjacentHTML('beforeend', state);
  if (!canPick) {
    body.insertAdjacentHTML('beforeend', '<p class="cfg-help">To save to a folder, open Workshop in Chrome or Edge.</p>');
    return;
  }
  const acts = document.createElement('div');
  acts.className = 'acts left';
  const needsOk = st.storage === 'folder' && !st.missing && st.permission !== 'granted';
  acts.innerHTML = (needsOk ? '<button class="btn primary" data-allow>Allow access</button>' : '')
    + `<button class="btn${st.storage === 'folder' ? '' : ' primary'}" data-choose>${st.storage === 'folder' ? 'Change folder' : 'Choose folder'}</button><span class="msg" aria-live="polite"></span>`;
  body.appendChild(acts);
  if (st.storage === 'folder') body.insertAdjacentHTML('beforeend', '<p class="cfg-help">Changing the folder copies nothing from the old one.</p>');
  const msg = acts.querySelector('.msg');
  acts.querySelector('[data-choose]').addEventListener('click', async e => {
    e.target.disabled = true;
    msg.textContent = 'Choose a folder in the window Chrome opened...';
    try { await ws.folder.choose(); msg.textContent = 'Copying and switching...'; }
    catch (err) { msg.textContent = err.code === 'bad_request' ? err.message : errText(err); e.target.disabled = false; }
  });
  const allow = acts.querySelector('[data-allow]');
  if (allow) allow.addEventListener('click', async () => {
    try {
      const now = await ws.folder.allow();
      if (now.permission === 'granted' && !now.missing) { toast('Workshop can use the folder again.', 'success'); content.innerHTML = ''; start(); }
      else msg.textContent = 'Chrome did not allow it. Choose the folder again.';
    } catch (err) { msg.textContent = errText(err); }
  });
}

/* ---------- Workshop: features, allowed sites, port ---------- */
async function workshopCard(cfg) {
  const sec = card('Workshop', '');
  const form = document.createElement('form');
  form.className = 'cfg';
  const feats = Object.keys(cfg.features);
  const feature = k => {
    const [label, help] = FEATURES[k] || [k, ''];
    return `<div class="cfg-row cfg-check"><input type="checkbox" id="feat-${k}" data-feature="${k}"${cfg.features[k] ? ' checked' : ''}><label for="feat-${k}">${esc(label)}</label>${help ? `<p class="cfg-help">${esc(help)}</p>` : ''}</div>`;
  };
  // Start at login is the one most people change; the rest only matters for pairing, work mode or a clash on the port.
  const basic = feats.filter(k => k === 'startAtLogin');
  const advanced = feats.filter(k => k !== 'startAtLogin');
  form.innerHTML = basic.map(feature).join('') + `
    <details class="adv"${readOnly ? ' open' : ''}><summary>Advanced</summary>
      <p class="cfg-help adv-note">Kept in <code>${esc(cfg.home)}</code>. Most people never change these.</p>
      ${advanced.map(feature).join('')}
      <fieldset><legend>Allowed sites</legend>
        <p class="cfg-help">Sites that can pair when hosted mode is on: <code>https://</code> and a host, no path.</p>
        <div class="cfg-list" id="origins"></div>
        <button type="button" class="btn cfg-add" data-add-origin>Add a site</button>
      </fieldset>
      <div class="cfg-row"><label for="port">Port</label><input id="port" class="cfg-input mono" type="number" min="1024" max="65535" value="${cfg.port}"><p class="cfg-help">On 127.0.0.1. Used after Workshop restarts.</p></div>
    </details>
    <div class="acts"><span class="msg" aria-live="polite"></span>${readOnly ? '' : '<button class="btn primary">Save</button>'}</div>`;
  sec.appendChild(form);
  const list = form.querySelector('#origins');
  const addOrigin = v => {
    const row = document.createElement('div'); row.className = 'cfg-item';
    row.innerHTML = `<input class="cfg-input mono" type="text" aria-label="Site" placeholder="https://workshop.example.org" value="${esc(v)}"><button type="button" class="btn ghost cfg-remove">Remove</button>`;
    row.querySelector('.cfg-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
  };
  cfg.allowedOrigins.forEach(addOrigin);
  form.querySelector('[data-add-origin]').addEventListener('click', () => { addOrigin(''); list.lastElementChild.querySelector('input').focus(); });
  if (readOnly) form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = form.querySelector('.msg');
    const features = Object.fromEntries(feats.map(k => [k, form.querySelector(`[data-feature="${k}"]`).checked]));
    const allowedOrigins = [...list.querySelectorAll('input')].map(i => i.value.trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean);
    const bad = allowedOrigins.find(o => !ORIGIN.test(o));
    if (bad) { msg.textContent = `"${bad}" is not a site address. Use https:// and a host, with no path.`; return; }
    const port = Math.round(+form.querySelector('#port').value);
    if (!(port >= 1024 && port <= 65535)) { msg.textContent = 'Use a port between 1024 and 65535.'; return; }
    msg.textContent = 'Saving...';
    try {
      const res = await ws.config.put({ features, allowedOrigins: [...new Set(allowedOrigins)], port });
      msg.textContent = res.restartRequired ? 'Saved. Restart Workshop to use the new port.' : 'Saved.';
      toast('Settings saved', 'success');
    } catch (err) { msg.textContent = errText(err); }
  });
}

/* ---------- connectors ---------- */
async function connectorsCard(cfg) {
  const sec = card('Connectors', 'Turn on the ones you use. PATs never go in here: save one with <code>workshop pat</code> and name its variable in Set up.');
  let list;
  try { list = await ws.connectors.list(); } catch (e) { sec.insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); return; }
  if (!list.length) { sec.insertAdjacentHTML('beforeend', '<p class="sub">No connectors are installed.</p>'); return; }
  for (const info of list) sec.appendChild(connectorBlock(info, cfg));
}

function connectorBlock(info, cfg) {
  const box = document.createElement('div');
  box.className = 'conn';
  box.dataset.connector = info.id;
  const about = ABOUT[info.id];
  box.innerHTML = `<div class="conn-head">
      <div><h3 title="${esc(info.id)} ${esc(info.version)}">${esc(info.name)}</h3>${about ? `<p class="conn-about">${esc(about)}</p>` : ''}</div>
      <input type="checkbox" class="toggle" role="switch" aria-label="${esc(info.name)} on" data-enable${info.enabled ? ' checked' : ''}${readOnly ? ' disabled' : ''}>
    </div>
    <p class="conn-status"><span class="state" data-state></span><span class="state-msg" data-state-msg></span></p>
    <div class="conn-tools">
      <button type="button" class="btn" data-recheck hidden>Check again</button>
      <span class="msg" aria-live="polite" data-tools-msg></span>
    </div>
    <details data-details><summary>Set up</summary>
      ${!readOnly && canImport(info) ? `<div class="acts left import-row"><label class="btn">Import settings from a file<input type="file" accept=".json,application/json" data-import-file hidden></label></div>` : ''}
      <div data-form><p class="sub">Loading...</p></div></details>
    ${info.test ? `<form class="test" data-test><label for="test-${info.id}">${esc(info.test.label)}</label><input id="test-${info.id}" class="cfg-input mono" required><button class="btn">Test</button><div class="test-out" aria-live="polite"></div></form>` : ''}`;

  const showStatus = st => {
    const el = box.querySelector('[data-state]');
    el.textContent = STATE_LABEL[st.state] || st.state;
    el.dataset.state = st.state;
    box.querySelector('[data-state-msg]').textContent = st.message || '';
    // A PAT saved while Workshop runs (workshop pat) shows up here without a restart; this asks again now.
    box.querySelector('[data-recheck]').hidden = !info.enabled || (st.state === 'ready' && !st.message);
    const t = box.querySelector('[data-test]');
    if (t) t.hidden = st.state !== 'ready';
  };
  showStatus(info.status);
  ws.connectors.onStatus(info.id, showStatus);

  box.querySelector('[data-enable]').addEventListener('change', async e => {
    const on = e.target.checked;
    try {
      await ws.config.put({ connectors: { [info.id]: { enabled: on } } });
      info.enabled = on;
      toast(`${info.name} is ${on ? 'on' : 'off'}`, 'success');
      const fresh = (await ws.connectors.list()).find(c => c.id === info.id);
      if (fresh) showStatus(fresh.status);
    } catch (err) { e.target.checked = !on; toast(errText(err), 'error'); }
  });

  // The settings form is built when first opened.
  const details = box.querySelector('[data-details]');
  let built = false;
  details.addEventListener('toggle', () => { if (details.open && !built) { built = true; buildForm(info, box.querySelector('[data-form]')); } });

  const toolsMsg = box.querySelector('[data-tools-msg]');
  box.querySelector('[data-recheck]').addEventListener('click', async () => {
    toolsMsg.textContent = 'Checking...';
    try {
      const fresh = (await ws.connectors.list()).find(c => c.id === info.id);
      if (fresh) { info.enabled = fresh.enabled; showStatus(fresh.status); }
      if (built) await buildForm(info, box.querySelector('[data-form]'));
      toolsMsg.textContent = fresh && fresh.status.state === 'ready' ? 'Checked.' : 'Checked. Still not ready.';
    } catch (err) { toolsMsg.textContent = errText(err); }
  });

  const file = box.querySelector('[data-import-file]');
  if (file) file.addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toolsMsg.textContent = 'Reading...';
    let parsed;
    try { parsed = JSON.parse(await f.text()); } catch { toolsMsg.textContent = `${f.name} is not a JSON file.`; return; }
    try {
      const out = await ws.connectors.call(info.id, 'config.import', { file: withoutSecrets(parsed) });
      details.open = true; built = true;
      await buildForm(info, box.querySelector('[data-form]'), { config: out.config, notes: out.notes || [] });
      toolsMsg.textContent = `Imported ${f.name}. Nothing is saved yet: review the settings below, then Save.`;
    } catch (err) { toolsMsg.textContent = errText(err); }
  });

  const test = box.querySelector('[data-test]');
  if (test) test.addEventListener('submit', e => { e.preventDefault(); runTest(info, test); });
  return box;
}

// Import from a file (docs/connector.md): a connector's config.import setup action, called with one file.
function canImport(info) { return (info.actions || []).some(a => a.name === 'config.import' && a.setup === true && !a.write); }

// Keys that may hold a secret never leave the page, even to this computer's agent.
const SECRET_KEY = /pat|token|password|secret|key/i;
function withoutSecrets(v) {
  if (Array.isArray(v)) return v.map(withoutSecrets);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    // Names of variables that hold a secret (pat_env, patEnv, tokenEnv) are fine and needed.
    if (SECRET_KEY.test(k) && !/env$/i.test(k)) continue;
    out[k] = withoutSecrets(x);
  }
  return out;
}

// `draft` ({config, notes}) fills the form with settings not saved yet, for example from an import.
async function buildForm(info, holder, draft) {
  let cc;
  try { cc = await ws.connectors.getConfig(info.id); } catch (e) { holder.innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
  if (draft) cc = { ...cc, config: draft.config };
  holder.innerHTML = '';
  if (draft && draft.notes.length) holder.insertAdjacentHTML('beforeend', `<ul class="import-notes">${draft.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`);
  if (!Object.keys(cc.schema.properties || {}).length) { holder.innerHTML = '<p class="sub">Nothing to set.</p>'; return; }
  const form = document.createElement('form');
  form.className = 'cfg';
  let node = renderForm(cc.schema, cc.config, cc.env, { readOnly });
  form.appendChild(node);
  form.insertAdjacentHTML('beforeend', `<div class="acts"><span class="msg" aria-live="polite"></span>${readOnly ? '' : '<button class="btn primary">Save</button>'}</div>`);
  holder.appendChild(form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = form.querySelector('.msg');
    msg.textContent = 'Saving...';
    try {
      const saved = await ws.connectors.putConfig(info.id, readValue(node));
      // Rebuild with what the agent stored (defaults filled in) and fresh environment variable status.
      const next = renderForm(saved.schema, saved.config, saved.env, { readOnly });
      node.replaceWith(next); node = next;
      msg.textContent = info.enabled ? 'Saved. The connector restarted.' : 'Saved.';
      toast(`${info.name} settings saved`, 'success');
    } catch (err) { msg.textContent = errText(err); }
  });
}

// The connector's Test field (docs/connector.md, test): run its read action with one value and show the
// answer. Connector info has no argument types, so a whole number goes as a number first (for example an
// ADO work item ID), and as text if the connector refuses that.
async function runTest(info, form) {
  const out = form.querySelector('.test-out');
  const raw = form.querySelector('input').value.trim();
  if (!raw) return;
  const { action, arg } = info.test;
  out.className = 'test-out'; out.textContent = 'Testing...';
  try {
    let result;
    try { result = await ws.connectors.call(info.id, action, { [arg]: /^\d+$/.test(raw) ? Number(raw) : raw }); }
    catch (err) { if (err.code === 'bad_request' && /^\d+$/.test(raw)) result = await ws.connectors.call(info.id, action, { [arg]: raw }); else throw err; }
    out.innerHTML = summarize(result);
  } catch (err) {
    out.className = 'test-out err';
    out.textContent = errText(err);
  }
}
function summarize(result) {
  if (!result || typeof result !== 'object') return `<p>${esc(JSON.stringify(result))}</p>`;
  const head = result.title ? `<p class="test-title">${esc(result.title)}</p>` : '';
  const rows = Object.entries(result)
    .filter(([k, v]) => k !== 'title' && v !== null && typeof v !== 'object')
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return head + (rows ? `<dl>${rows}</dl>` : '');
}

/* ---------- data: bundles ---------- */
function dataCard() {
  const sec = card('Data', 'Download a copy to back up your data or move it to another browser or computer. Importing a copy merges it with what is here.');
  sec.insertAdjacentHTML('beforeend', `<div class="acts left"><button class="btn" data-export>Download a copy</button>
    <label class="btn"><input type="file" accept=".json,application/json" data-import hidden>Import a copy</label><span class="msg" aria-live="polite"></span></div>`);
  const msg = sec.querySelector('.msg');
  sec.querySelector('[data-export]').addEventListener('click', async () => {
    try {
      const bundle = await ws.data.export();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `workshop-${bundle.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      msg.textContent = bundle.collections.length ? `Downloaded ${bundle.collections.length} collection${bundle.collections.length === 1 ? '' : 's'}.` : 'Downloaded. No app has saved data yet.';
    } catch (e) { msg.textContent = errText(e); }
  });
  sec.querySelector('[data-import]').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (!bundle || bundle.schema !== 'workshop.bundle' || !Array.isArray(bundle.collections)) throw new Error('That file is not a Workshop copy.');
      const r = await ws.data.import(bundle);
      msg.textContent = `Imported: ${r.created} new, ${r.merged} merged with what was here.`;
      toast('Data imported', 'success');
    } catch (err) { msg.textContent = err instanceof SyntaxError ? 'That file is not a Workshop copy.' : errText(err); }
  });
}

/* ---------- open Workshop (local only) ----------
   The agent serves only this page. Workshop, its apps and Dispatch and Docket come from the allowed sites,
   which pair with this computer from their Connect button. */
// Work mode: the pinned copy's build.json (served by the agent), or null when there is none.
async function pinnedBuild() {
  try { const r = await fetch('/build.json', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function workCard() {
  const b = await pinnedBuild();
  if (!b) { card('Open Workshop', 'Work mode is on, but there is no usable pinned copy yet. Run <code>workshop pin</code> on this computer, then reload. Or turn work mode off below.'); return; }
  const one = (name, x) => x ? `${esc(name)} ${esc(x.ref || x.version || 'unknown version')}${x.commit ? ` <code>${esc(String(x.commit).slice(0, 12))}</code>` : ''}` : `${esc(name)} not included`;
  const sec = card('Open Workshop', 'Work mode is on: Workshop runs from the pinned copy on this computer, and no site can pair. The code only changes when you run <code>workshop update --tag</code>.');
  sec.insertAdjacentHTML('beforeend', `<p class="sub">${one('Workshop', b.workshop)} · ${one('Docket', b.docket)} · built ${esc(new Date(b.builtAt).toLocaleString())}</p><ul class="sites"><li><a class="lnk" href="/">Open Workshop</a></li></ul>`);
}

// One button to Workshop's own site. Docket and Dispatch open inside Workshop, so their sites are not listed
// here; they stay under Allowed sites (Advanced) for anyone who opens them on their own.
function sitesCard(cfg) {
  const sites = cfg.allowedOrigins || [];
  if (cfg.features && cfg.features.hostedMode !== true) { card('Open Workshop', 'Hosted mode is off, so Workshop\'s site cannot connect. Turn it on under Advanced below.'); return; }
  if (!sites.length) { card('Open Workshop', 'No sites are allowed yet. Add Workshop\'s site under Advanced below.'); return; }
  const site = sites.find(o => /\/\/workshop\./.test(o)) || sites[0];
  const sec = card('Open Workshop', 'This browser is signed in. Open Workshop and click <b>Connect</b> to pair it with this computer.');
  sec.classList.add('open-card');
  sec.insertAdjacentHTML('beforeend', `<div class="acts left"><a class="btn primary" data-open-site href="${esc(site)}/" target="_blank" rel="noopener">Open Workshop ${ARROW}</a>
    <span class="msg mono">${esc(site.replace(/^https?:\/\//, ''))}</span></div>`);
}

/* ---------- start ---------- */
async function start() {
  header();
  if (ws.backend === 'agent') {
    try {
      const cfg = await ws.config.get();
      if (ws.mode === 'local') { if (cfg.features && cfg.features.workMode) await workCard(); else sitesCard(cfg); }
      await folderCard(cfg);
      await workshopCard(cfg);
      await connectorsCard(cfg);
    } catch (e) {
      card('Workshop').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`);
    }
  } else {
    // Not paired, or the agent is not running. Pairing is Connect in the shell's rail (https only); its dialog
    // covers signing this browser in (workshop open).
    card('Workshop on this computer', 'Not connected, so connectors are off. If Workshop is not running, run <code>workshop start</code>. Then '
      + (location.protocol === 'https:' ? 'click <b>Connect</b>.' : 'open Workshop from its site and click <b>Connect</b>.'));
    await folderCard(null);
  }
  dataCard();
}
await start();

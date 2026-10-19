/* Settings: Workshop's own settings (features, allowed sites, port), each connector's settings and on/off
   switch, and moving data between browsers and computers with bundle files.

   Everything goes through the SDK (shared/workshop-sdk.js). Connector forms are generated from each
   connector's configSchema (forms.js), so a new connector needs no Settings change. PATs and other secrets
   are never entered here: a connector's settings name the environment variable that holds one, and the
   form shows whether it is set on this computer.

   Local mode (served by the agent): everything can be changed.
   Hosted mode (a paired site): read-only. The agent refuses config changes from other sites.
   Browser mode (no agent): only the data section. */
import { connect } from '../../../shared/workshop-sdk.js';
import { render as renderForm, readValue } from './forms.js';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORIGIN = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(127\.0\.0\.1|localhost):\d{1,5})$/;
const FEATURES = {
  startAtLogin: ['Start at login', 'Start Workshop when you log in to this computer. Per user, no admin rights needed.'],
  hostedMode: ['Hosted mode', 'Let the sites listed below use Workshop on this computer, after you allow each one in a pairing window. Your data stays on this computer.']
};
const STATE_LABEL = { ready: 'Ready', starting: 'Starting', stopped: 'Stopped', error: 'Error', disabled: 'Off' };

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
function header() {
  const note = $('#modeNote');
  if (ws.mode === 'local') note.textContent = 'Workshop on this computer.';
  else if (readOnly) {
    note.innerHTML = 'Read only. These are the settings of Workshop on this computer; to change them, open Workshop on this computer.';
    document.body.classList.add('ro');
  } else note.textContent = 'Workshop is not running on this computer, or this page is not connected to it. Data is saved in this browser.';
}

/* ---------- Workshop: features, allowed sites, port ---------- */
async function workshopCard(cfg) {
  const sec = card('Workshop', `Data folder: <code>${esc(cfg.home)}</code>`);
  const form = document.createElement('form');
  form.className = 'cfg';
  const feats = Object.keys(cfg.features);
  form.innerHTML = feats.map(k => {
    const [label, help] = FEATURES[k] || [k, ''];
    return `<div class="cfg-row cfg-check"><input type="checkbox" id="feat-${k}" data-feature="${k}"${cfg.features[k] ? ' checked' : ''}><label for="feat-${k}">${esc(label)}</label>${help ? `<p class="cfg-help">${esc(help)}</p>` : ''}</div>`;
  }).join('') + `
    <fieldset><legend>Allowed sites</legend>
      <p class="cfg-help">Sites, other than this computer, that may use Workshop when hosted mode is on. Each is <code>https://</code> and a host, with no path, for example <code>https://workshop.example.org</code>.</p>
      <div class="cfg-list" id="origins"></div>
      <button type="button" class="btn cfg-add" data-add-origin>Add a site</button>
    </fieldset>
    <div class="cfg-row"><label for="port">Port</label><input id="port" class="cfg-input mono" type="number" min="1024" max="65535" value="${cfg.port}"><p class="cfg-help">Workshop listens on 127.0.0.1 at this port. A change takes effect after Workshop restarts.</p></div>
    <div class="acts"><span class="msg" aria-live="polite"></span><button class="btn primary">Save</button></div>`;
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
  const sec = card('Connectors', 'Connectors are how Workshop talks to other systems. Each is off until you turn it on. Secrets such as PATs stay in environment variables on this computer; here you only name the variable.');
  let list;
  try { list = await ws.connectors.list(); } catch (e) { sec.insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); return; }
  if (!list.length) { sec.insertAdjacentHTML('beforeend', '<p class="sub">No connectors are installed.</p>'); return; }
  for (const info of list) sec.appendChild(connectorBlock(info, cfg));
}

function connectorBlock(info, cfg) {
  const box = document.createElement('div');
  box.className = 'conn';
  box.dataset.connector = info.id;
  box.innerHTML = `<div class="conn-head">
      <div><h3>${esc(info.name)}</h3><span class="ver">${esc(info.id)} ${esc(info.version)}</span></div>
      <span class="state" data-state></span>
      <label class="switch"><input type="checkbox" data-enable${info.enabled ? ' checked' : ''}${readOnly ? ' disabled' : ''}><span>On</span></label>
    </div>
    <p class="state-msg" data-state-msg></p>
    <details data-details><summary>Settings</summary><div data-form><p class="sub">Loading...</p></div></details>
    ${info.test ? `<form class="test" data-test><label for="test-${info.id}">${esc(info.test.label)}</label><input id="test-${info.id}" class="cfg-input mono" required><button class="btn">Test</button><div class="test-out" aria-live="polite"></div></form>` : ''}`;

  const showStatus = st => {
    const el = box.querySelector('[data-state]');
    el.textContent = STATE_LABEL[st.state] || st.state;
    el.dataset.state = st.state;
    box.querySelector('[data-state-msg]').textContent = st.message || '';
    const t = box.querySelector('[data-test]');
    if (t) t.hidden = st.state !== 'ready';
  };
  showStatus(info.status);
  ws.connectors.onStatus(info.id, showStatus);

  box.querySelector('[data-enable]').addEventListener('change', async e => {
    const on = e.target.checked;
    try {
      await ws.config.put({ connectors: { [info.id]: { enabled: on } } });
      toast(`${info.name} is ${on ? 'on' : 'off'}`, 'success');
      const fresh = (await ws.connectors.list()).find(c => c.id === info.id);
      if (fresh) showStatus(fresh.status);
    } catch (err) { e.target.checked = !on; toast(errText(err), 'error'); }
  });

  // The settings form is built when first opened.
  const details = box.querySelector('[data-details]');
  let built = false;
  details.addEventListener('toggle', () => { if (details.open && !built) { built = true; buildForm(info, box.querySelector('[data-form]')); } });

  const test = box.querySelector('[data-test]');
  if (test) test.addEventListener('submit', e => { e.preventDefault(); runTest(info, test); });
  return box;
}

async function buildForm(info, holder) {
  let cc;
  try { cc = await ws.connectors.getConfig(info.id); } catch (e) { holder.innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
  holder.innerHTML = '';
  if (!Object.keys(cc.schema.properties || {}).length) { holder.innerHTML = '<p class="sub">This connector has nothing to set.</p>'; return; }
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
      msg.textContent = info.enabled ? 'Saved. The connector restarted with these settings.' : 'Saved.';
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
  out.className = 'test-out'; out.textContent = 'Asking...';
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
  const sec = card('Data', ws.backend === 'agent'
    ? 'Apps that keep their data in Workshop save it in the data folder above. Download a copy to move it to another computer or keep a backup.'
    : 'Apps that keep their data in Workshop save it in this browser. Download a copy to move it to Workshop on a computer, or to another browser.');
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
      msg.textContent = bundle.collections.length ? `Downloaded ${bundle.collections.length} collection${bundle.collections.length === 1 ? '' : 's'}.` : 'Downloaded. No app has saved data in Workshop yet.';
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

/* ---------- start ---------- */
header();
if (ws.backend === 'agent') {
  try {
    const cfg = await ws.config.get();
    await workshopCard(cfg);
    await connectorsCard(cfg);
  } catch (e) {
    card('Workshop').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`);
  }
} else {
  card('Workshop on this computer', `Workshop is not running here, or this page is not connected to it. To use connectors and keep data in files, start Workshop on your computer and open the address it prints${location.protocol === 'https:' ? ', or use Connect on the left to pair this site with it' : ''}.`);
}
dataCard();

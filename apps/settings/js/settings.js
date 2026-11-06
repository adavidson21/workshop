/* Settings: the data folder, Workshop's own settings (features, allowed sites, port), each connector's
   settings and on/off switch, and moving data between browsers and computers with bundle files.

   Everything goes through the SDK (shared/workshop-sdk.js). Connector forms are generated from each
   connector's configSchema (forms.js), so a new connector needs no Settings change. PATs and other secrets
   are never entered here: a connector's settings name the environment variable that holds one, and the
   form shows whether it is set on this computer.

   Local mode (served by the agent): everything can be changed, including the data folder (dataDir).
   Hosted mode (a paired site): read-only. The agent refuses config changes from other sites.
   Browser mode (no agent): the data folder Chrome uses (choose or change it) and the data section.
   People and your team's area paths are their own app (apps/people). */
import { connect } from '../../../shared/workshop-sdk.js';
import { render as renderForm, readValue } from './forms.js';
import * as R from './repos.js';

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
  ado: 'Your Azure DevOps work items and pull requests, for Docket and Runway.',
  opencode: 'Runs coding agents on this computer, for Dispatch.'
};
const STATE_LABEL = { ready: 'Ready', starting: 'Starting', stopped: 'Stopped', error: 'Needs attention', disabled: 'Off' };

const ws = await connect({ app: 'settings' });
const readOnly = ws.mode === 'hosted';
const content = $('#content');

function toast(text, kind) { return ws.toast(text, { kind }); }

/* ---------- tabs ----------
   General, Repos (when the ADO or opencode connector is installed), one tab per connector (from the connector
   list, so a new connector gets its own tab), Data. #/settings/<tab> opens a tab (repos, data); #/settings/people opens the People app. Each tab is a panel in #content; cards go into the panel named when they are made. The last tab
   opened is remembered in this browser. */
const tabsEl = $('#tabs');
const TAB_KEY = 'workshop.settings.tab';
const TAB_ORDER = { general: 0, apps: 4, repos: 5, connectors: 10, data: 90 }; // connectors take 10, 11, ... in list order
let wantTab = 'general';
try { wantTab = localStorage.getItem(TAB_KEY) || 'general'; } catch (e) { /* storage blocked: start on General */ }

function selectTab(id, remember) {
  for (const b of tabsEl.querySelectorAll('[role=tab]')) {
    const on = b.dataset.tab === id;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    $(`#panel-${b.dataset.tab}`).hidden = !on;
  }
  if (remember) { wantTab = id; try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* not remembered */ } }
}
function panel(id, label, order) {
  let p = $(`#panel-${id}`);
  if (p) return p;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tab';
  btn.id = `tab-${id}`;
  btn.dataset.tab = id;
  btn.dataset.order = order;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-controls', `panel-${id}`);
  btn.innerHTML = `<span>${esc(label)}</span>`;
  const after = [...tabsEl.children].find(b => Number(b.dataset.order) > order);
  tabsEl.insertBefore(btn, after || null);
  p = document.createElement('div');
  p.id = `panel-${id}`;
  p.className = 'panel';
  p.setAttribute('role', 'tabpanel');
  p.setAttribute('aria-labelledby', btn.id);
  content.appendChild(p);
  // Show the remembered tab once it exists; until then, General.
  const cur = tabsEl.querySelector('[aria-selected=true]');
  if (id === wantTab || !cur) selectTab(id);
  else { p.hidden = true; btn.setAttribute('aria-selected', 'false'); btn.tabIndex = -1; }
  return p;
}
const TAB_LABEL = { general: 'General', apps: 'Apps', repos: 'Repos', connectors: 'Connectors', data: 'Data' };
tabsEl.addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) selectTab(b.dataset.tab, true); });
tabsEl.addEventListener('keydown', e => {
  const tabs = [...tabsEl.querySelectorAll('[role=tab]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  const t = tabs[(j + tabs.length) % tabs.length];
  t.focus(); selectTab(t.dataset.tab, true);
});
// #/settings/repos and the like: open that tab now, or as soon as it exists.
const ROUTE_TAB = { repos: 'repos', data: 'data', general: 'general' };
ws.on('route', ({ path } = {}) => {
  const first = String(path || '').split('/')[0];
  // People moved to its own app: old links (#/settings/people, Rapport's "Open People") go there.
  if (first === 'people' && ws.embedded) { ws.open({ app: 'people' }).catch(() => {}); return; }
  const id = ROUTE_TAB[first];
  if (!id) return;
  wantTab = id;
  if ($(`#panel-${id}`)) selectTab(id);
});

// A card in a tab (General unless named). A card with no title starts with its own heading.
function card(title, sub, tab = 'general') {
  const sec = document.createElement('section');
  sec.className = 'card';
  sec.innerHTML = `${title ? `<h2>${esc(title)}</h2>` : ''}${sub ? `<p class="sub">${sub}</p>` : ''}`;
  panel(tab, TAB_LABEL[tab] || tab, TAB_ORDER[tab] ?? 50).appendChild(sec);
  return sec;
}
const errText = e => (e && e.message) || 'Something went wrong.';
// A link or button with data-goto-tab="<tab>" switches tabs, for example from a connector's note to Repos.
content.addEventListener('click', e => {
  const g = e.target.closest('[data-goto-tab]');
  if (!g || !$(`#panel-${g.dataset.gotoTab}`)) return;
  e.preventDefault();
  selectTab(g.dataset.gotoTab, true);
  tabsEl.querySelector(`[data-tab="${g.dataset.gotoTab}"]`).focus();
});

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
  const sec = card('Data folder', 'Every app saves its files here, one subfolder per app. It is yours: Workshop never syncs it.', 'data');
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

/* ---------- apps: one switch each (docs/apps.md) ----------
   Agent: GET /api/app-switches; changed from Workshop on this computer only (PUT). In work mode turning one
   on or off rebuilds the pinned copy from what is on this computer. An app in its own repo that is not
   downloaded yet needs one command on this computer (the agent never downloads anything itself).
   Browser mode: the switches are kept in this browser and only change the rail. */
const OFF_KEY = 'workshop.appsOff';
async function agentCall(method, pathname, body) {
  let base = '', token = null;
  if (ws.mode === 'local') {
    const s = await fetch('/api/session', { cache: 'no-store' });
    if (s.ok) token = (await s.json()).token;
  } else {
    try { const p = JSON.parse(localStorage.getItem('workshop.agent') || 'null'); if (p) { base = p.url; token = p.token; } } catch (e) { /* not paired */ }
  }
  const headers = { ...(token ? { 'X-Workshop-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(base + pathname, { method, headers, cache: 'no-store', targetAddressSpace: 'loopback', body: body ? JSON.stringify(body) : undefined });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `Workshop answered ${r.status}.`);
  return out;
}
const browserOff = () => { try { const v = JSON.parse(localStorage.getItem(OFF_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (e) { return new Set(); } };

function copyBtn(text) {
  return `<button type="button" class="btn ghost app-copy" data-copy="${esc(text)}">Copy</button>`;
}

async function appsCard() {
  const intro = ws.backend !== 'agent' ? 'Turn an app off to take it out of the rail in this browser.'
    : 'Turn an app off to take it out of Workshop\'s rail. In work mode the pinned copy is rebuilt for you.';
  const sec = card('Apps', intro, 'apps');
  const box = document.createElement('div');
  sec.appendChild(box);
  const reload = document.createElement('div');
  reload.className = 'acts left app-reload';
  reload.hidden = true;
  reload.innerHTML = '<button type="button" class="btn primary">Reload Workshop</button><span class="msg">to see the change.</span>';
  reload.querySelector('button').addEventListener('click', () => { try { window.top.location.reload(); } catch (e) { location.reload(); } });
  sec.appendChild(reload);

  let view;
  if (ws.backend === 'agent') {
    try { view = await agentCall('GET', '/api/app-switches'); }
    catch (e) { box.innerHTML = `<p class="err">${esc(errText(e))} If Workshop on this computer was just updated, run <code>workshop restart</code>.</p>`; return; }
  } else {
    let reg = null;
    try { const r = await fetch('../registry.json', { cache: 'no-store' }); if (r.ok) reg = await r.json(); } catch (e) { /* none */ }
    const off = browserOff();
    view = { workMode: false, apps: ((reg && reg.apps) || []).map(a => a.manifest).sort((x, y) => (x.order ?? Infinity) - (y.order ?? Infinity))
      .map(m => ({ id: m.id, name: m.name, description: m.description || '', on: !off.has(m.id), canTurnOff: m.home !== true && m.id !== 'settings', inWorkshop: !off.has(m.id) })) };
  }
  if (view.workMode && view.pinned === false) box.insertAdjacentHTML('beforeend', `<p class="sub">There is no pinned copy yet. Run this on your computer: <code>workshop pin</code> ${copyBtn('workshop pin')}</p>`);

  const status = a => {
    if (!a.canTurnOff) return 'Always on.';
    if (!a.on) return 'Off. Not in the rail.';
    if (view.workMode && a.separate && !a.downloaded) return `Not downloaded yet, so it is not in Workshop. Run this on your computer, then reload: <code>${esc(a.command)}</code> ${copyBtn(a.command)}`;
    if (view.workMode && !a.inWorkshop) return `Not in the pinned copy yet. Run <code>workshop pin</code> ${copyBtn('workshop pin')}`;
    if (view.workMode && a.separate) return `In Workshop${a.ref ? `, ${esc(a.ref)}` : ''}.`;
    return 'In the rail.';
  };
  const render = () => {
    box.querySelectorAll('.app-row').forEach(el => el.remove());
    for (const a of view.apps) {
      const row = document.createElement('div');
      row.className = 'app-row';
      row.dataset.app = a.id;
      const locked = readOnly || !a.canTurnOff;
      row.innerHTML = `<div class="conn-head">
          <div><h3>${esc(a.name)}</h3>${a.description ? `<p class="conn-about">${esc(a.description)}</p>` : ''}</div>
          <input type="checkbox" class="toggle" role="switch" aria-label="${esc(a.name)} on"${a.on ? ' checked' : ''}${locked ? ' disabled' : ''}>
        </div>
        <p class="conn-status app-status">${status(a)}</p>`;
      row.querySelector('.toggle').addEventListener('change', e => flip(a, e.target));
      box.appendChild(row);
    }
  };
  async function flip(a, input) {
    const on = input.checked;
    input.disabled = true;
    const st = input.closest('.app-row').querySelector('.app-status');
    st.textContent = view.workMode ? 'Rebuilding the pinned copy...' : 'Saving...';
    try {
      if (ws.backend === 'agent') view = await agentCall('PUT', `/api/app-switches/${encodeURIComponent(a.id)}`, { on });
      else {
        const off = browserOff();
        if (on) off.delete(a.id); else off.add(a.id);
        try { localStorage.setItem(OFF_KEY, JSON.stringify([...off])); } catch (e) { throw new Error('This browser could not save it.'); }
        view.apps = view.apps.map(x => x.id === a.id ? { ...x, on, inWorkshop: on } : x);
      }
      render();
      const now = view.apps.find(x => x.id === a.id);
      toast(view.download ? `${a.name} is on. Download it to finish.` : `${a.name} is ${on ? 'on' : 'off'}`, 'success');
      reload.hidden = Boolean(view.download) && now && now.on;
    } catch (err) {
      input.checked = !on;
      input.disabled = false;
      st.innerHTML = status(a);
      toast(errText(err), 'error');
    }
  }
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }
    catch (err) { toast('Could not copy. Select the command and copy it instead.', 'error'); }
  });
  render();
  if (readOnly) sec.insertAdjacentHTML('beforeend', '<p class="sub">Change these from Workshop on this computer.</p>');
}

/* ---------- connectors ---------- */
// One tab per connector, in list order, with its status as a dot on the tab.
const NOTE = {
  ado: 'PATs never go in here: save one with <code>workshop pat</code> and name its variable in Set up. Repos and pull request sources are on the <a href="#" class="lnk" data-goto-tab="repos">Repos</a> tab.'
};
async function connectorsCard(cfg) {
  let list;
  try { list = await ws.connectors.list(); }
  catch (e) { card('Connectors', '', 'connectors').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); return; }
  if (!list.length) { card('Connectors', 'No connectors are installed.', 'connectors'); return list; }
  list.forEach((info, i) => {
    const tab = `c-${info.id}`;
    panel(tab, info.name, 10 + i);
    const sec = card('', '', tab);
    sec.appendChild(connectorBlock(info, cfg, st => {
      const b = $(`#tab-${tab}`);
      let dot = b.querySelector('.tab-dot');
      if (!dot) { dot = document.createElement('span'); dot.className = 'tab-dot'; b.prepend(dot); }
      dot.dataset.state = st.state;
      dot.title = STATE_LABEL[st.state] || st.state;
    }));
    if (NOTE[info.id]) sec.insertAdjacentHTML('beforeend', `<p class="sub conn-note">${NOTE[info.id]}</p>`);
  });
  return list;
}

function connectorBlock(info, cfg, onState) {
  const box = document.createElement('div');
  box.className = 'conn';
  box.dataset.connector = info.id;
  const about = ABOUT[info.id];
  box.innerHTML = `<div class="conn-head">
      <div><h3 title="${esc(info.id)} ${esc(info.version)}">${esc(info.name)}</h3>${about ? `<p class="conn-about">${esc(about)}</p>` : ''}</div>
      <input type="checkbox" class="toggle" role="switch" aria-label="${esc(info.name)} on" data-enable${info.enabled ? ' checked' : ''}${readOnly ? ' disabled' : ''}>
    </div>
    <p class="conn-status"><span class="state" data-state></span><span class="state-msg" data-state-msg></span></p>
    ${!readOnly && canFromUrl(info) ? `<form class="from-url" data-from-url><label for="url-${esc(info.id)}">Paste any link from ${esc(info.name)}</label>
      <div class="from-url-row"><input id="url-${esc(info.id)}" class="cfg-input mono" type="url" required placeholder="https://ado.example.com/tfs/Main/Project/_workitems/edit/123" autocomplete="off"><button class="btn">Fill in</button></div>
      <p class="cfg-help">A work item, board, repo or pull request link works. Workshop reads the server, collection and project from it; you review before saving.</p></form>` : ''}
    <div class="conn-tools">
      <button type="button" class="btn" data-recheck hidden>Check again</button>
      <span class="msg" aria-live="polite" data-tools-msg></span>
    </div>
    <details data-details><summary>Set up</summary>
      ${!readOnly && canImport(info) ? `<div class="acts left import-row"><label class="btn">Import settings from a file<input type="file" accept=".json,application/json" data-import-file hidden></label></div>` : ''}
      <div data-form><p class="sub">Loading...</p></div></details>
    ${info.test ? `<form class="test" data-test><label for="test-${info.id}">${esc(info.test.label)}</label><input id="test-${info.id}" class="cfg-input mono" required><button class="btn">Test</button><div class="test-out" aria-live="polite"></div></form>` : ''}`;

  const showStatus = st => {
    if (onState) onState(st);
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

  const fromUrl = box.querySelector('[data-from-url]');
  if (fromUrl) fromUrl.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = fromUrl.querySelector('button');
    btn.disabled = true; toolsMsg.textContent = 'Reading the link...';
    try {
      // Pasting a link means setting it up, so an off connector is turned on first (the agent refuses calls to it).
      if (!info.enabled) {
        await ws.config.put({ connectors: { [info.id]: { enabled: true } } });
        info.enabled = true;
        box.querySelector('[data-enable]').checked = true;
        await new Promise(r => setTimeout(r, 300));
        const fresh = (await ws.connectors.list()).find(c => c.id === info.id);
        if (fresh) showStatus(fresh.status);
      }
      const out = await ws.connectors.call(info.id, 'config.fromUrl', { url: fromUrl.querySelector('input').value });
      details.open = true; built = true;
      await buildForm(info, box.querySelector('[data-form]'), { config: out.config, notes: out.notes || [] });
      toolsMsg.textContent = 'Filled in from the link. Nothing is saved yet: check Set up below, then Save.';
      fromUrl.reset();
    } catch (err) { toolsMsg.textContent = errText(err); }
    btn.disabled = false;
  });

  const test = box.querySelector('[data-test]');
  if (test) test.addEventListener('submit', e => { e.preventDefault(); runTest(info, test); });
  return box;
}

// Import from a file (docs/connector.md): a connector's config.import setup action, called with one file.
// Paste a link: a connector's config.fromUrl setup action, called with {url}; returns {config, notes} like an import.
function canFromUrl(info) { return (info.actions || []).some(a => a.name === 'config.fromUrl' && a.setup === true && !a.write); }
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
      const value = readValue(node);
      // Fields edited on another tab (Repos) may have changed since this form opened: save what is there now,
      // unless it is empty and this form has a value (a link or import filled it in).
      const away = Object.keys(cc.schema.properties || {}).filter(k => cc.schema.properties[k]['x-workshop-tab']);
      if (away.length) {
        const now = (await ws.connectors.getConfig(info.id)).config || {};
        for (const k of away) {
          const has = Array.isArray(now[k]) ? now[k].length > 0 : now[k] != null;
          if (has || value[k] === undefined) { if (now[k] === undefined) delete value[k]; else value[k] = now[k]; }
        }
      }
      const saved = await ws.connectors.putConfig(info.id, value);
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

/* ---------- repos (repos.js) ----------
   One tab for everything about a repo: the repos in your workspace (opencode's state), the Azure DevOps
   project each one uses (ADO `paths`), whether Docket shows its pull requests (ADO `prSources`), and adding
   one (clone, map, watch, then draft its guide). Those two ADO fields are marked x-workshop-tab and
   x-workshop-hosted, so they are left out of the ADO tab's form and can be saved from a paired site too. */
const NEW_CAT = '\u0000new';
async function reposTab(list) {
  const adoInfo = list.find(c => c.id === 'ado');
  const ocInfo = list.find(c => c.id === 'opencode');
  if (!adoInfo && !ocInfo) return;
  const st = { ado: null, oc: null, ocError: '', rows: [], editing: null, editingMap: null, adding: false, added: null, busy: false };
  const main = card('Repos', 'The repos in your workspace, the Azure DevOps project each one uses, and whether Docket shows its pull requests.', 'repos');
  const body = document.createElement('div'); main.appendChild(body);
  const prSec = adoInfo ? card('Pull requests', 'Where Docket looks for pull requests waiting on you.', 'repos') : null;
  const prBody = prSec ? prSec.appendChild(document.createElement('div')) : null;
  const mapSec = adoInfo ? card('Other folders', 'Folders outside your workspace, or patterns, and the connection they use. <code>*</code> matches any characters.', 'repos') : null;
  const mapBody = mapSec ? mapSec.appendChild(document.createElement('div')) : null;

  const cfg = () => (st.ado && st.ado.config) || {};
  const conns = () => (Array.isArray(cfg().connections) ? cfg().connections : []);
  const canMap = () => !!st.ado && conns().length > 0;
  const ocReady = () => !!st.oc;
  const connOptions = (cur, blank) => (blank ? `<option value=""${!cur ? ' selected' : ''}>${esc(blank)}</option>` : '')
    + conns().map(c => `<option value="${esc(c.name)}"${c.name === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const projectOf = name => { const c = conns().find(x => x.name === name); return (c && c.project) || ''; };

  async function load() {
    st.ado = null; st.oc = null; st.ocError = '';
    if (adoInfo) { try { st.ado = await ws.connectors.getConfig('ado'); } catch (e) { st.ado = null; } }
    const fresh = ocInfo ? ((await ws.connectors.list().catch(() => list)).find(c => c.id === 'opencode') || ocInfo) : null;
    if (fresh && fresh.enabled && fresh.status && fresh.status.state === 'ready') {
      try { st.oc = await ws.connectors.call('opencode', 'state'); } catch (e) { st.ocError = errText(e); }
    } else if (fresh) st.ocError = fresh.enabled ? (fresh.status && fresh.status.message) || 'opencode is not ready yet.' : '';
    st.rows = R.rows(st.oc || {}, cfg());
  }

  async function saveAdo(next, okText, msgEl) {
    if (msgEl) msgEl.textContent = 'Saving...';
    try {
      st.ado = await ws.connectors.putConfig('ado', next);
      st.rows = R.rows(st.oc || {}, cfg());
      toast(okText, 'success');
      return true;
    } catch (err) { if (msgEl) msgEl.textContent = errText(err); else toast(errText(err), 'error'); return false; }
  }

  function adoLine(r) {
    if (!st.ado) return '';
    if (!r.ado) {
      if (r.remote && !r.remote.connection) return `<p class="repo-meta">Its remote is on <span class="mono">${esc(r.remote.base)}</span>, which is not one of your connections.</p>`;
      return '<p class="repo-meta">No Azure DevOps project.</p>';
    }
    const watch = r.watch === 'project' ? 'PRs shown (whole project)' : r.watch === 'repo' ? 'PRs shown' : 'PRs not shown';
    const found = r.ado.from === 'remote' ? ' <span class="repo-tag">from its remote, not saved</span>' : '';
    return `<p class="repo-meta">${esc(r.ado.connection)} · ${esc(r.ado.project || 'no project')} · ${esc(r.ado.repo)} · ${watch}${found}</p>`;
  }

  function repoForm(r) {
    const a = r.ado || { connection: (r.remote && r.remote.connection) || cfg().defaultConnection || (conns()[0] && conns()[0].name) || '', project: (r.remote && r.remote.project) || '', repo: r.name };
    const whole = R.watchOf(cfg(), a.connection, a.project || projectOf(a.connection), a.repo) === 'project';
    return `<form class="cfg repo-form" data-repo-form="${esc(r.folder)}">
      <div class="cfg-row"><label for="rConn">Connection</label><select id="rConn" name="connection" class="cfg-input">${connOptions(a.connection, 'None')}</select></div>
      <div class="cfg-row"><label for="rProj">Project</label><input id="rProj" name="project" class="cfg-input" maxlength="200" value="${esc(a.project)}" placeholder="${esc(projectOf(a.connection))}"></div>
      <div class="cfg-row"><label for="rName">Repo name in Azure DevOps</label><input id="rName" name="repo" class="cfg-input mono" maxlength="200" value="${esc(a.repo || r.name)}" required></div>
      <div class="cfg-row cfg-check"><input id="rWatch" name="watch" type="checkbox"${r.watch !== 'no' || !r.ado ? ' checked' : ''}${whole ? ' disabled' : ''}><label for="rWatch">Show its pull requests in Docket</label>
        ${whole ? '<p class="cfg-help">Every repo in this project is shown. Change that under Pull requests below.</p>' : ''}</div>
      <div class="acts"><span class="msg" aria-live="polite"></span><button type="button" class="btn" data-repo-cancel>Cancel</button><button class="btn primary">Save</button></div></form>`;
  }

  function addForm() {
    const cats = (st.oc && st.oc.repoCategories) || [];
    return `<form class="cfg repo-add" data-repo-add>
      <div class="cfg-row"><label for="raUrl">Clone URL</label><input id="raUrl" name="url" class="cfg-input mono" required spellcheck="false" autocomplete="off" placeholder="https://ado.example.com/Collection/Project/_git/repo"></div>
      <div class="cfg-row"><label for="raCat">Category</label><select id="raCat" name="category" class="cfg-input">
        <option value="">None (top of the workspace)</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}<option value="${NEW_CAT}">New category</option></select>
        <p class="cfg-help">The folder in your workspace it goes in.</p></div>
      <div class="cfg-row" data-newcat hidden><label for="raNew">New category folder</label><input id="raNew" name="newcat" class="cfg-input mono" maxlength="100" placeholder="Platform" spellcheck="false"></div>
      <div class="cfg-row"><label for="raAbout">What it is, in one line</label><input id="raAbout" name="about" class="cfg-input" maxlength="200" placeholder="The web app customers use"><p class="cfg-help">Optional. Helps agents pick the right repo for a task.</p></div>
      ${canMap() ? '<div class="cfg-row cfg-check"><input id="raWatch" name="watch" type="checkbox" checked><label for="raWatch">Show its pull requests in Docket</label><p class="cfg-help">For Azure DevOps repos. The connection and project come from the URL.</p></div>' : ''}
      <div class="acts"><span class="msg" aria-live="polite"></span><button type="button" class="btn" data-add-cancel>Cancel</button><button class="btn primary"${st.busy ? ' disabled' : ''}>${st.busy ? 'Cloning...' : 'Clone into workspace'}</button></div></form>`;
  }

  function paint() {
    const notes = [];
    if (!ocInfo) notes.push('The opencode connector is not installed, so workspace repos are not listed here.');
    else if (!st.oc) notes.push(st.ocError ? `Workspace repos need opencode: ${esc(st.ocError)}` : 'Turn on opencode on its <a href="#" class="lnk" data-goto-tab="c-opencode">tab</a> to list and add your workspace repos.');
    if (adoInfo && st.ado && !conns().length) notes.push('Add an Azure DevOps connection first: paste any ADO link on the <a href="#" class="lnk" data-goto-tab="c-ado">Azure DevOps</a> tab.');
    const todo = canMap() ? R.unmapped(st.rows) : [];
    const items = st.rows.map(r => st.editing === r.folder
      ? `<li class="repo editing"><p class="repo-name mono">${esc(r.folder)}</p>${repoForm(r)}</li>`
      : `<li class="repo"><div><p class="repo-name"><span class="mono">${esc(r.folder)}</span>${r.web ? ` <a class="lnk repo-web" href="${esc(r.web)}" target="_blank" rel="noopener" aria-label="Open ${esc(r.folder)}">${ARROW}</a>` : ''}</p>${adoLine(r)}</div>
          ${canMap() ? `<button type="button" class="btn" data-repo-edit="${esc(r.folder)}">${r.ado && r.ado.from === 'mapping' ? 'Edit' : 'Set up'}</button>` : ''}</li>`).join('');
    const added = st.added ? `<div class="moved" role="status"><p><b>${esc(st.added.folder)}</b> is in your workspace.${st.added.notes.map(n => ' ' + esc(n)).join('')}</p>
        <p>Next, draft its guide: an agent writes how to build, test and navigate it, for you to review. Follow it in Dispatch.</p>
        <div class="acts left"><button type="button" class="btn primary" data-guide="${esc(st.added.folder)}">Draft its guide</button><button type="button" class="btn" data-added-close>Later</button></div></div>` : '';
    body.innerHTML = (notes.length ? `<ul class="import-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '')
      + added
      + (todo.length ? `<div class="repo-todo"><p>${plural(todo.length, 'repo points', 'repos point')} at Azure DevOps but ${todo.length === 1 ? 'is' : 'are'} not saved yet, so agents may pick the wrong project.</p><button type="button" class="btn primary" data-map-all>Save ${todo.length === 1 ? 'it' : 'them'}</button></div>` : '')
      + (st.oc ? (st.rows.length ? `<ul class="people repos">${items}</ul>` : `<p class="sub">No repos in your workspace (<code>${esc(st.oc.workspace || '')}</code>) yet.</p>`) : '')
      + (st.oc ? (st.adding ? addForm() : '<div class="acts left"><button type="button" class="btn primary" data-add-open>Add a repo</button></div>') : '');
    if (st.adding) body.querySelector('#raUrl').focus();
    const first = body.querySelector('.repo.editing input');
    if (first) first.focus();
    paintSources(); paintMappings();
  }

  function paintSources() {
    if (!prBody) return;
    if (!canMap()) { prBody.innerHTML = '<p class="sub">Add an Azure DevOps connection first.</p>'; return; }
    const srcs = Array.isArray(cfg().prSources) ? cfg().prSources : [];
    const li = srcs.map((s, i) => {
      const all = !(s.repos || []).length;
      return `<li class="person"><div><b>${esc(s.project)}</b> <span class="handle">${esc(s.connection)}</span>
          <p class="person-meta">${all ? 'Every repo in the project' : `Only ${s.repos.map(esc).join(', ')}`}</p></div>
        <select class="cfg-input src-scope" data-src-scope="${i}" aria-label="Which repos in ${esc(s.project)}"><option value="all"${all ? ' selected' : ''}>Every repo</option><option value="some"${all ? '' : ' selected'}>Only repos set to show</option></select>
        <button type="button" class="btn ghost" data-src-remove="${i}">Remove</button></li>`;
    }).join('');
    prBody.innerHTML = (srcs.length ? `<ul class="people">${li}</ul>` : '<p class="sub">None yet, so Docket shows no pull requests. Set a repo to show its PRs above, or add a whole project.</p>')
      + `<form class="cfg src-add" data-src-add><div class="from-url-row"><select name="connection" class="cfg-input" aria-label="Connection">${connOptions(cfg().defaultConnection || (conns()[0] && conns()[0].name))}</select>
        <input name="project" class="cfg-input" maxlength="200" placeholder="Project" aria-label="Project" required><button class="btn">Add whole project</button></div><span class="msg" aria-live="polite"></span></form>`;
  }

  function paintMappings() {
    if (!mapBody) return;
    if (!canMap()) { mapBody.innerHTML = '<p class="sub">Add an Azure DevOps connection first.</p>'; return; }
    const others = R.otherMappings(cfg(), st.rows);
    const form = (m, key) => `<form class="cfg map-form" data-map-form="${key}">
        <div class="cfg-row"><label for="m${key}p">Folder or pattern</label><input id="m${key}p" name="path" class="cfg-input mono" required value="${esc(m.path || '')}" placeholder="C:/src/team/*" spellcheck="false"></div>
        <div class="cfg-row"><label for="m${key}c">Connection</label><select id="m${key}c" name="connection" class="cfg-input">${connOptions(m.connection || cfg().defaultConnection)}</select></div>
        <div class="cfg-row"><label for="m${key}j">Project</label><input id="m${key}j" name="project" class="cfg-input" value="${esc(m.project || '')}" placeholder="The connection's project"></div>
        <div class="acts"><span class="msg" aria-live="polite"></span>${key !== 'new' ? `<button type="button" class="btn" data-map-remove="${key}">Remove</button>` : ''}<button type="button" class="btn" data-map-cancel>Cancel</button><button class="btn primary">Save</button></div></form>`;
    const li = others.map(m => String(st.editingMap) === String(m.index)
      ? `<li class="person editing">${form(m, m.index)}</li>`
      : `<li class="person"><div><span class="mono">${esc(m.path)}</span><p class="person-meta">${esc(m.connection)}${m.project ? ` · ${esc(m.project)}` : ''}</p></div><button type="button" class="btn" data-map-edit="${m.index}">Edit</button></li>`).join('');
    mapBody.innerHTML = (others.length ? `<ul class="people">${li}</ul>` : '<p class="sub">None. Repos in your workspace are set up above.</p>')
      + (st.editingMap === 'new' ? `<div class="person editing">${form({}, 'new')}</div>` : '<div class="acts left"><button type="button" class="btn" data-map-new>Add a folder</button></div>');
  }

  async function addRepo(form) {
    const fd = new FormData(form);
    const msg = form.querySelector('.msg');
    const url = String(fd.get('url') || '').trim();
    let category = String(fd.get('category') || '');
    if (category === NEW_CAT) category = String(fd.get('newcat') || '').trim();
    if (fd.get('category') === NEW_CAT && !category) { msg.textContent = 'Name the new category folder.'; return; }
    const about = String(fd.get('about') || '').trim();
    st.busy = true; msg.textContent = 'Cloning with the git sign-in on this computer...';
    form.querySelector('button.primary').disabled = true;
    let res;
    try { res = await ws.connectors.call('opencode', 'repo.add', { url, ...(category ? { category } : {}), ...(about ? { about } : {}) }, { confirm: true }); }
    catch (err) { st.busy = false; msg.textContent = errText(err); form.querySelector('button.primary').disabled = false; return; }
    st.busy = false;
    const notes = [];
    const hit = canMap() ? R.fromCloneUrl(cfg(), url) : null;
    try { st.oc = await ws.connectors.call('opencode', 'state'); } catch (e) { /* the list refreshes on the next load */ }
    st.rows = R.rows(st.oc || {}, cfg());
    if (hit && hit.connection) {
      const path = R.folderPath(st.oc && st.oc.workspace, res.folder);
      const ok = await saveAdo(R.saveRepo(cfg(), { path, connection: hit.connection, project: hit.project, repo: hit.repo, watch: fd.get('watch') === 'on' }), `${res.folder} added`);
      notes.push(ok ? `It uses ${hit.connection} · ${hit.project}${fd.get('watch') === 'on' ? ', and Docket shows its pull requests' : ''}.` : 'Its Azure DevOps project could not be saved; use Set up on its row.');
    } else if (hit) notes.push(`Its server (${hit.base}) is not one of your Azure DevOps connections, so it is not set up for ADO.`);
    else toast(`${res.folder} added`, 'success');
    st.added = { folder: res.folder, notes };
    st.adding = false;
    paint();
  }

  main.addEventListener('change', e => {
    if (e.target.name === 'category') main.querySelector('[data-newcat]').hidden = e.target.value !== NEW_CAT;
    if (e.target.name === 'connection' && e.target.closest('[data-repo-form]')) e.target.form.project.placeholder = projectOf(e.target.value);
  });
  main.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-repo-edit]')) { st.editing = t.dataset.repoEdit; return paint(); }
    if (t.matches('[data-repo-cancel]')) { st.editing = null; return paint(); }
    if (t.matches('[data-add-open]')) { st.adding = true; st.added = null; return paint(); }
    if (t.matches('[data-add-cancel]')) { st.adding = false; return paint(); }
    if (t.matches('[data-added-close]')) { st.added = null; return paint(); }
    if (t.matches('[data-map-all]')) { t.disabled = true; if (await saveAdo(R.mapAll(cfg(), st.rows), 'Repos saved')) paint(); else t.disabled = false; return; }
    if (t.matches('[data-guide]')) {
      t.disabled = true;
      try { await ws.connectors.call('opencode', 'repo.guide', { repo: t.dataset.guide }, { confirm: true }); toast(`Drafting the guide for ${t.dataset.guide}. Follow it in Dispatch.`, 'success'); st.added = null; paint(); }
      catch (err) { t.disabled = false; toast(errText(err), 'error'); }
    }
  });
  main.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    if (form.matches('[data-repo-add]')) return addRepo(form);
    if (!form.matches('[data-repo-form]')) return;
    const r = st.rows.find(x => x.folder === form.dataset.repoForm);
    if (!r) return;
    const fd = new FormData(form);
    const was = r.ado ? { connection: r.ado.connection, project: r.ado.project, repo: r.ado.repo } : null;
    const watchBox = form.querySelector('[name=watch]');
    const next = R.saveRepo(cfg(), { path: r.path, connection: fd.get('connection'), project: fd.get('project'), repo: fd.get('repo'),
      watch: watchBox.disabled ? true : watchBox.checked, was });
    if (await saveAdo(next, `${r.folder} saved`, form.querySelector('.msg'))) { st.editing = null; paint(); }
  });

  if (prSec) {
    prSec.addEventListener('change', async e => {
      const sel = e.target.closest('[data-src-scope]');
      if (!sel) return;
      const i = Number(sel.dataset.srcScope);
      const s = cfg().prSources[i];
      const all = sel.value === 'all';
      const some = all ? [] : R.reposIn(st.rows, s.connection, s.project).filter(n => R.watchOf(cfg(), s.connection, s.project, n) !== 'no');
      if (!all && !some.length && !confirm(`No repos in ${s.project} are set to show yet, so this removes ${s.project} from pull requests. Continue?`)) { sel.value = 'all'; return; }
      if (await saveAdo(R.setSourceScope(cfg(), i, all, some), 'Pull requests saved')) paint();
    });
    prSec.addEventListener('click', async e => {
      const t = e.target.closest('[data-src-remove]');
      if (t && await saveAdo(R.removeSource(cfg(), Number(t.dataset.srcRemove)), 'Pull requests saved')) paint();
    });
    prSec.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (await saveAdo(R.addSource(cfg(), fd.get('connection'), fd.get('project')), 'Pull requests saved', e.target.querySelector('.msg'))) paint();
    });
  }
  if (mapSec) {
    mapSec.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.matches('[data-map-new]')) { st.editingMap = 'new'; return paintMappings(); }
      if (t.matches('[data-map-edit]')) { st.editingMap = Number(t.dataset.mapEdit); return paintMappings(); }
      if (t.matches('[data-map-cancel]')) { st.editingMap = null; return paintMappings(); }
      if (t.matches('[data-map-remove]')) {
        const i = Number(t.dataset.mapRemove);
        if (await saveAdo(R.saveMapping(cfg(), { index: i, path: '', connection: '' }), 'Folder removed')) { st.editingMap = null; paint(); }
      }
    });
    mapSec.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target.closest('[data-map-form]');
      if (!form) return;
      const fd = new FormData(form);
      const key = form.dataset.mapForm;
      const next = R.saveMapping(cfg(), { index: key === 'new' ? null : Number(key), path: fd.get('path'), connection: fd.get('connection'), project: fd.get('project') });
      if (await saveAdo(next, 'Folder saved', form.querySelector('.msg'))) { st.editingMap = null; paint(); }
    });
  }

  body.innerHTML = '<p class="sub">Loading...</p>';
  await load();
  paint();
  // Another tab (or the ADO form) changed the settings: read them again, unless a form is open here.
  ws.on('visible', async ({ visible } = {}) => { if (visible && !st.editing && st.editingMap == null && !st.adding && !st.busy) { await load(); paint(); } });
}

/* ---------- data: bundles ---------- */
function dataCard() {
  const sec = card('Backups', 'Download a copy to back up your data or move it to another browser or computer. Importing a copy merges it with what is here.', 'data');
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
  const sec = card('Open Workshop', 'Work mode is on: Workshop runs from the pinned copy on this computer, and no site can pair. The code only changes when you run <code>workshop update</code>. Turn apps on and off under Apps.');
  const parts = [one('Workshop', b.workshop), one('Docket', b.docket), one('Runway', b.runway), one('Rapport', b.receipts)];
  sec.insertAdjacentHTML('beforeend', `<p class="sub">${parts.join(' · ')} · built ${esc(new Date(b.builtAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', hour12: true }))}</p><ul class="sites"><li><a class="lnk" href="/">Open Workshop</a></li></ul>`);
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
/* ---------- health check: what `workshop doctor` checks, here (GET /api/doctor, Workshop on this computer) ---------- */
function healthCard() {
  const sec = card('Health check', 'Node, the data folder, start at login and each connector, as Workshop on this computer sees them. For the full check run <code>workshop doctor</code>.');
  sec.insertAdjacentHTML('beforeend', '<div class="health-out" aria-live="polite"></div><p><button type="button" class="btn" data-health>Check now</button></p>');
  const out = sec.querySelector('.health-out');
  const run = async () => {
    out.innerHTML = '<p class="sub">Checking…</p>';
    try {
      const r = await agentCall('GET', '/api/doctor');
      const lines = (r.lines || []).filter(l => !/^Result:/.test(l));
      const bad = l => !/not available/.test(l) && /too old|not |problem|fix |could not|missing|failed|behind|error/i.test(l) && !/: ok\.?$/i.test(l);
      out.innerHTML = `<p class="${r.ok ? 'ok' : 'err'}"><b>${r.ok ? 'All good.' : 'Something needs fixing. The lines marked below say what to do.'}</b></p>`
        + `<ul class="health-lines">${lines.map(l => `<li class="${bad(l) ? 'err' : ''}">${esc(l)}</li>`).join('')}</ul>`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  };
  sec.addEventListener('click', e => { if (e.target.closest('[data-health]')) run(); });
  run();
}

async function start() {
  header();
  tabsEl.innerHTML = ''; content.innerHTML = '';
  if (ws.backend === 'agent') {
    try {
      const cfg = await ws.config.get();
      if (ws.mode === 'local') { if (cfg.features && cfg.features.workMode) await workCard(); else sitesCard(cfg); }
      await folderCard(cfg);
      if (ws.mode === 'local') healthCard();
      await workshopCard(cfg);
      await appsCard();
      const list = await connectorsCard(cfg);
      if (list) await reposTab(list);
    } catch (e) {
      card('Workshop').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`);
    }
  } else {
    // Not paired, or the agent is not running. Pairing is Connect in the shell's rail (https only); its dialog
    // covers signing this browser in (workshop open).
    card('Workshop on this computer', 'Not connected, so connectors are off. If Workshop is not running, run <code>workshop start</code>. Then '
      + (location.protocol === 'https:' ? 'click <b>Connect</b>.' : 'open Workshop from its site and click <b>Connect</b>.'));
    await folderCard(null);
    await appsCard();
  }
  dataCard();
}
await start();

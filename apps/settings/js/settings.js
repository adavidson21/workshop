/* Settings: one page per job, in a left nav grouped by task (pages.js has the list).

     Workshop        Overview, Apps, This computer, Data & backups
     People & teams  People & groups, Team area paths (people.js)
     Azure DevOps    Connections, Work items, Pull requests
     Code & agents   Repos, Agents
     Connectors      a page for any other connector
     Help            User guide: "I need to..." scenarios and the best way to do each (guide.js)

   Everything goes through the SDK (shared/workshop-sdk.js). Connector forms are generated from each
   connector's configSchema (forms.js); a field goes on the page its `x-workshop-page` names, else on the
   connector's own page, so a new connector needs no Settings change. Each page saves only its own fields on
   top of the config as it is now, so two pages never overwrite each other. PATs and other secrets are never
   entered here: a connector's settings name the environment variable that holds one, and the form shows
   whether it is set on this computer.

   Local mode (served by the agent): everything can be changed, including the data folder (dataDir).
   Hosted mode (a paired site): read only, except People & teams (ws.people works in every mode) and repo
   mapping and PR sources (marked x-workshop-hosted). The agent refuses other config changes from other sites.
   Browser mode (no agent): Overview, Apps, People & teams and Data & backups.

   Nothing here needs Azure DevOps: without it the ADO pages say what to do in one line, and the rest works. */
import { connect } from '../../../shared/workshop-sdk.js';
import { render as renderForm, readValue } from './forms.js';
import * as R from './repos.js';
import * as P from './pages.js';
import { mountPeople } from './people.js';
import { mountFocus } from './focus-page.js';
import { mountProducts } from './products-page.js';
import { mountWriting } from './voice-page.js';
import { mountGuide } from './guide.js';

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
  ado: 'Your Azure DevOps work items and pull requests, for Docket, Slate and Runway. Optional: everything else works without it.',
  opencode: 'Runs coding agents on this computer, for Loom. Optional.'
};
const STATE_LABEL = { ready: 'Ready', starting: 'Starting', stopped: 'Stopped', error: 'Needs attention', disabled: 'Off' };

const ws = await connect({ app: 'settings' });
const readOnly = ws.mode === 'hosted';
const content = $('#content');

function toast(text, kind) { return ws.toast(text, { kind }); }

/* ---------- the nav and its pages ----------
   A page is a panel in #content with a button in #nav, under its group's label. Pages are made as the cards
   that go on them are made, so a page with nothing on it (no ADO connector, browser mode) never shows. The
   last page opened is remembered in this browser. On a narrow window the nav is a select. */
const navEl = $('#nav');
const navSelect = $('#navSelect');
const PAGE_KEY = 'workshop.settings.page';
const pages = new Map(); // id -> {el, btn, label, group, dirty: Set<form>}
let wantPage = 'overview';
let wantFocus = '';
try {
  const saved = localStorage.getItem(PAGE_KEY) || localStorage.getItem('workshop.settings.tab'); // the tab, before the nav
  const r = saved && P.routeToPage(saved);
  if (r) wantPage = r.page;
} catch (e) { /* storage blocked: start on Overview */ }
let current = null;

function groupEl(id) {
  let g = navEl.querySelector(`[data-group="${id}"]`);
  if (g) return g;
  const def = P.GROUPS.find(x => x.id === id) || { id, label: id };
  g = document.createElement('div');
  g.className = 'nav-group';
  g.dataset.group = id;
  g.innerHTML = `<p class="nav-label"><span>${esc(def.label)}</span><span class="nav-dot" hidden></span></p>`;
  const order = P.GROUPS.map(x => x.id);
  const after = [...navEl.children].find(x => order.indexOf(x.dataset.group) > order.indexOf(id));
  navEl.insertBefore(g, after || null);
  return g;
}

function selectPage(id, remember) {
  if (!pages.has(id)) return;
  current = id;
  for (const [pid, p] of pages) {
    const on = pid === id;
    p.el.hidden = !on;
    if (on) p.btn.setAttribute('aria-current', 'page'); else p.btn.removeAttribute('aria-current');
  }
  navSelect.value = id;
  if (remember) { wantPage = id; try { localStorage.setItem(PAGE_KEY, id); } catch (e) { /* not remembered */ } }
}

function page(id, label, group) {
  if (pages.has(id)) return pages.get(id).el;
  const def = P.PAGES[id] || {};
  label = label || def.label || id;
  group = group || def.group || 'connectors';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item';
  btn.dataset.page = id;
  btn.innerHTML = `<span>${esc(label)}</span><span class="dirty-dot" title="Not saved" hidden></span>`;
  const g = groupEl(group);
  const rank = x => { const i = P.ORDER.indexOf(x); return i < 0 ? 1000 : i; };
  const after = [...g.querySelectorAll('.nav-item')].find(b => rank(b.dataset.page) > rank(id));
  g.insertBefore(btn, after || null);
  const el = document.createElement('div');
  el.id = `page-${id}`;
  el.className = 'panel';
  el.dataset.page = id;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', label);
  el.hidden = true;
  el.innerHTML = `<h2 class="page-title">${esc(label)}</h2><p class="gate sub" hidden></p>`;
  content.appendChild(el);
  pages.set(id, { el, btn, label, group, dirty: new Set() });
  paintSelect();
  if (id === wantPage || !current) selectPage(id);
  if (id === wantPage && wantFocus) focusPart();
  return el;
}

function paintSelect() {
  const groups = [...navEl.querySelectorAll('.nav-group')];
  navSelect.innerHTML = groups.map(g => `<optgroup label="${esc(g.querySelector('.nav-label span').textContent)}">${[...g.querySelectorAll('.nav-item')]
    .map(b => `<option value="${esc(b.dataset.page)}">${esc(pages.get(b.dataset.page).label)}</option>`).join('')}</optgroup>`).join('');
  if (current) navSelect.value = current;
}

navEl.addEventListener('click', e => { const b = e.target.closest('.nav-item'); if (b) selectPage(b.dataset.page, true); });
navEl.addEventListener('keydown', e => {
  const items = [...navEl.querySelectorAll('.nav-item')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  const t = items[(j + items.length) % items.length];
  t.focus(); selectPage(t.dataset.page, true);
});
navSelect.addEventListener('change', () => selectPage(navSelect.value, true));

// The group's status dot: the connector behind it (ADO, opencode).
function groupDot(group, state) {
  const dot = groupEl(group).querySelector('.nav-dot');
  dot.hidden = !state;
  dot.dataset.state = state || '';
  dot.title = state === 'empty' ? 'Not set up' : STATE_LABEL[state] || state || '';
}

// Unsaved changes: typing in a form marked data-track puts a dot on its page until it is saved or rebuilt.
function paintDirty() {
  for (const p of pages.values()) {
    for (const f of [...p.dirty]) if (!f.isConnected) p.dirty.delete(f);
    p.btn.querySelector('.dirty-dot').hidden = p.dirty.size === 0;
  }
}
function markDirty(form) { const p = pages.get(form.closest('.panel')?.dataset.page); if (p) { p.dirty.add(form); paintDirty(); } }
function markClean(form) { for (const p of pages.values()) p.dirty.delete(form); paintDirty(); }
content.addEventListener('input', e => { const f = e.target.closest('form[data-track]'); if (f) markDirty(f); });
content.addEventListener('change', e => { const f = e.target.closest('form[data-track]'); if (f) markDirty(f); });

// #/settings/<page>, and the old addresses (tabs, the People app): open that page now, or once it exists.
let people = null;
const pendingCommands = [];
function focusPart() {
  if (wantFocus === 'import' && people) { people.focusImport(); wantFocus = ''; }
}
ws.on('route', ({ path } = {}) => {
  const r = P.routeToPage(path);
  if (!r) return;
  wantPage = r.page; wantFocus = r.focus || '';
  if (pages.has(r.page)) { selectPage(r.page); focusPart(); }
  if (r.focus === 'you') { if (people) people.command('add-you', r.name); else pendingCommands.push(['add-you', r.name]); }
});
// Commands from the palette (Add a person, Add a group) open People & groups with the form.
let products = null, pendingProduct = false;
ws.on('command', ({ id } = {}) => {
  if (id === 'add-product') {
    wantPage = 'products';
    if (pages.has('products')) selectPage('products');
    if (products) products.command(id); else pendingProduct = true;
    return;
  }
  if (id !== 'add-person' && id !== 'add-group') return;
  wantPage = 'people';
  selectPage('people');
  if (people) people.command(id); else pendingCommands.push([id]);
});

// A card on a page (Overview unless named). `order` places it among the page's cards (default 50).
// sub is shown under the heading (state and next steps); hint is an explanation behind the heading's quiet ?.
function card(title, sub, pageId = 'overview', order = 50, hint = '') {
  const sec = document.createElement('section');
  sec.className = 'card';
  sec.dataset.order = order;
  const qh = hint && title && globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('settings.' + title.toLowerCase().replace(/[^a-z]+/g, '-'), hint.replace(/<[^>]+>/g, ''), 'About ' + title) : '';
  sec.innerHTML = `${title ? `<h2>${esc(title)}${qh}</h2>` : ''}${sub ? `<p class="sub">${sub}</p>` : ''}`;
  const el = page(pageId);
  const after = [...el.querySelectorAll(':scope > .card')].find(c => Number(c.dataset.order) > order);
  el.insertBefore(sec, after || null);
  return sec;
}
const errText = e => (e && e.message) || 'Something went wrong.';
// A link or button with data-goto-page="<page>" opens that page, for example from Overview to Connections.
content.addEventListener('click', e => {
  const g = e.target.closest('[data-goto-page]');
  if (!g || !pages.has(g.dataset.gotoPage)) return;
  e.preventDefault();
  selectPage(g.dataset.gotoPage, true);
  pages.get(g.dataset.gotoPage).btn.focus();
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
    // Only this computer's settings, connections and repos are read only here; people, groups and team area paths are not.
    note.innerHTML = 'This computer, Azure DevOps and Repos are read only here. To change them, open Workshop on this computer'
      + (at ? ` at <a class="lnk" href="${esc(at)}/" target="_blank" rel="noopener">${esc(at)}</a>.` : ' (run <code>workshop open</code>).')
      + ' People, groups and team area paths change here.';
    document.body.classList.add('ro');
  }
  // Browser mode: no subtitle. Overview's "Workshop on this computer" card says how to connect.
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
  const sec = card('Data folder', '', 'data', 50, 'Every app saves its files here, one subfolder per app. It is yours: Workshop never syncs it.');
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

/* ---------- This computer: start at login, work mode, pairing (hosted mode and allowed sites), port ---------- */
async function computerCard(cfg) {
  const sec = card('Startup and pairing', '', 'computer', 50, `Kept in ${cfg.home} on this computer. Most people set these once.`);
  const form = document.createElement('form');
  form.className = 'cfg';
  form.dataset.track = '';
  const feats = Object.keys(cfg.features);
  const feature = k => {
    const [label, help] = FEATURES[k] || [k, ''];
    return `<div class="cfg-row cfg-check"><input type="checkbox" id="feat-${k}" data-feature="${k}"${cfg.features[k] ? ' checked' : ''}><label for="feat-${k}">${esc(label)}</label>${help ? `<p class="cfg-help">${esc(help)}</p>` : ''}</div>`;
  };
  form.innerHTML = feats.map(feature).join('') + `
      <fieldset><legend>Allowed sites</legend>
        <p class="cfg-help">Sites that can pair when hosted mode is on: <code>https://</code> and a host, no path.</p>
        <div class="cfg-list" id="origins"></div>
        <button type="button" class="btn cfg-add" data-add-origin>Add a site</button>
      </fieldset>
      <div class="cfg-row"><label for="port">Port</label><input id="port" class="cfg-input mono" type="number" min="1024" max="65535" value="${cfg.port}"><p class="cfg-help">On 127.0.0.1. Used after Workshop restarts.</p></div>
    <div class="acts"><span class="msg" aria-live="polite"></span>${readOnly ? '' : '<button class="btn primary">Save</button>'}</div>`;
  sec.appendChild(form);
  const list = form.querySelector('#origins');
  const addOrigin = v => {
    const row = document.createElement('div'); row.className = 'cfg-item';
    row.innerHTML = `<input class="cfg-input mono" type="text" aria-label="Site" placeholder="https://workshop.example.org" value="${esc(v)}"><button type="button" class="btn ghost cfg-remove">Remove</button>`;
    row.querySelector('.cfg-remove').addEventListener('click', () => { row.remove(); markDirty(form); });
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
      markClean(form);
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
  const sec = card('Apps', '', 'apps', 50, intro);
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
  // Switches each app declares in its manifest (docs/app-settings.md), from the site's registry, with their values.
  const decls = new Map(), values = new Map();
  try {
    for (const a of await ws.apps.list()) if (a.settings && a.settings.length) {
      decls.set(a.id, a.settings);
      try { values.set(a.id, await ws.appSettings.get({ app: a.id })); } catch (e) { values.set(a.id, null); }
    }
  } catch (e) { /* no registry: no app settings */ }
  if (view.workMode && view.pinned === false) box.insertAdjacentHTML('beforeend', `<p class="sub">There is no pinned copy yet. Run this on your computer: <code>workshop pin</code> ${copyBtn('workshop pin')}</p>`);

  const status = a => {
    if (!a.canTurnOff) return 'Always on.';
    if (!a.on) return 'Off. Not in the rail.';
    if (view.workMode && a.separate && !a.downloaded) return `Not downloaded yet, so it is not in Workshop. Run this on your computer, then reload: <code>${esc(a.command)}</code> ${copyBtn(a.command)}`;
    if (view.workMode && a.separate && a.problem) return `Left out of the pinned copy: ${esc(a.problem)}. Update it with <code>workshop update</code> ${copyBtn('workshop update')}`;
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
        <p class="conn-status app-status">${status(a)}</p>${appSettingsHtml(a)}`;
      row.querySelector('.toggle').addEventListener('change', e => flip(a, e.target));
      row.querySelectorAll('[data-app-setting]').forEach(el => el.addEventListener('change', e => setAppSetting(a, e.target)));
      box.appendChild(row);
    }
  };
  function appSettingsHtml(a) {
    const list = decls.get(a.id);
    if (!list || !a.on) return '';
    const vals = values.get(a.id);
    if (!vals) return `<p class="sub">${esc(a.name)}'s settings could not be read. Update Workshop to change them.</p>`;
    return `<div class="app-settings" role="group" aria-label="${esc(a.name)} settings">${list.map(d => `<label class="app-setting">
        <span><b>${esc(d.title)}</b>${d.description ? `<span class="conn-about">${esc(d.description)}</span>` : ''}</span>
        <input type="checkbox" class="toggle" role="switch" data-app-setting="${esc(d.id)}" aria-label="${esc(d.title)}"${vals[d.id] ? ' checked' : ''}>
      </label>`).join('')}</div>`;
  }
  async function setAppSetting(a, input) {
    const key = input.dataset.appSetting, on = input.checked, d = decls.get(a.id).find(x => x.id === key);
    input.disabled = true;
    try {
      values.set(a.id, await ws.appSettings.set({ [key]: on }, { app: a.id }));
      toast(`${d ? d.title : key}: ${on ? 'on' : 'off'} for ${a.name}`, 'success');
    } catch (err) {
      input.checked = !on;
      toast(errText(err), 'error');
    } finally { input.disabled = false; }
  }
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

/* ---------- connectors ----------
   Each connector has a main page (ADO: Connections, opencode: Agents, any other: its own page) with its
   switch, status, paste a link, import and test, and the fields with no x-workshop-page. Its other fields go
   on the pages they name (ADO: Work items, Pull requests; opencode's PR reviews: Pull requests). A page that
   belongs to a connector says in one line what to do while that connector is off or not set up. */
const NOTE = {
  ado: 'PATs never go in here: save one with <code>workshop pat</code> and name its variable in a connection. Which project each repo uses is on <a href="#" class="lnk" data-goto-page="repos">Repos</a>.'
};
const conn = { list: [], info: {}, cc: {} }; // cc[id]: {schema, config, env}, as getConfig gives it
const drafts = {};                           // drafts[id]: fields filled in from a link or a file, not saved yet
const onChange = new Set();                  // (id, kind) after a connector's config ('config') or status ('status') changes
function changed(id, kind, keys) { for (const f of onChange) { try { f(id, kind, keys); } catch (e) { console.error(e); } } }
const stateOf = id => P.connectorState(conn.info[id], conn.cc[id] && conn.cc[id].config);
const mainLabel = id => (P.PAGES[P.mainPageOf(id)] || {}).label || (conn.info[id] || {}).name || id;
let connFoot = null; // where ADO's main-page form goes (connectionsCard)
const pageLink = (id, text) => `<a href="#" class="lnk" data-goto-page="${esc(id)}">${esc(text || (pages.get(id) || {}).label || id)}</a>`;

async function loadCfg(id) { try { conn.cc[id] = await ws.connectors.getConfig(id); } catch (e) { conn.cc[id] = conn.cc[id] || null; } return conn.cc[id]; }
async function refreshInfo(id) {
  const fresh = (await ws.connectors.list()).find(c => c.id === id);
  if (fresh) conn.info[id] = fresh;
  return fresh;
}

/** Save one page's fields: the config as it is now on this computer, with only `keys` replaced. */
async function saveKeys(id, keys, value) {
  const fresh = await ws.connectors.getConfig(id);
  const saved = await ws.connectors.putConfig(id, P.mergeKeys(fresh.config, keys, value));
  conn.cc[id] = saved;
  if (drafts[id]) { for (const k of keys) delete drafts[id][k]; if (!Object.keys(drafts[id]).length) delete drafts[id]; }
  changed(id, 'config', keys);
  return saved;
}

// Settings from a link or a file: the fields that differ from what is saved wait on their pages, unsaved.
function applyDraft(id, config) {
  const saved = (conn.cc[id] && conn.cc[id].config) || {};
  const props = (conn.cc[id] && conn.cc[id].schema && conn.cc[id].schema.properties) || {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const d = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (same(v, saved[k])) continue;
    if (saved[k] === undefined && props[k] && same(v, props[k].default)) continue; // just the default, spelled out
    d[k] = v;
  }
  const schema = conn.cc[id] && conn.cc[id].schema;
  // ADO's repo mapping and PR sources from a link are saved with the connection they use (connectionsCard).
  const withConn = k => id === 'ado' && 'connections' in d && (k === 'paths' || k === 'prSources');
  const where = [...new Set(Object.keys(d).filter(k => !withConn(k)).map(k => P.pageOfField(id, schema && schema.properties[k])))]
    .map(p => (pages.get(p) || {}).label).filter(Boolean);
  drafts[id] = d;
  changed(id, 'config'); // the pages take their fields (Connections takes the connections out of the draft)
  return where;
}

async function connectorsSetup() {
  let list;
  try { list = await ws.connectors.list(); }
  catch (e) { card('Connectors', '', 'overview', 30).insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); return []; }
  conn.list = list;
  for (const info of list) conn.info[info.id] = info;
  await Promise.all(list.map(i => loadCfg(i.id)));
  for (const info of list) {
    const main = P.mainPageOf(info.id);
    page(main, P.PAGES[main] ? null : info.name, P.PAGES[main] ? null : 'connectors');
    const sec = card('', '', main, 10);
    sec.appendChild(connectorBlock(info));
    if (NOTE[info.id]) sec.insertAdjacentHTML('beforeend', `<p class="sub conn-note">${NOTE[info.id]}</p>`);
    if (info.id === 'ado') connectionsCard();
  }
  // Generated forms, after every main page exists, so a field on another connector's page finds it.
  for (const info of list) {
    const cc = conn.cc[info.id];
    for (const pg of P.formPages(info.id, cc && cc.schema)) {
      if (pg === 'repos') continue; // drawn by the Repos page
      const owner = (P.PAGES[pg] || {}).owner;
      if (owner && owner !== info.id && !conn.info[owner]) continue; // that page's connector is not installed
      formCard(info, pg);
    }
  }
  const paintDots = () => {
    for (const g of P.GROUPS.filter(x => x.connector && conn.info[x.connector])) {
      const s = stateOf(g.connector);
      groupDot(g.id, s === 'off' || s === 'missing' ? '' : s === 'empty' ? 'empty' : (conn.info[g.connector].status || {}).state);
    }
  };
  onChange.add(() => { updateGates(); paintDots(); });
  updateGates(); paintDots();
  return list;
}

// Pages that belong to a connector: one line instead of the cards while it is off or has no connection.
// On the connector's own page, cards marked data-needs-on hide while it is off (the switch stays).
function updateGates() {
  for (const [pid, p] of pages) {
    const owner = (P.PAGES[pid] || {}).owner;
    const own = owner && conn.info[owner] && pid !== P.mainPageOf(owner);
    const note = own ? P.gateNote(stateOf(owner), conn.info[owner].name, mainLabel(owner)) : '';
    const gate = p.el.querySelector(':scope > .gate');
    gate.hidden = !note;
    gate.innerHTML = note ? esc(note).replace(esc(mainLabel(owner)), pageLink(P.mainPageOf(owner), mainLabel(owner))) : '';
    for (const c of p.el.querySelectorAll(':scope > .card')) {
      const needs = c.dataset.needsOn;
      const offHere = needs && pid === P.mainPageOf(needs) && conn.info[needs] && !conn.info[needs].enabled;
      c.hidden = c.dataset.hide === '1' || Boolean(note) || Boolean(offHere);
    }
  }
}

function connectorBlock(info) {
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
      ${!readOnly && canImport(info) ? '<label class="btn">Import settings from a file<input type="file" accept=".json,application/json" data-import-file hidden></label>' : ''}
      <span class="msg" aria-live="polite" data-tools-msg></span>
    </div>
    ${info.test ? `<form class="test" data-test><label for="test-${info.id}">${esc(info.test.label)}</label><input id="test-${info.id}" class="cfg-input mono" required><button class="btn">Test</button><div class="test-out" aria-live="polite"></div></form>` : ''}`;

  const showStatus = st => {
    info.status = st;
    if (conn.info[info.id]) conn.info[info.id].status = st;
    const el = box.querySelector('[data-state]');
    // On with nothing to connect to yet (ADO with no connection) is not a problem: say so plainly, not in red.
    const empty = stateOf(info.id) === 'empty';
    el.textContent = empty ? 'Not set up' : STATE_LABEL[st.state] || st.state;
    el.dataset.state = empty ? 'neutral' : st.state;
    box.querySelector('[data-state-msg]').textContent = empty ? 'Paste a link below, or add a connection by hand.' : st.message || '';
    // A PAT saved while Workshop runs (workshop pat) shows up here without a restart; this asks again now.
    box.querySelector('[data-recheck]').hidden = !info.enabled || (st.state === 'ready' && !st.message);
    const t = box.querySelector('[data-test]');
    if (t) t.hidden = st.state !== 'ready';
    changed(info.id, 'status');
  };
  showStatus(info.status);
  ws.connectors.onStatus(info.id, showStatus);
  onChange.add((id, kind) => { if (id === info.id && kind === 'config') showStatus(info.status); }); // a first connection, say

  const turnOn = async on => {
    await ws.config.put({ connectors: { [info.id]: { enabled: on } } });
    info.enabled = on;
    box.querySelector('[data-enable]').checked = on;
    const fresh = await refreshInfo(info.id);
    if (fresh) { fresh.enabled = on; Object.assign(info, fresh); showStatus(fresh.status); }
  };
  box.querySelector('[data-enable]').addEventListener('change', async e => {
    const on = e.target.checked;
    try { await turnOn(on); toast(`${info.name} is ${on ? 'on' : 'off'}`, 'success'); }
    catch (err) { e.target.checked = !on; toast(errText(err), 'error'); }
  });

  const toolsMsg = box.querySelector('[data-tools-msg]');
  // "Filled in ... Nothing is saved yet" is about the unsaved form: once a save lands (or the form closes) it is stale.
  const clearFillNote = () => { if (/^(Filled in|Imported)/.test(toolsMsg.textContent)) toolsMsg.textContent = ''; };
  onChange.add((id, kind) => { if (id === info.id && kind === 'config') clearFillNote(); });
  box.addEventListener('click', e => { if (e.target.closest('button') && /^(Cancel)$/.test(e.target.closest('button').textContent.trim())) clearFillNote(); });
  const filled = (what, where) => `${what}. Nothing is saved yet: review ${where.length ? where.join(' and ') : 'the settings'}, then Save.`;
  box.querySelector('[data-recheck]').addEventListener('click', async () => {
    toolsMsg.textContent = 'Checking...';
    try {
      const fresh = await refreshInfo(info.id);
      if (fresh) { info.enabled = fresh.enabled; showStatus(fresh.status); }
      await loadCfg(info.id); changed(info.id, 'config');
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
      const where = applyDraft(info.id, out.config);
      toolsMsg.textContent = filled(`Imported ${f.name}`, where) + (out.notes && out.notes.length ? ' ' + out.notes.join(' ') : '');
    } catch (err) { toolsMsg.textContent = errText(err); }
  });

  const fromUrl = box.querySelector('[data-from-url]');
  if (fromUrl) fromUrl.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = fromUrl.querySelector('button');
    btn.disabled = true; toolsMsg.textContent = 'Reading the link...';
    try {
      // Pasting a link means setting it up, so an off connector is turned on first (the agent refuses calls to it).
      if (!info.enabled) { await turnOn(true); await new Promise(r => setTimeout(r, 300)); }
      const out = await ws.connectors.call(info.id, 'config.fromUrl', { url: fromUrl.querySelector('input').value });
      const where = applyDraft(info.id, out.config);
      toolsMsg.textContent = filled('Filled in from the link', where) + (out.notes && out.notes.length ? ' ' + out.notes.join(' ') : '');
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

/* ADO connections: one row each (name, server and collection, project, the PAT variable and its expiry)
   with Edit, instead of a nested form. A connection from a pasted link or an imported file opens here as a
   form to review. */
function connectionsCard() {
  const sec = card('Connections', '', 'connections', 20);
  sec.dataset.needsOn = 'ado';
  const body = sec.appendChild(document.createElement('div'));
  // The rest of ADO's main-page fields (the default connection) go under the list, in this card.
  const foot = sec.appendChild(document.createElement('div'));
  foot.className = 'conn-foot';
  connFoot = foot;
  let edits = []; // {at: the saved name, or null for a new one, value, note, form}
  const cc = () => conn.cc.ado || { schema: { properties: {} }, config: {}, env: {} };
  const itemSchema = () => ((cc().schema.properties || {}).connections || {}).items || { type: 'object', properties: {} };
  const list = () => (Array.isArray(cc().config.connections) ? cc().config.connections : []);
  const envLine = c => {
    const n = c.patEnv || 'ADO_PAT';
    const e = cc().env && cc().env[n];
    return e && !e.set ? `<span class="warn-text">PAT variable <span class="mono">${esc(n)}</span> is not set on this computer</span>` : `PAT in <span class="mono">${esc(n)}</span>`;
  };

  function takeDrafts() {
    const d = drafts.ado && drafts.ado.connections;
    if (!d) return;
    for (const c of d) {
      const old = list().find(x => x.name === c.name);
      if (old && JSON.stringify(old) === JSON.stringify(c)) continue;
      const open = edits.find(x => (x.at || (x.value && x.value.name)) === c.name);
      if (open) { open.value = c; open.form = null; continue; }
      const extra = ['paths', 'prSources'].filter(k => k in drafts.ado).length ? ' Saving it also saves the repos and pull request sources that came with it.' : '';
      edits.push({ at: old ? old.name : null, value: c, note: (old ? 'Changed by the link or file. Not saved yet.' : 'New. Not saved yet.') + extra });
    }
    delete drafts.ado.connections;
    if (!Object.keys(drafts.ado).length) delete drafts.ado;
  }

  function editForm(ed) {
    if (ed.form) return ed.form;
    const form = document.createElement('form');
    form.className = 'cfg conn-form';
    form.dataset.track = '';
    if (ed.note) form.insertAdjacentHTML('beforeend', `<p class="conn-draft">${esc(ed.note)}</p>`);
    const node = renderForm(itemSchema(), ed.value, cc().env, { readOnly });
    form.appendChild(node);
    form.insertAdjacentHTML('beforeend', `<div class="acts"><span class="msg" aria-live="polite"></span>${ed.at ? '<button type="button" class="btn" data-conn-remove>Remove</button>' : ''}<button type="button" class="btn" data-conn-cancel>Cancel</button><button class="btn primary">Save</button></div>`);
    const msg = form.querySelector('.msg');
    const close = () => { edits = edits.filter(x => x !== ed); markClean(form); paint(); };
    form.querySelector('[data-conn-cancel]').addEventListener('click', close);
    const rm = form.querySelector('[data-conn-remove]');
    if (rm) rm.addEventListener('click', async () => {
      if (!confirm(`Remove the ${ed.at} connection? Repos and pull request sources that use it stop working until they use another one.`)) return;
      msg.textContent = 'Removing...';
      try {
        const fresh = (await ws.connectors.getConfig('ado')).config.connections || [];
        await saveKeys('ado', ['connections'], { connections: fresh.filter(c => c.name !== ed.at) });
        toast(`${ed.at} removed`, 'success');
        close();
      } catch (err) { msg.textContent = errText(err); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const value = readValue(node);
      msg.textContent = 'Saving...';
      try {
        const fresh = (await ws.connectors.getConfig('ado')).config.connections || [];
        const next = fresh.slice();
        const i = next.findIndex(c => c.name === (ed.at || value.name));
        if (i >= 0) next[i] = value; else next.push(value);
        // What came with it from a link or file and has no form of its own here: the default connection,
        // repo mapping and PR sources (they name this connection, so they cannot be saved before it).
        const d = drafts.ado || {};
        const along = ['defaultConnection', 'paths', 'prSources'].filter(k => k in d);
        await saveKeys('ado', ['connections', ...along], { connections: next, ...Object.fromEntries(along.map(k => [k, d[k]])) });
        toast(`${value.name || 'Connection'} saved. The connector restarted.`, 'success');
        close();
      } catch (err) { msg.textContent = errText(err); }
    });
    ed.form = form;
    return form;
  }

  function paint() {
    takeDrafts();
    body.innerHTML = '';
    const all = list();
    const def = cc().config.defaultConnection || '';
    if (all.length) {
      const ul = document.createElement('ul');
      ul.className = 'people conns';
      for (const c of all) {
        const ed = edits.find(x => x.at === c.name);
        const li = document.createElement('li');
        li.className = 'person' + (ed ? ' editing' : '');
        li.dataset.conn = c.name;
        if (ed) li.appendChild(editForm(ed));
        else li.innerHTML = `<div><b class="mono">${esc(c.name)}</b>${all.length > 1 && c.name === def ? ' <span class="pill-tag">default</span>' : ''}
            <p class="person-meta">${esc(R.baseOf(c))}${c.project ? ` · ${esc(c.project)}` : ''} · ${envLine(c)}${c.patExpires ? ` · PAT expires ${esc(c.patExpires)}` : ''}</p></div>
          ${readOnly ? '' : `<button type="button" class="btn" data-conn-edit="${esc(c.name)}">Edit</button>`}`;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    } else if (!edits.length) {
      body.insertAdjacentHTML('beforeend', '<p class="sub">No connections yet. Paste any Azure DevOps link above to add one, or add one by hand.</p>');
    }
    for (const ed of edits.filter(x => x.at === null)) {
      const div = document.createElement('div');
      div.className = 'person editing';
      div.appendChild(editForm(ed));
      body.appendChild(div);
    }
    if (!readOnly && !edits.some(x => x.at === null)) body.insertAdjacentHTML('beforeend', '<div class="acts left"><button type="button" class="btn" data-conn-new>Add a connection by hand</button></div>');
    paintDirty();
  }

  body.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-conn-edit]')) {
      const c = list().find(x => x.name === t.dataset.connEdit);
      if (c) { edits.push({ at: c.name, value: JSON.parse(JSON.stringify(c)) }); paint(); }
    }
    if (t.matches('[data-conn-new]')) { edits.push({ at: null, value: {} }); paint(); body.querySelector('.conn-form input')?.focus(); }
  });
  onChange.add((id, kind) => { if (id === 'ado' && kind === 'config') paint(); });
  paint();
}

/* One page's worth of a connector's generated form. Saves only its own keys (saveKeys). A field from another
   connector on this page (opencode's PR reviews on Pull requests) gets its own card and saves to its own
   connector. */
function formCard(info, pg) {
  const id = info.id;
  const isMain = pg === P.mainPageOf(id);
  const owner = (P.PAGES[pg] || {}).owner || id;
  const inConns = id === 'ado' && isMain && connFoot;
  const sec = inConns ? connFoot : card('', '', pg, owner === id ? (isMain ? 30 : 20) : 40);
  if (!inConns) sec.dataset.needsOn = owner;
  sec.dataset.formOf = id;
  let form = null, saving = false, lastMsg = '';
  const keysNow = () => P.formKeys(id, conn.cc[id] && conn.cc[id].schema, pg);

  function build() {
    const cc = conn.cc[id];
    if (!cc) { sec.innerHTML = '<p class="err">Could not read these settings. Use Check again on the connector.</p>'; return; }
    const keys = keysNow();
    sec.dataset.hide = keys.length ? '' : '1';
    // Under the connections list: the default connection only matters with two or more.
    if (inConns && keys.length) {
      const n = Array.isArray(cc.config.connections) ? cc.config.connections.length : 0;
      const d0 = drafts[id] || {};
      const wanted = n > 1 || keys.some(k => cc.config[k] || k in d0);
      sec.dataset.hide = wanted ? '' : '1';
      if (!wanted) { sec.innerHTML = ''; form = null; return; }
    }
    if (!keys.length) { sec.innerHTML = ''; return; }
    const d = drafts[id] || {};
    const value = Object.fromEntries(keys.map(k => [k, k in d ? d[k] : cc.config[k]]));
    const props = cc.schema.properties;
    // One object field alone (PR reviews): its fields straight in the card, under its title.
    const single = keys.length === 1 && props[keys[0]].type === 'object' ? keys[0] : null;
    sec.innerHTML = single ? `<h2>${esc(props[single].title || single)}</h2>${props[single].description ? `<p class="sub">${esc(props[single].description)}</p>` : ''}` : '';
    if (owner !== id && !info.enabled) sec.insertAdjacentHTML('beforeend', `<p class="sub">${esc(info.name)} is off, so these do nothing until you turn it on in ${pageLink(P.mainPageOf(id), mainLabel(id))}.</p>`);
    form = document.createElement('form');
    form.className = 'cfg';
    form.dataset.track = '';
    const node = single
      ? renderForm({ ...props[single], title: undefined, description: undefined }, value[single], cc.env, { readOnly, fold: false })
      : renderForm(P.subSchema(cc.schema, keys), value, cc.env, { readOnly, fold: isMain, page: pg });
    form.appendChild(node);
    form.insertAdjacentHTML('beforeend', `<div class="acts"><span class="msg" aria-live="polite">${esc(lastMsg)}</span>${readOnly ? '' : '<button class="btn primary">Save</button>'}</div>`);
    sec.appendChild(form);
    lastMsg = '';
    if (keys.some(k => k in d)) markDirty(form);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = form.querySelector('.msg');
      msg.textContent = 'Saving...';
      saving = true;
      try {
        const v = readValue(node);
        await saveKeys(id, keys, single ? { [single]: v } : v);
        lastMsg = info.enabled ? 'Saved. The connector restarted.' : 'Saved.';
        markClean(form);
        saving = false;
        build();
        toast(`${info.name} settings saved`, 'success');
      } catch (err) { saving = false; msg.textContent = errText(err); }
    });
  }
  build();
  onChange.add((cid, kind, saved) => {
    if (cid !== id || kind !== 'config' || saving) return;
    const d = drafts[id] || {};
    const dirty = form && [...pages.values()].some(p => p.dirty.has(form));
    const mine = keysNow();
    // Rebuild unless you are typing here; always when a link or file filled in, or another form saved, these fields.
    if (!dirty || mine.some(k => k in d) || (saved || []).some(k => mine.includes(k))) { if (form) markClean(form); build(); }
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

/* ---------- Overview: one row per connector, with a link to the page that needs you ---------- */
function statusCard() {
  if (!conn.list.length) return;
  const sec = card('Connectors', '', 'overview', 60);
  const box = sec.appendChild(document.createElement('ul'));
  box.className = 'people status-rows';
  const paint = () => {
    box.innerHTML = conn.list.map(c => {
      const info = conn.info[c.id];
      const r = P.statusRow(info, conn.cc[c.id] && conn.cc[c.id].config);
      const dot = r.state === 'error' ? 'error' : r.state === 'ready' ? ((info.status || {}).state || 'ready') : 'neutral';
      return `<li class="person" data-status-of="${esc(c.id)}"><div><b>${esc(info.name)}</b> <span class="state" data-state="${esc(dot)}">${esc(r.label)}</span>
          <p class="person-meta">${esc(r.message || ABOUT[c.id] || '')}</p></div>
        ${r.action ? `<button type="button" class="btn${r.state === 'error' ? ' primary' : ''}" data-goto-page="${esc(P.mainPageOf(c.id))}">${esc(r.action)}</button>` : ''}</li>`;
    }).join('');
  };
  paint();
  onChange.add(paint);
}

/* ---------- repos (repos.js) ----------
   The Repos page: the repos in your workspace (opencode's state), the Azure DevOps project each one uses (ADO
   `paths`) and adding one (clone, map, watch, then draft its guide). Other folders fold away at the bottom.
   Where Docket looks for pull requests (ADO `prSources`) is a card on the Pull requests page, drawn from the
   same state. Both ADO fields are marked x-workshop-page and x-workshop-hosted, so they stay out of the
   generated forms and can be saved from a paired site too. With no Azure DevOps (off, not installed or no
   connection) the page lists and adds repos with no ADO line. */
const NEW_CAT = '\u0000new';
async function reposTab(list) {
  const adoInfo = list.find(c => c.id === 'ado');
  const ocInfo = list.find(c => c.id === 'opencode');
  if (!adoInfo && !ocInfo) return;
  const st = { ado: null, oc: null, ocCfg: null, ocError: '', rows: [], editing: null, editingMap: null, adding: false, added: null, busy: false, hiding: false };
  const main = card('Workspace repos', '', 'repos', 20, 'The repos in your workspace and, once Azure DevOps is connected, the project each one uses and whether Docket shows its pull requests.');
  const body = document.createElement('div'); main.appendChild(body);
  const prSec = adoInfo ? card('Where Docket looks', '', 'pull-requests', 10, 'The projects Docket checks for pull requests waiting on you.') : null;
  if (prSec) prSec.dataset.needsOn = 'ado';
  const prBody = prSec ? prSec.appendChild(document.createElement('div')) : null;
  const mapSec = adoInfo ? card('', '', 'repos', 60) : null;
  if (mapSec) {
    mapSec.dataset.needsOn = 'ado';
    mapSec.innerHTML = '<details class="cfg-section"><summary>Other folders</summary><p class="sub">Folders outside your workspace, or patterns, and the Azure DevOps connection they use. <code>*</code> matches any characters.</p><div></div></details>';
  }
  const mapBody = mapSec ? mapSec.querySelector('details > div') : null;

  const cfg = () => (st.ado && st.ado.config) || {};
  const conns = () => (Array.isArray(cfg().connections) ? cfg().connections : []);
  // Repos link to ADO only while it is on and has a connection; otherwise the page is just your repos.
  const canMap = () => !!st.ado && conns().length > 0 && !!(conn.info.ado && conn.info.ado.enabled);
  const ocReady = () => !!st.oc;
  const connOptions = (cur, blank) => (blank ? `<option value=""${!cur ? ' selected' : ''}>${esc(blank)}</option>` : '')
    + conns().map(c => `<option value="${esc(c.name)}"${c.name === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const projectOf = name => { const c = conns().find(x => x.name === name); return (c && c.project) || ''; };

  async function load() {
    st.ado = null; st.oc = null; st.ocError = '';
    if (adoInfo) st.ado = conn.cc.ado || await loadCfg('ado');
    if (ocInfo) st.ocCfg = conn.cc.opencode || await loadCfg('opencode');
    const fresh = ocInfo ? ((await ws.connectors.list().catch(() => list)).find(c => c.id === 'opencode') || ocInfo) : null;
    if (fresh && fresh.enabled && fresh.status && fresh.status.state === 'ready') {
      try { st.oc = await ws.connectors.call('opencode', 'state'); } catch (e) { st.ocError = errText(e); }
    } else if (fresh) st.ocError = fresh.enabled ? (fresh.status && fresh.status.message) || 'opencode is not ready yet.' : '';
    st.rows = R.rows(st.oc || {}, cfg());
  }

  const hiddenList = () => R.hiddenOf(st.ocCfg && st.ocCfg.config);

  // Saving restarts the opencode connector, which reads the workspace again without the hidden folders.
  async function saveHidden(list, okText, msgEl) {
    if (msgEl) msgEl.textContent = 'Saving...';
    st.hiding = true;
    try { st.ocCfg = await saveKeys('opencode', R.HIDE_KEYS, { hiddenRepos: list }); }
    catch (err) { st.hiding = false; if (msgEl) msgEl.textContent = errText(err); else toast(errText(err), 'error'); return false; }
    for (let i = 0; i < 20; i++) {
      try { st.oc = await ws.connectors.call('opencode', 'state'); break; } catch (e) { await new Promise(r => setTimeout(r, 250)); }
    }
    st.hiding = false;
    st.rows = R.rows(st.oc || {}, cfg());
    toast(okText, 'success');
    return true;
  }

  function hiddenCard() {
    if (!st.oc) return '';
    const list = hiddenList();
    const cats = ((st.oc && st.oc.repoCategories) || []).filter(c => !R.isHidden(list, c));
    const li = list.map(h => `<li class="person"><span class="mono">${esc(h)}</span><button type="button" class="btn ghost" data-unhide="${esc(h)}"${st.hiding ? ' disabled' : ''}>Show</button></li>`).join('');
    return `<details class="cfg-section repo-hidden"${st.hiddenOpen ? ' open' : ''}><summary>Hidden folders${list.length ? ` (${list.length})` : ''}</summary>
      <p class="sub">Left out of Loom and this page, like a folder of tools you are building. Nothing is deleted. A category hides every repo in it.</p>
      ${list.length ? `<ul class="people">${li}</ul>` : '<p class="sub">None.</p>'}
      <form class="cfg" data-hide-add><div class="from-url-row"><input name="folder" class="cfg-input mono" list="hideCats" maxlength="300" placeholder="Tools or Tools/workshop" aria-label="Folder to hide" spellcheck="false" autocomplete="off" required>
        <datalist id="hideCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist><button class="btn"${st.hiding ? ' disabled' : ''}>Hide</button></div><span class="msg" aria-live="polite"></span></form></details>`;
  }

  async function saveAdo(next, okText, msgEl) {
    if (msgEl) msgEl.textContent = 'Saving...';
    try {
      // Only the keys this page owns, on top of what is saved now (Work items and the rest may have changed).
      st.ado = await saveKeys('ado', R.KEYS, next);
      st.rows = R.rows(st.oc || {}, cfg());
      toast(okText, 'success');
      return true;
    } catch (err) { if (msgEl) msgEl.textContent = errText(err); else toast(errText(err), 'error'); return false; }
  }

  function adoLine(r) {
    if (!canMap()) return '';
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
        ${whole ? '<p class="cfg-help">Every repo in this project is shown. Change that on the Pull requests page.</p>' : ''}</div>
      <div class="acts"><span class="msg" aria-live="polite"></span><button type="button" class="btn" data-repo-cancel>Cancel</button><button class="btn primary">Save</button></div></form>`;
  }

  function addForm() {
    const cats = (st.oc && st.oc.repoCategories) || [];
    return `<form class="cfg repo-add" data-repo-add>
      <div class="cfg-row"><label for="raUrl">Clone URL</label><input id="raUrl" name="url" class="cfg-input mono" required spellcheck="false" autocomplete="off" placeholder="https://ado.example.com/Collection/Project/_git/repo"></div>
      <div class="cfg-row"><label for="raCat">Category</label><select id="raCat" name="category" class="cfg-input">
        <option value="">None (top of the workspace)</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}<option value="${NEW_CAT}">New category</option></select>
        <p class="cfg-help">The folder in your workspace it goes in.</p></div>
      <div class="cfg-row" data-newcat hidden><label for="raNew">New category folder</label><input id="raNew" name="newcat" class="cfg-input mono" maxlength="300" placeholder="Platform or Platform/Lighthouse" spellcheck="false"><p class="cfg-help">Use / for a folder inside a category.</p></div>
      <div class="cfg-row"><label for="raAbout">What it is, in one line</label><input id="raAbout" name="about" class="cfg-input" maxlength="200" placeholder="The web app customers use"><p class="cfg-help">Optional. Helps agents pick the right repo for a task.</p></div>
      ${canMap() ? '<div class="cfg-row cfg-check"><input id="raWatch" name="watch" type="checkbox" checked><label for="raWatch">Show its pull requests in Docket</label><p class="cfg-help">For Azure DevOps repos. The connection and project come from the URL.</p></div>' : ''}
      <div class="acts"><span class="msg" aria-live="polite"></span><button type="button" class="btn" data-add-cancel>Cancel</button><button class="btn primary"${st.busy ? ' disabled' : ''}>${st.busy ? 'Cloning...' : 'Clone into workspace'}</button></div></form>`;
  }

  function paint() {
    const notes = [];
    if (!ocInfo) notes.push('The opencode connector is not installed, so workspace repos are not listed here.');
    else if (!st.oc) notes.push(st.ocError ? `Workspace repos need opencode: ${esc(st.ocError)}` : `Turn on opencode in ${pageLink('agents', 'Agents')} to list and add your workspace repos.`);
    if (adoInfo && st.ado && conn.info.ado && conn.info.ado.enabled && !conns().length) notes.push(`To link repos to Azure DevOps projects, add a connection in ${pageLink('connections', 'Connections')}.`);
    const todo = canMap() ? R.unmapped(st.rows) : [];
    const items = st.rows.map(r => st.editing === r.folder
      ? `<li class="repo editing"><p class="repo-name mono">${esc(r.folder)}</p>${repoForm(r)}</li>`
      : `<li class="repo"><div><p class="repo-name"><span class="mono">${esc(r.folder)}</span>${r.web ? ` <a class="lnk repo-web" href="${esc(r.web)}" target="_blank" rel="noopener" aria-label="Open ${esc(r.folder)}">${ARROW}</a>` : ''}</p>${adoLine(r)}</div>
          <span class="repo-acts">${canMap() ? `<button type="button" class="btn" data-repo-edit="${esc(r.folder)}">${r.ado && r.ado.from === 'mapping' ? 'Edit' : 'Set up'}</button>` : ''}<button type="button" class="btn ghost" data-repo-hide="${esc(r.folder)}" aria-label="Hide ${esc(r.folder)}"${st.hiding ? ' disabled' : ''}>Hide</button></span></li>`).join('');
    const added = st.added ? `<div class="moved" role="status"><p><b>${esc(st.added.folder)}</b> is in your workspace.${st.added.notes.map(n => ' ' + esc(n)).join('')}</p>
        <p>Next, draft its guide: an agent writes how to build, test and navigate it, for you to review. Follow it in Dispatch.</p>
        <div class="acts left"><button type="button" class="btn primary" data-guide="${esc(st.added.folder)}">Draft its guide</button><button type="button" class="btn" data-added-close>Later</button></div></div>` : '';
    body.innerHTML = (notes.length ? `<ul class="import-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '')
      + added
      + (todo.length ? `<div class="repo-todo"><p>${plural(todo.length, 'repo points', 'repos point')} at Azure DevOps but ${todo.length === 1 ? 'is' : 'are'} not saved yet, so agents may pick the wrong project.</p><button type="button" class="btn primary" data-map-all>Save ${todo.length === 1 ? 'it' : 'them'}</button></div>` : '')
      + (st.oc ? (st.rows.length ? `<ul class="people repos">${items}</ul>` : (hiddenList().length ? '<p class="sub">No repos to show. The ones you hid are under Hidden folders.</p>' : `<p class="sub">No repos in your workspace (<code>${esc(st.oc.workspace || '')}</code>) yet.</p>`)) : '')
      + (st.oc ? (st.adding ? addForm() : '<div class="acts left"><button type="button" class="btn primary" data-add-open>Add a repo</button></div>') : '')
      + hiddenCard();
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
    // Only while Azure DevOps is on with a connection; otherwise the Repos page is just your repos.
    mapSec.dataset.hide = canMap() ? '' : '1';
    mapSec.hidden = !canMap();
    if (!canMap()) { mapBody.innerHTML = ''; return; }
    const others = R.otherMappings(cfg(), st.rows);
    mapSec.querySelector('summary').textContent = others.length ? `Other folders (${others.length})` : 'Other folders';
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

  main.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('.repo-hidden')) st.hiddenOpen = e.target.open; }, true);
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
    if (t.matches('[data-repo-hide]')) { const f = t.dataset.repoHide; t.disabled = true; if (await saveHidden(R.hide(hiddenList(), f), `${f} hidden. Show it again under Hidden folders.`)) paint(); else t.disabled = false; return; }
    if (t.matches('[data-unhide]')) { const f = t.dataset.unhide; t.disabled = true; if (await saveHidden(R.unhide(hiddenList(), f), `${f} shown again`)) paint(); else t.disabled = false; return; }
    if (t.matches('[data-map-all]')) { t.disabled = true; if (await saveAdo(R.mapAll(cfg(), st.rows), 'Repos saved')) paint(); else t.disabled = false; return; }
    if (t.matches('[data-guide]')) {
      t.disabled = true;
      try { await ws.connectors.call('opencode', 'repo.guide', { repo: t.dataset.guide }, { confirm: true }); toast(`Drafting the guide for ${t.dataset.guide}. Follow it in Loom.`, 'success'); st.added = null; paint(); }
      catch (err) { t.disabled = false; toast(errText(err), 'error'); }
    }
  });
  main.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    if (form.matches('[data-repo-add]')) return addRepo(form);
    if (form.matches('[data-hide-add]')) {
      const msg = form.querySelector('.msg');
      let next;
      try { next = R.hide(hiddenList(), new FormData(form).get('folder')); } catch (err) { msg.textContent = err.message; return; }
      const f = R.hideEntry(new FormData(form).get('folder'));
      if (await saveHidden(next, `${f} hidden`, msg)) paint();
      return;
    }
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
  // Another browser tab changed the settings: read them again, unless a form is open here.
  const idle = () => !st.editing && st.editingMap == null && !st.adding && !st.busy;
  ws.on('visible', async ({ visible } = {}) => { if (visible && idle()) { await loadCfg('ado'); await load(); paint(); } });
  let lastKey = `${stateOf('ado')}|${stateOf('opencode')}|${(conn.info.opencode && conn.info.opencode.status || {}).state}`;
  // Another page here saved ADO settings, or turned ADO or opencode on or off.
  onChange.add(async (id, kind) => {
    if (!idle()) return;
    if (id === 'ado' && kind === 'config') { st.ado = conn.cc.ado; st.rows = R.rows(st.oc || {}, cfg()); paint(); }
    // A connector turned on or off, or came up: its repos (opencode) or ADO lines (ado) may have changed.
    const key = `${stateOf('ado')}|${stateOf('opencode')}|${(conn.info.opencode && conn.info.opencode.status || {}).state}`;
    if (kind === 'status' && key !== lastKey) { lastKey = key; await load(); paint(); }
  });
}

/* ---------- data: bundles ---------- */
function dataCard() {
  const sec = card('Backups', '', 'data', 60, 'Download a copy to back up your data or move it to another browser or computer. Importing a copy merges it with what is here.');
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
  if (!b) { card('Open Workshop', 'Work mode is on, but there is no usable pinned copy yet. Run <code>workshop pin</code> on this computer, then reload. Or turn work mode off in <a href="#" class="lnk" data-goto-page="computer">This computer</a>.'); return; }
  const one = (name, x) => x ? `${esc(name)} ${esc(x.ref || x.version || 'unknown version')}${x.commit ? ` <code>${esc(String(x.commit).slice(0, 12))}</code>` : ''}` : `${esc(name)} not included`;
  const sec = card('Open Workshop', '', 'overview', 50, 'Work mode is on: Workshop runs from the pinned copy on this computer, and no site can pair. The code only changes when you run workshop update. Turn apps on and off under Apps.');
  const parts = [one('Workshop', b.workshop), one('Docket', b.docket), one('Runway', b.runway), one('Rapport', b.receipts)];
  sec.insertAdjacentHTML('beforeend', `<p class="sub">${parts.join(' · ')} · built ${esc(new Date(b.builtAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', hour12: true }))}</p><ul class="sites"><li><a class="lnk" href="/">Open Workshop</a></li></ul>`);
}

// One button to Workshop's own site. Docket and Dispatch open inside Workshop, so their sites are not listed
// here; they stay under Allowed sites (This computer) for anyone who opens them on their own.
function sitesCard(cfg) {
  const sites = cfg.allowedOrigins || [];
  if (cfg.features && cfg.features.hostedMode !== true) { card('Open Workshop', 'Hosted mode is off, so Workshop\'s site cannot connect. Turn it on in <a href="#" class="lnk" data-goto-page="computer">This computer</a>.'); return; }
  if (!sites.length) { card('Open Workshop', 'No sites are allowed yet. Add Workshop\'s site in <a href="#" class="lnk" data-goto-page="computer">This computer</a>.'); return; }
  const site = sites.find(o => /\/\/workshop\./.test(o)) || sites[0];
  const sec = card('Open Workshop', 'This browser is signed in. Open Workshop and click <b>Connect</b> to pair it with this computer.');
  sec.classList.add('open-card');
  sec.insertAdjacentHTML('beforeend', `<div class="acts left"><a class="btn primary" data-open-site href="${esc(site)}/" target="_blank" rel="noopener">Open Workshop ${ARROW}</a>
    <span class="msg mono">${esc(site.replace(/^https?:\/\//, ''))}</span></div>`);
}

/* ---------- update (POST /api/update-terminal, Workshop on this computer) ----------
   The button opens a terminal you can see running "workshop update --restart": the agent runs no git itself. */
function updateCard() {
  const sec = card('Update', '', 'overview', 65, 'Moves Workshop, its apps and Tandem to their newest releases in a terminal window you can watch, then restarts Workshop if it changed. Nothing updates on its own.');
  sec.insertAdjacentHTML('beforeend', `<p class="sub update-ver"></p>
    <div class="acts left"><button type="button" class="btn" data-update>Update</button>
    <span class="msg update-msg" aria-live="polite"></span></div>`);
  const msg = sec.querySelector('.update-msg');
  agentCall('GET', '/api/health').then(h => { sec.querySelector('.update-ver').textContent = `Workshop ${h.version} is running.`; }).catch(() => {});
  sec.addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = 'Copied'; setTimeout(() => { c.textContent = 'Copy'; }, 1500); }
      catch (err) { toast('Could not copy. Select the command and copy it instead.', 'error'); }
      return;
    }
    const b = e.target.closest('[data-update]');
    if (!b) return;
    b.disabled = true;
    msg.textContent = 'Opening a terminal…';
    try {
      await agentCall('POST', '/api/update-terminal');
      msg.textContent = 'Updating in the terminal window. When it says Done, reload this page.';
    } catch (err) {
      msg.innerHTML = `${esc(errText(err))} Run this on your computer: <code>workshop update</code> ${copyBtn('workshop update')}`;
    } finally { b.disabled = false; }
  });
}

/* ---------- health check: what `workshop doctor` checks, here (GET /api/doctor, Workshop on this computer) ---------- */
function healthCard() {
  const sec = card('Health check', '', 'overview', 70, 'Node, the data folder, start at login and each connector, as Workshop on this computer sees them. For the full check run workshop doctor.');
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

/* ---------- People & teams (people.js) ---------- */
async function peoplePages() {
  try {
    people = await mountPeople({ ws, toast, peopleEl: page('people'), teamEl: page('team') });
    for (const [id, arg] of pendingCommands.splice(0)) people.command(id, arg);
    if (current === 'people') focusPart();
  } catch (e) { card('', '', 'people').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); }
}

/* ---------- Products (products-page.js, docs/products.md) ---------- */
async function productsPage() {
  try {
    products = await mountProducts({ ws, toast, el: page('products') });
    if (pendingProduct && products) { pendingProduct = false; products.command('add-product'); }
  }
  catch (e) { card('', '', 'products').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); }
}

/* ---------- Focus hours (focus-page.js, docs/focus.md) ---------- */
async function focusPage() {
  try { await mountFocus({ ws, el: page('focus'), toast }); }
  catch (e) { card('', '', 'focus').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); }
}

/* ---------- Writing (voice-page.js, docs/writing.md) ---------- */
async function writingPages() {
  try { await mountWriting({ ws, toast, pageEl: id => page(id) }); }
  catch (e) { card('', '', 'writing-voice').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`); }
}

/* ---------- start ---------- */
async function start() {
  header();
  page('overview');
  if (ws.backend === 'agent') {
    try {
      const cfg = await ws.config.get();
      if (ws.mode === 'local') { if (cfg.features && cfg.features.workMode) await workCard(); else sitesCard(cfg); }
      if (ws.mode === 'local') { updateCard(); healthCard(); }
      await appsCard();
      await focusPage();
      await computerCard(cfg);
      await folderCard(cfg);
      await peoplePages();
      const list = await connectorsSetup();
      await productsPage();
      if (list.some(i => i.id === 'opencode')) await writingPages(); // Writing needs opencode for its AI steps
      statusCard();
      await reposTab(list);
      updateGates();
    } catch (e) {
      card('Workshop').insertAdjacentHTML('beforeend', `<p class="err">${esc(errText(e))}</p>`);
    }
  } else {
    // Not paired, or the agent is not running. Pairing is Connect in the shell's rail (https only); its dialog
    // covers signing this browser in (workshop open).
    card('Workshop on this computer', 'Not connected, so connectors are off. If Workshop is not running, run <code>workshop start</code>. Then '
      + (location.protocol === 'https:' ? 'click <b>Connect</b>.' : 'open Workshop from its site and click <b>Connect</b>.'));
    await appsCard();
    await focusPage();
    await folderCard(null);
    await peoplePages();
    await productsPage();
  }
  dataCard();
  tipsCard();
  mountGuide({ ws, el: page('guide') });
  if (pages.has(wantPage) && current !== wantPage) selectPage(wantPage);
  if (!current) selectPage('overview');
}

// The quiet ? hints retire after a few uses (shared/theme.js); this brings them back.
function tipsCard() {
  if (!globalThis.WorkshopTheme?.hints) return;
  const sec = card('Tips', 'The ? hints next to headings go away once you have opened each one a few times.', pages.has('computer') ? 'computer' : 'overview', 80);
  sec.insertAdjacentHTML('beforeend', '<div class="acts left"><button type="button" class="btn" data-hints-reset>Show tips again</button></div>');
  sec.addEventListener('click', e => { if (e.target.closest('[data-hints-reset]')) { globalThis.WorkshopTheme?.hints.reset(); toast('Tips are back.'); } });
}
await start();

/* Workshop shell: the app rail, routing between apps, the theme picker, the toast, the command palette,
   hosted pairing, and the shell side of the SDK message protocol (docs/sdk.md).

   The rail, routes, Alt+<n>, shortcuts and palette are built from the app manifests: GET /api/apps when
   the agent serves this page (local mode), else apps/registry.json (hosted and browser modes; written by
   node shell/registry.mjs). Adding an app is adding an apps/<id>/ folder with an app.json. No shell or
   service worker edit is needed.

   A manifest app is a same-origin page in a frame, kept loaded while hidden so its state survives
   switching. Apps talk to the shell only through the SDK: the shell answers their requests (ready, open,
   toast, badge, notify, commands.register, commands.unregister) and sends them events (theme, route,
   command, visible). Every app is a manifest app; the shell has no app code of its own. */
import { allowFolder, detectBackend, folderState } from '../shared/workshop-sdk.js';

const $ = s => document.querySelector(s);
const svg = d => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAIR_KEY = 'workshop.agent';
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})$/;

let env = { mode: 'browser', backend: 'browser', agentUrl: null, token: null };
let apps = [];            // [{id, manifest, base, frame?, ...}]
let byId = {};
let railApps = [];        // apps with a rail button: every app but the home page
let homeApp = null;       // the app with home: true, opened by the logo and the plain address
let connectors = [];      // GET /api/connectors, agent backend only
let current = null;
const mounted = new Set();

/* ---------- the agent ---------- */
async function agentGet(pathname) {
  const r = await fetch(env.agentUrl + pathname, { cache: 'no-store', targetAddressSpace: 'loopback', headers: env.token ? { 'X-Workshop-Token': env.token } : {} });
  if (!r.ok) throw new Error(`${pathname} answered ${r.status}`);
  return r.json();
}

/* ---------- the app list ---------- */
// Local mode reads the agent's list. Hosted and browser modes read the static registry: a hosted page
// can only frame pages from its own origin, so the apps it shows are the ones published with it.
async function fetchAppList() {
  if (env.mode === 'local') {
    try { return (await agentGet('/api/apps')).apps || []; } catch (e) { /* fall back to the registry */ }
  }
  try {
    const r = await fetch('apps/registry.json', { cache: 'no-store' });
    if (r.ok) return (await r.json()).apps || [];
  } catch (e) { /* no registry */ }
  return [];
}

async function loadApps() {
  const list = await fetchAppList();
  if (env.backend === 'agent') {
    try { connectors = (await agentGet('/api/connectors')).connectors || []; } catch (e) { connectors = []; }
  }
  apps = list.map(a => ({ id: a.manifest.id, manifest: a.manifest, base: String(a.base).replace(/^\//, '') }))
    .filter(a => !a.manifest.modes || a.manifest.modes.includes(env.mode))
    .sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
  byId = Object.fromEntries(apps.map(a => [a.id, a]));
  homeApp = apps.find(a => a.manifest.home === true) || null;
  railApps = apps.filter(a => a !== homeApp);
}

// The first required connector of an app that is not usable right now, or null.
function missingConnector(app) {
  for (const need of app.manifest.connectors || []) {
    if (!need.required) continue;
    const c = connectors.find(x => x.id === need.id);
    if (!c || c.status.state !== 'ready') return { id: need.id, name: c ? c.name : need.id, state: env.backend !== 'agent' ? 'browser' : c ? c.status.state : 'missing' };
  }
  return null;
}

/* ---------- rail ---------- */
const THEME_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>';
const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6.5" fill="currentColor"/><g fill="var(--on-accent)"><rect x="5" y="5" width="6.2" height="6.2" rx="1.8"/><rect x="12.8" y="5" width="6.2" height="6.2" rx="1.8" opacity=".38"/><rect x="5" y="12.8" width="6.2" height="6.2" rx="1.8" opacity=".38"/><rect x="12.8" y="12.8" width="6.2" height="6.2" rx="1.8" opacity=".38"/></g></svg>';
const INSTALL_ICON = svg('<rect x="3" y="3.5" width="14" height="10" rx="1.8"/><path d="M7 17h6M10 6.5v4.5M8 9l2 2 2-2"/>');
const LINK_ICON = svg('<path d="M8.5 11.5l3-3"/><path d="M10.6 5.9l1.2-1.2a3 3 0 0 1 4.2 4.2l-1.2 1.2M9.4 14.1l-1.2 1.2a3 3 0 0 1-4.2-4.2l1.2-1.2"/>');
const BLANK_ICON = svg('<rect x="4" y="4" width="12" height="12" rx="2.5"/>');

function renderRail() {
  $('#rail').innerHTML = `<a class="mark" href="#/" aria-label="${homeApp ? esc(homeApp.manifest.name) : 'Workshop'}" title="${homeApp ? esc(homeApp.manifest.name) : 'Workshop'}">${MARK}</a>`
    + railApps.map((a, i) => `<a class="app-btn" href="#/${a.id}" data-app="${a.id}" title="${esc(a.manifest.name)}${i < 9 ? ` (Alt+${i + 1})` : ''}"><span class="ico" aria-hidden="true">${BLANK_ICON}</span><span class="lbl">${esc(a.manifest.name)}</span><span class="badge" hidden></span></a>`).join('')
    + `<span class="grow"></span>`
    + `<button class="app-btn" id="pairBtn" hidden aria-label="Use Workshop on this computer" title="Use Workshop on this computer">${LINK_ICON}<span class="lbl">Connect</span></button>`
    + `<button class="app-btn" id="installBtn" hidden aria-label="Install Workshop as a desktop app" title="Install as a desktop app">${INSTALL_ICON}<span class="lbl">Install</span></button>`
    + `<button class="app-btn" id="themeBtn" aria-label="Theme" title="Theme">${THEME_ICON}</button>`;
  for (const a of railApps) loadIcon(a);
  $('#pairBtn').hidden = !canPair();
}

// Manifest icons are stroke SVGs that use currentColor, so they are inlined (an <img> cannot inherit the
// color). The file is same-origin; only the <svg> element and its drawing children are kept.
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const SVG_ATTRS = new Set(['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'fill-rule', 'clip-rule']);
function cleanSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return null;
  const walk = el => {
    if (!SVG_TAGS.has(el.nodeName)) { el.remove(); return; }
    for (const at of [...el.attributes]) if (!SVG_ATTRS.has(at.name)) el.removeAttribute(at.name);
    [...el.children].forEach(walk);
  };
  walk(root);
  root.setAttribute('aria-hidden', 'true');
  return new XMLSerializer().serializeToString(root);
}
async function loadIcon(app) {
  try {
    const r = await fetch(app.base + (app.manifest.icon || 'icon.svg'));
    const clean = r.ok && cleanSvg(await r.text());
    const slot = document.querySelector(`.app-btn[data-app="${app.id}"] .ico`);
    if (clean && slot) slot.innerHTML = clean;
  } catch (e) { /* keep the blank icon */ }
}

function markRail() {
  document.querySelectorAll('.app-btn[data-app]').forEach(b => {
    const on = b.dataset.app === current;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const mark = $('#rail .mark');
  if (mark) {
    const on = !!homeApp && current === homeApp.id;
    mark.classList.toggle('on', on);
    if (on) mark.setAttribute('aria-current', 'page'); else mark.removeAttribute('aria-current');
  }
}
function setBadge(appId, count) {
  const el = document.querySelector(`.app-btn[data-app="${appId}"] .badge`);
  if (!el) return;
  const n = Number.isInteger(count) ? Math.max(0, Math.min(999, count)) : 0;
  el.hidden = n === 0;
  el.textContent = n ? String(n) : '';
}

/* ---------- routing: #/<app>[/<path>]. The home page (or the first rail app) has the bare address, no #. ---------- */
// The home page if an app is marked home: true, else the first app on the rail.
const homeId = () => homeApp ? homeApp.id : railApps.length ? railApps[0].id : null;
// Addresses from before an app was renamed: the Dashboard pane became the Agents app (WS6).
const RENAMED = { dashboard: 'agents' };
function parseHash() {
  let [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  if (!byId[id] && byId[RENAMED[id]]) id = RENAMED[id];
  return { id: byId[id] ? id : null, path: rest.length ? rest.map(decodeURIComponent).join('/') : '' };
}
function route() {
  const parsed = parseHash(), id = parsed.id || homeId();
  const app = byId[id];
  if (!app) return;
  const prev = current && current !== id ? byId[current] : null;
  if (prev) sendTo(prev, 'visible', { visible: false });
  current = id;
  let pane = document.getElementById('pane-' + id);
  if (!pane) {
    pane = document.createElement('section');
    pane.className = 'pane'; pane.id = 'pane-' + id; pane.setAttribute('aria-label', app.manifest.name);
    $('#panes').appendChild(pane);
  }
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p !== pane; });
  if (!mounted.has(id)) ensureMounted(app, pane);
  sendTo(app, 'visible', { visible: true }); // before ready, the ready reply carries it
  deliverRoute(app, parsed.path);
  focusFrame(app);
  document.title = `${app.manifest.name} · Workshop`;
  markRail();
  // Tidy the address: home is the bare page, and a one-time path is dropped so a reload does not repeat it.
  const want = id === homeId() ? '' : '#/' + id;
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
}
function go(id, path) {
  const h = '#/' + id + (path ? '/' + String(path).split('/').map(encodeURIComponent).join('/') : '');
  if (location.hash === h) route(); else location.hash = h;
}

/* ---------- a manifest app in a frame ---------- */
const frameToApp = new Map(); // contentWindow -> app, so an app cannot act as another
// An app with required connectors gets a fresh connector list first: Settings may have turned one on.
async function ensureMounted(app, pane) {
  if (env.backend === 'agent' && (app.manifest.connectors || []).some(c => c.required)) {
    try { connectors = (await agentGet('/api/connectors')).connectors || []; } catch (e) { /* keep what we had */ }
    if (mounted.has(app.id)) return;
  }
  mountFrame(app, pane);
}
function mountFrame(app, pane) {
  const missing = missingConnector(app);
  if (missing) {
    // A required connector is unavailable: show a notice instead of loading the app (docs/app-manifest.md).
    const why = missing.state === 'browser' ? 'Connectors need Workshop running on this computer.'
      : missing.state === 'missing' ? `The ${esc(missing.name)} connector is not installed.`
      : `The ${esc(missing.name)} connector is ${missing.state === 'disabled' ? 'turned off' : 'not ready'}.`;
    pane.innerHTML = `<div class="notice"><h2>${esc(app.manifest.name)} needs ${esc(missing.name)}</h2><p>${why}</p>${byId.settings && env.backend === 'agent' ? '<p><a class="btn" href="#/settings">Open Settings</a></p>' : ''}</div>`;
    return; // not marked mounted, so the next visit checks again
  }
  pane.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.src = app.base + (app.manifest.entry || 'index.html');
  frame.title = app.manifest.name;
  pane.appendChild(frame);
  app.frame = frame;
  frameToApp.set(frame.contentWindow, app);
  // Keys pressed inside the frame never reach the shell document. The frame is same-origin, so listen on
  // its window directly (again after every load): Alt+<n>, Ctrl+K and global shortcuts work everywhere.
  frame.addEventListener('load', () => {
    frameToApp.set(frame.contentWindow, app);
    try { frame.contentWindow.addEventListener('keydown', onKey, true); } catch (e) { /* not same-origin */ }
  });
  mounted.add(app.id);
}
function focusFrame(app) { if (app.frame) setTimeout(() => { try { app.frame.contentWindow.focus(); } catch (e) { /* not loaded yet */ } }); }

/* ---------- the SDK message protocol, shell side ---------- */
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.workshop !== 1 || e.data.kind !== 'request') return;
  const app = frameToApp.get(e.source);
  if (!app) return; // only our own app frames
  const { id, method, params } = e.data;
  Promise.resolve().then(() => handleRequest(app, method, params || {})).then(
    result => reply(e.source, id, { ok: true, result: result === undefined ? null : result }),
    err => reply(e.source, id, { ok: false, error: { code: err.code || 'internal', message: err.message || 'Something went wrong.' } }));
});
function reply(win, id, body) {
  try { win.postMessage(Object.assign({ workshop: 1, kind: 'response', id }, body), location.origin); } catch (e) { /* frame gone */ }
}
function sendTo(app, event, payload) {
  if (!app || !app.frame || !app.readySent) return;
  try { app.frame.contentWindow.postMessage({ workshop: 1, kind: 'event', event, payload }, location.origin); } catch (e) { /* frame gone */ }
}
const themeNow = () => { const key = WorkshopTheme.current(); return { key, scheme: WorkshopTheme.scheme(key) }; };
const fail = (code, message) => Object.assign(new Error(message), { code });

// A route is sent once the app is ready; before that it waits and goes out in the ready reply.
function deliverRoute(app, path) {
  if (app.readySent) sendTo(app, 'route', { path });
  else app.pendingRoute = path;
}
// Commands chosen before the app is ready wait for it.
function deliverCommand(app, id) {
  if (app.readySent) sendTo(app, 'command', { id });
  else (app.pendingCommands ||= []).push(id);
}

function handleRequest(app, method, p) {
  switch (method) {
    case 'ready': {
      if (p.app !== app.id) throw fail('bad_request', `This frame is ${app.id}, not ${p.app}.`);
      app.readySent = true;
      const route = app.pendingRoute || '';
      app.pendingRoute = undefined;
      const queued = app.pendingCommands || [];
      app.pendingCommands = [];
      if (queued.length) setTimeout(() => queued.forEach(c => sendTo(app, 'command', { id: c })));
      return { theme: themeNow(), route, visible: current === app.id };
    }
    case 'open': {
      if (!byId[p.app]) throw fail('not_found', `There is no ${p.app} app here.`);
      go(p.app, p.path || '');
      return null;
    }
    case 'toast': {
      const a = p.action;
      toast(String(p.text || ''), a && a.label, a && a.command ? () => sendTo(app, 'command', { id: a.command }) : null, p.kind === 'error' || p.kind === 'warn' ? 8000 : 4000, p.kind);
      return null;
    }
    case 'badge': setBadge(app.id, p.count); return null;
    case 'notify': notify(app, p); return null;
    case 'commands.register': {
      (app.runtimeCommands ||= new Map()).set(p.id, { title: p.title, shortcut: p.shortcut });
      return null;
    }
    case 'commands.unregister': { if (app.runtimeCommands) app.runtimeCommands.delete(p.id); return null; }
    default: throw fail('not_found', `The shell does not know "${method}".`);
  }
}

function notify(app, p) {
  const open = () => go(app.id, p.route || '');
  if (typeof Notification === 'function' && Notification.permission === 'granted') {
    const n = new Notification(p.title, { body: p.body || '' });
    n.onclick = () => { window.focus(); open(); n.close(); };
  } else {
    toast(p.body ? `${p.title}: ${p.body}` : p.title, 'Open', open);
  }
}

/* ---------- command palette (Ctrl+K) ----------
   Manifest commands (shown before the app has loaded) plus commands apps register at runtime, plus a few
   of the shell's own. Choosing an app command opens the app (at its route, if any) and sends it the
   command event. */
let palette = null;
function allCommands() {
  const out = [];
  for (const app of apps) {
    const seen = new Set();
    for (const c of app.manifest.commands || []) { seen.add(c.id); out.push({ app, id: c.id, title: c.title, route: c.route }); }
    for (const [id, c] of app.runtimeCommands || []) if (!seen.has(id)) out.push({ app, id, title: c.title });
  }
  for (const a of apps) out.push({ title: `Go to ${a.manifest.name}`, run: () => go(a.id) });
  if (canPair()) out.push({ title: 'Use Workshop on this computer', run: startPairing });
  if (env.mode === 'hosted') out.push({ title: 'Stop using Workshop on this computer', run: forgetPairing });
  return out;
}
function runCommand(c) {
  if (c.run) return c.run();
  if (current !== c.app.id || c.route) go(c.app.id, c.route || '');
  deliverCommand(c.app, c.id);
}
function openPalette() {
  closePalette();
  const cmds = allCommands();
  palette = document.createElement('div');
  palette.className = 'cmdk';
  palette.innerHTML = `<div class="cmdk-backdrop"></div><div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Commands">
    <input class="cmdk-input" type="text" placeholder="Type a command" aria-label="Command" autocomplete="off" role="combobox" aria-controls="cmdkList" aria-expanded="true">
    <ul class="cmdk-list" id="cmdkList" role="listbox"></ul></div>`;
  document.body.appendChild(palette);
  const input = palette.querySelector('.cmdk-input'), list = palette.querySelector('.cmdk-list');
  let active = 0, shown = cmds;
  const draw = () => {
    list.innerHTML = shown.map((c, i) => `<li role="option" id="cmdk${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? 'on' : ''}"><span>${esc(c.title)}</span>${c.app ? `<span class="cmdk-app">${esc(c.app.manifest.name)}</span>` : ''}</li>`).join('') || '<li class="cmdk-empty">No commands match.</li>';
    input.setAttribute('aria-activedescendant', shown.length ? 'cmdk' + active : '');
    const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const run = c => { closePalette(); if (c) runCommand(c); };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? cmds.filter(c => (c.title + ' ' + (c.app ? c.app.manifest.name : '')).toLowerCase().includes(q)) : cmds;
    active = 0; draw();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) run(shown[+li.dataset.i]); });
  palette.querySelector('.cmdk-backdrop').addEventListener('click', closePalette);
  draw(); input.focus();
}
function closePalette() {
  if (!palette) return;
  palette.remove(); palette = null;
  const app = byId[current]; if (app) focusFrame(app);
}

/* ---------- keyboard: Alt+<n>, Ctrl+K and shortcuts, from the shell or from inside an app frame ---------- */
function comboOf(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  const name = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', name].filter(Boolean).join('+');
}
function onKey(e) {
  if (e.key === 'Escape' && palette) { e.preventDefault(); closePalette(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') { e.preventDefault(); e.stopPropagation(); palette ? closePalette() : openPalette(); return; }
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && e.altKey && !e.ctrlKey && !e.metaKey) {
    const a = railApps[+digit[1] - 1];
    if (a) { e.preventDefault(); e.stopPropagation(); go(a.id); }
    return;
  }
  const combo = comboOf(e);
  if (!combo || !(e.ctrlKey || e.altKey || e.metaKey)) return;
  for (const app of apps) {
    for (const sc of app.manifest.shortcuts || []) {
      if (sc.keys === combo && (sc.scope === 'global' || current === app.id)) {
        e.preventDefault(); e.stopPropagation();
        const c = (app.manifest.commands || []).find(x => x.id === sc.command);
        return runCommand({ app, id: sc.command, route: c && c.route });
      }
    }
    if (current === app.id) for (const [id, c] of app.runtimeCommands || []) {
      if (c.shortcut === combo) { e.preventDefault(); e.stopPropagation(); return deliverCommand(app, id); }
    }
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && menu) { closeMenu(); $('#themeBtn').focus(); return; }
  onKey(e);
});

/* ---------- theme menu ---------- */
let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; } }
function openThemeMenu(anchor) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'menu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = WorkshopTheme.menuHtml();
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - m.width - 8, r.right + 8)) + 'px';
  menu.style.top = Math.max(8, r.bottom - m.height) + 'px';
  menu.addEventListener('click', e => { const b = e.target.closest('[data-th]'); if (b) { WorkshopTheme.set(b.dataset.th); closeMenu(); anchor.focus(); } });
  const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
  if (first) first.focus();
}
document.addEventListener('click', e => {
  const tb = e.target.closest('#themeBtn');
  if (tb) { menu ? closeMenu() : openThemeMenu(tb); return; }
  if (menu && !menu.contains(e.target)) closeMenu();
});
// Every app frame gets the theme event (same-origin pages also follow workshop.theme in localStorage).
WorkshopTheme.onChange(() => { const t = themeNow(); for (const a of apps) sendTo(a, 'theme', t); });

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, label, fn, ms = 4000, kind) {
  const el = $('#toast');
  el.innerHTML = '';
  if (kind && kind !== 'info') el.dataset.kind = kind; else delete el.dataset.kind;
  const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
  if (label && fn) {
    const b = document.createElement('button'); b.textContent = label;
    b.addEventListener('click', () => { el.classList.remove('show'); fn(); });
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- hosted pairing (docs/run-modes.md, Pairing) ----------
   On a static site (not the agent's own page), the user can pair this browser with Workshop on their
   computer. The agent's /pair page asks them to allow this origin, then posts {type: 'workshop-pair', api,
   url, token} back. The pair is stored as workshop.agent; on reload the SDK uses the agent. */
const canPair = () => env.mode === 'browser' && location.protocol === 'https:';
let pairWin = null;
async function startPairing() {
  const port = await askPort();
  if (!port) return;
  const agent = `http://127.0.0.1:${port}`;
  pairWin = window.open(`${agent}/pair?origin=${encodeURIComponent(location.origin)}`, 'workshop-pair', 'popup,width=520,height=420');
  if (!pairWin) toast('Your browser blocked the window. Allow pop-ups for this site and try again.', null, null, 8000, 'warn');
}
window.addEventListener('message', e => {
  const m = e.data;
  if (!pairWin || e.source !== pairWin || !m || m.type !== 'workshop-pair' || m.api !== 1) return;
  if (!LOOPBACK.test(e.origin) || m.url !== e.origin || typeof m.token !== 'string' || !m.token) return;
  try { localStorage.setItem(PAIR_KEY, JSON.stringify({ url: m.url, token: m.token })); } catch (err) { return toast('This browser would not save the connection.', null, null, 8000, 'error'); }
  pairWin = null;
  location.reload();
});
function forgetPairing() {
  try { localStorage.removeItem(PAIR_KEY); } catch (e) { /* nothing stored */ }
  location.reload();
}
function askPort() {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.className = 'cmdk';
    d.innerHTML = `<div class="cmdk-backdrop"></div><form class="cmdk-box pair" role="dialog" aria-modal="true" aria-labelledby="pairTitle">
      <h2 id="pairTitle">Use Workshop on this computer</h2>
      <p>Your data stays on this computer. Workshop must be running, hosted mode must be on, and this site must be in its allowed origins (Settings, on this computer).</p>
      <label>Port <input class="mono" type="number" min="1024" max="65535" value="4380" required></label>
      <div class="acts"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Continue</button></div></form>`;
    document.body.appendChild(d);
    const input = d.querySelector('input');
    const done = v => { d.remove(); resolve(v); };
    d.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const n = Math.round(+input.value); done(n >= 1024 && n <= 65535 ? n : null); });
    d.querySelector('[data-x]').addEventListener('click', () => done(null));
    d.querySelector('.cmdk-backdrop').addEventListener('click', () => done(null));
    d.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    input.focus(); input.select();
  });
}
document.addEventListener('click', e => { if (e.target.closest('#pairBtn')) startPairing(); });

/* ---------- folder access (docs/run-modes.md, Folder store) ----------
   In browser mode with a folder chosen, Chrome may need the user to allow it again (after a restart, for
   example). It only asks after a click, so the shell shows one bar with a button; apps keep their edits and
   retry, and get an online event when access is back. A refused or missing folder links to Settings. */
async function folderBar() {
  if (env.backend !== 'browser') return;
  let st;
  try { st = await folderState(); } catch (e) { return; }
  const bar = document.getElementById('folderBar');
  if (st.storage !== 'folder' || (st.permission === 'granted' && !st.missing)) { if (bar) bar.remove(); $('#panes').classList.remove('has-bar'); return; }
  const el = bar || document.createElement('div');
  el.id = 'folderBar'; el.className = 'folder-bar'; el.setAttribute('role', 'alert');
  const name = esc(st.name || 'your Workshop folder');
  el.innerHTML = st.missing ? `<span>The folder <b>${name}</b> is gone. It may have been moved, renamed or deleted.</span><a class="btn" href="#/settings">Choose it in Settings</a>`
    : st.permission === 'denied' ? `<span>Workshop is not allowed to use the folder <b>${name}</b>, so nothing is saved.</span><button class="btn primary" data-allow>Try again</button><a class="btn ghost" href="#/settings">Settings</a>`
    : `<span>Chrome needs your OK before Workshop can save again. Your changes wait until then.</span><button class="btn primary" data-allow>Allow Workshop to use the folder ${name}</button>`;
  if (!bar) $('#panes').prepend(el);
  $('#panes').classList.add('has-bar');
}
document.addEventListener('click', async e => {
  if (!e.target.closest('#folderBar [data-allow]')) return;
  try {
    const st = await allowFolder();
    if (st.permission === 'granted' && !st.missing) toast('Workshop can use the folder again.', null, null, 4000, 'success');
  } catch (err) { toast(err.message || 'Could not get access to the folder.', null, null, 8000, 'error'); }
  folderBar();
});
// Allowed from another tab or app frame: the bar goes away there too.
if (typeof BroadcastChannel === 'function') new BroadcastChannel('workshop-data').addEventListener('message', e => { if (e.data && e.data.folder === 'granted') folderBar(); });

/* ---------- install as a desktop app ---------- */
let installPrompt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function setInstall() { const b = $('#installBtn'); if (b) b.hidden = !installPrompt || standalone(); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; setInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; setInstall(); toast('Workshop is installed. Open it from your dock, taskbar or Start menu.'); });
document.addEventListener('click', async e => {
  if (!e.target.closest('#installBtn') || !installPrompt) return;
  const p = installPrompt; installPrompt = null; setInstall();
  try { await p.prompt(); await p.userChoice; } catch (err) { /* each prompt works once; the browser offers a fresh one later */ }
});

/* ---------- start ---------- */
env = await detectBackend();
document.documentElement.dataset.mode = env.mode;
await loadApps();
renderRail();
setInstall();
folderBar();
if (!apps.length) $('#panes').innerHTML = '<div class="notice"><h2>No apps found</h2><p>There is no app list for this site. If you publish Workshop as static files, run <code>node shell/registry.mjs</code> first.</p></div>';
window.addEventListener('hashchange', route);
route();
WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000));

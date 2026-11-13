/* Workshop shell: the app rail, the top bar (crumbs and the light/dark toggle), routing between apps, the toast, the command palette,
   hosted pairing, and the shell side of the SDK message protocol (docs/sdk.md).

   The rail, routes, Alt+<n>, shortcuts and palette are built from the app manifests in apps/registry.json
   (written by node shell/registry.mjs). The shell always comes from the hosted site, paired with the agent
   (hosted mode) or not (browser mode); the agent itself serves only Workshop on this computer (Settings).
   Adding an app is adding an apps/<id>/ folder with an app.json. No shell or service worker edit is needed.

   A manifest app is a same-origin page in a frame, kept loaded while hidden so its state survives
   switching. Apps talk to the shell only through the SDK: the shell answers their requests (ready, open, route.set,
   toast, badge, notify, status.set, status.clear, commands.register, commands.unregister) and sends them events (theme, route,
   command, visible). Every app is a manifest app; the shell has no app code of its own. */
import { allowFolder, detectBackend, folderState } from '../shared/workshop-sdk.js';
import { SITE, onCrumbsDomain } from '../shared/site.js';
import { PAIR_HELP, canPair as canPairWith, forgetPairing, pairWith } from '../shared/pair.js';
import { CAPTURE_ICON, createCaptureBar } from './capture.js';
import { createFocusShell } from './focus.js';

const $ = s => document.querySelector(s);
const svg = d => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let env = { mode: 'browser', backend: 'browser', agentUrl: null, token: null };
let apps = [];            // [{id, manifest, base, frame?, ...}]
let byId = {};
let railApps = [];        // apps with a rail button: every app but the home page
let homeApp = null;       // the app with home: true, opened by the logo and the plain address
let panelApp = null;      // the app with panel: true, shown over the current app from a top bar button (Needs you)
let aliasTo = {};         // app names and string aliases -> app id, for addresses like #/docket (docs/app-manifest.md, Addresses)
let hostedBy = {};        // hosted app id -> {host, path}: shown inside another app (docs/app-manifest.md, Hosted apps)
let connectors = [];      // GET /api/connectors, agent backend only
let current = null;
const mounted = new Set();

/* ---------- pop-out windows: ?solo=<app id> shows one app on its own, without the rail ----------
   Same page and origin as the main window, so data, pairing and the agent are the same. Anything that opens
   another app goes to the main Workshop window (named MAIN_WINDOW), which comes to the front. */
const SOLO = new URLSearchParams(location.search).get('solo') || null;
// A pop-out window takes its app's color (shared/themes.css), so windows side by side are easy to tell apart.
if (SOLO && /^[a-z][a-z0-9-]{0,39}$/.test(SOLO)) document.documentElement.dataset.appColor = SOLO;
const MAIN_WINDOW = 'workshop-main';
if (SOLO) document.documentElement.classList.add('solo');
else if (!window.name) window.name = MAIN_WINDOW;

/* Which apps are popped out. Each pop-out says so on a BroadcastChannel when it opens and closes, and answers the
   main window's ping, so the main window brings an app's window forward instead of opening the app a second time,
   and marks it on the rail. A pop-out also follows a link the main window passes on ({type: 'route'}). */
const SOLO_CHANNEL = 'workshop-solo';
const popped = new Set();
let soloBus = null;
try { soloBus = new BroadcastChannel(SOLO_CHANNEL); } catch (e) { soloBus = null; }
const soloSay = (msg) => { try { if (soloBus) soloBus.postMessage(msg); } catch (e) { /* closed */ } };
if (soloBus && SOLO) {
  soloBus.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'ping') soloSay({ type: 'open', id: SOLO });
    else if (d.type === 'route' && d.id === SOLO) { location.hash = '#/' + SOLO + (d.path ? '/' + String(d.path).split('/').map(encodeURIComponent).join('/') : ''); window.focus(); }
  });
  soloSay({ type: 'open', id: SOLO });
  addEventListener('pagehide', () => soloSay({ type: 'closed', id: SOLO }));
} else if (soloBus) {
  soloBus.addEventListener('message', (e) => {
    const d = e.data || {};
    if (typeof d.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(d.id)) return;
    if (d.type === 'open') popped.add(d.id); else if (d.type === 'closed') popped.delete(d.id); else return;
    markRail();
  });
  soloSay({ type: 'ping' });
}
/** Bring an app's pop-out window forward. False (and the app is no longer marked) when that window is gone. */
function focusPopped(id) {
  let win = null;
  try { win = window.open('', 'workshop-solo-' + id); } catch (e) { win = null; }
  let blank = false;
  try { blank = !!win && win.location.href === 'about:blank'; } catch (e) { blank = false; }
  if (!win || blank) { if (win) win.close(); popped.delete(id); markRail(); return false; }
  win.focus();
  return true;
}

/* ---------- the agent ---------- */
async function agentGet(pathname) {
  const r = await fetch(env.agentUrl + pathname, { cache: 'no-store', targetAddressSpace: 'loopback', headers: env.token ? { 'X-Workshop-Token': env.token } : {} });
  if (!r.ok) throw new Error(`${pathname} answered ${r.status}`);
  return r.json();
}

/* ---------- the app list ---------- */
// The static registry: the shell can only frame pages from its own origin, so the apps it shows are the
// ones published with it (including apps from another site, served under /apps/<id>/ by the Worker).
async function fetchAppList() {
  try {
    const r = await fetch('apps/registry.json', { cache: 'no-store' });
    if (r.ok) return (await r.json()).apps || [];
  } catch (e) { /* no registry */ }
  return [];
}

// Apps turned off in Settings, Apps (docs/apps.md): the agent's switches, or this browser's without one. Home
// and Settings always stay. An older agent without switches turns nothing off.
async function appsOff() {
  if (env.backend === 'agent') {
    try { return new Set(((await agentGet('/api/app-switches')).apps || []).filter(a => !a.on).map(a => a.id)); } catch (e) { return new Set(); }
  }
  try { const v = JSON.parse(localStorage.getItem('workshop.appsOff') || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (e) { return new Set(); }
}

async function loadApps() {
  const list = await fetchAppList();
  if (env.backend === 'agent') {
    try { connectors = (await agentGet('/api/connectors')).connectors || []; } catch (e) { connectors = []; }
  }
  const off = await appsOff();
  apps = list.map(a => ({ id: a.manifest.id, manifest: a.manifest, base: String(a.base).replace(/^\//, '') }))
    .filter(a => !a.manifest.modes || a.manifest.modes.includes(env.mode))
    .filter(a => a.manifest.home === true || a.manifest.panel === true || a.id === 'settings' || !off.has(a.id))
    .sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
  // An app shown inside another one (manifest `hosts`) leaves the rail and the palette while both are on; its
  // addresses open in the host (resolveApp).
  hostedBy = {};
  const ids = new Set(apps.map(a => a.id));
  for (const a of apps) for (const h of a.manifest.hosts || []) if (h && ids.has(h.app) && h.app !== a.id && !hostedBy[a.id]) hostedBy[h.app] = { host: a.id, path: h.path };
  apps = apps.filter(a => !hostedBy[a.id]);
  byId = Object.fromEntries(apps.map(a => [a.id, a]));
  homeApp = apps.find(a => a.manifest.home === true) || null;
  panelApp = apps.find(a => a.manifest.panel === true && a !== homeApp) || null;
  railApps = apps.filter(a => a !== homeApp && a !== panelApp);
  // Names and aliases as addresses: an id always wins, then the first app by order.
  aliasTo = {};
  const key = w => String(w).toLowerCase().replace(/\s+/g, '');
  for (const a of apps) for (const w of [a.manifest.name, ...(a.manifest.aliases || []).filter(x => typeof x === 'string')]) {
    const k = key(w);
    if (k && !byId[k] && !aliasTo[k]) aliasTo[k] = a.id;
  }
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
const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6.5" fill="currentColor"/><g fill="var(--on-accent)"><rect x="5" y="5" width="6.2" height="6.2" rx="1.8"/><rect x="12.8" y="5" width="6.2" height="6.2" rx="1.8" opacity=".38"/><rect x="5" y="12.8" width="6.2" height="6.2" rx="1.8" opacity=".38"/><rect x="12.8" y="12.8" width="6.2" height="6.2" rx="1.8" opacity=".38"/></g></svg>';
const INSTALL_ICON = svg('<rect x="3" y="3.5" width="14" height="10" rx="1.8"/><path d="M7 17h6M10 6.5v4.5M8 9l2 2 2-2"/>');
const LINK_ICON = svg('<path d="M8.5 11.5l3-3"/><path d="M10.6 5.9l1.2-1.2a3 3 0 0 1 4.2 4.2l-1.2 1.2M9.4 14.1l-1.2 1.2a3 3 0 0 1-4.2-4.2l1.2-1.2"/>');
const BLANK_ICON = svg('<rect x="4" y="4" width="12" height="12" rx="2.5"/>');
const POP_ICON = svg('<path d="M11.5 3.5h5v5M16.5 3.5L10 10"/><path d="M14 11.5v3.5a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 3.5 15V7.5A1.5 1.5 0 0 1 5 6h3.5"/>');
const BACK_ICON = svg('<path d="M8.5 16.5h-3a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16 5v3"/><path d="M17 11.5l-5 5M12 12.5v4h4"/>');

function renderRail() {
  $('#rail').innerHTML = `<a class="mark" href="#/" aria-label="${homeApp ? esc(homeApp.manifest.name) : 'Workshop'}" title="${homeApp ? esc(homeApp.manifest.name) : 'Workshop'}">${MARK}</a>`
    + railApps.map((a, i) => `<a class="app-btn" href="#/${a.id}" data-app="${a.id}" style="--app-c:var(--c-${esc(a.id)},var(--c-workshop))" title="${esc(a.manifest.name)}${i < 9 ? ` (Alt+${i + 1})` : ''}"><span class="ico" aria-hidden="true">${BLANK_ICON}</span><span class="lbl">${esc(a.manifest.name)}</span><span class="badge" hidden></span></a>`).join('')
    + `<span class="grow"></span>`
    + `<button class="app-btn" id="pairBtn" hidden aria-label="Connect to Workshop on this computer" title="Connect to Workshop on this computer">${LINK_ICON}<span class="lbl">Connect</span></button>`
    + `<button class="app-btn" id="installBtn" hidden aria-label="Install Workshop as a desktop app" title="Install as a desktop app">${INSTALL_ICON}<span class="lbl">Install</span></button>`;
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
    const slot = document.querySelector(`.app-btn[data-app="${app.id}"] .ico, #panelBtn[data-app="${app.id}"] .ico`);
    if (clean && slot) slot.innerHTML = clean;
  } catch (e) { /* keep the blank icon */ }
}

/* ---------- top bar: crumbs on the left, the light/dark toggle in the top right corner ---------- */
// On the owner's domain (shared/site.js, crumbs) the crumbs lead back up to the owner's site, like every other
// tool there. Anywhere else (the agent on 127.0.0.1, another company's domain) they start at Workshop.
const LIFEKIT = onCrumbsDomain(location.hostname) ? SITE.crumbs.links : [];
function renderTopbar() {
  const bar = $('#topbar');
  if (!bar) return;
  const crumbs = SOLO ? `<span class="here" aria-current="page"></span>`
    : `${LIFEKIT.map(c => `<a href="${c.href}">${esc(c.title)}</a><span aria-hidden="true">/</span>`).join('')}`
      + `<a href="#/" class="ws">Workshop</a><span class="here-sep" aria-hidden="true">/</span><span class="here" aria-current="page"></span>`;
  bar.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>`
    + `<div class="wstatus" id="wstatus" role="region" aria-label="Status" hidden></div>`
    + (panelApp && !SOLO ? `<button type="button" class="panelbtn" id="panelBtn" data-app="${panelApp.id}" aria-expanded="false" aria-controls="spanel" title="${esc(panelApp.manifest.description || panelApp.manifest.name)}"><span class="ico" aria-hidden="true">${BLANK_ICON}</span><span class="lbl">${esc(panelApp.manifest.name)}</span><span class="badge num" hidden></span></button>` : '')
    + `<button type="button" class="capbtn" id="capBtn" title="Capture or ask (Ctrl+.)" aria-keyshortcuts="Control+Period">${CAPTURE_ICON}<span>Capture</span></button>`
    + (SOLO ? `<button type="button" class="popbtn" id="popBtn" title="Put this app back in the Workshop window and close this one">${BACK_ICON}<span>Back to Workshop</span></button>`
      : `<button type="button" class="popbtn" id="popBtn" hidden>${POP_ICON}<span>Pop out</span></button>`)
    + WorkshopTheme.toggleHtml();
  $('#capBtn').addEventListener('click', () => capture().toggle());
  if ($('#panelBtn')) { $('#panelBtn').addEventListener('click', togglePanel); loadIcon(panelApp); }
  $('#popBtn').addEventListener('click', () => SOLO ? popIn() : popOut(current));
  focus.mount(bar, $('#capBtn'));
}
// The capture bar (shell/capture.js): one place to capture or ask, from every app.
let captureBar = null;
function capture() {
  if (!captureBar) captureBar = createCaptureBar(document.body, { go: (id, path) => go(id, path), onClose: () => { const app = byId[current]; if (app) focusFrame(app); } });
  return captureBar;
}
function markTopbar() {
  const here = $('#topbar .here');
  if (!here) return;
  const app = byId[current];
  const show = !!app && !(homeApp && current === homeApp.id);
  here.textContent = show ? app.manifest.name : '';
  here.hidden = !show;
  const sep = $('#topbar .here-sep');
  if (sep) sep.hidden = !show;
  const pop = $('#popBtn');
  if (pop && !SOLO) {
    pop.hidden = !show;
    const label = show ? `Pop out ${app.manifest.name} into its own window` : '';
    pop.title = label; pop.setAttribute('aria-label', label);
  }
}

// Opens an app in its own window (one per app: popping it out again brings that window forward). The app
// opens at its own start, so an app that remembers where it was (Folio's last note) carries on there. This
// window then goes Home, so the app is not open for editing in two places.
function popOut(id, path = '') {
  const app = byId[id];
  if (!app || (homeApp && id === homeApp.id)) return;
  const url = `${location.pathname}?solo=${encodeURIComponent(id)}#/${id}${path ? '/' + String(path).split('/').map(encodeURIComponent).join('/') : ''}`;
  const w = Math.min(1200, screen.availWidth - 80), h = Math.min(900, screen.availHeight - 80);
  if (app.frame && current === id) sendTo(app, 'visible', { visible: false }); // unsaved edits save first
  const win = window.open(url, 'workshop-solo-' + id, `popup,width=${w},height=${h}`);
  if (!win) { toast('Your browser blocked the window. Allow pop-ups for this site and try again.', null, null, 8000, 'warn'); return; }
  popped.add(id); markRail();
  // This window moves to another app that is not open in a window of its own: the first rail app, else the next.
  if (current === id) { const other = [homeId(), ...railApps.map(a => a.id)].find(x => x && x !== id && !popped.has(x)); if (other) go(other); }
}
// From a pop-out window: the main Workshop window (opened or brought forward), at an address.
function toMain(hash) {
  const url = location.pathname + (hash || '#/');
  const main = window.open(url, MAIN_WINDOW);
  if (!main) location.href = url;
}
// Back to Workshop: the app opens in the main window again and this window closes.
function popIn() {
  const app = byId[SOLO];
  if (app && app.frame) sendTo(app, 'visible', { visible: false });
  setTimeout(() => { toMain('#/' + SOLO); window.close(); }, 150);
}

/* ---------- the panel app (manifest panel: true, docs/app-manifest.md): Needs you, over the app you are in ----------
   Opened from its top bar button, #/<id> or ws.open. A click on the dimmed page, Esc or the button closes it. The
   app keeps loading in the background (its badge is on the button), so opening it is instant. */
function panelPane() {
  let el = document.getElementById('spanel');
  if (!el) {
    const scrim = document.createElement('div');
    scrim.className = 'spanel-scrim'; scrim.id = 'spanelScrim'; scrim.hidden = true;
    scrim.addEventListener('click', closePanel);
    el = document.createElement('aside');
    el.className = 'spanel'; el.id = 'spanel'; el.hidden = true;
    el.setAttribute('aria-label', panelApp ? panelApp.manifest.name : 'Panel');
    el.innerHTML = '<section class="spane"></section>';
    document.body.append(scrim, el);
  }
  return el.querySelector('.spane');
}
const panelOpen = () => { const el = document.getElementById('spanel'); return !!el && !el.hidden; };
function openPanel() {
  if (!panelApp || SOLO || panelOpen()) return;
  const pane = panelPane();
  document.getElementById('spanel').hidden = false;
  document.getElementById('spanelScrim').hidden = false;
  document.body.classList.add('panel-open');
  const b = $('#panelBtn'); if (b) { b.setAttribute('aria-expanded', 'true'); b.classList.add('on'); }
  if (!mounted.has(panelApp.id)) ensureMounted(panelApp, pane);
  sendTo(panelApp, 'visible', { visible: true });
  focusFrame(panelApp);
}
function closePanel() {
  if (!panelOpen()) return;
  document.getElementById('spanel').hidden = true;
  document.getElementById('spanelScrim').hidden = true;
  document.body.classList.remove('panel-open');
  const b = $('#panelBtn'); if (b) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('on'); }
  sendTo(panelApp, 'visible', { visible: false });
  const app = byId[current]; if (app) focusFrame(app);
}
function togglePanel() { panelOpen() ? closePanel() : openPanel(); }

function markRail() {
  markTopbar();
  document.querySelectorAll('.app-btn[data-app]').forEach(b => {
    const on = b.dataset.app === current;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    // An app open in its own window (Pop out): marked, and a click brings that window forward (route()).
    const out = popped.has(b.dataset.app);
    b.classList.toggle('popped', out);
    const name = byId[b.dataset.app] ? byId[b.dataset.app].manifest.name : b.dataset.app;
    if (out) b.title = `${name}: open in its own window (click to bring it forward)`;
    else if (b.title.endsWith('(click to bring it forward)')) b.title = name;
  });
  const mark = $('#rail .mark');
  if (mark) {
    const on = !!homeApp && current === homeApp.id;
    mark.classList.toggle('on', on);
    if (on) mark.setAttribute('aria-current', 'page'); else mark.removeAttribute('aria-current');
  }
}
// What each app asked for ({count, breakThrough}); during focus and lunch the shell shows less (shell/focus.js).
const badgeRaw = new Map();
function setBadge(appId, count, breakThrough) {
  badgeRaw.set(appId, { count: Number.isInteger(count) ? count : 0, breakThrough: Number.isInteger(breakThrough) ? breakThrough : 0 });
  paintBadge(appId);
}
function renderBadges() { for (const id of badgeRaw.keys()) paintBadge(id); }
function paintBadge(appId) {
  const el = document.querySelector(`.app-btn[data-app="${appId}"] .badge, #panelBtn[data-app="${appId}"] .badge`);
  if (!el) return;
  const count = focus.badgeFor(badgeRaw.get(appId));
  const n = Number.isInteger(count) ? Math.max(0, Math.min(999, count)) : 0;
  el.hidden = n === 0;
  el.textContent = n ? String(n) : '';
}

/* ---------- routing: #/<app>[/<path>]. The home page (or the first rail app) has the bare address, no #. ---------- */
// The home page if an app is marked home: true, else the first app on the rail.
const homeId = () => homeApp ? homeApp.id : railApps.length ? railApps[0].id : null;
// Addresses from before an app was renamed or folded into another: the Dashboard pane became the Agents app
// (WS6), and Agents (Dispatch) folded into Slate as Loom (Loom 4.0.0: #/agents/inbox opens #/slate/inbox); the
// People app became Settings' People & teams pages (#/people/team opens #/settings/people/team).
const RENAMED = { dashboard: 'slate', agents: 'slate', people: { id: 'settings', path: 'people' } };
/** Where an app id and path really open: a renamed app under its new id, a hosted app inside its host. */
function resolveApp(id, path = '') {
  const to = RENAMED[id];
  if (!byId[id] && to) {
    const toId = typeof to === 'string' ? to : to.id;
    if (byId[toId]) { if (typeof to !== 'string') path = [to.path, path].filter(Boolean).join('/'); id = toId; }
  }
  // Then an app's name or alias (#/docket, #/rapport); an id or a renamed address always wins.
  if (!byId[id] && aliasTo[String(id).toLowerCase()]) id = aliasTo[String(id).toLowerCase()];
  const h = hostedBy[id];
  if (h && byId[h.host]) return { id: h.host, path: [h.path, path].filter(Boolean).join('/') };
  return { id, path };
}
function parseHash() {
  const [first, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const r = resolveApp(first, rest.length ? rest.map(decodeURIComponent).join('/') : '');
  return { id: byId[r.id] ? r.id : null, path: r.path };
}
function paneOf(app) {
  if (app === panelApp) return panelPane();
  let pane = document.getElementById('pane-' + app.id);
  if (!pane) {
    pane = document.createElement('section');
    pane.className = 'pane'; pane.id = 'pane-' + app.id; pane.setAttribute('aria-label', app.manifest.name);
    pane.hidden = true;
    $('#panes').appendChild(pane);
  }
  return pane;
}
// Apps with background: true load hidden when Workshop opens, so their status shows before the first visit.
function mountBackground() {
  for (const app of apps) if (app.manifest.background && !mounted.has(app.id)) ensureMounted(app, paneOf(app));
}
function route() {
  let parsed = parseHash();
  // #/<panel app>: open the panel over the app you are in (or the first one, on a fresh load).
  if (panelApp && parsed.id === panelApp.id) {
    openPanel();
    if (current && byId[current]) { history.replaceState(null, '', addressOf(byId[current]) || location.pathname + location.search); return; }
    parsed = { id: null, path: '' };
  } else closePanel();
  if (SOLO && byId[SOLO] && parsed.id !== SOLO) {
    // A pop-out window shows only its app; anything else opens in the main window.
    if (parsed.id) toMain(location.hash);
    history.replaceState(null, '', location.pathname + location.search + '#/' + SOLO);
    if (current === SOLO) return;
    return route();
  }
  // An app open in its own window: bring that window forward (with the path, if any) and stay where we are.
  if (!SOLO && parsed.id && popped.has(parsed.id) && current !== parsed.id && focusPopped(parsed.id)) {
    if (parsed.path) soloSay({ type: 'route', id: parsed.id, path: parsed.path });
    const here = current && byId[current] ? addressOf(byId[current]) : '';
    history.replaceState(null, '', here || location.pathname + location.search);
    return;
  }
  const id = parsed.id || homeId();
  const app = byId[id];
  if (!app) return;
  const prev = current && current !== id ? byId[current] : null;
  if (prev) sendTo(prev, 'visible', { visible: false });
  current = id;
  const pane = paneOf(app);
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p !== pane; });
  if (!mounted.has(id)) ensureMounted(app, pane);
  sendTo(app, 'visible', { visible: true }); // before ready, the ready reply carries it
  deliverRoute(app, parsed.path);
  focusFrame(app);
  setTitle();
  markRail();
  // Tidy the address: home is the bare page, and a one-time path is dropped so a reload does not repeat it. An app
  // that reports where it is (ws.route.set, docs/sdk.md Routes) keeps its path; it answers a one-time path itself.
  const want = app.reportsRoute ? addressOf(app, parsed.path) : id === homeId() && !SOLO ? '' : '#/' + id;
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
}
const encPath = path => String(path).split('/').map(encodeURIComponent).join('/');
/** The address for an app at a path (its last reported one when none is given): '' for the home page with none. */
function addressOf(app, path) {
  const p = path || app.lastPath || '';
  if (!p && app.id === homeId() && !SOLO) return '';
  return '#/' + app.id + (p ? '/' + encPath(p) : '');
}
function go(id, path) {
  ({ id, path } = resolveApp(id, path || ''));
  if (panelApp && id === panelApp.id) { if (SOLO) toMain('#/' + id); else openPanel(); return; }
  closePanel();
  const h = '#/' + id + (path ? '/' + String(path).split('/').map(encodeURIComponent).join('/') : '');
  if (SOLO && id !== SOLO) { toMain(h); return; }
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
    const why = missing.state === 'browser' ? (canPair() ? 'Connectors need Workshop on this computer. Click Connect to pair.' : 'Connectors need Workshop on this computer.')
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
    try { focus.attachFrame(frame.contentWindow); } catch (e) { /* not same-origin */ }
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
      return { theme: themeNow(), route, visible: app === panelApp ? panelOpen() : current === app.id };
    }
    case 'open': {
      if (!byId[resolveApp(p.app).id]) throw fail('not_found', `There is no ${p.app} app here.`);
      go(p.app, p.path || '');
      return null;
    }
    // Where the app is now (docs/sdk.md, Routes): the address follows it. pushState and replaceState fire no
    // hashchange, so nothing is sent back; Back and Forward to these entries send a route event (route).
    case 'route.set': {
      app.reportsRoute = true;
      app.lastPath = typeof p.path === 'string' ? p.path.slice(0, 500) : '';
      // Only while the address is still this app's: a message sent just before you switched apps (the new hash is
      // set, its hashchange not handled yet) must not write this app back over it.
      const at = parseHash().id || homeId();
      if (app === panelApp || current !== app.id || at !== app.id) return null;
      const want = addressOf(app);
      if (location.hash !== want) history[p.replace ? 'replaceState' : 'pushState'](null, '', want || location.pathname + location.search);
      return null;
    }
    case 'toast': {
      if (focus.holds(p)) return null;   // held during focus or lunch; the app counts it (docs/focus.md)
      const a = p.action;
      toast(String(p.text || ''), a && a.label, a && a.command ? () => sendTo(app, 'command', { id: a.command }) : null, p.kind === 'error' || p.kind === 'warn' ? 8000 : 4000, p.kind);
      return null;
    }
    case 'badge': setBadge(app.id, p.count, p.breakThrough); return null;
    case 'notify': notify(app, p); return null;
    case 'commands.register': {
      (app.runtimeCommands ||= new Map()).set(p.id, { title: p.title, shortcut: p.shortcut });
      return null;
    }
    case 'commands.unregister': { if (app.runtimeCommands) app.runtimeCommands.delete(p.id); return null; }
    case 'status.set': setStatus(app, p); return null;
    case 'status.clear': clearStatus(app); return null;
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

/* ---------- status: one line an app keeps in the top bar (ws.status, docs/sdk.md Status) ----------
   Shown on every app, so what an app is doing (Docket's running task) and its buttons are always in reach.
   One status per app; the newest one set is shown. An action button sends the app a command event; one with a
   prompt asks for a line of text first and sends it along (Esc or Skip sends it without text, if allowed). */
const STATUS_ICONS = {
  pause: svg('<path d="M7 4.5v11M13 4.5v11"/>'),
  play: svg('<path d="M6.5 4.3v11.4l9-5.7z"/>'),
  done: svg('<path d="M4.5 10.5l3.5 3.5 7.5-8"/>'),
  note: svg('<path d="M4 15.5l1-3.8 8.3-8.3a1.9 1.9 0 0 1 2.7 2.7L7.7 14.4z"/><path d="M11.8 5l2.7 2.7"/>'),
  bolt: svg('<path d="M11 2.5L4.5 11.2H10L9 17.5l6.5-8.7H10z"/>')
};
const statuses = new Map();   // appId -> {app, st, at}
let statusPrompt = null;
function shownStatus() {
  let best = null;
  for (const s of statuses.values()) if (!best || s.at > best.at) best = s;
  return best;
}
function setStatus(app, p) {
  if (!p || typeof p.text !== 'string' || !p.text.trim()) throw fail('bad_request', 'A status needs text.');
  const st = {
    text: p.text.slice(0, 200), detail: typeof p.detail === 'string' ? p.detail.slice(0, 300) : '',
    since: p.since && !isNaN(Date.parse(p.since)) ? p.since : null, route: typeof p.route === 'string' ? p.route : '',
    actions: (Array.isArray(p.actions) ? p.actions : []).slice(0, 4).filter(a => a && a.label && /^[a-z][a-z0-9-]{0,39}$/.test(a.command))
  };
  const prev = statuses.get(app.id);
  // Updating the same status keeps its place; a new one (different text) comes to the front.
  statuses.set(app.id, { app, st, at: prev && prev.st.text === st.text ? prev.at : Date.now() });
  renderStatus();
}
function clearStatus(app) {
  if (!statuses.delete(app.id)) return;
  if (statusPrompt && statusPrompt.appId === app.id) closeStatusPrompt();
  renderStatus();
}
const runFor = since => {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
let statusHtml = null;
function renderStatus() {
  const el = $('#wstatus');
  if (!el) return;
  const s = shownStatus();
  document.body.classList.toggle('has-status', !!s);
  if (!s) { el.hidden = true; el.innerHTML = ''; statusHtml = null; setTitle(); return; }
  const { app, st } = s;
  el.hidden = false;
  el.dataset.app = app.id;
  const html = `<span class="ws-dot" aria-hidden="true"></span>`
    + `<button class="ws-text" data-status-open title="${esc(st.detail ? `${st.text}\n${st.detail}` : st.text)}"><span class="ws-app">${esc(app.manifest.name)}</span><span class="ws-main">${esc(st.text)}</span>${st.detail ? `<span class="ws-detail">${esc(st.detail)}</span>` : ''}</button>`
    + (st.since ? `<span class="ws-time" title="Since ${esc(new Date(st.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}">${runFor(st.since)}</span>` : '')
    + `<span class="ws-acts">${st.actions.map((a, i) => `<button class="ws-act${a.primary ? ' primary' : ''}${a.icon && !a.primary && a.icon !== 'pause' ? ' icon' : ''}" data-status-act="${i}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${a.icon && STATUS_ICONS[a.icon] ? STATUS_ICONS[a.icon] : ''}${a.primary || (a.icon && a.icon !== 'pause') ? '' : `<span>${esc(a.label)}</span>`}</button>`).join('')}</span>`;
  // Same markup: leave it, so a button under the pointer keeps its hover (no flicker every 30s).
  if (html !== statusHtml || !el.firstChild) { el.innerHTML = html; statusHtml = html; }
  setTitle();
}
// The tab title: the current app, with the status in front of it when there is one.
function setTitle() {
  const app = byId[current], s = shownStatus();
  const base = app ? `${app.manifest.name} · Workshop` : 'Workshop';
  document.title = s ? `● ${s.st.since ? runFor(s.st.since) + ' ' : ''}${s.st.text} · ${base}` : base;
}
setInterval(() => { if (statuses.size) renderStatus(); }, 30000);

function runStatusAction(i) {
  const s = shownStatus(), a = s && s.st.actions[i];
  if (!a) return;
  if (!a.prompt) { sendTo(s.app, 'command', { id: a.command }); return; }
  openStatusPrompt(s.app, a);
}
function openStatusPrompt(app, a) {
  closeStatusPrompt();
  const p = a.prompt, skip = p.skip !== false;
  const d = document.createElement('form');
  d.className = 'ws-prompt'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', p.title);
  d.innerHTML = `<label class="ws-ptitle" for="wsPromptIn">${esc(p.title)}</label>
    <input id="wsPromptIn" autocomplete="off" maxlength="${Math.min(1000, p.maxLength || 300)}" placeholder="${esc(p.placeholder || '')}">
    <div class="acts"><span class="hint">Enter saves${skip ? '. Esc skips' : ''}.</span>${skip ? '<button type="button" class="btn ghost" data-skip>Skip</button>' : '<button type="button" class="btn ghost" data-cancel>Cancel</button>'}<button class="btn primary">${esc(a.label)}</button></div>`;
  document.body.appendChild(d);
  statusPrompt = { el: d, appId: app.id };
  const input = d.querySelector('input');
  const send = text => { closeStatusPrompt(); sendTo(app, 'command', text ? { id: a.command, text } : { id: a.command }); };
  d.addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if (v || skip) send(v); });
  d.addEventListener('click', e => { if (e.target.closest('[data-skip]')) send(''); if (e.target.closest('[data-cancel]')) closeStatusPrompt(); });
  d.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); skip ? send('') : closeStatusPrompt(); } });
  input.focus();
}
function closeStatusPrompt() {
  if (!statusPrompt) return;
  statusPrompt.el.remove(); statusPrompt = null;
  const app = byId[current]; if (app) focusFrame(app);
}
document.addEventListener('click', e => {
  const act = e.target.closest('[data-status-act]');
  if (act) { runStatusAction(+act.dataset.statusAct); return; }
  if (e.target.closest('[data-status-open]')) { const s = shownStatus(); if (s) go(s.app.id, s.st.route); return; }
  if (statusPrompt && !e.target.closest('.ws-prompt')) closeStatusPrompt();
});

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
  out.unshift({ title: 'Capture or ask (Ctrl+.)', run: () => capture().open() });
  for (const a of apps) out.push({ title: `Open ${a.manifest.name}`, run: () => go(a.id) });
  const here = byId[current];
  if (SOLO) out.push({ title: 'Back to Workshop (close this window)', run: popIn });
  else if (here && !(homeApp && here === homeApp)) out.push({ title: `Pop out ${here.manifest.name} into its own window`, run: () => popOut(here.id) });
  out.push(...focus.commands());
  if (canPair()) out.push({ title: 'Connect to Workshop on this computer', run: startPairing });
  if (env.mode === 'hosted') out.push({ title: 'Disconnect from Workshop on this computer', run: forgetPairing });
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
    <input class="cmdk-input" type="text" placeholder="Search commands and apps" aria-label="Command" autocomplete="off" role="combobox" aria-controls="cmdkList" aria-expanded="true">
    <ul class="cmdk-list" id="cmdkList" role="listbox"></ul></div>`;
  document.body.appendChild(palette);
  const input = palette.querySelector('.cmdk-input'), list = palette.querySelector('.cmdk-list');
  let active = 0, shown = cmds;
  const draw = () => {
    list.innerHTML = shown.map((c, i) => `<li role="option" id="cmdk${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? 'on' : ''}"><span>${esc(c.title)}</span>${c.app ? `<span class="cmdk-app">${esc(c.app.manifest.name)}</span>` : ''}</li>`).join('') || '<li class="cmdk-empty">No matches.</li>';
    input.setAttribute('aria-activedescendant', shown.length ? 'cmdk' + active : '');
    const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const run = c => { closePalette(); if (c) runCommand(c); };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    // Titles that start with the query, or with a word that does, come first ("tri" finds Triage before anything
    // that only mentions Docket).
    const rankOf = c => { const t = c.title.toLowerCase(); return t.startsWith(q) ? 0 : t.split(/\s+/).some(w => w.startsWith(q)) ? 1 : 2; };
    shown = q ? cmds.filter(c => (c.title + ' ' + (c.app ? c.app.manifest.name : '')).toLowerCase().includes(q))
      .map((c, i) => [rankOf(c), i, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]) : cmds;
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
  if (e.key === 'Escape' && panelOpen()) { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'Period') { e.preventDefault(); e.stopPropagation(); closePalette(); capture().toggle(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') { e.preventDefault(); e.stopPropagation(); palette ? closePalette() : openPalette(); return; }
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && e.altKey && !e.ctrlKey && !e.metaKey && !SOLO) {
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
  onKey(e);
});

/* ---------- theme ---------- */
// The toggle in the top bar flips Light and Dark (shared/theme.js handles the click).
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

/* ---------- hosted pairing (docs/run-modes.md, Pairing; shared/pair.js) ----------
   On the site (not the agent's own page), the user can pair this browser with Workshop on their computer. */
const canPair = () => canPairWith(env);
async function startPairing() {
  const port = await askPort();
  if (!port) return;
  if (pairWith(port, { onError: m => toast(m, null, null, 8000, 'error') }) === 'blocked')
    toast('Your browser blocked the window. Allow pop-ups for this site and try again.', null, null, 8000, 'warn');
}
function askPort() {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.className = 'cmdk';
    d.innerHTML = `<div class="cmdk-backdrop"></div><form class="cmdk-box pair" role="dialog" aria-modal="true" aria-labelledby="pairTitle">
      <h2 id="pairTitle">Connect to Workshop on this computer</h2>
      <p>${esc(PAIR_HELP)}</p>
      <label>Port <input class="mono" type="number" min="1024" max="65535" value="4380" required></label>
      <div class="acts"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary">Connect</button></div></form>`;
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
  el.innerHTML = st.missing ? `<span>The folder <b>${name}</b> is missing (moved, renamed or deleted).</span><a class="btn" href="#/settings">Choose it in Settings</a>`
    : st.permission === 'denied' ? `<span>Workshop is not allowed to use the folder <b>${name}</b>, so nothing is saved.</span><button class="btn primary" data-allow>Try again</button><a class="btn ghost" href="#/settings">Settings</a>`
    : `<span>Chrome needs your OK before Workshop can save. Your changes are kept until then.</span><button class="btn primary" data-allow>Allow Workshop to use the folder ${name}</button>`;
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
window.addEventListener('appinstalled', () => { installPrompt = null; setInstall(); toast('Installed. Open Workshop from your dock, taskbar or Start menu.'); });
document.addEventListener('click', async e => {
  if (!e.target.closest('#installBtn') || !installPrompt) return;
  const p = installPrompt; installPrompt = null; setInstall();
  try { await p.prompt(); await p.userChoice; } catch (err) { /* each prompt works once; the browser offers a fresh one later */ }
});

/* ---------- focus hours and lunch (shell/focus.js, docs/focus.md) ---------- */
const focus = createFocusShell({ toast: (...a) => toast(...a), go: (id, path) => go(id, path), apps: () => apps, panes: $('#panes'), renderBadges: () => renderBadges() });

/* ---------- start ---------- */
env = await detectBackend();
document.documentElement.dataset.mode = env.mode;
await loadApps();
// A pop-out for an app that is not here (turned off, or a bad address): the main window instead.
if (SOLO && !byId[resolveApp(SOLO).id]) { location.replace(location.pathname + '#/'); await new Promise(() => {}); }
renderRail();
renderTopbar();
setInstall();
folderBar();
if (!apps.length) $('#panes').innerHTML = '<div class="notice"><h2>No apps found</h2><p>There is no app list for this site. If you publish Workshop as static files, run <code>node shell/registry.mjs</code> first.</p></div>';
window.addEventListener('hashchange', route);
route();
if (!SOLO) mountBackground();
WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000));

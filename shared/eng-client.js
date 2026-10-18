/* Client for the eng-agents live dashboard's shell API (see docs/shell-api.md in eng-agents).
   Shared by the shell's Dashboard page and by Prioritizer's work item stages.

   The live dashboard runs on this computer at 127.0.0.1 and answers only sites listed in its
   config.json ("dashboard": { "shellOrigins": [...] }). The browser cannot tell "not running"
   from "running but this site is not allowed": both look like a failed fetch.

   Settings (on, port) are per device and shared by every page on this site. Nothing is fetched
   until the Dashboard page connects once (that sets on). */
(function () {
  'use strict';
  const KEY = 'workshop.eng';
  const OLD_KEY = 'em.eng'; // earlier name, moved to KEY once below
  const APP = 'eng-agents-dashboard';
  const DEFAULT_PORT = 4300;
  const API = 1; // the shell API version this client speaks (eng-agents docs/shell-api.md)
  const listeners = [];

  const validPort = p => Number.isInteger(p) && p >= 1024 && p <= 65535;
  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { s = {}; }
    return {on: !!s.on, port: validPort(s.port) ? s.port : DEFAULT_PORT};
  }
  function save(patch) {
    const s = Object.assign(settings(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
    listeners.forEach(fn => fn(s));
    return s;
  }
  // fn(settings) runs when the settings change in this page or another one on this site.
  function onChange(fn) { listeners.push(fn); }
  window.addEventListener('storage', e => { if (e.key === KEY) listeners.forEach(fn => fn(settings())); });

  // One-time move from the EM Hub name. The old key goes only once the copy succeeds.
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (old !== null && localStorage.getItem(KEY) === null) localStorage.setItem(KEY, old);
    localStorage.removeItem(OLD_KEY);
  } catch (e) { /* private mode: nothing to move */ }

  // Before the hub, Prioritizer kept these in prioritizer.ui as {eng: {on, port}}. Copy them over once,
  // now, before Prioritizer next saves its UI state without them.
  try {
    const old = !localStorage.getItem(KEY) && (JSON.parse(localStorage.getItem('prioritizer.ui') || '{}') || {}).eng;
    if (old) localStorage.setItem(KEY, JSON.stringify({on: !!old.on, port: validPort(old.port) ? old.port : DEFAULT_PORT}));
  } catch (e) { /* nothing to carry over */ }

  const base = () => `http://127.0.0.1:${settings().port}`;

  async function request(path, body) {
    const r = await fetch(base() + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', targetAddressSpace: 'loopback',
      headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error((data && data.error) || `The dashboard answered HTTP ${r.status}`);
    return data;
  }
  // Not running, or running without this site in shellOrigins.
  const unreachable = e => e instanceof TypeError || /fetch/i.test(e.message);

  // GET /api/shell/status: {app, api, version, workspace, opencode, error, items, starting}
  async function status() {
    const d = await request('/api/shell/status');
    if (!d || d.app !== APP) throw new Error(`Something else is answering on port ${settings().port}.`);
    if (d.api > API) throw new Error(`The live dashboard speaks shell API ${d.api}; this hub knows ${API}. Update the hub.`);
    return d;
  }
  // POST /api/shell/start: runs /start <id> <lane> in opencode.
  const start = (id, lane) => request('/api/shell/start', {id: String(id), lane});

  window.EngClient = {KEY, APP, API, DEFAULT_PORT, validPort, settings, save, onChange, base, request, status, start, unreachable};
})();

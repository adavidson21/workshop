/* The workbench's Terminal (Chat 4.0.0, docs/chat.md, Terminal): real shells in the workspace, beside the chat, so
   you never leave Chat for a terminal. opencode runs each shell (its /pty API) and the opencode connector passes
   what it prints to this page as `term.out` events (connectors/opencode/lib/pty.mjs); keys go back with
   term.input. xterm.js (vendor/xterm, loaded the first time the Terminal opens) draws it.

   Up to four terminals, as tabs. They keep running while the page is closed and come back when it opens again (the
   connector keeps the last part of what each printed). A shell that exits stays readable until you close it.
   opencode's own terminal window (the TUI) is still a click away. */
import { esc } from './md.js';

const OC = 'opencode';
const ICON_X = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';

let lib = null;
function loadXterm() {
  if (!lib) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('../vendor/xterm/xterm.css', import.meta.url).href;
    document.head.appendChild(css);
    lib = Promise.all([import('../vendor/xterm/xterm.mjs'), import('../vendor/xterm/addon-fit.mjs')])
      .then(([a, b]) => ({ Terminal: a.Terminal, FitAddon: b.FitAddon }));
    lib.catch(() => { lib = null; });
  }
  return lib;
}
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function themeNow() {
  const c = (name, fallback) => { const v = cssVar(name); return /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i.test(v) ? v : fallback; };
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return { background: c('--surface', dark ? '#1e1e1e' : '#ffffff'), foreground: c('--ink', dark ? '#e6e6e6' : '#1f1f1f'), cursor: c('--accent', '#7a2840'), cursorAccent: c('--surface', '#ffffff'), selectionBackground: dark ? '#ffffff33' : '#00000022' };
}

export function startTerminal(ws, { onTui = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'term';
  el.innerHTML = '<div class="term-bar"><div class="term-tabs" role="tablist" aria-label="Terminals"></div><button type="button" class="chat-icon sm" data-term-new title="New terminal" aria-label="New terminal">' + ICON_PLUS + '</button><span class="grow"></span><button type="button" class="lnk quiet" data-term-tui title="Open this chat in opencode\'s own terminal window">opencode window</button></div><p class="term-note" hidden></p><div class="term-body"></div>';
  const tabs = el.querySelector('.term-tabs'), body = el.querySelector('.term-body'), noteEl = el.querySelector('.term-note');
  const list = new Map(); // id -> T: {id, title, status, exitCode, cursor, x, fit, box, syncing, queue, inbuf, inTimer, chain, rows, cols, sizeTimer}
  let cur = null, ready = null, visible = false, can = true, opening = false, X = null;

  function note(text, html = false) {
    noteEl.hidden = !text;
    if (html) noteEl.innerHTML = text; else noteEl.textContent = text || '';
  }
  function drawTabs() {
    tabs.innerHTML = [...list.values()].map(t => `<span class="term-tab${t.id === cur ? ' on' : ''}${t.status !== 'running' ? ' done' : ''}"><button type="button" role="tab" aria-selected="${t.id === cur}" data-term="${esc(t.id)}">${esc(t.title)}${t.status !== 'running' ? ' <span class="term-ended">ended</span>' : ''}</button>` +
      `<button type="button" class="term-x" data-term-close="${esc(t.id)}" title="Close ${esc(t.title)}${t.status === 'running' ? ' and end its shell' : ''}" aria-label="Close ${esc(t.title)}">${ICON_X}</button></span>`).join('');
    el.querySelector('[data-term-new]').disabled = !can || opening;
  }
  function choose(id) {
    cur = id;
    for (const t of list.values()) t.box.hidden = t.id !== id;
    drawTabs();
    const t = list.get(id);
    if (t && visible) { fitNow(t); t.x.focus(); }
  }

  /* ---------- output: events in order, a read when one was missed ---------- */
  function take(t, at, data) {
    if (t.syncing) { t.queue.push([at, data]); return; }
    if (at > t.cursor) { t.queue.push([at, data]); sync(t); return; }
    const end = at + data.length;
    if (end <= t.cursor) return;
    t.x.write(data.slice(t.cursor - at));
    t.cursor = end;
  }
  async function sync(t, first = false) {
    if (t.syncing) return;
    t.syncing = true;
    try {
      const r = await ws.connectors.call(OC, 'term.read', first ? { id: t.id } : { id: t.id, from: t.cursor });
      if (!first && r.from > t.cursor) t.x.write('\r\n\x1b[2m[some output was too long to keep]\x1b[0m\r\n');
      if (r.data) t.x.write(r.data);
      t.cursor = r.cursor;
      if (r.status !== 'running' && t.status === 'running') ended(t, r.exitCode);
    } catch (e) {
      if (e && e.code === 'not_found') { drop(t.id); return; }
    } finally { t.syncing = false; }
    const q = t.queue; t.queue = [];
    for (const [at, data] of q) take(t, at, data);
  }
  function ended(t, code) {
    if (t.status !== 'running') return;
    t.status = 'exited';
    t.x.write(`\r\n\x1b[2m[The shell ended${Number.isInteger(code) ? ` with code ${code}` : ''}. Close this tab, or open a new terminal.]\x1b[0m\r\n`);
    drawTabs();
  }

  /* ---------- input and size ---------- */
  function input(t, d) {
    if (t.status !== 'running') return;
    t.inbuf += d;
    if (!t.inTimer) t.inTimer = setTimeout(() => {
      const data = t.inbuf; t.inbuf = ''; t.inTimer = 0;
      t.chain = t.chain.then(() => ws.connectors.call(OC, 'term.input', { id: t.id, data })).catch(e => note(e.message || "Couldn't send that to the terminal."));
    }, 6);
  }
  function fitNow(t) {
    if (!t || t.box.hidden || !t.box.clientWidth) return;
    try { t.fit.fit(); } catch (e) { return; }
    if (t.x.rows === t.rows && t.x.cols === t.cols) return;
    t.rows = t.x.rows; t.cols = t.x.cols;
    clearTimeout(t.sizeTimer);
    t.sizeTimer = setTimeout(() => { if (t.status === 'running') ws.connectors.call(OC, 'term.resize', { id: t.id, rows: t.rows, cols: t.cols }).catch(() => {}); }, 120);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (visible) fitNow(list.get(cur)); }).observe(body);

  function add(info) {
    if (list.has(info.id)) return list.get(info.id);
    const box = document.createElement('div');
    box.className = 'term-box';
    box.hidden = true;
    body.appendChild(box);
    const x = new X.Terminal({ fontFamily: cssVar('--mono') || 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, theme: themeNow(), allowProposedApi: false, convertEol: false });
    const fit = new X.FitAddon();
    x.loadAddon(fit);
    x.open(box);
    const t = { id: info.id, title: info.title, status: 'running', exitCode: null, cursor: 0, x, fit, box, syncing: false, queue: [], inbuf: '', inTimer: 0, chain: Promise.resolve(), rows: 0, cols: 0, sizeTimer: 0 };
    x.onData(d => input(t, d));
    x.onBinary(d => input(t, d));
    list.set(t.id, t);
    sync(t, true).then(() => { if (info.status && info.status !== 'running') ended(t, info.exitCode); });
    return t;
  }
  function drop(id) {
    const t = list.get(id);
    if (!t) return;
    list.delete(id);
    try { t.x.dispose(); } catch (e) { /* gone */ }
    t.box.remove();
    if (cur === id) { const next = [...list.keys()].pop() || null; if (next) choose(next); else { cur = null; drawTabs(); } }
    else drawTabs();
    if (!list.size && visible && can) note('No terminal open. Press + for a new one.');
  }

  async function open() {
    if (opening || !can) return;
    opening = true; drawTabs(); note('');
    try {
      const t = cur && list.get(cur);
      const size = t && t.rows ? { rows: t.rows, cols: t.cols } : {};
      const info = await ws.connectors.call(OC, 'term.open', size, { confirm: true });
      add(info);
      choose(info.id);
    } catch (e) { note(e.message || "Couldn't open a terminal."); }
    opening = false; drawTabs();
  }
  async function close(id) {
    try { await ws.connectors.call(OC, 'term.close', { id }); } catch (e) { if (!(e && e.code === 'not_found')) { note(e.message || "Couldn't close it."); return; } }
    drop(id);
  }

  /** Loads xterm.js, listens for output and attaches the terminals, once. Resolves when that is done. */
  function start() { if (!ready) ready = boot(); return ready; }
  async function boot() {
    note('Starting the terminal...');
    try { X = await loadXterm(); }
    catch (e) { ready = null; note("Couldn't load the terminal. Reload the page and try again."); return; }
    ws.connectors.on(OC, 'term.out', p => { const d = p && p.payload; const t = d && list.get(d.id); if (t) take(t, d.at, d.data); });
    ws.connectors.on(OC, 'term.exit', p => { const d = p && p.payload; const t = d && list.get(d.id); if (t) { sync(t).then(() => ended(t, d.exitCode)); } });
    ws.connectors.on(OC, 'term.gone', p => { const d = p && p.payload; if (d) drop(d.id); });
    new MutationObserver(() => { for (const t of list.values()) t.x.options.theme = themeNow(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    await refresh(true);
  }
  /** The terminals the connector has (after a reload, or when it changed). `fresh`: open one if there is none. */
  async function refresh(fresh = false) {
    let r;
    try { r = await ws.connectors.call(OC, 'term.list', {}); }
    catch (e) { note(e.message || "Couldn't reach opencode's terminals."); return; }
    can = !!r.can;
    if (!can) {
      note('This opencode cannot run a terminal inside Chat (it needs opencode 1.x with terminals; update it with <code>npm i -g opencode-ai</code>). <button type="button" class="lnk" data-term-tui>Open opencode in a window</button> instead.', true);
      drawTabs();
      return;
    }
    note('');
    for (const info of r.terms) add(info);
    for (const id of [...list.keys()]) if (!r.terms.some(t => t.id === id)) drop(id);
    if (!cur || !list.has(cur)) cur = [...list.keys()].pop() || null;
    if (cur) choose(cur); else drawTabs();
    if (fresh && !list.size) await open();
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.term != null) choose(d.term);
    else if (d.termClose != null) close(d.termClose);
    else if (d.termNew != null) open();
    else if (d.termTui != null) onTui();
  });
  // Ctrl+Shift+C and Ctrl+Shift+V copy and paste, as in most terminals (Ctrl+C stays an interrupt).
  el.addEventListener('keydown', e => {
    const t = list.get(cur);
    if (!t || !e.ctrlKey || !e.shiftKey || !t.box.contains(e.target)) return;
    if (e.key === 'C' || e.key === 'c') { const s = t.x.getSelection(); if (s && navigator.clipboard) { navigator.clipboard.writeText(s).catch(() => {}); e.preventDefault(); } }
    else if ((e.key === 'V' || e.key === 'v') && navigator.clipboard && navigator.clipboard.readText) { e.preventDefault(); navigator.clipboard.readText().then(s => { if (s) t.x.paste(s); }, () => {}); }
  }, true);

  return {
    el,
    show(on) {
      visible = !!on;
      if (!visible) return;
      if (!ready) { start(); return; }
      ready.then(() => refresh(false));
      const t = list.get(cur);
      if (t) setTimeout(() => { fitNow(t); t.x.focus(); }, 0);
    },
    focus() { const t = list.get(cur); if (t) t.x.focus(); },
    open,
    /** Run a line in the current terminal (opening one if none is open): the chat's "Run in terminal". */
    async run(line) {
      await start();
      if (!X) return;
      if (!cur) await open();
      const t = list.get(cur);
      if (t) { input(t, String(line).replace(/\r?\n$/, '') + '\r'); t.x.focus(); }
    }
  };
}

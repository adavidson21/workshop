/* The workbench's Files (Chat 4.0.0, docs/chat.md, Files): browse the workspace and edit files beside the chat, so
   you can read or fix what an agent wrote without leaving Chat. The tree, the search and every read and save go
   through the opencode connector's files.* actions (connectors/opencode/lib/workfiles.mjs), which keep to the
   workspace. The editor is Monaco, shared with Builds' code review (shared/monaco.js), loaded the first time a file
   opens.

   Saving (Ctrl+S, or Save) only writes over the version you opened. If an agent or another editor changed the file
   since, nothing is written and a bar asks: keep yours, or take theirs. An open file you have not changed follows
   the file on disk: Files checks open files every few seconds while it shows, and when an agent finishes a turn. */
import { applyMonacoTheme, languageOf, loadMonaco } from '../../../shared/monaco.js';
import { esc } from './md.js';

const OC = 'opencode';
const MAX_OPEN = 12;
const CHECK_MS = 4000;
const ICON = {
  tree: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 5h6M4 5v14M4 12h5M4 19h5M13 5h7M13 12h7M13 19h7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  dir: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10A.5.5 0 017 20z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
};
const TREE_KEY = 'chat.filesTree';

export function startFiles(ws, { flash = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'files';
  el.innerHTML = `<div class="files-bar"><button type="button" class="chat-icon sm" data-files-tree title="Show or hide the file tree" aria-label="File tree">${ICON.tree}</button>` +
    '<input type="search" class="files-find" data-files-find placeholder="Go to file" aria-label="Go to file" autocomplete="off" spellcheck="false">' +
    `<button type="button" class="chat-icon sm" data-files-new title="New file" aria-label="New file">${ICON.plus}</button></div>` +
    '<div class="files-main"><nav class="files-tree" aria-label="Workspace files"></nav><div class="files-ed"><div class="files-tabs" role="tablist" aria-label="Open files"></div>' +
    '<div class="files-note" role="status" hidden></div><div class="files-mon"></div><p class="files-empty">Pick a file in the tree, or press Open on a file in the chat.</p></div></div>';
  const tree = el.querySelector('.files-tree'), tabsEl = el.querySelector('.files-tabs'), noteEl = el.querySelector('.files-note');
  const monBox = el.querySelector('.files-mon'), emptyEl = el.querySelector('.files-empty'), findEl = el.querySelector('[data-files-find]');
  const dirs = new Map(); // dir path ('' is the workspace) -> {items, more, open, loading, err}
  const docs = new Map(); // path -> {path, model, mtime, saved, kind: 'text' | 'binary' | 'big', note, closing}
  let active = null, monaco = null, editor = null, visible = false, started = false, treeErr = '';
  let found = null, findTimer = 0, checkTimer = 0, making = false;
  let showTree = (() => { try { return localStorage.getItem(TREE_KEY) !== 'hidden'; } catch (e) { return true; } })();

  /* ---------- the tree ---------- */
  async function loadDir(dir) {
    const d = dirs.get(dir) || { items: [], more: 0, open: true, loading: false, err: '' };
    dirs.set(dir, d);
    d.loading = true; d.err = ''; drawTree();
    try { const r = await ws.connectors.call(OC, 'files.tree', { dir }); d.items = r.items || []; d.more = r.more || 0; treeErr = ''; }
    catch (e) { d.err = e.message || "Couldn't list that folder."; if (!dir) treeErr = d.err; }
    d.loading = false; drawTree();
  }
  function rowsOf(dir, depth) {
    const d = dirs.get(dir);
    if (!d) return '';
    if (d.loading && !d.items.length) return `<li class="ft-meta" style="--d:${depth}">Loading...</li>`;
    if (d.err) return `<li class="ft-meta err" style="--d:${depth}">${esc(d.err)}</li>`;
    let out = '';
    for (const it of d.items) {
      if (it.dir) {
        const sub = dirs.get(it.path), open = !!(sub && sub.open);
        out += `<li><button type="button" class="ft-row dir${open ? ' open' : ''}" style="--d:${depth}" data-ft-dir="${esc(it.path)}" aria-expanded="${open}"><span class="chev" aria-hidden="true"></span>${ICON.dir}<span>${esc(it.name)}</span></button></li>`;
        if (open) out += rowsOf(it.path, depth + 1);
      } else {
        out += `<li><button type="button" class="ft-row${docs.has(it.path) ? ' isopen' : ''}${it.path === active ? ' on' : ''}" style="--d:${depth}" data-ft-file="${esc(it.path)}" title="${esc(it.path)}">${ICON.file}<span>${esc(it.name)}</span></button></li>`;
      }
    }
    if (d.more) out += `<li class="ft-meta" style="--d:${depth}">${d.more} more. Use Go to file.</li>`;
    if (!d.items.length && !d.more) out += `<li class="ft-meta" style="--d:${depth}">Empty</li>`;
    return out;
  }
  function drawTree() {
    el.classList.toggle('no-tree', !showTree);
    if (found) {
      tree.innerHTML = found.err ? `<p class="ft-meta err">${esc(found.err)}</p>` : !found.items.length ? `<p class="ft-meta">${found.busy ? 'Looking...' : 'No file matches.'}</p>`
        : `<ul class="ft-list">${found.items.map((p, i) => `<li><button type="button" class="ft-row hit${i === found.i ? ' on' : ''}" data-ft-file="${esc(p)}" title="${esc(p)}">${ICON.file}<span>${esc(p)}</span></button></li>`).join('')}</ul>`;
      return;
    }
    tree.innerHTML = `<ul class="ft-list">${rowsOf('', 0)}</ul>`;
  }
  async function find(q) {
    const want = q.trim();
    if (!want) { found = null; drawTree(); return; }
    found = { q: want, items: (found && found.items) || [], i: 0, busy: true, err: '' };
    drawTree();
    try {
      const r = await ws.connectors.call(OC, 'chat.files', { query: want });
      if (!found || found.q !== want) return;
      found = { q: want, items: (r && r.files) || [], i: 0, busy: false, err: '' };
    } catch (e) { if (found && found.q === want) found = { q: want, items: [], i: 0, busy: false, err: e.message || 'Search needs opencode connected.' }; }
    drawTree();
  }

  /* ---------- open files ---------- */
  const dirty = doc => !!(doc && doc.model && doc.model.getAlternativeVersionId() !== doc.saved);
  function drawTabs() {
    tabsEl.innerHTML = [...docs.values()].map(d => `<span class="ftab${d.path === active ? ' on' : ''}${dirty(d) ? ' dirty' : ''}"><button type="button" role="tab" aria-selected="${d.path === active}" data-ftab="${esc(d.path)}" title="${esc(d.path)}">${esc(d.path.split('/').pop())}${dirty(d) ? '<span class="ftab-dot" aria-label="not saved"></span>' : ''}</button>` +
      `<button type="button" class="term-x" data-ftab-close="${esc(d.path)}" title="Close ${esc(d.path)}" aria-label="Close ${esc(d.path)}">${ICON.x}</button></span>`).join('');
    emptyEl.hidden = !!active;
    monBox.hidden = !active || !(docs.get(active) || {}).model;
    drawNote();
  }
  function drawNote() {
    const d = docs.get(active);
    const n = d && d.note;
    let html = '';
    if (d && d.closing) html = `<span>${esc(d.path)} has changes you have not saved.</span><button type="button" class="btn sm primary" data-fn="save-close">Save</button><button type="button" class="btn sm" data-fn="discard">Don't save</button><button type="button" class="btn sm ghost" data-fn="keep-open">Cancel</button>`;
    else if (n === 'changed') html = '<span>This file changed on disk since you opened it (an agent may have edited it).</span><button type="button" class="btn sm" data-fn="theirs">Use the file on disk</button><button type="button" class="btn sm ghost" data-fn="mine">Keep mine and save</button>';
    else if (n === 'gone') html = `<span>This file was deleted on disk.</span><button type="button" class="btn sm" data-fn="mine">Save it again</button><button type="button" class="btn sm ghost" data-fn="close">Close it</button>`;
    else if (d && d.kind === 'binary') html = '<span>This is not a text file, so Files cannot show it.</span>';
    else if (d && d.kind === 'big') html = '<span>This file is over 900 KB. Open it in your own editor.</span>';
    else if (d && d.error) html = `<span>${esc(d.error)}</span>`;
    noteEl.hidden = !html;
    noteEl.innerHTML = html;
  }
  async function ensureEditor() {
    if (editor) return true;
    try { monaco = await loadMonaco(); }
    catch (e) { const d = docs.get(active); if (d) { d.error = e.message || "Couldn't load the editor."; drawNote(); } return false; }
    applyMonacoTheme(monaco);
    new MutationObserver(() => applyMonacoTheme(monaco)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
    editor = monaco.editor.create(monBox, { automaticLayout: true, minimap: { enabled: false }, fontFamily: mono || 'monospace', fontSize: 13, lineHeight: 20, scrollBeyondLastLine: false, renderWhitespace: 'selection', contextmenu: true, wordWrap: 'off', tabSize: 2 });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save(docs.get(active)));
    return true;
  }
  function activate(path, line) {
    const prev = docs.get(active);
    if (prev && prev.model && editor) prev.view = editor.saveViewState();
    active = path;
    const d = docs.get(path);
    if (d && d.model && editor) {
      editor.setModel(d.model);
      if (d.view) editor.restoreViewState(d.view);
      if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
      if (visible) editor.focus();
    }
    drawTabs(); drawTree();
  }
  /** Opens a workspace file (from the tree, Go to file, or an Open in the chat). `line` scrolls to it. */
  async function open(path, { line } = {}) {
    if (!started) start();
    if (docs.has(path)) { activate(path, line); return; }
    let r;
    try { r = await ws.connectors.call(OC, 'files.read', { path }); }
    catch (e) { flash(e.message || `Couldn't open ${path}.`); return; }
    if (docs.size >= MAX_OPEN) { const old = [...docs.values()].find(d => d.path !== active && !dirty(d)); if (old) closeNow(old.path); }
    const doc = { path: r.path || path, model: null, mtime: r.mtime, saved: 0, kind: r.binary ? 'binary' : r.tooBig ? 'big' : 'text', note: null, closing: false, error: '' };
    docs.set(doc.path, doc);
    if (doc.kind === 'text') {
      active = doc.path;
      if (!(await ensureEditor())) { drawTabs(); return; }
      const uri = monaco.Uri.from({ scheme: 'workspace', path: '/' + doc.path });
      const old = monaco.editor.getModel(uri);
      if (old) old.dispose();
      doc.model = monaco.editor.createModel(r.content, languageOf(doc.path), uri);
      doc.saved = doc.model.getAlternativeVersionId();
      doc.model.onDidChangeContent(() => { if (!!doc.dirtyShown !== dirty(doc)) { doc.dirtyShown = dirty(doc); drawTabs(); } });
    }
    activate(doc.path, line);
    watch();
  }
  async function save(doc, { force = false } = {}) {
    if (!doc || !doc.model) return false;
    const version = doc.model.getAlternativeVersionId();
    let r;
    try { r = await ws.connectors.call(OC, 'files.write', { path: doc.path, content: doc.model.getValue(), ...(doc.note === 'gone' ? { create: true } : { mtime: doc.mtime }), ...(force ? { force: true } : {}) }, { confirm: true }); }
    catch (e) { doc.error = e.message || "Couldn't save it."; drawNote(); return false; }
    if (!r.ok) { doc.note = r.conflict === 'exists' ? 'changed' : r.conflict; drawTabs(); return false; }
    doc.mtime = r.mtime; doc.saved = version; doc.note = null; doc.error = ''; doc.dirtyShown = dirty(doc);
    drawTabs();
    flash(`Saved ${doc.path.split('/').pop()}.`);
    return true;
  }
  /** Takes the file as it is on disk now (losing unsaved changes, which the caller asked about). */
  async function reload(doc) {
    let r;
    try { r = await ws.connectors.call(OC, 'files.read', { path: doc.path }); }
    catch (e) { if (e && e.code === 'not_found') { doc.note = 'gone'; drawTabs(); } return; }
    if (!doc.model || r.content == null) { doc.mtime = r.mtime; return; }
    const view = editor && active === doc.path ? editor.saveViewState() : null;
    doc.model.setValue(r.content);
    if (view) editor.restoreViewState(view);
    doc.mtime = r.mtime; doc.saved = doc.model.getAlternativeVersionId(); doc.note = null; doc.dirtyShown = false;
    drawTabs();
  }
  /** Checks open files against the disk: follows a file you have not changed, asks about one you have. */
  async function check() {
    const list = [...docs.values()].filter(d => d.kind === 'text');
    if (!list.length) return;
    let r;
    try { r = await ws.connectors.call(OC, 'files.stat', { paths: list.map(d => d.path) }); } catch (e) { return; }
    for (const d of list) {
      if (!docs.has(d.path)) continue;
      const m = r.mtimes[d.path];
      if (m == null) { if (d.note !== 'gone') { d.note = 'gone'; drawTabs(); } continue; }
      if (Math.abs(m - d.mtime) <= 1) continue;
      if (!dirty(d)) await reload(d);
      else if (d.note !== 'changed') { d.note = 'changed'; drawTabs(); }
    }
  }
  function watch() {
    clearInterval(checkTimer);
    if (visible && docs.size) checkTimer = setInterval(check, CHECK_MS);
  }
  function closeNow(path) {
    const d = docs.get(path);
    if (!d) return;
    docs.delete(path);
    if (d.model) d.model.dispose();
    if (active === path) {
      active = null;
      const next = [...docs.keys()].pop();
      if (next) activate(next); else { if (editor) editor.setModel(null); drawTabs(); drawTree(); }
    } else { drawTabs(); drawTree(); }
    watch();
  }
  function close(path) {
    const d = docs.get(path);
    if (!d) return;
    if (dirty(d)) { if (active !== path) activate(path); d.closing = true; drawNote(); return; }
    closeNow(path);
  }
  async function makeFile(path) {
    const p = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p) return;
    try {
      const r = await ws.connectors.call(OC, 'files.write', { path: p, content: '', create: true }, { confirm: true });
      if (!r.ok) { flash(`${p} is there already. Opening it.`); }
      else { const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; if (dirs.has(parent)) loadDir(parent); }
      open(p);
    } catch (e) { flash(e.message || "Couldn't make that file."); }
  }

  function start() {
    if (started) return;
    started = true;
    loadDir('');
  }

  /* ---------- input ---------- */
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.ftDir != null) {
      const sub = dirs.get(d.ftDir);
      if (!sub) loadDir(d.ftDir);
      else { sub.open = !sub.open; if (sub.open && !sub.items.length) loadDir(d.ftDir); else drawTree(); }
    } else if (d.ftFile != null) { open(d.ftFile); if (found) { found = null; findEl.value = ''; drawTree(); } }
    else if (d.ftab != null) activate(d.ftab);
    else if (d.ftabClose != null) close(d.ftabClose);
    else if (d.filesTree != null) { showTree = !showTree; try { localStorage.setItem(TREE_KEY, showTree ? 'shown' : 'hidden'); } catch (x) { /* blocked */ } drawTree(); }
    else if (d.filesNew != null) {
      if (making) return;
      making = true;
      findEl.value = ''; found = null; drawTree();
      findEl.placeholder = 'New file path, then Enter (Esc cancels)';
      findEl.classList.add('making');
      findEl.focus();
    } else if (d.fn != null) {
      const doc = docs.get(active);
      if (!doc) return;
      if (d.fn === 'theirs') reload(doc);
      else if (d.fn === 'mine') save(doc, { force: true });
      else if (d.fn === 'close') closeNow(doc.path);
      else if (d.fn === 'keep-open') { doc.closing = false; drawNote(); }
      else if (d.fn === 'discard') closeNow(doc.path);
      else if (d.fn === 'save-close') save(doc).then(ok => { if (ok) closeNow(doc.path); else { doc.closing = false; drawNote(); } });
    }
  });
  function endMaking() { making = false; findEl.placeholder = 'Go to file'; findEl.classList.remove('making'); findEl.value = ''; }
  findEl.addEventListener('input', () => {
    if (making) return;
    clearTimeout(findTimer);
    const q = findEl.value;
    findTimer = setTimeout(() => find(q), 150);
  });
  findEl.addEventListener('keydown', e => {
    if (making) {
      if (e.key === 'Enter') { e.preventDefault(); const p = findEl.value; endMaking(); makeFile(p); }
      else if (e.key === 'Escape') { e.preventDefault(); endMaking(); }
      return;
    }
    if (!found) { if (e.key === 'Escape') findEl.blur(); return; }
    const n = found.items.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); found.i = (found.i + 1) % n; drawTree(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); found.i = (found.i - 1 + n) % n; drawTree(); }
    else if (e.key === 'Enter' && n) { e.preventDefault(); const p = found.items[found.i]; found = null; findEl.value = ''; drawTree(); open(p); }
    else if (e.key === 'Escape') { e.preventDefault(); found = null; findEl.value = ''; drawTree(); }
  });
  findEl.addEventListener('blur', () => { if (making) setTimeout(() => { if (making && document.activeElement !== findEl) endMaking(); }, 150); });

  drawTabs(); drawTree();
  return {
    el,
    open,
    show(on) {
      visible = !!on;
      if (visible) { start(); check(); if (editor) setTimeout(() => editor.layout(), 0); }
      watch();
    },
    focus() { if (editor && active) editor.focus(); else findEl.focus(); },
    /** An agent finished a turn: it may have changed open files. */
    changed() { if (docs.size) check(); if (started) for (const [dir, d] of dirs) if (d.open || !dir) loadDir(dir); },
    /** Files with changes not saved yet (the page warns before it closes). */
    unsaved() { return [...docs.values()].filter(dirty).map(d => d.path); }
  };
}

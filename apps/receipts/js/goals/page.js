/* Rapport's Goals: the Goals tab. The team's and each report's OKRs, one plain Markdown file per owner per
   quarter, shown as a tree (team objectives, each report objective nested under the one it supports) and as a doc
   to edit and preview.

   main.js owns the page, the hash and the paint loop. It calls route() on every route change and asks for HTML
   with view(). Clicks on this module's controls are handled here by their data-g-* attributes. model.js and
   view.js are pure. Files go through ws.files with the mtime write loop, as 1:1 notes do. */
import { GOALS, TEAM, buildTree, carryOver, goalsPath, isQuarter, norm, ownerFolder, parseDoc, parseFiles, quarterKey, quarterLabel, quartersFrom, renameSupports, renamedObjectives, reportTemplate, setKr, setSupports, shiftQuarter, teamTemplate, validProgress } from './model.js';
import { docHtml, previewHtml, setupHtml, treeHtml } from './view.js';

/**
 * ws: the SDK. root: the element main.js paints into. host: what this module needs from main.js:
 *   repaint()     paint the page again
 *   go(path)      open a Rapport path ('goals', 'goals/2026-q4/team', ...)
 *   reports()     your reports, archived included: [{id, name, archived}] in Reports' order
 */
export function createGoalsPage(ws, root, host) {
  const ui = {
    on: false,               // the Goals tab is shown
    loaded: false,
    waiting: false,          // the browser's folder needs Allow
    files: [],               // [{owner, quarter, path, mtime}]
    quarter: quarterKey(),
    owner: '',               // '' the tree, 'team' or a person folder
    exp: new Map(),          // node id -> expanded (per window)
    selected: '',
    popover: null,           // {path, line}
    menu: null,              // objective line with the Supports menu open
    doc: null,               // {path, text, mtime, dirty, saving, error, conflict, exists, base}
    mode: 'preview',
    formatOpen: false,
    focusLine: null,         // scroll this objective into view after the next paint
    loadingTree: false,
  };
  const cache = new Map();   // path -> {mtime, text, doc}
  const paint = () => host.repaint();
  const toastErr = e => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });
  const waitFor = e => { if (e && e.code === 'unavailable' && ws.backend === 'browser') { ui.waiting = true; return true; } return false; };

  /* ---------- people and files ---------- */

  const reports = () => host.reports() || [];
  const personByFolder = folder => reports().find(p => ownerFolder(p.id) === folder) || null;
  const fileFor = (owner, quarter) => ui.files.find(f => f.owner === owner && f.quarter === quarter) || null;
  function ownerName(owner, doc) {
    if (owner === TEAM) return (doc && doc.title && !/^team goals\b/i.test(doc.title) ? doc.title.replace(/,?\s*Q[1-4]\s+\d{4}\s*$/i, '') : '') || 'Team';
    const p = personByFolder(owner);
    return p ? p.name || 'Unnamed' : `Unknown person (${owner})`;
  }

  async function listFiles() {
    try { ui.files = parseFiles(await ws.files.list(GOALS)); ui.waiting = false; }
    catch (e) { if (!waitFor(e)) ui.files = []; }
  }
  /** A file's text and parsed doc, read again only when its mtime changed. null when there is no file. */
  async function readFile(path) {
    const f = ui.files.find(x => x.path === path);
    if (!f) { cache.delete(path); return null; }
    const hit = cache.get(path);
    if (hit && hit.mtime === f.mtime) return hit;
    const r = await ws.files.read(path);
    if (!r || typeof r.content !== 'string') { cache.delete(path); return null; }
    const row = { mtime: r.mtime, text: r.content, doc: parseDoc(r.content) };
    cache.set(path, row);
    return row;
  }
  // After a write: the file list and cache know the new version without reading it back.
  function wrote(path, text, mtime) {
    const m = /^goals\/([^/]+)\/([^/]+)\.md$/.exec(path);
    const at = ui.files.findIndex(f => f.path === path);
    const row = { owner: m[1], quarter: m[2], path, mtime };
    if (at >= 0) ui.files[at] = row; else ui.files.push(row);
    cache.set(path, { mtime, text, doc: parseDoc(text) });
  }

  /* ---------- the tree ---------- */

  async function loadQuarter(q) {
    const paths = [goalsPath(TEAM, q), ...ui.files.filter(f => f.quarter === q && f.owner !== TEAM).map(f => f.path)];
    await Promise.all(paths.map(p => readFile(p).catch(e => { if (!waitFor(e)) throw e; })));
  }

  function currentTree() {
    const q = ui.quarter;
    const team = cache.get(goalsPath(TEAM, q));
    const ps = reports();
    const known = new Set();
    const rows = ps.map(p => {
      const folder = ownerFolder(p.id);
      known.add(folder);
      const path = goalsPath(folder, q);
      const hit = fileFor(folder, q) ? cache.get(path) : null;
      return { person: { ...p, folder }, path, doc: hit ? hit.doc : null };
    }).filter(r => r.doc || !r.person.archived);
    const unknown = ui.files.filter(f => f.quarter === q && f.owner !== TEAM && !known.has(f.owner))
      .map(f => ({ folder: f.owner, path: f.path, doc: (cache.get(f.path) || {}).doc || null }));
    return buildTree({ team: team && fileFor(TEAM, q) ? { path: goalsPath(TEAM, q), doc: team.doc } : null, reports: rows, unknown });
  }

  // Level 1 open by default, report objectives closed. Expand state lives only in this window.
  const isOpen = id => (ui.exp.has(id) ? ui.exp.get(id) : /^o:\d+$/.test(id) || id === 'ua');
  const expanded = { has: isOpen };

  function treeView() {
    const tree = currentTree();
    // Every item drawn: the selected one must be one of them, so one item can always take focus.
    const ids = [];
    tree.team.forEach((r, i) => { ids.push(`o:${i}`); if (isOpen(`o:${i}`)) r.supporters.forEach((x, n) => ids.push(`s:${i}:${n}`)); });
    if (tree.unaligned.length) { ids.push('ua'); if (isOpen('ua')) tree.unaligned.forEach((x, n) => ids.push(`u:${n}`)); }
    if (!ids.includes(ui.selected)) ui.selected = ids[0] || '';
    return treeHtml({
      quarter: ui.quarter, quarters: quartersFrom(ui.files), current: quarterKey(), tree,
      hasTeam: !!fileFor(TEAM, ui.quarter), teamPath: goalsPath(TEAM, ui.quarter),
      expanded, selected: ui.selected, popover: ui.popover, loading: ui.loadingTree
    });
  }

  /* ---------- a doc ---------- */

  const teamTitles = () => { const t = cache.get(goalsPath(TEAM, ui.quarter)); return t && fileFor(TEAM, ui.quarter) ? t.doc.objectives.map(o => o.title) : []; };

  async function openDoc(owner) {
    const path = goalsPath(owner, ui.quarter);
    if (ui.doc && ui.doc.path === path) return;
    await leaveDoc();
    ui.doc = { path, text: '', mtime: null, dirty: false, saving: false, error: '', conflict: null, exists: false, loading: true, base: null };
    paint();
    try {
      await readFile(goalsPath(TEAM, ui.quarter));
      const f = await readFile(path);
      if (!ui.doc || ui.doc.path !== path) return;
      Object.assign(ui.doc, f ? { text: f.text, mtime: f.mtime, exists: true, base: f.doc } : { exists: false }, { loading: false });
    } catch (e) { if (!waitFor(e)) toastErr(e); if (ui.doc) ui.doc.loading = false; }
    paint();
  }

  function docView() {
    const d = ui.doc;
    const owner = ui.owner;
    const prev = goalsPath(owner, shiftQuarter(ui.quarter, -1));
    return docHtml({
      owner, ownerName: ownerName(owner, d && d.exists ? parseDoc(d.text) : null), quarter: ui.quarter, isReport: owner !== TEAM,
      file: d && !d.loading ? d : null, doc: d && d.exists ? parseDoc(d.text) : null, mode: ui.mode,
      teamTitles: teamTitles(), popover: ui.popover, menu: ui.menu, formatOpen: ui.formatOpen,
      canCopy: !!ui.files.find(f => f.path === prev), loading: !d || d.loading
    });
  }

  let saveTimer = null;
  function status() {
    const d = ui.doc, s = root.querySelector('.g-status'), b = root.querySelector('[data-g-save]');
    if (s && d) s.textContent = d.error ? `Not saved yet: ${d.error}` : d.saving ? 'Saving…' : d.dirty ? 'Unsaved' : 'Saved';
    if (b && d) b.disabled = !d.dirty;
  }
  async function saveDoc() {
    clearTimeout(saveTimer);
    const d = ui.doc;
    if (!d || !d.exists || !d.dirty || d.saving || d.conflict) return;
    d.saving = true; status();
    const text = d.text;
    try {
      const r = await ws.files.write(d.path, text, d.mtime ? { mtime: d.mtime } : { create: true });
      d.mtime = r.mtime; d.error = '';
      wrote(d.path, text, r.mtime);
      if (d.text === text) d.dirty = false;
    } catch (e) {
      if (e.code === 'conflict') { d.conflict = { current: e.current || null }; paint(); }
      else if (!waitFor(e)) { d.error = e.message || 'Workshop did not answer.'; saveTimer = setTimeout(saveDoc, 5000); }
    } finally { d.saving = false; status(); }
  }
  /** Save now, then offer to follow a renamed team objective into the reports' docs. */
  async function settle() {
    const d = ui.doc;
    if (!d || !d.exists) return;
    await saveDoc();
    if (ui.owner === TEAM && !d.dirty && !d.conflict) await offerRenames();
  }
  async function leaveDoc() {
    if (!ui.doc) return;
    await settle();
    ui.doc = null; ui.popover = null; ui.menu = null;
  }
  async function resolveConflict(how) {
    const d = ui.doc;
    if (!d || !d.conflict) return;
    const cur = d.conflict.current;
    d.conflict = null;
    if (how === 'load') {
      if (cur) { d.text = cur.content; d.mtime = cur.mtime; d.dirty = false; d.base = parseDoc(cur.content); wrote(d.path, cur.content, cur.mtime); }
      else { d.mtime = null; d.dirty = true; }
      return paint();
    }
    d.mtime = cur ? cur.mtime : null;
    d.dirty = true;
    paint();
    await saveDoc();
  }

  /* ---------- renaming a team objective ---------- */

  let pendingRenames = null; // [{path, from, to}] waiting for the toast's Update
  async function offerRenames() {
    const d = ui.doc;
    const after = parseDoc(d.text);
    const renames = renamedObjectives(d.base, after);
    d.base = after;
    if (!renames.length) return;
    const q = ui.quarter;
    await loadQuarter(q);
    const hits = [];
    for (const f of ui.files.filter(x => x.quarter === q && x.owner !== TEAM)) {
      const c = cache.get(f.path);
      if (!c) continue;
      for (const r of renames) if (c.doc.objectives.some(o => norm(o.supports) && norm(o.supports) === norm(r.from))) hits.push({ path: f.path, ...r });
    }
    if (!hits.length) return;
    pendingRenames = hits;
    const r = renames.find(x => hits.some(h => h.from === x.from));
    const n = hits.filter(h => h.from === r.from).length;
    ws.toast(renames.length === 1 || hits.every(h => h.from === r.from)
      ? `${n} report goal${n === 1 ? ' supports' : 's support'} "${r.from}". Update ${n === 1 ? 'it' : 'them'} to "${r.to}"?`
      : `${hits.length} report goals support renamed team objectives. Update them?`, { action: { label: 'Update', command: 'goals-rename' } });
  }
  async function applyRenames() {
    const list = pendingRenames || [];
    pendingRenames = null;
    const skipped = [];
    let done = 0;
    for (const path of [...new Set(list.map(h => h.path))]) {
      try {
        const f = await ws.files.read(path);
        if (!f) { skipped.push(path); continue; }
        let text = f.content, count = 0;
        for (const h of list.filter(x => x.path === path)) { const r = renameSupports(text, h.from, h.to); text = r.text; count += r.count; }
        if (!count) { skipped.push(path); continue; }
        const w = await ws.files.write(path, text, { mtime: f.mtime });
        wrote(path, text, w.mtime);
        done += count;
      } catch (e) { skipped.push(path); }
    }
    if (done) ws.toast(`Updated ${done} report goal${done === 1 ? '' : 's'}.`, { kind: 'success' });
    if (skipped.length) ws.toast(`Not updated (changed elsewhere): ${skipped.map(p => ownerName(p.split('/')[1])).join(', ')}. Open them to fix the Supports line.`, { kind: 'warn' });
    paint();
  }

  /* ---------- starting docs ---------- */

  async function startDoc(owner, copy = false) {
    const q = ui.quarter;
    const path = goalsPath(owner, q);
    let text;
    if (copy) {
      const prev = await readFile(goalsPath(owner, shiftQuarter(q, -1)));
      if (!prev) return;
      text = carryOver(prev.text, shiftQuarter(q, -1), q);
    } else {
      await readFile(goalsPath(TEAM, q)).catch(() => null);
      text = owner === TEAM ? teamTemplate(q) : reportTemplate(q, teamTitles());
    }
    try {
      const r = await ws.files.write(path, text, { create: true });
      wrote(path, text, r.mtime);
    } catch (e) {
      if (e.code === 'conflict') { await listFiles(); } // another window made it first: load that one
      else if (!waitFor(e)) { toastErr(e); return paint(); }
    }
    ui.mode = 'edit';
    ui.doc = null;
    if (ui.owner === owner) await openDoc(owner);
    else host.go(`goals/${q}/${owner}`);
    setTimeout(() => root.querySelector('[data-g-editor]')?.focus(), 60);
  }

  /* ---------- updating a KR in place ---------- */

  function krAt(path, line) {
    const text = ui.doc && ui.doc.path === path ? ui.doc.text : (cache.get(path) || {}).text;
    if (text == null) return null;
    for (const o of parseDoc(text).objectives) { const k = o.krs.find(x => x.line === line); if (k) return k; }
    return null;
  }
  async function saveKr(form) {
    const { path, line } = ui.popover || {};
    const kr = path ? krAt(path, line) : null;
    const err = form.querySelector('.g-pop-err');
    const fd = new FormData(form);
    const progress = String(fd.get('progress') || '').trim(), st = String(fd.get('status') || '');
    if (!validProgress(progress)) { err.textContent = 'Use a percent (40%), a number with a unit (18 min), or done.'; err.hidden = false; return; }
    if (!kr) { ui.popover = null; return paint(); }
    // The open doc goes through its own save loop so its editor never falls behind.
    if (ui.doc && ui.doc.path === path) {
      const next = setKr(ui.doc.text, line, { progress, status: st, expectText: kr.text });
      if (next == null) { ws.toast('This goal changed in the file. Open the doc to update it.', { kind: 'warn' }); ui.popover = null; return paint(); }
      ui.doc.text = next; ui.doc.dirty = true; ui.popover = null;
      paint();
      await saveDoc();
      if (!ui.doc.dirty) ws.toast('Updated.', { kind: 'success' });
      return paint();
    }
    try {
      for (let tries = 0; tries < 2; tries++) {
        const f = await ws.files.read(path);
        const next = f && setKr(f.content, line, { progress, status: st, expectText: kr.text });
        if (next == null) { ws.toast('This goal changed in the file. Open the doc to update it.', { kind: 'warn' }); break; }
        try {
          const w = await ws.files.write(path, next, { mtime: f.mtime });
          wrote(path, next, w.mtime);
          ws.toast('Updated.', { kind: 'success' });
          break;
        } catch (e) { if (e.code !== 'conflict' || tries) throw e; }
      }
    } catch (e) { if (!waitFor(e)) toastErr(e); }
    ui.popover = null;
    paint();
    root.querySelector(`[data-g-kr="${CSS.escape(path)}"][data-g-line="${line}"]`)?.focus();
  }

  function setSupportsTo(title) {
    const d = ui.doc, line = ui.menu;
    ui.menu = null;
    if (!d || line == null) return paint();
    const next = setSupports(d.text, line, title || null);
    if (next == null || next === d.text) return paint();
    d.text = next; d.dirty = true;
    paint();
    saveDoc();
  }

  /* ---------- HTML for main.js ---------- */

  function view() {
    if (ui.waiting) return setupHtml(ws.embedded);
    if (!ui.loaded) return '<p class="loading">Loading goals.</p>';
    return ui.owner ? docView() : treeView();
  }

  function afterPaint() {
    if (ui.focusLine != null) {
      const el = root.querySelector(`#g-obj-${ui.focusLine}`);
      if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); ui.focusLine = null; }
    }
    if (ui.popover) { const i = root.querySelector('#g-pop-progress'); if (i && document.activeElement !== i && !root.querySelector('.g-pop')?.contains(document.activeElement)) { i.focus(); i.select(); } }
  }

  /* ---------- routes ---------- */

  /** Rapport's route changed: view, then the quarter and the owner from the path. */
  async function route(view, id, sub) {
    if (view !== 'goals') { ui.on = false; await leaveDoc(); return; }
    ui.on = true;
    const q = isQuarter(id) ? id : quarterKey();
    const owner = sub && /^[a-z0-9][a-z0-9-]{0,39}$/.test(sub) ? sub : '';
    const changed = q !== ui.quarter;
    if (changed) { await leaveDoc(); ui.quarter = q; ui.exp = new Map(); ui.selected = ''; }
    ui.popover = null; ui.menu = null;
    if (owner) { ui.owner = owner; if (ui.loaded) await openDoc(owner); return paint(); }
    await leaveDoc();
    ui.owner = '';
    if (!ui.loaded) return;
    ui.loadingTree = ![goalsPath(TEAM, q), ...ui.files.filter(f => f.quarter === q).map(f => f.path)].every(p => !ui.files.some(f => f.path === p) || cache.has(p));
    paint();
    try { await loadQuarter(q); } catch (e) { toastErr(e); }
    ui.loadingTree = false;
    paint();
  }

  /** First load: list the files, then open whatever the route asked for. */
  async function start(view, id, sub) {
    await listFiles();
    ui.loaded = true;
    await route(view, id, sub);
  }

  /* ---------- input ---------- */

  root.addEventListener('click', async e => {
    if (!ui.on) return;
    const el = s => e.target.closest(s);
    let x;
    if ((x = el('[data-g-toggle]'))) { const id = x.dataset.gToggle; ui.exp.set(id, !isOpen(id)); ui.selected = id; paint(); focusSelected(); return; }
    if ((x = el('[data-g-expand]'))) {
      const all = x.dataset.gExpand === 'all';
      for (const n of root.querySelectorAll('[data-g-node]')) ui.exp.set(n.dataset.gNode, all);
      if (all) { // children of nodes that just opened: open them too
        const t = currentTree();
        t.team.forEach((r, i) => { ui.exp.set(`o:${i}`, true); r.supporters.forEach((s, n) => ui.exp.set(`s:${i}:${n}`, true)); });
        if (t.unaligned.length) { ui.exp.set('ua', true); t.unaligned.forEach((u, n) => ui.exp.set(`u:${n}`, true)); }
      } else { const t = currentTree(); t.team.forEach((r, i) => ui.exp.set(`o:${i}`, false)); ui.exp.set('ua', false); }
      paint(); return;
    }
    if ((x = el('[data-g-prog], [data-g-kr]'))) {
      const path = x.dataset.gKr, line = Number(x.dataset.gLine);
      ui.popover = ui.popover && ui.popover.path === path && ui.popover.line === line ? null : { path, line };
      paint(); return;
    }
    if (el('[data-g-pop-cancel]')) { const p = ui.popover; ui.popover = null; paint(); if (p) root.querySelector(`[data-g-kr="${CSS.escape(p.path)}"][data-g-line="${p.line}"]`)?.focus(); return; }
    if ((x = el('[data-g-open]'))) {
      const m = /^goals\/([^/]+)\/([^/]+)\.md$/.exec(x.dataset.gOpen);
      if (!m) return;
      ui.focusLine = x.dataset.gAt != null ? Number(x.dataset.gAt) : null;
      if (ui.focusLine != null) ui.mode = 'preview';
      host.go(`goals/${m[2]}/${m[1]}`); return;
    }
    if (el('[data-g-back]')) { host.go(`goals/${ui.quarter}`); return; }
    if ((x = el('[data-g-start]'))) { startDoc(x.dataset.gStart); return; }
    if (el('[data-g-copy]')) { startDoc(ui.owner, true); return; }
    if ((x = el('[data-g-mode]'))) { const was = ui.mode; ui.mode = x.dataset.gMode; if (was !== 'preview' && ui.mode === 'preview') await settle(); paint(); return; }
    if (el('[data-g-save]')) { settle(); return; }
    if ((x = el('[data-g-conflict]'))) { resolveConflict(x.dataset.gConflict); return; }
    if ((x = el('[data-g-sup-open]'))) { const l = Number(x.dataset.gSupOpen); ui.menu = ui.menu === l ? null : l; paint(); root.querySelector('.g-menu button')?.focus(); return; }
    if ((x = el('[data-g-sup]'))) { setSupportsTo(x.dataset.gSup); return; }
    if ((x = el('[data-g-node]')) && !el('button, a, input, select, textarea, summary')) { ui.selected = x.dataset.gNode; paint(); focusSelected(); }
  });

  root.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('[data-g-format]')) ui.formatOpen = e.target.open; }, true);

  root.addEventListener('change', e => {
    if (!ui.on) return;
    if (e.target.matches('[data-g-quarter]')) host.go(`goals/${e.target.value}`);
  });

  root.addEventListener('input', e => {
    if (!ui.on || !e.target.matches('[data-g-editor]') || !ui.doc) return;
    ui.doc.text = e.target.value;
    ui.doc.dirty = true;
    status();
    if (ui.mode === 'split') {
      const pv = root.querySelector('[data-g-preview]');
      if (pv) pv.innerHTML = previewHtml({ doc: parseDoc(ui.doc.text), path: ui.doc.path, isReport: ui.owner !== TEAM, teamTitles: teamTitles(), popover: null, menu: null });
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDoc, 1500);
  });

  root.addEventListener('submit', e => {
    if (!e.target.matches('[data-g-kr-form]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    saveKr(e.target);
  }, true);

  /* Tree keys: Up and Down move, Right opens or goes to the first child, Left closes or goes to the parent, Home
     and End, Enter opens (an objective: its doc), * opens the siblings. */
  const items = () => [...root.querySelectorAll('[role="treeitem"]')];
  function focusSelected() { const el = root.querySelector(`[data-g-node="${CSS.escape(ui.selected || '-')}"]`); if (el) el.focus(); }
  function select(el) { if (!el) return; ui.selected = el.dataset.gNode; paint(); focusSelected(); }
  function onTreeKey(e) {
    const cur = e.target.closest('[role="treeitem"]');
    if (!cur || e.target !== cur) return;
    const list = items(), i = list.indexOf(cur), id = cur.dataset.gNode;
    const kids = () => [...cur.querySelectorAll(':scope > [role="group"] > [role="treeitem"]')];
    const parent = cur.parentElement.closest('[role="treeitem"]');
    const leaf = !cur.hasAttribute('aria-expanded');
    let done = true;
    switch (e.key) {
      case 'ArrowDown': select(list[i + 1]); break;
      case 'ArrowUp': select(list[i - 1]); break;
      case 'Home': select(list[0]); break;
      case 'End': select(list[list.length - 1]); break;
      case 'ArrowRight': if (leaf) break; if (!isOpen(id)) { ui.exp.set(id, true); paint(); focusSelected(); } else select(kids()[0]); break;
      case 'ArrowLeft': if (!leaf && isOpen(id)) { ui.exp.set(id, false); paint(); focusSelected(); } else select(parent); break;
      case '*': for (const s of [...(cur.parentElement.children)].filter(n => n.matches('[role="treeitem"][aria-expanded]'))) ui.exp.set(s.dataset.gNode, true); paint(); focusSelected(); break;
      case 'Enter': case ' ': { const b = cur.querySelector(':scope > .g-row [data-g-open]'); if (b) b.click(); else if (!leaf) { ui.exp.set(id, !isOpen(id)); paint(); focusSelected(); } break; }
      default: done = false;
    }
    if (done) e.preventDefault();
  }

  document.addEventListener('keydown', e => {
    if (!ui.on) return;
    if (e.key === 'Escape' && (ui.popover || ui.menu != null)) {
      const p = ui.popover; ui.popover = null; ui.menu = null; paint();
      if (p) root.querySelector(`[data-g-kr="${CSS.escape(p.path)}"][data-g-line="${p.line}"]`)?.focus();
      e.preventDefault(); return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ui.owner && ui.doc && ui.doc.exists) {
      if (e.key === 's') { e.preventDefault(); settle(); return; }
      if (e.key === 'e') { e.preventDefault(); const was = ui.mode; ui.mode = ui.mode === 'edit' ? 'preview' : 'edit'; if (was !== 'preview') settle(); paint(); if (ui.mode === 'edit') root.querySelector('[data-g-editor]')?.focus(); return; }
    }
    if (!ui.owner && !e.ctrlKey && !e.metaKey && !e.altKey) onTreeKey(e);
  });

  /* ---------- live updates ---------- */

  ws.files.subscribe(GOALS, async ev => {
    await listFiles();
    const d = ui.doc;
    if (d && ev && ev.path === d.path && !d.dirty && !d.saving && ev.mtime !== d.mtime) {
      const f = await readFile(d.path);
      if (f && ui.doc === d) Object.assign(d, { text: f.text, mtime: f.mtime, exists: true, base: f.doc });
    }
    if (ui.on && !ui.owner) { try { await loadQuarter(ui.quarter); } catch (e) { /* shown on the next try */ } }
    paint();
  });
  ws.on('command', ({ id }) => { if (id === 'goals-rename') applyRenames(); if (id === 'goals') host.go('goals'); });
  ws.on('online', async p => { if (p && p.online) { await listFiles(); paint(); } });

  return { ui, view, route, start, afterPaint, settle, isWide: () => ui.on };
}

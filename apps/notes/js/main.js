/* Notes: Markdown notes in the Workshop folder, with a folder tree, backlinks, search, tags and images.

   data.js reads and writes the folder through ws.files; model.js and markdown.js are pure; view.js builds
   the HTML. This file owns the page: the editor, saving, the [[ picker, renames and moves, and keys. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { saveFile } from '../../../shared/save-file.js';
import { createNotes } from './data.js';
import { QUICK, startPickup } from './pickup.js';
import { dataUrl, inlineImages, wikiHtml } from './export.js';
import { render, headingId } from './markdown.js';
import {
  APP, MAX_FOLDERS, SEG, baseName, dirOf, freePath, isImagePath, localHref, movedPath, newNoteText, relativeLink,
  relink, resolvePath, resolveWiki, search, slugify, stem, tree, validFolder, wikiPath
} from './model.js';
import { confirmHtml, empty, header, linkUpdatesHtml, panel, pickerHtml, promptHtml, sidebar } from './view.js';

const $ = (id) => document.getElementById(id);
const side = $('side'), head = $('head'), bodyEl = $('body'), editor = $('editor'), preview = $('preview');
const emptyEl = $('empty'), panelEl = $('panel'), picker = $('picker'), dlg = $('dlg');

const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Notes');

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(`notes.${k}`); localStorage.setItem(`notes.${k}`, v); } catch { /* storage blocked */ } return null; };

const ui = {
  path: null,                 // the open note
  other: null,                // {app, path, content}: another app's note, read only
  base: null,                 // {content, mtime}: the open note as last read or saved
  mode: ['edit', 'split', 'preview'].includes(store('mode')) ? store('mode') : 'split',
  query: '', pick: 0,
  closed: new Set(),
  extraFolders: new Set(),    // folders made here that hold no note yet (hidden after a reload)
  othersOpen: false,
  status: { kind: 'saved' },  // saved, dirty, saving, failed, conflict, gone
  current: null               // the newer file on a conflict
};
let found = [];
let pendingRoute = null;    // a route that came before the notes were read

const notes = createNotes(ws, { onChange: () => paintChrome(), onExternal });
// Notes captured in Home (into Quick Notes) or the Dispatch hub (into inbox/), pickup.js. No second click.
const pickup = startPickup(ws, notes, {
  hold: (path) => path === ui.path && !ui.other && ['dirty', 'saving', 'failed', 'conflict'].includes(ui.status.kind),
  async onAdded(w, from) {
    if (w.some(x => x.path === QUICK)) { try { await notes.refresh(QUICK); onExternal({ path: QUICK, gone: false }); } catch { /* shows on the next load */ } }
    const quick = w.filter(x => x.path === QUICK).length;
    ws.toast(quick === w.length ? `Added ${quick === 1 ? 'a note' : quick + ' notes'} from ${from} to Quick Notes`
      : w.length === 1 ? `Added a note from ${from}: ${w[0].path}` : `Added ${w.length} notes from ${from}`, { kind: 'success' });
  }
});
const toastErr = (e) => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

/* ---------- painting ---------- */

function state() { return { notes, ui, found, tree: tree([...notes.texts.keys()], [...ui.extraFolders]) }; }

function paintChrome() {
  if (ui.query.trim()) found = search(notes.index, notes.contents(), ui.query);
  const st = state();
  const active = document.activeElement;
  const inSearch = active && active.matches && active.matches('[data-search]');
  const pos = inSearch ? active.selectionStart : null;
  side.innerHTML = sidebar(st);
  if (inSearch) { const s = side.querySelector('[data-search]'); s.focus(); s.setSelectionRange(pos, pos); }
  head.innerHTML = header(st);
  panelEl.innerHTML = panel(st);
  const showing = Boolean(ui.path || ui.other);
  emptyEl.hidden = showing;
  bodyEl.hidden = !showing;
  if (!showing) emptyEl.innerHTML = empty(st);
  const mode = ui.other ? 'preview' : ui.mode;
  bodyEl.className = `body mode-${mode}`;
  editor.readOnly = Boolean(ui.other);
  panelEl.hidden = !ui.path || Boolean(ui.other);
}

let previewTimer = null;
function paintPreview(now = false) {
  clearTimeout(previewTimer);
  if (!now) { previewTimer = setTimeout(() => paintPreview(true), 120); return; }
  const mode = ui.other ? 'preview' : ui.mode;
  if (mode === 'edit') return;
  const from = ui.other ? ui.other.path : ui.path;
  if (!from) { preview.innerHTML = ''; return; }
  const text = ui.other ? ui.other.content : editor.value;
  const ix = notes.index;
  preview.innerHTML = render(text, {
    resolveLink(href) {
      const loc = localHref(href);
      if (!loc) return null;
      if (!loc.path) return loc.anchor ? { kind: 'anchor', anchor: loc.anchor } : null;
      if (ui.other) return null;
      const target = resolvePath(from, loc.path);
      if (target === null) return null;
      if (ix.notes.has(target)) return { kind: 'note', path: target, anchor: loc.anchor };
      if (/\.md$/.test(target)) return { kind: 'missing', path: target };
      return null;
    },
    imageUrl(src) {
      if (ui.other) return null;
      const loc = localHref(src);
      if (!loc || !loc.path) return null;
      const target = resolvePath(from, loc.path);
      return target && isImagePath(target) && notes.files.has(target) ? { path: target } : null;
    },
    wiki(target) {
      if (ui.other) return null;
      const p = resolveWiki(ix.byTitle, ix.notes, target);
      return p ? { path: p } : null;
    }
  });
  for (const img of preview.querySelectorAll('img[data-img]')) {
    notes.imageUrl(img.dataset.img).then(url => {
      if (url) img.src = url;
      else img.replaceWith(Object.assign(document.createElement('span'), { className: 'img-note missing', textContent: `[image not found: ${img.alt || img.dataset.img}]` }));
    }, () => {});
  }
}

/* ---------- opening notes ---------- */

async function openNote(path, { line = null, anchor = null, focus = false } = {}) {
  if (path === ui.path && !ui.other) { if (line !== null) goToLine(line); if (anchor) goToAnchor(anchor); return; }
  if (!(await leaveNote())) return;
  let t = notes.texts.get(path);
  if (!t) {
    try { const f = await notes.readNote(path); if (!f) { ws.toast(`There is no note ${path}.`, { kind: 'warn' }); return; } t = notes.texts.get(path); }
    catch (e) { toastErr(e); return; }
  }
  ui.path = path; ui.other = null; ui.current = null;
  ui.base = { content: t.content, mtime: t.mtime };
  ui.status = { kind: 'saved' };
  editor.value = t.content;
  store('last', path);
  for (let d = dirOf(path); d; d = dirOf(d)) ui.closed.delete(d);
  paintChrome();
  paintPreview(true);
  if (line !== null) goToLine(line);
  else if (anchor) goToAnchor(anchor);
  else { editor.setSelectionRange(0, 0); editor.scrollTop = 0; preview.scrollTop = 0; }
  if (focus && ui.mode !== 'preview') editor.focus();
}

async function openOther(app, path) {
  if (!(await leaveNote())) return;
  try {
    const f = await notes.readOther(app, path);
    if (!f) { ws.toast('That note is gone.', { kind: 'warn' }); return; }
    ui.path = null; ui.base = null; ui.status = { kind: 'saved' };
    ui.other = { app, path, content: f.content };
    editor.value = f.content;
    paintChrome(); paintPreview(true);
  } catch (e) { toastErr(e); }
}

/** Save before leaving the open note. False if the user should stay (a conflict or failure to look at). */
async function leaveNote() {
  if (!ui.path || ui.other) return true;
  if (ui.status.kind === 'dirty' || ui.status.kind === 'saving') await saveNow();
  if (['conflict', 'failed', 'gone'].includes(ui.status.kind)) {
    ws.toast('This note has unsaved edits. Save them or load the other version first.', { kind: 'warn' });
    return false;
  }
  return true;
}

function goToLine(line) {
  const lines = editor.value.split('\n');
  const at = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  if (ui.mode !== 'preview') {
    editor.focus();
    editor.setSelectionRange(at, at);
    const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
    editor.scrollTop = Math.max(0, line * lh - editor.clientHeight / 3);
  }
  if (ui.mode !== 'edit') {
    requestAnimationFrame(() => {
      const els = [...preview.querySelectorAll('[data-line]')];
      let best = null;
      for (const el of els) if (Number(el.dataset.line) <= line) best = el;
      if (best) best.scrollIntoView({ block: 'center' });
    });
  }
}
function goToAnchor(anchor) {
  requestAnimationFrame(() => {
    const id = `h-${headingId(anchor)}`;
    const el = preview.querySelector(`[id="${CSS.escape(id)}"]`) || preview.querySelector(`[id="${CSS.escape('h-' + anchor)}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
    const n = notes.index.notes.get(ui.path);
    const h = n && n.headings.find(x => x.id === anchor || x.id === headingId(anchor));
    if (h && ui.mode === 'edit') goToLine(h.line);
  });
}

/* ---------- saving ---------- */

let saveTimer = null, retryTimer = null, saving = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 800);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (saving) { await saving; if (ui.status.kind !== 'dirty') return; }
  if (!ui.path || !ui.base || ui.other) return;
  if (['conflict', 'gone'].includes(ui.status.kind)) return;
  const path = ui.path, text = editor.value;
  if (text === ui.base.content) { setStatus('saved'); return; }
  setStatus('saving');
  saving = (async () => {
    try {
      const r = await notes.save(path, text, ui.base.mtime);
      if (ui.path !== path) return;
      ui.base = { content: text, mtime: r.mtime };
      clearTimeout(retryTimer);
      setStatus(editor.value === text ? 'saved' : 'dirty');
      if (editor.value !== text) scheduleSave();
      else if (path === QUICK) pickup.run(); // captures that waited while Quick Notes had edits
    } catch (e) {
      if (ui.path !== path) return;
      if (e.code === 'conflict') {
        ui.current = e.current;
        setStatus(e.current ? 'conflict' : 'gone');
      } else {
        setStatus('failed', e.message);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { if (ui.status.kind === 'failed') { ui.status = { kind: 'dirty' }; saveNow(); } }, 5000);
      }
    }
  })();
  await saving;
  saving = null;
}
function setStatus(kind, message = '') {
  ui.status = { kind, message };
  head.innerHTML = header(state());
}

function onExternal({ path, gone }) {
  if (path !== ui.path) { paintPreview(); return; }
  const t = notes.texts.get(path);
  const mine = editor.value !== ui.base.content || ['dirty', 'saving', 'failed'].includes(ui.status.kind);
  if (gone) { setStatus('gone'); return; }
  if (!t || t.mtime === ui.base.mtime) return;
  if (!mine) {
    const pos = editor.selectionStart;
    editor.value = t.content;
    ui.base = { content: t.content, mtime: t.mtime };
    editor.setSelectionRange(Math.min(pos, t.content.length), Math.min(pos, t.content.length));
    setStatus('saved');
    paintPreview();
  } else {
    ui.current = { content: t.content, mtime: t.mtime };
    setStatus('conflict');
  }
}

async function resolveConflict(how) {
  const path = ui.path, cur = ui.current, mine = editor.value;
  try {
    if (how === 'take-theirs') {
      const f = await notes.readNote(path);
      if (!f) { setStatus('gone'); return; }
      editor.value = f.content;
      ui.base = { content: f.content, mtime: f.mtime };
      setStatus('saved');
    } else if (how === 'keep-copy') {
      const copy = freePath(new Set(notes.files.keys()), dirOf(path), `${stem(path).slice(0, 31)}-conflict`, 'md');
      await notes.create(copy, mine);
      const f = await notes.readNote(path);
      editor.value = f ? f.content : '';
      ui.base = f ? { content: f.content, mtime: f.mtime } : null;
      setStatus(f ? 'saved' : 'gone');
      ws.toast(`Saved your version as ${copy}.`, { kind: 'success' });
    } else if (how === 'overwrite') {
      const r = await notes.save(path, mine, cur.mtime);
      ui.base = { content: mine, mtime: r.mtime };
      setStatus('saved');
    } else if (how === 'restore') {
      const r = await notes.create(path, mine);
      ui.base = { content: mine, mtime: r.mtime };
      setStatus('saved');
    }
    ui.current = null;
    paintChrome(); paintPreview();
  } catch (e) {
    if (e.code === 'conflict') { ui.current = e.current; setStatus(e.current ? 'conflict' : 'gone'); ws.toast('It changed again. Look at it once more.', { kind: 'warn' }); }
    else toastErr(e);
  }
}

/* ---------- dialogs ---------- */

function showDialog(html, check) {
  dlg.innerHTML = html;
  dlg.returnValue = '';
  const form = dlg.querySelector('form');
  const input = form.querySelector('input[name="value"]');
  if (check) {
    form.addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const msg = check(new FormData(form));
      if (msg) { e.preventDefault(); const err = form.querySelector('.dlg-err'); err.textContent = msg; err.hidden = false; }
    });
  }
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? new FormData(form) : null), { once: true });
    dlg.showModal();
    if (input) { input.focus(); input.select(); }
  });
}

/** "runbooks/Deploy plan" -> "runbooks/deploy-plan.md" checked against the name rules; {path} or {error}. */
function notePathFrom(text) {
  const segs = String(text).trim().replace(/\.md$/i, '').split('/').map(s => s.trim()).filter(Boolean);
  if (!segs.length) return { error: 'Give it a name.' };
  if (segs.length > MAX_FOLDERS + 1) return { error: `Notes can be at most ${MAX_FOLDERS} folders deep.` };
  const clean = segs.map((s, k) => (SEG.test(s) ? s : slugify(s, k === segs.length - 1 ? 'untitled' : 'folder')));
  if (clean[0] === 'attachments') return { error: 'attachments/ is for images. Pick another folder.' };
  return { path: `${clean.join('/')}.md` };
}

/* ---------- making notes and folders ---------- */

async function newNote(folder = ui.path ? dirOf(ui.path) : '') {
  const form = await showDialog(promptHtml({ title: 'New note', label: 'Title', value: '', ok: 'Create',
    hint: folder ? `In ${folder}/. The file name comes from the title.` : 'The file name comes from the title.' }), (fd) => (String(fd.get('value')).trim() ? '' : 'Give it a title.'));
  if (!form) return;
  const title = String(form.get('value')).trim();
  const path = freePath(new Set(notes.files.keys()), folder, slugify(title), 'md');
  if (!(await leaveNote())) return;
  try {
    await notes.create(path, newNoteText(title));
    if (folder) ui.extraFolders.delete(folder);
    if (ui.mode === 'preview') { ui.mode = 'split'; store('mode', 'split'); }
    await openNote(path);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  } catch (e) { toastErr(e); }
}

async function createAt(path, title) {
  if (!path || !/\.md$/.test(path) || !validFolder(dirOf(path)) || !SEG.test(stem(path))) { ws.toast('That link does not name a note Notes can make.', { kind: 'warn' }); return; }
  if (!(await leaveNote())) return;
  try { if (!notes.files.has(path)) await notes.create(path, newNoteText(title || stem(path))); await openNote(path, { focus: true }); }
  catch (e) { toastErr(e); }
}

async function newFolder(base = ui.path ? dirOf(ui.path) : '') {
  const form = await showDialog(promptHtml({ title: 'New folder', label: 'Folder', value: base ? `${base}/` : '', ok: 'Create',
    hint: `Up to ${MAX_FOLDERS} levels. A folder with no notes is not kept.` }), (fd) => {
    const segs = String(fd.get('value')).split('/').map(s => s.trim()).filter(Boolean).map(s => slugify(s, 'folder'));
    if (!segs.length) return 'Give it a name.';
    if (segs.length > MAX_FOLDERS) return `Folders can be at most ${MAX_FOLDERS} levels deep.`;
    if (segs[0] === 'attachments') return 'attachments/ is for images.';
    return '';
  });
  if (!form) return;
  const folder = String(form.get('value')).split('/').map(s => s.trim()).filter(Boolean).map(s => slugify(s, 'folder')).join('/');
  for (let d = folder; d; d = dirOf(d)) { ui.extraFolders.add(d); ui.closed.delete(d); }
  paintChrome();
  newNote(folder);
}

/* ---------- renaming, moving, trash ---------- */

/** Apply moves (old note path -> new): write each note at its new place with its links fixed, fix links in the
    notes the user ticked, then trash the old files. Nothing is trashed until its copy is written. */
async function applyMoves(moves, label) {
  const ix = notes.index;
  const taken = new Set(notes.files.keys());
  for (const [from, to] of moves) {
    if (from === to) moves.delete(from);
    else if (taken.has(to) && !moves.has(to)) { ws.toast(`${to} already exists.`, { kind: 'warn' }); return; }
  }
  if (!moves.size) return;
  if (!(await leaveNote())) return;
  // Notes outside the move whose links change.
  const updates = [];
  for (const [p, t] of notes.texts) {
    if (moves.has(p)) continue;
    const r = relink(t.content, p, moves, ix);
    if (r.count) updates.push({ path: p, count: r.count, content: r.content, mtime: t.mtime });
  }
  const list = [...moves].map(([a, b]) => `<li><span class="mono">${a}</span> to <span class="mono">${b}</span></li>`).join('');
  const form = await showDialog(confirmHtml({ title: label, ok: 'Move',
    body: `<ul class="moves">${list}</ul>${linkUpdatesHtml(updates, ix)}` }));
  if (!form) return;
  const chosen = new Set(form.getAll('update'));
  const problems = [];
  const opened = ui.path;
  for (const [from, to] of moves) {
    const t = notes.texts.get(from);
    const text = from === ui.path ? editor.value : t.content;
    const r = relink(text, from, moves, ix);
    try { await notes.create(to, r.content); }
    catch (e) { toastErr(e); return; }
  }
  for (const u of updates) {
    if (!chosen.has(u.path)) continue;
    try { await notes.save(u.path, u.content, u.mtime); } catch (e) { problems.push(u.path); }
  }
  for (const from of moves.keys()) {
    try { await notes.trash(from); } catch (e) { problems.push(from); }
  }
  for (const f of [...ui.extraFolders]) for (const [from] of moves) if (from.startsWith(f + '/')) ui.extraFolders.delete(f);
  if (opened && moves.has(opened)) { ui.path = null; await openNote(moves.get(opened)); }
  paintChrome();
  if (problems.length) ws.toast(`Moved. Could not update ${problems.join(', ')}: they changed meanwhile. Check their links.`, { kind: 'warn' });
  else ws.toast(`Moved ${moves.size === 1 ? 'the note' : `${moves.size} notes`}.`, { kind: 'success' });
}

async function renameNote(path = ui.path) {
  if (!path) return;
  const form = await showDialog(promptHtml({ title: 'Rename or move', label: 'Path in notes/', value: path.replace(/\.md$/, ''), ok: 'Next',
    hint: 'Lowercase, digits and dashes. Use / for folders, for example runbooks/deploy.' }), (fd) => {
    const r = notePathFrom(fd.get('value'));
    if (r.error) return r.error;
    if (r.path !== path && notes.files.has(r.path)) return `${r.path} already exists.`;
    return '';
  });
  if (!form) return;
  const to = notePathFrom(form.get('value')).path;
  await applyMoves(new Map([[path, to]]), 'Rename or move note');
}

async function renameFolder(folder) {
  const form = await showDialog(promptHtml({ title: 'Rename or move folder', label: 'Folder', value: folder, ok: 'Next' }), (fd) => {
    const v = String(fd.get('value')).trim().replace(/\/+$/, '');
    if (!validFolder(v) || !v) return `Use up to ${MAX_FOLDERS} parts of lowercase letters, digits and dashes.`;
    if (v === folder || v.startsWith(folder + '/')) return 'Pick a folder outside this one.';
    if (v.split('/')[0] === 'attachments') return 'attachments/ is for images.';
    return '';
  });
  if (!form) return;
  await moveFolder(folder, String(form.get('value')).trim().replace(/\/+$/, ''));
}
async function moveFolder(folder, to) {
  const moves = new Map();
  for (const p of notes.texts.keys()) { const m = movedPath(p, folder, to); if (m) moves.set(p, m); }
  if ([...moves.values()].some(p => p.split('/').length > MAX_FOLDERS + 1)) { ws.toast(`That would put notes more than ${MAX_FOLDERS} folders deep.`, { kind: 'warn' }); return; }
  if (!moves.size) {
    ui.extraFolders.delete(folder);
    for (let d = to; d; d = dirOf(d)) ui.extraFolders.add(d);
    paintChrome();
    return;
  }
  await applyMoves(moves, 'Move folder');
}

async function trashNote(path = ui.path) {
  if (!path) return;
  const backs = (notes.index.backlinks.get(path) || []).length;
  const ok = await showDialog(confirmHtml({ title: 'Move to the trash', ok: 'Move to trash', danger: true,
    body: `<p>${path} goes to the Workshop folder's <code>.trash/</code>. Nothing is deleted; you can move it back by hand.</p>${backs ? `<p class="warn">${backs} link${backs === 1 ? '' : 's'} in other notes will stop working.</p>` : ''}` }));
  if (!ok) return;
  try {
    await notes.trash(path);
    if (ui.path === path) { ui.path = null; ui.base = null; ui.status = { kind: 'saved' }; editor.value = ''; }
    paintChrome();
    ws.toast('Moved to the trash.', { kind: 'success' });
  } catch (e) { toastErr(e); }
}

/* ---------- export ---------- */

async function copyMarkdown() {
  const text = ui.other ? ui.other.content : editor.value;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = Object.assign(document.createElement('textarea'), { value: text });
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } finally { t.remove(); }
  }
  ws.toast('Copied the Markdown.', { kind: 'success' });
}
/* Copy for wiki: the note as Markdown with its images embedded, and as HTML with the images inside it, both on
   the clipboard at once. A visual editor takes the HTML; a Markdown box takes the text. Nothing leaves the
   clipboard. The ClipboardItem gets promises so the copy still counts as part of the click while images load. */
async function copyForWiki() {
  if (!ui.path) return;
  const text = editor.value, from = ui.path;
  const built = inlineImages(text, from, async (p) => {
    if (!notes.files.has(p)) return null;
    const f = await ws.files.read(p).catch(() => null);
    return f ? dataUrl(f.content.type, new Uint8Array(await f.content.arrayBuffer())) : null;
  }).then(r => ({ ...r, html: wikiHtml(r.markdown) }));
  const done = (r) => {
    const n = r.embedded.length;
    const msg = `Copied for the wiki${n ? ` with ${n} image${n === 1 ? '' : 's'}` : ''}.`;
    ws.toast(r.missing.length ? `${msg} ${r.missing.length} image${r.missing.length === 1 ? ' was' : 's were'} not found: ${r.missing.join(', ')}.` : msg, { kind: r.missing.length ? 'warn' : 'success' });
  };
  try {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no async clipboard');
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': built.then(r => new Blob([r.html], { type: 'text/html' })),
      'text/plain': built.then(r => new Blob([r.markdown], { type: 'text/plain' }))
    })]);
    done(await built);
  } catch {
    // Older path: a copy event that sets both types.
    try {
      const r = await built;
      const put = (e) => { e.clipboardData.setData('text/html', r.html); e.clipboardData.setData('text/plain', r.markdown); e.preventDefault(); };
      document.addEventListener('copy', put, { once: true });
      const ok = document.execCommand('copy');
      document.removeEventListener('copy', put);
      if (!ok) throw new Error('copy refused');
      done(r);
    } catch (e) { ws.toast('Workshop could not use the clipboard. Click Copy for wiki again.', { kind: 'error' }); }
  }
}
async function download() {
  if (!ui.path) return;
  try { await saveFile(`${stem(ui.path)}.md`, editor.value, 'text/markdown'); } catch (e) { toastErr(e); }
}

/* ---------- images ---------- */

async function addImages(list) {
  if (!ui.path || ui.other) return;
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const path = await notes.addImage(file, file.name || 'image');
      const alt = (file.name || 'image').replace(/\.[a-z0-9]+$/i, '');
      const s = editor.selectionStart;
      const before = s === 0 || editor.value[s - 1] === '\n' ? '' : '\n';
      insertAtCursor(`${before}![${alt.replace(/[[\]]/g, '')}](${relativeLink(ui.path, path)})\n`);
    } catch (e) { toastErr(e); }
  }
}
function insertAtCursor(text) {
  const s = editor.selectionStart, e = editor.selectionEnd;
  editor.setRangeText(text, s, e, 'end');
  editor.dispatchEvent(new Event('input'));
}

/* ---------- the [[ picker ---------- */

const pk = { open: false, start: 0, items: [], pick: 0 };
function updatePicker() {
  const before = editor.value.slice(0, editor.selectionStart);
  const m = /\[\[([^\]\n[]{0,60})$/.exec(before);
  if (!m || ui.other) { closePicker(); return; }
  const q = m[1].toLowerCase();
  pk.start = editor.selectionStart - m[0].length;
  pk.items = [...notes.index.notes.values()].filter(n => n.path !== ui.path && (!q || n.title.toLowerCase().includes(q) || n.path.includes(q)))
    .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1) || (a.title < b.title ? -1 : 1)).slice(0, 8);
  pk.pick = Math.min(pk.pick, Math.max(0, pk.items.length - 1));
  pk.open = true;
  picker.innerHTML = pickerHtml(pk.items, pk.pick);
  picker.hidden = false;
}
function closePicker() { pk.open = false; picker.hidden = true; }
function choosePicker(k = pk.pick) {
  const n = pk.items[k];
  if (!n) { closePicker(); return; }
  editor.setRangeText(`[${n.title.replace(/[[\]]/g, '')}](${relativeLink(ui.path, n.path)})`, pk.start, editor.selectionStart, 'end');
  closePicker();
  editor.dispatchEvent(new Event('input'));
}

/* ---------- events ---------- */

editor.addEventListener('input', () => {
  if (ui.other || !ui.path) return;
  if (['conflict', 'gone'].includes(ui.status.kind)) { paintPreview(); updatePicker(); return; }
  if (ui.status.kind !== 'dirty' && ui.status.kind !== 'saving') setStatus('dirty');
  scheduleSave();
  paintPreview();
  updatePicker();
});
editor.addEventListener('keydown', (e) => {
  if (pk.open && pk.items.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pk.pick = (pk.pick + (e.key === 'ArrowDown' ? 1 : pk.items.length - 1)) % pk.items.length; picker.innerHTML = pickerHtml(pk.items, pk.pick); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choosePicker(); return; }
  }
  if (pk.open && e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); insertAtCursor('  '); }
});
editor.addEventListener('blur', () => { setTimeout(closePicker, 150); if (ui.status.kind === 'dirty') saveNow(); });
editor.addEventListener('paste', (e) => {
  const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (imgs.length) { e.preventDefault(); addImages(imgs); }
});
editor.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault(); });
editor.addEventListener('drop', (e) => {
  const imgs = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  if (imgs.length) { e.preventDefault(); addImages(imgs); }
});
picker.addEventListener('mousedown', (e) => { const li = e.target.closest('[data-pick]'); if (li) { e.preventDefault(); choosePicker(Number(li.dataset.pick)); } });

document.addEventListener('click', async (e) => {
  const el = (sel) => e.target.closest(sel);
  let x;
  if ((x = el('[data-open]'))) { e.preventDefault(); await openNote(x.dataset.open, { line: x.dataset.line !== undefined ? Number(x.dataset.line) : null }); return; }
  if ((x = el('[data-other-app]'))) { e.preventDefault(); openOther(x.dataset.otherApp, x.dataset.otherPath); return; }
  if ((x = el('[data-note]'))) { e.preventDefault(); await openNote(x.dataset.note, { anchor: x.dataset.anchor || null }); return; }
  if ((x = el('[data-missing]'))) { e.preventDefault(); createAt(wikiPath(x.dataset.missing), x.dataset.missing); return; }
  if ((x = el('[data-missing-path]'))) { e.preventDefault(); createAt(x.dataset.missingPath, null); return; }
  if ((x = el('[data-anchor]'))) { e.preventDefault(); if (x.dataset.line !== undefined) goToLine(Number(x.dataset.line)); else goToAnchor(x.dataset.anchor); return; }
  if ((x = el('[data-tag]'))) { e.preventDefault(); setQuery(`tag:${x.dataset.tag}`); side.querySelector('[data-search]')?.focus(); return; }
  if ((x = el('[data-mode]'))) { ui.mode = x.dataset.mode; store('mode', ui.mode); paintChrome(); paintPreview(true); return; }
  if ((x = el('.others summary'))) { ui.othersOpen = !x.parentElement.open; return; }
  if (!(x = el('[data-act]'))) return;
  const act = x.dataset.act;
  if (act === 'new-note') newNote();
  else if (act === 'new-note-in') newNote(x.dataset.folder);
  else if (act === 'new-folder') newFolder();
  else if (act === 'toggle') { const f = x.dataset.folder; if (ui.closed.has(f)) ui.closed.delete(f); else ui.closed.add(f); paintChrome(); }
  else if (act === 'folder-menu') renameFolder(x.dataset.folder);
  else if (act === 'rename') renameNote();
  else if (act === 'trash') trashNote();
  else if (act === 'copy') copyMarkdown();
  else if (act === 'copy-wiki') copyForWiki();
  else if (act === 'download') download();
  else if (act === 'retry') { ui.status = { kind: 'dirty' }; saveNow(); }
  else if (['take-theirs', 'keep-copy', 'overwrite', 'restore'].includes(act)) resolveConflict(act);
});

function setQuery(q) {
  ui.query = q; ui.pick = 0;
  paintChrome();
}
side.addEventListener('input', (e) => { if (e.target.matches('[data-search]')) setQuery(e.target.value); });
side.addEventListener('keydown', (e) => {
  if (!e.target.matches('[data-search]')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ui.pick = Math.max(0, Math.min(found.length - 1, ui.pick + (e.key === 'ArrowDown' ? 1 : -1))); paintChrome(); }
  else if (e.key === 'Enter' && found[ui.pick]) { e.preventDefault(); const r = found[ui.pick]; openNote(r.path, { line: r.line }); }
  else if (e.key === 'Escape') { e.preventDefault(); setQuery(''); editor.focus(); }
});

// Drag notes and folders onto folders (or the empty part of the tree for the top level).
side.addEventListener('dragstart', (e) => {
  const li = e.target.closest('[data-path],[data-folder]');
  if (!li) return;
  e.dataTransfer.setData('text/x-notes', JSON.stringify(li.dataset.path ? { note: li.dataset.path } : { folder: li.dataset.folder }));
  e.dataTransfer.effectAllowed = 'move';
});
side.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-notes')) { e.preventDefault(); side.querySelectorAll('.drop').forEach(n => n.classList.remove('drop')); (e.target.closest('.folder') || side.querySelector('.side-body'))?.classList.add('drop'); } });
side.addEventListener('dragleave', (e) => { if (!side.contains(e.relatedTarget)) side.querySelectorAll('.drop').forEach(n => n.classList.remove('drop')); });
side.addEventListener('drop', async (e) => {
  const raw = e.dataTransfer.getData('text/x-notes');
  side.querySelectorAll('.drop').forEach(n => n.classList.remove('drop'));
  if (!raw) return;
  e.preventDefault();
  const into = e.target.closest('.folder')?.dataset.folder || '';
  const what = JSON.parse(raw);
  if (what.note) {
    if (dirOf(what.note) === into) return;
    const to = `${into ? into + '/' : ''}${baseName(what.note)}`;
    if (into.split('/').filter(Boolean).length > MAX_FOLDERS) return;
    await applyMoves(new Map([[what.note, to]]), 'Move note');
  } else if (what.folder) {
    if (into === what.folder || into.startsWith(what.folder + '/') || dirOf(what.folder) === into) return;
    const to = `${into ? into + '/' : ''}${baseName(what.folder)}`;
    if (!validFolder(to)) { ws.toast(`Folders can be at most ${MAX_FOLDERS} levels deep.`, { kind: 'warn' }); return; }
    await moveFolder(what.folder, to);
  }
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); side.querySelector('[data-search]')?.focus(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); const order = ['edit', 'split', 'preview']; ui.mode = order[(order.indexOf(ui.mode) + 1) % 3]; store('mode', ui.mode); paintChrome(); paintPreview(true); return; }
  if (e.key === 'F2' && ui.path) { e.preventDefault(); renameNote(); return; }
  if (typing || dlg.open || mod || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); side.querySelector('[data-search]')?.focus(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newNote(); }
});

window.addEventListener('beforeunload', (e) => {
  if (ui.path && editor.value !== (ui.base && ui.base.content)) { saveNow(); e.preventDefault(); e.returnValue = ''; }
});

/* ---------- routes, commands, start ---------- */

ws.commands.register({ id: 'new', title: 'New note' });
ws.commands.register({ id: 'search', title: 'Search notes' });
ws.on('command', (p) => {
  if (p.id === 'new') newNote();
  else if (p.id === 'search') side.querySelector('[data-search]')?.focus();
});
ws.on('route', (p) => {
  let path = '';
  try { path = decodeURIComponent(p.path || ''); } catch { path = p.path || ''; }
  if (path && /\.md$/.test(path) && path !== ui.path) {
    if (notes.loaded) openNote(path); else pendingRoute = path;
  }
});
ws.on('online', async (p) => {
  if (!p.online) return;
  await notes.load();
  pickup.run();
  if (!ui.path && !ui.other) await openLast();
});
ws.on('visible', (p) => { if (!p.visible && ui.status.kind === 'dirty') saveNow(); });

paintChrome();
await notes.load();
pickup.run();
async function openLast() {
  const first = pendingRoute || store('last');
  pendingRoute = null;
  if (first && notes.texts.has(first)) await openNote(first);
  else paintChrome();
}
await openLast();
fetch('../registry.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
  .then(reg => notes.loadOthers(reg && Array.isArray(reg.apps) ? reg.apps.map(a => a.manifest && a.manifest.id).filter(Boolean) : ['receipts', 'home', 'agents']));

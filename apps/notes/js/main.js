/* Notes: Markdown notes in the Workshop folder, with a folder tree, backlinks, search, tags and images.

   data.js reads and writes the folder through ws.files; model.js, markdown.js, templates.js, applinks.js,
   offers.js, history.js, vault.js and summary-cards.js are pure; view.js builds the HTML. This file owns the
   page: the editor, saving, the [[ picker, renames and moves, templates and today's note, sending action items
   and wins, history, importing a folder, product notes and their review (products.js), Notes' summary, and keys. */
import { connect } from '../shared/workshop-sdk.js';
import { mountBar } from '../shared/standalone-bar.js';
import { saveFile } from '../shared/save-file.js';
import { createNotes } from './data.js';
import { QUICK, SENDERS, startPickup } from './pickup.js';
import { useSenders } from '../shared/handoffs.js';
import { createSummaryWriter } from '../shared/summary.js';
import { RELATION_LABEL } from '../shared/people.js';
import { PAIR_HELP, canPair, forgetPairing, isPaired, pairWith } from '../shared/pair.js';
import { DAILY, PRODUCT_TPL, STARTERS, TEMPLATES, dailyPath, dailyText, dayOf, fill, missingStarters, templatesIn } from './templates.js';
import { PRODUCTS, baselineFor, blocksToMark, changedLines, markReviewed, needsReview } from './products.js';
import { actionItems, forRapport, offerFor, rapportOffers, readOffers, sentIds, withOffer } from './offers.js';
import { planImport, linkMaps, rewriteNote } from './vault.js';
import { notesCards } from './summary-cards.js';
import { docketPlan } from './daily.js';
import { SOURCES, matchRecords, recordLink, recordsFrom } from './records.js';
import { dataUrl, inlineImages, wikiHtml } from './export.js';
import { render, headingId } from './markdown.js';
import {
  APP, MAX_FOLDERS, SEG, baseName, dirOf, freePath, isImagePath, localHref, movedPath, newNoteText, relativeLink,
  relink, resolvePath, resolveWiki, search, slugify, stem, tree, validFolder, wikiPath
} from './model.js';
import { confirmHtml, empty, header, historyHtml, importHtml, linkUpdatesHtml, newNoteHtml, panel, pickerHtml, promptHtml, sidebar } from './view.js';

const $ = (id) => document.getElementById(id);
const side = $('side'), head = $('head'), bodyEl = $('body'), editor = $('editor'), preview = $('preview');
const emptyEl = $('empty'), panelEl = $('panel'), picker = $('picker'), dlg = $('dlg');

const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Notes');
// On Notes' own site: install as an app and work offline (shared/sw-register.js). Inside Workshop, Workshop's does.
let swReload = null;
if (!ws.embedded && window.WorkshopSw) WorkshopSw.register((msg, label, fn) => { swReload = fn; ws.toast(msg, { action: { label, command: 'reload-new' } }).catch(() => {}); });

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(`notes.${k}`); localStorage.setItem(`notes.${k}`, v); } catch { /* storage blocked */ } return null; };

const ui = {
  path: null,                 // the open note
  base: null,                 // {content, mtime}: the open note as last read or saved
  mode: ['edit', 'split', 'preview'].includes(store('mode')) ? store('mode') : 'split',
  query: '', pick: 0,
  closed: new Set(),
  extraFolders: new Set(),    // folders made here that hold no note yet (hidden after a reload)
  status: { kind: 'saved' },  // saved, dirty, saving, failed, conflict, gone
  current: null               // the newer file on a conflict
};
let found = [];
let pendingRoute = null;    // a route that came before the notes were read

const notes = createNotes(ws, { onChange: () => { paintChrome(); if (notes.loaded) summary.schedule(); }, onExternal });
// Notes' summary for Home and other apps (summary-cards.js): titles and paths, never note text.
const summary = createSummaryWriter({ data: ws.data, app: APP, build: () => (notes.loaded ? notesCards(notes.index) : null) });
// App names for ws: link chips (applinks.js), from the manifests on this site.
const appNames = { prioritizer: 'Docket', agents: 'Dispatch', receipts: 'Rapport', runway: 'Runway', home: 'Home', people: 'People', settings: 'Settings' };
// Offers Notes has sent (offers.js). The receivers can read them inside Workshop, or when paired.
const canSend = ws.embedded || ws.backend === 'agent';
let sent = new Set();
// Workshop's People directory, for @handles (offers.js whoOf, the preview's person chips). Where Notes can read it.
let dir = null;
// Other apps' records for the [[ picker (records.js).
const recordEnvs = {};
let records = [];
// Notes captured in Home (into Quick Notes) or the Dispatch hub (into inbox/), pickup.js. No second click.
const pickup = startPickup(ws, notes, {
  hold: (path) => path === ui.path && ['dirty', 'saving', 'failed', 'conflict'].includes(ui.status.kind),
  dailyText: (day) => dailyNoteText(day),
  async onAdded(w, from) {
    // Notes it wrote into (Quick Notes, a day's note): read again, and show the change if one is open.
    for (const path of new Set(w.filter(x => x.path === QUICK || x.daily).map(x => x.path))) {
      try { await notes.refresh(path); onExternal({ path, gone: false }); } catch { /* shows on the next load */ }
    }
    const quick = w.filter(x => x.path === QUICK).length;
    const day = w.filter(x => x.daily);
    const where = (x) => (x.daily === dayOf(new Date()) ? "today's note" : `the note for ${x.daily}`);
    ws.toast(day.length === w.length ? (day[0].section ? `Added the ${day[0].section.toLowerCase()} from ${from} to ${where(day[0])}` : `Added ${day.length === 1 ? 'a note' : day.length + ' notes'} from ${from} to ${where(day[0])}`)
      : quick === w.length ? `Added ${quick === 1 ? 'a note' : quick + ' notes'} from ${from} to Quick Notes`
      : w.length === 1 ? `Added a note from ${from}: ${w[0].path}` : `Added ${w.length} notes from ${from}`, { kind: 'success' });
    const gone = [...new Set(w.filter(x => x.fellBack).map(x => x.fellBack))];
    if (gone.length) ws.toast(`${gone.map(f => f + '/').join(', ')} ${gone.length === 1 ? "wasn't" : "weren't"} there anymore, so the capture went to ${w.find(x => x.fellBack).path === QUICK ? 'Quick Notes' : 'inbox/'}.`, { kind: 'warn' });
  }
});
const toastErr = (e) => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

/* ---------- painting ---------- */

function state() {
  return { notes, ui, found, tree: tree([...notes.texts.keys()], [...ui.extraFolders]), where: whereSaved(), sent, canSend, dir,
    versions: ui.path ? notes.history(ui.path).length : 0 };
}

/* Where notes are saved, for the sidebar's foot on Notes' own site (inside Workshop, Workshop says). */
function whereSaved() {
  if (ws.embedded) return null;
  if (isPaired(ws)) return { text: 'in your Workshop folder on this computer', paired: true };
  if (ws.storage === 'folder') return { text: 'in a folder you chose', canFolder: true, canPair: canPair(ws) };
  return { text: 'in this browser', canFolder: typeof window.showDirectoryPicker === 'function', canPair: canPair(ws) };
}

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
  const showing = Boolean(ui.path);
  emptyEl.hidden = showing;
  bodyEl.hidden = !showing;
  if (!showing) emptyEl.innerHTML = empty(st);
  bodyEl.className = `body mode-${ui.mode}`;
  panelEl.hidden = !ui.path;
}

let previewTimer = null;
function paintPreview(now = false) {
  clearTimeout(previewTimer);
  if (!now) { previewTimer = setTimeout(() => paintPreview(true), 120); return; }
  if (ui.mode === 'edit') return;
  const from = ui.path;
  if (!from) { preview.innerHTML = ''; return; }
  const text = editor.value;
  const ix = notes.index;
  preview.innerHTML = render(text, {
    appName: (id) => appNames[id] || id,
    person: (h) => { const it = dir && dir.items.find(x => !x.archived && x.handle === h); return it ? it.name : null; },
    resolveLink(href) {
      const loc = localHref(href);
      if (!loc) return null;
      if (!loc.path) return loc.anchor ? { kind: 'anchor', anchor: loc.anchor } : null;
      const target = resolvePath(from, loc.path);
      if (target === null) return null;
      if (ix.notes.has(target)) return { kind: 'note', path: target, anchor: loc.anchor };
      if (/\.md$/.test(target)) return { kind: 'missing', path: target };
      return null;
    },
    imageUrl(src) {
      const loc = localHref(src);
      if (!loc || !loc.path) return null;
      const target = resolvePath(from, loc.path);
      return target && isImagePath(target) && notes.files.has(target) ? { path: target } : null;
    },
    wiki(target) {
      const p = resolveWiki(ix.byTitle, ix.notes, target);
      return p ? { path: p } : null;
    }
  });
  markTandemLines(from, text);
  for (const img of preview.querySelectorAll('img[data-img]')) {
    notes.imageUrl(img.dataset.img).then(url => {
      if (url) img.src = url;
      else img.replaceWith(Object.assign(document.createElement('span'), { className: 'img-note missing', textContent: `[image not found: ${img.alt || img.dataset.img}]` }));
    }, () => {});
  }
}

/* Product notes Tandem changed since your last review: highlight the changed blocks in the preview (products.js).
   The version compared with is read once per note and snapshot. */
const baselines = new Map(); // `${path}|${snapshot path}` -> text
async function markTandemLines(path, text) {
  const n = notes.index.notes.get(path);
  if (!n || !needsReview(n.review)) return;
  const base = baselineFor(n.review, notes.history(path));
  if (base === null) return;
  let before = '';
  if (base) {
    const key = `${path}|${base.path}`;
    if (!baselines.has(key)) baselines.set(key, await notes.readSnapshot(base.path).catch(() => null));
    before = baselines.get(key);
    if (before === null) return;
  }
  if (ui.path !== path || editor.value !== text) return;
  const els = [...preview.querySelectorAll('[data-line]')];
  const marked = blocksToMark(els.map(e => Number(e.dataset.line)), changedLines(before, text));
  for (const e of els) if (marked.has(Number(e.dataset.line))) { e.classList.add('tandem-new'); e.title = 'Changed by Tandem since your last review'; }
}

/* Mark reviewed: sets reviewed: in the note's frontmatter and saves (history keeps the text before). */
async function markReviewedNow() {
  if (!ui.path || ['conflict', 'gone'].includes(ui.status.kind)) return;
  editor.value = markReviewed(editor.value);
  setStatus('dirty');
  await saveNow();
  paintChrome();
  paintPreview(true);
  if (ui.status.kind === 'saved') ws.toast('Marked reviewed.', { kind: 'success' });
}

/* ---------- opening notes ---------- */

async function openNote(path, { line = null, anchor = null, focus = false } = {}) {
  if (path === ui.path) { if (line !== null) goToLine(line); if (anchor) goToAnchor(anchor); return; }
  if (!(await leaveNote())) return;
  let t = notes.texts.get(path);
  if (!t) {
    try { const f = await notes.readNote(path); if (!f) { ws.toast(`There is no note ${path}.`, { kind: 'warn' }); return; } t = notes.texts.get(path); }
    catch (e) { toastErr(e); return; }
  }
  ui.path = path; ui.current = null;
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

/** Save before leaving the open note. False if the user should stay (a conflict or failure to look at). */
async function leaveNote() {
  if (!ui.path) return true;
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
  if (!ui.path || !ui.base) return;
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
  if (clean[0] === 'history') return { error: 'history/ keeps earlier versions of notes. Pick another folder.' };
  return { path: `${clean.join('/')}.md` };
}

/* ---------- making notes and folders ---------- */

/* New notes go in the open note's folder, except daily/ and templates/: a note made while today's note or a
   template is open goes at the top. */
const defaultFolder = () => {
  const d = ui.path ? dirOf(ui.path) : '';
  return d === DAILY || d === TEMPLATES ? '' : d;
};
async function newNote(folder = defaultFolder()) {
  const templates = templatesIn(notes.texts.keys(), (p) => notes.texts.get(p)?.content || '');
  dlg.innerHTML = newNoteHtml({ folder, templates, productMissing: !notes.texts.has(PRODUCT_TPL) });
  dlg.returnValue = '';
  const form = dlg.querySelector('form');
  const tplPick = form.querySelector('[data-tpl-pick]'), tplUse = form.querySelector('[data-tpl-use]');
  if (tplPick && tplUse) tplPick.addEventListener('change', () => { tplUse.textContent = tplPick.selectedOptions[0]?.dataset.use || ''; });
  form.addEventListener('submit', (e) => {
    const v = e.submitter && e.submitter.value;
    if (v === 'cancel' || v === 'starters' || v === 'product-template') return;
    if (!String(new FormData(form).get('value')).trim()) { e.preventDefault(); const err = form.querySelector('.dlg-err'); err.textContent = 'Give it a title.'; err.hidden = false; }
  });
  const how = await new Promise(resolve => { dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }); dlg.showModal(); form.querySelector('input[name="value"]').focus(); });
  if (how === 'starters') { await addStarters(); return newNote(folder); }
  if (how === 'product-template') {
    try { await notes.create(PRODUCT_TPL, STARTERS[PRODUCT_TPL]); ws.toast('Added templates/product.md. Edit it like any note.', { kind: 'success' }); }
    catch (e) { if (e.code !== 'conflict') toastErr(e); }
    return newNote(folder);
  }
  if (how !== 'ok') return;
  const fd = new FormData(form);
  const title = String(fd.get('value')).trim();
  const tpl = String(fd.get('template') || '');
  if (tpl === PRODUCT_TPL && !folder) folder = PRODUCTS; // product notes live in products/ (products.js)
  const path = freePath(new Set(notes.files.keys()), folder, slugify(title), 'md');
  const text = tpl && notes.texts.has(tpl) ? fill(notes.texts.get(tpl).content, { title }) : newNoteText(title);
  if (!(await leaveNote())) return;
  try {
    await notes.create(path, text);
    if (folder) ui.extraFolders.delete(folder);
    if (ui.mode === 'preview') { ui.mode = 'split'; store('mode', 'split'); }
    await openNote(path);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  } catch (e) { toastErr(e); }
}

/* The starter templates (templates.js) that are not there yet. */
async function addStarters() {
  const todo = missingStarters(new Set(notes.files.keys()));
  let n = 0;
  for (const t of todo) { try { await notes.create(t.path, t.content); n++; } catch (e) { if (e.code !== 'conflict') { toastErr(e); break; } } }
  if (n) ws.toast(`Added ${n} template${n === 1 ? '' : 's'} to templates/. Edit them like any note.`, { kind: 'success' });
}

/* Today's note: daily/<date>.md, made from templates/daily.md (or the starter) the first time. */
/* A day's new note: the daily template (or the starter), with {{docket}} from Docket's summary when it is here. */
async function dailyNoteText(day) {
  const tpl = notes.texts.get('templates/daily.md');
  let plan = '';
  try { plan = docketPlan(await ws.data.get('summary', { app: 'prioritizer' }), day); } catch { /* no Docket: plan by hand */ }
  return dailyText(day, tpl && tpl.content, plan);
}

async function openToday() {
  const day = dayOf(new Date());
  const path = dailyPath(day);
  if (!notes.files.has(path)) {
    if (!(await leaveNote())) return;
    try { await notes.create(path, await dailyNoteText(day)); }
    catch (e) { if (e.code !== 'conflict') { toastErr(e); return; } await notes.readNote(path).catch(() => null); }
  }
  await openNote(path, { focus: true });
}

/* ---------- sending action items and wins (offers.js) ---------- */

async function readSent() {
  if (!canSend) return;
  try { const env = readOffers(await ws.data.get('handoffs')); sent = sentIds(env); } catch { /* shown as not sent */ }
}

async function send(kind, line) {
  if (!ui.path) return;
  const text = editor.value;
  const it = (kind === 'task' ? actionItems(text).filter(x => !x.done) : forRapport(text)).find(x => x.line === line);
  if (!it) { ws.toast('That line changed. Try again.', { kind: 'warn' }); return; }
  const note = { path: ui.path, title: notes.index.notes.get(ui.path)?.title || stem(ui.path) };
  const day = dayOf(new Date());
  // A task: one accepted offer to Docket. For Rapport: one offer per report named, or one as yours.
  const items = kind === 'task' ? [offerFor('task', note, it.text, { day, dir })] : rapportOffers(note, it, { day, dir }).map(o => o.offer);
  try {
    for (let tries = 0; ; tries++) {
      const before = readOffers(await ws.data.get('handoffs'));
      if (!before) { ws.toast('Notes saved these by a newer version. Update Workshop to send more.', { kind: 'warn' }); return; }
      const after = items.reduce((env, item) => withOffer(env, item), before);
      ws.data.stamp(before, after);
      try { await ws.data.put('handoffs', after); sent = sentIds(after); break; }
      catch (e) { if (e.code !== 'conflict' || tries >= 2) throw e; }
    }
    ws.toast(kind === 'task' ? 'Sent to Docket as a task.' : `Sent to Rapport${items.length > 1 ? ` as ${items.length} receipts` : ''}. Accept ${items.length > 1 ? 'them' : 'it'} there.`, { kind: 'success' });
    paintChrome();
  } catch (e) { toastErr(e); }
}

/* ---------- history (history.js) ---------- */

async function showHistory() {
  if (!ui.path) return;
  if (ui.status.kind === 'dirty' || ui.status.kind === 'saving') await saveNow();
  const path = ui.path;
  const versions = notes.history(path);
  if (!versions.length) return;
  let pick = 0;
  const texts = new Map();
  const textOf = async (k) => { if (!texts.has(k)) texts.set(k, await notes.readSnapshot(versions[k].path).catch(() => null)); return texts.get(k); };
  const paint = async () => {
    const t = await textOf(pick);
    dlg.innerHTML = historyHtml({ path, versions, pick, previewHtml: t === null ? '<p class="soft">This version could not be read.</p>' : render(t, { noLinks: true, imageUrl: () => null }) });
  };
  await paint();
  dlg.returnValue = '';
  const onPick = async (e) => { const b = e.target.closest('[data-ver]'); if (!b) return; pick = Number(b.dataset.ver); await paint(); };
  dlg.addEventListener('click', onPick);
  const how = await new Promise(resolve => { dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }); dlg.showModal(); });
  dlg.removeEventListener('click', onPick);
  if (how !== 'ok' || ui.path !== path) return;
  const t = await textOf(pick);
  if (t === null || !ui.base) return;
  // Restore over the saved text, keeping that text in history even inside the usual 5 minute spacing.
  try {
    const r = await notes.save(path, t, ui.base.mtime, { keep: true });
    editor.value = t;
    ui.base = { content: t, mtime: r.mtime };
    setStatus('saved');
  } catch (e) {
    if (e.code === 'conflict') { ui.current = e.current; setStatus(e.current ? 'conflict' : 'gone'); return; }
    toastErr(e); return;
  }
  paintChrome(); paintPreview(true);
  ws.toast('Restored. The text it replaced is in history.', { kind: 'success' });
}

/* ---------- importing a folder (vault.js) ---------- */

function pickFolder() {
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  input.setAttribute('webkitdirectory', '');
  input.addEventListener('change', () => importFiles([...input.files]));
  input.click();
}

async function importFiles(picked) {
  if (!picked.length) return;
  const byPath = new Map(picked.map(f => [f.webkitRelativePath || f.name, f]));
  const plan = planImport([...byPath].map(([path, f]) => ({ path, size: f.size })), new Set(notes.files.keys()));
  dlg.innerHTML = importHtml(plan);
  dlg.returnValue = '';
  const how = await new Promise(resolve => { dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }); dlg.showModal(); });
  if (how !== 'ok') return;
  const maps = linkMaps(plan);
  let done = 0, failed = 0;
  for (const it of plan.items) {
    const f = byPath.get(it.from);
    try {
      if (it.kind === 'note') {
        const title = baseName(it.from).replace(/\.md$/i, '');
        await notes.create(it.to, rewriteNote(await f.text(), { from: it.from, to: it.to, ...maps, title }));
      } else {
        await ws.files.write(it.to, f, { create: true });
      }
      done++;
    } catch (e) { failed++; }
  }
  await notes.load();
  ws.toast(`Imported ${done} file${done === 1 ? '' : 's'} into ${plan.root}/.${failed ? ` ${failed} could not be written.` : ''}`, { kind: failed ? 'warn' : 'success' });
}

/* ---------- Notes' own site: where notes are saved ---------- */

async function chooseFolder() {
  try { await ws.folder.choose(); } catch (e) { if (e && e.name !== 'AbortError') toastErr(e); }
}

function askPair() {
  showDialog(`<form method="dialog" class="dlg"><h2>Use Workshop on this computer</h2>
    <p>${PAIR_HELP} Notes saved in this browser stay here; download the ones you want first, then import them.</p>
    <label>Port<input type="number" name="value" min="1024" max="65535" value="4380" required></label>
    <p class="dlg-err bad" hidden></p>
    <div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Connect</button></div></form>`)
    .then(fd => {
      if (!fd) return;
      const r = pairWith(Number(fd.get('value')), { onError: m => ws.toast(m, { kind: 'error' }) });
      ws.toast(r === 'blocked' ? 'Your browser blocked the window. Allow pop-ups for this site and try again.' : 'In the window that opened, allow this site. Notes reloads once it is connected.');
    });
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
  const text = editor.value;
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
  if (!ui.path) return;
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
  // @: people from Workshop's People directory, to name who a line is about (plan 2).
  const at = dir && /(^|[\s(])@([a-z0-9._-]{0,40})$/i.exec(before);
  if (at) {
    pk.start = editor.selectionStart - at[2].length - 1;
    pk.items = peopleFor(at[2].toLowerCase());
    if (!pk.items.length) { closePicker(); return; }
    pk.pick = Math.min(pk.pick, pk.items.length - 1);
    pk.open = true;
    picker.innerHTML = pickerHtml(pk.items, pk.pick);
    picker.hidden = false;
    return;
  }
  const m = /\[\[([^\]\n[]{0,60})$/.exec(before);
  if (!m) { closePicker(); return; }
  const q = m[1].toLowerCase();
  pk.start = editor.selectionStart - m[0].length;
  pk.items = [...notes.index.notes.values()].filter(n => n.path !== ui.path && (!q || n.title.toLowerCase().includes(q) || n.path.includes(q)))
    .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1) || (a.title < b.title ? -1 : 1)).slice(0, 8)
    .concat(matchRecords(records, q));
  pk.pick = Math.min(pk.pick, Math.max(0, pk.items.length - 1));
  pk.open = true;
  picker.innerHTML = pickerHtml(pk.items, pk.pick);
  picker.hidden = false;
}
function closePicker() { pk.open = false; picker.hidden = true; }
/* People whose handle starts with q or whose name has it: reports first, then by name. Not you. */
const REL_ORDER = { report: 0, peer: 1, manager: 2, contact: 3 };
function peopleFor(q) {
  return dir.items.filter(it => !it.archived && it.kind === 'person' && it.relation !== 'self' && it.handle && (it.handle.startsWith(q) || it.name.toLowerCase().includes(q)))
    .sort((a, b) => (REL_ORDER[a.relation] ?? 4) - (REL_ORDER[b.relation] ?? 4) || a.name.localeCompare(b.name)).slice(0, 8)
    .map(p => ({ title: p.name, handle: p.handle, path: `@${p.handle} · ${RELATION_LABEL[p.relation] || 'Contact'}` }));
}
function choosePicker(k = pk.pick) {
  const n = pk.items[k];
  if (!n) { closePicker(); return; }
  const md = n.handle ? `@${n.handle} ` : n.href ? recordLink(n) : `[${n.title.replace(/[[\]]/g, '')}](${relativeLink(ui.path, n.path)})`;
  editor.setRangeText(md, pk.start, editor.selectionStart, 'end');
  closePicker();
  editor.dispatchEvent(new Event('input'));
}

/* ---------- events ---------- */

editor.addEventListener('input', () => {
  if (!ui.path) return;
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
  if ((x = el('[data-note]'))) { e.preventDefault(); await openNote(x.dataset.note, { anchor: x.dataset.anchor || null }); return; }
  if ((x = el('[data-missing]'))) { e.preventDefault(); createAt(wikiPath(x.dataset.missing), x.dataset.missing); return; }
  if ((x = el('[data-missing-path]'))) { e.preventDefault(); createAt(x.dataset.missingPath, null); return; }
  if ((x = el('[data-anchor]'))) { e.preventDefault(); if (x.dataset.line !== undefined) goToLine(Number(x.dataset.line)); else goToAnchor(x.dataset.anchor); return; }
  if ((x = el('[data-tag]'))) { e.preventDefault(); setQuery(`tag:${x.dataset.tag}`); side.querySelector('[data-search]')?.focus(); return; }
  if ((x = el('[data-app]'))) { e.preventDefault(); ws.open({ app: x.dataset.app, path: x.dataset.appPath || '' }).catch(toastErr); return; }
  if ((x = el('[data-mode]'))) { ui.mode = x.dataset.mode; store('mode', ui.mode); paintChrome(); paintPreview(true); return; }
  if (!(x = el('[data-act]'))) return;
  const act = x.dataset.act;
  if (act === 'new-note') newNote();
  else if (act === 'today') openToday();
  else if (act === 'send') send(x.dataset.kind, Number(x.dataset.line));
  else if (act === 'history') showHistory();
  else if (act === 'mark-reviewed') markReviewedNow();
  else if (act === 'review-list') { setQuery('is:review'); side.querySelector('[data-search]')?.focus(); }
  else if (act === 'import') pickFolder();
  else if (act === 'choose-folder') chooseFolder();
  else if (act === 'pair') askPair();
  else if (act === 'unpair') forgetPairing();
  else if (act === 'new-note-in') newNote(x.dataset.folder);
  else if (act === 'new-folder') newFolder();
  else if (act === 'toggle') { const f = x.dataset.folder; if (ui.closed.has(f)) ui.closed.delete(f); else ui.closed.add(f); paintChrome(); }
  else if (act === 'folder-menu') renameFolder(x.dataset.folder);
  else if (act === 'rename') renameNote();
  else if (act === 'trash') trashNote();
  else if (act === 'trash-path') trashNote(x.dataset.path);
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
/* Show a search in the sidebar's box, as if typed. */
let pendingSearch = null;
function showSearch(q) {
  setQuery(q);
  const box = side.querySelector('[data-search]');
  if (box) box.value = q;
}
side.addEventListener('input', (e) => { if (e.target.matches('[data-search]')) setQuery(e.target.value); });
side.addEventListener('keydown', (e) => {
  // Delete on a focused note in the sidebar trashes it (with the usual confirm).
  if (e.key === 'Delete' && e.target.matches('a.row[data-open]')) { e.preventDefault(); trashNote(e.target.dataset.open); return; }
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
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); openToday(); }
});

window.addEventListener('beforeunload', (e) => {
  if (ui.path && editor.value !== (ui.base && ui.base.content)) { saveNow(); e.preventDefault(); e.returnValue = ''; }
});

/* ---------- routes, commands, start ---------- */

ws.commands.register({ id: 'new', title: 'New note' });
ws.commands.register({ id: 'search', title: 'Search notes' });
ws.commands.register({ id: 'today', title: "Open today's note" });
ws.on('command', (p) => {
  if (p.id === 'reload-new' && swReload) { swReload(); return; }
  if (p.id === 'new') newNote();
  else if (p.id === 'today') openToday();
  else if (p.id === 'search') side.querySelector('[data-search]')?.focus();
});
function route(raw) {
  let path = '';
  try { path = decodeURIComponent(raw || ''); } catch { path = raw || ''; }
  if (path === 'today') { if (notes.loaded) openToday(); else pendingRoute = 'today'; return; }
  if (path === 'review') { setQuery('is:review'); return; }
  // search/<words>: Notes opened on a search (Docket's "+N" opens the notes that link to a task).
  if (path.startsWith('search/')) { const q = path.slice(7); if (notes.loaded) showSearch(q); else pendingSearch = q; return; }
  if (path && /\.md$/.test(path) && path !== ui.path) {
    if (notes.loaded) openNote(path); else pendingRoute = path;
  }
}
ws.on('route', (p) => route(p.path));
// On Notes' own site the address is the route: notes.alexisdavidson.org/#/today, #/runbooks/deploy.md.
// Inside Workshop the shell sends routes instead.
if (!ws.embedded) {
  const fromHash = () => location.hash.replace(/^#\/?/, '');
  if (fromHash()) route(fromHash());
  window.addEventListener('hashchange', () => route(fromHash()));
}
ws.on('online', async (p) => {
  if (!p.online) return;
  await notes.load();
  pickup.run();
// Senders of captures come from the manifests (ws.apps.list), without holding up the page: SENDERS is updated in
// place, then pickup runs again for any new sender.
ws.apps.list().then(apps => { const before = Object.keys(SENDERS).length; useSenders(SENDERS, apps, 'notes'); pickup.watch(); if (Object.keys(SENDERS).length > before) pickup.run(); }).catch(() => {});
  if (!ui.path) await openLast();
});
ws.on('visible', (p) => { if (!p.visible && ui.status.kind === 'dirty') saveNow(); });

paintChrome();
await notes.load();
pickup.run();
summary.schedule();
readSent().then(() => paintChrome());
if (canSend) ws.data.subscribe('handoffs', () => readSent().then(() => paintChrome()));
ws.apps.list().then(apps => { for (const a of apps) appNames[a.id] = a.name; paintPreview(true); }).catch(() => {});
if (pendingSearch !== null) { showSearch(pendingSearch); pendingSearch = null; }
if (canSend && ws.people) {
  const gotDir = (d) => { dir = d; paintChrome(); paintPreview(true); };
  ws.people.get().then(gotDir, () => {});
  ws.people.subscribe(gotDir);
}
// Other apps' records for the [[ picker (records.js), where Notes can read their summaries.
if (canSend) for (const s of SOURCES) {
  const read = () => ws.data.get('summary', { app: s.app }).then(e => { recordEnvs[s.app] = e; records = recordsFrom(recordEnvs); }, () => {});
  read();
  ws.data.subscribe('summary', read, { app: s.app });
}
async function openLast() {
  const first = pendingRoute || store('last');
  pendingRoute = null;
  if (first === 'today') { await openToday(); return; }
  if (first && notes.texts.has(first)) await openNote(first);
  else paintChrome();
}
await openLast();

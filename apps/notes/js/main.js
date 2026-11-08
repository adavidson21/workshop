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
import { DAILY, PLACEHOLDERS, PRODUCT_TPL, STARTERS, TEMPLATES, asTemplate, dailyPath, dailyText, dayOf, fill, setTemplateFields, templateFields, templateText, templatesIn } from './templates.js';
import { SECTION_IDS, notesPaths, sectionOf, visibleSections } from './sections.js';
import { createTandem, findDoc, isTandem, parseTandem, tandemPath } from './tandem.js';
import { collapseTitle, makeLink, taskText, titleEmpty, toggleTask, toggleWrap } from './edits.js';
import { createEditor } from './editor.js';
import { applySlash, slashAt, slashItems } from './slash.js';
import { formatTable } from './tables.js';
import { PRODUCTS, baselineFor, blocksToMark, changedLines, markReviewed, needsReview } from './products.js';
import { actionItems, forRapport, offerFor, offerId, rapportOffers, readOffers, sentIds, withOffer } from './offers.js';
import { planImport, linkMaps, rewriteNote } from './vault.js';
import { notesCards } from './summary-cards.js';
import { docketPlan } from './daily.js';
import { SOURCES, matchRecords, recordLink, recordsFrom } from './records.js';
import { dataUrl, inlineImages, pageHtml, wikiHtml, wikiMarkdown } from './export.js';
import { EMBED_DEPTH, embedHtml, embedSpec, expandEmbeds, sectionText } from './embeds.js';
import { noteMap, nodeAt } from './map.js';
import { esc, facts, render, headingId } from './markdown.js';
import { markDiagram, paintDiagrams, pngBytes, svgFile } from './diagrams.js';
import { KITS, blockInsert, fenceAt, kit, kitBlock, lineOf, mermaidFences } from './diagram-kits.js';
import {
  APP, MAX_FOLDERS, SEG, baseName, dirOf, freePath, isImagePath, localHref, movedPath, newNoteText, relativeLink,
  relink, resolvePath, resolveWiki, search, slugify, stem, tree, validFolder, wikiPath
} from './model.js';
import { confirmHtml, diagramPickerHtml, empty, header, mapHtml, historyHtml, importHtml, linkUpdatesHtml, panel, pickerHtml, promptHtml, sectionsHtml, sidebar } from './view.js';

const $ = (id) => document.getElementById(id);
const side = $('side'), head = $('head'), bodyEl = $('body'), preview = $('preview');
// The editor: CodeMirror behind a textarea-shaped object (editor.js), or the plain textarea if it can't load.
const editor = await createEditor($('editor'));
const emptyEl = $('empty'), panelEl = $('panel'), picker = $('picker'), dlg = $('dlg');
const sectionsEl = $('sections'), shell = $('notes'), titleHint = $('title-hint');
// Phone width: the pages list is a drawer, and there is no Split (it would be Edit). Its own remembered view.
const phoneQuery = window.matchMedia('(max-width: 760px)');
const isPhone = () => phoneQuery.matches;
const modeKey = () => (isPhone() ? 'mode-phone' : 'mode');

const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Folio');
// On Notes' own site: install as an app and work offline (shared/sw-register.js). Inside Workshop, Workshop's does.
let swReload = null;
if (!ws.embedded && window.WorkshopSw) WorkshopSw.register((msg, label, fn) => { swReload = fn; ws.toast(msg, { action: { label, command: 'reload-new' } }).catch(() => {}); });

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(`notes.${k}`); localStorage.setItem(`notes.${k}`, v); } catch { /* storage blocked */ } return null; };

const ui = {
  path: null,                 // the open note
  base: null,                 // {content, mtime}: the open note as last read or saved
  mode: 'split',
  section: SECTION_IDS.includes(store('section')) ? store('section') : 'notes',
  menu: false,                // the note's ⋯ menu is open
  drawer: false,              // phone: the pages drawer is open
  query: '', pick: 0,
  closed: new Set(),
  extraFolders: new Set(),    // folders made here that hold no note yet (hidden after a reload)
  status: { kind: 'saved' },  // saved, dirty, saving, failed, conflict, gone
  current: null               // the newer file on a conflict
};
ui.mode = savedMode();
function savedMode() {
  const m = store(modeKey());
  if (isPhone()) return ['edit', 'preview'].includes(m) ? m : 'preview';
  return ['edit', 'split', 'preview'].includes(m) ? m : 'split';
}
phoneQuery.addEventListener('change', () => { ui.mode = savedMode(); ui.drawer = false; paintChrome(); paintPreview(true); });
function setMode(m) { ui.mode = m; store(modeKey(), m); }
let found = [];
let pendingRoute = null;    // a route that came before the notes were read

const notes = createNotes(ws, { onChange: () => { paintChrome(); if (notes.loaded) summary.schedule(); }, onExternal });
// The Tandem section (tandem.js): .work documents through the opencode connector, where it runs.
const tandem = createTandem(ws, { onChange: () => { if (ui.path && isTandem(ui.path)) doc.item = (findDoc(tandem.state.items, ui.path) || {}).item || doc.item; paintChrome(); }, onModel: () => onTandemModel() });
let doc = null; // the open Tandem page: {item, busy}
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
  const tdoc = ui.path && isTandem(ui.path) ? { item: doc && doc.item, busy: tandem.busy(ui.path) } : null;
  const isTpl = ui.path && !tdoc && sectionOf(ui.path) === 'templates';
  return { notes, ui, found, tree: tree(notesPaths(notes.texts.keys()), [...ui.extraFolders]), where: whereSaved(), sent, canSend, dir,
    versions: ui.path && !tdoc ? notes.history(ui.path).length : 0, start: startOffer(), tandem: tandem.state, today: dayOf(new Date()),
    doc: tdoc, outline: tdoc ? facts(editor.value).headings : null, phone: isPhone(), hintSeen: store('hint-send') === '1',
    isStarter: isTpl && Object.prototype.hasOwnProperty.call(STARTERS, ui.path), tplFields: isTpl ? templateFields(editor.value) : null };
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
  if (!visibleSections({ tandem: tandem.state.available }).some(x => x.id === ui.section)) ui.section = 'notes';
  sectionsEl.innerHTML = sectionsHtml(st);
  side.innerHTML = sidebar(st);
  if (inSearch) { const s = side.querySelector('[data-search]'); s.focus(); s.setSelectionRange(pos, pos); }
  paintHead(st);
  panelEl.innerHTML = panel(st);
  const showing = Boolean(ui.path);
  emptyEl.hidden = showing;
  bodyEl.hidden = !showing;
  if (!showing) emptyEl.innerHTML = empty(st);
  bodyEl.className = `body mode-${ui.mode}`;
  panelEl.hidden = !ui.path;
  shell.classList.toggle('drawer-open', ui.drawer);
  shell.dataset.sec = ui.section;
  editor.readOnly = Boolean(st.doc && st.doc.busy);
  paintHint();
}
/* The header, keeping focus and the caret in a template field being typed in. */
/* A click in the header lands on the button it started on: a repaint between pointerdown and click (autosave's
   status, as the editor loses focus) would replace that button and the click would be lost. So while a pointer
   is down in the header, repaints wait, and the latest one runs once the click has been handled. */
let headHeld = false, headPending = false;
head.addEventListener('pointerdown', () => { headHeld = true; }, true);
const releaseHead = () => {
  if (!headHeld) return;
  headHeld = false;
  setTimeout(() => { if (headPending && !headHeld) { headPending = false; paintHead(); } }, 0);
};
document.addEventListener('pointerup', releaseHead, true);
document.addEventListener('pointercancel', releaseHead, true);
function paintHead(st = state()) {
  if (headHeld) { headPending = true; return; }
  headPending = false;
  const a = document.activeElement;
  const field = a && a.dataset && a.dataset.tplField;
  const pos = field ? [a.selectionStart, a.selectionEnd] : null;
  head.innerHTML = header(st);
  if (field) { const el = head.querySelector(`[data-tpl-field="${field}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos[0], pos[1]); } catch { /* fine */ } } }
  if (ui.menu) head.querySelector('.menu [role=menuitem]')?.focus();
}
/* The faint "Title" on a new note's empty first line. */
function paintHint() {
  titleHint.hidden = !(ui.path && !isTandem(ui.path) && ui.mode !== 'preview' && titleEmpty(editor.value));
}

let previewTimer = null;
function paintPreview(now = false, { force = false } = {}) {
  clearTimeout(previewTimer);
  if (!now) { previewTimer = setTimeout(() => paintPreview(true), 120); return; }
  if (ui.mode === 'edit' && !force) return;
  const from = ui.path;
  if (!from) { preview.innerHTML = ''; return; }
  const text = editor.value;
  const ix = notes.index;
  if (isTandem(from)) {
    // A Tandem page: its links are to code and other .work files, so only web links are links.
    preview.innerHTML = render(text, { noLinks: true, imageUrl: () => null, tasks: !editor.readOnly });
    paintDiagrams(preview, { key: from });
    paintCodeTools(preview);
    markCursorDiagram();
    return;
  }
  const tpl = sectionOf(from) === 'templates';
  preview.innerHTML = render(text, { ...noteCtx(from), tasks: true, placeholders: tpl ? PLACEHOLDERS : null, embed: embedder([from]) });
  paintDiagrams(preview, { key: from });
  paintCodeTools(preview);
  markCursorDiagram();
  markTandemLines(from, text);
  // Tasks already sent to Docket: Docket owns whether they are done, so their boxes are shown only.
  for (const box of preview.querySelectorAll('input[data-task]')) {
    const t = taskText(text, Number(box.dataset.task));
    if (t !== null && sent.has(offerId('task', from, t))) { box.disabled = true; box.title = 'Sent to Docket, which owns whether it is done'; }
  }
  for (const img of preview.querySelectorAll('img[data-img]')) {
    notes.imageUrl(img.dataset.img).then(url => {
      if (url) img.src = url;
      else img.replaceWith(Object.assign(document.createElement('span'), { className: 'img-note missing', textContent: `[image not found: ${img.alt || img.dataset.img}]` }));
    }, () => {});
  }
}

/* How a note's Markdown resolves its links, images, [[wikilinks]], @people and app links, from its own path. */
function noteCtx(from) {
  const ix = notes.index;
  return {
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
  };
}

/** The note an embed names, from the note it is in, or null. */
function embedTarget(spec, from) {
  const ix = notes.index;
  return spec.wiki ? (spec.target ? resolveWiki(ix.byTitle, ix.notes, spec.target) : from) : resolvePath(from, localHref(spec.target)?.path || spec.target);
}

/* Embeds (embeds.js): ![[note]] or ![[note#heading]] shows that note or section in place, read only. chain is
   the notes already being shown, so an embed never loops; two levels deep at most. */
function embedder(chain) {
  return (para) => {
    const spec = embedSpec(para);
    if (!spec) return null;
    const ix = notes.index, from = chain[chain.length - 1];
    const path = embedTarget(spec, from);
    const name = `${spec.target || 'this note'}${spec.anchor ? '#' + spec.anchor : ''}`;
    if (!path || !notes.texts.has(path)) return `<p class="embed-note missing">Nothing to embed: there is no note ${esc(name)}.</p>`;
    const title = (ix.notes.get(path) || {}).title || path;
    const head = `<div class="embed-head"><a href="#" data-note="${esc(path)}"${spec.anchor ? ` data-anchor="${esc(spec.anchor)}"` : ''} class="note-link">${esc(title)}${spec.anchor ? ` › ${esc(spec.anchor)}` : ''}</a></div>`;
    if ((chain.includes(path) && !(path === from && spec.anchor)) || chain.length > EMBED_DEPTH) return `${head}<p class="embed-note">Not shown here: it would embed ${chain.includes(path) ? 'a note inside itself' : 'too many levels deep'}.</p>`;
    const text = sectionText(notes.texts.get(path).content, spec.anchor);
    if (text === null) return `${head}<p class="embed-note missing">${esc(title)} has no heading "${esc(spec.anchor)}".</p>`;
    return `${head}<div class="embed-body">${embedHtml(render(text, { ...noteCtx(path), embed: embedder([...chain, path]) }))}</div>`;
  };
}

/* A Copy button on each code block (not diagrams: they have their own toolbar). */
function paintCodeTools(root) {
  for (const pre of root.querySelectorAll('pre[data-line]')) {
    if (pre.querySelector('.code-copy')) continue;
    const lang = pre.querySelector('code')?.dataset.lang;
    pre.insertAdjacentHTML('afterbegin', `<span class="code-tools">${lang ? `<span class="code-lang">${lang.replace(/[<>&"']/g, '')}</span>` : ''}<button type="button" class="code-copy" data-code-act="copy" title="Copy the code">Copy</button></span>`);
  }
}

/* Split view: the diagram whose fence holds the cursor is highlighted in the preview (diagram-kits.js fenceAt). */
function markCursorDiagram() {
  if (ui.mode !== 'split' || !ui.path) { markDiagram(preview, null); return; }
  const f = fenceAt(editor.value, lineOf(editor.value, editor.selectionStart));
  markDiagram(preview, f ? f.line : null);
}
// Light or dark: diagrams are drawn in the theme's colors, so draw them again.
new MutationObserver(() => paintPreview(true)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* Insert diagram: pick a kind, and its starter goes in at the cursor on lines of its own. */
async function pickDiagram() {
  if (!ui.path || editor.readOnly) return;
  dlg.innerHTML = diagramPickerHtml(KITS);
  dlg.returnValue = '';
  const id = await new Promise(resolve => { dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }); dlg.showModal(); dlg.querySelector('[data-kit]')?.focus(); });
  const k = kit(id);
  if (k) insertBlock(kitBlock(k));
}
/** A block (a diagram, a table) at the cursor on lines of its own, the cursor on its second line. */
function insertBlock(block) {
  if (ui.mode === 'preview') { setMode(isPhone() ? 'edit' : 'split'); paintChrome(); }
  const s = editor.selectionStart, e = editor.selectionEnd;
  const r = blockInsert(editor.value, s, e, block);
  editor.focus();
  editor.setRangeText(r.insert, s, e, 'start');
  editor.setSelectionRange(s + r.cursor, s + r.cursor);
  editor.dispatchEvent(new Event('input'));
  paintPreview(true);
}
/* A diagram's toolbar in the preview: edit it, or take it away as SVG or PNG (drawn light, on white). */
async function diagramAct(act, fig) {
  const src = fig.querySelector('.diagram-src code')?.textContent ?? '';
  const line = Number(fig.dataset.line);
  if (act === 'edit') {
    if (Number.isNaN(line)) return; // a diagram inside an embed belongs to the other note
    if (ui.mode === 'preview') { setMode(isPhone() ? 'edit' : 'split'); paintChrome(); paintPreview(true); }
    goToLine(line + 1);
    return;
  }
  const n = [...preview.querySelectorAll('figure.diagram')].indexOf(fig) + 1;
  const name = `${stem(ui.path || 'diagram').slice(0, 60)}-diagram-${n || 1}`;
  try {
    if (act === 'copy-svg') { await navigator.clipboard.writeText(await svgFile(src)); ws.toast('Copied the diagram as SVG.', { kind: 'success' }); }
    else if (act === 'svg') await saveFile(`${name}.svg`, await svgFile(src), 'image/svg+xml');
    else if (act === 'png') await saveFile(`${name}.png`, await pngBytes(src), 'image/png');
  } catch (e) { toastErr(e); }
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
  ui.drawer = false;
  if (ui.query.trim()) ui.query = ''; // a search result was opened: the pages come back
  if (path === ui.path) { if (line !== null) goToLine(line); if (anchor) goToAnchor(anchor); paintChrome(); return; }
  if (!(await leaveNote())) return;
  if (isTandem(path)) { await openTandem(path, { line, anchor }); return; }
  let t = notes.texts.get(path);
  if (!t) {
    try { const f = await notes.readNote(path); if (!f) { ws.toast(`There is no note ${path}.`, { kind: 'warn' }); return; } t = notes.texts.get(path); }
    catch (e) { toastErr(e); return; }
  }
  ui.path = path; ui.current = null; ui.menu = false; doc = null;
  ui.base = { content: t.content, mtime: t.mtime };
  ui.status = { kind: 'saved' };
  editor.reset(t.content);
  store('last', path);
  showSection(sectionOf(path));
  for (let d = dirOf(path); d; d = dirOf(d)) ui.closed.delete(d);
  paintChrome();
  paintPreview(true);
  if (line !== null) goToLine(line);
  else if (anchor) goToAnchor(anchor);
  else { editor.setSelectionRange(0, 0); editor.scrollTop = 0; preview.scrollTop = 0; }
  if (focus && ui.mode !== 'preview') editor.focus();
}

/* A Tandem page: read through the connector (tandem.js). base.mtime is the text it was read at. */
async function openTandem(path, { line = null, anchor = null } = {}) {
  let text;
  try { text = await tandem.read(path); } catch (e) { toastErr(e); return; }
  if (!tandem.state.loaded) await tandem.refresh();
  ui.path = path; ui.current = null; ui.menu = false;
  doc = { item: (findDoc(tandem.state.items, path) || {}).item || null };
  ui.base = { content: text, mtime: text };
  ui.status = { kind: 'saved' };
  editor.reset(text);
  store('last', path);
  showSection('tandem');
  paintChrome();
  paintPreview(true);
  if (line !== null) goToLine(line); else if (anchor) goToAnchor(anchor);
  else { editor.setSelectionRange(0, 0); editor.scrollTop = 0; preview.scrollTop = 0; }
}
/* .work changed: if the open Tandem page changed and has no edits here, load it; with edits, a conflict. */
async function onTandemModel() {
  const path = ui.path;
  if (!path || !isTandem(path)) return;
  let text;
  try { text = await tandem.read(path); } catch { if (ui.path === path) setStatus('gone'); return; }
  if (ui.path !== path || text === ui.base.content) return;
  const mine = editor.value !== ui.base.content || ['dirty', 'saving', 'failed'].includes(ui.status.kind);
  if (!mine) { editor.value = text; ui.base = { content: text, mtime: text }; setStatus('saved'); paintPreview(true); }
  else { ui.current = { content: text, mtime: text }; setStatus('conflict'); }
}
function showSection(id) {
  if (ui.section === id) return;
  ui.section = id; store('section', id);
}

/** Save before leaving the open note. False if the user should stay (a conflict or failure to look at). */
async function leaveNote() {
  if (!ui.path) return true;
  if (ui.status.kind === 'dirty' || ui.status.kind === 'saving') await saveNow();
  if (['conflict', 'failed', 'gone'].includes(ui.status.kind)) {
    ws.toast('This note has unsaved edits. Save them or load the other version first.', { kind: 'warn' });
    return false;
  }
  await settleFresh();
  return true;
}

function goToLine(line) {
  const lines = editor.value.split('\n');
  const at = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  if (ui.mode !== 'preview') {
    editor.focus();
    editor.setSelectionRange(at, at);
    editor.revealPos(at);
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
      if (isTandem(path)) {
        if (tandem.busy(path)) throw Object.assign(new Error(`${tandem.busy(path)}. Wait until it stops.`), { code: 'busy' });
        await tandem.save(path, text, ui.base.content);
      }
      const r = isTandem(path) ? { mtime: text } : await notes.save(path, text, ui.base.mtime);
      if (ui.path !== path) return;
      ui.base = { content: text, mtime: r.mtime };
      clearTimeout(retryTimer);
      setStatus(editor.value === text ? 'saved' : 'dirty');
      if (editor.value !== text) scheduleSave();
      else if (path === QUICK) pickup.run(); // captures that waited while Quick Notes had edits
    } catch (e) {
      if (ui.path !== path) return;
      if (isTandem(path) && e.code === 'conflict' && !/working|Autopilot/.test(e.message || '')) {
        const now = await tandem.read(path).catch(() => null);
        ui.current = now === null ? null : { content: now, mtime: now };
        setStatus(now === null ? 'gone' : 'conflict');
      } else if (e.code === 'conflict' && !isTandem(path)) {
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
  paintHead();
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
  if (isTandem(path)) {
    try {
      if (how === 'take-theirs') { const t = await tandem.read(path); editor.value = t; ui.base = { content: t, mtime: t }; }
      else if (how === 'overwrite' || how === 'restore') { await tandem.save(path, mine, how === 'restore' ? undefined : cur.content); ui.base = { content: mine, mtime: mine }; }
      ui.current = null; setStatus('saved'); paintChrome(); paintPreview(true);
    } catch (e) { toastErr(e); }
    return;
  }
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
/* New note opens a blank note straight away, like any empty note: type the title on the first line. Until you
   leave it, the note is "fresh": on leaving, it is named from its title, or moved to the trash if nothing was
   written. While its body is empty, the header offers the templates (templates.js). */
const BLANK = '# \n\n';
let fresh = null; // {path, folder}
const isBlank = (text) => !String(text).replace(/^#[ \t]*$/m, '').trim();
const bodyBlank = (text) => !String(text).replace(/^\s*#[^\n]*\n?/, '').trim();

async function newNote(folder = defaultFolder()) {
  if (!(await leaveNote())) return;
  const path = freePath(new Set(notes.files.keys()), folder, 'untitled', 'md');
  try {
    await notes.create(path, BLANK);
    if (folder) ui.extraFolders.delete(folder);
    if (ui.mode === 'preview') setMode(isPhone() ? 'edit' : 'split');
    fresh = { path, folder };
    await openNote(path);
    editor.focus();
    editor.setSelectionRange(2, 2);
  } catch (e) { fresh = null; toastErr(e); }
}

/** The template offer for the open note while it is fresh and has nothing below its title, or null. */
function startOffer() {
  if (!fresh || fresh.path !== ui.path || !bodyBlank(editor.value)) return null;
  return { templates: templatesIn(notes.texts.keys(), (p) => notes.texts.get(p)?.content || '', { starters: true }) };
}

/* Replace the fresh note's text with a template, keeping the title typed so far. */
function useTemplate(tpl) {
  const src = templateText(tpl, (p) => notes.texts.get(p)?.content ?? null);
  if (!fresh || fresh.path !== ui.path || src === null) return;
  if (tpl === PRODUCT_TPL && !fresh.folder) fresh.folder = PRODUCTS; // product notes live in products/ (products.js)
  editor.value = fill(src, { title: facts(editor.value).title || '' });
  editor.dispatchEvent(new Event('input'));
  paintChrome();
  const m = /^# .*$/m.exec(editor.value);
  const at = m ? m.index + m[0].length : 0;
  editor.focus();
  editor.setSelectionRange(at, at);
}

/** On leaving a fresh note (already saved): name it from its title, or trash it if nothing was written. */
async function settleFresh() {
  if (!fresh || fresh.path !== ui.path || ui.status.kind !== 'saved') return;
  const { path, folder } = fresh;
  fresh = null;
  const text = editor.value;
  if (isBlank(text)) {
    ui.path = null; ui.base = null;
    try { await notes.trash(path); } catch { /* stays as an empty note */ }
    return;
  }
  const title = facts(text).title;
  if (!title && folder === dirOf(path)) return;
  const taken = new Set([...notes.files.keys()].filter(p => p !== path));
  const to = freePath(taken, folder, title ? slugify(title) : stem(path), 'md');
  if (to === path) return;
  try {
    await notes.create(to, text);
    try { await notes.trash(path); } catch { /* the old file stays; the new one has the text */ }
    if (ui.path === path) { ui.path = to; ui.base = { content: text, mtime: notes.texts.get(to)?.mtime ?? null }; store('last', to); }
  } catch (e) { toastErr(e); }
}

/* ---------- templates (templates.js) ---------- */

/* Open a template to change it; a starter with no file yet is written first. */
async function editTemplate(path) {
  if (!notes.files.has(path)) {
    if (!Object.prototype.hasOwnProperty.call(STARTERS, path)) return;
    if (!(await leaveNote())) return;
    try { await notes.create(path, STARTERS[path]); } catch (e) { if (e.code !== 'conflict') { toastErr(e); return; } }
  }
  if (ui.mode === 'preview') setMode(isPhone() ? 'edit' : 'split');
  await openNote(path, { focus: true });
}
async function newTemplate() {
  const form = await showDialog(promptHtml({ title: 'New template', label: 'Name', value: '', ok: 'Create', hint: 'Shown in the bar on every new note, for example Interview notes.' }), (fd) => (String(fd.get('value')).trim() ? '' : 'Give it a name.'));
  if (!form) return;
  const name = String(form.get('value')).trim();
  const path = freePath(new Set(notes.files.keys()), TEMPLATES, slugify(name, 'template'), 'md');
  if (!(await leaveNote())) return;
  try { await notes.create(path, setTemplateFields('# {{title}}\n\n{{date}}\n\n', { name })); await editTemplate(path); }
  catch (e) { toastErr(e); }
}
/* Save as template: the open note, with its title line as {{title}}, under templates/. */
async function saveAsTemplate() {
  if (!ui.path || isTandem(ui.path)) return;
  const title = notes.index.notes.get(ui.path)?.title || stem(ui.path);
  const form = await showDialog(promptHtml({ title: 'Save as template', label: 'Template name', value: title, ok: 'Save template', hint: 'New notes can start from it. This note stays as it is.' }), (fd) => (String(fd.get('value')).trim() ? '' : 'Give it a name.'));
  if (!form) return;
  const name = String(form.get('value')).trim();
  const path = freePath(new Set(notes.files.keys()), TEMPLATES, slugify(name, 'template'), 'md');
  try { await notes.create(path, asTemplate(editor.value, name)); ws.toast(`Saved the template ${name}.`, { kind: 'success', action: undefined }); paintChrome(); }
  catch (e) { toastErr(e); }
}
/* Reset to starter: the starter's text back, the current text kept in history first. */
async function resetTemplate() {
  if (!ui.path || !Object.prototype.hasOwnProperty.call(STARTERS, ui.path)) return;
  const ok = await showDialog(confirmHtml({ title: 'Reset to starter', ok: 'Reset', body: '<p>The template goes back to the starter version. What it says now is kept in History.</p>' }));
  if (!ok) return;
  if (ui.status.kind === 'dirty' || ui.status.kind === 'saving') await saveNow();
  try {
    const r = await notes.save(ui.path, STARTERS[ui.path], ui.base.mtime, { keep: true });
    editor.value = STARTERS[ui.path]; ui.base = { content: editor.value, mtime: r.mtime }; setStatus('saved');
    paintChrome(); paintPreview(true);
    ws.toast('Reset. The text it replaced is in History.', { kind: 'success' });
  } catch (e) { if (e.code === 'conflict') { ui.current = e.current; setStatus(e.current ? 'conflict' : 'gone'); } else toastErr(e); }
}
/* The template bar's Name and Description boxes write the frontmatter as you type. */
function setTemplateField(field, value) {
  const cur = templateFields(editor.value);
  cur[field] = value;
  const pos = editor.selectionStart, before = editor.value.length;
  editor.value = setTemplateFields(editor.value, cur);
  const p = Math.max(0, pos + editor.value.length - before);
  editor.setSelectionRange(p, p);
  if (ui.status.kind !== 'dirty' && ui.status.kind !== 'saving') ui.status = { kind: 'dirty' };
  scheduleSave(); paintPreview();
}
function insertPlaceholder(name) {
  if (ui.mode === 'preview') { setMode(isPhone() ? 'edit' : 'split'); paintChrome(); paintPreview(true); }
  editor.focus();
  insertAtCursor(`{{${name}}}`);
}
/* A new product note: in products/, from the product template. */
async function newProduct() {
  await newNote(PRODUCTS);
  useTemplate(PRODUCT_TPL);
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
  const list = (kind === 'task' ? actionItems(text).filter(x => !x.done) : forRapport(text));
  // line null: Send all, every one not sent yet.
  const picked = line === null ? list : list.filter(x => x.line === line);
  if (!picked.length) { ws.toast('That line changed. Try again.', { kind: 'warn' }); return; }
  const note = { path: ui.path, title: notes.index.notes.get(ui.path)?.title || stem(ui.path) };
  const day = dayOf(new Date());
  // A task: one accepted offer to Docket. For Rapport: one offer per report named, or one as yours.
  const items = picked.flatMap(it => (kind === 'task' ? [offerFor('task', note, it.text, { day, dir })] : rapportOffers(note, it, { day, dir }).map(o => o.offer))).filter(o => line !== null || !sent.has(o.id));
  if (!items.length) return;
  try {
    for (let tries = 0; ; tries++) {
      const before = readOffers(await ws.data.get('handoffs'));
      if (!before) { ws.toast('Folio saved these with a newer version. Update Workshop to send more.', { kind: 'warn' }); return; }
      const after = items.reduce((env, item) => withOffer(env, item), before);
      ws.data.stamp(before, after);
      try { await ws.data.put('handoffs', after); sent = sentIds(after); break; }
      catch (e) { if (e.code !== 'conflict' || tries >= 2) throw e; }
    }
    ws.toast(kind === 'task' ? (items.length > 1 ? `Sent ${items.length} tasks to Docket.` : 'Sent to Docket as a task.') : `Sent to Rapport${items.length > 1 ? ` as ${items.length} receipts` : ''}. Accept ${items.length > 1 ? 'them' : 'it'} there.`, { kind: 'success' });
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
    paintDiagrams(dlg.querySelector('.ver-preview'), { key: `history:${path}`, tools: false });
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
      ws.toast(r === 'blocked' ? 'Your browser blocked the window. Allow pop-ups for this site and try again.' : 'In the window that opened, allow this site. Folio reloads once it is connected.');
    });
}

async function createAt(path, title) {
  if (!path || !/\.md$/.test(path) || !validFolder(dirOf(path)) || !SEG.test(stem(path))) { ws.toast('That link does not name a note Folio can make.', { kind: 'warn' }); return; }
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
async function applyMoves(moves, label, { quiet = false } = {}) {
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
  // Nothing to choose (no links change): the first dialog was the confirm.
  const form = quiet && !updates.length ? null : await showDialog(confirmHtml({ title: label, ok: 'Move',
    body: `<ul class="moves">${list}</ul>${linkUpdatesHtml(updates, ix)}` }));
  if (!form && !(quiet && !updates.length)) return;
  const chosen = new Set(form ? form.getAll('update') : []);
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
  if (!path || isTandem(path)) return;
  const linked = (notes.index.backlinks.get(path) || []).length > 0;
  const form = await showDialog(promptHtml({ title: 'Rename or move', label: 'Path in notes/', value: path.replace(/\.md$/, ''), ok: linked ? 'Next' : 'Rename',
    hint: 'Lowercase, digits and dashes. Use / for folders, for example runbooks/deploy.' }), (fd) => {
    const r = notePathFrom(fd.get('value'));
    if (r.error) return r.error;
    if (r.path !== path && notes.files.has(r.path)) return `${r.path} already exists.`;
    return '';
  });
  if (!form) return;
  const to = notePathFrom(form.get('value')).path;
  await applyMoves(new Map([[path, to]]), 'Rename or move note', { quiet: true });
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

/* Trash right away, with Undo in the toast (it writes the note back). Asks first only when other notes link to it. */
async function trashNote(path = ui.path) {
  if (!path || isTandem(path)) return;
  const backs = (notes.index.backlinks.get(path) || []).length;
  if (backs) {
    const ok = await showDialog(confirmHtml({ title: 'Move to the trash', ok: 'Move to trash', danger: true,
      body: `<p>${backs} link${backs === 1 ? '' : 's'} in other notes will stop working. ${path} goes to the Workshop folder's <code>.trash/</code>; nothing is deleted.</p>` }));
    if (!ok) return;
  }
  if (path === ui.path && (ui.status.kind === 'dirty' || ui.status.kind === 'saving')) await saveNow();
  const text = path === ui.path ? editor.value : notes.texts.get(path)?.content;
  try {
    await notes.trash(path);
    if (ui.path === path) { ui.path = null; ui.base = null; ui.status = { kind: 'saved' }; editor.value = ''; if (fresh && fresh.path === path) fresh = null; }
    paintChrome();
    lastTrashed = text === undefined ? null : { path, text };
    ws.toast(`Moved ${baseName(path)} to the trash.`, { kind: 'success', action: lastTrashed ? { label: 'Undo', command: 'undo-trash' } : undefined }).catch(() => {});
  } catch (e) { toastErr(e); }
}
let lastTrashed = null;
async function undoTrash() {
  const t = lastTrashed;
  lastTrashed = null;
  if (!t) return;
  try {
    const path = notes.files.has(t.path) ? freePath(new Set(notes.files.keys()), dirOf(t.path), stem(t.path), 'md') : t.path;
    await notes.create(path, t.text);
    await openNote(path);
    ws.toast('Put it back.', { kind: 'success' });
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
/* Map: the note's links and backlinks as a diagram (map.js); click a note in it to open that note. */
function showMap() {
  if (!ui.path || isTandem(ui.path)) return;
  const m = noteMap(notes.index, ui.path);
  if (!m) return;
  dlg.innerHTML = mapHtml(m, (notes.index.notes.get(ui.path) || {}).title || ui.path);
  dlg.returnValue = '';
  const onClick = (e) => {
    const g = e.target.closest && e.target.closest('g.node');
    const k = g ? nodeAt(g.id) : -1;
    if (k > 0 && m.nodes[k]) { dlg.close(); openNote(m.nodes[k]); }
  };
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('close', () => dlg.removeEventListener('click', onClick), { once: true });
  dlg.showModal();
  paintDiagrams(dlg, { key: 'map', tools: false });
}

/** The data: URL of an image in the folder, or null. */
async function imageData(p) {
  if (!notes.files.has(p)) return null;
  const f = await ws.files.read(p).catch(() => null);
  return f ? dataUrl(f.content.type, new Uint8Array(await f.content.arrayBuffer())) : null;
}
/** Wait until the diagrams under root are drawn (or have errors), up to a few seconds. */
async function diagramsSettled(root, ms = 8000) {
  const end = Date.now() + ms;
  await new Promise(r => setTimeout(r, 50));
  while (Date.now() < end && root.querySelector('figure.diagram.drawing, figure.diagram.stale')) await new Promise(r => setTimeout(r, 100));
}

/* Download HTML: one self-contained page (export.js pageHtml), diagrams as SVG and images inside it. */
async function downloadHtml() {
  if (!ui.path) return;
  const text = editor.value, from = ui.path;
  try {
    const r = await inlineImages(text, from, imageData);
    const svgs = new Map();
    for (const f of mermaidFences(text)) {
      if (svgs.has(f.src)) continue;
      try { svgs.set(f.src, dataUrl('image/svg+xml', new TextEncoder().encode(await svgFile(f.src)))); } catch { /* stays as its code */ }
    }
    const title = isTandem(from) ? stem(from) : (notes.index.notes.get(from) || {}).title || stem(from);
    await saveFile(`${stem(from).slice(0, 100)}.html`, pageHtml(r.markdown, { title, diagrams: svgs, embed: isTandem(from) ? null : embedder([from]) }), 'text/html');
  } catch (e) { toastErr(e); }
}

/* Print or save as PDF: the preview alone, in the light theme, once its diagrams are drawn (print CSS in notes.css). */
async function printNote() {
  if (!ui.path) return;
  const root = document.documentElement, dark = root.dataset.theme === 'dark';
  if (dark) root.dataset.theme = 'light';
  paintPreview(true, { force: true });
  await diagramsSettled(preview);
  root.classList.add('printing');
  const done = () => { root.classList.remove('printing'); if (dark) root.dataset.theme = 'dark'; if (ui.mode === 'edit') preview.innerHTML = ''; };
  window.addEventListener('afterprint', done, { once: true });
  window.print();
}

async function copyForWiki() {
  if (!ui.path) return;
  const text = editor.value, from = ui.path;
  const built = (async () => {
    // Embeds become their text (with their own images inside), each relative to its own note.
    const images = new Set(), missing = new Set();
    let embeds = 0;
    const tally = (r) => { r.embedded.forEach(p => images.add(p)); r.missing.forEach(p => missing.add(p)); return r.markdown; };
    const expanded = isTandem(from) ? text : await expandEmbeds(text, from, async (spec, at) => {
      const path = embedTarget(spec, at);
      const t = path && notes.texts.get(path);
      const section = t ? sectionText(t.content, spec.anchor) : null;
      if (section === null) return null;
      embeds++;
      return { path, text: tally(await inlineImages(section, path, imageData)) };
    });
    const markdown = tally(await inlineImages(wikiMarkdown(expanded), from, imageData));
    // Diagrams: a picture in the HTML; the Markdown keeps each ```mermaid block for editors that draw it.
    const pngs = new Map();
    let diagrams = 0;
    for (const f of mermaidFences(markdown)) {
      if (pngs.has(f.src)) continue;
      try { pngs.set(f.src, dataUrl('image/png', await pngBytes(f.src))); diagrams++; } catch { /* stays as its code */ }
    }
    return { markdown, html: wikiHtml(markdown, pngs), images: images.size, diagrams, embeds, missing: [...missing] };
  })();
  const done = (r) => {
    const n = (k, one) => `${r[k]} ${one}${r[k] === 1 ? '' : 's'}`;
    const parts = [r.images && n('images', 'image'), r.diagrams && n('diagrams', 'diagram'), r.embeds && n('embeds', 'embedded section')].filter(Boolean);
    const msg = `Copied for the wiki${parts.length ? ` with ${parts.join(', ')}` : ''}.`;
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
  // / at the start of a line: the slash menu (slash.js).
  const sl = editor.selectionStart === editor.selectionEnd && !isTandem(ui.path || '') ? slashAt(editor.value, editor.selectionStart) : null;
  if (sl) {
    pk.start = sl.start;
    pk.items = slashItems(sl.query).map(x => ({ title: x.title, path: x.hint, slash: x }));
    if (!pk.items.length) { closePicker(); return; }
    pk.pick = Math.min(pk.pick, pk.items.length - 1);
    pk.open = true;
    picker.innerHTML = pickerHtml(pk.items, pk.pick);
    picker.hidden = false;
    return;
  }
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
  // [[note#heading, or [[#heading in this note: link to a heading.
  if (q.includes('#')) {
    pk.items = headingsFor(q.slice(0, q.indexOf('#')).trim(), q.slice(q.indexOf('#') + 1).trim());
    if (!pk.items.length) { closePicker(); return; }
    pk.pick = Math.min(pk.pick, pk.items.length - 1);
    pk.open = true;
    picker.innerHTML = pickerHtml(pk.items, pk.pick);
    picker.hidden = false;
    return;
  }
  pk.items = [...notes.index.notes.values()].filter(n => n.path !== ui.path && (!q || n.title.toLowerCase().includes(q) || n.path.includes(q)))
    .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1) || (a.title < b.title ? -1 : 1)).slice(0, 8)
    .concat(matchRecords(records, q));
  pk.pick = Math.min(pk.pick, Math.max(0, pk.items.length - 1));
  pk.open = true;
  picker.innerHTML = pickerHtml(pk.items, pk.pick);
  picker.hidden = false;
}
function closePicker() { pk.open = false; picker.hidden = true; }
/* Headings for [[note#: the note named by title or path (this one when empty), filtered by the text after #. */
function headingsFor(noteQ, headQ) {
  const ix = notes.index;
  let n = null;
  if (!noteQ) n = ix.notes.get(ui.path) || { path: ui.path, title: 'This note', headings: facts(editor.value).headings };
  else {
    const all = [...ix.notes.values()];
    n = all.find(x => x.title.toLowerCase() === noteQ || x.path === noteQ || x.path === `${noteQ}.md`)
      || all.find(x => x.title.toLowerCase().startsWith(noteQ)) || all.find(x => x.path.includes(noteQ));
  }
  if (!n) return [];
  const here = n.path === ui.path;
  const heads = (here ? facts(editor.value).headings : n.headings).filter(h => h.level > 1 || !here);
  return heads.filter(h => !headQ || h.text.toLowerCase().includes(headQ)).slice(0, 12)
    .map(h => ({ title: `${'  '.repeat(Math.max(0, h.level - 2))}${h.text}`, path: `${here ? 'This note' : n.title} › ${h.text}`, heading: { path: n.path, id: h.id, text: h.text, here } }));
}
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
  if (n.slash) {
    const r = applySlash(editor.value, pk.start, editor.selectionStart, n.slash, { day: dayOf(new Date()) });
    editor.setRangeText(r.insert, r.from, r.to, 'start');
    editor.setSelectionRange(r.cursor, r.cursor);
    closePicker();
    editor.dispatchEvent(new Event('input'));
    return;
  }
  const md = n.handle ? `@${n.handle} ` : n.href ? recordLink(n)
    : n.heading ? `[${n.heading.text.replace(/[[\]]/g, '')}](${n.heading.here ? '' : relativeLink(ui.path, n.heading.path)}#${n.heading.id})`
    : `[${n.title.replace(/[[\]]/g, '')}](${relativeLink(ui.path, n.path)})`;
  editor.setRangeText(md, pk.start, editor.selectionStart, 'end');
  closePicker();
  editor.dispatchEvent(new Event('input'));
}

/* ---------- events ---------- */

editor.addEventListener('input', () => {
  if (!ui.path) return;
  if (editor.readOnly) return;
  // "# # Title" on a new note's first line (it starts with "# "): one heading marker.
  if (!isTandem(ui.path) && editor.selectionStart < 40) {
    const c = collapseTitle(editor.value);
    if (c.shift !== null) { const pos = editor.selectionStart; editor.value = c.text; const p = Math.max(2, pos - c.shift); editor.setSelectionRange(p, p); }
  }
  paintHint();
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
  // The plain textarea's Tab (CodeMirror indents and outdents lists itself).
  if (!editor.isCodeMirror && e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); insertAtCursor('  '); return; }
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (!mod || editor.readOnly) return;
  if (!e.shiftKey && !e.altKey && key === 'b') { e.preventDefault(); applyEdit(toggleWrap(editor.value, editor.selectionStart, editor.selectionEnd, '**')); }
  else if (!e.shiftKey && !e.altKey && key === 'i') { e.preventDefault(); applyEdit(toggleWrap(editor.value, editor.selectionStart, editor.selectionEnd, '*')); }
  else if (!e.shiftKey && !e.altKey && key === 'k') { e.preventDefault(); applyEdit(makeLink(editor.value, editor.selectionStart, editor.selectionEnd)); }
  else if (e.shiftKey && !e.altKey && key === 'k') { e.preventDefault(); applyEdit(toggleWrap(editor.value, editor.selectionStart, editor.selectionEnd, '`')); }
  else if (e.altKey && !e.shiftKey && (key === 't' || e.code === 'KeyT')) { e.preventDefault(); formatTableNow(); }
});
/** An edit from edits.js ({from, to, insert, selFrom, selTo}), undoable in CodeMirror. */
function applyEdit(r) {
  editor.setRangeText(r.insert, r.from, r.to, 'start');
  editor.setSelectionRange(r.selFrom, r.selTo);
  editor.dispatchEvent(new Event('input'));
}
/* Format table: line up the columns of the table the cursor is in (tables.js). */
function formatTableNow() {
  if (!ui.path || editor.readOnly) return;
  const line = lineOf(editor.value, editor.selectionStart);
  const next = formatTable(editor.value, line);
  if (next === null) { ws.toast('Put the cursor in a table first.', { kind: 'warn' }); return; }
  if (next === editor.value) return;
  const col = editor.selectionStart - (editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1);
  editor.value = next;
  const lines = next.split('\n');
  const at = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + Math.min(col, lines[line].length);
  editor.setSelectionRange(at, at);
  editor.dispatchEvent(new Event('input'));
}
for (const ev of ['keyup', 'click']) editor.addEventListener(ev, () => markCursorDiagram());
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
  // The ⋯ menu closes on any click outside it (its own items act below).
  if (ui.menu && !el('.menu-wrap')) { ui.menu = false; paintHead(); }
  if ((x = el('[data-code-act=copy]'))) {
    e.preventDefault();
    const code = x.closest('pre')?.querySelector('code')?.textContent ?? '';
    navigator.clipboard.writeText(code).then(() => { x.textContent = 'Copied'; setTimeout(() => { if (x.isConnected) x.textContent = 'Copy'; }, 1200); }, toastErr);
    return;
  }
  if ((x = el('[data-diagram-act]'))) { e.preventDefault(); const fig = x.closest('figure.diagram'); if (fig) diagramAct(x.dataset.diagramAct, fig); return; }
  if ((x = el('[data-section]'))) { showSection(x.dataset.section); ui.query = ''; ui.drawer = isPhone(); paintChrome(); if (ui.section === 'tandem') tandem.refresh(); return; }
  if ((x = el('input[data-task]'))) { e.preventDefault(); toggleTaskAt(Number(x.dataset.task)); return; }
  if ((x = el('[data-edit-template]'))) { e.preventDefault(); editTemplate(x.dataset.editTemplate); return; }
  if ((x = el('[data-open]'))) { e.preventDefault(); await openNote(x.dataset.open, { line: x.dataset.line !== undefined ? Number(x.dataset.line) : null }); return; }
  if ((x = el('[data-note]'))) { e.preventDefault(); await openNote(x.dataset.note, { anchor: x.dataset.anchor || null }); return; }
  if ((x = el('[data-missing]'))) { e.preventDefault(); createAt(wikiPath(x.dataset.missing), x.dataset.missing); return; }
  if ((x = el('[data-missing-path]'))) { e.preventDefault(); createAt(x.dataset.missingPath, null); return; }
  if ((x = el('[data-anchor]'))) { e.preventDefault(); if (x.dataset.line !== undefined) goToLine(Number(x.dataset.line)); else goToAnchor(x.dataset.anchor); return; }
  if ((x = el('[data-tag]'))) { e.preventDefault(); setQuery(`tag:${x.dataset.tag}`); side.querySelector('[data-search]')?.focus(); return; }
  if ((x = el('[data-app]'))) { e.preventDefault(); ws.open({ app: x.dataset.app, path: x.dataset.appPath || '' }).catch(toastErr); return; }
  if ((x = el('[data-mode]'))) { setMode(x.dataset.mode); paintChrome(); paintPreview(true); return; }
  if (e.target.classList && e.target.classList.contains('scrim')) { ui.drawer = false; paintChrome(); return; }
  if (!(x = el('[data-act]'))) return;
  const act = x.dataset.act;
  if (x.closest('.menu')) { ui.menu = false; paintHead(); }
  if (act === 'menu') { ui.menu = !ui.menu; paintHead(); return; }
  if (act === 'drawer') { ui.drawer = !ui.drawer; paintChrome(); return; }
  if (act === 'new-note') newNote();
  else if (act === 'today') openToday();
  else if (act === 'send') send(x.dataset.kind, Number(x.dataset.line));
  else if (act === 'send-all') send(x.dataset.kind, null);
  else if (act === 'edit-template') editTemplate(x.dataset.tpl);
  else if (act === 'new-template') newTemplate();
  else if (act === 'save-template') saveAsTemplate();
  else if (act === 'reset-template') resetTemplate();
  else if (act === 'insert-ph') insertPlaceholder(x.dataset.ph);
  else if (act === 'new-product') newProduct();
  else if (act === 'tandem-refresh') tandem.refresh().then(() => ws.toast('Read .work again.'));
  else if (act === 'open-dispatch') openDispatch();
  else if (act === 'hint-seen') { store('hint-send', '1'); paintChrome(); }
  else if (act === 'history') showHistory();
  else if (act === 'mark-reviewed') markReviewedNow();
  else if (act === 'review-list') { setQuery('is:review'); side.querySelector('[data-search]')?.focus(); }
  else if (act === 'import') pickFolder();
  else if (act === 'choose-folder') chooseFolder();
  else if (act === 'pair') askPair();
  else if (act === 'unpair') forgetPairing();
  else if (act === 'new-note-in') newNote(x.dataset.folder);
  else if (act === 'use-template') useTemplate(x.dataset.tpl);
  else if (act === 'new-folder') newFolder();
  else if (act === 'toggle') { const f = x.dataset.folder; if (ui.closed.has(f)) ui.closed.delete(f); else ui.closed.add(f); paintChrome(); }
  else if (act === 'folder-menu') renameFolder(x.dataset.folder);
  else if (act === 'rename') renameNote();
  else if (act === 'trash') trashNote();
  else if (act === 'trash-path') trashNote(x.dataset.path);
  else if (act === 'copy') copyMarkdown();
  else if (act === 'copy-wiki') copyForWiki();
  else if (act === 'insert-diagram') pickDiagram();
  else if (act === 'format-table') formatTableNow();
  else if (act === 'map') showMap();
  else if (act === 'download-html') downloadHtml();
  else if (act === 'print') printNote();
  else if (act === 'download') download();
  else if (act === 'retry') { ui.status = { kind: 'dirty' }; saveNow(); }
  else if (['take-theirs', 'keep-copy', 'overwrite', 'restore'].includes(act)) resolveConflict(act);
});

// The template offer keeps focus in the editor: a blur would save, repaint the header and lose the click.
head.addEventListener('mousedown', (e) => { if (e.target.closest('[data-act=use-template], [data-act=insert-ph]')) e.preventDefault(); });
head.addEventListener('input', (e) => { const f = e.target.dataset && e.target.dataset.tplField; if (f) setTemplateField(f, e.target.value); });
head.addEventListener('keydown', (e) => {
  // The ⋯ menu: arrows move, Escape closes and returns to its button.
  const items = [...head.querySelectorAll('.menu [role=menuitem]')];
  if (!items.length) return;
  const k = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(k + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ui.menu = false; paintHead(); head.querySelector('[data-act=menu]')?.focus(); }
});
// Double-click the preview to write there: Edit (or Split on a wide screen), the cursor on that line.
preview.addEventListener('dblclick', (e) => {
  if (!ui.path || e.target.closest('a, input, button')) return;
  const blk = e.target.closest('[data-line]');
  const line = blk ? Number(blk.dataset.line) : 0;
  if (ui.mode === 'preview') { setMode(isPhone() ? 'edit' : 'split'); paintChrome(); paintPreview(true); }
  window.getSelection()?.removeAllRanges();
  goToLine(line);
});
/* A box ticked in the preview: flip that line and save like any edit (history, conflict check). */
function toggleTaskAt(line) {
  if (!ui.path || editor.readOnly || ['conflict', 'gone'].includes(ui.status.kind)) return;
  const next = toggleTask(editor.value, line);
  if (next === null) return;
  editor.value = next;
  if (ui.status.kind !== 'dirty' && ui.status.kind !== 'saving') setStatus('dirty');
  saveNow();
  paintPreview(true);
}
function openDispatch() {
  const d = parseTandem(ui.path);
  if (!d) return;
  const it = doc && doc.item;
  ws.open({ app: 'agents', path: it && it.id ? String(it.id) : d.folder }).catch(toastErr);
}

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
  if (e.key === 'Escape' && (ui.menu || ui.drawer) && !dlg.open) { ui.menu = false; ui.drawer = false; paintChrome(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); side.querySelector('[data-search]')?.focus(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); const order = isPhone() ? ['edit', 'preview'] : ['edit', 'split', 'preview']; setMode(order[(order.indexOf(ui.mode) + 1) % order.length]); paintChrome(); paintPreview(true); return; }
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
ws.commands.register({ id: 'diagram', title: 'Insert diagram' });
ws.on('command', (p) => {
  if (p.id === 'reload-new' && swReload) { swReload(); return; }
  if (p.id === 'undo-trash') { undoTrash(); return; }
  if (p.id === 'new') newNote();
  else if (p.id === 'today') openToday();
  else if (p.id === 'diagram') pickDiagram();
  else if (p.id === 'search') side.querySelector('[data-search]')?.focus();
});
function route(raw) {
  let path = '';
  try { path = decodeURIComponent(raw || ''); } catch { path = raw || ''; }
  if (path === 'today') { if (notes.loaded) openToday(); else pendingRoute = 'today'; return; }
  if (path === 'review') { showSection('products'); setQuery('is:review'); return; }
  // tandem/<folder>/<file>: a Tandem document (Dispatch's Open in Notebook, to be renamed Open in Folio).
  if (path.startsWith('tandem/')) { const d = parseTandem(path.slice(7)); if (d) { const t = tandemPath(d.folder, d.file); if (notes.loaded) openNote(t); else pendingRoute = t; } return; }
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
tandem.refresh();
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
  if (first && (notes.texts.has(first) || isTandem(first))) await openNote(first);
  else paintChrome();
}
await openLast();

/* Notes: HTML for the page. Pure functions of state; every piece of note text is escaped here or by
   markdown.js. main.js owns events and the editor. */
import { esc, plainText } from './markdown.js';
import { age, baseName, dirOf, stem } from './model.js';
import { QUICK, QUICK_TITLE } from './pickup.js';
import { actionItems, forRapport, handlesIn, offerId, rapportOffers, readable, whoOf } from './offers.js';
import { needsReview, productNotes, toReview } from './products.js';
import { SECTIONS, dailyGroups, visibleSections } from './sections.js';
import { PLACEHOLDERS, placeholdersFor, templatesIn } from './templates.js';
import { docName, findDoc, groupItems, itemLabel, parseTandem, tandemPath } from './tandem.js';
import { lensLabel } from './lenses.js';

const ICON = {
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M9.3 1.8V5h3.2"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.8 3.5h4.4l1.4 1.6h6.6v8H1.8z"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6 1.8h4l-.6 4.2 2.4 2.4H4.2l2.4-2.4zM8 8.4v5.8"/></svg>',
  today: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/><path d="M6.6 10.2l1.1 1.1 2-2.2"/></svg>',
  tandem: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 1.8l1.6 3.6 3.6 1.6-3.6 1.6L8 12.2 6.4 8.6 2.8 7l3.6-1.6z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2.5 4.2h11M6.2 4.2V2.6h3.6v1.6M3.8 4.2l.7 9.4h7l.7-9.4M6.6 6.8v4.4M9.4 6.8v4.4"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M10.8 2.6l2.6 2.6-7.6 7.6-3.2.6.6-3.2z"/></svg>',
  menu: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  sideL: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6"/><path d="M6 2.5v11"/></svg>',
  sideR: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6"/><path d="M10 2.5v11"/></svg>',
  drawer: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="5.2" y="5.2" width="8.6" height="8.6" rx="1.5"/><path d="M10.8 5.2V3.6a1.4 1.4 0 0 0-1.4-1.4H3.6a1.4 1.4 0 0 0-1.4 1.4v5.8a1.4 1.4 0 0 0 1.4 1.4h1.6"/></svg>',
  chev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>'
};

/* ---------- sidebar ---------- */

/* The trash button on a note's row: shows on hover or focus, beside the link (a button cannot go inside it). */
const trashBtn = (p, title) => `<button class="ibtn mini row-trash" data-act="trash-path" data-path="${esc(p)}" title="Move to the trash" aria-label="Move ${esc(title)} to the trash">${ICON.trash}</button>`;

/* ---------- section tabs (sections.js) ---------- */

export function sectionsHtml(state) {
  const { ui, notes, tandem } = state;
  const shown = visibleSections({ tandem: tandem.available });
  const badge = (id) => {
    if (id === 'products' && notes.loaded) { const n = toReview(notes.index).length; return n ? `<span class="sec-badge" title="${n} changed by Tandem since your last review">${n}</span>` : ''; }
    if (id === 'tandem') { const n = tandem.items.filter(i => i.review).length; return n ? `<span class="sec-badge" title="${n} waiting on your review">${n}</span>` : ''; }
    return '';
  };
  const sideOpen = !ui.sideClosed;
  return `<button class="ibtn drawer-btn" data-act="drawer" aria-label="Pages" title="Pages">${ICON.drawer}</button>
    <button class="ibtn fold-btn side-btn" data-act="side" aria-pressed="${sideOpen}" aria-label="${sideOpen ? 'Hide' : 'Show'} the pages list" title="${sideOpen ? 'Hide' : 'Show'} the pages list (Ctrl+\\)">${ICON.sideL}</button>
    <p class="nb-name">Folio</p>
    <div class="sec-tabs" role="tablist" aria-label="Sections">${shown.map(s => `<button role="tab" class="sec sec-${s.id}${ui.section === s.id ? ' on' : ''}" aria-selected="${ui.section === s.id}" data-section="${s.id}" title="${esc(s.hint)}"><span class="sec-dot" aria-hidden="true"></span>${esc(s.name)}${badge(s.id)}</button>`).join('')}</div>`;
}
/* The page panel's fold button (outline, backlinks, tags). Folio 4.0.0: in the note's header, not the section tabs. */
function panelBtn(ui) {
  const panelOpen = !ui.panelClosed;
  return `<button class="ibtn fold-btn panel-btn" data-act="panel" aria-pressed="${panelOpen}" aria-label="${panelOpen ? 'Hide' : 'Show'} the page panel" title="${panelOpen ? 'Hide' : 'Show'} outline, backlinks and tags (Ctrl+Shift+\\)">${ICON.sideR}</button>`;
}

/* ---------- sidebar: the open section's pages ---------- */

export function sidebar(state) {
  const { notes, ui } = state;
  const q = ui.query;
  const sec = SECTIONS.find(s => s.id === ui.section) || SECTIONS[0];
  const body = q.trim() ? results(state) : sectionBody(state);
  return `
    <div class="side-head">
      <p class="eyebrow">${esc(sec.name)}</p>
      <div class="side-actions">${sideActions(ui.section)}</div>
    </div>
    <label class="search"><span class="sr">Search notes</span>
      <input type="search" data-search value="${esc(q)}" placeholder="Search" autocomplete="off" spellcheck="false">
    </label>
    ${q.trim() || ui.section !== 'notes' ? '' : pinnedHtml(state)}
    <nav class="side-body" aria-label="${q.trim() ? 'Search results' : esc(sec.name)}">${body}</nav>
    ${notes.error ? `<p class="side-note bad">${esc(notes.error)}</p>` : ''}
    ${ui.section === 'notes' ? footHtml(state) : ''}`;
}
function sideActions(section) {
  const b = (act, title, icon, extra = '') => `<button class="ibtn" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}"${extra}>${icon}</button>`;
  if (section === 'daily') return b('today', "Today's note (T)", ICON.today) + b('new-note', 'New note (N)', ICON.plus);
  if (section === 'products') return b('new-product', 'New product note', ICON.plus);
  if (section === 'templates') return b('new-template', 'New template', ICON.plus);
  if (section === 'tandem') return b('tandem-refresh', 'Read .work again', ICON.refresh);
  return b('today', "Today's note (T)", ICON.today) + b('new-note', 'New note (N)', ICON.plus) + b('new-folder', 'New folder', ICON.folder);
}
function sectionBody(state) {
  const { ui } = state;
  if (ui.section === 'daily') return dailyHtml(state);
  if (ui.section === 'products') return productsHtml(state);
  if (ui.section === 'templates') return templatesHtml(state);
  if (ui.section === 'tandem') return tandemHtml(state);
  return treeHtml(state);
}
const pageRow = (path, title, cur, extra = '', trash = true) => `<li class="note${cur ? ' current' : ''}" data-path="${esc(path)}"><a class="row" href="#" data-open="${esc(path)}" style="--d:0"${cur ? ' aria-current="page"' : ''}><span class="name">${esc(title)}</span>${extra}</a>${trash ? trashBtn(path, title) : ''}</li>`;

function dailyHtml(state) {
  const { notes, ui, today } = state;
  if (!notes.loaded) return '<p class="side-note">Loading notes.</p>';
  const groups = dailyGroups(notes.texts.keys());
  const has = groups.some(g => g.days.some(d => d.day === today));
  const todayRow = has ? '' : `<ul class="tree"><li class="note"><a class="row" href="#" data-act="today" style="--d:0"><span class="name">Today</span><span class="soft small">new</span></a></li></ul>`;
  if (!groups.length) return `${todayRow}<p class="side-note">One note per day, made from the daily template. Press <kbd>T</kbd> any time.</p>`;
  return todayRow + groups.map(g => `<p class="section-label month">${esc(g.month)}</p><ul class="tree">${g.days.map(d => pageRow(d.path, d.day === today ? `${d.label} · Today` : d.label, ui.path === d.path)).join('')}</ul>`).join('');
}
/* The sidebar's foot: bring in a folder of Markdown, and on Notes' own site, where notes are saved. */
function footHtml(state) {
  const { where } = state;
  return `<div class="side-foot">
    ${where ? `<p class="where"><span class="mono soft">Saved</span> ${esc(where.text)}</p>
      <div class="foot-acts">${where.canFolder ? '<button class="btn ghost small" data-act="choose-folder">Choose folder</button>' : ''}${where.canPair ? '<button class="btn ghost small" data-act="pair">Use Workshop on this computer</button>' : ''}${where.paired ? '<button class="btn ghost small" data-act="unpair">Disconnect</button>' : ''}</div>` : ''}
    <button class="btn ghost small" data-act="import" title="Bring in a folder of Markdown, such as an Obsidian vault">Import a folder</button>
  </div>`;
}

/* Pinned: Quick Notes, where Home's note captures go (pickup.js), always at the top once it exists. */
export const PINNED = [QUICK];
function pinnedHtml(state) {
  const { notes, ui } = state;
  const pins = PINNED.filter(p => notes.texts.has(p));
  if (!notes.loaded || !pins.length) return '';
  return `<nav class="pinned" aria-label="Pinned"><p class="section-label">Pinned</p><ul class="tree">${pins.map(p => {
    const n = notes.index.notes.get(p);
    const cur = ui.path === p;
    return `<li class="note${cur ? ' current' : ''}" data-path="${esc(p)}"><a class="row" href="#" data-open="${esc(p)}" style="--d:0"${cur ? ' aria-current="page"' : ''}><span class="pin">${ICON.pin}</span><span class="name">${esc(n ? n.title : QUICK_TITLE)}</span></a></li>`;
  }).join('')}</ul></nav>`;
}

/* Products: the product notes Tandem reads and writes (products.js), each marked when Tandem changed it since your
   last review, and a link to the list of notes to review (search is:review). */
const chip = '<span class="chip tandem" title="Changed by Tandem since your last review">' + ICON.tandem + '<span class="sr">Changed by Tandem</span></span>';
function productsHtml(state) {
  const { notes, ui } = state;
  if (!notes.loaded) return '<p class="side-note">Loading notes.</p>';
  const list = productNotes(notes.index);
  if (!list.length) return '<p class="side-note">One note per product, the memory Tandem reads before it works on that product. Make one with +.</p>';
  const due = toReview(notes.index).length;
  return `${due ? `<p class="section-label"><button class="linkish review-link" data-act="review-list" title="Notes Tandem changed since your last review">${due} to review</button></p>` : ''}<ul class="tree">${list.map(n => pageRow(n.path, n.title, ui.path === n.path, needsReview(n.review) ? chip : '')).join('')}</ul>`;
}

/* Templates: every template by name, the starter set included before its files exist (templates.js). */
function templatesHtml(state) {
  const { notes, ui } = state;
  if (!notes.loaded) return '<p class="side-note">Loading notes.</p>';
  const list = templatesIn(notes.texts.keys(), (p) => notes.texts.get(p)?.content || '', { starters: true });
  return `<ul class="tree">${list.map(t => {
    const cur = ui.path === t.path;
    return `<li class="note${cur ? ' current' : ''}" data-path="${esc(t.path)}"><a class="row" href="#" data-${t.builtIn ? 'edit-template' : 'open'}="${esc(t.path)}" style="--d:0" title="${esc(t.use || '')}"${cur ? ' aria-current="page"' : ''}><span class="name">${esc(t.name)}</span>${t.builtIn ? '<span class="soft small">starter</span>' : ''}</a>${t.builtIn ? '' : trashBtn(t.path, t.name)}</li>`;
  }).join('')}</ul><p class="side-note">Edit one to change what new notes start with. A starter becomes a file in <code>templates/</code> the first time you change it.</p>`;
}

/* Tandem: each run's documents, waiting-on-you first (tandem.js). */
function tandemHtml(state) {
  const { tandem, ui } = state;
  if (!tandem.loaded) return '<p class="side-note">Reading .work.</p>';
  if (!tandem.items.length) return '<p class="side-note">No documents yet. Plans, specs and reviews show here as Tandem writes them in Dispatch.</p>';
  const { review, rest } = groupItems(tandem.items);
  const group = (it) => {
    const open = ui.path && ui.path.startsWith(tandemPath(it.folder, ''));
    return `<li class="run${it.review ? ' waiting' : ''}"><details${open || it.review ? ' open' : ''}><summary class="row" style="--d:0"><span class="name" title="${esc(itemLabel(it))}">${esc(itemLabel(it))}</span>${it.busy ? `<span class="pill working" title="${esc(it.busy)}">Working</span>` : ''}</summary>
      <ul>${it.files.map(f => {
        const p = tandemPath(it.folder, f.file), cur = ui.path === p;
        return `<li class="note${cur ? ' current' : ''}"><a class="row" href="#" data-open="${esc(p)}" style="--d:1"${cur ? ' aria-current="page"' : ''}><span class="name">${esc(docName(f.file))}</span>${it.review === f.file ? '<span class="pill review" title="Waiting on your review">Review</span>' : ''}</a></li>`;
      }).join('')}</ul></details></li>`;
  };
  return `${review.length ? `<p class="section-label">Waiting on you <span class="count">${review.length}</span></p><ul class="tree runs">${review.map(group).join('')}</ul>` : ''}
    ${rest.length ? `<p class="section-label">Runs <span class="count">${rest.length}</span></p><ul class="tree runs">${rest.map(group).join('')}</ul>` : ''}`;
}

function treeHtml(state) {
  const { tree, ui, notes } = state;
  if (!notes.loaded) return '<p class="side-note">Loading notes.</p>';
  if (!tree.notes.filter(p => !PINNED.includes(p)).length && !tree.folders.length) return notes.texts.has(QUICK) ? '' : '<p class="side-note">No notes yet. Make one with <kbd>N</kbd>.</p>';
  return `<ul class="tree" role="tree">${folderItems(tree, state, 0)}</ul>`;
}
function folderItems(dir, state, depth) {
  const { ui, notes } = state;
  let h = '';
  for (const f of dir.folders) {
    const open = !ui.closed.has(f.path);
    h += `<li role="treeitem" aria-expanded="${open}" class="folder" data-folder="${esc(f.path)}" draggable="true">
      <div class="row" style="--d:${depth}"><button class="twisty${open ? ' open' : ''}" data-act="toggle" data-folder="${esc(f.path)}" aria-label="${open ? 'Close' : 'Open'} ${esc(f.name)}">${ICON.chev}</button>
      <span class="name">${esc(f.name)}</span>
      <button class="ibtn mini" data-act="new-note-in" data-folder="${esc(f.path)}" title="New note in ${esc(f.name)}" aria-label="New note in ${esc(f.name)}">${ICON.plus}</button>
      <button class="ibtn mini" data-act="folder-menu" data-folder="${esc(f.path)}" title="Rename or move folder" aria-label="Rename ${esc(f.name)}">⋯</button></div>
      ${open ? `<ul role="group">${folderItems(f, state, depth + 1)}</ul>` : ''}</li>`;
  }
  for (const p of dir.notes) {
    if (depth === 0 && PINNED.includes(p)) continue;
    const n = notes.index.notes.get(p);
    const title = n ? n.title : stem(p);
    const cur = ui.path === p;
    h += `<li role="treeitem" class="note${cur ? ' current' : ''}" data-path="${esc(p)}" draggable="true">
      <a class="row" href="#" data-open="${esc(p)}" style="--d:${depth}"${cur ? ' aria-current="page"' : ''}${n && n.use ? ` title="${esc(n.use)}"` : ''}><span class="name">${esc(title)}</span>${n && needsReview(n.review) ? chip : ''}</a>${trashBtn(p, title)}</li>`;
  }
  return h;
}

function results(state) {
  const { found, ui } = state;
  if (!found.length) return '<p class="side-note">Nothing matches. Narrow a search with <code>tag:ops</code>, <code>path:runbooks</code>, <code>lang:sql</code>, <code>has:diagram</code>, <code>has:code</code>, <code>has:task</code> or <code>is:review</code>.</p>';
  return `<ol class="results">${found.map((r, k) => `
    <li><a href="#" class="result${k === ui.pick ? ' picked' : ''}" data-open="${esc(r.path)}" data-line="${r.line}">
      <span class="r-title">${esc(r.title)}</span>
      <span class="r-path mono">${esc(r.path)}</span>
      ${r.text ? `<span class="r-line">${esc(r.text)}</span>` : ''}</a></li>`).join('')}</ol>`;
}

/* ---------- header and status ---------- */

export function header(state) {
  const { ui, notes } = state;
  if (!ui.path) return '';
  if (state.doc) return tandemHeader(state);
  const known = notes.files.get(ui.path);
  const n = notes.index.notes.get(ui.path);
  const review = n && needsReview(n.review) ? `<div class="bar tandem" role="status"><span class="bar-msg">${ICON.tandem} Changed by Tandem since your last review. Changed parts are highlighted in the preview; History has the earlier versions.</span>
      <span class="bar-acts"><button class="btn" data-act="mark-reviewed">Mark reviewed</button></span></div>` : '';
  const tpl = n && n.use !== undefined ? templateBar(state, n) : '';
  const items = [
    ['insert-diagram', 'Insert diagram'],
    ['format-table', 'Format table', 'Ctrl+Alt+T'],
    ['map', 'Map of links'],
    ['download', 'Download .md'],
    ['download-html', 'Download HTML'],
    ['print', 'Save as PDF'],
    ['rename', 'Rename or move', 'F2'],
    ...(n && n.use === undefined ? [['save-template', 'Save as template']] : []),
    ...(state.isStarter ? [['reset-template', 'Reset to starter']] : []),
    ...(state.versions ? [['history', 'History']] : []),
    ['trash', 'Move to the trash']
  ];
  return `<div class="note-head">
    <div class="crumbs"><span class="path" title="${esc(ui.path)}">${dirOf(ui.path) ? `<span class="dir">${esc(dirOf(ui.path))}/</span>` : ''}<span class="file mono">${esc(baseName(ui.path))}</span></span>
      <span class="status ${ui.status.kind}" role="status">${esc(statusText(ui.status, known))}</span></div>
    <div class="head-actions">
      ${segHtml(state)}
      <button class="ibtn" data-act="copy-wiki" title="Copy, with images, to paste into a wiki or any editor" aria-label="Copy">${ICON.copy}</button>
      <button class="ibtn trash-btn" data-act="trash" title="Move to the trash" aria-label="Trash">${ICON.trash}</button>
      ${menuHtml(ui, items)}${panelBtn(ui)}
    </div></div>
    ${conflictBar(ui) || review || tpl || startBar(state.start)}`;
}
function segHtml(state) {
  const modes = [...(state.live ? ['live'] : []), 'edit', 'preview'];
  const tips = { live: 'Formatted as you write; the Markdown shows on the line you are on', edit: 'The Markdown as it is', preview: 'Read only' };
  return `<div class="seg" role="group" aria-label="View">${modes.map(m => `<button data-mode="${m}" aria-pressed="${state.ui.mode === m}" title="${tips[m]} (Ctrl+E for the next view)">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>`;
}
/* The note's ⋯ menu: actions used less often than the ones in the header. Keyboard: arrows, Enter, Escape. */
function menuHtml(ui, items) {
  return `<div class="menu-wrap"><button class="ibtn" data-act="menu" aria-haspopup="menu" aria-expanded="${!!ui.menu}" aria-label="More" title="More">${ICON.menu}</button>
    ${ui.menu ? `<div class="menu" role="menu">${items.map(([act, label, key]) => `<button role="menuitem" data-act="${act}">${esc(label)}${key ? `<kbd>${esc(key)}</kbd>` : ''}</button>`).join('')}</div>` : ''}</div>`;
}
/* A template's bar: its name and use as plain boxes (written to the frontmatter), and the placeholders to insert. */
function templateBar(state, n) {
  const f = state.tplFields || { name: '', description: '' };
  return `<div class="bar template tpl-edit" role="group" aria-label="Template">
    <label class="tpl-f"><span>Name</span><input data-tpl-field="name" value="${esc(f.name)}" placeholder="${esc(n.title)}" autocomplete="off"></label>
    <label class="tpl-f grow"><span>Description</span><input data-tpl-field="description" value="${esc(f.description)}" placeholder="What it is for" autocomplete="off"></label>
    <span class="ph-chips" aria-label="Insert a placeholder">${placeholdersFor(state.ui.path).map(k => `<button class="ph" data-act="insert-ph" data-ph="${k}" title="${esc(PLACEHOLDERS[k])}">${k}</button>`).join('')}</span></div>`;
}
/* A Tandem document (tandem.js): read and edited in place in .work; Tandem's run owns it. */
function tandemHeader(state) {
  const { ui, doc } = state;
  const d = parseTandem(ui.path);
  const it = doc.item;
  const lock = doc.busy ? `<div class="bar warn" role="status"><span class="bar-msg">${esc(doc.busy)}. This page is read-only until it stops.</span></div>` : '';
  const gate = it && it.review === d.file ? `<div class="bar tandem" role="status"><span class="bar-msg">${ICON.tandem} Tandem is waiting for you to review this ${esc(docName(d.file).toLowerCase())}. Edit it here, then approve in Dispatch.</span>
      <span class="bar-acts"><button class="btn" data-act="open-dispatch">Open in Dispatch</button></span></div>` : '';
  return `<div class="note-head">
    <div class="crumbs"><span class="mono soft">Tandem / ${esc(it ? itemLabel(it) : d.folder)} / ${esc(d.file)}</span>
      <span class="status ${ui.status.kind}" role="status">${esc(ui.status.kind === 'saved' ? (doc.busy ? 'Read-only' : 'In .work') : statusText(ui.status, null))}</span></div>
    <div class="head-actions">
      ${state.brief ? lensSegHtml(state) : ''}${segHtml(state)}
      <button class="btn ghost" data-act="open-dispatch" title="This run in Dispatch">Open in Dispatch</button>
      ${menuHtml(ui, [['open-dispatch', 'Open in Dispatch'], ['copy', 'Copy Markdown'], ['download', 'Download .md'], ['download-html', state.brief ? 'Download brief (HTML)' : 'Download HTML']])}${panelBtn(ui)}
    </div></div>
    ${conflictBar(ui, true) || lock || gate}`;
}
/* A spike brief's lens switch: the preview shows the brief as that reader sees it. Picking one in Edit or Live opens the preview. */
function lensSegHtml(state) {
  const b = state.brief, reading = state.ui.mode === 'preview';
  return `<div class="seg lens-seg" role="group" aria-label="Read as">${b.lenses.map(l => `<button data-lens="${l}" aria-pressed="${reading && b.lens === l}" title="The brief as ${l} reads it">${lensLabel(l)}</button>`).join('')}</div>`;
}
/* A fresh, empty note (main.js newNote): its templates, the starter set included, each with a pencil to change it. */
function startBar(start) {
  if (!start) return '';
  return `<div class="bar template" role="note"><span class="bar-msg">Start from a template, or just write.</span>
      <span class="bar-acts">${start.templates.map(t => `<span class="tpl-pick"><button class="btn ghost small" data-act="use-template" data-tpl="${esc(t.path)}" title="${esc(t.use || '')}">${esc(t.name)}</button><button class="ibtn mini-on" data-act="edit-template" data-tpl="${esc(t.path)}" title="Change the ${esc(t.name)} template" aria-label="Change the ${esc(t.name)} template">${ICON.pencil}</button></span>`).join('')}</span></div>`;
}
function statusText(s, known) {
  if (s.kind === 'saving') return 'Saving';
  if (s.kind === 'dirty') return 'Edited';
  if (s.kind === 'failed') return `Not saved yet. ${s.message || ''}`.trim();
  if (s.kind === 'conflict') return 'Changed outside Folio';
  if (s.kind === 'gone') return 'Moved or trashed outside Folio';
  return known ? `Saved ${age(known.mtime)}` : '';
}
function conflictBar(ui, tandem = false) {
  if (ui.status.kind === 'failed') return `<div class="bar warn"><span class="bar-msg">Your edits are kept here.</span>
      <span class="bar-acts"><button class="btn" data-act="retry">Retry now</button></span></div>`;
  if (ui.status.kind === 'conflict') return `<div class="bar warn" role="alert"><span class="bar-msg">This page changed outside Folio since you opened it. Your edits are still here.</span>
      <span class="bar-acts"><button class="btn" data-act="take-theirs">Load the new version</button>
      ${tandem ? '' : '<button class="btn" data-act="keep-copy">Save mine as a copy</button>'}
      <button class="btn ghost" data-act="overwrite">Overwrite with mine</button></span></div>`;
  if (ui.status.kind === 'gone') return `<div class="bar warn" role="alert"><span class="bar-msg">This page was moved or trashed outside Folio. Your text is still here.</span>
      <span class="bar-acts"><button class="btn" data-act="restore">Save it again</button></span></div>`;
  return '';
}

/* ---------- side panel ---------- */

export function panel(state) {
  const { notes, ui } = state;
  if (!ui.path) return '';
  if (state.doc) return tandemPanel(state);
  const n = notes.index.notes.get(ui.path);
  const backs = notes.index.backlinks.get(ui.path) || [];
  const heads = n ? n.headings.filter(h => h.level <= 3) : [];
  const tags = [...notes.index.tags];
  const lines = (p) => (notes.texts.get(p)?.content || '').split('\n');
  return `
    <section><h2 class="section-label">Outline</h2>
      ${heads.length ? `<ul class="outline">${heads.map(h => `<li style="--l:${h.level}"><a href="#" data-line="${h.line}" data-anchor="${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ul>` : '<p class="soft small">No headings.</p>'}</section>
    <section><h2 class="section-label">Backlinks <span class="count">${backs.length}</span></h2>
      ${backs.length ? `<ul class="backlinks">${backs.map(b => {
        const from = notes.index.notes.get(b.from);
        const line = plainText((lines(b.from)[b.line] || '').trim().replace(/^([-*+]|\d+[.)]|#+|>)\s+/, ''));
        return `<li><a href="#" data-open="${esc(b.from)}" data-line="${b.line}"><span class="r-title">${esc(from ? from.title : b.from)}</span><span class="r-line">${esc(line.slice(0, 160))}</span></a></li>`;
      }).join('')}</ul>` : '<p class="soft small">No notes link here yet.</p>'}</section>
    ${sendHtml(state, n)}
    <section><h2 class="section-label">History</h2>
      ${state.versions ? `<button class="btn ghost small" data-act="history">${state.versions} earlier version${state.versions === 1 ? '' : 's'}</button>` : '<p class="soft small">Earlier versions are kept here as you edit.</p>'}</section>
    <section><h2 class="section-label">Tags</h2>
      ${tags.length ? `<ul class="all-tags">${tags.map(([t, ps]) => `<li><a href="#" class="tag${n && n.tags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}"${n && n.tags.includes(t) ? ' title="On this note"' : ''}>#${esc(t)}</a> <span class="count">${ps.length}</span></li>`).join('')}</ul>` : '<p class="soft small">Add tags with <code>#tag</code> or <code>tags: [a, b]</code> in frontmatter.</p>'}</section>`;
}

/* A Tandem page's panel: its outline and the run's other documents. */
function tandemPanel(state) {
  const { ui, doc, outline } = state;
  const it = doc.item;
  const heads = (outline || []).filter(h => h.level <= 3);
  return `
    <section><h2 class="section-label">Outline</h2>
      ${heads.length ? `<ul class="outline">${heads.map(h => `<li style="--l:${h.level}"><a href="#" data-line="${h.line}" data-anchor="${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ul>` : '<p class="soft small">No headings.</p>'}</section>
    ${it ? `<section><h2 class="section-label">In this run <span class="count">${it.files.length}</span></h2>
      <ul class="backlinks">${it.files.map(f => {
        const p = tandemPath(it.folder, f.file);
        return `<li><a href="#" data-open="${esc(p)}"${p === ui.path ? ' aria-current="page"' : ''}><span class="r-title">${esc(docName(f.file))}</span><span class="r-line mono">${esc(f.file)}</span></a></li>`;
      }).join('')}</ul></section>
    <section><h2 class="section-label">About</h2><p class="soft small">${esc(it.stage ? `Stage: ${it.stage}. ` : '')}Saved straight to <code>.work/${esc(it.folder)}/</code>, where Tandem reads it. Approving is still a step in Dispatch.</p></section>` : ''}`;
}

/* Action items and wins in the open note, each with a button that sends it (offers.js). Only where the receivers
   can read Notes' offers: inside Workshop, or paired with Workshop on this computer. */
function sendHtml(state, n) {
  const { ui, notes, sent, canSend, dir } = state;
  if (!canSend) {
    const text = notes.texts.get(ui.path)?.content || '';
    return actionItems(text).some(i => !i.done) && !state.hintSeen ? '<section class="hint"><h2 class="section-label">Action items</h2><p class="soft small">Paired with Workshop on this computer, these go to Docket in one click. Pair from <b>Use Workshop on this computer</b> at the foot of the Notes section.</p><button class="linkish small" data-act="hint-seen">Got it</button></section>' : '';
  }
  const text = notes.texts.get(ui.path)?.content || '';
  const items = actionItems(text).filter(i => !i.done);
  const rapport = forRapport(text);
  if (!items.length && !rapport.length) return '';
  const note = { path: ui.path, title: '' };
  // One line of meaning per row: the text (names put in), who it's about and the kind (muted), one button.
  const row = (it, label, ids, act, to) => {
    const done = ids.every(id => sent.has(id));
    return `<li><span class="s-text"><a href="#" class="r-line" data-line="${it.line}" data-anchor="">${esc(plainText(readable(it.text, dir)).slice(0, 160))}</a>
      ${label ? `<span class="s-who mono soft">${esc(label)}</span>` : ''}</span>
      ${done ? '<span class="pill">Sent</span>' : `<button class="btn ghost small" data-act="send" data-kind="${act}" data-line="${it.line}">${to}</button>`}</li>`;
  };
  const taskRow = (it) => {
    const who = whoOf(handlesIn(it.text), dir).people.map(p => p.name.split(/\s+/)[0]);
    return row(it, who.join(', '), [offerId('task', ui.path, it.text)], 'task', 'To Docket');
  };
  const rapportRow = (it) => {
    const { reports, others } = whoOf(it.handles, dir);
    const offers = rapportOffers(note, it, { day: '2000-01-01', dir });
    const names = reports.length ? reports.map(p => p.name.split(/\s+/)[0]).join(', ') : 'You';
    const why = !reports.length && others.length ? ` (${others[0].name.split(/\s+/)[0]} isn't a report)` : '';
    return row(it, `${names} · ${it.kind}${why}`, offers.map(o => o.offer.id), 'rapport', offers.length > 1 ? `To Rapport (${offers.length})` : 'To Rapport');
  };
  const open = (list, kind) => list.filter(it => kind === 'task' ? !sent.has(offerId('task', ui.path, it.text)) : rapportOffers(note, it, { day: '2000-01-01', dir }).some(o => !sent.has(o.offer.id))).length;
  const all = (list, kind, to) => { const n = open(list, kind); return n > 1 ? ` <button class="linkish send-all" data-act="send-all" data-kind="${kind}" title="Send every open one ${to}">Send all (${n})</button>` : ''; };
  return `${items.length ? `<section><h2 class="section-label">Action items <span class="count">${items.length}</span>${all(items, 'task', 'to Docket')}</h2>
      <ul class="sendables">${items.map(taskRow).join('')}</ul></section>` : ''}
    ${rapport.length ? `<section><h2 class="section-label">For Rapport <span class="count">${rapport.length}</span>${all(rapport, 'rapport', 'to Rapport')}</h2>
      <ul class="sendables">${rapport.map(rapportRow).join('')}</ul></section>` : ''}`;
}

/* ---------- empty states ---------- */

export function empty(state) {
  const { notes } = state;
  if (!notes.loaded && !notes.error) return '<p class="loading">Loading notes.</p>';
  if (!notes.loaded) return `<div class="engcard"><h1 class="page-title">Waiting for your notes</h1><p>${esc(notes.error)}</p></div>`;
  if (state.ui.section === 'tandem') return `<div class="engcard"><h1 class="page-title">Plans, specs and reviews</h1>
    <p>Everything Tandem writes in <code>.work</code>, by run. Open a page to read or edit it; saves go straight back to the file Tandem reads. Runs waiting on your review are at the top.</p></div>`;
  return `<div class="engcard"><h1 class="page-title">Write it down</h1>
    <p>Markdown notes, as plain <code>.md</code> files. Link notes with <kbd>[[</kbd>, tag them with <code>#tag</code>, paste images straight in.</p>
    <div class="acts"><button class="btn primary" data-act="new-note">${ICON.plus}New note <kbd>N</kbd></button><button class="btn" data-act="today">Today's note <kbd>T</kbd></button></div></div>`;
}

/* ---------- dialogs ---------- */

export function promptHtml({ title, label, value = '', hint = '', ok = 'Save', extra = '' }) {
  return `<form method="dialog" class="dlg"><h2>${esc(title)}</h2>
    <label>${esc(label)}<input name="value" value="${esc(value)}" required autocomplete="off" spellcheck="false"></label>
    ${hint ? `<p class="soft small">${esc(hint)}</p>` : ''}${extra}
    <p class="dlg-err bad" hidden></p>
    <div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(ok)}</button></div></form>`;
}

export function confirmHtml({ title, body, ok = 'OK', danger = false }) {
  return `<form method="dialog" class="dlg"><h2>${esc(title)}</h2>${body}
    <div class="dlg-actions"><button class="btn" value="cancel">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(ok)}</button></div></form>`;
}

/** The list of notes whose links a rename will change, each with a checkbox (checked by default). */
export function linkUpdatesHtml(updates, index) {
  if (!updates.length) return '<p class="soft small">No other notes link here.</p>';
  return `<fieldset class="updates"><legend>Update links in these notes</legend>
    ${updates.map(u => `<label class="check"><input type="checkbox" name="update" value="${esc(u.path)}" checked>
      <span>${esc(index.notes.get(u.path)?.title || u.path)} <span class="soft mono">${esc(u.path)}</span> <span class="count">${u.count}</span></span></label>`).join('')}</fieldset>`;
}

export function pickerHtml(items, pick) {
  if (!items.length) return '<p class="soft small pad">No note by that name. Keep typing for a [[link]].</p>';
  const first = items.findIndex(n => n.href);
  return `<ul role="listbox">${items.map((n, k) => `${k === first ? '<li class="pick-div" role="presentation">In other apps</li>' : ''}<li role="option" aria-selected="${k === pick}" data-pick="${k}"><span class="r-title">${esc(n.title)}</span> <span class="soft mono">${esc(n.href ? n.name : n.path)}</span></li>`).join('')}</ul>`;
}

/** Earlier versions of a note, newest first, with a preview of the picked one. */
export function historyHtml({ path, versions, pick, previewHtml }) {
  const when = (at) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `<form method="dialog" class="dlg wide"><h2>History</h2>
    <p class="soft small mono">${esc(path)}</p>
    <div class="history"><ul>${versions.map((v, k) => `<li><button type="button" class="ver${k === pick ? ' on' : ''}" data-ver="${k}">${esc(when(v.at))}</button></li>`).join('')}</ul>
      <article class="md ver-preview">${previewHtml}</article></div>
    <p class="soft small">Restore replaces the note's text with this version. What it says now is kept in history first.</p>
    <div class="dlg-actions"><button class="btn" value="cancel">Close</button><button class="btn primary" value="ok">Restore this version</button></div></form>`;
}

/** The import preview: every file and where it goes. */
export function importHtml(plan) {
  const shown = plan.items.slice(0, 200);
  return `<form method="dialog" class="dlg wide"><h2>Import ${plan.items.length} file${plan.items.length === 1 ? '' : 's'}</h2>
    <p class="soft small">Into <code>${esc(plan.root)}/</code>. Names follow Workshop's rules and links are updated to match. Nothing already here is changed.</p>
    <ul class="renames">${shown.map(i => `<li><span class="mono soft">${esc(i.from)}</span> <span aria-hidden="true">&rarr;</span> <span class="mono">${esc(i.to)}</span></li>`).join('')}${plan.items.length > shown.length ? `<li class="soft">and ${plan.items.length - shown.length} more</li>` : ''}</ul>
    ${plan.skipped.length ? `<p class="soft small">${plan.skipped.length} file${plan.skipped.length === 1 ? ' is' : 's are'} left out (not notes or images, hidden, or over 10 MB).</p>` : ''}
    <div class="dlg-actions"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok"${plan.items.length ? '' : ' disabled'}>Import</button></div></form>`;
}

/* Insert diagram: one button per kind (diagram-kits.js KITS); the dialog closes with the kind's id. */
export function diagramPickerHtml(kits) {
  return `<form method="dialog" class="dlg wide"><h2>Insert diagram</h2>
    <p class="soft small">A Mermaid starter goes in at the cursor as a <code>\`\`\`mermaid</code> block. Change the text and the preview redraws it.</p>
    <div class="kit-grid">${kits.map(k => `<button class="kit" value="${esc(k.id)}" data-kit="${esc(k.id)}"><b>${esc(k.name)}</b><span class="soft small">${esc(k.about)}</span></button>`).join('')}</div>
    <div class="dlg-actions"><button class="btn" value="cancel">Cancel</button></div></form>`;
}

/* Map of links: the note, what it links to and what links to it, drawn as a diagram (map.js). */
export function mapHtml(m, title) {
  const alone = m.nodes.length < 2;
  return `<form method="dialog" class="dlg wide"><h2>Map of links</h2>
    <p class="soft small">${alone ? `<b>${esc(title)}</b> has no links to or from other notes yet.` : `Notes <b>${esc(title)}</b> links to, and notes that link to it. Click one to open it.`}</p>
    ${alone ? '' : `<div class="md map-view"><figure class="diagram"><pre class="diagram-src"><code data-lang="mermaid">${esc(m.code)}</code></pre></figure></div>`}
    ${m.more ? `<p class="soft small">${m.more} more not shown.</p>` : ''}
    <div class="dlg-actions"><button class="btn" value="cancel">Close</button></div></form>`;
}

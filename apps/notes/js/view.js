/* Notes: HTML for the page. Pure functions of state; every piece of note text is escaped here or by
   markdown.js. main.js owns events and the editor. */
import { esc, plainText } from './markdown.js';
import { age, baseName, dirOf, stem } from './model.js';

const ICON = {
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M9.3 1.8V5h3.2"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.8 3.5h4.4l1.4 1.6h6.6v8H1.8z"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  chev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>'
};

/* ---------- sidebar ---------- */

export function sidebar(state) {
  const { notes, ui } = state;
  const q = ui.query;
  const body = q.trim() ? results(state) : treeHtml(state);
  return `
    <div class="side-head">
      <p class="eyebrow">Notes</p>
      <div class="side-actions">
        <button class="ibtn" data-act="new-note" title="New note (N)" aria-label="New note">${ICON.note}</button>
        <button class="ibtn" data-act="new-folder" title="New folder" aria-label="New folder">${ICON.folder}</button>
      </div>
    </div>
    <label class="search"><span class="sr">Search notes</span>
      <input type="search" data-search value="${esc(q)}" placeholder="Search, tag:x, path:folder" autocomplete="off" spellcheck="false">
    </label>
    <nav class="side-body" aria-label="${q.trim() ? 'Search results' : 'Notes'}">${body}</nav>
    ${othersHtml(state)}
    ${notes.error ? `<p class="side-note bad">${esc(notes.error)}</p>` : ''}`;
}

function treeHtml(state) {
  const { tree, ui, notes } = state;
  if (!notes.loaded) return '<p class="side-note">Loading notes.</p>';
  if (!tree.notes.length && !tree.folders.length) return '<p class="side-note">No notes yet. Make one with <kbd>N</kbd>.</p>';
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
    const n = notes.index.notes.get(p);
    const title = n ? n.title : stem(p);
    const cur = ui.path === p;
    h += `<li role="treeitem" class="note${cur ? ' current' : ''}" data-path="${esc(p)}" draggable="true">
      <a class="row" href="#" data-open="${esc(p)}" style="--d:${depth}"${cur ? ' aria-current="page"' : ''}><span class="name">${esc(title)}</span></a></li>`;
  }
  return h;
}

function results(state) {
  const { found, ui } = state;
  if (!found.length) return '<p class="side-note">Nothing matches.</p>';
  return `<ol class="results">${found.map((r, k) => `
    <li><a href="#" class="result${k === ui.pick ? ' picked' : ''}" data-open="${esc(r.path)}" data-line="${r.line}">
      <span class="r-title">${esc(r.title)}</span>
      <span class="r-path mono">${esc(r.path)}</span>
      ${r.text ? `<span class="r-line">${esc(r.text)}</span>` : ''}</a></li>`).join('')}</ol>`;
}

function othersHtml(state) {
  const { notes, ui } = state;
  if (!notes.others.length) return '';
  const open = ui.othersOpen;
  return `<details class="others"${open ? ' open' : ''}><summary class="section-label">Other apps</summary>
    <ul>${notes.others.map(o => `<li><a href="#" data-other-app="${esc(o.app)}" data-other-path="${esc(o.path)}"${ui.other && ui.other.app === o.app && ui.other.path === o.path ? ' aria-current="page"' : ''}><span class="mono">${esc(o.app)}/</span>${esc(o.path)}</a></li>`).join('')}</ul></details>`;
}

/* ---------- header and status ---------- */

export function header(state) {
  const { ui, notes } = state;
  if (ui.other) {
    return `<div class="note-head"><div class="crumbs"><span class="mono soft">${esc(ui.other.app)}/${esc(dirOf(ui.other.path))}</span></div>
      <div class="head-actions"><span class="pill">Read only</span>
      <button class="btn" data-act="copy">Copy as Markdown</button></div></div>`;
  }
  if (!ui.path) return '';
  const known = notes.files.get(ui.path);
  return `<div class="note-head">
    <div class="crumbs"><span class="mono soft">${esc(dirOf(ui.path) ? dirOf(ui.path) + '/' : '')}${esc(baseName(ui.path))}</span>
      <span class="status ${ui.status.kind}" role="status">${esc(statusText(ui.status, known))}</span></div>
    <div class="head-actions">
      <div class="seg" role="group" aria-label="View">
        ${['edit', 'split', 'preview'].map(m => `<button data-mode="${m}" aria-pressed="${ui.mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
      </div>
      <button class="btn ghost" data-act="copy-wiki" title="Copy with images, to paste into the wiki or any editor">Copy for wiki</button>
      <button class="btn ghost" data-act="copy" title="Copy the Markdown only">Copy</button>
      <button class="btn ghost" data-act="download" title="Download as .md">Download</button>
      <button class="btn ghost" data-act="rename" title="Rename or move (F2)">Rename</button>
      <button class="btn text-danger" data-act="trash" title="Move to the trash">Trash</button>
    </div></div>
    ${conflictBar(ui)}`;
}
function statusText(s, known) {
  if (s.kind === 'saving') return 'Saving';
  if (s.kind === 'dirty') return 'Edited';
  if (s.kind === 'failed') return `Not saved yet. ${s.message || ''}`.trim();
  if (s.kind === 'conflict') return 'Changed outside Notes';
  if (s.kind === 'gone') return 'Moved or trashed outside Notes';
  return known ? `Saved ${age(known.mtime)}` : '';
}
function conflictBar(ui) {
  if (ui.status.kind === 'failed') return `<div class="bar warn"><span class="bar-msg">Your edits are kept here.</span>
      <span class="bar-acts"><button class="btn" data-act="retry">Retry now</button></span></div>`;
  if (ui.status.kind === 'conflict') return `<div class="bar warn" role="alert"><span class="bar-msg">This note changed outside Notes since you opened it. Your edits are still here.</span>
      <span class="bar-acts"><button class="btn" data-act="take-theirs">Load the new version</button>
      <button class="btn" data-act="keep-copy">Save mine as a copy</button>
      <button class="btn ghost" data-act="overwrite">Overwrite with mine</button></span></div>`;
  if (ui.status.kind === 'gone') return `<div class="bar warn" role="alert"><span class="bar-msg">This note was moved or trashed outside Notes. Your text is still here.</span>
      <span class="bar-acts"><button class="btn" data-act="restore">Save it again</button></span></div>`;
  return '';
}

/* ---------- side panel ---------- */

export function panel(state) {
  const { notes, ui } = state;
  if (!ui.path || ui.other) return '';
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
    <section><h2 class="section-label">Tags</h2>
      ${tags.length ? `<ul class="all-tags">${tags.map(([t, ps]) => `<li><a href="#" class="tag${n && n.tags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}"${n && n.tags.includes(t) ? ' title="On this note"' : ''}>#${esc(t)}</a> <span class="count">${ps.length}</span></li>`).join('')}</ul>` : '<p class="soft small">Add tags with <code>#tag</code> or <code>tags: [a, b]</code> in frontmatter.</p>'}</section>`;
}

/* ---------- empty states ---------- */

export function empty(state) {
  const { notes } = state;
  if (!notes.loaded && !notes.error) return '<p class="loading">Loading notes.</p>';
  if (!notes.loaded) return `<div class="engcard"><p class="eyebrow">Notes</p><h1 class="page-title dot">Waiting for your notes</h1><p>${esc(notes.error)}</p></div>`;
  return `<div class="engcard"><p class="eyebrow">Notes</p><h1 class="page-title dot">Write it down</h1>
    <p>Markdown notes in your Workshop folder, under <code>notes/</code>. Link notes with <kbd>[[</kbd>, tag them with <code>#tag</code>, paste images straight in.</p>
    <div class="acts"><button class="btn primary" data-act="new-note">New note <kbd>N</kbd></button></div></div>`;
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
  return `<ul role="listbox">${items.map((n, k) => `<li role="option" aria-selected="${k === pick}" data-pick="${k}"><span class="r-title">${esc(n.title)}</span> <span class="soft mono">${esc(n.path)}</span></li>`).join('')}</ul>`;
}

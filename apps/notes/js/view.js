/* Notes: HTML for the page. Pure functions of state; every piece of note text is escaped here or by
   markdown.js. main.js owns events and the editor. */
import { esc, plainText } from './markdown.js';
import { age, baseName, dirOf, stem } from './model.js';
import { QUICK, QUICK_TITLE } from './pickup.js';
import { actionItems, offerId, wins } from './offers.js';

const ICON = {
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M9.3 1.8V5h3.2"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.8 3.5h4.4l1.4 1.6h6.6v8H1.8z"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6 1.8h4l-.6 4.2 2.4 2.4H4.2l2.4-2.4zM8 8.4v5.8"/></svg>',
  today: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/><path d="M6.6 10.2l1.1 1.1 2-2.2"/></svg>',
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
        <button class="ibtn" data-act="today" title="Today's note (T)" aria-label="Today's note">${ICON.today}</button>
        <button class="ibtn" data-act="new-note" title="New note (N)" aria-label="New note">${ICON.note}</button>
        <button class="ibtn" data-act="new-folder" title="New folder" aria-label="New folder">${ICON.folder}</button>
      </div>
    </div>
    <label class="search"><span class="sr">Search notes</span>
      <input type="search" data-search value="${esc(q)}" placeholder="Search, tag:x, path:folder" autocomplete="off" spellcheck="false">
    </label>
    ${q.trim() ? '' : pinnedHtml(state)}
    <nav class="side-body" aria-label="${q.trim() ? 'Search results' : 'Notes'}">${body}</nav>
    ${notes.error ? `<p class="side-note bad">${esc(notes.error)}</p>` : ''}
    ${footHtml(state)}`;
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

/* ---------- header and status ---------- */

export function header(state) {
  const { ui, notes } = state;
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
  if (!ui.path) return '';
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

/* Action items and wins in the open note, each with a button that sends it (offers.js). Only where the receivers
   can read Notes' offers: inside Workshop, or paired with Workshop on this computer. */
function sendHtml(state, n) {
  const { ui, notes, sent, canSend } = state;
  if (!canSend) return '';
  const text = notes.texts.get(ui.path)?.content || '';
  const items = actionItems(text).filter(i => !i.done);
  const ws_ = wins(text);
  if (!items.length && !ws_.length) return '';
  const row = (kind, it, to) => {
    const done = sent.has(offerId(kind, ui.path, it.text));
    return `<li><a href="#" class="r-line" data-line="${it.line}" data-anchor="">${esc(plainText(it.text).slice(0, 160))}</a>
      ${done ? `<span class="pill">Sent</span>` : `<button class="btn ghost small" data-act="send" data-kind="${kind}" data-line="${it.line}">${to}</button>`}</li>`;
  };
  return `${items.length ? `<section><h2 class="section-label">Action items <span class="count">${items.length}</span></h2>
      <ul class="sendables">${items.map(it => row('task', it, 'To Docket')).join('')}</ul></section>` : ''}
    ${ws_.length ? `<section><h2 class="section-label">Wins <span class="count">${ws_.length}</span></h2>
      <ul class="sendables">${ws_.map(it => row('win', it, 'To Rapport')).join('')}</ul></section>` : ''}`;
}

/* ---------- empty states ---------- */

export function empty(state) {
  const { notes } = state;
  if (!notes.loaded && !notes.error) return '<p class="loading">Loading notes.</p>';
  if (!notes.loaded) return `<div class="engcard"><p class="eyebrow">Notes</p><h1 class="page-title dot">Waiting for your notes</h1><p>${esc(notes.error)}</p></div>`;
  return `<div class="engcard"><p class="eyebrow">Notes</p><h1 class="page-title dot">Write it down</h1>
    <p>Markdown notes, as plain <code>.md</code> files. Link notes with <kbd>[[</kbd>, tag them with <code>#tag</code>, paste images straight in.</p>
    <div class="acts"><button class="btn primary" data-act="new-note">New note <kbd>N</kbd></button><button class="btn" data-act="today">Today's note <kbd>T</kbd></button></div></div>`;
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

/** New note: the title, and a template when there are any (templates.js). */
export function newNoteHtml({ folder, templates }) {
  const pick = templates.length ? `<label>Template<select name="template"><option value="">Blank</option>${templates.map(t => `<option value="${esc(t.path)}">${esc(t.name)}</option>`).join('')}</select></label>`
    : '<p class="soft small">No templates yet. <button class="linkish" type="submit" value="starters" formnovalidate>Add the starter set</button> (meeting, incident, ADR, runbook, retro, daily) to <code>templates/</code>.</p>';
  return promptHtml({ title: 'New note', label: 'Title', ok: 'Create', hint: folder ? `In ${folder}/. The file name comes from the title.` : 'The file name comes from the title.', extra: pick });
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

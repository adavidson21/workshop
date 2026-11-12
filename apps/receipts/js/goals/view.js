/* Rapport's Goals: the HTML. Pure functions with no DOM or SDK, so Node tests can import them. Every string from
   a file or the directory is escaped; free text goes through the escaping renderer in ../markdown.js. Class names
   start with g-, and controls use data-g-* attributes so they never clash with Receipts' data-act or 1:1s. */
import { STATUSES, quarterLabel } from './model.js';
import { render as renderMd, esc } from '../markdown.js';

const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
const pctText = p => `${Math.round(p * 100)}%`;
const TWISTY = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2.5L8 6l-4 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A progress bar (hidden from screen readers: the label says it). Empty when there is nothing to draw. */
export function bar(pct) {
  if (pct == null) return '';
  const w = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  return `<span class="g-bar${w === 100 ? ' full' : ''}" aria-hidden="true"><span style="width:${w}%"></span></span>`;
}

export function statusChip(status) {
  if (!status) return '';
  return `<span class="g-st g-st-${esc(status.replace(/\s+/g, '-'))}">${esc(status)}</span>`;
}

/** An objective's rollup as text: "62%", "62% (3 of 4 measured)" or "no KRs measured". */
export function rollupLabel(p) {
  if (!p || p.pct == null) return p && p.total ? 'no KRs measured' : 'no key results';
  return pctText(p.pct) + (p.measured < p.total ? ` (${p.measured} of ${p.total} measured)` : '');
}

/** The small form that updates one KR in place. */
export function updatePopoverHtml({ label = '', status = '' } = {}) {
  return `<form class="g-pop" data-g-kr-form autocomplete="off">
    <label>Progress<input name="progress" id="g-pop-progress" value="${esc(label)}" placeholder="40%, 18 min or done" maxlength="40"></label>
    <label>Status<select name="status">${opt('', 'None', !status)}${STATUSES.map(s => opt(s, s[0].toUpperCase() + s.slice(1), s === status)).join('')}</select></label>
    <p class="g-pop-err bad" role="alert" hidden></p>
    <div class="acts"><button type="button" class="btn" data-g-pop-cancel>Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
}

/**
 * One KR. ctx: {path, editable, popover} where popover is the open popover's {path, line} or null.
 * The progress label is a button that opens the update form when the KR can be edited.
 */
export function krRowHtml(kr, ctx = {}) {
  const p = kr.progress;
  const open = ctx.popover && ctx.popover.path === ctx.path && ctx.popover.line === kr.line;
  const label = p.label || (p.status ? '' : 'not set');
  const prog = ctx.editable
    ? `<button type="button" class="g-prog" data-g-kr="${esc(ctx.path)}" data-g-line="${kr.line}" aria-haspopup="dialog" aria-expanded="${!!open}" aria-label="Update progress: ${esc(kr.text)}, ${esc(p.label || 'not set')}${p.status ? `, ${esc(p.status)}` : ''}" tabindex="-1">${esc(label || 'set')}</button>`
    : `<span class="g-prog">${esc(label)}</span>`;
  return `<div class="g-kr${open ? ' open' : ''}">
    <span class="g-kr-tag" aria-hidden="true">KR</span>
    <span class="g-kr-text">${esc(kr.text)}</span>
    <span class="g-kr-num">${prog}${bar(p.pct)}${statusChip(p.status)}</span>
    ${kr.notes && ctx.notes !== false ? `<div class="g-notes">${renderMd(kr.notes)}</div>` : ''}
    ${open ? updatePopoverHtml({ label: p.label, status: p.status }) : ''}
  </div>`;
}

/* ---------- the tree ---------- */

/*
 * Node ids: o:<i> a team objective, s:<i>:<n> a report objective under it, ua the Not aligned group, u:<n> an
 * objective in it. KRs are rows inside their objective's item (they are leaves, so the page treats them as part
 * of it for keys: Enter on an objective opens its doc).
 */
function item({ id, level, expanded, selected, leaf, head, children }) {
  const sel = selected === id;
  return `<li role="treeitem" class="g-item lv${level}" aria-level="${level}"${leaf ? '' : ` aria-expanded="${!!expanded}"`} aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-g-node="${esc(id)}">
    <div class="g-row">${leaf ? '<span class="g-tw-gap"></span>' : `<button type="button" class="g-tw" data-g-toggle="${esc(id)}" tabindex="-1" aria-hidden="true">${TWISTY}</button>`}${head}</div>
    ${!leaf && expanded ? `<ul role="group">${children}</ul>` : ''}
  </li>`;
}

function objHead({ objective, progress, path, who = '' }) {
  return `${who ? `<span class="g-who">${esc(who)}</span>` : ''}<button type="button" class="g-otitle" data-g-open="${esc(path)}" data-g-at="${objective.line}" tabindex="-1">${esc(objective.title)}</button>
    <span class="g-onum">${bar(progress.pct)}<span class="g-olabel">${esc(rollupLabel(progress))}</span>${statusChip(progress.status)}</span>`;
}

const krList = (objective, path, popover) => objective.krs.length
  ? `<li class="g-krs" role="none"><div class="g-krbox">${objective.krs.map(k => krRowHtml(k, { path, editable: true, popover })).join('')}</div></li>` : '';

const whoName = person => person.unknown ? person.name : `${person.name || 'Unnamed'}${person.archived ? ' (archived)' : ''}`;

/**
 * The tree for one quarter.
 * s: {quarter, quarters, current, tree, hasTeam, teamPath, expanded: Set, selected, popover, loading}
 */
export function treeHtml(s) {
  const q = s.quarter;
  const pick = `<label class="g-q"><span class="sr">Quarter</span><select data-g-quarter>${s.quarters.map(k => opt(k, quarterLabel(k) + (k === s.current ? ' (this quarter)' : ''), k === q)).join('')}</select></label>`;
  const bar = `<div class="g-top">${pick}<span class="grow"></span>
    <button type="button" class="btn" data-g-expand="all">Expand all</button><button type="button" class="btn" data-g-expand="none">Collapse all</button>
    ${s.hasTeam ? `<button type="button" class="btn" data-g-open="${esc(s.teamPath)}">Team goals</button>` : ''}</div>`;
  if (s.loading) return bar + '<p class="loading">Loading goals.</p>';
  const t = s.tree;
  const ex = id => s.expanded.has(id);
  const nodes = [];
  t.team.forEach((row, i) => {
    const id = `o:${i}`;
    const kids = krList(row.objective, s.teamPath, s.popover) + row.supporters.map((sp, n) => item({
      id: `s:${i}:${n}`, level: 2, expanded: ex(`s:${i}:${n}`), selected: s.selected, leaf: !sp.objective.krs.length,
      head: objHead({ ...sp, who: whoName(sp.person) }),
      children: krList(sp.objective, sp.path, s.popover)
    })).join('');
    nodes.push(item({ id, level: 1, expanded: ex(id), selected: s.selected, leaf: !kids, head: objHead({ ...row, path: s.teamPath }), children: kids }));
  });
  if (t.unaligned.length) {
    nodes.push(item({
      id: 'ua', level: 1, expanded: ex('ua'), selected: s.selected, leaf: false,
      head: `<span class="g-group">Not aligned <span class="num soft">${t.unaligned.length}</span></span>`,
      children: t.unaligned.map((u, n) => item({
        id: `u:${n}`, level: 2, expanded: ex(`u:${n}`), selected: s.selected, leaf: !u.objective.krs.length,
        head: objHead({ ...u, who: whoName(u.person) }), children: krList(u.objective, u.path, s.popover)
      })).join('')
    }));
  }
  const empty = !s.hasTeam ? `<section class="engcard g-empty"><h2>No team goals for ${esc(quarterLabel(q))} yet.</h2>
      <p>Start from the template: a couple of objectives, each with key results you can measure. Each report's goals can then support one of them.</p>
      <p><button type="button" class="btn primary" data-g-start="team">Start team goals</button></p></section>` : '';
  const missing = t.missing.length ? `<section class="g-missing" aria-label="No goals yet">
      <h3 class="section-label">No goals yet for ${esc(quarterLabel(q))}</h3>
      <ul>${t.missing.map(p => `<li><span>${esc(p.name || 'Unnamed')}</span><button type="button" class="btn" data-g-start="${esc(p.folder)}">Start</button></li>`).join('')}</ul></section>` : '';
  const tree = nodes.length ? `<ul class="g-tree" role="tree" aria-label="Goals for ${esc(quarterLabel(q))}">${nodes.join('')}</ul>` : '';
  return bar + empty + tree + missing + (!nodes.length && !t.missing.length && s.hasTeam ? '<p class="empty">The team doc has no objectives yet. Open Team goals and add a ## heading.</p>' : '')
    + (t.unknown.length ? `<p class="soft small g-unknown">Files for people not in your reports: ${t.unknown.map(u => `<span class="num">${esc(u.path)}</span>`).join(', ')}. Their goals are under Not aligned.</p>` : '');
}

/* ---------- a doc ---------- */

export function formatCardHtml(open) {
  return `<details class="g-format"${open ? ' open' : ''} data-g-format>
    <summary>Format</summary>
    <ul>
      <li><code># Title</code> on the first line (optional).</li>
      <li><code>## Objective</code> starts an objective.</li>
      <li><code>- Key result: 40%</code> is a key result. Progress after the last <code>: </code> is a percent, a number with a unit (<code>18 min</code>) or <code>done</code>.</li>
      <li>Say where a number is going: <code>from 22 to 15 min</code>, <code>to 15</code> or <code>above 90</code>, and the bar fills.</li>
      <li>Status at the end: <code>[on track]</code>, <code>[at risk]</code>, <code>[off track]</code>, <code>[done]</code>.</li>
      <li>Indented bullets under a key result are its notes.</li>
      <li>In a report's doc, <code>Supports: Team objective</code> places it under that team objective.</li>
      <li>Anything else is ordinary Markdown.</li>
    </ul>
  </details>`;
}

/** The Supports menu: the team's objectives for the quarter, plus Not aligned. */
export function supportsMenuHtml({ current = '', options = [] }) {
  const cur = String(current).toLowerCase();
  return `<div class="g-menu" role="menu" aria-label="Supports">
    ${options.map(t => `<button type="button" role="menuitemradio" aria-checked="${t.toLowerCase() === cur}" data-g-sup="${esc(t)}">${esc(t)}</button>`).join('')}
    <button type="button" role="menuitemradio" aria-checked="${!cur}" data-g-sup="">Not aligned</button>
    ${options.length ? '' : '<p class="soft small">No team goals for this quarter yet.</p>'}
  </div>`;
}

/** Preview: the doc as cards, one per objective. */
export function previewHtml({ doc, path, isReport, teamTitles = [], popover = null, menu = null }) {
  const teamKeys = teamTitles.map(t => t.toLowerCase());
  const cards = doc.objectives.map(o => {
    const sup = isReport ? `<p class="g-sup">Supports: ${o.supports ? `<b>${esc(o.supports)}</b>` : '<span class="soft">Not aligned</span>'}${o.supports && !teamKeys.some(k => k.replace(/[.:!]+$/, '') === o.supports.toLowerCase().replace(/[.:!]+$/, '').replace(/\s+/g, ' ').trim()) ? ' <span class="soft">(no team objective by that name)</span>' : ''}
        <button type="button" class="lnk" data-g-sup-open="${o.line}" aria-haspopup="menu" aria-expanded="${menu === o.line}">Change</button></p>${menu === o.line ? supportsMenuHtml({ current: o.supports, options: teamTitles }) : ''}` : '';
    const p = o.krs.length ? o.krs.map(k => k.progress) : [];
    return `<section class="g-card" id="g-obj-${o.line}" data-g-obj="${o.line}">
      <h3 class="g-ctitle">${esc(o.title)}</h3>${sup}
      ${o.krs.length ? `<div class="g-krbox">${o.krs.map(k => krRowHtml(k, { path, editable: true, popover })).join('')}</div>` : (p.length ? '' : '<p class="soft small">No key results yet. Add bullets like <code>- Key result: 0%</code>.</p>')}
      ${o.body ? `<div class="md g-body">${renderMd(o.body)}</div>` : ''}
    </section>`;
  }).join('');
  return `${doc.title ? `<h2 class="g-dtitle">${esc(doc.title)}</h2>` : ''}
    ${doc.preamble ? `<div class="md g-body">${renderMd(doc.preamble)}</div>` : ''}
    ${cards || '<p class="soft">No objectives yet. Each <code>## heading</code> is one.</p>'}`;
}

/**
 * One owner's doc for a quarter.
 * s: {owner, ownerName, quarter, isReport, file: {path, text, mtime, dirty, saving, error, conflict, exists} or null,
 *     doc (parsed), mode: 'edit' | 'preview' | 'split', teamTitles, popover, menu, formatOpen, canCopy, loading}
 */
export function docHtml(s) {
  const f = s.file;
  const head = `<div class="g-dhead">
    <button type="button" class="btn ghost" data-g-back><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l-6 6 6 6"/></svg> Back to the tree</button>
    <div class="g-who-head"><p class="eyebrow">${esc(quarterLabel(s.quarter))}</p><h2 class="oo-title">${esc(s.ownerName)}</h2></div>
    <span class="grow"></span>
    ${f && f.exists ? `<div class="seg" role="group" aria-label="View">${['edit', 'preview', 'split'].map(m => `<button type="button" class="${s.mode === m ? 'on' : ''}" data-g-mode="${m}" aria-pressed="${s.mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
    <span class="g-status soft" role="status">${f.conflict ? '' : f.error ? `<span class="bad">Not saved yet: ${esc(f.error)}</span>` : f.saving ? 'Saving…' : f.dirty ? 'Unsaved' : 'Saved'}</span>
    <button type="button" class="btn" data-g-save${f.dirty ? '' : ' disabled'}>Save</button>` : ''}
  </div>`;
  if (s.loading || !f) return head + '<p class="loading">Loading goals.</p>';
  if (!f.exists) {
    return head + `<section class="engcard g-empty"><h2>No goals yet</h2>
      <p>${s.isReport ? `Start ${esc(s.ownerName)}'s goals for ${esc(quarterLabel(s.quarter))}. Each objective can support one of the team's.` : `Start the team's goals for ${esc(quarterLabel(s.quarter))}.`}</p>
      <p class="acts"><button type="button" class="btn primary" data-g-start="${esc(s.owner)}">Start from the template</button>${s.canCopy ? '<button type="button" class="btn" data-g-copy>Copy from last quarter</button>' : ''}</p></section>`;
  }
  const conflict = f.conflict ? `<p class="unsaved" role="alert">This doc changed somewhere else since you opened it. Nothing was overwritten.
      <button type="button" class="btn" data-g-conflict="load">Load the new version</button><button type="button" class="btn" data-g-conflict="overwrite">Overwrite with mine</button></p>` : '';
  const editor = `<div class="g-edit"><textarea class="editor" id="g-editor" data-g-editor aria-label="Goals for ${esc(s.ownerName)}, ${esc(quarterLabel(s.quarter))}" spellcheck="true">${esc(f.text)}</textarea>${formatCardHtml(s.formatOpen)}</div>`;
  const preview = `<div class="g-preview" data-g-preview>${previewHtml({ doc: s.doc, path: f.path, isReport: s.isReport, teamTitles: s.teamTitles, popover: s.popover, menu: s.menu })}</div>`;
  const body = s.mode === 'preview' ? preview : s.mode === 'split' ? `<div class="g-split">${editor}${preview}</div>` : editor;
  return head + conflict + body + `<p class="soft small">Saved as <span class="num">${esc(f.path)}</span> in your Workshop folder: a plain Markdown file.</p>`;
}

/** Shown instead of Goals when the browser's folder needs Allow. */
export function setupHtml(embedded) {
  return `<section class="engcard" role="status"><h2>Allow Workshop to use your folder to see your goals</h2>
    <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop.' : 'Open Workshop and click <b>Allow</b> in the bar at the top.'} Chrome asks again after it restarts.</p></section>`;
}

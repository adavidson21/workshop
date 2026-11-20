/* Code review screen: HTML strings from the state, no DOM (tested in Node, test/review.test.mjs).
   review.js paints these and wires Monaco into #rv-diff. Every value from the agent or the reviewer
   goes through esc(). */

import { STATUS_LETTER, TYPES, RESPONSE_LABEL, NOTE_LABEL, typeLabel, rangeLabel, firstLine, fileTree, commentCounts, previousRows, visibleFiles, canRequestChanges, readingGroups, threadRows } from './review-state.js';
import { outsideMark } from '../../../../shared/outside.js';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/* ---------- top bar ---------- */

// ui: { sideBySide, sinceLast, panelOpen, backHref }
export function topBar(session, item, ui) {
  const files = visibleFiles(session, ui.sinceLast);
  const repoPick = item.repos.length > 1
    ? `<label class="rv-repo"><span class="sr">Repo</span><select data-act="repo">${item.repos.map(r => `<option value="${esc(r)}"${r === session.repo ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>`
    : `<span class="rv-chip mono" title="Repo">${esc(session.repo)}</span>`;
  const since = session.revision > 1 && session.sinceLastReview
    ? `<button class="rv-seg${ui.sinceLast ? ' on' : ''}" data-act="since" aria-pressed="${ui.sinceLast}">Changes since last review</button>`
    : '';
  return `<div class="rv-top">
  <a class="btn ghost rv-back" href="${esc(ui.backHref)}" data-act="back">${ICON.back}Back to Loom</a>
  <div class="rv-heading">
    <p class="eyebrow">Code review</p>
    <h1 class="rv-title">${esc(item.title)}</h1>
    <p class="rv-meta mono"><span title="Branch">${esc(session.branch)}</span><span aria-hidden="true">&rarr;</span><span title="Base branch">${esc(session.baseBranch)}</span><span class="rv-dot" aria-hidden="true"></span><span>Revision ${esc(session.revision)}</span><span class="rv-dot" aria-hidden="true"></span><span>${plural(files.length, 'file')}</span></p>
  </div>
  <div class="rv-tools">
    ${repoPick}
    ${since}
    <div class="rv-segs" role="group" aria-label="Diff layout">
      <button class="rv-seg${ui.sideBySide ? ' on' : ''}" data-act="layout" data-v="split" aria-pressed="${ui.sideBySide}">Side by side</button>
      <button class="rv-seg${ui.sideBySide ? '' : ' on'}" data-act="layout" data-v="inline" aria-pressed="${!ui.sideBySide}">Inline</button>
    </div>
    <button class="ibtn" data-act="panel" aria-pressed="${ui.panelOpen}" title="${ui.panelOpen ? 'Hide' : 'Show'} the review panel">${ICON.panel}</button>
  </div>
</div>`;
}

/* ---------- status banner ---------- */

export function banner(session, ui) {
  if (ui.error) return `<div class="rv-banner bad" role="alert">${esc(ui.error)}</div>`;
  if (session.status === 'approved') {
    return ui.published
      ? `<div class="rv-banner ok">${ui.merge ? 'Approved and merged, no PR. Tandem runs its retro.' : 'Approved and published. Create the pull request on the page that opened.'}</div>`
      : `<div class="rv-banner ok">Approved. ${ui.publishError ? `Publishing did not go through: ${esc(ui.publishError)} ` : ''}Publish from Loom when you are ready.</div>`;
  }
  if (session.status === 'revising') {
    const run = session.revisionRun;
    if (run && run.status === 'failed') return `<div class="rv-banner warn" role="alert"><strong>Tandem is not working on your comments.</strong> ${esc(run.message || '')} <button class="btn" data-act="revise"${ui.revising ? ' disabled' : ''}>Start Tandem on them</button></div>`;
    return `<div class="rv-banner">Tandem is working on your comments: fix tasks, then a review, tests and the UI check again. This page shows revision ${esc(session.revision + 1)} when it is back at Publish.</div>`;
  }
  if (ui.sinceLast) return `<div class="rv-banner">Showing only what changed since revision ${esc(session.revision - 1)}. Comments here go on the new code.</div>`;
  if (ui.inlineNote) return `<div class="rv-banner">Inline view: comments go on the new code. Switch to side by side to comment on removed lines.</div>`;
  return '';
}

/* ---------- files pane ---------- */

function fileButton(f, name, pad, counts, ui, notes) {
  const n = counts[f.path] || 0;
  const tip = f.status === 'renamed' ? `Renamed from ${f.oldPath}` : f.status;
  const k = notes[f.path] || 0;
  return `<li><button class="rv-file${f.path === ui.file ? ' on' : ''}" ${pad} data-act="file" data-path="${esc(f.path)}" title="${esc(f.path)}">
      <span class="rv-badge s-${esc(f.status)}" title="${esc(tip)}">${STATUS_LETTER[f.status] || '?'}</span>
      <span class="rv-name">${esc(name)}</span>
      ${n ? `<span class="rv-ccount" title="${plural(n, 'draft comment')}">${n}</span>` : ''}${k ? `<span class="rv-ncount" title="${plural(k, 'note')} from Tandem's review">${k}</span>` : ''}
      ${f.binary ? '<span class="rv-delta mono">binary</span>' : `<span class="rv-delta mono"><span class="add">+${f.additions}</span> <span class="del">-${f.deletions}</span></span>`}
    </button></li>`;
}

export function filesPane(session, draft, ui) {
  const files = visibleFiles(session, ui.sinceLast);
  if (!files.length) return `<p class="rv-empty">${ui.sinceLast ? 'Nothing changed since the last review.' : 'No changed files.'}</p>`;
  const counts = commentCounts(draft.comments);
  const notes = {};
  for (const x of session.notes || []) if (x.state === 'open') notes[x.path] = (notes[x.path] || 0) + 1;
  // Reading order (connector 1.28.0): each task's files in task order, generated and lock files folded.
  const groups = !ui.sinceLast && readingGroups(files);
  if (groups) {
    return groups.map(g => {
      const open = !g.folded || !!ui.showFolded;
      const head = g.folded
        ? `<button class="rv-ghead lnk plain" data-act="folded" aria-expanded="${open}">${esc(g.label)} (${g.files.length})</button>`
        : `<p class="rv-ghead" title="${esc(g.label)}">${esc(g.label)}</p>`;
      return `<div class="rv-rgroup">${head}${open ? `<ul class="rv-tree" role="list">${g.files.map(f => fileButton(f, f.path, 'style="--d:0"', counts, ui, notes)).join('')}</ul>` : ''}</div>`;
    }).join('');
  }
  const rows = fileTree(files).map(r => {
    const pad = `style="--d:${r.depth}"`;
    if (r.type === 'dir') return `<li class="rv-dir" ${pad}>${ICON.folder}<span>${esc(r.name)}</span></li>`;
    return fileButton(r.file, r.name, pad, counts, ui, notes);
  }).join('');
  return `<ul class="rv-tree" role="list">${rows}</ul>`;
}

/* ---------- the diff header and placeholders ---------- */

export function fileBar(file) {
  if (!file) return '';
  const from = file.status === 'renamed' ? `<span class="rv-from mono">${esc(file.oldPath)} &rarr;</span>` : '';
  const task = file.task ? `<span class="rv-ftask" title="The task that changed it">Task ${esc(file.task.n)}: ${esc(file.task.title)}</span>` : '';
  return `${from}<span class="mono">${esc(file.path)}</span><span class="rv-badge s-${esc(file.status)}">${STATUS_LETTER[file.status] || '?'}</span>${task}`;
}

export function placeholder(kind, size) {
  if (kind === 'binary') return 'This is a binary file, so there is nothing to show.';
  if (kind === 'too_large') return `This file is too large to show here (${Math.round((size || 0) / 1024)} KB, the limit is 1 MB).`;
  if (kind === 'loading') return 'Loading the file.';
  if (kind === 'none') return 'Pick a file on the left.';
  return esc(kind);
}

/* ---------- comment widget (inside a Monaco view zone) ---------- */

// c: the comment being written or edited. editing: false shows the saved, collapsed card.
export function commentBox(c, { editing, expanded, readOnly }) {
  if (!editing) {
    const body = expanded ? `<div class="rv-cbody">${esc(c.body)}</div>${c.suggestedCode !== undefined ? `<pre class="rv-suggest mono">${esc(c.suggestedCode)}</pre>` : ''}` : `<span class="rv-cfirst">${esc(firstLine(c.body))}</span>`;
    const actions = expanded && !readOnly ? `<div class="rv-cactions"><button class="btn" data-act="c-edit" data-id="${esc(c.id)}">Edit</button><button class="btn text-danger" data-act="c-delete" data-id="${esc(c.id)}">Delete</button></div>` : '';
    return `<div class="rv-card${expanded ? ' open' : ''}" data-id="${esc(c.id)}">
  <button class="rv-chead" data-act="c-toggle" data-id="${esc(c.id)}" aria-expanded="${!!expanded}"><span class="rv-type t-${esc(c.type)}">${esc(typeLabel(c.type))}</span>${c.rule ? '<span class="rv-rule" title="Saved as a rule for this repo once it is fixed">Rule</span>' : ''}<span class="rv-range mono">${esc(rangeLabel(c))}</span>${expanded ? '' : body}</button>
  ${expanded ? body : ''}${actions}
</div>`;
  }
  const chips = TYPES.map(t => `<button type="button" class="rv-tchip t-${t.id}${c.type === t.id ? ' on' : ''}" data-act="c-type" data-v="${t.id}" aria-pressed="${c.type === t.id}">${t.label}</button>`).join('');
  const suggest = c.suggestedCode !== undefined;
  return `<form class="rv-form" data-id="${esc(c.id)}">
  <div class="rv-fhead"><span class="rv-range mono">${esc(c.path)} ${esc(rangeLabel(c))}</span><div class="rv-tchips" role="group" aria-label="Comment type">${chips}</div></div>
  <textarea class="rv-text" name="body" rows="3" placeholder="What should change, or what is your question?" aria-label="Comment">${esc(c.body)}</textarea>
  <div class="rv-toggles"><label class="rv-stoggle"><input type="checkbox" data-act="c-suggest"${suggest ? ' checked' : ''}> Suggest change</label>
  <label class="rv-stoggle" title="Tandem saves it in this repo's guide, so it is never needed again"><input type="checkbox" name="rule" data-act="c-rule"${c.rule ? ' checked' : ''}> Make it a rule</label></div>
  ${suggest ? `<textarea class="rv-text mono rv-code" name="suggested" rows="${Math.min(12, Math.max(2, c.suggestedCode.split('\n').length))}" aria-label="Proposed replacement" spellcheck="false">${esc(c.suggestedCode)}</textarea>` : ''}
  <div class="rv-factions"><span class="rv-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves, <kbd>Esc</kbd> cancels</span><button type="button" class="btn ghost" data-act="c-cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div>
</form>`;
}

/* ---------- review panel ---------- */

// ui: { panelOpen, submitting, approveLabel, confirmApprove, canPublish, published, publishing, publishError, revising }
export function panel(session, draft, ui) {
  if (!ui.panelOpen) return '';
  const open = session.status === 'awaiting_review';
  const byFile = new Map();
  for (const c of draft.comments) {
    if (!byFile.has(c.path)) byFile.set(c.path, []);
    byFile.get(c.path).push(c);
  }
  const groups = [...byFile.entries()].map(([path, list]) => `<li class="rv-group"><p class="rv-gpath mono" title="${esc(path)}">${esc(path)}</p><ul role="list">${list.map(c => `<li><button class="rv-entry" data-act="jump" data-id="${esc(c.id)}"><span class="rv-type t-${esc(c.type)}">${esc(typeLabel(c.type))}</span><span class="rv-range mono">${esc(rangeLabel(c))}</span><span class="rv-cfirst">${esc(firstLine(c.body)) || '<em>Empty</em>'}</span></button></li>`).join('')}</ul></li>`).join('');

  const prev = previousRows(session);
  const prevList = prev.length ? `<section class="rv-sec">
  <p class="section-label">Revision ${esc(session.revision - 1)} comments</p>
  <ul class="rv-prev" role="list">${prev.map(({ comment: c, response: r }) => `<li class="rv-resolved"><button class="rv-entry" data-act="jump-prev" data-id="${esc(c.id)}"><span class="rv-type t-${esc(c.type)}">${esc(typeLabel(c.type))}</span><span class="rv-range mono">${esc(c.path)} ${esc(rangeLabel(c))}</span><span class="rv-cfirst">${esc(firstLine(c.body))}</span></button>${r ? `<p class="rv-answer"><span class="rv-astatus a-${esc(r.status)}">${esc(RESPONSE_LABEL[r.status] || r.status)}</span>${r.note ? ` ${esc(r.note)}` : ''}</p>` : '<p class="rv-answer muted">No answer from the agent.</p>'}</li>`).join('')}</ul>
  ${session.previousFeedback.summary ? `<p class="rv-prevsum"><span class="muted">Your summary:</span> ${esc(session.previousFeedback.summary)}</p>` : ''}
</section>` : '';

  const can = canRequestChanges(draft);
  const approve = `${esc(ui.approveLabel)} ${outsideMark('git')}`;
  const actions = open ? (ui.confirmApprove
    ? `<div class="rv-confirm" role="alert"><p>Approving sends no line comments. Discard ${plural(draft.comments.length, 'draft comment')} and publish?</p><div class="rv-verdict"><button class="btn" data-act="approve-cancel">Keep them</button><button class="btn primary" data-act="approve-confirm" data-out${ui.submitting ? ' disabled' : ''}>${approve}</button></div></div>`
    : `<div class="rv-verdict"><button class="btn primary" data-act="approve" data-out${ui.submitting || !ui.canPublish ? ' disabled' : ''} title="${ui.canPublish ? 'Pushes every branch of this build (never force), then opens the PR pages' : 'Not ready to publish: the build is not at Publish'}">${approve}</button><button class="btn" data-act="request"${!can || ui.submitting ? ' disabled' : ''} title="${can ? 'Tandem turns your comments into fixes, reviews and tests again, and brings it back here' : 'Add a comment or a summary first'}">Send back</button></div>`)
    : '';
  const pushRow = session.status === 'approved' && !ui.published && ui.canPublish
    ? `<div class="rv-verdict"><button class="btn primary" data-act="publish" data-out${ui.publishing ? ' disabled' : ''}>${ui.publishing ? 'Publishing...' : `Publish ${outsideMark('git')}`}</button></div>`
    : '';
  const notes = (session.notes || []);
  const notesSec = notes.length ? `<section class="rv-sec">
  <p class="section-label">Tandem's review (${notes.length})</p>
  <ul class="rv-notes" role="list">${notes.map(n => `<li class="rv-note${n.state === 'fixed' ? ' fixed' : ''}"><button class="rv-entry" data-act="jump-note" data-path="${esc(n.path)}" data-line="${esc(n.line)}"><span class="rv-nsev n-${esc(n.severity)}">${esc(NOTE_LABEL[n.severity] || n.severity)}</span><span class="rv-range mono">${esc(n.path)}:${esc(n.line)}</span><span class="rv-cfirst">${esc(firstLine(n.text))}</span></button>${n.state === 'fixed' ? '<p class="rv-answer"><span class="rv-astatus a-fixed">Fixed</span> in review round ' + esc(n.round) + '</p>' : ''}</li>`).join('')}</ul>
  <p class="muted rv-hint">What Tandem found and fixed on its own. Comment on a line to send any of it back.</p>
</section>` : '';
  const threads = threadRows(session);
  const threadSec = threads.length ? `<section class="rv-sec">
  <p class="section-label">On the PR (${threads.length})</p>
  <ul class="rv-threads" role="list">${threads.map(t => `<li class="rv-thread${t.resolved ? ' fixed' : ''}"><p class="rv-tmeta"><span class="mono">${t.path ? `${esc(t.path)}${t.line ? ':' + esc(t.line) : ''}` : 'The PR'}</span> ${esc(t.author || '')}</p><p class="rv-cfirst">${esc(firstLine(t.text))}</p>${!t.resolved && t.path && t.line && open ? `<button class="btn small" data-act="thread-add" data-id="${esc(t.id)}"${draft.comments.some(c => c.from === t.id) ? ' disabled' : ''}>${draft.comments.some(c => c.from === t.id) ? 'In your comments' : 'Add to my comments'}</button>` : ''}</li>`).join('')}</ul>
</section>` : '';

  return `<div class="rv-panel-in">
  <section class="rv-sec">
    <p class="section-label">Comments${draft.comments.length ? ` (${draft.comments.length})` : ''}</p>
    ${draft.comments.length ? `<ul class="rv-groups" role="list">${groups}</ul>` : `<p class="rv-empty">${open ? 'Click a line number to comment. Shift-click another to pick a range, or press <kbd>C</kbd>.' : 'No comments.'}</p>`}
  </section>
  <section class="rv-sec">
    <label class="section-label" for="rv-summary">Summary</label>
    <textarea id="rv-summary" class="rv-text" data-act="summary" rows="4" placeholder="Feedback that is not about one line"${open ? '' : ' disabled'}>${esc(draft.summary)}</textarea>
    ${ui.saveFailed ? '<p class="rv-warnline">This browser is not saving drafts. Submit before you close the page.</p>' : ''}
  </section>
  ${actions}${pushRow}
  ${prevList}
  ${threadSec}
  ${notesSec}
</div>`;
}

/* Code review screen (review.html): a read-only, VS Code style diff of one repo of a work item, with
   line comments that go back to the agent as one revision. Open it as
     review.html?id=<work item id>&repo=<repo folder>        with Workshop and the opencode connector
     review.html?mock=1                                      the mock review (review-api.js), no agent
   The hash names a selection, so it can be linked: #file=src/x.ts&L=12-18 (&side=old for removed code).

   review-state.js has the logic and review-view.js the HTML; this file paints them, runs Monaco
   (vendor/monaco, loaded by review-monaco.js) and handles input. */

import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { loadMonaco } from './review-monaco.js';
import { reviewApi, mockReviewApi } from './review-api.js';
import {
  parseHash, formatHash, select, draftKey, loadDraft, saveDraft, emptyDraft, nextCommentId, upsertComment, removeComment,
  quoteLines, buildFeedback, visibleFiles, sidesFor, languageFor, canRequestChanges,
} from './review-state.js';
import { confirmOutside } from '../../../shared/outside.js';
import { esc, topBar, banner, filesPane, fileBar, placeholder, commentBox, panel } from './review-view.js';

// Approve only records the verdict, on this computer. Pushing the branch changes the git remote, so it is its own
// button, Push to origin, with the shared outside confirm (shared/outside.js). Nothing is pushed before Approve.
const APPROVE_LABEL = 'Approve';

const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1';
const ws = await connect({ app: 'agents' });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Dispatch');

const store = (() => { try { return window.localStorage; } catch (e) { return null; } })() || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const errText = e => (e && e.message) || 'Something went wrong.';
const $ = sel => document.querySelector(sel);

const R = {
  api: MOCK ? mockReviewApi() : reviewApi(ws),
  id: MOCK ? 'L1' : params.get('id'),
  repo: MOCK ? null : params.get('repo'),
  item: null,
  session: null,
  draft: emptyDraft(),
  key: null,
  // Side by side needs room; small screens start inline.
  ui: { pushed: false, pushing: false, sideBySide: window.innerWidth > 900, sinceLast: false, panelOpen: true, file: null, error: null, submitting: false, confirmApprove: false, saveFailed: false, backHref: '', approveLabel: APPROVE_LABEL },
  sel: null, // { file, side, anchor, start, end }
  editing: null, // { comment, isNew }
  expanded: new Set(),
  texts: new Map(), // `${headSha}|${side}|${path}` -> FileContent
  pending: parseHash(location.hash), // a selection from the URL, applied once its file is open
};

if (MOCK) window.__reviewMock = R.api; // tests/review-e2e.py drives the mock through this

/* ---------- page shell ---------- */

const root = document.getElementById('review');
root.innerHTML = `<div id="rv-top"></div><div id="rv-banner"></div>
<div class="rv-body">
  <aside class="rv-files" aria-label="Changed files"><p class="section-label">Files</p><div id="rv-files"></div></aside>
  <section class="rv-diffwrap" aria-label="Diff"><div class="rv-filebar" id="rv-filebar"></div><div id="rv-diff" class="rv-diff"></div><div id="rv-place" class="rv-place" hidden></div></section>
  <aside class="rv-panel" id="rv-panel" aria-label="Review"></aside>
</div>`;

function fatal(msg, linkBack = true) {
  root.innerHTML = `<div class="rv-fatal"><p class="eyebrow">Code review</p><p>${esc(msg)}</p>${linkBack ? `<a class="btn" href="index.html">Back to Dispatch</a>` : ''}</div>`;
}

function paintChrome() {
  if (!R.session) return;
  const inlineNote = !R.ui.sideBySide && !R.ui.sinceLast;
  $('#rv-top').innerHTML = topBar(R.session, R.item, R.ui);
  $('#rv-banner').innerHTML = banner(R.session, { ...R.ui, inlineNote });
  $('#rv-files').innerHTML = filesPane(R.session, R.draft, R.ui);
  paintPanel();
  root.classList.toggle('no-panel', !R.ui.panelOpen);
}

function paintPanel() {
  const el = $('#rv-panel');
  const focused = document.activeElement && document.activeElement.id === 'rv-summary';
  const caret = focused ? document.activeElement.selectionStart : null;
  el.innerHTML = panel(R.session, R.draft, R.ui);
  el.hidden = !R.ui.panelOpen;
  if (focused) { const t = $('#rv-summary'); if (t) { t.focus(); t.setSelectionRange(caret, caret); } }
}

const readOnly = () => !R.session || R.session.status !== 'awaiting_review';
const currentFile = () => R.session && visibleFiles(R.session, R.ui.sinceLast).find(f => f.path === R.ui.file);

/* ---------- drafts ---------- */

function persist() {
  R.ui.saveFailed = !saveDraft(store, R.key, R.draft);
}

/* ---------- loading ---------- */

async function loadSession({ keepFile = true } = {}) {
  const prevRev = R.session ? R.session.revision : null;
  const s = await R.api.session(R.id, R.repo);
  R.session = s;
  if (s.revision !== prevRev) {
    R.key = draftKey(R.id, R.repo, s.revision);
    R.draft = loadDraft(store, R.key);
    R.editing = null;
    R.expanded.clear();
    if (prevRev != null) R.ui.sinceLast = false;
  }
  if (!s.sinceLastReview) R.ui.sinceLast = false;
  const files = visibleFiles(s, R.ui.sinceLast);
  const want = R.pending ? R.pending.file : keepFile ? R.ui.file : null;
  const pick = files.find(f => f.path === want) || files.find(f => !f.binary) || files[0] || null;
  paintChrome();
  await openFile(pick ? pick.path : null);
}

async function fileText(side, path) {
  const key = `${side === 'old' ? R.session.baseSha : R.session.headSha}|${side}|${path}`;
  if (!R.texts.has(key)) R.texts.set(key, await R.api.file(R.id, R.repo, path, side));
  return R.texts.get(key);
}

/* ---------- Monaco ---------- */

let monaco = null, diff = null, sides = null; // sides: { old: editor, new: editor }
const MT = () => monaco.editor.MouseTargetType;
const decos = {}; // side -> decorations collection
const zoneIds = { old: [], new: [] };
let hover = null; // { side, line }

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function applyTheme() {
  const dark = (document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const hex = v => (/^#[0-9a-f]{6}$/i.test(v) ? v : null);
  const colors = {};
  const set = (k, v) => { if (hex(v)) colors[k] = v; };
  set('editor.background', cssVar('--surface'));
  set('editorGutter.background', cssVar('--surface'));
  set('editor.foreground', cssVar('--ink'));
  set('editorLineNumber.foreground', cssVar('--muted'));
  set('editorLineNumber.activeForeground', cssVar('--ink'));
  set('editorWidget.background', cssVar('--surface'));
  set('editorWidget.border', cssVar('--line'));
  monaco.editor.defineTheme('workshop', { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [], colors });
  monaco.editor.setTheme('workshop');
}

async function startMonaco() {
  monaco = await loadMonaco();
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  diff = monaco.editor.createDiffEditor($('#rv-diff'), {
    readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: R.ui.sideBySide,
    useInlineViewWhenSpaceIsLimited: false, glyphMargin: true, folding: false, minimap: { enabled: false },
    scrollBeyondLastLine: false, renderOverviewRuler: false, ignoreTrimWhitespace: false, lineNumbersMinChars: 4,
    fontFamily: cssVar('--mono') || 'monospace', fontSize: 13, lineHeight: 20, contextmenu: false,
    renderMarginRevertIcon: false, enableSplitViewResizing: true, stickyScroll: { enabled: false },
  });
  sides = { old: diff.getOriginalEditor(), new: diff.getModifiedEditor() };
  for (const side of ['old', 'new']) {
    const ed = sides[side];
    ed.updateOptions({ glyphMargin: true });
    decos[side] = ed.createDecorationsCollection();
    wireEditor(ed, side);
    ed.onDidLayoutChange(() => {
      for (const n of ed.getDomNode().querySelectorAll('.rv-zone-in')) n.style.width = zoneWidth(ed);
    });
  }
  diff.onDidUpdateDiff(() => { if (R.pending) applyPending(); });
}

/* ---------- line selection in the gutter ---------- */

let dragging = null; // { side }
const canComment = side => !readOnly() && sidesFor(currentFile() || { path: '' }, R.ui.sinceLast).commentSides.includes(side) && (side === 'new' || R.ui.sideBySide);
const isGutter = t => t && (t.type === MT().GUTTER_LINE_NUMBERS || t.type === MT().GUTTER_GLYPH_MARGIN || t.type === MT().GUTTER_LINE_DECORATIONS);

function wireEditor(ed, side) {
  ed.onMouseMove(e => {
    const t = e.target;
    if (dragging && dragging.side === side && t.position) {
      R.sel = select(R.sel, { file: R.ui.file, side, line: t.position.lineNumber, extend: true });
      paintDecorations();
      return;
    }
    const line = t.position && t.position.lineNumber;
    const marked = line && R.draft.comments.some(c => c.path === R.ui.file && c.side === side && c.startLine === line);
    const next = isGutter(t) && line && !marked && canComment(side) ? { side, line } : null;
    if ((next && hover && next.side === hover.side && next.line === hover.line) || (!next && !hover)) return;
    hover = next;
    paintDecorations();
  });
  ed.onMouseLeave(() => { if (hover) { hover = null; paintDecorations(); } });
  ed.onMouseDown(e => {
    const t = e.target;
    if (!isGutter(t) || !t.position) return;
    const line = t.position.lineNumber;
    // A saved comment's marker opens its card.
    const at = R.draft.comments.find(c => c.path === R.ui.file && c.side === side && c.startLine === line);
    if (t.type === MT().GUTTER_GLYPH_MARGIN && at && !e.event.shiftKey) {
      toggleCard(at.id, true);
      return;
    }
    if (!canComment(side)) return;
    R.sel = select(R.sel, { file: R.ui.file, side, line, extend: e.event.shiftKey });
    dragging = { side };
    paintDecorations();
  });
  ed.onKeyDown(e => {
    if (e.keyCode !== monaco.KeyCode.KeyC || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!canComment(side)) return;
    e.preventDefault();
    e.stopPropagation();
    const s = ed.getSelection();
    if (s && !(R.sel && R.sel.side === side && R.sel.file === R.ui.file)) {
      R.sel = { file: R.ui.file, side, anchor: s.startLineNumber, start: Math.min(s.startLineNumber, s.endLineNumber), end: Math.max(s.startLineNumber, s.endLineNumber) };
    }
    openForm();
  });
}

// Ending a click, shift-click or drag in the gutter opens the comment box under the selection.
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = null;
  openForm();
});

function paintDecorations() {
  if (!sides) return;
  for (const side of ['old', 'new']) {
    const list = [];
    for (const c of R.draft.comments) {
      if (c.path !== R.ui.file || c.side !== side) continue;
      list.push({ range: new monaco.Range(c.startLine, 1, c.endLine, 1), options: { isWholeLine: true, className: 'rv-cline', linesDecorationsClassName: 'rv-cbar' } });
      list.push({ range: new monaco.Range(c.startLine, 1, c.startLine, 1), options: { glyphMarginClassName: 'rv-cglyph', glyphMarginHoverMessage: { value: 'Draft comment' } } });
    }
    const sel = R.editing ? { side: R.editing.comment.side, start: R.editing.comment.startLine, end: R.editing.comment.endLine, file: R.editing.comment.path } : R.sel;
    if (sel && sel.file === R.ui.file && sel.side === side) {
      list.push({ range: new monaco.Range(sel.start, 1, sel.end, 1), options: { isWholeLine: true, className: 'rv-sel', linesDecorationsClassName: 'rv-selbar' } });
    }
    if (hover && hover.side === side) list.push({ range: new monaco.Range(hover.line, 1, hover.line, 1), options: { glyphMarginClassName: 'rv-plus' } });
    decos[side].set(list);
  }
  writeHash();
}

function writeHash() {
  const s = R.editing ? { file: R.editing.comment.path, side: R.editing.comment.side, start: R.editing.comment.startLine, end: R.editing.comment.endLine } : R.sel;
  const h = s && s.file === R.ui.file ? formatHash(s) : '';
  if (h !== location.hash && !(h === '' && !location.hash)) history.replaceState(null, '', location.pathname + location.search + h);
}

/* ---------- the comment box and saved cards (Monaco view zones) ---------- */

function openForm() {
  if (!R.sel || readOnly()) return;
  if (R.editing && !R.editing.isNew) return; // finishing an edit first
  const prev = R.editing && R.editing.isNew ? R.editing.comment : null;
  const comment = {
    id: prev ? prev.id : nextCommentId(R.draft.comments),
    path: R.sel.file, side: R.sel.side, startLine: R.sel.start, endLine: R.sel.end,
    type: prev ? prev.type : 'must_fix', body: prev ? prev.body : '',
  };
  if (prev && prev.suggestedCode !== undefined) comment.suggestedCode = selectedText(comment);
  R.editing = { comment, isNew: true };
  paintDecorations();
  paintZones({ focus: true });
}

function selectedText(c) {
  const model = sides[c.side].getModel();
  return model ? quoteLines(model.getValue(), c.startLine, c.endLine) || '' : '';
}

function syncForm() {
  const f = document.querySelector('.rv-form');
  if (!f || !R.editing) return;
  R.editing.comment.body = f.querySelector('[name=body]').value;
  const code = f.querySelector('[name=suggested]');
  if (code) R.editing.comment.suggestedCode = code.value;
}

function saveForm() {
  syncForm();
  const c = R.editing.comment;
  if (!c.body.trim()) {
    const t = document.querySelector('.rv-form [name=body]');
    if (t) { t.classList.add('invalid'); t.focus(); }
    return;
  }
  R.draft = upsertComment(R.draft, { ...c, body: c.body.trim() });
  persist();
  R.editing = null;
  R.sel = null;
  paintDecorations();
  paintZones();
  paintChrome();
}

function cancelForm() {
  R.editing = null;
  R.sel = null;
  paintDecorations();
  paintZones();
}

function toggleCard(id, open) {
  if (open === undefined ? !R.expanded.has(id) : open) R.expanded.add(id);
  else R.expanded.delete(id);
  paintZones();
}

// A box as wide as the code you can see, not as wide as the longest line.
function zoneWidth(ed) {
  const li = ed.getLayoutInfo();
  return Math.max(220, Math.min(760, li.contentWidth - li.verticalScrollbarWidth - 24)) + 'px';
}

function zoneNode(html, side) {
  const node = document.createElement('div');
  node.className = 'rv-zone';
  node.innerHTML = `<div class="rv-zone-in">${html}</div>`;
  node.firstElementChild.style.width = zoneWidth(sides[side]);
  // Keep Monaco out of the box. Its keyboard handling would act on keys typed here (the box's own keys come
  // first), and its pointerdown handler captures the pointer, which sends the click to the code instead.
  for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'copy', 'cut', 'pointerdown', 'mousedown', 'touchstart']) {
    node.addEventListener(type, e => {
      if (type === 'keydown') formKeys(e);
      if (type === 'input' && e.target.closest('.rv-form')) { e.target.classList.remove('invalid'); syncForm(); }
      e.stopPropagation();
    });
  }
  node.dataset.side = side;
  return node;
}

function paintZones({ focus = false } = {}) {
  if (!sides) return;
  const file = R.ui.file;
  for (const side of ['old', 'new']) {
    const ed = sides[side];
    const items = [];
    for (const c of R.draft.comments) {
      if (c.path !== file || c.side !== side) continue;
      if (R.editing && !R.editing.isNew && R.editing.comment.id === c.id) continue;
      items.push({ after: c.endLine, html: commentBox(c, { editing: false, expanded: R.expanded.has(c.id), readOnly: readOnly() }) });
    }
    if (R.editing && R.editing.comment.path === file && R.editing.comment.side === side) {
      items.push({ after: R.editing.comment.endLine, html: commentBox(R.editing.comment, { editing: true }), form: true });
    }
    ed.changeViewZones(acc => {
      for (const id of zoneIds[side]) acc.removeZone(id);
      zoneIds[side] = [];
      for (const it of items) {
        const domNode = zoneNode(it.html, side);
        const zone = { afterLineNumber: it.after, heightInPx: it.form ? 190 : 40, domNode, suppressMouseDown: true };
        const id = acc.addZone(zone);
        zoneIds[side].push(id);
        // Fit the zone to its content once it is on the page, and again whenever the content resizes.
        const fit = () => {
          const h = Math.ceil(domNode.firstElementChild.getBoundingClientRect().height) + 8;
          if (h > 8 && Math.abs(h - zone.heightInPx) > 1) { zone.heightInPx = h; ed.changeViewZones(a => a.layoutZone(id)); }
        };
        requestAnimationFrame(fit);
        if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(domNode.firstElementChild);
      }
    });
  }
  if (focus) requestAnimationFrame(() => {
    const c = R.editing && R.editing.comment;
    if (c) sides[c.side].revealLineInCenterIfOutsideViewport(c.endLine);
    const t = document.querySelector('.rv-form [name=body]');
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  });
}

function formKeys(e) {
  if (!e.target.closest || !e.target.closest('.rv-form')) return;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveForm(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelForm(); }
}

/* ---------- opening a file ---------- */

// One pair of models for the whole page, updated in place. Swapping and disposing models while the diff
// is still being computed makes Monaco throw ("no diff result available").
let models = null, shownPath = null;
function showText(left, right, lang, path) {
  if (!models) {
    models = { original: monaco.editor.createModel(left, lang), modified: monaco.editor.createModel(right, lang) };
    diff.setModel(models);
  } else {
    for (const [m, t] of [[models.original, left], [models.modified, right]]) {
      if (m.getLanguageId() !== lang) monaco.editor.setModelLanguage(m, lang);
      if (m.getValue() !== t) m.setValue(t);
    }
  }
  if (shownPath !== path) { sides.old.setScrollTop(0); sides.new.setScrollTop(0); shownPath = path; }
}

let openSeq = 0;
async function openFile(path) {
  const seq = ++openSeq;
  R.ui.file = path;
  if (R.editing && R.editing.comment.path !== path) R.editing = null;
  if (R.sel && R.sel.file !== path) R.sel = null;
  $('#rv-files').innerHTML = filesPane(R.session, R.draft, R.ui);
  const file = currentFile();
  $('#rv-filebar').innerHTML = fileBar(file);
  const place = $('#rv-place'), box = $('#rv-diff');
  const show = msg => { place.innerHTML = msg; place.hidden = !msg; box.hidden = !!msg; };
  if (!file) { show(placeholder('none')); return; }
  if (file.binary) { show(placeholder('binary')); return; }
  show(placeholder('loading'));
  try {
    if (!monaco) await startMonaco();
    const { left, right } = sidesFor(file, R.ui.sinceLast);
    const [a, b] = await Promise.all([fileText(left.side, left.path), fileText(right.side, right.path)]);
    if (seq !== openSeq) return;
    const big = [a, b].find(x => x.kind === 'binary' || x.kind === 'too_large');
    if (big) { show(placeholder(big.kind, big.size)); return; }
    showText(a.kind === 'text' ? a.text : '', b.kind === 'text' ? b.text : '', languageFor(file.path), path);
    show('');
    paintDecorations();
    paintZones();
    if (R.pending && R.pending.file === path) applyPending();
  } catch (e) {
    if (seq === openSeq) show(esc(errText(e)));
  }
}

// A selection from the URL: select it, reveal it, and open the box when the review takes comments.
function applyPending() {
  const p = R.pending;
  R.pending = null;
  if (!p || p.file !== R.ui.file || !p.start || !sides) return;
  const side = p.side === 'old' && R.ui.sideBySide && !R.ui.sinceLast ? 'old' : 'new';
  const lines = sides[side].getModel() ? sides[side].getModel().getLineCount() : 0;
  if (p.end > lines) return;
  R.sel = { file: p.file, side, anchor: p.start, start: p.start, end: p.end };
  sides[side].revealLinesInCenter(p.start, p.end);
  paintDecorations();
}

/* ---------- jumping to a comment ---------- */

async function jumpTo(c, { expand = true } = {}) {
  if (c.side === 'old' && !R.ui.sideBySide) setLayout(true);
  if (R.ui.sinceLast && c.side === 'old') { R.ui.sinceLast = false; paintChrome(); }
  const files = visibleFiles(R.session, R.ui.sinceLast);
  if (!files.some(f => f.path === c.path)) { R.ui.error = `${c.path} is not in this view.`; paintChrome(); return; }
  if (R.ui.file !== c.path) await openFile(c.path);
  if (!sides) return;
  const ed = sides[c.side];
  const n = ed.getModel() ? ed.getModel().getLineCount() : 0;
  const start = Math.min(c.startLine, n), end = Math.min(c.endLine, n);
  if (start >= 1) {
    ed.revealLinesInCenter(start, end);
    ed.setSelection(new monaco.Range(start, 1, end, 1));
  }
  if (expand && R.draft.comments.some(x => x.id === c.id)) toggleCard(c.id, true);
}

function setLayout(sideBySide) {
  R.ui.sideBySide = sideBySide;
  if (diff) diff.updateOptions({ renderSideBySide: sideBySide });
  if (!sideBySide && R.sel && R.sel.side === 'old') R.sel = null;
  if (!sideBySide && R.editing && R.editing.comment.side === 'old') R.editing = null;
  paintChrome();
  paintDecorations();
  paintZones();
}

/* ---------- submit ---------- */

async function submit(verdict) {
  if (R.ui.submitting) return;
  R.ui.submitting = true;
  R.ui.error = null;
  paintChrome();
  try {
    // quotedCode comes from the files at this review's commits.
    const need = verdict === 'approve' ? [] : [...new Set(R.draft.comments.map(c => `${c.side}|${c.path}`))];
    const texts = {};
    for (const k of need) {
      const [side, path] = k.split(/\|(.*)/s);
      const f = R.session.files.find(x => x.path === path);
      const real = side === 'old' && f && f.oldPath ? f.oldPath : path;
      const content = await fileText(side, real);
      texts[k] = content.kind === 'text' ? content.text : content.kind === 'absent' ? '' : null;
    }
    const built = buildFeedback(R.session, R.draft, verdict, (path, side) => texts[`${side}|${path}`]);
    if (built.problem) {
      R.ui.error = built.problem;
      const c = built.commentId && R.draft.comments.find(x => x.id === built.commentId);
      if (c) jumpTo(c);
      return;
    }
    await R.api.submit(R.id, R.repo, built.feedback);
    R.draft = emptyDraft();
    persist();
    R.ui.confirmApprove = false;
    if (verdict === 'approve') {
      await loadSession();
      ws.toast('Approved. Nothing is pushed until you click Push to origin.', { kind: 'info' });
    } else {
      ws.toast('Sent to the agent. It is revising now.', { kind: 'info' });
      await loadSession();
    }
  } catch (e) {
    R.ui.error = e.code === 'conflict' ? `${errText(e)} Your draft is kept; the review was reloaded.` : errText(e);
    if (e.code === 'conflict') { try { await loadSession(); } catch (err) { /* keep the error above */ } }
  } finally {
    R.ui.submitting = false;
    paintChrome();
  }
}

// Push the reviewed branch (the connector's Push: git push -u origin <pr.md branch>, never --force), after Approve,
// only once the shared confirm says yes. Only that click sends confirm: true.
async function pushBranch() {
  if (R.ui.pushing) return;
  const branch = R.session && R.session.branch;
  const ok = await confirmOutside({
    system: 'git',
    title: `Push ${branch || 'this branch'} to origin?`,
    body: 'Sends the approved branch to the remote, where your team can see it. It never force-pushes.',
    items: [`${R.repo || ''}: ${branch || ''}`.replace(/^: |: $/, '')],
    ok: 'Push'
  });
  if (!ok) return;
  R.ui.pushing = true;
  R.ui.error = null;
  paintChrome();
  try {
    const r = await R.api.push(R.item.folder, R.repo);
    R.ui.pushed = true;
    ws.toast((r && r.message) || 'Pushed.', { kind: 'info' });
  } catch (e) {
    R.ui.error = `Approved, but the push did not go through: ${errText(e)} Fix it, then click Push to origin.`;
  } finally {
    R.ui.pushing = false;
    paintChrome();
  }
}

/* ---------- input ---------- */

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  if (act === 'back') return; // a plain link
  if (act === 'file') { R.ui.error = null; await openFile(el.dataset.path); paintChrome(); return; }
  if (act === 'layout') return setLayout(el.dataset.v === 'split');
  if (act === 'since') {
    R.ui.sinceLast = !R.ui.sinceLast;
    R.editing = null; R.sel = null;
    const files = visibleFiles(R.session, R.ui.sinceLast);
    paintChrome();
    return openFile((files.find(f => f.path === R.ui.file) || files[0] || {}).path || null);
  }
  if (act === 'panel') { R.ui.panelOpen = !R.ui.panelOpen; paintChrome(); return; }
  if (act === 'jump') { const c = R.draft.comments.find(x => x.id === id); if (c) jumpTo(c); return; }
  if (act === 'jump-prev') {
    const c = R.session.previousFeedback && R.session.previousFeedback.comments.find(x => x.id === id);
    if (c) jumpTo(c, { expand: false });
    return;
  }
  if (act === 'c-toggle') return toggleCard(id);
  if (act === 'c-edit') {
    const c = R.draft.comments.find(x => x.id === id);
    if (c) { R.editing = { comment: { ...c }, isNew: false }; R.sel = null; paintDecorations(); paintZones({ focus: true }); }
    return;
  }
  if (act === 'c-delete') {
    R.draft = removeComment(R.draft, id);
    R.expanded.delete(id);
    persist();
    paintDecorations(); paintZones(); paintChrome();
    return;
  }
  if (act === 'c-cancel') return cancelForm();
  if (act === 'c-type') {
    syncForm();
    R.editing.comment.type = el.dataset.v;
    paintZones({ focus: true });
    return;
  }
  if (act === 'approve') {
    if (R.draft.comments.length) { R.ui.confirmApprove = true; paintPanel(); return; }
    return submit('approve');
  }
  if (act === 'approve-cancel') { R.ui.confirmApprove = false; paintPanel(); return; }
  if (act === 'approve-confirm') return submit('approve');
  if (act === 'request') return submit('request_changes');
  if (act === 'push') return pushBranch();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'repo') {
    const url = new URL(location.href);
    url.searchParams.set('repo', el.value);
    url.hash = '';
    location.assign(url.toString());
    return;
  }
  if (el.dataset.act === 'c-suggest' && R.editing) {
    syncForm();
    if (el.checked) R.editing.comment.suggestedCode = selectedText(R.editing.comment);
    else delete R.editing.comment.suggestedCode;
    paintZones({ focus: true });
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.act === 'summary') {
    const had = canRequestChanges(R.draft);
    R.draft = { ...R.draft, summary: el.value };
    persist();
    if (had !== canRequestChanges(R.draft)) paintPanel();
  }
});

document.addEventListener('submit', e => {
  if (!e.target.classList.contains('rv-form')) return;
  e.preventDefault();
  saveForm();
});

// C with focus on the page (not in a text box) opens a comment on the current selection.
document.addEventListener('keydown', e => {
  if (e.key !== 'c' && e.key !== 'C') return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (!R.sel) return;
  e.preventDefault();
  openForm();
});

window.addEventListener('hashchange', () => {
  const p = parseHash(location.hash);
  if (!p || (R.sel && formatHash(R.sel) === location.hash)) return;
  R.pending = p;
  if (p.file === R.ui.file) applyPending();
  else openFile(p.file);
});

/* ---------- start ---------- */

if (!MOCK && ws.backend !== 'agent') {
  fatal('The code review needs Workshop running with the opencode connector on. Open it from Dispatch, or try the sample review.');
  root.querySelector('.rv-fatal').insertAdjacentHTML('beforeend', ' <a class="btn" href="review.html?mock=1">Open the sample review</a>');
} else if (!R.id) {
  fatal('No work item was named. Open the review from Dispatch.');
} else {
  try {
    R.item = await R.api.item(R.id);
    if (!R.repo) R.repo = R.item.repos[0] || null;
    R.ui.pushed = !!(R.item.pushed && R.item.pushed[R.repo]);
    if (!R.repo) throw new Error(`Work item ${R.id} has no PR text for any repo yet. Run the step that writes pr.md first.`);
    R.ui.backHref = MOCK ? 'index.html' : `index.html#${encodeURIComponent(R.id)}`;
    document.title = `Review: ${R.item.title}`;
    await loadSession({ keepFile: false });
    R.api.onChange(R.id, R.repo, () => loadSession().catch(err => { R.ui.error = errText(err); paintChrome(); }));
    ws.on('visible', p => { if (p && p.visible) loadSession().catch(() => {}); });
  } catch (e) {
    fatal(errText(e));
  }
}

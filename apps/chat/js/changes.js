/* The workbench's Changes (Chat 4.1.0, docs/chat.md, Changes): what the chat in view changed, file by file, each
   with its diff against the repo's last commit (the connector's chat.changes). Click a line's + to comment on it;
   Send to chat sends every comment to the chat as one message, so the agent addresses them together, as with
   comments in Claude's desktop diff view. Comments wait here, per chat, until you send them or clear them.

   Review code (Chat 4.2.0, the connector's chat.review): a read-only agent reviews everything the chat changed and
   lists findings, each at its file and line, like the /code-review card in Claude's desktop app. Fix this sends one
   finding to the chat, Fix all sends every one left; Dismiss hides one. A review of files that changed since says
   so. The review runs in a scratch session, so nothing lands in the chat until you send a fix. */
import { esc } from './md.js';

const OC = 'opencode';

/** A unified diff (hunks only) as rows: {kind: hunk | ctx | add | del | note, old, new, text}. */
export function diffRows(diff) {
  const rows = [];
  let o = 0, n = 0;
  for (const line of String(diff || '').split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { o = +h[1]; n = +h[2]; rows.push({ kind: 'hunk', old: null, new: null, text: line }); continue; }
    if (line.startsWith('\\')) { rows.push({ kind: 'note', old: null, new: null, text: line.slice(1).trim() }); continue; }
    if (line.startsWith('+')) rows.push({ kind: 'add', old: null, new: n++, text: line.slice(1) });
    else if (line.startsWith('-')) rows.push({ kind: 'del', old: o++, new: null, text: line.slice(1) });
    else if (line.startsWith(' ') || line === '') { if (!rows.length) continue; rows.push({ kind: 'ctx', old: o++, new: n++, text: line.slice(1) }); }
    else rows.push({ kind: 'note', old: null, new: null, text: line });
  }
  while (rows.length && rows[rows.length - 1].kind === 'ctx' && rows[rows.length - 1].text === '') rows.pop();
  return rows;
}

/** The one message every comment goes back to the chat in. */
export function commentMessage(comments) {
  const list = comments || [];
  const out = [`Please address ${list.length === 1 ? 'this comment' : `these ${list.length} comments`} on your changes:`, ''];
  list.forEach((c, i) => {
    out.push(`${i + 1}. \`${c.path}:${c.line}\`${c.side === 'old' ? ' (a removed line)' : ''}`);
    if (c.quote) out.push(`   > ${c.quote.trim().slice(0, 300)}`);
    for (const l of String(c.body).trim().split('\n')) out.push(`   ${l}`);
    out.push('');
  });
  return out.join('\n').trim();
}

/** The one message findings go back to the chat in (Fix this, Fix all). */
export function fixMessage(findings) {
  const list = findings || [];
  const out = [`Please fix ${list.length === 1 ? 'this finding' : `these ${list.length} findings`} from a code review of your changes:`, ''];
  list.forEach((f, i) => {
    out.push(`${i + 1}. ${SEV[f.severity] || 'Should fix'}: \`${f.path}${f.line ? `:${f.line}` : ''}\``);
    for (const l of String(f.text).trim().split('\n')) out.push(`   ${l}`);
    out.push('');
  });
  out.push('Fix what you agree with. For anything you think is wrong, say why instead of changing it.');
  return out.join('\n').trim();
}

/** "1 blocker, 2 should fix": the findings left, by severity. */
export function findingCounts(findings) {
  const n = { blocker: 0, 'should-fix': 0, nit: 0 };
  for (const f of findings || []) if (n[f.severity] != null) n[f.severity]++;
  return [['blocker', 'blocker', 'blockers'], ['should-fix', 'should fix', 'should fix'], ['nit', 'nit', 'nits']]
    .filter(([k]) => n[k]).map(([k, one, many]) => `${n[k]} ${n[k] === 1 ? one : many}`).join(', ');
}

export const SEV = { blocker: 'Blocker', 'should-fix': 'Should fix', nit: 'Nit' };
const REVIEW_MS = 3000;

const STATUS = { modified: 'Changed', added: 'New', deleted: 'Deleted', clean: 'Committed or undone', binary: 'Binary' };

export function startChanges(ws, { send = async () => false, busy = () => false, flash = () => {}, onCount = () => {}, model = () => '', canReview = () => true } = {}) {
  const el = document.createElement('div');
  el.className = 'changes';
  let main = null, files = null, err = '', loading = false, visible = false, openPath = null, editing = null, draft = '', at = null, key = '';
  const comments = {}; // session -> [{id, path, line, side, quote, body}]
  const mine = () => comments[main] || (comments[main] = []);
  const reviews = {}; // session -> the connector's review state, plus `gone` (dismissed or sent finding ids -> 'dismissed' | 'sent')
  let reviewTimer = 0, starting = false;
  const review = () => reviews[main] || null;
  const left = r => (r && r.findings || []).filter(f => !(r.gone && r.gone[f.id]));

  async function load() {
    if (!main) return;
    const want = main;
    loading = true; draw();
    try {
      const r = await ws.connectors.call(OC, 'chat.changes', { session: want });
      if (main !== want) return;
      files = r.files || []; at = r.at; key = r.key || ''; err = '';
      if (openPath && !files.some(f => f.path === openPath)) openPath = null;
      if (!openPath && files.length === 1) openPath = files[0].path;
    } catch (e) { if (main === want) err = e.message || "Couldn't read what this chat changed."; }
    loading = false; draw();
  }
  /* ---------- Review code ---------- */
  async function loadReview() {
    clearTimeout(reviewTimer);
    if (!main) return;
    const want = main;
    try {
      const r = await ws.connectors.call(OC, 'chat.review.state', { session: want });
      const was = reviews[want];
      reviews[want] = r.status === 'none' ? null : { ...r, gone: was && was.at === r.at ? was.gone : {} };
      if (was && was.status === 'running' && r.status === 'done') flash(r.findings.length ? `Review done: ${findingCounts(r.findings)}.` : 'Review done: no findings.');
    } catch (e) { /* an older connector: no reviews */ }
    if (main !== want) return;
    draw();
    const r = review();
    if (r && r.status === 'running' && visible) reviewTimer = setTimeout(loadReview, REVIEW_MS);
  }
  async function startReview() {
    if (!main || starting) return;
    starting = true; draw();
    try {
      const m = model();
      const r = await ws.connectors.call(OC, 'chat.review', m ? { session: main, model: m } : { session: main });
      reviews[main] = { ...r, gone: {} };
    } catch (e) { flash(e.message || "Couldn't start the review."); }
    starting = false; draw();
    loadReview();
  }
  async function sendFix(list) {
    const r = review();
    if (!r || !list.length) return;
    if (await send(fixMessage(list))) {
      for (const f of list) r.gone[f.id] = 'sent';
      flash(list.length === 1 ? 'Finding sent to the chat.' : `${list.length} findings sent to the chat.`);
      draw();
    }
  }
  const where = f => `${f.path}${f.line ? `:${f.line}` : ''}`;
  function findingHtml(f, { inline = false } = {}) {
    const loc = inline ? '' : f.known ? `<button type="button" class="lnk mono rv-loc" data-rv-show="${esc(f.id)}" title="Show it in the diff">${esc(where(f))}</button>` : `<span class="mono rv-loc">${esc(where(f))}</span>`;
    return `<div class="rv-f rv-${esc(f.severity)}"><span class="rv-sev">${esc(SEV[f.severity] || f.severity)}</span>${loc}<p>${esc(f.text)}</p>` +
      `<span class="rv-acts"><button type="button" class="btn ghost small" data-rv-fix="${esc(f.id)}" title="${busy() ? 'Queued until the agent is done' : 'Send it to the chat to fix'}">Fix this</button>` +
      `<button type="button" class="lnk" data-rv-dismiss="${esc(f.id)}">Dismiss</button></span></div>`;
  }
  function reviewHtml() {
    const r = review();
    if (!r) return '';
    if (r.status === 'running') return `<div class="rv rv-run" role="status"><span class="spin" aria-hidden="true"></span><p>Reviewing ${r.files.length} file${r.files.length === 1 ? '' : 's'}. It can take a few minutes; keep working, it shows here when done.</p></div>`;
    if (r.status === 'failed') return `<div class="rv"><p class="hub-error">The review did not finish: ${esc(r.error)}</p><button type="button" class="btn ghost small" data-rv-start>Try again</button></div>`;
    const rest = left(r);
    const sent = Object.values(r.gone || {}).filter(v => v === 'sent').length;
    const stale = key && r.key && key !== r.key;
    const head = `<div class="rv-head"><b>Review</b><span class="rv-sum">${esc(rest.length ? findingCounts(rest) : r.findings.length ? 'All handled' : 'No findings')}${sent ? ` <span class="dim">(${sent} sent)</span>` : ''}</span><span class="grow"></span>` +
      (rest.length > 1 ? `<button type="button" class="btn primary small" data-rv-all title="${busy() ? 'Queued until the agent is done' : 'Send every finding left to the chat as one message'}">Fix all</button>` : '') +
      `<button type="button" class="lnk" data-rv-close>Close</button></div>`;
    return `<div class="rv">${head}${r.summary ? `<p class="rv-verdict">${esc(r.summary)}</p>` : ''}` +
      (stale ? '<p class="rv-stale">The files changed since this review. <button type="button" class="lnk" data-rv-start>Review again</button></p>' : '') +
      rest.map(f => findingHtml(f)).join('') + '</div>';
  }
  function lineHtml(f, r) {
    const side = r.kind === 'del' ? 'old' : 'new';
    const num = side === 'old' ? r.old : r.new;
    const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
    const can = (r.kind === 'add' || r.kind === 'del' || r.kind === 'ctx') && num != null;
    const here = mine().filter(c => c.path === f.path && c.side === side && c.line === num);
    const box = editing && editing.path === f.path && editing.side === side && editing.line === num
      ? `<tr class="ch-edit"><td colspan="4"><textarea rows="2" data-keep="ch-comment" data-ch-text placeholder="What should change here?" aria-label="Comment on line ${num}">${esc(draft)}</textarea>` +
        `<div class="row"><button type="button" class="btn primary small" data-ch-add${draft.trim() ? '' : ' disabled'}>Add comment</button><button type="button" class="btn ghost small" data-ch-cancel>Cancel</button></div></td></tr>` : '';
    const notes = here.map(c => `<tr class="ch-note"><td colspan="4"><p>${esc(c.body)}</p><button type="button" class="lnk" data-ch-del="${esc(c.id)}">Delete</button></td></tr>`).join('') +
      (side === 'new' ? left(review()).filter(x => x.path === f.path && x.line === num).map(x => `<tr class="ch-finding" data-rv-at="${esc(x.id)}"><td colspan="4">${findingHtml(x, { inline: true })}</td></tr>`).join('') : '');
    return `<tr class="ch-${r.kind}"><td class="ch-n">${r.old ?? ''}</td><td class="ch-n">${r.new ?? ''}</td>` +
      `<td class="ch-plus">${can ? `<button type="button" class="ch-c" data-ch-line="${esc(f.path)}|${side}|${num}" title="Comment on this line" aria-label="Comment on line ${num}">+</button>` : ''}</td>` +
      `<td class="ch-tx"><span class="ch-s">${sign}</span>${esc(r.text)}</td></tr>${notes}${box}`;
  }
  function fileHtml(f) {
    const on = f.path === openPath;
    const n = mine().filter(c => c.path === f.path).length;
    const nf = left(review()).filter(x => x.path === f.path).length;
    const head = `<button type="button" class="ch-file${on ? ' on' : ''}" data-ch-open="${esc(f.path)}" aria-expanded="${on}"><span class="ch-path mono">${esc(f.path)}</span>` +
      `<span class="ch-st">${esc(STATUS[f.status] || f.status)}</span>${f.additions ? `<span class="ch-a">+${f.additions}</span>` : ''}${f.deletions ? `<span class="ch-d">-${f.deletions}</span>` : ''}${n ? `<span class="ch-k">${n}</span>` : ''}${nf ? `<span class="ch-k rv-k" title="${nf} review finding${nf === 1 ? '' : 's'}">${nf}</span>` : ''}</button>`;
    if (!on) return `<li>${head}</li>`;
    const rows = diffRows(f.diff);
    const body = f.cut ? '<p class="dim">Too much changed to show here. Open it in Files.</p>'
      : !rows.length ? `<p class="dim">${f.status === 'clean' ? 'No uncommitted change: it was committed or undone.' : f.status === 'binary' ? 'A binary file.' : 'No change to show.'}</p>`
      : `<table class="ch-diff"><tbody>${rows.map(r => r.kind === 'hunk' ? `<tr class="ch-hunk"><td colspan="4">${esc(r.text)}</td></tr>` : r.kind === 'note' ? `<tr class="ch-hunk"><td colspan="4">${esc(r.text)}</td></tr>` : lineHtml(f, r)).join('')}</tbody></table>`;
    return `<li>${head}<div class="ch-body">${body}<p class="ch-tools"><button type="button" class="lnk" data-open-file="${esc(f.path)}">Open in Files</button></p></div></li>`;
  }
  function draw() {
    if (!main) { el.innerHTML = '<div class="side-empty"><p><b>Changes</b></p><p>Open a chat to see the files it changed, and comment on lines.</p></div>'; return; }
    const list = mine();
    const r = review();
    const running = starting || (r && r.status === 'running');
    const can = canReview() && files && files.some(f => f.status !== 'clean');
    const rvBtn = canReview() ? `<button type="button" class="btn ghost small" data-rv-start${can && !running ? '' : ' disabled'} title="${running ? 'A review is running' : can ? 'A read-only agent reviews these changes and lists findings at their lines' : 'Nothing to review yet'}">${running ? 'Reviewing…' : 'Review code'}</button>` : '';
    const top = `<div class="ch-top"><p class="ch-about">Files this chat's agent edited, against the last commit.</p>${rvBtn}<button type="button" class="btn ghost small" data-ch-refresh${loading ? ' disabled' : ''}>${loading ? 'Reading…' : 'Refresh'}</button></div>`;
    const body = err ? `<p class="hub-error">${esc(err)}</p>`
      : files == null ? '<p class="dim">Reading…</p>'
      : !files.length ? '<p class="dim">No files changed in this chat yet.</p>'
      : `<ul class="ch-files">${files.map(fileHtml).join('')}</ul>`;
    const foot = list.length ? `<div class="ch-foot"><span>${list.length} comment${list.length === 1 ? '' : 's'}</span><span class="grow"></span><button type="button" class="btn ghost small" data-ch-clear>Clear</button>` +
      `<button type="button" class="btn primary small" data-ch-send title="${busy() ? 'Queued until the agent is done' : 'Sends every comment to the chat as one message'}">Send to chat</button></div>` : '';
    const scroller = el.querySelector('.ch-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const a = document.activeElement, typing = a && el.contains(a) && a.matches && a.matches('[data-ch-text]');
    el.innerHTML = `${top}<div class="ch-scroll">${err || files == null ? '' : reviewHtml()}${body}</div>${foot}`;
    const s = el.querySelector('.ch-scroll');
    if (s) s.scrollTop = keep;
    const t = el.querySelector('[data-ch-text]');
    if (t && (typing || editing && editing.fresh)) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); if (editing) editing.fresh = false; }
  }
  el.addEventListener('input', e => {
    if (!e.target.matches('[data-ch-text]')) return;
    const was = !!draft.trim();
    draft = e.target.value;
    const add = el.querySelector('[data-ch-add]');
    if (add && was !== !!draft.trim()) add.disabled = !draft.trim();
  });
  el.addEventListener('keydown', e => {
    if (!e.target.matches('[data-ch-text]')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = null; draft = ''; draw(); }
  });
  function addComment() {
    if (!editing || !draft.trim()) return;
    const f = (files || []).find(x => x.path === editing.path);
    const row = f && diffRows(f.diff).find(r => (editing.side === 'old' ? r.old : r.new) === editing.line && (editing.side === 'old' ? r.kind !== 'add' : r.kind !== 'del'));
    mine().push({ id: 'c' + Math.random().toString(36).slice(2, 9), path: editing.path, side: editing.side, line: editing.line, quote: row ? row.text : '', body: draft.trim() });
    editing = null; draft = '';
    draw();
    onCount();
  }
  el.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.rvStart != null) { startReview(); return; }
    if (d.rvFix != null || d.rvDismiss != null || d.rvShow != null || d.rvAll != null || d.rvClose != null) {
      const r = review();
      if (!r) return;
      const f = r.findings.find(x => x.id === (d.rvFix || d.rvDismiss || d.rvShow));
      if (d.rvAll != null) sendFix(left(r));
      else if (d.rvClose != null) { reviews[main] = null; draw(); }
      else if (d.rvFix != null && f) sendFix([f]);
      else if (d.rvDismiss != null && f) { r.gone[f.id] = 'dismissed'; draw(); }
      else if (d.rvShow != null && f) {
        openPath = f.path; editing = null; draw();
        const row = el.querySelector(`[data-rv-at="${CSS.escape(f.id)}"]`) || el.querySelector(`[data-ch-open="${CSS.escape(f.path)}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      }
      return;
    }
    if (d.chOpen != null) { openPath = openPath === d.chOpen ? null : d.chOpen; editing = null; draw(); }
    else if (d.chRefresh != null) load();
    else if (d.chLine != null) { const [path, side, line] = d.chLine.split('|'); editing = { path, side, line: +line, fresh: true }; draft = ''; draw(); }
    else if (d.chAdd != null) addComment();
    else if (d.chCancel != null) { editing = null; draft = ''; draw(); }
    else if (d.chDel != null) { comments[main] = mine().filter(c => c.id !== d.chDel); draw(); onCount(); }
    else if (d.chClear != null) { comments[main] = []; draw(); onCount(); }
    else if (d.chSend != null) {
      const list = mine().slice();
      if (!list.length) return;
      if (await send(commentMessage(list))) { comments[main] = []; flash(list.length === 1 ? 'Comment sent to the chat.' : `${list.length} comments sent to the chat.`); draw(); onCount(); }
    }
  });

  draw();
  return {
    el,
    show(on) { visible = !!on; if (visible) { draw(); load(); loadReview(); } else clearTimeout(reviewTimer); },
    focus() { const b = el.querySelector('[data-ch-open]'); if (b) b.focus(); },
    /** The chat in view changed. */
    setSession(sid) {
      if (sid === main) return;
      main = sid || null; files = null; err = ''; openPath = null; editing = null; draft = ''; key = '';
      clearTimeout(reviewTimer);
      draw();
      if (visible && main) { load(); loadReview(); }
    },
    /** A turn ended: what it changed may be new. */
    changed() { if (visible && main) load(); },
    count: () => (main ? mine().length : 0)
  };
}

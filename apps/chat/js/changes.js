/* The workbench's Changes (Chat 4.1.0, docs/chat.md, Changes): what the chat in view changed, file by file, each
   with its diff against the repo's last commit (the connector's chat.changes). Click a line's + to comment on it;
   Send to chat sends every comment to the chat as one message, so the agent addresses them together, as with
   comments in Claude's desktop diff view. Comments wait here, per chat, until you send them or clear them. */
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

const STATUS = { modified: 'Changed', added: 'New', deleted: 'Deleted', clean: 'Committed or undone', binary: 'Binary' };

export function startChanges(ws, { send = async () => false, busy = () => false, flash = () => {}, onCount = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'changes';
  let main = null, files = null, err = '', loading = false, visible = false, openPath = null, editing = null, draft = '', at = null;
  const comments = {}; // session -> [{id, path, line, side, quote, body}]
  const mine = () => comments[main] || (comments[main] = []);

  async function load() {
    if (!main) return;
    const want = main;
    loading = true; draw();
    try {
      const r = await ws.connectors.call(OC, 'chat.changes', { session: want });
      if (main !== want) return;
      files = r.files || []; at = r.at; err = '';
      if (openPath && !files.some(f => f.path === openPath)) openPath = null;
      if (!openPath && files.length === 1) openPath = files[0].path;
    } catch (e) { if (main === want) err = e.message || "Couldn't read what this chat changed."; }
    loading = false; draw();
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
    const notes = here.map(c => `<tr class="ch-note"><td colspan="4"><p>${esc(c.body)}</p><button type="button" class="lnk" data-ch-del="${esc(c.id)}">Delete</button></td></tr>`).join('');
    return `<tr class="ch-${r.kind}"><td class="ch-n">${r.old ?? ''}</td><td class="ch-n">${r.new ?? ''}</td>` +
      `<td class="ch-plus">${can ? `<button type="button" class="ch-c" data-ch-line="${esc(f.path)}|${side}|${num}" title="Comment on this line" aria-label="Comment on line ${num}">+</button>` : ''}</td>` +
      `<td class="ch-tx"><span class="ch-s">${sign}</span>${esc(r.text)}</td></tr>${notes}${box}`;
  }
  function fileHtml(f) {
    const on = f.path === openPath;
    const n = mine().filter(c => c.path === f.path).length;
    const head = `<button type="button" class="ch-file${on ? ' on' : ''}" data-ch-open="${esc(f.path)}" aria-expanded="${on}"><span class="ch-path mono">${esc(f.path)}</span>` +
      `<span class="ch-st">${esc(STATUS[f.status] || f.status)}</span>${f.additions ? `<span class="ch-a">+${f.additions}</span>` : ''}${f.deletions ? `<span class="ch-d">-${f.deletions}</span>` : ''}${n ? `<span class="ch-k">${n}</span>` : ''}</button>`;
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
    const top = `<div class="ch-top"><p class="ch-about">Files this chat's agent edited, against the last commit.</p><button type="button" class="btn ghost small" data-ch-refresh${loading ? ' disabled' : ''}>${loading ? 'Reading…' : 'Refresh'}</button></div>`;
    const body = err ? `<p class="hub-error">${esc(err)}</p>`
      : files == null ? '<p class="dim">Reading…</p>'
      : !files.length ? '<p class="dim">No files changed in this chat yet.</p>'
      : `<ul class="ch-files">${files.map(fileHtml).join('')}</ul>`;
    const foot = list.length ? `<div class="ch-foot"><span>${list.length} comment${list.length === 1 ? '' : 's'}</span><span class="grow"></span><button type="button" class="btn ghost small" data-ch-clear>Clear</button>` +
      `<button type="button" class="btn primary small" data-ch-send title="${busy() ? 'Queued until the agent is done' : 'Sends every comment to the chat as one message'}">Send to chat</button></div>` : '';
    const scroller = el.querySelector('.ch-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const a = document.activeElement, typing = a && el.contains(a) && a.matches && a.matches('[data-ch-text]');
    el.innerHTML = `${top}<div class="ch-scroll">${body}</div>${foot}`;
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
    show(on) { visible = !!on; if (visible) { draw(); load(); } },
    focus() { const b = el.querySelector('[data-ch-open]'); if (b) b.focus(); },
    /** The chat in view changed. */
    setSession(sid) {
      if (sid === main) return;
      main = sid || null; files = null; err = ''; openPath = null; editing = null; draft = '';
      draw();
      if (visible && main) load();
    },
    /** A turn ended: what it changed may be new. */
    changed() { if (visible && main) load(); },
    count: () => (main ? mine().length : 0)
  };
}

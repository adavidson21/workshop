/* Workshop: the capture box shared by Home's quick capture and the Dispatch hub (docs/hub.md).

   createCaptureStore keeps the app's own `handoffs` collection (docs/handoffs.md): every capture the person
   accepts becomes an item there with accepted: true, and Docket, Rapport and Notes add it when they next load.
   No DOM, so Node tests drive it with a fake `ws` (shared/test/capture-box.test.mjs).

   mountCapture draws the input, a live preview of what Enter will do, and a Recent list with Undo. Keys:
     Enter          accept the preview (a question goes to onAsk, "> app" opens it)
     Tab            change what the preview is (task, waiting on, receipt, note, roadmap idea)
     Ctrl+Enter     send the line to onAsk as a question, whatever it looks like
     Escape         clear the input
     ArrowDown      into Recent; there j/k move, x or Delete undoes, e puts it back in the input, Escape returns
   Pasting several lines makes one pending proposal per line: Enter or "Accept all" sends them all. */
import { TARGET_NAMES, describe, isCapture, nextKind, parseCapture, parseLines, retarget, toHandoff } from './capture.js';

export const KEEP_DAYS = 60;   // docs/handoffs.md, rule 1
export const RECENT = 20;
const VERSION = 1;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const empty = sender => ({ schema: `${sender}.handoffs`, version: VERSION, rev: 0, items: [], deleted: {} });

export function createCaptureStore(ws, { sender, now = () => new Date() } = {}) {
  let env = null, waiting = false, newer = false;

  const waitFor = e => { if (e && e.code === 'unavailable') { waiting = true; return true; } return false; };

  async function load() {
    try {
      const e = await ws.data.get('handoffs');
      if (e && (e.schema !== `${sender}.handoffs` || e.version !== VERSION)) { newer = true; env = null; }
      else { newer = false; env = e || empty(sender); }
      waiting = false;
    } catch (e) { if (!waitFor(e)) throw e; }
    return state();
  }

  function state() {
    const items = env ? [...env.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)) : [];
    return { ready: !!env, waiting, newer, recent: items.slice(0, RECENT) };
  }

  // Drop offers older than KEEP_DAYS (a tombstone each, by stamp).
  function trim(items) {
    const cut = now().getTime() - KEEP_DAYS * 864e5;
    return items.filter(i => !(Date.parse(i.createdAt) < cut));
  }

  async function save(mutate) {
    if (waiting) { const e = new Error('Allow Workshop to use your folder first.'); e.code = 'unavailable'; throw e; }
    if (newer) { const e = new Error('These were saved by a newer Workshop. Update it to capture here.'); e.code = 'downgrade'; throw e; }
    if (!env) await load();
    const before = env, after = structuredClone(env);
    mutate(after);
    after.items = trim(after.items);
    ws.data.stamp(before, after);
    try {
      const r = await ws.data.put('handoffs', after);
      env = { ...after, rev: r.rev };
    } catch (err) {
      if (waitFor(err)) throw err;
      if (err.code !== 'conflict' || !err.current) throw err;
      const next = ws.data.merge(after, err.current);
      const r = await ws.data.put('handoffs', next);
      env = { ...next, rev: r.rev };
    }
    return state();
  }

  /* Accept proposals: one handoff each. Call only from the person's Enter or click (docs/handoffs.md, rule 4). */
  async function send(proposals) {
    const items = proposals.filter(isCapture).map(p => toHandoff(p, { sender, now: now() })).filter(Boolean);
    if (!items.length) return [];
    await save(e => { e.items.push(...items); });
    return items;
  }

  /* Undo: withdraw an offer (a tombstone). If the receiver already added it, the record stays there (rule 6). */
  async function withdraw(id) {
    let found = null;
    await save(e => { found = e.items.find(i => i.id === id) || null; e.items = e.items.filter(i => i.id !== id); });
    return found;
  }

  return { load, send, withdraw, state, get waiting() { return waiting; } };
}

/* The input, preview and Recent list inside `root`.
   opts: {ws, sender, context: () => ({today, people, lists}), onAsk(text), onGo({app, path?}), placeholder, hint} */
export function mountCapture(root, opts) {
  const { ws, sender } = opts;
  const store = opts.store || createCaptureStore(ws, { sender });
  let pending = [];      // proposals not yet sent (a multi-line paste, or the live preview)
  let override = null;   // kind chosen with Tab for the current line
  let sel = -1;          // selected Recent row
  let lastSent = [];     // ids of the last Enter, for Ctrl+Z
  let st = store.state();

  root.classList.add('capture');
  root.innerHTML = `
    <label class="cap-line"><span class="cap-prompt" aria-hidden="true">&gt;</span>
      <input class="cap-in" type="text" autocomplete="off" spellcheck="true" aria-label="Capture" placeholder="${esc(opts.placeholder || 'Capture a task, receipt or note. Ask with ?')}"></label>
    <div class="cap-preview" aria-live="polite"></div>
    <ol class="cap-recent" tabindex="-1" aria-label="Recent captures"></ol>
    <p class="cap-hint">${opts.hint || ''}</p>`;
  const input = root.querySelector('.cap-in');
  const preview = root.querySelector('.cap-preview');
  const list = root.querySelector('.cap-recent');

  const ctx = () => (opts.context ? opts.context() : {}) || {};
  const current = () => {
    if (pending.length > 1) return pending;
    const p = parseCapture(input.value, ctx());
    if (!p) return [];
    return [override && isCapture(p) ? retarget(p, override, ctx()) : p];
  };

  function drawPreview() {
    if (st.waiting) { preview.innerHTML = `<p class="cap-note">Allow Workshop to use your folder first (the bar at the top).</p>`; return; }
    if (st.newer) { preview.innerHTML = `<p class="cap-note">Captures here were saved by a newer Workshop. Update it to capture.</p>`; return; }
    const ps = current();
    if (!ps.length) { preview.innerHTML = ''; return; }
    const rows = ps.map(p => `<li><span class="cap-tag">${esc(describe(p))}</span> <span class="cap-text">${esc(p.title || p.text)}</span></li>`).join('');
    const many = ps.length > 1 ? `<button class="btn primary cap-all" type="button">Accept all ${ps.length}</button> <button class="btn ghost cap-clear" type="button">Clear</button>` : '';
    preview.innerHTML = `<ul class="cap-props">${rows}</ul><p class="cap-keys">${ps.length > 1 ? many : '<kbd>Enter</kbd> accept · <kbd>Tab</kbd> change · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ask'}</p>`;
  }

  function drawRecent() {
    list.innerHTML = st.recent.map((h, i) => `<li class="${i === sel ? 'sel' : ''}" data-id="${esc(h.id)}">
      <span class="cap-tag">${esc(TARGET_NAMES[h.to] || h.to)}</span>
      <span class="cap-text">${esc(h.text)}</span>
      <button class="btn ghost cap-undo" type="button" data-undo="${esc(h.id)}" title="Undo (x)">Undo</button></li>`).join('');
  }
  const draw = () => { drawPreview(); drawRecent(); };

  const fail = err => ws.toast(err && err.code === 'unavailable' ? 'Allow Workshop to use your folder first.' : err && err.code === 'downgrade' ? err.message : "Couldn't save that. Try again.", { kind: 'error' });

  async function accept() {
    const ps = current();
    if (!ps.length) return;
    const ask = ps.find(p => p.kind === 'ask');
    const go = ps.find(p => p.kind === 'go');
    if (ps.length === 1 && ask) { reset(); opts.onAsk && opts.onAsk(ask.text); return; }
    if (ps.length === 1 && go) { reset(); opts.onGo ? opts.onGo(go) : ws.open(go.path ? { app: go.app, path: go.path } : { app: go.app }); return; }
    try {
      const sent = await store.send(ps);
      lastSent = sent.map(h => h.id);
      st = store.state();
      reset();
      const skipped = ps.length - sent.length;
      if (skipped) ws.toast(`${skipped} line${skipped > 1 ? 's were' : ' was'} a question or a place, not sent.`);
    } catch (e) { fail(e); }
  }
  function reset() { input.value = ''; pending = []; override = null; draw(); }

  async function undo(id) {
    try {
      const h = await store.withdraw(id);
      st = store.state(); sel = Math.min(sel, st.recent.length - 1); draw();
      if (h) ws.toast(`Removed. If ${TARGET_NAMES[h.to] || h.to} already added it, remove it there too.`);
    } catch (e) { fail(e); }
  }

  input.addEventListener('input', () => { if (pending.length > 1) pending = []; override = null; drawPreview(); });
  input.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    pending = parseLines(text, ctx());
    input.value = '';
    drawPreview();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const text = input.value.replace(/^\?\s*/, '').trim();
      if (text) { reset(); opts.onAsk && opts.onAsk(text); }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); accept(); return; }
    if (e.key === 'Tab' && !e.shiftKey && input.value.trim() && pending.length < 2) {
      const p = current()[0];
      if (p && isCapture(p)) { e.preventDefault(); override = nextKind(p.kind); drawPreview(); }
      return;
    }
    if (e.key === 'Escape') { if (input.value || pending.length) { e.preventDefault(); reset(); } return; }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !input.value && lastSent.length) { e.preventDefault(); const ids = lastSent; lastSent = []; ids.forEach(undo); return; }
    if (e.key === 'ArrowDown' && st.recent.length) { e.preventDefault(); sel = 0; drawRecent(); list.focus(); }
  });
  list.addEventListener('keydown', e => {
    const h = st.recent[sel];
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, st.recent.length - 1); drawRecent(); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); if (sel <= 0) { sel = -1; drawRecent(); input.focus(); } else { sel--; drawRecent(); } }
    else if ((e.key === 'x' || e.key === 'Delete') && h) { e.preventDefault(); undo(h.id); }
    else if (e.key === 'e' && h) { e.preventDefault(); const text = h.text; undo(h.id).then(() => { input.value = text; sel = -1; draw(); input.focus(); }); }
    else if (e.key === 'Escape') { e.preventDefault(); sel = -1; drawRecent(); input.focus(); }
  });
  root.addEventListener('click', e => {
    const u = e.target.closest('[data-undo]');
    if (u) { undo(u.dataset.undo); return; }
    if (e.target.closest('.cap-all')) { accept(); return; }
    if (e.target.closest('.cap-clear')) reset();
  });

  async function refresh() {
    try { st = await store.load(); } catch (e) { /* keep what is shown */ }
    draw();
  }
  ws.data.subscribe('handoffs', refresh);
  ws.on('online', p => { if (p && p.online) refresh(); });
  draw();
  refresh();

  return {
    focus: () => input.focus(),
    fill: text => { input.value = String(text || ''); override = null; pending = []; drawPreview(); input.focus(); },
    refresh,
    store
  };
}

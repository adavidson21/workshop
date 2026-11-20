/* The workbench's Second chat (Chat 4.1.0, docs/chat.md, Two chats side by side): any other chat beside the one in
   view, with its own thread and box, like Claude's desktop split view. Pick it from the list here, or Alt-click a
   chat in the sidebar (or its Open beside button). Messages go to that chat's own agent and model (the last ones it
   used). Make it the main chat swaps it into the middle. */
import { esc } from './md.js';
import { promptClick, promptHtml, richRows } from './parts.js';
import { keepFocus, lastTandem, liveEchoes } from './thread.js';

const OC = 'opencode';
const BUSY_MS = 1000;

export function startSplit(ws, { chats = () => [], current = () => null, onMain = () => {}, paint = () => {}, flash = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'side split';
  let session = null, conv = null, err = '', sending = false, visible = false, timer = 0;
  const drafts = {}; // session -> text
  const echo = {}; // session -> [{text, at, base}]
  const open = new Set();
  const asked = { answers: {}, custom: {} };

  const busy = () => !!((conv && conv.busy) || (echo[session] || []).length);
  async function load() {
    clearTimeout(timer);
    if (!session || !visible) return;
    const want = session;
    try {
      const r = await ws.connectors.call(OC, 'chat.messages', { session: want });
      if (session !== want) return;
      conv = r; err = r.error || '';
      if (echo[want]) echo[want] = liveEchoes(echo[want], r.turns, { busy: !!r.busy });
    } catch (e) {
      if (session !== want) return;
      err = e && e.code === 'not_found' ? 'That chat is gone.' : e.message || "Couldn't read that chat.";
    }
    draw();
    if (session === want && visible && conv && (conv.busy || conv.waiting || (echo[want] || []).length)) timer = setTimeout(load, BUSY_MS);
  }
  async function send() {
    const text = String(drafts[session] || '').trim();
    if (!session || !text || sending) return;
    if (busy()) { flash('That chat is still working. Send when it is done.'); return; }
    const mine = { text, at: Date.now(), base: conv ? (conv.turns || []).length : 0 };
    echo[session] = [...(echo[session] || []), mine];
    drafts[session] = '';
    sending = true; err = ''; draw();
    try {
      await ws.connectors.call(OC, 'chat.send', { session, text, ...(conv && conv.agent ? { agent: conv.agent } : {}), ...(conv && conv.model ? { model: conv.model } : {}) }, { confirm: true });
    } catch (e) {
      echo[session] = (echo[session] || []).filter(x => x !== mine);
      err = e.message || "Couldn't send that.";
      if (!drafts[session]) drafts[session] = text;
    }
    sending = false; draw();
    setTimeout(load, 400);
  }
  async function answer(args) {
    try { await ws.connectors.call(OC, 'answer', args, { confirm: true }); }
    catch (e) { flash(e.message || "Couldn't answer that."); }
    load();
  }
  function pickHtml() {
    const main = current();
    const list = chats().filter(c => c.session !== main);
    const opts = `<option value="">Pick a chat</option>` + list.map(c => `<option value="${esc(c.session)}"${c.session === session ? ' selected' : ''}>${esc(c.title || 'Chat')}</option>`).join('');
    return `<div class="split-top"><label class="split-pick"><span class="sr">Chat beside</span><select data-split-pick title="The chat beside the one in view">${opts}</select></label>` +
      (session ? `<button type="button" class="btn ghost small" data-split-main title="Swap: this chat in the middle">Make it the main chat</button>` : '') + '</div>';
  }
  function draw() {
    if (!session) {
      const none = !chats().some(c => c.session !== current());
      el.innerHTML = pickHtml() + `<div class="side-empty"><p><b>Second chat</b></p><p>${none ? 'Start another chat first, or turn on All in the sidebar to pick any session in the workspace.' : 'Pick a chat to keep it open beside this one. Alt-click a chat in the sidebar does the same.'}</p></div>`;
      return;
    }
    const turns = (conv && conv.turns) || [];
    const b = busy();
    const echoTurns = (echo[session] || []).map(e => ({ id: '', role: 'you', text: e.text, parts: [] }));
    let rows = richRows(turns.concat(echoTurns), { open, busy: b, activity: (conv && conv.activity) || (sending ? 'Sending' : ''), session });
    if (!conv && !err) rows += '<p class="hub-meta">Loading...</p>';
    if (conv && Array.isArray(conv.prompts)) rows += conv.prompts.map(p => promptHtml(p, asked)).join('');
    if (err) rows += `<p class="hub-error">${esc(err)}</p>`;
    const draft = drafts[session] || '';
    const back = keepFocus(el);
    const scroller = el.querySelector('.side-scroll');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    el.innerHTML = pickHtml() + `<div class="side-scroll"><div class="turns">${rows}</div></div>` +
      `<div class="side-compose"><div class="chat-box"><textarea rows="1" data-keep="split:${esc(session)}" data-split-in placeholder="Message this chat" aria-label="Message the chat beside">${esc(draft)}</textarea>` +
      `<div class="chat-bar"><span class="dim small">${esc((conv && conv.agent) || '')}</span><span class="grow"></span>` +
      `<button type="button" class="chat-send" data-split-send title="Send" aria-label="Send"${sending || !draft.trim() ? ' disabled' : ''}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button></div></div></div>`;
    back();
    const t = el.querySelector('[data-split-in]');
    if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; }
    const s = el.querySelector('.side-scroll');
    if (s && atEnd) s.scrollTop = s.scrollHeight;
    paint(el);
  }
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-split-in]')) {
      const was = !!String(drafts[session] || '').trim();
      drafts[session] = t.value;
      t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px';
      const b = el.querySelector('[data-split-send]');
      if (b && was !== !!t.value.trim()) b.disabled = sending || !t.value.trim();
    } else if (t.hasAttribute('data-q-custom')) { const id = t.getAttribute('data-q-custom'); (asked.custom[id] = asked.custom[id] || {})[+t.getAttribute('data-qi')] = t.value; }
  });
  el.addEventListener('change', e => { if (e.target.matches('[data-split-pick]')) setChat(e.target.value || null); });
  el.addEventListener('keydown', e => {
    if (e.target.matches('[data-split-in]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.splitSend != null) send();
    else if (d.splitMain != null) { const was = session; setChat(current()); onMain(was); }
    else if (d.tool != null) { if (open.has(d.tool)) open.delete(d.tool); else open.add(d.tool); draw(); }
    else if (d.copy != null) return; // chat.js copies code blocks from the workbench too
    else {
      const r = promptClick(d, (conv && conv.prompts) || [], asked);
      if (r && r.answer) answer(r.answer); else if (r && r.redraw) draw();
    }
  });
  function setChat(sid) {
    clearTimeout(timer);
    session = sid || null; conv = null; err = '';
    draw();
    load();
  }

  // Drawn when first shown: the chat list it offers is not there yet while Chat starts.
  return {
    el,
    show(on) { visible = !!on; if (visible) { draw(); load(); } else clearTimeout(timer); },
    focus() { const t = el.querySelector('[data-split-in]') || el.querySelector('[data-split-pick]'); if (t) t.focus(); },
    /** Alt-click or Open beside in the sidebar. */
    open(sid) { setChat(sid); },
    /** The list changed (titles, a removed chat). */
    refresh() { if (visible) draw(); },
    session: () => session,
    lastAnswer: () => lastTandem((conv && conv.turns) || [])
  };
}

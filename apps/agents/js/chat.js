/* Dispatch: the Chat tab (docs/chat.md), laid out like ChatGPT (Dispatch 4.1.0):
   - A sidebar of chats: New chat, search, the list grouped by Today, Yesterday, Previous 7 days and Older. Each row can
     be renamed or removed. The sidebar collapses (kept in this browser); on a phone it is a drawer.
   - One chat in view: the messages in a centered column, the composer pinned at the bottom.
   - New chat: the hub's box (hub.js) in the middle of the pane. Every first message goes through Tandem's /hub, so
     one box still captures: a capture comes back as rows to accept right there (not listed as a chat), and anything
     else (a question, a suggested action, a choice) becomes a chat in the sidebar and opens.

   Replies go to Tandem's read-only `chat` agent through the opencode connector (chat.send, write: true, Enter or
   Send is the click). It reads code, repo guides, product notes and .work, and changes nothing. Starting work stays
   behind buttons with confirms: Make it a spike. When Tandem asks you something in a chat, the question is
   answered right in the thread (asksHtml, the same controls as the Inbox).

   Drawn into its own element, which main.js moves into the page when the Chat tab is in view, so typing survives
   Dispatch's repaints. The hub's element (hubEl) is moved into the New chat pane the same way. */
import { esc } from './hub-model.js';
import { WRITING, groupChats, keepFocus, lastTandem, matchChat, tandemTurn, turnRows, youTurn } from './thread.js';

const OC = 'opencode';
const LIST_MS = 10000;
const BUSY_MS = 1500;
const SIDE_KEY = 'dispatch.chatSide';
const PHONE = '(max-width: 820px)';

const ICON = {
  side: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="9.5" y1="4.5" x2="9.5" y2="19.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>'
};

function loadSide() { try { return localStorage.getItem(SIDE_KEY) === 'closed'; } catch (e) { return false; } }
function saveSide(closed) { try { localStorage.setItem(SIDE_KEY, closed ? 'closed' : 'open'); } catch (e) { /* blocked */ } }
const phone = () => typeof matchMedia === 'function' && matchMedia(PHONE).matches;

export function startChat(ws, { hub = null, hubEl = null, asksHtml = () => '', noteOf = async () => {}, aiReady = () => ({ ready: false, why: '' }) } = {}) {
  const el = document.createElement('section');
  el.className = 'chat';
  el.setAttribute('aria-label', 'Chat');
  let items = [], sel = null, conv = null, err = '', listErr = '', sending = false, visible = false;
  let query = '', renaming = null, renameText = '', closed = loadSide(), drawer = false;
  const drafts = {};
  const pending = new Map(); // session -> item, for a chat the hub just opened that the connector has not listed yet
  let listTimer = 0, convTimer = 0;

  /* ---------- data ---------- */
  const listed = () => {
    const out = items.slice();
    for (const [sid, it] of pending) if (!out.some(c => c.session === sid)) out.push(it);
    return out;
  };
  const itemOf = sid => listed().find(c => c.session === sid) || null;
  async function loadList() {
    clearTimeout(listTimer);
    if (!aiReady().ready) { items = []; listErr = ''; draw(); return; }
    try {
      items = (await ws.connectors.call(OC, 'chat.list', {})).items || [];
      listErr = '';
      for (const c of items) pending.delete(c.session);
    } catch (e) { listErr = e.message || "Couldn't list your chats."; }
    if (sel && hub) { const it = itemOf(sel); if (it && it.hub) hub.ensure(it); }
    draw();
    if (visible) listTimer = setTimeout(loadList, LIST_MS);
  }
  async function loadConv() {
    clearTimeout(convTimer);
    if (!sel) return;
    const want = sel;
    try {
      const r = await ws.connectors.call(OC, 'chat.messages', { session: want });
      if (sel !== want) return;
      conv = r; err = r.error || '';
    } catch (e) { if (sel === want) err = e.message || "Couldn't read this chat."; }
    draw();
    if (sel === want && conv && (conv.busy || conv.waiting) && visible) convTimer = setTimeout(loadConv, BUSY_MS);
  }
  function select(session) {
    if (!session && hub) hub.clearDone();
    sel = session || null; conv = null; err = ''; renaming = null;
    if (phone()) drawer = false;
    if (sel && hub) { const it = itemOf(sel); if (it && it.hub) hub.ensure(it); }
    draw();
    if (sel) loadConv();
    focusBox();
  }
  function focusBox() {
    const box = sel ? el.querySelector('[data-keep^="chat:"]') : hubEl && hubEl.querySelector('.cap-in');
    if (box && !box.disabled) box.focus();
  }

  /* ---------- sending ---------- */
  async function send() {
    if (!sel) return;
    const text = String(drafts[sel] || '').trim();
    if (!text || sending) return;
    sending = true; err = ''; draw();
    try {
      await ws.connectors.call(OC, 'chat.send', { session: sel, text }, { confirm: true });
      drafts[sel] = '';
      conv = { ...(conv || {}), busy: true, turns: [...((conv && conv.turns) || []), { role: 'you', text }] };
      setTimeout(loadConv, 400);
    } catch (e) {
      err = /no chat agent/.test(e.message || '') ? 'Tandem has no chat agent yet. Run the Tandem install command again (eng-agents Core 2.14.0), then restart opencode.' : (e.message || "Couldn't send that.");
    }
    sending = false; draw();
    focusBox();
  }
  async function stop() {
    if (!sel) return;
    try { await ws.connectors.call(OC, 'abort', { session: sel }, { confirm: true }); } catch (e) { ws.toast(e.message || "Couldn't stop it.", { kind: 'error' }); }
    loadConv();
  }
  async function remove(session) {
    try { await ws.connectors.call(OC, 'chat.remove', { session }); } catch (e) { ws.toast(e.message || "Couldn't remove that.", { kind: 'error' }); return; }
    pending.delete(session);
    items = items.filter(c => c.session !== session);
    if (sel === session) select(null); else draw();
    loadList();
  }
  async function rename() {
    const session = renaming, title = renameText.replace(/\s+/g, ' ').trim();
    renaming = null;
    const it = itemOf(session);
    if (!session || !title || !it || title === it.title) { draw(); return; }
    it.title = title.slice(0, 80);
    draw();
    try { await ws.connectors.call(OC, 'chat.rename', { session, title: it.title }); }
    catch (e) { ws.toast(e.message || "Couldn't rename that.", { kind: 'error' }); }
    loadList();
  }
  function titleOf(sid) { const c = itemOf(sid) || conv || {}; return c.title || 'Chat'; }
  async function spike() {
    const topic = titleOf(sel);
    try { await ws.connectors.call(OC, 'spike', { topic: topic.slice(0, 500) }, { confirm: true }); ws.toast('Spike started. Follow it on Work.', { kind: 'success' }); }
    catch (e) { ws.toast(e.message || 'Could not start the spike.', { kind: 'error' }); }
  }
  function toggleSide() {
    if (phone()) drawer = !drawer;
    else { closed = !closed; saveSide(closed); }
    draw();
    if (!closed || drawer) { const s = el.querySelector('[data-chat-search]'); if (s && drawer) s.focus(); }
  }

  /* ---------- drawing ---------- */
  function rowHtml(c) {
    if (renaming === c.session) {
      return `<li class="chat-row renaming"><input class="chat-rename" data-keep="chat-rename" data-chat-rename-box value="${esc(renameText)}" aria-label="Name this chat" maxlength="80"></li>`;
    }
    return `<li class="chat-row${c.session === sel ? ' on' : ''}"><button type="button" class="chat-item${c.session === sel ? ' on' : ''}" data-chat-open="${esc(c.session)}"${c.session === sel ? ' aria-current="true"' : ''}>` +
      `<span class="chat-t">${c.busy ? '<span class="spin" aria-hidden="true"></span>' : ''}${esc(c.title)}</span>` +
      (c.waiting ? '<span class="chat-dot" title="Tandem is asking you something"><span class="sr">Needs you</span></span>' : '') + '</button>' +
      `<span class="chat-acts"><button type="button" class="chat-act" data-chat-rename="${esc(c.session)}" title="Rename" aria-label="Rename ${esc(c.title)}">${ICON.pen}</button>` +
      `<button type="button" class="chat-act" data-chat-remove="${esc(c.session)}" title="Remove from this list. The opencode session is kept." aria-label="Remove ${esc(c.title)}">${ICON.x}</button></span></li>`;
  }
  function sideHtml() {
    const all = listed();
    const shown = all.filter(c => matchChat(c, query));
    const groups = groupChats(shown);
    const list = groups.map(g => `<h3 class="chat-h">${esc(g.label)}</h3><ul>${g.items.map(rowHtml).join('')}</ul>`).join('');
    const empty = !all.length
      ? (aiReady().ready ? '<p class="chat-empty">Your chats show here. Ask Tandem something to start one.</p>' : '<p class="chat-empty">Turn on AI with the sparkle button in New chat to talk to Tandem.</p>')
      : !shown.length ? `<p class="chat-empty">No chats match "${esc(query)}".</p>` : '';
    return `<aside class="chat-side" aria-label="Chats">` +
      `<div class="chat-side-top"><button type="button" class="chat-icon" data-chat-side title="Close sidebar" aria-label="Close sidebar">${ICON.side}</button>` +
      `<button type="button" class="chat-icon" data-chat-new title="New chat" aria-label="New chat">${ICON.plus}</button></div>` +
      `<button type="button" class="chat-newbtn${sel ? '' : ' on'}" data-chat-new>${ICON.plus}<span>New chat</span></button>` +
      `<input type="search" class="chat-search" data-keep="chat-search" data-chat-search placeholder="Search chats" aria-label="Search chats" value="${esc(query)}">` +
      (listErr ? `<p class="hub-error">${esc(listErr)}</p>` : '') +
      `<nav class="chat-list">${list}${empty}</nav></aside>`;
  }
  function topHtml(title, extra = '') {
    const sideBtn = closed || phone()
      ? `<button type="button" class="chat-icon" data-chat-side title="Open sidebar" aria-label="Open sidebar">${ICON.side}</button>` +
        (sel ? `<button type="button" class="chat-icon" data-chat-new title="New chat" aria-label="New chat">${ICON.plus}</button>` : '')
      : '';
    return `<header class="chat-top">${sideBtn}<h2>${esc(title)}</h2>${extra}</header>`;
  }
  function paneHtml() {
    if (!sel) {
      return `<div class="chat-pane chat-home">${topHtml('New chat')}<div class="chat-scroll"><div class="chat-col chat-start">` +
        '<h3 class="chat-hello">What do you want to ask or capture?</h3>' +
        '<p class="hub-meta">Ask about your repos and work, or capture a task, receipt or note. Tandem reads and changes nothing on its own.</p>' +
        '<div class="chat-hub" data-hub-home></div></div></div></div>';
    }
    const busy = !!(conv && conv.busy);
    const c = itemOf(sel) || conv || {};
    const fromHub = c.from === 'hub' || (conv && conv.from === 'hub') || !!c.hub;
    const head = topHtml(c.title || 'Chat', `<span class="row">${busy ? `<button type="button" class="btn ghost" data-chat-stop>Stop</button>` : ''}</span>`);
    // A hub chat's first question and answer come from the hub's card (the connector leaves the /hub run out).
    const later = (conv && conv.turns) || [];
    const first = fromHub && hub ? hub.intro(sel, { actions: !later.length }) : null;
    let rows = '';
    if (first) {
      rows += youTurn(first.text);
      rows += first.running ? WRITING : tandemTurn(first.html);
    } else if (fromHub) {
      rows += youTurn(c.title || '');
      rows += '<p class="hub-meta">Loading the answer...</p>';
    }
    rows += turnRows(later, { busy: busy && !(first && first.running) });
    if (!conv && !first && !fromHub) rows += '<p class="hub-meta">Loading...</p>';
    if (conv && conv.waiting) rows += asksHtml(sel) || '<p class="hub-meta">Tandem is asking you something. Answer it in the Inbox.</p>';
    if (conv && !busy && later.length && lastTandem(later)) rows += '<p class="hub-actions chat-after"><button class="btn" type="button" data-chat-spike>Make it a spike</button><button class="btn ghost" type="button" data-chat-note>Save as note</button></p>';
    if (err) rows += `<p class="hub-error">${esc(err)}</p>`;
    const off = !aiReady().ready;
    const lock = off || busy || sending;
    const box = `<div class="chat-compose"><div class="chat-col"><div class="chat-box"><textarea rows="1" data-keep="chat:${esc(sel)}" placeholder="${off ? 'Turn on AI with the sparkle button in New chat' : 'Message Tandem'}" aria-label="Message to Tandem"${lock ? ' disabled' : ''}>${esc(drafts[sel] || '')}</textarea>` +
      (busy ? `<button type="button" class="chat-send stop" data-chat-stop title="Stop" aria-label="Stop">${ICON.stop}</button>`
        : `<button type="button" class="chat-send" data-chat-send title="Send" aria-label="Send"${lock ? ' disabled' : ''}>${ICON.up}</button>`) + '</div>' +
      `<p class="chat-hint">${off ? esc(aiReady().why || 'AI is off.') : 'Read only. Enter sends, Shift+Enter for a new line.'}</p></div></div>`;
    return `<div class="chat-pane">${head}<div class="chat-scroll" data-chat-follow><div class="chat-col"><div class="turns">${rows}</div></div></div>${box}</div>`;
  }
  /* Put the hub's element in the New chat pane, keeping focus and the caret if it was being typed in. */
  function mountHub() {
    // Only while the tab is on the page: before Dispatch is connected the hub lives under the setup page.
    if (!hubEl || !el.isConnected) return;
    const home = el.querySelector('[data-hub-home]');
    if (!home || home.contains(hubEl)) return;
    const a = document.activeElement, mine = a && hubEl.contains(a) ? a : null;
    const range = mine && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    home.appendChild(hubEl);
    if (mine) { mine.focus(); if (range) try { mine.setSelectionRange(range[0], range[1]); } catch (e) { /* not a text field */ } }
  }
  /* The tab fills the window under Dispatch's header: the page's offset sets the height (agents.css, .chat). */
  function fit() {
    if (!el.isConnected) return;
    const top = Math.max(0, Math.round(el.getBoundingClientRect().top + (window.scrollY || 0)));
    el.style.setProperty('--chat-top', (top + 20) + 'px');
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (visible) fit(); });
  function grow(t) { if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; }
  let lastHtml = null, lastFirst = null;
  function draw() {
    el.classList.toggle('side-closed', closed);
    el.classList.toggle('drawer-open', drawer);
    const html = sideHtml() + paneHtml() + (drawer ? '<div class="chat-scrim" data-chat-side></div>' : '');
    // Same markup: leave it, so the row under the pointer keeps its hover (no flicker).
    if (html === lastHtml && el.firstChild === lastFirst && el.firstChild) { mountHub(); return; }
    const scroller = el.querySelector('[data-chat-follow]');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    const a = document.activeElement, inHub = hubEl && a && hubEl.contains(a) ? a : null;
    const range = inHub && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    const back = keepFocus(el);
    if (hubEl && el.contains(hubEl)) hubEl.remove();
    el.innerHTML = html;
    lastHtml = html; lastFirst = el.firstChild;
    back();
    mountHub();
    if (inHub && hubEl.contains(inHub)) { inHub.focus(); if (range) try { inHub.setSelectionRange(range[0], range[1]); } catch (e) { /* not a text field */ } }
    grow(el.querySelector('[data-keep^="chat:"]'));
    const s = el.querySelector('[data-chat-follow]');
    if (s && atEnd) s.scrollTop = s.scrollHeight;
  }

  /* ---------- input ---------- */
  el.addEventListener('input', e => {
    const t = e.target;
    const k = t.getAttribute && t.getAttribute('data-keep');
    if (k && k.startsWith('chat:')) { drafts[k.slice(5)] = t.value; grow(t); }
    else if (k === 'chat-search') { query = t.value; draw(); }
    else if (k === 'chat-rename') renameText = t.value;
  });
  el.addEventListener('keydown', e => {
    const t = e.target;
    if (t.matches && t.matches('[data-keep^="chat:"]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    else if (t.matches && t.matches('[data-chat-rename-box]')) {
      if (e.key === 'Enter') { e.preventDefault(); rename(); }
      else if (e.key === 'Escape') { e.preventDefault(); renaming = null; draw(); }
    } else if (t.matches && t.matches('[data-chat-search]') && e.key === 'Escape' && query) { e.preventDefault(); query = ''; draw(); }
  });
  el.addEventListener('focusout', e => {
    // Clicking away saves the new name, like Enter.
    if (e.target.matches && e.target.matches('[data-chat-rename-box]') && renaming) setTimeout(() => { if (renaming) rename(); }, 0);
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button,[data-chat-side]');
    if (!b || (hubEl && hubEl.contains(b))) return;
    // A button in a hub chat's first answer (Make it a spike, Save as note, a suggested action, a choice).
    if (hub && b.closest('.hub-intro') && hub.click(b)) return;
    const d = b.dataset;
    if (d.chatOpen != null) select(d.chatOpen);
    else if (d.chatNew != null) select(null);
    else if (d.chatSide != null) toggleSide();
    else if (d.chatSend != null) send();
    else if (d.chatStop != null) stop();
    else if (d.chatRemove != null) remove(d.chatRemove);
    else if (d.chatRename != null) {
      renaming = d.chatRename; renameText = (itemOf(renaming) || {}).title || '';
      draw();
      const box = el.querySelector('[data-chat-rename-box]');
      if (box) { box.focus(); box.select(); }
    }
    else if (d.chatSpike != null) spike();
    else if (d.chatNote != null && conv) noteOf(titleOf(sel), lastTandem(conv.turns) || ((hub && hub.intro(sel)) || {}).answer || '');
  });

  draw();
  return {
    el,
    /* main.js calls this when the Chat tab comes into view or leaves it. */
    show(on) {
      if (on) { mountHub(); fit(); }
      if (on === visible) return;
      visible = on;
      clearTimeout(listTimer); clearTimeout(convTimer);
      if (on) { loadList(); if (sel) loadConv(); }
    },
    /* Take the hub's element back into the New chat pane (after the setup page had it). */
    mountHub,
    /* Open one chat (#/agents/chat/<session>, an Inbox Open); null: New chat. */
    open(session) { select(session); loadList(); },
    /* The hub turned a message into a chat: list it now and open it. */
    opened(card) {
      if (!card || !card.session) return;
      if (!items.some(c => c.session === card.session)) pending.set(card.session, { session: card.session, from: 'hub', hub: card.id, title: String(card.text || 'Chat').replace(/\s+/g, ' ').trim().slice(0, 80), at: card.at, last: card.at, busy: card.state === 'running' });
      select(card.session);
      loadList();
    },
    /* The agents' prompts or a hub card changed (main.js, hub.js): redraw. */
    redraw() { if (sel && visible && conv && conv.waiting !== !!asksHtml(sel)) loadConv(); else draw(); },
    refresh: loadList
  };
}

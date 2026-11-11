/* Dispatch: the Chat tab (docs/chat.md). One place to talk to Tandem:
   - Ask or capture (the first entry, open by default): the hub (hub.js). Its box is the one composer: every message
     goes through Tandem's /hub, so captures come back as rows to accept and questions come back answered, each as
     a card you can reply under.
   - Conversations: hub threads you replied to (From the hub) and chats from before Dispatch 2.0 (You started), with
     their turns and a reply box. Automated work (runs, PR reviews, the hub's own routing) never shows here.

   Replies go to Tandem's read-only `chat` agent through the opencode connector (chat.send, write: true, Enter or
   Send is the click). It reads code, repo guides, product notes and .work, and changes nothing. Starting work stays
   behind buttons with confirms: Make it a spike. When Tandem asks you something in a conversation, the question is
   answered right in the thread (asksHtml, the same controls as the Inbox).

   Drawn into its own element, which main.js moves into the page when the Chat tab is in view, so typing survives
   Dispatch's repaints. The hub's element (hubEl) is moved into the Ask or capture pane the same way. */
import { esc } from './hub-model.js';
import { keepFocus, lastTandem, since, turnsHtml } from './thread.js';

const OC = 'opencode';
const LIST_MS = 10000;
const BUSY_MS = 1500;

export function startChat(ws, { hubEl = null, intro = () => null, asksHtml = () => '', noteOf = async () => {}, aiReady = () => ({ ready: false, why: '' }) } = {}) {
  const el = document.createElement('section');
  el.className = 'chat';
  el.setAttribute('aria-label', 'Chat');
  let items = [], sel = null, conv = null, err = '', listErr = '', sending = false, visible = false;
  const drafts = {};
  let listTimer = 0, convTimer = 0;

  /* ---------- data ---------- */
  async function loadList() {
    clearTimeout(listTimer);
    if (!aiReady().ready) { items = []; listErr = ''; draw(); return; }
    try { items = (await ws.connectors.call(OC, 'chat.list', {})).items || []; listErr = ''; }
    catch (e) { listErr = e.message || "Couldn't list your conversations."; }
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
    } catch (e) { if (sel === want) err = e.message || "Couldn't read this conversation."; }
    draw();
    if (sel === want && conv && (conv.busy || conv.waiting) && visible) convTimer = setTimeout(loadConv, BUSY_MS);
  }
  function select(session) {
    sel = session || null; conv = null; err = '';
    draw();
    if (sel) loadConv();
    const box = sel ? el.querySelector('[data-keep]') : hubEl && hubEl.querySelector('.cap-in');
    if (box) box.focus();
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
  }
  async function stop() {
    if (!sel) return;
    try { await ws.connectors.call(OC, 'abort', { session: sel }, { confirm: true }); } catch (e) { ws.toast(e.message || "Couldn't stop it.", { kind: 'error' }); }
    loadConv();
  }
  async function remove(session) {
    try { await ws.connectors.call(OC, 'chat.remove', { session }); } catch (e) { ws.toast(e.message || "Couldn't remove that.", { kind: 'error' }); return; }
    if (sel === session) select(null);
    loadList();
  }
  async function spike() {
    const topic = (conv && conv.title) || '';
    if (!topic) return;
    try { await ws.connectors.call(OC, 'spike', { topic: topic.slice(0, 500) }, { confirm: true }); ws.toast('Spike started. Follow it on Work.', { kind: 'success' }); }
    catch (e) { ws.toast(e.message || 'Could not start the spike.', { kind: 'error' }); }
  }

  /* ---------- drawing ---------- */
  const tag = c => c.from === 'hub' ? '<span class="chat-tag hub">From the hub</span>' : '<span class="chat-tag">You started</span>';
  function listHtml() {
    const rows = items.map(c => `<li><button type="button" class="chat-item${c.session === sel ? ' on' : ''}" data-chat-open="${esc(c.session)}">` +
      `<span class="chat-t">${c.busy ? '<span class="spin" aria-hidden="true"></span>' : ''}${esc(c.title)}</span>` +
      `<span class="chat-m">${tag(c)}${c.waiting ? '<span class="chat-tag warn">Needs you</span>' : ''}<span>${esc(since(c.last))}</span></span></button></li>`).join('');
    return `<aside class="chat-list"><button type="button" class="chat-item new${sel ? '' : ' on'}" data-chat-new><span class="chat-t">Ask or capture</span><span class="chat-m"><span>Questions, tasks, notes, receipts</span></span></button>` +
      '<h3 class="chat-h">Conversations</h3>' +
      (listErr ? `<p class="hub-error">${esc(listErr)}</p>` : '') +
      (rows ? `<ul>${rows}</ul>` : '<p class="hub-meta">Reply under a hub answer and the conversation is kept here.</p>') + '</aside>';
  }
  function convHtml() {
    if (!sel) {
      return '<div class="chat-conv chat-home"><header class="chat-head"><h2>Ask or capture</h2><span class="hub-meta">Ask about your repos and work, or capture a task, receipt or note. Tandem reads and changes nothing on its own.</span></header><div class="chat-hub" data-hub-home></div></div>';
    }
    const busy = !!(conv && conv.busy);
    const c = items.find(x => x.session === sel) || conv || {};
    const head = `<header class="chat-head"><h2>${esc(c.title || 'Conversation')}</h2>${c.from ? tag(c) : ''}<span class="row">` +
      (busy ? '<button type="button" class="btn danger" data-chat-stop>Stop</button>' : '') +
      `<button type="button" class="btn ghost" data-chat-remove="${esc(sel)}" title="Stop listing it here. The opencode session is kept.">Remove</button></span></header>`;
    // A hub thread's first question and answer come from the hub's card (the connector leaves the /hub run out).
    const first = c.from === 'hub' || (conv && conv.from === 'hub') ? intro(sel) : null;
    const turns = (first ? [{ role: 'you', text: first.text }].concat(first.answer ? [{ role: 'tandem', text: first.answer }] : []) : []).concat((conv && conv.turns) || []);
    let body = conv || first ? turnsHtml(turns, { busy }) : '<p class="hub-meta">Loading...</p>';
    if (conv && conv.waiting) body += asksHtml(sel) || '<p class="hub-meta">Tandem is asking you something. Answer it in the Inbox.</p>';
    if (conv && !busy && lastTandem(turns)) body += '<p class="hub-actions"><button class="btn" type="button" data-chat-spike>Make it a spike</button><button class="btn ghost" type="button" data-chat-note>Save as note</button></p>';
    if (err) body += `<p class="hub-error">${esc(err)}</p>`;
    const off = !aiReady().ready;
    const box = `<div class="chat-box"><textarea rows="3" data-keep="chat:${esc(sel)}" placeholder="${off ? 'Turn on AI with the sparkle button in Ask or capture' : 'Reply. Enter sends, Shift+Enter for a new line'}" aria-label="Message to Tandem"${off || busy || sending ? ' disabled' : ''}>${esc(drafts[sel] || '')}</textarea>` +
      `<button type="button" class="btn primary" data-chat-send${off || busy || sending ? ' disabled' : ''}>Send</button></div>`;
    return `<div class="chat-conv">${head}<div class="chat-body" data-chat-follow>${body}</div>${box}${off ? `<p class="hub-meta">${esc(aiReady().why || 'AI is off.')}</p>` : ''}</div>`;
  }
  /* Put the hub's element in the Ask or capture pane, keeping focus and the caret if it was being typed in. */
  function mountHub() {
    if (!hubEl) return;
    const home = el.querySelector('[data-hub-home]');
    if (!home || home.contains(hubEl)) return;
    const a = document.activeElement, mine = a && hubEl.contains(a) ? a : null;
    const range = mine && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    home.appendChild(hubEl);
    if (mine) { mine.focus(); if (range) try { mine.setSelectionRange(range[0], range[1]); } catch (e) { /* not a text field */ } }
  }
  let lastHtml = null, lastFirst = null;
  function draw() {
    const html = listHtml() + convHtml();
    // Same markup: leave it, so the item under the pointer keeps its hover (no flicker).
    if (html === lastHtml && el.firstChild === lastFirst && el.firstChild) { mountHub(); return; }
    const scroller = el.querySelector('[data-chat-follow]');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const a = document.activeElement, inHub = hubEl && a && hubEl.contains(a) ? a : null;
    const range = inHub && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    const back = keepFocus(el);
    if (hubEl && el.contains(hubEl)) hubEl.remove();
    el.innerHTML = html;
    lastHtml = html; lastFirst = el.firstChild;
    back();
    mountHub();
    if (inHub && hubEl.contains(inHub)) { inHub.focus(); if (range) try { inHub.setSelectionRange(range[0], range[1]); } catch (e) { /* not a text field */ } }
    const s = el.querySelector('[data-chat-follow]');
    if (s && atEnd) s.scrollTop = s.scrollHeight;
  }

  /* ---------- input ---------- */
  el.addEventListener('input', e => {
    const k = e.target.getAttribute && e.target.getAttribute('data-keep');
    if (k && k.startsWith('chat:')) drafts[k.slice(5)] = e.target.value;
  });
  el.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('[data-keep^="chat:"]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || (hubEl && hubEl.contains(b))) return;
    const d = b.dataset;
    if (d.chatOpen != null) select(d.chatOpen);
    else if (d.chatNew != null) select(null);
    else if (d.chatSend != null) send();
    else if (d.chatStop != null) stop();
    else if (d.chatRemove != null) remove(d.chatRemove);
    else if (d.chatSpike != null) spike();
    else if (d.chatNote != null && conv) noteOf(conv.title || 'Chat', lastTandem(conv.turns) || ((intro(sel) || {}).answer || ''));
  });

  draw();
  return {
    el,
    /* main.js calls this when the Chat tab comes into view or leaves it. */
    show(on) {
      if (on) mountHub();
      if (on === visible) return;
      visible = on;
      clearTimeout(listTimer); clearTimeout(convTimer);
      if (on) { loadList(); if (sel) loadConv(); }
    },
    /* Take the hub's element back into the Ask or capture pane (after the setup page had it). */
    mountHub,
    /* Open one conversation (Open in Chat on a hub card, or #/agents/chat/<session>); null: Ask or capture. */
    open(session) { select(session); loadList(); },
    /* The agents' prompts changed (main.js after each state fetch): redraw an open thread's questions. */
    redraw() { if (sel && visible) { if (conv && conv.waiting !== !!asksHtml(sel)) loadConv(); else draw(); } },
    refresh: loadList
  };
}

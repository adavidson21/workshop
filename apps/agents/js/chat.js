/* Dispatch: the Chat tab (docs/chat.md). Conversations you have with Tandem: chats you start here, and hub threads
   you followed up on. Automated work (runs, PR reviews, the hub's own routing) never shows here, so it is clear
   what you started and what ran by itself.

   Every message goes to Tandem's read-only `chat` agent through the opencode connector (chat.start and chat.send,
   write: true, Enter or Send is the click). It reads code, repo guides, product notes and .work, and changes
   nothing. Starting work stays behind buttons with confirms: Make it a spike.

   Drawn into its own element, which main.js moves into the page when the Chat tab is in view, so typing survives
   Dispatch's repaints. */
import { esc } from './hub-model.js';
import { keepFocus, lastTandem, since, turnsHtml } from './thread.js';

const OC = 'opencode';
const LIST_MS = 10000;
const BUSY_MS = 1500;

export function startChat(ws, { noteOf = async () => {}, aiReady = () => ({ ready: false, why: '' }) } = {}) {
  const el = document.createElement('section');
  el.className = 'chat';
  el.setAttribute('aria-label', 'Chat');
  let items = [], sel = null, conv = null, err = '', listErr = '', sending = false, visible = false;
  const drafts = { new: '' };
  let listTimer = 0, convTimer = 0;

  /* ---------- data ---------- */
  async function loadList() {
    clearTimeout(listTimer);
    if (!aiReady().ready) { items = []; listErr = ''; draw(); return; }
    try { items = (await ws.connectors.call(OC, 'chat.list', {})).items || []; listErr = ''; }
    catch (e) { listErr = e.message || "Couldn't list your chats."; }
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
    if (sel === want && conv && conv.busy && visible) convTimer = setTimeout(loadConv, BUSY_MS);
  }
  function select(session) {
    sel = session || null; conv = null; err = '';
    draw();
    if (sel) loadConv();
    const box = el.querySelector('[data-keep]');
    if (box) box.focus();
  }

  /* ---------- sending ---------- */
  async function send() {
    const key = sel || 'new';
    const text = String(drafts[key] || '').trim();
    if (!text || sending) return;
    sending = true; err = ''; draw();
    try {
      if (!sel) {
        const r = await ws.connectors.call(OC, 'chat.start', { text }, { confirm: true });
        drafts.new = '';
        sel = r.session;
        conv = { session: r.session, from: 'you', title: text.slice(0, 80), busy: true, turns: [{ role: 'you', text }] };
        loadList();
      } else {
        await ws.connectors.call(OC, 'chat.send', { session: sel, text }, { confirm: true });
        drafts[key] = '';
        conv = { ...(conv || {}), busy: true, turns: [...((conv && conv.turns) || []), { role: 'you', text }] };
      }
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
    if (!topic || !window.confirm(`Start a spike on "${topic}"?\n\nThe investigator reads code and writes findings in .work. It changes no code.`)) return;
    try { await ws.connectors.call(OC, 'spike', { topic: topic.slice(0, 500) }, { confirm: true }); ws.toast('Spike started. It shows in All runs.', { kind: 'success' }); }
    catch (e) { ws.toast(e.message || 'Could not start the spike.', { kind: 'error' }); }
  }

  /* ---------- drawing ---------- */
  const tag = c => c.from === 'hub' ? '<span class="chat-tag hub">From the hub</span>' : '<span class="chat-tag">You started</span>';
  function listHtml() {
    const rows = items.map(c => `<li><button type="button" class="chat-item${c.session === sel ? ' on' : ''}" data-chat-open="${esc(c.session)}">` +
      `<span class="chat-t">${c.busy ? '<span class="spin" aria-hidden="true"></span>' : ''}${esc(c.title)}</span>` +
      `<span class="chat-m">${tag(c)}${c.waiting ? '<span class="chat-tag warn">Needs you</span>' : ''}<span>${esc(since(c.last))}</span></span></button></li>`).join('');
    return `<aside class="chat-list"><button type="button" class="btn primary" data-chat-new>New chat</button>` +
      (listErr ? `<p class="hub-error">${esc(listErr)}</p>` : '') +
      (rows ? `<ul>${rows}</ul>` : '<p class="hub-meta">No chats yet. Ask Tandem anything about your repos, products or work in progress.</p>') + '</aside>';
  }
  function convHtml() {
    const key = sel || 'new';
    const busy = !!(conv && conv.busy);
    let head = '', body = '';
    if (!sel) {
      head = '<header class="chat-head"><h2>New chat</h2><span class="hub-meta">Read only: Tandem reads code, repo guides, product notes and .work, and changes nothing.</span></header>';
    } else {
      const c = items.find(x => x.session === sel) || conv || {};
      head = `<header class="chat-head"><h2>${esc(c.title || 'Chat')}</h2>${c.from ? tag(c) : ''}<span class="row">` +
        (busy ? '<button type="button" class="btn danger" data-chat-stop>Stop</button>' : '') +
        `<button type="button" class="btn ghost" data-chat-remove="${esc(sel)}" title="Stop listing it here. The opencode session is kept.">Remove</button></span></header>`;
      body = conv ? turnsHtml(conv.turns, { busy }) : '<p class="hub-meta">Loading...</p>';
      if (conv && conv.waiting) body += '<p class="hub-meta">Tandem is asking you something: answer it under Waiting for you in All runs.</p>';
      if (conv && !busy && lastTandem(conv.turns)) body += '<p class="hub-actions"><button class="btn" type="button" data-chat-spike>Make it a spike</button><button class="btn ghost" type="button" data-chat-note>Save as note</button></p>';
    }
    if (err) body += `<p class="hub-error">${esc(err)}</p>`;
    const off = !aiReady().ready;
    const box = `<div class="chat-box"><textarea rows="3" data-keep="chat:${esc(key)}" placeholder="${off ? 'Turn on AI with the sparkle button in the hub above' : sel ? 'Reply. Enter sends, Shift+Enter for a new line' : 'Ask Tandem. Enter sends, Shift+Enter for a new line'}" aria-label="Message to Tandem"${off || busy || sending ? ' disabled' : ''}>${esc(drafts[key] || '')}</textarea>` +
      `<button type="button" class="btn primary" data-chat-send${off || busy || sending ? ' disabled' : ''}>Send</button></div>`;
    return `<div class="chat-conv">${head}<div class="chat-body" data-chat-follow>${body}</div>${box}${off ? `<p class="hub-meta">${esc(aiReady().why || 'AI is off.')}</p>` : ''}</div>`;
  }
  function draw() {
    const scroller = el.querySelector('[data-chat-follow]');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const back = keepFocus(el);
    el.innerHTML = listHtml() + convHtml();
    back();
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
    if (!b) return;
    const d = b.dataset;
    if (d.chatOpen != null) select(d.chatOpen);
    else if (d.chatNew != null) select(null);
    else if (d.chatSend != null) send();
    else if (d.chatStop != null) stop();
    else if (d.chatRemove != null) remove(d.chatRemove);
    else if (d.chatSpike != null) spike();
    else if (d.chatNote != null && conv) noteOf(conv.title || 'Chat', lastTandem(conv.turns));
  });

  draw();
  return {
    el,
    /* main.js calls this when the Chat tab comes into view or leaves it. */
    show(on) {
      if (on === visible) return;
      visible = on;
      clearTimeout(listTimer); clearTimeout(convTimer);
      if (on) { loadList(); if (sel) loadConv(); }
    },
    /* Open one conversation (Open in Chat on a hub card, or #/agents/chat/<session>). */
    open(session) { select(session); loadList(); },
    refresh: loadList
  };
}

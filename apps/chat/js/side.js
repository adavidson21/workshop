/* The workbench's Side chat (Chat 4.0.0, docs/chat.md, Side chats): a question about the chat in view that should
   not land in it, like "what does this file do?" in the middle of a build. The first question copies the chat so
   far (opencode's fork, through the connector's chat.side) and asks there; later ones go to the same side chat,
   which keeps its own thread. Nothing is added to the chat itself. Start over forgets it, and the next question
   copies the chat as it is then.

   Tandem's read-only chat agent answers unless you pick another (opencode's plan agent without Tandem), so a side
   question does not change your files by accident. Permission prompts and questions are answered here, as in the
   chat. Pictures can be pasted here too (images.js). */
import { esc } from './md.js';
import { modelFromKey, promptClick, promptHtml, richRows } from './parts.js';
import { keepFocus, lastTandem, liveEchoes } from './thread.js';
import { addPictures, chipsHtml, picturesIn } from './images.js';

const OC = 'opencode';
const BUSY_MS = 1000;

export function startSide(ws, { agents = () => [], model = () => '', paint = () => {}, keep = () => {}, flash = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'side';
  let main = null, mainTitle = '', side = null, conv = null, err = '', sending = false, visible = false, agent = '', timer = 0;
  const drafts = {}; // main session -> text
  const pics = {}; // main session -> pictures
  const echo = {}; // side session (or main while starting) -> [{text, at, base}]
  const open = new Set();
  const asked = { answers: {}, custom: {} };
  const forgotten = new Set(); // side chats you started over from: the chat's older state may still name them

  const busy = () => !!((conv && conv.busy) || (echo[side || main] || []).length);
  async function load() {
    clearTimeout(timer);
    if (!side) return;
    const want = side;
    try {
      const r = await ws.connectors.call(OC, 'chat.messages', { session: want });
      if (side !== want) return;
      conv = r; err = r.error || '';
      if (echo[want]) echo[want] = liveEchoes(echo[want], r.turns, { busy: !!r.busy });
    } catch (e) {
      if (side !== want) return;
      if (e && e.code === 'not_found') { side = null; conv = null; }
      else err = e.message || "Couldn't read the side chat.";
    }
    draw();
    if (side === want && conv && (conv.busy || conv.waiting || (echo[want] || []).length)) timer = setTimeout(load, BUSY_MS);
  }
  async function ask(textIn) {
    const text = String(textIn != null ? textIn : drafts[main] || '').trim();
    if (!main || !text || sending) return;
    const list = pics[main] || [];
    const images = list.map(({ name, mime, data }) => ({ name, mime, data }));
    for (const p of list) keep(p);
    const ek = side || main;
    const mine = { text, at: Date.now(), base: side && conv ? (conv.turns || []).length : 0, pics: list.map(p => p.id) };
    echo[ek] = [...(echo[ek] || []), mine];
    if (textIn == null) drafts[main] = '';
    pics[main] = [];
    sending = true; err = ''; draw();
    try {
      const r = await ws.connectors.call(OC, 'chat.side', { session: main, ...(side ? { side } : {}), text, ...(agent ? { agent } : {}), ...(model() ? { model: modelFromKey(model()) } : {}), ...(images.length ? { images } : {}) }, { confirm: true });
      if (!side) { echo[r.side] = echo[main] || []; delete echo[main]; }
      side = r.side;
    } catch (e) {
      echo[ek] = (echo[ek] || []).filter(x => x !== mine);
      err = e.message || "Couldn't ask that.";
      if (!drafts[main]) drafts[main] = text;
      pics[main] = list;
    }
    sending = false; draw();
    setTimeout(load, 400);
  }
  async function startOver() {
    if (!side) return;
    const was = side;
    forgotten.add(was);
    side = null; conv = null; err = '';
    draw();
    try { await ws.connectors.call(OC, 'chat.remove', { session: was }); } catch (e) { /* forgotten here anyway */ }
    focus();
  }
  async function answer(args) {
    try { await ws.connectors.call(OC, 'answer', args, { confirm: true }); }
    catch (e) { flash(e.message || "Couldn't answer that."); }
    load();
  }

  function echoTurns() {
    return (echo[side || main] || []).map(e => ({ id: '', role: 'you', text: e.text, parts: (e.pics || []).map(id => ({ type: 'file', name: 'picture', image: true, local: id })) }));
  }
  function draw() {
    if (!main) {
      el.innerHTML = '<div class="side-empty"><p><b>Side chat</b></p><p>Open a chat to ask about it here. A side chat starts from a copy of the chat, and nothing you ask here is added to it.</p></div>';
      return;
    }
    const turns = (conv && conv.turns) || [];
    const b = busy();
    const picks = agents();
    const opts = `<option value="">Read only${picks.some(a => a.name === 'chat') ? ' (Tandem)' : picks.some(a => a.name === 'plan') ? ' (plan)' : ''}</option>` + picks.filter(a => a.name !== 'chat').map(a => `<option value="${esc(a.name)}"${a.name === agent ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
    let rows = richRows(turns.concat(echoTurns()), { open, busy: b, activity: (conv && conv.activity) || (sending ? 'Asking' : ''), session: side || '' });
    if (conv && Array.isArray(conv.prompts)) rows += conv.prompts.map(p => promptHtml(p, asked)).join('');
    if (!b && lastTandem(turns)) rows += '<p class="side-acts"><button type="button" class="lnk" data-side-copy>Copy the answer</button></p>';
    // opencode's error for the session is usually the last answer's own, already shown with it.
    if (err && !turns.slice(-2).some(t => t.error && (err === t.error || err.includes(t.error)))) rows += `<p class="hub-error">${esc(err)}</p>`;
    const intro = side
      ? `<p class="side-about">Asking about <b>${esc(mainTitle || 'this chat')}</b> from a copy of it. Nothing here goes into the chat. <button type="button" class="lnk" data-side-over title="Forget this side chat; the next question copies the chat as it is now">Start over</button></p>`
      : `<p class="side-about">Ask about <b>${esc(mainTitle || 'this chat')}</b> without adding to it. Your first question copies the chat so far.</p>`;
    const draft = drafts[main] || '';
    const back = keepFocus(el);
    const scroller = el.querySelector('.side-scroll');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    el.innerHTML = `${intro}<div class="side-scroll"><div class="turns">${rows}</div></div>` +
      `<div class="side-compose"><div class="chat-box">${chipsHtml(pics[main], 'data-side-pic-x')}<textarea rows="1" data-keep="side:${esc(main)}" data-side-in placeholder="Ask on the side" aria-label="Side chat question">${esc(draft)}</textarea>` +
      `<div class="chat-bar"><label class="side-agent"><span class="sr">Agent</span><select data-side-agent title="Who answers">${opts}</select></label><span class="grow"></span>` +
      `<button type="button" class="chat-send" data-side-send title="Ask" aria-label="Ask"${sending || !draft.trim() ? ' disabled' : ''}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button></div></div></div>`;
    back();
    grow(el.querySelector('[data-side-in]'));
    const s = el.querySelector('.side-scroll');
    if (s && atEnd) s.scrollTop = s.scrollHeight;
    paint(el);
  }
  function grow(t) { if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; }
  function focus() { const t = el.querySelector('[data-side-in]'); if (t) t.focus(); }

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-side-in]')) {
      const was = !!String(drafts[main] || '').trim();
      drafts[main] = t.value; grow(t);
      const send = el.querySelector('[data-side-send]');
      if (send && was !== !!t.value.trim()) send.disabled = sending || !t.value.trim();
    } else if (t.hasAttribute('data-q-custom')) { const id = t.getAttribute('data-q-custom'); (asked.custom[id] = asked.custom[id] || {})[+t.getAttribute('data-qi')] = t.value; }
  });
  el.addEventListener('change', e => { if (e.target.matches('[data-side-agent]')) agent = e.target.value; });
  el.addEventListener('keydown', e => {
    if (e.target.matches('[data-side-in]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  });
  async function takePictures(files) {
    if (!files.length || !main) return;
    const list = pics[main] = pics[main] || [];
    const errors = await addPictures(list, files);
    if (errors.length) flash(errors[0]);
    draw();
  }
  el.addEventListener('paste', e => { if (!e.target.matches('[data-side-in]')) return; const files = picturesIn(e.clipboardData, { paste: true }); if (files.length) { e.preventDefault(); takePictures(files); } });
  el.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  el.addEventListener('drop', e => { const files = picturesIn(e.dataTransfer); if (files.length) { e.preventDefault(); takePictures(files); } });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.sideSend != null) ask();
    else if (d.sideOver != null) startOver();
    else if (d.sidePicX != null) { pics[main] = (pics[main] || []).filter(p => p.id !== d.sidePicX); draw(); }
    else if (d.sideCopy != null) { const t = lastTandem((conv && conv.turns) || []); if (t && navigator.clipboard) navigator.clipboard.writeText(t).then(() => flash('Copied.'), () => {}); }
    else if (d.tool != null) { if (open.has(d.tool)) open.delete(d.tool); else open.add(d.tool); draw(); }
    else {
      const r = promptClick(d, (conv && conv.prompts) || [], asked);
      if (r && r.answer) answer(r.answer); else if (r && r.redraw) draw();
    }
  });

  draw();
  return {
    el,
    show(on) { visible = !!on; if (visible) { draw(); if (side) load(); } },
    focus,
    /** The chat in view changed, or its state came in (chat.messages: its title and its side chat). */
    setSession(sid, info) {
      const title = (info && info.title) || '';
      if (sid !== main) {
        clearTimeout(timer);
        main = sid || null; side = info && info.side && !forgotten.has(info.side) ? info.side : null; conv = null; err = ''; agent = ''; mainTitle = title;
        draw();
        if (side) load();
        return;
      }
      let again = false;
      if (title && title !== mainTitle) { mainTitle = title; again = true; }
      if (info && info.side && !side && !sending && !forgotten.has(info.side)) { side = info.side; load(); again = false; }
      if (again) draw();
    },
    /** /side <question> from the chat's composer. */
    ask(text) { if (!main) { flash('Open a chat first. A side chat asks about the chat in view.'); return; } draw(); ask(text); },
    busy: () => busy(),
    visible: () => visible
  };
}

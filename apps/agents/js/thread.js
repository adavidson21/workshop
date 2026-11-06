/* Dispatch: conversation pieces shared by hub threads (hub.js) and the Chat tab (chat.js). No DOM, so Node tests
   import them (test/thread.test.mjs).

   Turns come from the opencode connector's chat.messages: [{role: 'you' | 'tandem', text, at}]. Agent text is
   untrusted: it is rendered with answerHtml (everything escaped; code, bold, lists, headings, http(s) links). */
import { answerHtml, esc } from './hub-model.js';

/** The turns as HTML, oldest first. `busy` adds a "Tandem is writing" line at the end. */
export function turnsHtml(turns, { busy = false } = {}) {
  const rows = (Array.isArray(turns) ? turns : []).filter(t => t && t.text).map(t => t.role === 'you'
    ? `<div class="turn you"><span class="who">You</span><div class="tx">${esc(t.text)}</div></div>`
    : `<div class="turn tandem"><span class="who">Tandem</span><div class="tx hub-answer">${answerHtml(t.text)}</div></div>`);
  if (busy) rows.push('<div class="turn tandem writing"><span class="who">Tandem</span><div class="tx"><span class="spin" aria-hidden="true"></span> Writing...</div></div>');
  return rows.length ? `<div class="turns">${rows.join('')}</div>` : '';
}

/** The last thing Tandem said, for Save as note and Make it a spike. */
export function lastTandem(turns) {
  const list = Array.isArray(turns) ? turns : [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].role === 'tandem' && list[i].text) return list[i].text;
  return '';
}

/** A short "5 min ago" for list rows. */
export function since(ms, now = Date.now()) {
  if (!ms) return '';
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}

/* Keeps typing through a repaint: call before replacing `root`'s HTML, then call the result after. Text fields
   with data-keep="<key>" get their value from `drafts` (kept by an input listener), and focus and the caret
   come back to the same key. */
export function keepFocus(root) {
  const a = root.ownerDocument && root.ownerDocument.activeElement;
  const key = a && root.contains(a) && a.getAttribute('data-keep');
  const sel = key && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  return () => {
    if (!key) return;
    const el = root.querySelector(`[data-keep="${key.replace(/["\\]/g, '\\$&')}"]`);
    if (!el) return;
    el.focus();
    if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ }
  };
}

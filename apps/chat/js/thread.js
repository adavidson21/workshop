/* Dispatch: conversation pieces shared by hub threads (hub.js) and the Chat tab (chat.js). No DOM, so Node tests
   import them (test/thread.test.mjs).

   Turns come from the opencode connector's chat.messages: [{role: 'you' | 'tandem', text, at}]. Agent text is
   untrusted: it is rendered with answerHtml (everything escaped; code, bold, lists, headings, http(s) links). */
import { answerHtml, esc } from './hub-model.js';

/** One of your turns: a bubble on the right (the who label is for screen readers). */
export const youTurn = text => `<div class="turn you"><span class="who">You</span><div class="tx">${esc(text)}</div></div>`;
/** One of Tandem's turns from ready-made HTML (escaped by the caller). */
export const tandemTurn = html => `<div class="turn tandem"><span class="who">Tandem</span><div class="tx">${html}</div></div>`;
export const WRITING = '<div class="turn tandem writing"><span class="who">Tandem</span><div class="tx"><span class="spin" aria-hidden="true"></span> Writing...</div></div>';

/** The turns as HTML rows, oldest first (no wrapper). `busy` adds a "Tandem is writing" line at the end. */
export function turnRows(turns, { busy = false } = {}) {
  const rows = (Array.isArray(turns) ? turns : []).filter(t => t && t.text).map(t => t.role === 'you'
    ? youTurn(t.text)
    : tandemTurn(`<div class="hub-answer">${answerHtml(t.text)}</div>`));
  if (busy) rows.push(WRITING);
  return rows.join('');
}
/** The turns wrapped in .turns, or '' when there are none. */
export function turnsHtml(turns, opts) {
  const rows = turnRows(turns, opts);
  return rows ? `<div class="turns">${rows}</div>` : '';
}

/* ---------- the Chat sidebar (chat.js) ---------- */
const DAY = 86400000;
/** Groups for the sidebar, newest activity first: Today, Yesterday, Previous 7 days, Older (empty groups left out). */
export function groupChats(items, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  const groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]];
  const list = (Array.isArray(items) ? items : []).slice().sort((a, b) => (b.last || b.at || 0) - (a.last || a.at || 0));
  for (const c of list) {
    const t = c.last || c.at || 0;
    groups[t >= today ? 0 : t >= today - DAY ? 1 : t >= today - 7 * DAY ? 2 : 3][1].push(c);
  }
  return groups.filter(g => g[1].length).map(([label, items]) => ({ label, items }));
}
/** Search: every word of the query in the title, any case. */
export function matchChat(c, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const title = String((c && c.title) || '').toLowerCase();
  return words.every(w => title.includes(w));
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

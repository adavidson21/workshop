/* Notebook: small text edits the page makes for you. Pure: no DOM and no SDK.

   toggleTask flips one "- [ ]" line (a click on a box in the preview). collapseTitle turns "# # Title" on the first
   line back into "# Title" (a new note already starts with "# "). The title hint shows while that line is empty. */

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/;

/** The text with the task box on `line` (0-based) flipped, or null if that line is not a task. */
export function toggleTask(text, line) {
  const lines = String(text).split('\n');
  const m = TASK.exec(lines[line] || '');
  if (!m) return null;
  lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + lines[line].slice(m[0].length);
  return lines.join('\n');
}

/** The task text on a line ("Follow up with Jo"), or null. */
export function taskText(text, line) {
  const ln = String(text).split('\n')[line] || '';
  const m = TASK.exec(ln);
  return m ? ln.slice(m[0].length).trim() : null;
}

/** "# # Title" (or "# ## Title") on the first line becomes "# Title". Returns {text, shift}: shift is how
    many characters were taken out before the cursor's line, or null when nothing changed. */
export function collapseTitle(text) {
  const src = String(text);
  const m = /^#[ \t]+#+[ \t]+/.exec(src);
  if (!m) return { text: src, shift: null };
  return { text: '# ' + src.slice(m[0].length), shift: m[0].length - 2 };
}

/** True while the first line is just "#" and spaces: show the faint "Title" hint. */
export const titleEmpty = (text) => /^#[ \t]*(\n|$)/.test(String(text));

/**
 * Bold, italic, inline code: wrap the selection [s, e) in a marker, or take it off when it is already wrapped.
 * With nothing selected, the word at the cursor; with no word, an empty pair with the cursor inside.
 * {from, to, insert, selFrom, selTo}: replace [from, to) with insert, then select [selFrom, selTo).
 */
export function toggleWrap(text, s, e, marker) {
  const t = String(text), m = marker.length;
  if (s === e) {
    const word = /[\w'-]*$/.exec(t.slice(0, s))[0].length, after = /^[\w'-]*/.exec(t.slice(s))[0].length;
    if (word || after) { s -= word; e += after; }
  }
  const sel = t.slice(s, e);
  if (t.slice(s - m, s) === marker && t.slice(e, e + m) === marker) return { from: s - m, to: e + m, insert: sel, selFrom: s - m, selTo: e - m };
  if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) return { from: s, to: e, insert: sel.slice(m, -m), selFrom: s, selTo: e - 2 * m };
  return { from: s, to: e, insert: marker + sel + marker, selFrom: s + m, selTo: e + m };
}

/** A link around the selection: [text](url) with the url selected to type over. A selection that is a URL
    becomes the url, with the text selected instead. */
export function makeLink(text, s, e) {
  const sel = String(text).slice(s, e);
  if (/^https?:\/\/\S+$/.test(sel)) return { from: s, to: e, insert: `[](${sel})`, selFrom: s + 1, selTo: s + 1 };
  const label = sel || 'text';
  return { from: s, to: e, insert: `[${label}](url)`, selFrom: s + label.length + 3, selTo: s + label.length + 6 };
}

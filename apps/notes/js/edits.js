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

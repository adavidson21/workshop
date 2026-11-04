/* Rapport's Markdown preview (1:1 notes and goals). Escapes everything. No DOM, so Node tests run it.

   Apps never import other app folders, so this does not use Notes' renderer. Every character of the note is
   escaped; the only markup in the output is what this file writes. Raw HTML shows as text. Links are
   clickable only for http(s) and open in a new tab with no referrer. Images are never loaded.

   Supported: ATX headings, paragraphs, bullet and numbered lists, task lists (shown, not clickable), block
   quotes, fenced code, rules, pipe tables, code spans, **strong**, *emphasis*, ~~strikethrough~~ and
   [links](https://...). */

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HOLE = '\u0000';

/** Inline Markdown in one line or paragraph, to safe HTML. */
export function inline(text) {
  const held = [];
  const hold = html => `${HOLE}${held.push(html) - 1}${HOLE}`;
  let s = String(text == null ? '' : text).replace(/\u0000/g, '');
  // Code spans first, so nothing inside them is read as Markdown.
  s = s.replace(/`([^`\n]+)`/g, (m, code) => hold(`<code>${esc(code)}</code>`));
  // Links: only http(s). Anything else stays as plain text.
  s = s.replace(/\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g, (m, label, url) => /^https?:\/\/[^\s"'<>]+$/i.test(url)
    ? hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`)
    : m);
  s = esc(s)
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, n) => held[Number(n)]);
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A table row's cells: split on | outside code spans and not escaped. */
function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = [];
  let cur = '', code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1])
  && cells(lines[i]).length === cells(lines[i + 1]).length;

/** A whole note to safe HTML. */
export function render(md) {
  const lines = String(md == null ? '' : md).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = FENCE.exec(line))) {
      const mark = m[1];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(lines[i]);
      const align = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const row = cells(lines[i++]);
        body.push(`<tr>${head.map((h, k) => td('td', row[k] || '', k)).join('')}</tr>`);
      }
      out.push(`<div class="md-table"><table><thead><tr>${head.map((h, k) => td('th', h, k)).join('')}</tr></thead>${body.length ? `<tbody>${body.join('')}</tbody>` : ''}</table></div>`);
      continue;
    }
    if ((m = HEADING.exec(line))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (RULE.test(line)) { out.push('<hr>'); i++; continue; }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) { body.push(m[1]); i++; }
      out.push(`<blockquote>${render(body.join('\n'))}</blockquote>`);
      continue;
    }
    if ((m = ITEM.exec(line))) {
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length && (m = ITEM.exec(lines[i])) && /\d/.test(m[1]) === ordered) {
        const t = TASK.exec(m[2]);
        items.push(t
          ? `<li class="task"><input type="checkbox" disabled${t[1] === ' ' ? '' : ' checked'} aria-label="${t[1] === ' ' ? 'Open' : 'Done'}"> ${inline(t[2])}</li>`
          : `<li>${inline(m[2])}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !QUOTE.test(lines[i]) && !ITEM.test(lines[i]) && !RULE.test(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

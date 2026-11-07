/* Folio: embeds. A paragraph that is only ![[note]] or ![[note#heading]] (or ![label](note.md#heading)) shows
   that note, or that section of it, in place: read only, with a link to open it. Pure, so Node tests run it;
   main.js resolves the note and renders it with markdown.js.

   One note per paragraph. Embeds go two deep at most and never into a note already being shown, so a note
   embedding itself, or two notes embedding each other, stop instead of looping. */
import { frontmatter, headingId } from './markdown.js';

export const EMBED_DEPTH = 2;

/** The note a paragraph embeds: {target, anchor, wiki} (target is a [[name]] when wiki, else a link path), or null. */
export function embedSpec(para) {
  const s = String(para).trim();
  let m = /^!\[\[([^\]|\n#]*)(?:#([^\]|\n]+))?(?:\|[^\]\n]*)?\]\]$/.exec(s);
  if (m && (m[1].trim() || m[2])) return { target: m[1].trim(), anchor: m[2] ? m[2].trim() : '', wiki: true };
  m = /^!\[[^\]\n]*\]\(\s*<?([^)\s>]*\.md)(?:#([^)\s>]+))?>?\s*\)$/i.exec(s);
  if (m) return { target: m[1], anchor: m[2] || '', wiki: false };
  return null;
}

/** The part of a note an embed shows: the body without frontmatter, or, with an anchor, its heading and what
    follows up to the next heading at the same or a higher level. null if no heading has that anchor. */
export function sectionText(text, anchor) {
  const { body } = frontmatter(text);
  if (!anchor) return body;
  const want = headingId(anchor);
  const lines = String(body).split('\n');
  const ids = new Map();
  let fence = false, start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const h = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(lines[i]);
    if (!h) continue;
    if (start >= 0 && h[1].length <= level) return lines.slice(start, i).join('\n').replace(/\s+$/, '');
    if (start >= 0) continue;
    let id = headingId(h[2].replace(/[*_`~[\]]/g, ''));
    const n = ids.get(id) || 0; ids.set(id, n + 1); if (n) id = `${id}-${n}`;
    if (id === want || headingId(h[2]) === want) { start = i; level = h[1].length; }
  }
  return start >= 0 ? lines.slice(start).join('\n').replace(/\s+$/, '') : null;
}

/** Rendered HTML made safe to put inside another note's preview: no line numbers (they belong to the other
    note), no heading ids (they would clash), no task boxes to tick. Only touches markup markdown.js writes. */
export function embedHtml(html) {
  return String(html)
    .replace(/ data-line="\d+"/g, '')
    .replace(/ id="h-[^"]*"/g, '')
    .replace(/<input type="checkbox" data-task="\d+" aria-label="Done"/g, '<input type="checkbox" disabled');
}

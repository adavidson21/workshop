/* Folio: the slash menu. Type / at the start of a line (outside code) for a list of blocks to insert:
   headings, lists, a table, a code block, callouts, each kind of diagram, a divider and today's date.
   Pure, so Node tests run it; main.js shows the list in the [[ picker and puts the choice in. */
import { KITS, fences, kitBlock } from './diagram-kits.js';

const CALLOUTS = ['note', 'tip', 'important', 'warning', 'caution'];

/* {id, title, hint, line?: text that replaces the "/word" on its line, block?: text on lines of its own,
   cursor?: offset in it for the cursor (default: the start of its second line), words: extra search words} */
export const SLASH = [
  { id: 'h1', title: 'Heading 1', hint: '#', line: '# ' },
  { id: 'h2', title: 'Heading 2', hint: '##', line: '## ' },
  { id: 'h3', title: 'Heading 3', hint: '###', line: '### ' },
  { id: 'table', title: 'Table', hint: '| a | b |', block: '| Column | Column |\n| --- | --- |\n|  |  |', cursor: 2 },
  { id: 'code', title: 'Code block', hint: '```', block: '```\n\n```', cursor: 3, words: 'snippet fence' },
  { id: 'task', title: 'Task', hint: '- [ ]', line: '- [ ] ', words: 'todo checkbox' },
  { id: 'list', title: 'Bulleted list', hint: '-', line: '- ', words: 'bullet' },
  { id: 'numbered', title: 'Numbered list', hint: '1.', line: '1. ', words: 'ordered' },
  { id: 'quote', title: 'Quote', hint: '>', line: '> ' },
  ...CALLOUTS.map(k => ({ id: k, title: `${k[0].toUpperCase()}${k.slice(1)} callout`, hint: `> [!${k.toUpperCase()}]`, block: `> [!${k.toUpperCase()}]\n> `, cursor: k.length + 8, words: 'callout admonition' })),
  ...KITS.map(k => ({ id: k.id, title: `${k.name} diagram`, hint: 'mermaid', block: kitBlock(k), words: `diagram mermaid ${k.about}` })),
  { id: 'divider', title: 'Divider', hint: '---', block: '---', cursor: 3, words: 'rule hr line' },
  { id: 'date', title: "Today's date", hint: 'YYYY-MM-DD', date: true, words: 'today now' }
];

/** The "/query" being typed: {start, query} when the text before the cursor on its line is only spaces and
    /word, and the line is not inside a code block. null otherwise. */
export function slashAt(text, at) {
  const s = String(text);
  const lineStart = s.lastIndexOf('\n', at - 1) + 1;
  const m = /^([ \t]*)\/([a-z0-9-]{0,24})$/i.exec(s.slice(lineStart, at));
  if (!m) return null;
  const line = (s.slice(0, lineStart).match(/\n/g) || []).length;
  if (fences(s).some(f => line > f.line && line <= f.end)) return null;
  return { start: lineStart + m[1].length, query: m[2].toLowerCase() };
}

/** Entries matching the query: ids starting with it first, then titles and words containing it. */
export function slashItems(query, limit = 10) {
  const q = String(query || '').toLowerCase();
  if (!q) return SLASH.slice(0, limit);
  const starts = SLASH.filter(x => x.id.startsWith(q) || x.title.toLowerCase().startsWith(q));
  const has = SLASH.filter(x => !starts.includes(x) && `${x.title} ${x.words || ''}`.toLowerCase().includes(q));
  return [...starts, ...has].slice(0, limit);
}

/** What choosing an entry does to the text: {from, to, insert, cursor} where cursor is absolute in the result.
    [start, at) is the "/query"; day is today's date for /date. */
export function applySlash(text, start, at, item, { day = '' } = {}) {
  const s = String(text);
  if (item.date) return { from: start, to: at, insert: day, cursor: start + day.length };
  if (item.line) return { from: start, to: at, insert: item.line, cursor: start + item.line.length };
  // A block: the "/query" and the line's indent go, then the block on lines of its own.
  const lineStart = s.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = s.indexOf('\n', at) < 0 ? s.length : s.indexOf('\n', at);
  const restOfLine = s.slice(at, lineEnd);
  const from = lineStart, to = restOfLine.trim() ? at : lineEnd;
  const before = s.slice(0, from), after = s.slice(to);
  const pre = !before || before.endsWith('\n\n') ? '' : '\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const nl = item.block.indexOf('\n');
  const off = item.cursor !== undefined ? item.cursor : nl >= 0 ? nl + 1 : item.block.length;
  return { from, to, insert: pre + item.block + post, cursor: from + pre.length + off };
}

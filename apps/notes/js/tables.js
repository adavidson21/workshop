/* Folio: line up a Markdown pipe table's columns (Format table, Ctrl+Alt+T). Pure, so Node tests run it. */

const SEP = /^ *\|?(?: *:?-+:? *\|)+ *:?-*:? *\|? *$/;
const isRow = (l) => /\|/.test(l) && l.trim() !== '';

function cells(row) {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  const out = [];
  let cur = '';
  for (let k = 0; k < r.length; k++) {
    if (r[k] === '\\' && r[k + 1] === '|') { cur += '\\|'; k++; continue; }
    if (r[k] === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += r[k];
  }
  out.push(cur.trim());
  return out;
}

/** The table holding this 0-based line: {from, to} lines (inclusive), or null. A table is a header row, a
    separator row (---) and the rows after it, with no blank line between. */
export function tableAt(text, line) {
  const lines = String(text).split('\n');
  if (!isRow(lines[line] || '')) return null;
  let a = line, b = line;
  while (a > 0 && isRow(lines[a - 1])) a--;
  while (b < lines.length - 1 && isRow(lines[b + 1])) b++;
  // The header is the row just above the first separator.
  for (let k = a; k < b; k++) if (SEP.test(lines[k + 1]) && lines[k + 1].includes('-')) return { from: k, to: b };
  return null;
}

/** The text with the table at this line lined up, or null if the line is not in a table. */
export function formatTable(text, line) {
  const lines = String(text).split('\n');
  const t = tableAt(text, line);
  if (!t) return null;
  const rows = lines.slice(t.from, t.to + 1).map(cells);
  const align = rows[1].map(c => (/^:-+:$/.test(c) ? 'c' : /-+:$/.test(c) ? 'r' : /^:-/.test(c) ? 'l' : ''));
  const n = Math.max(...rows.map(r => r.length));
  const width = Array.from({ length: n }, (_, k) => Math.max(3, ...rows.map((r, i) => (i === 1 ? 3 : (r[k] || '').length))));
  const pad = (s, w, a) => (a === 'r' ? s.padStart(w) : a === 'c' ? s.padStart(Math.floor((w + s.length) / 2)).padEnd(w) : s.padEnd(w));
  const out = rows.map((r, i) => '| ' + Array.from({ length: n }, (_, k) => {
    if (i === 1) { const a = align[k] || ''; const w = width[k]; return a === 'c' ? ':' + '-'.repeat(w - 2) + ':' : a === 'r' ? '-'.repeat(w - 1) + ':' : a === 'l' ? ':' + '-'.repeat(w - 1) : '-'.repeat(w); }
    return pad(r[k] || '', width[k], align[k]);
  }).join(' | ') + ' |');
  lines.splice(t.from, t.to - t.from + 1, ...out);
  return lines.join('\n');
}

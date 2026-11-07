/* Dispatch: the .work file sheet's editor, pure parts. No DOM, so Node tests import them (test/doc.test.mjs).

   docHtml renders a Tandem document (plan.md, spec.md, review.md...) for the sheet's Preview. Every character is
   escaped first; the only markup is what this file writes. Supported: headings, paragraphs, fenced code, block
   quotes, bullet, numbered and task lists (one level of nesting by indent), pipe tables, rules, `code`, **bold**,
   *italic*, ~~strike~~ and [text](https://...) links, which open in a new tab. Any other link is plain text.
   HTML comments are dropped. The full renderer is Notebook's (the Notes app): Open in Notebook.

   lockReason says why the open file can't be edited right now (Tandem is working on it). */
import { h, safeUrl } from './view.js';

function inline(s) {
  const codes = [];
  let t = h(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    return u ? `<a href="${h(u)}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = (ln) => ln.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

/** A Tandem document as safe HTML for the sheet's Preview. */
export function docHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${h(code.join('\n'))}</code></pre>`);
      continue;
    }
    const hd = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln);
    if (hd) { flush(); const n = Math.min(hd[1].length + 1, 6); out.push(`<h${n}>${inline(hd[2])}</h${n}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push('<hr>'); continue; }
    if (/^\s*>/.test(ln)) {
      flush();
      const q = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${docHtml(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = cells(ln);
      i += 2;
      const rows = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('') + '</tbody></table>');
      continue;
    }
    if (LIST.test(ln)) {
      flush();
      const items = [];
      for (; i < lines.length; i++) {
        const m = LIST.exec(lines[i]);
        if (m) { items.push({ deep: m[1].replace(/\t/g, '  ').length >= 2, ordered: /\d/.test(m[2]), text: m[3] }); continue; }
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); continue; }
        break;
      }
      i--;
      out.push(listHtml(items));
      continue;
    }
    if (!ln.trim()) { flush(); continue; }
    para.push(ln.trim());
  }
  flush();
  return out.join('');
}

function itemHtml(it) {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(it.text);
  if (!task) return `<li>${inline(it.text)}</li>`;
  const done = task[1] !== ' ';
  return `<li class="task${done ? ' done' : ''}"><span class="box" aria-hidden="true">${done ? '&#10003;' : ''}</span>${inline(task[2])}</li>`;
}
function listHtml(items) {
  const tag = items[0] && items[0].ordered ? 'ol' : 'ul';
  let html = `<${tag}>`, sub = null;
  for (const it of items) {
    if (it.deep && html !== `<${tag}>`) { (sub = sub || []).push(it); continue; }
    if (sub) { html = html.replace(/<\/li>$/, listHtml(sub.map(s => ({ ...s, deep: false }))) + '</li>'); sub = null; }
    html += itemHtml(it);
  }
  if (sub) html = html.replace(/<\/li>$/, listHtml(sub.map(s => ({ ...s, deep: false }))) + '</li>');
  return html + `</${tag}>`;
}

/** Why the file can't be edited right now, or ''. it: the item (or null for a folder the model no longer has);
    busy: its session is working; auto: autopilot is running it. */
export function lockReason({ busy, auto }) {
  if (auto) return 'Autopilot is running this item, so the file is read-only until it stops.';
  if (busy) return 'Tandem is working on this item, so the file is read-only until it stops.';
  return '';
}

/** The Notebook route for a .work file (Notes' manifest route tandem/:folder/:file). */
export function notebookRoute(folder, file) {
  return 'tandem/' + encodeURIComponent(folder) + '/' + encodeURIComponent(file);
}

/* Chat: Markdown for agent text (docs/chat.md). Agent text is untrusted, so everything is escaped first and only
   these come back as markup: fenced code blocks (with a Copy button), inline code, bold, italics, headings, lists
   (bulleted, numbered and task lists), quotes, tables, rules, and http(s) links. No raw HTML, no images. No DOM, so
   Node tests import it (test/md.test.mjs). */

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

/** One line of inline Markdown, escaped. */
export function inline(s) {
  const codes = [];
  let t = String(s == null ? '' : s).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => {
    const u = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<>"')]+)/g, (m, a, u) => `${a}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
}

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

/** A block of Markdown as HTML (escaped). */
export function mdHtml(md) {
  const lines = String(md == null ? '' : md).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  let para = [];
  let list = null; // 'ul' | 'ol'
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushPara(); closeList();
      const close = fence[1];
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(close); i++) body.push(lines[i]);
      const lang = fence[2] ? `<span class="code-lang">${esc(fence[2])}</span>` : '';
      out.push(`<div class="code">${lang}<button type="button" class="code-copy" data-copy title="Copy" aria-label="Copy code">Copy</button><pre><code>${esc(body.join('\n'))}</code></pre></div>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara(); closeList();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      let item = (ul || ol)[1];
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(item);
      if (task) item = `<span class="task${task[1] === ' ' ? '' : ' done'}" aria-hidden="true"></span>${inline(task[2])}`;
      else item = inline(item);
      out.push(`<li>${item}</li>`);
      continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    closeList();
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) { flushPara(); out.push(`<h4>${inline(hd[2])}</h4>`); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flushPara(); out.push('<hr>'); continue; }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { flushPara(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join('');
}

/* Queue: ADO rich text (descriptions, repro steps, comments) to safe HTML. That HTML is written by other
   people, so it is untrusted. This builds new markup from a small allowlist instead of cleaning the input:
   every other tag is dropped (its text kept, escaped), script-like elements are dropped with their content,
   no attribute survives except href on links, and only http(s) links stay clickable. Images are never
   loaded (they would call the ADO server with your session); they become a note. No DOM, so Node tests can
   run it, and nothing here ever parses the input as HTML in the page. */

const KEEP = new Set(['p', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'code', 'pre', 'blockquote', 'a']);
const AS_P = new Set(['div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article', 'header', 'footer', 'table', 'tbody', 'thead']);
const DROP_ALL = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'title', 'head', 'svg', 'math', 'select', 'option', 'frameset', 'frame', 'xmp', 'noembed', 'noframes', 'plaintext']);
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'area', 'base', 'wbr', 'source', 'track', 'param', 'embed']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A link target that is safe to make clickable, or null. */
export function safeHref(raw) {
  const v = decode(String(raw || '')).replace(/[\u0000- \u007f]+/g, '');
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

function hrefOf(attrs) {
  const m = /(?:^|[\s/])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  return m ? safeHref(m[1] ?? m[2] ?? m[3]) : null;
}

/** Untrusted ADO HTML to safe HTML. */
export function sanitize(html) {
  const src = String(html || '');
  const out = [];
  const stack = [];
  let dropping = null; // tag name whose content is being dropped
  let i = 0;
  const text = t => { if (!dropping && t) out.push(esc(decode(t))); };
  // Stack entries are {tag, end}: `end` is the closing markup written for it (an unsafe link is a span).
  const open = tag => { out.push(`<${tag}>`); stack.push({ tag, end: `</${tag}>` }); };
  const close = tag => {
    let at = -1;
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].tag === tag) { at = k; break; }
    if (at < 0) return;
    while (stack.length > at) out.push(stack.pop().end);
  };
  const inside = tag => stack.some(e => e.tag === tag);
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(src.slice(lt));
    if (!m) {
      if (/^<[!?\/]/.test(src.slice(lt, lt + 2))) { const gt = src.indexOf('>', lt); i = gt < 0 ? src.length : gt + 1; continue; }
      text('<');
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (dropping) {
      if (closing && tag === dropping) dropping = null;
      continue;
    }
    if (DROP_ALL.has(tag)) {
      if (!closing && !VOID.has(tag) && !/\/\s*$/.test(m[3])) dropping = tag;
      continue;
    }
    if (tag === 'img') { if (!closing) out.push('<span class="img-note">[image: open in ADO to see it]</span>'); continue; }
    if (tag === 'td' || tag === 'th') { if (closing) out.push(' | '); continue; }
    const t = AS_P.has(tag) ? 'p' : tag;
    if (!KEEP.has(t)) continue;
    if (t === 'br') { if (!closing) out.push('<br>'); continue; }
    if (closing) { close(t); continue; }
    if (t === 'a') {
      const href = hrefOf(m[3]);
      if (inside('a')) close('a');
      if (href) { out.push(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">`); stack.push({ tag: 'a', end: '</a>' }); }
      else { out.push('<span>'); stack.push({ tag: 'a', end: '</span>' }); }
      continue;
    }
    if (t === 'p' && inside('p')) close('p');
    if (t === 'li') {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === 'ul' || stack[k].tag === 'ol') break;
        if (stack[k].tag === 'li') { close('li'); break; }
      }
    }
    open(t);
  }
  while (stack.length) out.push(stack.pop().end);
  return out.join('').replace(/<p><\/p>/g, '');
}

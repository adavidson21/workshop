/* Notes: Markdown to safe HTML, and the facts the index needs (title, tags, links, headings).

   Every character of the input is escaped; the only markup in the output is what this file writes. Raw HTML
   in a note shows as text. Links: http(s) open in a new tab, links to other notes and images go through the
   callbacks, anything else (javascript:, data:, file:) is plain text. Images are shown only when imageUrl()
   gives a URL for them (files in the Workshop folder); remote images are never loaded.

   No DOM, so Node tests run it. Supported: frontmatter, ATX headings, paragraphs, emphasis, strong,
   strikethrough, code spans, fenced code, block quotes, nested lists, task lists, pipe tables, rules, links,
   images, [[wikilinks]], autolinks and #tags. Links to other apps (ws:<app>/<route>, applinks.js) become chips. */
import { appLink } from './applinks.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A link target that is safe to make clickable outside Workshop, or null. */
export function safeHref(raw) {
  const v = String(raw || '').replace(/[\u0000- \u007f]+/g, '');
  if (!/^https?:\/\//i.test(v)) return null;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

/* ---------- frontmatter ---------- */

/** {data: {title?, tags?: []}, body, offset} where offset is the number of lines the frontmatter took. */
export function frontmatter(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src, offset: 0 };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();
    if (val === '' && key === 'tags') {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) list.push(lines[++i].replace(/^\s*-\s+/, ''));
      data.tags = list.map(unquote).map(normTag).filter(Boolean);
      continue;
    }
    if (key === 'tags') {
      const inner = /^\[(.*)\]$/.exec(val);
      data.tags = (inner ? inner[1] : val).split(/[,\s]+/).map(unquote).map(normTag).filter(Boolean);
    } else if (key === 'title') data.title = unquote(val);
  }
  return { data, body: src.slice(m[0].length), offset: m[0].split('\n').length - (m[0].endsWith('\n') ? 1 : 0) };
}
const unquote = (s) => String(s).trim().replace(/^(["'])(.*)\1$/, '$2');
export const normTag = (t) => {
  const v = String(t || '').trim().replace(/^#/, '').toLowerCase();
  return /^[a-z0-9_][a-z0-9_/-]*$/.test(v) && /[a-z_]/.test(v) ? v : '';
};

/* ---------- blocks ---------- */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_SEP = /^ *\|?(?: *:?-+:? *\|)+ *:?-*:? *\|? *$/;

export const headingId = (text) => String(text).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'section';

/** Split a note into blocks: [{type, ...}] with `line` (0-based, in the body). */
export function blocks(body) {
  const lines = String(body).split(/\r?\n/);
  return parseBlocks(lines, 0);
}

function parseBlocks(lines, base) {
  const out = [];
  let i = 0;
  const blank = (s) => /^\s*$/.test(s);
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    let m;
    if ((m = FENCE.exec(line))) {
      const marker = m[1], start = i;
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ type: 'code', lang: m[2], text: body.join('\n'), line: base + start });
      continue;
    }
    if ((m = HEADING.exec(line))) { out.push({ type: 'heading', level: m[1].length, text: (m[2] || '').trim(), line: base + i }); i++; continue; }
    if (RULE.test(line)) { out.push({ type: 'rule', line: base + i }); i++; continue; }
    if (QUOTE.test(line)) {
      const start = i, inner = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || inner.length)) { inner.push(lines[i].replace(QUOTE, '')); i++; }
      out.push({ type: 'quote', children: parseBlocks(inner, base + start), line: base + start });
      continue;
    }
    if ((m = ITEM.exec(line))) {
      const start = i;
      const list = parseList(lines, i, base);
      i = list.end;
      out.push(Object.assign(list.node, { line: base + start }));
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const start = i;
      const head = cells(line);
      const align = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) rows.push({ cells: cells(lines[i]), line: base + i++ });
      out.push({ type: 'table', head, align, rows, line: base + start });
      continue;
    }
    const start = i, para = [];
    while (i < lines.length && !blank(lines[i]) && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !RULE.test(lines[i]) && !QUOTE.test(lines[i]) && !(para.length && ITEM.test(lines[i]) && !/^ {4}/.test(lines[i]))) para.push(lines[i++]);
    out.push({ type: 'para', text: para.join('\n'), line: base + start });
  }
  return out;
}

function cells(row) {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  const out = [];
  let cur = '';
  for (let k = 0; k < r.length; k++) {
    if (r[k] === '\\' && r[k + 1] === '|') { cur += '|'; k++; continue; }
    if (r[k] === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += r[k];
  }
  out.push(cur.trim());
  return out;
}

function parseList(lines, i, base) {
  const first = ITEM.exec(lines[i]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const node = { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const itemLine = i;
    const content = [m[3]];
    const contentIndent = m[0].length - m[3].length;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) {
        // A blank line ends the item unless the next line is indented under it.
        if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && lines[i + 1].search(/\S/) >= contentIndent) { content.push(''); i++; continue; }
        break;
      }
      const sub = ITEM.exec(l);
      if (sub && sub[1].length <= indent) break;
      if (!sub && !/^\s/.test(l) && (HEADING.test(l) || FENCE.test(l) || QUOTE.test(l) || RULE.test(l))) break;
      content.push(l.slice(Math.min(contentIndent, l.search(/\S|$/))));
      i++;
    }
    let task = null;
    const t = /^\[([ xX])\][ \t]+/.exec(content[0]);
    if (t) { task = t[1] !== ' '; content[0] = content[0].slice(t[0].length); }
    node.items.push({ task, children: parseBlocks(content, base + itemLine), line: base + itemLine });
    if (i < lines.length && /^\s*$/.test(lines[i])) {
      const next = ITEM.exec(lines[i + 1] || '');
      if (next && next[1].length === indent) { i++; continue; }
      break;
    }
  }
  return { node, end: i };
}

/* ---------- inline ---------- */

const WIKI = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/;
const IMG = /^!\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\s*\)/;
const LINK_START = /^\[/;
const AUTO = /^<(https?:\/\/[^>\s]+)>/i;
const TAG = /^#([A-Za-z0-9_][A-Za-z0-9_/-]*)/;

function findClose(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '[') depth++;
    else if (s[k] === ']' && --depth === 0) return k;
  }
  return -1;
}

/** Inline Markdown to HTML. ctx: {resolveLink(href) -> {kind, path?, anchor?}, imageUrl(src) -> url | {path} | null, wiki(target) -> {path}|null}. */
export function inline(text, ctx = {}) {
  const s = String(text);
  let html = '';
  let i = 0;
  const stack = []; // open emphasis markers: {marker, at}
  while (i < s.length) {
    const c = s[i], rest = s.slice(i);
    let m;
    if (c === '\\' && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1])) { html += esc(s[i + 1]); i += 2; continue; }
    if (c === '\\' && s[i + 1] === '\n') { html += '<br>'; i += 2; continue; }
    if (c === '`') {
      const ticks = /^`+/.exec(rest)[0];
      const end = s.indexOf(ticks, i + ticks.length);
      if (end > 0) { html += `<code>${esc(s.slice(i + ticks.length, end).replace(/^ (.+) $/, '$1'))}</code>`; i = end + ticks.length; continue; }
      html += esc(ticks); i += ticks.length; continue;
    }
    if (c === '!' && (m = IMG.exec(rest))) {
      const src = m[2].replace(/^<|>$/g, '');
      const url = ctx.imageUrl ? ctx.imageUrl(src) : null;
      // A string is a ready URL; {path} is a Workshop folder image the page loads and fills in after rendering.
      if (url && typeof url === 'object') html += `<img data-img="${esc(url.path)}" alt="${esc(m[1])}">`;
      else if (url) html += `<img src="${esc(url)}" alt="${esc(m[1])}" loading="lazy">`;
      else if (safeHref(src)) html += `<span class="img-note">[remote image not loaded: <a href="${esc(safeHref(src))}" target="_blank" rel="noopener noreferrer">${esc(m[1] || 'open')}</a>]</span>`;
      else html += `<span class="img-note missing">[image not found: ${esc(m[1] || src)}]</span>`;
      i += m[0].length; continue;
    }
    if (c === '[' && (m = WIKI.exec(rest))) {
      const target = m[1].trim(), label = (m[2] || m[1]).trim();
      const hit = ctx.wiki ? ctx.wiki(target) : null;
      html += hit ? `<a href="#" data-note="${esc(hit.path)}" class="note-link">${esc(label)}</a>` : `<a href="#" data-missing="${esc(target)}" class="note-link missing">${esc(label)}</a>`;
      i += m[0].length; continue;
    }
    if (c === '[' && LINK_START.test(rest)) {
      const close = findClose(s, i);
      const after = close > 0 ? /^\(\s*(<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\s*\)/.exec(s.slice(close + 1)) : null;
      if (after) {
        const label = inline(s.slice(i + 1, close), { ...ctx, noLinks: true });
        const href = after[1].replace(/^<|>$/g, '');
        html += linkHtml(href, label, ctx);
        i = close + 1 + after[0].length; continue;
      }
    }
    if (c === '<' && (m = AUTO.exec(rest))) { html += linkHtml(m[1], esc(m[1]), ctx); i += m[0].length; continue; }
    if (c === '#' && (i === 0 || /\s|\(/.test(s[i - 1])) && (m = TAG.exec(rest)) && normTag(m[1])) {
      html += `<a href="#" class="tag" data-tag="${esc(normTag(m[1]))}">#${esc(m[1])}</a>`;
      i += m[0].length; continue;
    }
    if (c === '~' && s[i + 1] === '~') { html += toggle(stack, '~~', 'del', html.length); i += 2; continue; }
    if (c === '*' || c === '_') {
      const run = new RegExp(`^\\${c}+`).exec(rest)[0];
      const prev = s[i - 1] || ' ', next = s[i + run.length] || ' ';
      // Underscores inside words are text (snake_case), as in CommonMark.
      if (c === '_' && /\w/.test(prev) && /\w/.test(next)) { html += esc(run); i += run.length; continue; }
      const canOpen = !/\s/.test(next), canClose = !/\s/.test(prev);
      let left = run.length;
      while (left > 0) {
        const n = left >= 2 ? 2 : 1;
        const marker = c.repeat(n);
        const open = stack.findLastIndex(e => e.marker === marker);
        if (canClose && open >= 0) { html = closeTo(stack, open, html, n === 2 ? 'strong' : 'em'); left -= n; continue; }
        if (canOpen) { stack.push({ marker, at: html.length, tag: n === 2 ? 'strong' : 'em' }); html += marker; left -= n; continue; }
        html += esc(marker); left -= n;
      }
      i += run.length; continue;
    }
    if (c === ' ' && /^ {2,}\n/.test(rest)) { html += '<br>'; i += /^ +\n/.exec(rest)[0].length; continue; }
    html += c === '\n' ? '\n' : esc(c);
    i++;
  }
  return html;
}
function linkHtml(href, labelHtml, ctx) {
  if (ctx.noLinks) return labelHtml;
  const ext = safeHref(href);
  if (ext) return `<a href="${esc(ext)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
  const app = appLink(href);
  if (app) return `<a href="#" class="app-link" data-app="${esc(app.app)}" data-app-path="${esc(app.path)}" title="Open in ${esc(ctx.appName ? ctx.appName(app.app) : app.app)}">${labelHtml}<span class="app-chip">${esc(ctx.appName ? ctx.appName(app.app) : app.app)}</span></a>`;
  const r = ctx.resolveLink ? ctx.resolveLink(href) : null;
  if (r && r.kind === 'note') return `<a href="#" data-note="${esc(r.path)}"${r.anchor ? ` data-anchor="${esc(r.anchor)}"` : ''} class="note-link">${labelHtml}</a>`;
  if (r && r.kind === 'anchor') return `<a href="#" data-anchor="${esc(r.anchor)}" class="note-link">${labelHtml}</a>`;
  if (r && r.kind === 'missing') return `<a href="#" data-missing-path="${esc(r.path)}" class="note-link missing">${labelHtml}</a>`;
  return `<span class="bad-link" title="Not a web or note link">${labelHtml}</span>`;
}
function toggle(stack, marker, tag, at) {
  const open = stack.findLastIndex(e => e.marker === marker);
  if (open >= 0) { stack.splice(open); return `</${tag}>`; }
  stack.push({ marker, at, tag });
  return `<${tag}>`;
}
function closeTo(stack, idx, html, tag) {
  const e = stack[idx];
  // Markers opened after this one and never closed become text.
  stack.splice(idx);
  return html.slice(0, e.at) + `<${tag}>` + html.slice(e.at + e.marker.length) + `</${tag}>`;
}
/** Unclosed markers stay as the characters they were; ~~ that opened a <del> without a close is closed. */
function finishInline(html) {
  const opens = (html.match(/<del>/g) || []).length, closes = (html.match(/<\/del>/g) || []).length;
  return html + '</del>'.repeat(Math.max(0, opens - closes));
}

/* ---------- render ---------- */

/** Markdown to HTML. ctx as for inline(). Headings get ids for the outline. */
export function render(md, ctx = {}) {
  const { body, offset } = frontmatter(md);
  const ids = new Map();
  return renderBlocks(parseBlocks(String(body).split(/\r?\n/), offset), ctx, ids);
}
function renderBlocks(list, ctx, ids) {
  let h = '';
  for (const b of list) {
    if (b.type === 'heading') {
      let id = headingId(b.text);
      const n = ids.get(id) || 0;
      ids.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      h += `<h${b.level} id="h-${esc(id)}" data-line="${b.line}">${fin(b.text, ctx)}</h${b.level}>`;
    } else if (b.type === 'para') h += `<p data-line="${b.line}">${fin(b.text, ctx)}</p>`;
    else if (b.type === 'code') h += `<pre data-line="${b.line}"><code${b.lang ? ` data-lang="${esc(b.lang)}"` : ''}>${esc(b.text)}</code></pre>`;
    else if (b.type === 'rule') h += '<hr>';
    else if (b.type === 'quote') h += `<blockquote>${renderBlocks(b.children, ctx, ids)}</blockquote>`;
    else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const task = b.items.some(it => it.task !== null) ? ' class="tasks"' : '';
      h += `<${tag}${start}${task}>`;
      for (const it of b.items) {
        const tight = it.children.length && it.children[0].type === 'para';
        const box = it.task === null ? '' : `<input type="checkbox" disabled${it.task ? ' checked' : ''}> `;
        let inner = renderBlocks(it.children, ctx, ids);
        if (tight) inner = inner.replace(/^<p data-line="\d+">([\s\S]*?)<\/p>/, '$1');
        h += `<li data-line="${it.line}">${box}${inner}</li>`;
      }
      h += `</${tag}>`;
    } else if (b.type === 'table') {
      const al = (k) => (b.align[k] ? ` style="text-align:${b.align[k]}"` : '');
      h += `<div class="table-wrap"><table><thead><tr>${b.head.map((c, k) => `<th${al(k)}>${fin(c, ctx)}</th>`).join('')}</tr></thead><tbody>`;
      for (const r of b.rows) h += `<tr>${b.head.map((_, k) => `<td${al(k)}>${fin(r.cells[k] || '', ctx)}</td>`).join('')}</tr>`;
      h += '</tbody></table></div>';
    }
  }
  return h;
}
const fin = (t, ctx) => finishInline(inline(t, ctx));

/* ---------- facts for the index ---------- */

/**
 * What a note says about itself: {title, tags, links: [{href, line, image}], wikilinks: [{target, line}],
 * headings: [{level, text, id, line}]}. Lines are 0-based in the whole file. Code is skipped.
 */
export function facts(md, fallbackTitle = '') {
  const { data, body, offset } = frontmatter(md);
  const tags = new Set(data.tags || []);
  const links = [], wikilinks = [], headings = [];
  const ids = new Map();
  const walk = (list) => {
    for (const b of list) {
      if (b.type === 'heading') {
        let id = headingId(b.text);
        const n = ids.get(id) || 0; ids.set(id, n + 1); if (n) id = `${id}-${n}`;
        headings.push({ level: b.level, text: plainText(b.text), id, line: b.line + offset });
        scanInline(b.text, b.line + offset, { links, wikilinks });
      } else if (b.type === 'para') scanInline(b.text, b.line + offset, { links, wikilinks, tags });
      else if (b.type === 'quote') walk(b.children);
      else if (b.type === 'list') for (const it of b.items) walk(it.children);
      else if (b.type === 'table') for (const r of [{ cells: b.head, line: b.line }, ...b.rows]) for (const c of r.cells) scanInline(c, r.line + offset, { links, wikilinks, tags });
    }
  };
  walk(blocks(body));
  const h1 = headings.find(h => h.level === 1);
  return { title: data.title || (h1 && h1.text) || fallbackTitle, tags: [...tags].sort(), links, wikilinks, headings };
}

function scanInline(text, line, acc) {
  const s = String(text).replace(/(`+)[\s\S]*?\1/g, m => ' '.repeat(m.length)); // code spans are not links or tags
  const lineOf = (at) => line + (s.slice(0, at).match(/\n/g) || []).length;
  let m;
  const wiki = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;
  while ((m = wiki.exec(s))) acc.wikilinks.push({ target: m[1].trim(), line: lineOf(m.index) });
  const link = /(!?)\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\s*\)/g;
  while ((m = link.exec(s))) acc.links.push({ href: m[2].replace(/^<|>$/g, ''), line: lineOf(m.index), image: m[1] === '!' });
  if (acc.tags) {
    const tag = /(^|[\s(])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;
    while ((m = tag.exec(s))) { const t = normTag(m[2]); if (t) acc.tags.add(t); }
  }
}

/** Inline Markdown to plain text (for titles and outline entries). */
export function plainText(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .trim();
}

/* Notes: a note ready to paste somewhere else, such as the company wiki, with its images inside it.

   Two forms of the same note, put on the clipboard together so one paste works in a visual editor or a
   Markdown box:
   - Markdown, with every image from the Workshop folder embedded as a data: URL (base64).
   - HTML from the same Markdown, with the images inside it, and links to other notes as plain text
     (they would not lead anywhere outside Workshop). Diagrams are pictures in the HTML; the Markdown keeps
     each ```mermaid block as written, since Markdown editors draw those themselves.
   Nothing is uploaded anywhere: the clipboard is the only place it goes. Pure, so Node tests run it. */
import { esc, headingId, render } from './markdown.js';
import { isImagePath, localHref, outsideCode, resolvePath } from './model.js';

const IMG_RE = /(!\[(?:[^\]\\\n]|\\.)*\]\(\s*)(<[^>\n]*>|[^)\s]*)((?:\s+"[^"\n]*")?\s*\))/g;
const DATA_IMG = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Embed the note's folder images. dataUrlFor(path) resolves a data: URL, or null if the image is not there.
 * Returns {markdown, embedded: [paths], missing: [paths]}. Remote images, code and other links are unchanged.
 */
export async function inlineImages(md, fromPath, dataUrlFor) {
  const wanted = new Set();
  outsideCode(md, (s) => { for (const m of s.matchAll(IMG_RE)) { const p = target(fromPath, m[2]); if (p) wanted.add(p); } return s; });
  const urls = new Map();
  for (const p of wanted) urls.set(p, await dataUrlFor(p));
  const markdown = outsideCode(md, (s) => s.replace(IMG_RE, (m, pre, href, post) => {
    const p = target(fromPath, href);
    const url = p && urls.get(p);
    return url ? `${pre}${url}${post}` : m;
  }));
  const embedded = [...urls].filter(([, u]) => u).map(([p]) => p);
  const missing = [...urls].filter(([, u]) => !u).map(([p]) => p);
  return { markdown, embedded, missing };
}
function target(fromPath, href) {
  const loc = localHref(href.replace(/^<|>$/g, ''));
  if (!loc || !loc.path) return null;
  const p = resolvePath(fromPath, loc.path);
  return p && isImagePath(p) ? p : null;
}

/** HTML for a visual editor: images from data: URLs or the web, web links kept, everything else plain.
    diagrams: Map of a ```mermaid block's source to its PNG data: URL; a diagram not in it stays as its code. */
export function wikiHtml(markdown, diagrams = new Map()) {
  const html = render(markdown, {
    imageUrl: (src) => (DATA_IMG.test(src) || /^https?:\/\//i.test(src) ? src : null),
    diagramImage: (src) => { const u = diagrams.get(src); return u && DATA_IMG.test(u) ? u : null; },
    resolveLink: () => null,
    wiki: () => null
  });
  return html
    .replace(/<a href="#"[^>]*>([\s\S]*?)<\/a>/g, '$1')                        // notes, tags, anchors
    .replace(/<span class="bad-link"[^>]*>([\s\S]*?)<\/span>/g, '$1')
    .replace(/ (?:data-line|data-lang|loading)="[^"]*"| id="h-[^"]*"/g, '')
    .replace(/<figure class="diagram"><pre class="diagram-src">([\s\S]*?)<\/pre><\/figure>/g, '<pre>$1</pre>')
    .replace(/<span class="tok-[a-z]+">([\s\S]*?)<\/span>/g, '$1')                          // syntax colors
    .replace(/<div class="callout callout-[a-z]+" role="note"><p class="callout-title">([\s\S]*?)<\/p>([\s\S]*?)<\/div>/g, '<blockquote><p><strong>$1</strong></p>$2</blockquote>')
    .replace(/<sup class="fn-ref"[^>]*>/g, '<sup>').replace(/ class="note-link fn-back"[^>]*/g, '');
}

/** Bytes to a data: URL. */
export function dataUrl(type, bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

const DATA_PAGE_IMG = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

/**
 * The note as one self-contained web page (Download HTML): images and diagrams inside it as data: URLs, code
 * colored, callouts and footnotes kept, links to headings working, links to other notes as plain text. The
 * page allows nothing but its own styles and data: or web images. diagrams: Map(source -> data: URL);
 * embed: markdown.js's ctx.embed, for ![[note]] embeds.
 */
export function pageHtml(markdown, { title = '', diagrams = new Map(), embed = null } = {}) {
  const body = render(markdown, {
    imageUrl: (src) => (DATA_IMG.test(src) || /^https?:\/\//i.test(src) ? src : null),
    diagramImage: (src) => { const u = diagrams.get(src); return u && DATA_PAGE_IMG.test(u) ? u : null; },
    resolveLink: (href) => { const loc = localHref(href); return loc && !loc.path && loc.anchor ? { kind: 'anchor', anchor: loc.anchor } : null; },
    wiki: () => null,
    embed
  })
    .replace(/<a href="#" data-anchor="([^"]*)"[^>]*>/g, (m, a) => `<a href="#h-${esc(headingId(a.replace(/&[a-z#0-9]+;/gi, '')))}">`)
    .replace(/<a href="#"[^>]*>([\s\S]*?)<\/a>/g, '$1')                        // other notes, tags, other apps
    .replace(/<span class="(?:bad-link|app-chip)"[^>]*>([\s\S]*?)<\/span>/g, '$1')
    .replace(/<div class="embed-head">[\s\S]*?<\/div>/g, '')
    .replace(/ data-[a-z-]+="[^"]*"/g, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><main class="md">${body}</main></body></html>
`;
}

const PAGE_CSS = `
:root{color-scheme:light;--ink:#1f1d1a;--muted:#6b665e;--line:#e2ddd3;--sunk:#f4f1ea;--accent:#3f5f6e}
body{margin:0;background:#fff;color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.md{max-width:46rem;margin:0 auto;padding:2.5rem 1.5rem 4rem;overflow-wrap:anywhere}
h1,h2,h3,h4{font-family:Georgia,"Times New Roman",serif;line-height:1.2;margin:1.6em 0 .5em}h1{font-size:2rem;margin-top:0}
h2{font-size:1.45rem;padding-bottom:.25rem;border-bottom:1px solid var(--line)}h3{font-size:1.18rem}
p,ul,ol,blockquote,pre,table,.callout,.embed{margin:0 0 1em}a{color:var(--accent)}
code{font:.86em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--sunk);padding:.1em .3em;border-radius:4px}
pre{background:var(--sunk);border:1px solid var(--line);border-radius:6px;padding:.8rem 1rem;overflow-x:auto}pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--line);padding:.1rem 0 .1rem 1rem;color:var(--muted)}
table{border-collapse:collapse;font-size:.92rem}th,td{border:1px solid var(--line);padding:.35rem .6rem;vertical-align:top}th{background:var(--sunk);text-align:left}
img{max-width:100%;height:auto}figure{margin:0 0 1em}p>img[alt=Diagram]{display:block;margin:0 auto}
li.task{list-style:none;margin-left:-1.2rem}hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}
.tok-c{color:var(--muted);font-style:italic}.tok-s{color:#3d7a3a}.tok-n{color:#a3561c}.tok-k{color:#7a3e9d}.tok-f{color:#2f5f8a}
.tok-t{color:#8a5a00}.tok-a{color:#a33a5b}.tok-v{color:#0f6f73}.tok-add{color:#2f6f2c;background:#e6f2e3}.tok-del{color:#9b2c2c;background:#f7e3e2}.tok-meta{color:var(--muted)}
.callout{padding:.6rem .9rem .1rem;border-left:3px solid var(--c);background:color-mix(in srgb,var(--c) 8%,#fff)}
.callout-title{font-weight:600;color:var(--c);margin:0 0 .35em}.callout-note{--c:#3b6ea8}.callout-tip{--c:#2f7d4f}
.callout-important{--c:#7a4bb0}.callout-warning{--c:#a86b00}.callout-caution{--c:#b13c3c}
.embed{border:1px solid var(--line);border-radius:6px;padding:.4rem 1rem}
.fn-ref{font-size:.72em;line-height:0}.footnotes{margin-top:2em;padding-top:.6em;border-top:1px solid var(--line);font-size:.88rem;color:var(--muted)}
@media print{.md{max-width:none;padding:0}pre,figure,table,.callout{break-inside:avoid}}
`;

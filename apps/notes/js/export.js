/* Notes: a note ready to paste somewhere else, such as the company wiki, with its images inside it.

   Two forms of the same note, put on the clipboard together so one paste works in a visual editor or a
   Markdown box:
   - Markdown, with every image from the Workshop folder embedded as a data: URL (base64).
   - HTML from the same Markdown, with the images inside it, and links to other notes as plain text
     (they would not lead anywhere outside Workshop). Diagrams are pictures in the HTML; the Markdown keeps
     each ```mermaid block as written, since Markdown editors draw those themselves.
   Nothing is uploaded anywhere: the clipboard is the only place it goes. Pure, so Node tests run it. */
import { render } from './markdown.js';
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
    .replace(/<figure class="diagram"><pre class="diagram-src">([\s\S]*?)<\/pre><\/figure>/g, '<pre>$1</pre>');
}

/** Bytes to a data: URL. */
export function dataUrl(type, bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

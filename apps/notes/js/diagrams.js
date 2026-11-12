/* Folio: Mermaid diagrams in the preview, and as SVG or PNG files.

   markdown.js writes each ```mermaid block as <figure class="diagram"> holding its source; paintDiagrams() draws
   them. Mermaid (vendor/mermaid.min.js, MIT) is loaded from this site only when a note has a diagram, so other
   notes stay light, and the service worker keeps it for offline. It runs with securityLevel 'strict' (labels
   are sanitized, no click handlers, no HTML labels), so a diagram is only ever an SVG picture.

   Drawn diagrams are kept by source and theme, so repainting the preview while typing elsewhere is instant.
   While a diagram is being redrawn, or has an error mid-edit, the last good picture stays (dimmed) with the
   error under it; a diagram with no good picture yet shows its source and the error. Exports (Copy SVG,
   PNG, Copy for wiki) are drawn in the light theme on white, so they read well wherever they are pasted. */

const cache = new Map();    // `${theme}\n${src}` -> {svg} | {error}
const lastGood = new Map(); // `${key}#${index}` -> svg
let lib = null, queue = Promise.resolve(), configured = '', seq = 0;

export const themeNow = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function load() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  lib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/mermaid.min.js', import.meta.url).href;
    s.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('The diagram library did not start.')));
    s.onerror = () => { lib = null; s.remove(); reject(new Error('Could not load the diagram library. Check your connection and reload.')); };
    document.head.append(s);
  });
  return lib;
}

function config(theme) {
  return {
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    theme: theme === 'dark' ? 'dark' : 'neutral', htmlLabels: false, flowchart: { htmlLabels: false },
    fontFamily: 'Figtree, ui-sans-serif, system-ui, sans-serif'
  };
}

function errText(e) {
  const msg = String((e && (e.message || e.str)) || e || 'This diagram has an error.');
  return msg.replace(/\s+$/g, '').slice(0, 600);
}

/** Draw one diagram: {svg} or {error}. Rejects only if Mermaid itself can't load. One at a time (Mermaid is not reentrant). */
export function renderSvg(src, theme = themeNow()) {
  const key = `${theme}\n${src}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const job = queue.then(async () => {
    if (cache.has(key)) return cache.get(key);
    const m = await load();
    if (configured !== theme) { m.initialize(config(theme)); configured = theme; }
    const id = `folio-d${++seq}`;
    let out;
    try {
      await m.parse(src);
      out = { svg: (await m.render(id, src)).svg };
    } catch (e) { out = { error: errText(e) }; }
    for (const stray of [document.getElementById(id), document.getElementById(`d${id}`)]) if (stray && !stray.closest('.diagram')) stray.remove();
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  });
  queue = job.catch(() => {});
  return job;
}

const TOOLS = `<div class="diagram-tools" role="toolbar" aria-label="Diagram">
  <button type="button" class="ibtn" data-diagram-act="edit" title="Edit this diagram">Edit</button>
  <button type="button" class="ibtn" data-diagram-act="copy-svg" title="Copy as SVG">Copy SVG</button>
  <button type="button" class="ibtn" data-diagram-act="svg" title="Download as SVG">SVG</button>
  <button type="button" class="ibtn" data-diagram-act="png" title="Download as PNG">PNG</button></div>`;

/** Draw every diagram under root. key names the note, so a diagram keeps its last good picture while it is edited. */
export function paintDiagrams(root, { key = '', tools = true } = {}) {
  if (!root) return;
  const theme = themeNow();
  root.querySelectorAll('figure.diagram').forEach((fig, k) => {
    const src = fig.querySelector('.diagram-src code')?.textContent ?? '';
    const id = `${key}#${k}`;
    if (tools && !fig.querySelector('.diagram-tools')) fig.insertAdjacentHTML('afterbegin', TOOLS);
    const hit = cache.get(`${theme}\n${src}`);
    if (hit) { fill(fig, hit, id); return; }
    const prev = lastGood.get(id);
    if (prev) show(fig, prev, { stale: true });
    else fig.classList.add('drawing');
    renderSvg(src, theme).then(r => { if (fig.isConnected) fill(fig, r, id); }, e => { if (fig.isConnected) fail(fig, errText(e), null); });
  });
}
function fill(fig, r, id) {
  if (r.svg) { lastGood.set(id, r.svg); show(fig, r.svg); }
  else fail(fig, r.error, lastGood.get(id));
}
function show(fig, svg, { stale = false } = {}) {
  let out = fig.querySelector('.diagram-out');
  if (!out) { out = document.createElement('div'); out.className = 'diagram-out'; fig.querySelector('.diagram-src').before(out); }
  if (out.dataset.svg !== svg) { out.innerHTML = svg; out.dataset.svg = svg; }
  fig.querySelector('.diagram-err')?.remove();
  fig.classList.remove('drawing', 'has-error');
  fig.classList.add('drawn');
  fig.classList.toggle('stale', stale);
}
function fail(fig, message, prev) {
  if (prev) show(fig, prev, { stale: true });
  else { fig.querySelector('.diagram-out')?.remove(); fig.classList.remove('drawn', 'stale'); }
  fig.classList.remove('drawing');
  fig.classList.add('has-error');
  let err = fig.querySelector('.diagram-err');
  if (!err) { err = document.createElement('pre'); err.className = 'diagram-err'; err.setAttribute('role', 'status'); fig.append(err); }
  err.textContent = message;
}

/** Highlight the diagram drawn from the fence starting at this line (or none), and bring it into view. */
export function markDiagram(root, line) {
  for (const f of root.querySelectorAll('figure.diagram.at-cursor')) if (Number(f.dataset.line) !== line) f.classList.remove('at-cursor');
  if (line === null || line === undefined) return;
  const fig = root.querySelector(`figure.diagram[data-line="${line}"]`);
  if (fig && !fig.classList.contains('at-cursor')) { fig.classList.add('at-cursor'); fig.scrollIntoView({ block: 'nearest' }); }
}

/* ---------- exports ---------- */

/** A diagram as a standalone SVG file's text, drawn in the light theme. Throws with Mermaid's message on an error. */
export async function svgFile(src) {
  const r = await renderSvg(src, 'light');
  if (!r.svg) throw new Error(`This diagram has an error: ${r.error.split('\n')[0]}`);
  const { el, w, h } = parseSvg(r.svg);
  el.setAttribute('width', String(Math.ceil(w)));
  el.setAttribute('height', String(Math.ceil(h)));
  el.style.maxWidth = '';
  el.style.backgroundColor = '#ffffff';
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(el);
}

/** A diagram as PNG bytes (2x), on white. */
export async function pngBytes(src, scale = 2) {
  const text = await svgFile(src);
  const { w, h } = parseSvg(text);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * scale)); c.height = Math.max(1, Math.ceil(h * scale));
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not make the PNG.'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

function parseSvg(text) {
  const box = document.createElement('div');
  box.innerHTML = String(text).replace(/^<\?xml[^>]*>\s*/, '');
  const el = box.querySelector('svg');
  if (!el) throw new Error('Could not read the diagram.');
  const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(el.getAttribute('width')) || 800;
  const h = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(el.getAttribute('height')) || 600;
  return { el, w, h };
}

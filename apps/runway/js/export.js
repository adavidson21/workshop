/* Exports: the timeline as SVG or PNG, the roadmap as Markdown. Everything but toPng() is pure, so Node
   tests check the exact output. */
import { fmt, today } from './dates.js';
import { schedule, viewRange } from './model.js';
import { TABLE_MARK, serialize } from './outline.js';
import { layout, svg } from './timeline.js';

const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/** The roadmap as Markdown: the outline, and with `table` a table after it (ignored on import). */
export function markdown(doc, { table = false } = {}) {
  let out = serialize(doc);
  if (!table) return out;
  const sched = schedule(doc);
  const byId = new Map(doc.items.map(i => [i.id, i]));
  const lanes = [{ id: null, title: '' }, ...[...doc.lanes].sort((a, b) => a.order - b.order)];
  const rows = [];
  for (const l of lanes) {
    for (const it of doc.items.filter(x => x.kind === 'item' && (x.lane || null) === l.id).sort((a, b) => a.order - b.order)) {
      const s = sched.get(it.id);
      const after = it.dependsOn.map(d => byId.get(d)).filter(Boolean).map(d => d.title);
      rows.push(`| ${cell(l.title)} | ${cell((it.milestone ? 'Milestone: ' : '') + it.title)} | ${s ? fmt(s.start) : ''} | ${s && !it.milestone ? fmt(s.end) : ''} | ${cell(it.status)} | ${cell(after.join(', '))} |`);
    }
  }
  out += `\n${TABLE_MARK}\n\n| Lane | Item | Start | End | Status | After |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;
  return out;
}

/** A file name from a title: letters, digits and dashes, then the date and extension. */
export function fileName(title, ext, now = new Date()) {
  const slug = String(title || 'roadmap').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'roadmap';
  return `${slug}-${today(now)}.${ext}`;
}

/** The SVG for an image export: what is on screen (range, folded lanes left out) with the options chosen. */
export function exportSvg(doc, { range, theme = 'light', title = true, todayLine = true, now = new Date() } = {}) {
  const sched = schedule(doc);
  const r = range || viewRange(doc, sched, now);
  const L = layout(doc, { sched, range: r, hideCollapsed: true });
  return svg(L, {
    theme,
    title: title ? doc.meta.title : '',
    subtitle: `${fmt(r.from)} to ${fmt(r.to)}`,
    today: today(now),
    showToday: todayLine
  });
}

/** Render an SVG string to PNG bytes in the browser, at `scale` times its size (capped for huge maps). */
export async function toPng(svgText, scale = 2) {
  const w = Number(/width="(\d+(?:\.\d+)?)"/.exec(svgText)[1]);
  const h = Number(/height="(\d+(?:\.\d+)?)"/.exec(svgText)[1]);
  const s = Math.max(1, Math.min(scale, 16000 / w, 16000 / h));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d');
  g.scale(s, s);
  g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not make the image.'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/* Exports: the timeline as SVG or PNG, the roadmap as Markdown. Everything but toPng() is pure, so Node
   tests check the exact output. */
import { MONTHS, fmt, parts, periodLabel, periods, sprintOf, today } from './dates.js';
import { goalFor, schedule, viewRange } from './model.js';
import { TABLE_MARK, serialize } from './outline.js';
import { FONTS, THEME, esc, layout, svg } from './timeline.js';

const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/** The roadmap as Markdown: the outline, and with `table` a table after it (ignored on import). mention: an
    owner id as written in the outline (an @handle); names: owner ids to display names, for the table. */
export function markdown(doc, { table = false, mention = id => id, names = who => who } = {}) {
  let out = serialize(doc, { mention });
  if (!table) return out;
  const sched = schedule(doc);
  const byId = new Map(doc.items.map(i => [i.id, i]));
  const lanes = [{ id: null, title: '' }, ...[...doc.lanes].sort((a, b) => a.order - b.order)];
  const rows = [];
  const owners = doc.items.some(x => x.kind === 'item' && x.who && x.who.length);
  for (const l of lanes) {
    for (const it of doc.items.filter(x => x.kind === 'item' && (x.lane || null) === l.id).sort((a, b) => a.order - b.order)) {
      const s = sched.get(it.id);
      const after = it.dependsOn.map(d => byId.get(d)).filter(Boolean).map(d => d.title);
      rows.push(`| ${cell(l.title)} | ${cell((it.milestone ? 'Milestone: ' : '') + it.title)} | ${s ? fmt(s.start) : ''} | ${s && !it.milestone ? fmt(s.end) : ''} | ${cell(it.status)} | ${cell(after.join(', '))}${owners ? ` | ${cell(names(it.who || []).join(', '))}` : ''} | ${cell(it.notes.trim())} |`);
    }
  }
  // Owners get a column only when some item has one, so roadmaps without owners export as before.
  const head = owners ? '| Lane | Item | Start | End | Status | After | Owners | Description |\n| --- | --- | --- | --- | --- | --- | --- | --- |' : '| Lane | Item | Start | End | Status | After | Description |\n| --- | --- | --- | --- | --- | --- | --- |';
  out += `\n${TABLE_MARK}\n\n${head}\n${rows.join('\n')}\n`;
  return out;
}

/** A period's name for people: "S3 (Jan 20 to Feb 2)", "Mar 2027", "Q2 2027", "Week of Jan 4". */
export function periodName(doc, p) {
  const s = sprintOf(doc.meta), d = parts(p.start);
  switch (doc.meta.scale) {
    case 'sprint': return `${periodLabel('sprint', p.start, { origin: doc.meta.origin, sprint: s })} (${fmt(p.start).replace(/, \d{4}$/, '')} to ${fmt(p.end)})`;
    case 'week': return `Week of ${fmt(p.start)}`;
    case 'quarter': return `Q${Math.floor((d.m - 1) / 3) + 1} ${d.y}`;
    default: return `${MONTHS[d.m - 1]} ${d.y}`;
  }
}

/**
 * What the roadmap delivers in a date range: the goal of each period that has one, and every item in the
 * range that has a description (its notes), lane by lane. Used under the timeline and in image exports.
 */
export function summary(doc, range) {
  const sched = schedule(doc);
  const goals = periods(doc.meta.scale, range.from, range.to, sprintOf(doc.meta))
    .map(p => ({ ...p, name: periodName(doc, p), text: goalFor(doc, p.start) })).filter(g => g.text);
  const hidden = new Set(doc.meta.hidden || []);
  const lanes = [{ id: null, title: 'No lane' }, ...[...doc.lanes].sort((a, b) => a.order - b.order)].filter(l => !hidden.has(l.id));
  const items = [];
  for (const l of lanes) {
    for (const it of doc.items.filter(x => x.kind === 'item' && (x.lane || null) === l.id).sort((a, b) => a.order - b.order)) {
      const s = sched.get(it.id);
      if (!it.notes.trim() || !s || s.end < range.from || s.start > range.to) continue;
      items.push({ id: it.id, lane: l.id ? l.title : '', title: it.title, start: s.start, end: s.end, milestone: it.milestone, status: it.status, notes: it.notes.trim() });
    }
  }
  return { goals, items };
}

const wrap = (text, chars) => {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + w).length > chars) { out.push(line); line = ''; }
      line = line ? line + ' ' + w : (w.length > chars ? w.slice(0, chars - 1) + '…' : w);
    }
    if (line) out.push(line);
  }
  return out;
};

/** The summary as SVG rows to put under the timeline in an image: {height, body} at width `w`. */
export function summarySvg(doc, range, w, theme = 'light') {
  const T = THEME[theme] || THEME.light;
  const { goals, items } = summary(doc, range);
  if (!goals.length && !items.length) return { height: 0, body: '' };
  const chars = Math.max(30, Math.floor((w - 60) / 6.6));
  const o = [];
  let y = 28;
  const label = (t) => { o.push(`<text x="20" y="${y}" font-family='${FONTS.mono}' font-size="10.5" letter-spacing=".6" fill="${T.eyebrow}">${esc(t)}</text>`); y += 20; };
  if (goals.length) {
    label(doc.meta.scale === 'sprint' ? 'SPRINT GOALS' : 'GOALS');
    for (const g of goals) {
      const lines = wrap(g.text, chars - 4);
      o.push(`<text x="20" y="${y}" font-size="12" font-weight="600" fill="${T.ink}">${esc(g.name)}</text>`); y += 17;
      for (const l of lines) { o.push(`<text x="32" y="${y}" font-size="12" fill="${T.muted}">${esc(l)}</text>`); y += 16; }
      y += 6;
    }
    y += 8;
  }
  if (items.length) {
    label("WHAT'S GETTING DONE");
    for (const it of items) {
      const when = it.milestone ? fmt(it.start) : `${fmt(it.start)} to ${fmt(it.end)}`;
      o.push(`<text x="20" y="${y}" font-size="12" fill="${T.ink}"><tspan font-weight="600">${esc(it.title)}</tspan><tspan fill="${T.muted}">  ${esc([it.lane, when, it.status !== 'planned' ? it.status : ''].filter(Boolean).join(' · '))}</tspan></text>`); y += 17;
      for (const l of wrap(it.notes, chars - 4)) { o.push(`<text x="32" y="${y}" font-size="12" fill="${T.muted}">${esc(l)}</text>`); y += 16; }
      y += 6;
    }
  }
  return { height: y + 8, body: `<line x1="0" x2="${w}" y1="0.5" y2="0.5" stroke="${T.ink}"/>` + o.join('') };
}

/** A file name from a title: letters, digits and dashes, then the date and extension. */
export function fileName(title, ext, now = new Date()) {
  const slug = String(title || 'roadmap').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'roadmap';
  return `${slug}-${today(now)}.${ext}`;
}

/** The SVG for an image export: what is on screen (range, folded lanes left out) with the options chosen. */
export function exportSvg(doc, { range, theme = 'light', title = true, todayLine = true, details = true, showIds = false, now = new Date() } = {}) {
  const sched = schedule(doc);
  const r = range || viewRange(doc, sched, now);
  const L = layout(doc, { sched, range: r, hideCollapsed: true });
  const out = svg(L, {
    theme,
    title: title ? doc.meta.title : '',
    subtitle: `${fmt(r.from)} to ${fmt(r.to)}`,
    today: today(now),
    showToday: todayLine,
    showIds
  });
  if (!details) return out;
  // Goals and descriptions under the chart: make the image taller and add them at the bottom.
  const width = Math.max(L.width, 560);
  const extra = summarySvg(doc, r, width, theme);
  if (!extra.height) return out;
  const m = /^<svg[^>]*width="(\d+)" height="(\d+)"/.exec(out);
  const h = Number(m[2]), w0 = Number(m[1]), w = Math.max(w0, width), H = h + extra.height;
  const bg = (THEME[theme] || THEME.light).bg;
  return out
    .replace(/^(<svg[^>]*?)width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/, `$1width="${w}" height="${H}" viewBox="0 0 ${w} ${H}"`)
    .replace(/<\/svg>$/, `<rect x="0" y="${h}" width="${w}" height="${extra.height}" fill="${bg}"/><g transform="translate(0 ${h})">${extra.body}</g></svg>`);
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

/* The timeline (Gantt): geometry, then SVG. No DOM, so Node tests drive it, and the same SVG is what the
   page shows and what the image export saves.

   layout(doc, ...) places every lane and bar; svg(L, ...) draws it with the colors it is given (the page
   passes its current theme; the export passes the theme the user picks), so the picture never depends on
   page CSS. All text is escaped.

   Nesting: in each lane, items with no parent and no children share rows, packed by date, as before. Each item
   with children (an epic) then gets its own block: its own row, then a row group per level under it (features,
   then stories, then tasks), each packed by date. Bars are colored by level unless the item sets a color. */
import { PX, addDays, addMonths, fromDay, isDate, monthStart, parts, periodLabel, periods, sprintOf, toDay, MONTHS } from './dates.js';
import { COLORS, depWarnings, goalFor, itemColor, levels, schedule } from './model.js';

export const GUTTER = 200;
export const HEAD = 48;
export const ROW = 32;
export const GOAL_ROW = 40;
const BAR = 20;
const PAD = 8;
const COLLAPSED = 30;
const CHAR = 6.6;          // average width of a 12px Figtree character (a little generous), for fitting labels

export const PALETTE = {
  light: { slate: '#4F6B78', teal: '#2F7A74', green: '#4E7A3A', amber: '#9A6214', red: '#9B3A30', purple: '#6A5487', gray: '#776F68', on: '#FFFFFF' },
  dark: { slate: '#A9BCC6', teal: '#8CC7BF', green: '#A9C99A', amber: '#E2B66D', red: '#F0A79E', purple: '#C3B2DD', gray: '#B8B1AA', on: '#161514' }
};
export const THEME = {
  light: { bg: '#F4F1EA', surface: '#FBF9F5', panel: '#ECE7DD', ink: '#2A2627', muted: '#675F5A', line: '#DCD4C6', eyebrow: '#8B6340', warn: '#8A5A12', danger: '#9B2C24', accent: '#4F6B78' },
  dark: { bg: '#161514', surface: '#1D1C1A', panel: '#211F1D', ink: '#EEEBE7', muted: '#A8A29C', line: '#34312E', eyebrow: '#CBA684', warn: '#E2B66D', danger: '#F2BDB7', accent: '#A9BCC6' }
};
export const FONTS = {
  sans: 'Figtree, "Segoe UI", system-ui, -apple-system, Arial, sans-serif',
  serif: 'Gelasio, Georgia, "Times New Roman", serif',
  mono: '"DM Mono", Consolas, Menlo, monospace'
};

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fit = (s, px) => { const n = Math.max(0, Math.floor(px / CHAR)); s = String(s); return s.length <= n ? s : (n <= 1 ? '' : s.slice(0, n - 1) + '…'); };
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Place lanes and bars. Options: sched, range {from, to}, hideCollapsed (export: leave folded lanes out),
 * only (only these lane ids), gutter (width of the lane names).
 */
export function layout(doc, { sched = schedule(doc), range, hideCollapsed = false, only = null, gutter = GUTTER, goalRow = 'auto', fill = 0 } = {}) {
  const GUTTER = gutter;
  // The goals row under the header: one cell per period, always on screen (to add one), in exports only when used.
  const sprint = sprintOf(doc.meta);
  const goalCells = periods(doc.meta.scale, range.from, range.to, sprint).map(p => ({ ...p, text: goalFor(doc, p.start) }));
  const head = HEAD + (goalRow === true || (goalRow === 'auto' && goalCells.some(c => c.text)) ? GOAL_ROW : 0);
  const scale = doc.meta.scale;
  const from = range.from, to = range.to;
  const days = toDay(to) - toDay(from) + 1;
  // fill: the width to fill on screen (exports leave it out). The scale's day width is the least; a short range
  // stretches up to 4 times that, so the timeline uses the pane instead of stopping halfway.
  const base = PX[scale] || PX.month;
  const px = fill > 0 ? Math.min(base * 4, Math.max(base, (fill - GUTTER - 16) / days)) : base;
  const x = (d) => GUTTER + (toDay(d) - toDay(from)) * px;
  const width = Math.ceil(GUTTER + days * px + 16);
  const hidden = new Set(doc.meta.hidden || []);
  const items = doc.items.filter(i => i.kind === 'item');
  const loose = items.filter(i => !i.lane);
  const laneList = [
    ...(loose.length ? [{ id: null, title: 'No lane', order: -1 }] : []),
    ...[...doc.lanes].sort((a, b) => a.order - b.order)
  ].filter(l => !only || only.includes(l.id));
  let y = head;
  const bars = [];
  const lanes = [];
  laneList.forEach((lane, li) => {
    const collapsed = lane.id !== null && hidden.has(lane.id);
    if (collapsed && hideCollapsed) return;
    const color = COLORS[(lane.id === null ? COLORS.length - 1 : li) % COLORS.length];
    const mine = items.filter(i => (i.lane || null) === lane.id)
      .map(i => ({ i, s: sched.get(i.id) }))
      .filter(({ s }) => s && s.end >= from && s.start <= to)
      .sort((a, b) => a.s.start.localeCompare(b.s.start) || a.i.order - b.i.order);
    const lv = levels(doc);
    const byId = new Map(items.map(i => [i.id, i]));
    const rootOf = (it) => { let r = it, n = 0; while (r.parent && byId.has(r.parent) && n++ < 8) r = byId.get(r.parent); return r; };
    const hasKids = new Set(items.filter(i => i.parent).map(i => i.parent));
    // Blocks: the shared one (standalone items), then one per root with children, in order of their first date.
    const shared = [], groups = new Map();
    for (const m of mine) {
      const root = rootOf(m.i);
      if (root === m.i && !hasKids.has(m.i.id)) shared.push(m);
      else { if (!groups.has(root.id)) groups.set(root.id, []); groups.get(root.id).push(m); }
    }
    const blocks = [shared, ...[...groups.values()]].filter(b => b.length);
    let rowBase = 0;
    const placed = [];
    for (const block of blocks) {
      const isGroup = block !== shared;
      const depths = isGroup ? [...new Set(block.map(m => lv.get(m.i.id) || 0))].sort((a, b) => a - b) : [0];
      for (const d of depths) {
        const ends = [];       // right edge used so far, per row of this level
        for (const { i, s } of block.filter(m => !isGroup || (lv.get(m.i.id) || 0) === d)) {
          const bx = i.milestone ? x(s.start) + px / 2 - 7 : Math.max(GUTTER, x(s.start));
          const bxEnd = i.milestone ? bx + 14 : Math.min(width - 16, x(addDays(s.end, 1)));
          const bw = Math.max(i.milestone ? 14 : 4, bxEnd - bx);
          const label = i.title;
          const inside = !i.milestone && label.length * CHAR + 16 <= bw;
          const extent = inside ? bxEnd : bxEnd + 6 + Math.min(label.length, 40) * CHAR;
          let row = ends.findIndex(e => e + 6 <= bx);
          if (row < 0) { row = ends.length; ends.push(0); }
          ends[row] = Math.max(ends[row], extent);
          const level = lv.get(i.id) || 0;
          placed.push({ id: i.id, item: i, lane: lane.id, row: rowBase + row, level, x: r1(bx), w: r1(bw), inside, start: s.start, end: s.end, clipL: s.start < from, clipR: s.end > to, color: itemColor(i, level) });
        }
        rowBase += ends.length;
      }
    }
    const h = collapsed ? COLLAPSED : Math.max(1, rowBase) * ROW + PAD * 2;
    lanes.push({ id: lane.id, title: lane.title, y, h, collapsed, count: mine.length, rows: Math.max(1, rowBase), color });
    if (!collapsed) for (const b of placed) { b.y = y + PAD + b.row * ROW + (ROW - BAR) / 2; b.h = BAR; bars.push(b); }
    y += h;
  });
  return { doc, scale, px, from, to, width, height: y + 1, x, lanes, bars, sched, gutter, head, goalCells };
}

/** The date at a pixel x (inverse of L.x), snapped to `snap` days from the range start. */
export function dateAt(L, px, snap = 1) {
  const d = Math.round((px - L.gutter) / L.px / snap) * snap;
  return fromDay(toDay(L.from) + d);
}

/** The lane at a pixel y, or undefined. */
export const laneAt = (L, y) => L.lanes.find(l => y >= l.y && y < l.y + l.h);

function headerTiers(L) {
  const { doc, scale, from, to } = L;
  const sprint = sprintOf(doc.meta);
  const low = periods(scale, from, to, sprint).map(p => ({ ...p, label: periodLabel(scale, p.start, { origin: doc.meta.origin, sprint }) }));
  const upScale = scale === 'week' || scale === 'sprint' ? 'month' : 'year';
  const up = [];
  let p = upScale === 'month' ? monthStart(from) : `${parts(from).y}-01-01`;
  while (p <= to) {
    const next = upScale === 'month' ? addMonths(p, 1) : `${parts(p).y + 1}-01-01`;
    const q = parts(p);
    up.push({ start: p, end: addDays(next, -1), label: upScale === 'month' ? `${MONTHS[q.m - 1]} ${q.y}` : String(q.y) });
    p = next;
  }
  return { low, up };
}

/**
 * Draw a layout as an SVG string.
 * opts: theme ('light' | 'dark'), title, subtitle (export header), selected (id), today (YYYY-MM-DD),
 * dim (a Set of item ids drawn faint: the owner filter),
 *       interactive (adds data attributes and handles for the page), showToday.
 */
export function svg(L, opts = {}) {
  const T = THEME[opts.theme] || THEME.light;
  const P = PALETTE[opts.theme] || PALETTE.light;
  const GUTTER = L.gutter;
  const top = opts.title ? 64 : 0;
  const W = L.width, H = L.height + top;
  const o = [];
  const warn = new Set(depWarnings(L.doc, L.sched).map(w => w.id));
  const warnPairs = new Set(depWarnings(L.doc, L.sched).map(w => `${w.dep}>${w.id}`));
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONTS.sans}' role="img" aria-label="${esc(opts.title || L.doc.meta.title)} timeline">`);
  o.push(`<rect width="${W}" height="${H}" fill="${T.bg}"/>`);
  if (opts.title) {
    o.push(`<text x="20" y="34" font-family='${FONTS.serif}' font-size="24" font-weight="600" fill="${T.ink}">${esc(fit(opts.title, W - 40))}</text>`);
    if (opts.subtitle) o.push(`<text x="20" y="54" font-family='${FONTS.mono}' font-size="11" letter-spacing=".6" fill="${T.eyebrow}">${esc(String(opts.subtitle).toUpperCase())}</text>`);
  }
  o.push(`<g transform="translate(0 ${top})">`);
  const { low, up } = headerTiers(L);
  const xs = (d) => r1(Math.max(GUTTER, L.x(d)));
  const xe = (d) => r1(Math.min(W - 16, L.x(addDays(d, 1))));
  // lane backgrounds
  L.lanes.forEach((l, i) => {
    o.push(`<rect x="0" y="${l.y}" width="${W}" height="${l.h}" fill="${i % 2 ? T.surface : T.bg}"/>`);
    o.push(`<line x1="0" x2="${W}" y1="${l.y + l.h}" y2="${l.y + l.h}" stroke="${T.line}"/>`);
  });
  // grid
  for (const p of low) o.push(`<line x1="${xs(p.start)}" x2="${xs(p.start)}" y1="24" y2="${L.height}" stroke="${T.line}" stroke-opacity=".7"/>`);
  for (const p of up) o.push(`<line x1="${xs(p.start)}" x2="${xs(p.start)}" y1="0" y2="${L.height}" stroke="${T.line}"/>`);
  // header
  o.push(`<rect x="0" y="0" width="${W}" height="${L.head}" fill="${T.bg}"/>`);
  for (const p of up) {
    const a = xs(p.start), b = xe(p.end);
    if (b - a > 20) o.push(`<text x="${a + 6}" y="16" font-family='${FONTS.mono}' font-size="10.5" letter-spacing=".6" fill="${T.eyebrow}">${esc(fit(p.label.toUpperCase(), b - a - 10))}</text>`);
    o.push(`<line x1="${a}" x2="${a}" y1="0" y2="${HEAD}" stroke="${T.line}"/>`);
  }
  for (const p of low) {
    const a = xs(p.start), b = xe(p.end);
    if (b - a > 14) o.push(`<text x="${a + 5}" y="40" font-size="11" fill="${T.muted}">${esc(fit(p.label, b - a - 8))}</text>`);
  }
  o.push(`<line x1="0" x2="${W}" y1="24" y2="24" stroke="${T.line}"/>`);
  if (L.head > HEAD) {
    // goals: one cell per period
    o.push(`<line x1="0" x2="${W}" y1="${HEAD}" y2="${HEAD}" stroke="${T.line}"/>`);
    for (const c of L.goalCells) {
      const a = xs(c.start), b = xe(c.end);
      if (b <= a) continue;
      const data = opts.interactive ? ` class="goal" data-goal="${c.start}" role="button"` : '';
      o.push(`<g${data}><rect x="${a}" y="${HEAD}" width="${r1(b - a)}" height="${GOAL_ROW}" fill="${c.text ? T.panel : T.bg}"/>`);
      if (c.text) {
        // Up to two lines; the full goal is in the tooltip and the details under the timeline.
        const n = Math.max(1, Math.floor((b - a - 12) / 6.2));
        const words = c.text.split(/\s+/);
        let first = '';
        while (words.length && (first + ' ' + words[0]).trim().length <= n) first = (first + ' ' + words.shift()).trim();
        if (!first) first = fit(words.shift() || '', b - a - 12);
        const lines = [first, words.length ? fit(words.join(' '), b - a - 12) : ''].filter(Boolean);
        o.push(`<title>${esc(c.text)}</title>`);
        lines.forEach((l, i) => o.push(`<text x="${a + 6}" y="${HEAD + (lines.length === 1 ? 24 : 17 + i * 14)}" font-size="11" font-weight="500" fill="${T.ink}">${esc(l)}</text>`));
      } else if (opts.interactive && b - a > 40) o.push(`<text class="ph" x="${a + 6}" y="${HEAD + 24}" font-size="11" fill="${T.muted}">+ goal</text>`);
      o.push(`<line x1="${a}" x2="${a}" y1="${HEAD}" y2="${L.head}" stroke="${T.line}"/></g>`);
    }
  }
  o.push(`<line x1="0" x2="${W}" y1="${L.head}" y2="${L.head}" stroke="${T.ink}"/>`);
  // today
  const now = opts.today;
  if (opts.showToday !== false && isDate(now) && now >= L.from && now <= L.to) {
    const tx = r1(L.x(now) + L.px / 2);
    o.push(`<line x1="${tx}" x2="${tx}" y1="${L.head}" y2="${L.height}" stroke="${T.danger}" stroke-width="1.5"/>`);
    o.push(`<text x="${tx + 4}" y="${L.head + 12}" font-family='${FONTS.mono}' font-size="9.5" fill="${T.danger}">TODAY</text>`);
  }
  // dependency arrows
  const at = new Map(L.bars.map(b => [b.id, b]));
  o.push(`<g fill="none" stroke-width="1.4">`);
  for (const b of L.bars) {
    for (const d of b.item.dependsOn) {
      const a = at.get(d);
      if (!a) continue;
      const bad = warnPairs.has(`${d}>${b.id}`);
      const x1 = r1(a.x + a.w), y1 = r1(a.y + a.h / 2), x2 = r1(b.x), y2 = r1(b.y + b.h / 2);
      const mid = x2 - 8 > x1 + 4 ? r1(Math.max(x1 + 6, x2 - 10)) : r1(x1 + 6);
      const path = x2 - 8 > x1 ? `M${x1} ${y1}H${mid}V${y2}H${x2 - 2}` : `M${x1} ${y1}H${r1(x1 + 6)}V${r1((y1 + y2) / 2)}H${r1(x2 - 10)}V${y2}H${x2 - 2}`;
      o.push(`<path d="${path}" stroke="${bad ? T.danger : T.muted}"${bad ? ' stroke-dasharray="4 3"' : ''} stroke-opacity="${bad ? 1 : .7}"/>`);
      o.push(`<path d="M${x2 - 6} ${y2 - 3.5}L${x2} ${y2}L${x2 - 6} ${y2 + 3.5}" stroke="${bad ? T.danger : T.muted}"/>`);
    }
  }
  o.push(`</g>`);
  // bars
  for (const b of L.bars) {
    const it = b.item;
    const fill = P[b.color] || P.slate;
    const sel = opts.selected === b.id;
    const op = (it.status === 'done' ? .6 : it.status === 'cut' ? .35 : 1) * (opts.dim && opts.dim.has(b.id) ? .2 : 1);
    const label = (warn.has(b.id) ? '! ' : '') + it.title + (opts.showIds && it.ado ? ` #${it.ado.id}` : '');
    const deco = it.status === 'cut' ? ' text-decoration="line-through"' : '';
    const data = opts.interactive ? ` data-id="${esc(b.id)}" class="bar${sel ? ' sel' : ''}" tabindex="-1"` : '';
    o.push(`<g${data} opacity="${op}">`);
    if (it.milestone) {
      const cx = r1(b.x + 7), cy = r1(b.y + b.h / 2);
      o.push(`<path d="M${cx} ${cy - 8}L${cx + 8} ${cy}L${cx} ${cy + 8}L${cx - 8} ${cy}Z" fill="${fill}"${sel ? ` stroke="${T.ink}" stroke-width="2"` : ''}/>`);
      o.push(`<text x="${r1(b.x + 20)}" y="${cy + 4}" font-size="12" font-weight="600" fill="${T.ink}"${deco}>${esc(fit(label, 40 * CHAR))}</text>`);
    } else {
      const stroke = sel ? ` stroke="${T.ink}" stroke-width="2"` : it.status === 'at risk' ? ` stroke="${T.warn}" stroke-width="2" stroke-dasharray="5 3"` : '';
      o.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="${fill}"${stroke}/>`);
      if (b.clipL) o.push(`<path d="M${b.x + 1} ${b.y + 4}l-5 ${b.h / 2 - 4}l5 ${b.h / 2 - 4}" fill="none" stroke="${T.bg}" stroke-width="1.5"/>`);
      if (it.status === 'done') o.push(`<path d="M${r1(b.x + b.w - 14)} ${b.y + 10}l3 3l6 -6" fill="none" stroke="${P.on}" stroke-width="1.6" stroke-linecap="round"/>`);
      if (b.inside) o.push(`<text x="${r1(b.x + 8)}" y="${r1(b.y + 14)}" font-size="12" font-weight="500" fill="${P.on}"${deco}>${esc(fit(label, b.w - (it.status === 'done' ? 30 : 14)))}</text>`);
      else o.push(`<text x="${r1(b.x + b.w + 6)}" y="${r1(b.y + 14)}" font-size="12" font-weight="500" fill="${T.ink}"${deco}>${esc(fit(label, 40 * CHAR))}</text>`);
      if (opts.interactive && !it.milestone) {
        o.push(`<rect class="grip" data-edge="start" x="${b.x - 3}" y="${b.y}" width="7" height="${b.h}" fill="transparent"/>`);
        o.push(`<rect class="grip" data-edge="end" x="${r1(b.x + b.w - 4)}" y="${b.y}" width="7" height="${b.h}" fill="transparent"/>`);
      }
    }
    o.push(`</g>`);
  }
  // lane labels (drawn last so they sit over bars that start before the range)
  o.push(`<rect x="0" y="0" width="${GUTTER - 8}" height="${L.height}" fill="${T.bg}" fill-opacity=".96"/>`);
  o.push(`<line x1="${GUTTER - 8}" x2="${GUTTER - 8}" y1="0" y2="${L.height}" stroke="${T.line}"/>`);
  o.push(`<text x="16" y="40" font-family='${FONTS.mono}' font-size="10.5" letter-spacing=".6" fill="${T.eyebrow}">${esc(L.scale.toUpperCase())}</text>`);
  if (L.head > HEAD) o.push(`<text x="16" y="${HEAD + 24}" font-family='${FONTS.mono}' font-size="10.5" letter-spacing=".6" fill="${T.eyebrow}">${L.scale === 'sprint' ? 'SPRINT GOALS' : 'GOALS'}</text>`);
  for (const l of L.lanes) {
    const data = opts.interactive && l.id ? ` data-lane="${esc(l.id)}" class="lane"` : '';
    o.push(`<g${data}>`);
    o.push(`<rect x="0" y="${l.y}" width="${GUTTER - 8}" height="${l.h}" fill="transparent"/>`);
    o.push(`<rect x="0" y="${l.y + 1}" width="3" height="${l.h - 2}" fill="${PALETTE[opts.theme === 'dark' ? 'dark' : 'light'][l.color]}"/>`);
    const caret = opts.interactive && l.id ? (l.collapsed ? '▸ ' : '▾ ') : '';
    o.push(`<text x="16" y="${l.y + (l.collapsed ? 19 : PAD + 19)}" font-size="13" font-weight="600" fill="${l.id === null ? T.muted : T.ink}">${esc(fit(caret + l.title, GUTTER - 30))}</text>`);
    if (l.collapsed) o.push(`<text x="${GUTTER - 16}" y="${l.y + 19}" text-anchor="end" font-family='${FONTS.mono}' font-size="10.5" fill="${T.muted}">${l.count}</text>`);
    o.push(`</g>`);
  }
  o.push(`</g></svg>`);
  return o.join('');
}

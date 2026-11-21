/* Folio 4.11.0: plan docs and product notes, live with Loom (Workshop project doc claude/loom-docs-links-v1-plan.md).
   Pure: no DOM and no SDK.

   - A plan doc is a note with `kind: plan` in its frontmatter, or any note under plans/. `product:` says which product.
     A product note is products/<slug>.md.
   - Folio publishes them in its summary's `docs` card (docsCard), so Loom's Link a doc can list them.
   - Folio reads Loom's summary `items` card (readLoom): every Tandem item with where it is, its product, its epic and
     the docs Loom linked. A note's In Loom section (loomFor) lists the items for it: for a plan doc, the items it links
     with ws:slate/<item>, the items Loom linked to it, and the stories of those epics; for a product note, that
     product's items. A ws:slate chip shows where its item is (chipStatus).
   Only titles, routes and where things are; neither app reads the other's own data. */
import { appLink } from './applinks.js';
import { TEMPLATES } from './template-info.js';

export const PLANS = 'plans';
export const DOCS_MAX = 200;
const PRODUCT_RE = /^products\/([a-z0-9][a-z0-9-]{0,39})\.md$/;

export const productSlugOf = (path) => { const m = PRODUCT_RE.exec(String(path || '')); return m ? m[1] : ''; };
/** A plan doc: `kind: plan`, or a note under plans/ (not a template). */
export function isPlan(n) {
  if (!n || !n.path || n.path.startsWith(`${TEMPLATES}/`)) return false;
  return (n.doc && n.doc.kind === 'plan') || n.path.startsWith(`${PLANS}/`);
}
/** 'plan', 'product' or '' for an index note. */
export const docKind = (n) => (n && productSlugOf(n.path) ? 'product' : isPlan(n) ? 'plan' : '');

/** The summary's `docs` card: plan docs (newest first), then product notes, up to 200. */
export function docsCard(index) {
  const notes = [...index.notes.values()];
  const plans = notes.filter(isPlan).sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.path.localeCompare(b.path));
  const prods = notes.filter(n => productSlugOf(n.path)).sort((a, b) => a.title.localeCompare(b.title));
  const rows = [
    ...plans.map(n => ({ id: n.path, title: n.title.slice(0, 200), route: n.path, note: 'Plan', product: String((n.doc && n.doc.product) || '').slice(0, 80) })),
    ...prods.map(n => ({ id: n.path, title: n.title.slice(0, 200), route: n.path, note: 'Product note', product: productSlugOf(n.path) }))
  ];
  return { id: 'docs', kind: 'list', title: 'Plan docs and product notes', count: rows.length, rows: rows.slice(0, DOCS_MAX) };
}

/** Loom's `items` card: {on, rows: [{id, title, route, note, flag, product, epic, docs}], byKey: Map(route or folder -> row)}. */
export function readLoom(env) {
  const out = { on: false, rows: [], byKey: new Map() };
  if (!env || env.schema !== 'slate.summary' || env.version !== 1 || !Array.isArray(env.items)) return out;
  const card = env.items.find(c => c && c.id === 'items' && c.kind === 'list' && Array.isArray(c.rows));
  if (!card) return out;
  out.on = true;
  for (const r of card.rows) {
    if (!r || typeof r.id !== 'string' || typeof r.route !== 'string' || typeof r.title !== 'string') continue;
    const row = { id: r.id, title: r.title, route: r.route, note: typeof r.note === 'string' ? r.note : '', flag: ['urgent', 'done'].includes(r.flag) ? r.flag : '',
      product: typeof r.product === 'string' ? r.product : '', epic: typeof r.epic === 'string' ? r.epic : '', docs: Array.isArray(r.docs) ? r.docs.filter(d => typeof d === 'string') : [] };
    out.rows.push(row);
    out.byKey.set(row.route, row);
    out.byKey.set(row.id, row);
  }
  return out;
}

/** The Loom item a ws: href points at, or null. */
export function itemOfHref(loom, href) {
  const a = appLink(href);
  return a && a.app === 'slate' && a.path ? loom.byKey.get(a.path) || null : null;
}
/** A chip's status for an app link: {state: 'you'|'moving'|'done', text} for a Loom item, else null. */
export function chipStatus(loom, app, path) {
  if (app !== 'slate' || !path || !loom || !loom.on) return null;
  const r = loom.byKey.get(path);
  if (!r) return null;
  return { state: r.flag === 'done' ? 'done' : r.flag === 'urgent' ? 'you' : 'moving', text: r.note || (r.flag === 'done' ? 'Shipped' : 'On the floor') };
}

/**
 * The items for a note, grouped: {kind, groups: [{id, name, rows}], total, shipped} or null when the note is neither a
 * plan doc nor a product note. note: an index note (with appLinks). Rows: {route, title, note, via}.
 */
export function loomFor(note, loom) {
  const kind = docKind(note);
  if (!kind || !loom) return null;
  const picked = new Map();
  const add = (r, via) => { if (r && !picked.has(r.id)) picked.set(r.id, { ...r, via }); };
  if (kind === 'product') {
    const slug = productSlugOf(note.path);
    for (const r of loom.rows) if (r.product === slug) add(r, 'product');
  }
  for (const l of note.appLinks || []) add(itemOfHref(loom, l.href), 'doc');
  for (const r of loom.rows) if (r.docs.includes(note.path)) add(r, 'loom');
  // Stories of a linked epic (an epic's row id is its scope folder).
  const epics = new Set([...picked.values()].map(r => r.id));
  for (const r of loom.rows) if (r.epic && epics.has(r.epic)) add(r, 'epic');
  const rows = [...picked.values()];
  const groups = [
    { id: 'you', name: 'Needs you', rows: rows.filter(r => r.flag === 'urgent') },
    { id: 'moving', name: 'Moving', rows: rows.filter(r => !r.flag) },
    { id: 'done', name: 'Shipped', rows: rows.filter(r => r.flag === 'done') }
  ].filter(g => g.rows.length);
  return { kind, groups, total: rows.length, shipped: rows.filter(r => r.flag === 'done').length };
}

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIA = { doc: 'Linked in this note', loom: 'Linked from Loom', epic: 'A story of a linked epic', product: "This product's item" };

/** The side panel's In Loom section. `loomOn`: Loom has written its items card. */
export function inLoomHtml(info, { loomOn = false, open = true } = {}) {
  if (!info) return '';
  const head = `<summary class="section-label">In Loom <span class="count">${info.total}</span></summary>`;
  if (!loomOn) return `<section class="in-loom"><details${open ? ' open' : ''}>${head}<p class="soft small">Open Loom once and its items show here.</p></details></section>`;
  const empty = info.kind === 'product'
    ? '<p class="soft small">Nothing running for this product.</p>'
    : '<p class="soft small">Nothing linked yet. Type [[ and pick a Loom item, or use Link a doc on its card in Loom.</p>';
  const bar = info.total ? `<p class="loom-progress" aria-label="${info.shipped} of ${info.total} shipped"><span class="loom-bar"><i style="width:${Math.round(100 * info.shipped / info.total)}%"></i></span><span class="soft small">${info.shipped} of ${info.total} shipped</span></p>` : '';
  const row = (r) => `<li><a href="#" class="loom-row s-${r.flag === 'done' ? 'done' : r.flag === 'urgent' ? 'you' : 'moving'}" data-app="slate" data-app-path="${escHtml(r.route)}" title="${escHtml(VIA[r.via] + '. Opens in Loom')}"><span class="dot" aria-hidden="true"></span><span class="r-title">${escHtml(r.title)}</span><span class="r-line">${escHtml(r.note)}</span></a></li>`;
  const groups = info.groups.map(g => `<p class="loom-group">${escHtml(g.name)}</p><ul class="loom-rows">${g.rows.map(row).join('')}</ul>`).join('');
  return `<section class="in-loom"><details${open ? ' open' : ''}>${head}${bar}${groups || empty}</details></section>`;
}

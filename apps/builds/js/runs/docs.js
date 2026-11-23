/* Builds 6.17.0: a card's docs, both ways (Workshop project doc claude/loom-docs-links-v1-plan.md).

   What a card links to:
   - its product's note in Notes (products/<slug>.md), from Settings' products (shared/products.js belongsTo on the
     item's repos, a story's repos and areas, then the title), else from a linked plan doc's `product:`;
   - plan docs: linked in the doc itself (a ws:builds/<item> link, from Notes' `mentions` summary card), linked here
     (Link a doc, kept in Builds' own collection `doc-links`), or through its epic (a story shows its epic's docs).

   What Builds tells Notes: the `items` summary card, one row per Tandem item with where it is, its product, its epic and
   the docs Builds linked, so a plan doc or a product note shows its items live.

   Pure parts (reading Notes' summary, the doc-links envelope, the card's docs, the `items` card and the HTML) are tested
   in Node; main.js reads and writes through ws.data. Nothing here writes Notes' data. */
import { belongsTo } from '../../../../shared/products.js';

export const COLLECTION = 'doc-links';
export const SCHEMA = 'builds.doc-links';
export const VERSION = 1;
export const MAX_DOCS = 10;
export const ITEMS_MAX = 200;
const DAY = 864e5;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOTE_PATH = /^[^\0]{1,300}\.md$/;
const okPath = p => typeof p === 'string' && NOTE_PATH.test(p) && !p.split('/').some(s => s === '..' || s === '.' || !s);

// ------------------------------------------------------------------ Notes' summary
/**
 * What Builds reads from Notes' summary (notes.summary): its `docs` card (plan docs and product notes) and its
 * `mentions` card (notes that link to a Builds item). {on, docs: [{path, title, kind: 'plan'|'product', product}],
 * mentions: Map(route -> [path])}. `on` is false when Notes has written no summary (switched off, never opened).
 */
export function readNotes(env) {
  const out = { on: false, docs: [], mentions: new Map() };
  if (!env || env.schema !== 'notes.summary' || env.version !== 1 || !Array.isArray(env.items)) return out;
  out.on = true;
  const card = id => env.items.find(c => c && c.id === id && c.kind === 'list' && Array.isArray(c.rows));
  const docs = card('docs');
  for (const r of (docs && docs.rows) || []) {
    if (!r || !okPath(r.id) || typeof r.title !== 'string') continue;
    out.docs.push({ path: r.id, title: r.title.slice(0, 200) || r.id, kind: r.note === 'Product note' ? 'product' : 'plan', product: typeof r.product === 'string' ? r.product : '' });
  }
  const m = card('mentions');
  for (const r of (m && m.rows) || []) {
    if (!r || typeof r.note !== 'string' || !okPath(r.route)) continue;
    const a = /^builds\/(.+)$/.exec(r.note);
    if (!a) continue;
    const key = a[1];
    if (!out.mentions.has(key)) out.mentions.set(key, []);
    const list = out.mentions.get(key);
    if (!list.includes(r.route)) list.push(r.route);
  }
  return out;
}

// ------------------------------------------------------------------ Builds' own links (doc-links)
export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));
/** Map folder -> [note path] from the envelope. */
export function linksOf(env) {
  const out = new Map();
  if (!env || !readable(env)) return out;
  for (const it of env.items) if (it && typeof it.id === 'string' && Array.isArray(it.docs)) out.set(it.id, it.docs.filter(okPath).slice(0, MAX_DOCS));
  return out;
}
/** A copy of the envelope with `path` linked to (or unlinked from) `folder`. null when nothing changes. */
export function withLink(env, folder, path, on = true, now = Date.now()) {
  if (!readable(env) || !folder || !okPath(path)) return null;
  const next = structuredClone(env || blank());
  const k = next.items.findIndex(i => i.id === folder);
  const cur = k >= 0 ? (next.items[k].docs || []).slice() : [];
  const has = cur.includes(path);
  if (on === has) return null;
  if (on && cur.length >= MAX_DOCS) return null;
  const docs = on ? cur.concat(path) : cur.filter(p => p !== path);
  if (!docs.length) { if (k >= 0) next.items.splice(k, 1); }
  else if (k >= 0) next.items[k] = { ...next.items[k], docs, updatedAt: now };
  else next.items.push({ id: folder, updatedAt: now, docs });
  return next;
}

// ------------------------------------------------------------------ a card's docs
/** The keys Notes' ws: links can use for an item: its route (id or folder) and its folder. */
export const keysOf = it => [it && it.id ? String(it.id) : '', it && it.folder ? String(it.folder) : ''].filter(Boolean);
const repoNames = it => [...((it && it.repos) || []).map(r => (r && typeof r === 'object' ? r.folder : r)), ...((it && it.story && it.story.repos) || [])].filter(Boolean);

/** The item's product from Settings' products, or null. A linked plan doc's `product:` wins when the item names none. */
export function productOf(it, products = [], planProduct = '') {
  const act = (products || []).filter(p => p && !p.archived);
  if (!it || !act.length) return null;
  const facts = { repos: repoNames(it), areas: (it.story && it.story.areas) || [], text: it.title || '' };
  const byFacts = act.find(p => (p.repos || []).length || (p.areas || []).length ? belongsTo(p, { ...facts, text: '' }) : false);
  if (byFacts) return byFacts;
  if (planProduct) {
    const want = String(planProduct).toLowerCase();
    const p = act.find(x => x.slug === want || String(x.name || '').toLowerCase() === want || (x.alsoCalled || []).some(n => String(n).toLowerCase() === want));
    if (p) return p;
  }
  return act.find(p => belongsTo(p, { text: facts.text })) || null;
}

/**
 * A card's docs: {product: {slug, name, path, has}|null, plans: [{path, title, via: 'doc'|'card'|'epic'}]}.
 * notesDocs: readNotes(); links: linksOf(); items: every item (to find a story's epic).
 */
export function docsFor(it, { notesDocs = readNotes(null), links = new Map(), products = [], items = [] } = {}) {
  if (!it) return { product: null, plans: [] };
  const title = p => { const d = notesDocs.docs.find(x => x.path === p); return d ? d.title : p.replace(/^.*\//, '').replace(/\.md$/, ''); };
  const plans = [];
  const add = (path, via) => { if (okPath(path) && !plans.some(x => x.path === path)) plans.push({ path, title: title(path), via }); };
  for (const k of keysOf(it)) for (const p of notesDocs.mentions.get(k) || []) add(p, 'doc');
  for (const p of links.get(it.folder) || []) add(p, 'card');
  // A story shows its epic's docs (Core 4.10.0: the item's story.epic is the epic's scope folder).
  const epic = it.story && it.story.epic ? items.find(x => x && x.folder === it.story.epic) : null;
  if (epic) {
    for (const k of keysOf(epic)) for (const p of notesDocs.mentions.get(k) || []) add(p, 'epic');
    for (const p of links.get(epic.folder) || []) add(p, 'epic');
  }
  // Product notes linked by hand count as the product, not as a plan.
  const productDocs = plans.filter(p => /^products\/[^/]+\.md$/.test(p.path));
  const planOnly = plans.filter(p => !productDocs.includes(p));
  const planProduct = planOnly.map(p => (notesDocs.docs.find(d => d.path === p.path) || {}).product).find(Boolean) || '';
  let prod = productOf(it, products, planProduct);
  let product = null;
  if (prod) {
    const path = `products/${prod.slug}.md`;
    product = { slug: prod.slug, name: prod.name, path, has: notesDocs.docs.some(d => d.path === path) };
  } else if (productDocs.length) {
    const slug = productDocs[0].path.slice(9, -3);
    product = { slug, name: productDocs[0].title, path: productDocs[0].path, has: true };
  }
  return { product, plans: planOnly };
}

// ------------------------------------------------------------------ the items card (for Notes)
/**
 * Builds' `items` summary card. entries: [{it, where, mine, done}] for every Tandem item (running, and done in the
 * last 14 days); docsOf(it) -> docsFor(it). Rows: id (folder), title, route, note (where it is), flag (urgent when
 * it needs you, done when shipped), product (slug or ''), epic (a story's epic folder or ''), docs (paths Builds linked).
 */
export function itemsCard(entries = [], { docsOf = () => ({ product: null }), links = new Map(), now = Date.now() } = {}) {
  const cut = now - 14 * DAY;
  const rows = [];
  for (const e of entries) {
    const it = e && e.it;
    if (!it || !it.folder || it.kind === 'pr') continue;
    if (e.done && (it.modifiedMs || 0) < cut) continue;
    const d = docsOf(it) || {};
    const row = {
      id: String(it.folder).slice(0, 200),
      title: String(it.id ? `#${it.id} ${it.title || ''}` : (it.title || it.folder)).trim().slice(0, 200),
      route: (it.id ? String(it.id) : String(it.folder)).slice(0, 200),
      note: (e.done ? 'Shipped' : (e.where || 'On the floor')).slice(0, 80),
      product: d.product ? d.product.slug : '',
      epic: it.story && it.story.epic ? String(it.story.epic) : '',
      docs: (links.get(it.folder) || []).slice(0, MAX_DOCS)
    };
    if (e.done) row.flag = 'done';
    else if (e.mine) row.flag = 'urgent';
    if (e.mine && e.action && !e.done) row.note = `${row.note}: ${e.action}`.slice(0, 80);
    rows.push({ row, at: it.modifiedMs || 0, rank: e.done ? 2 : e.mine ? 0 : 1 });
  }
  rows.sort((a, b) => a.rank - b.rank || b.at - a.at);
  return { id: 'items', kind: 'list', title: 'Tandem items', updatedAt: now, count: rows.length, rows: rows.slice(0, ITEMS_MAX).map(x => x.row) };
}

// ------------------------------------------------------------------ HTML
const DOC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
const BOX = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>';
const VIA = { doc: 'Linked in the doc', card: 'Linked here', epic: "From the epic's doc" };

/** A doc chip: opens the note in Notes. Builds' own links have an x. */
function chip(path, title, { kind = 'plan', via = '', folder = '' } = {}) {
  const x = via === 'card' && folder ? `<button type="button" class="dc-x" data-doc-unlink="${esc(path)}" data-doc-folder="${esc(folder)}" aria-label="${esc('Unlink ' + title)}" title="Unlink">×</button>` : '';
  return `<span class="dc-chip k-${kind}"><button type="button" class="dc-open" data-doc-open="${esc(path)}" title="${esc((kind === 'product' ? 'Product note' : 'Plan doc') + (via ? '. ' + VIA[via] : '') + '. Opens in Notes')}">${kind === 'product' ? BOX : DOC}<span>${esc(title)}</span></button>${x}</span>`;
}

/** The card popup's Docs row. Empty when Notes is not here and nothing is linked. */
export function docsRowHtml(it, info, { notesOn = false, picking = false, pick = '' } = {}) {
  if (!it || !info) return '';
  const chips = [];
  if (info.product && (info.product.has || notesOn)) chips.push(chip(info.product.path, info.product.name, { kind: 'product' }));
  for (const p of info.plans) chips.push(chip(p.path, p.title, { via: p.via, folder: it.folder }));
  if (!notesOn && !chips.length) return '';
  const add = notesOn ? `<button type="button" class="dc-add" data-doc-pick="${esc(it.folder)}" aria-expanded="${picking}">${picking ? 'Done' : 'Link a doc'}</button>` : '';
  return `<div class="dc-row" aria-label="Docs"><span class="dc-h">Docs</span>${chips.join('') || (notesOn ? '<span class="dc-none">None yet</span>' : '')}${add}</div>${picking ? pick : ''}`;
}

/** Link a doc: a search over Notes' plan docs and product notes. Plans first, then product notes; linked ones left out. */
export function pickRows(docs = [], q = '', linked = []) {
  const s = String(q || '').trim().toLowerCase();
  return docs.filter(d => !linked.includes(d.path) && (!s || d.title.toLowerCase().includes(s) || d.path.toLowerCase().includes(s)))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'plan' ? -1 : 1) || a.title.localeCompare(b.title)).slice(0, 8);
}
export function docPickHtml(folder, docs, q, linked) {
  const rows = pickRows(docs, q, linked);
  const list = rows.length ? `<ul role="list">${rows.map(d => `<li><button type="button" class="ln-prow" data-doc-link="${esc(d.path)}" data-doc-folder="${esc(folder)}"><span class="ln-ptitle">${esc(d.title)}</span><span class="ln-ptype">${d.kind === 'product' ? 'Product note' : 'Plan'}</span></button></li>`).join('')}</ul>`
    : `<p class="dim">${docs.length ? 'Nothing matches.' : 'No plan docs yet. In Notes, make one from the Plan template, or add kind: plan to a note.'}</p>`;
  return `<div class="ln-pick dc-pick"><input type="search" id="dc-q" data-draft="docs:q" value="${esc(q || '')}" placeholder="Search plan docs and product notes" aria-label="Search plan docs and product notes">${list}</div>`;
}

/** The epic tracker's doc chips (floor.js), plans only. */
export function epicDocsHtml(info) {
  if (!info || !info.plans.length) return '';
  return `<span class="dc-epic">${info.plans.slice(0, 2).map(p => chip(p.path, p.title, {})).join('')}</span>`;
}

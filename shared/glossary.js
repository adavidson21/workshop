/* The glossary (docs/glossary.md): collection `glossary` in Settings' folder (settings.glossary v1). Words people use
   in work items and what the code calls them. Settings' Knowledge, Glossary page writes it with ws.data; Workshop
   writes it into the repo map (shared/knowledge.js). Pure, no DOM or SDK (shared/test/glossary.test.mjs). */
export const APP = 'settings';
export const COLLECTION = 'glossary';
export const SCHEMA = 'settings.glossary';
export const VERSION = 1;
export const MAX = 500;
export const ID = /^g_[a-z0-9][a-z0-9-]{0,39}$/;
const PRODUCT_ID = /^p_[a-z0-9][a-z0-9-]{0,39}$/;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const idPart = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 34).replace(/-+$/, '') || 'word';

/** One stored item, cleaned, or null when it is not a word. */
export function clean(it) {
  if (!it || typeof it !== 'object' || !ID.test(it.id)) return null;
  const term = text(it.term, 120), code = text(it.code, 200);
  if (!term || !code) return null;
  const w = { id: it.id, term, code };
  const where = text(it.where, 300);
  if (where) w.where = where;
  if (typeof it.productId === 'string' && PRODUCT_ID.test(it.productId)) w.productId = it.productId;
  if (typeof it.updatedAt === 'number') w.updatedAt = it.updatedAt;
  return w;
}

/** Every word in the envelope, by term. */
export function list(env) {
  const items = env && Array.isArray(env.items) ? env.items.map(clean).filter(Boolean) : [];
  return items.sort((a, b) => a.term.localeCompare(b.term) || a.code.localeCompare(b.code));
}

/** The words for a product: its own, then the ones for any product. `productIds` the products that still exist. */
export function forProduct(words, productId, productIds = null) {
  const known = productIds ? new Set(productIds) : null;
  const any = w => !w.productId || (known && !known.has(w.productId));
  return [...words.filter(w => w.productId && w.productId === productId), ...words.filter(any)];
}

/** Rows from the page (term, code, productId each), cleaned: blank rows dropped. */
export function rowsOf(rows) {
  return (rows || []).map(r => ({ id: r && ID.test(r.id) ? r.id : '', term: text(r && r.term, 120), code: text(r && r.code, 200), where: text(r && r.where, 300), productId: r && PRODUCT_ID.test(r.productId) ? r.productId : '' }))
    .filter(r => r.term || r.code);
}

/** What is wrong with the rows, or ''. */
export function problem(rows) {
  const rs = rowsOf(rows);
  if (rs.length > MAX) return `Keep the glossary to ${MAX} words.`;
  const half = rs.find(r => !r.term || !r.code);
  if (half) return half.term ? `Say what the code calls "${half.term}".` : `Give the word for "${half.code}".`;
  const seen = new Map();
  for (const r of rs) {
    const k = `${r.productId}\u0000${r.term.toLowerCase()}`;
    if (seen.has(k)) return `"${r.term}" is listed twice${r.productId ? ' for the same product' : ''}.`;
    seen.set(k, true);
  }
  return '';
}

/**
 * The stored items for `rows`, replacing every word: ids kept for rows that had one, new ids made from the term for
 * the rest. Returns the items (no updatedAt; the caller stamps). Throws an Error with the problem's text.
 */
export function replaceAll(rows) {
  const why = problem(rows);
  if (why) throw new Error(why);
  const taken = new Set();
  const out = [];
  for (const r of rowsOf(rows)) {
    let id = r.id && !taken.has(r.id) ? r.id : '';
    if (!id) {
      const base = `g_${idPart(r.term)}`;
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    }
    taken.add(id);
    const w = { id, term: r.term, code: r.code };
    if (r.where) w.where = r.where;
    if (r.productId) w.productId = r.productId;
    out.push(w);
  }
  return out;
}

/**
 * Words to add from an import ([{term, code, product}] with product names), against the stored words and products.
 * `renamed` maps an imported product name to the stored product's name (shared/knowledge.js importPlan `renamed`).
 */
export function toAdd(found, words, products, renamed = {}) {
  const have = new Set((words || []).map(w => `${w.productId || ''}\u0000${w.term.toLowerCase()}`));
  const byName = new Map();
  for (const p of products || []) for (const n of [p.name, ...(p.alsoCalled || [])]) byName.set(String(n).toLowerCase(), p.id);
  for (const [from, to] of Object.entries(renamed || {})) if (byName.has(String(to).toLowerCase())) byName.set(from.toLowerCase(), byName.get(String(to).toLowerCase()));
  const out = [];
  for (const f of found || []) {
    const term = text(f && f.term, 120), code = text(f && f.code, 200);
    if (!term || !code) continue;
    const productId = (f.product && byName.get(String(f.product).trim().toLowerCase())) || '';
    const k = `${productId}\u0000${term.toLowerCase()}`;
    if (have.has(k)) continue;
    have.add(k);
    out.push({ term, code, where: text(f.where, 300), productId });
  }
  return out;
}

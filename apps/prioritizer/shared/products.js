/* Your products (docs/products.md): collection `products` in Settings' folder (settings.products v1), like the
   people directory and team area paths. Settings' Products page writes it with ws.data; Folio reads it with
   {app: 'settings'} and makes each product's note, products/<slug>.md. Pure, no DOM or SDK
   (shared/test/products.test.mjs). */
export const APP = 'settings';
export const COLLECTION = 'products';
export const SCHEMA = 'settings.products';
export const VERSION = 1;
export const MAX_NAMES = 20;
export const MAX_REPOS = 30;
export const MAX_AREAS = 20;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ID = /^p_[a-z0-9][a-z0-9-]{0,39}$/;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

/** The note's file name part from a name: lower case letters, digits and single dashes, up to 40. '' when none. */
export function slugOf(name) {
  return String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');
}

/** Folio's path for a product's note. */
export const notePath = p => `products/${p.slug}.md`;

/** A list from a form field: split on commas or new lines (or an array), trimmed, no blanks or repeats (case ignored), at most `max`. */
export function parseList(value, { max = MAX_NAMES, len = 200, lines = false } = {}) {
  const parts = Array.isArray(value) ? value : String(value || '').split(lines ? /\r?\n/ : /[,\r\n]/);
  const out = [];
  for (const raw of parts) {
    const v = String(raw == null ? '' : raw).trim().slice(0, len);
    if (v && !out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, max);
}

const strings = (a, max, len) => (Array.isArray(a) ? parseList(a.filter(x => typeof x === 'string'), { max, len }) : []);

/** One stored item, cleaned, or null when it is not a product. */
export function clean(it) {
  if (!it || typeof it !== 'object' || !ID.test(it.id) || !SLUG.test(it.slug) || typeof it.name !== 'string' || !it.name.trim()) return null;
  const p = {
    id: it.id, name: it.name.trim().slice(0, 120), slug: it.slug,
    alsoCalled: strings(it.alsoCalled, MAX_NAMES, 120),
    repos: strings(it.repos, MAX_REPOS, 200),
    areas: strings(it.areas, MAX_AREAS, 400),
    archived: it.archived === true
  };
  if (typeof it.updatedAt === 'number') p.updatedAt = it.updatedAt;
  return p;
}

/** Every product in the envelope, by name. `{archived: false}` leaves archived ones out. */
export function list(env, { archived = true } = {}) {
  const items = env && Array.isArray(env.items) ? env.items.map(clean).filter(Boolean) : [];
  return items.filter(p => archived || !p.archived).sort((a, b) => a.name.localeCompare(b.name));
}

/** What is wrong with the fields, or ''. `items` are the stored products; `id` is the one being edited. */
export function problem(fields, items, id = null) {
  const name = String((fields && fields.name) || '').trim();
  if (!name) return 'Give the product a name.';
  if (!id && !slugOf(name)) return 'Use at least one letter or digit in the name.';
  const lc = name.toLowerCase();
  const clash = (items || []).map(clean).filter(Boolean).find(p => p.id !== id && p.name.toLowerCase() === lc);
  return clash ? `There is already a product called ${clash.name}.` : '';
}

/** A slug for a new product that no other product has: the name's slug, then -2, -3... */
export function freeSlug(name, items) {
  const taken = new Set((items || []).map(x => x && x.slug).filter(Boolean));
  const base = slugOf(name) || 'product';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const s = `${base.slice(0, 40 - String(n).length - 1).replace(/-+$/, '')}-${n}`;
    if (!taken.has(s)) return s;
  }
}

/** The fields a form gives, cleaned: {name, alsoCalled, repos, areas}. */
export function fieldsOf({ name, alsoCalled, repos, areas } = {}) {
  return {
    name: String(name || '').trim().slice(0, 120),
    alsoCalled: parseList(alsoCalled, { max: MAX_NAMES, len: 120 }),
    repos: parseList(repos, { max: MAX_REPOS, len: 200 }),
    areas: parseList(areas, { max: MAX_AREAS, len: 400, lines: true })
  };
}

/**
 * Adds a product (no `id`) or changes one, in a copy of the items. The slug is set once, when the product is added,
 * so renaming never moves its note. Returns {items, product}; throws an Error with the problem's text.
 */
export function upsert(items, input, id = null) {
  const all = (items || []).filter(Boolean);
  const f = fieldsOf(input);
  const why = problem(f, all, id);
  if (why) throw new Error(why);
  const old = id ? all.find(x => x.id === id) : null;
  if (id && !old) throw new Error('That product is not there anymore. Reload and try again.');
  const slug = old ? old.slug : freeSlug(f.name, all);
  const product = { ...(old || {}), id: old ? old.id : `p_${slug}`, slug, ...f };
  if (!product.archived) delete product.archived;
  return { items: old ? all.map(x => (x.id === id ? product : x)) : [...all, product], product };
}

/** Archive or restore, in a copy of the items. */
export function setArchived(items, id, archived) {
  return (items || []).map(x => {
    if (!x || x.id !== id) return x;
    const p = { ...x };
    if (archived) p.archived = true; else delete p.archived;
    return p;
  });
}

const norm = s => String(s || '').trim().toLowerCase().replaceAll('\\', '/').replace(/\/+$/, '');

/**
 * People who own the product: active people (shared/people.js directory items) whose `owns` has its name, another
 * name, one of its repos (the folder or its last part) or one of its area paths (or a path above one), case ignored.
 * [{id, name, hits}] by name.
 */
export function ownersOf(product, people) {
  if (!product) return [];
  const terms = new Set([product.name, ...(product.alsoCalled || []), ...(product.repos || [])].map(norm).filter(Boolean));
  for (const r of product.repos || []) { const last = norm(r).split('/').pop(); if (last) terms.add(last); }
  const areas = (product.areas || []).map(norm).filter(Boolean);
  const out = [];
  for (const p of people || []) {
    if (!p || p.archived || p.kind === 'group' || !Array.isArray(p.owns)) continue;
    const hits = p.owns.filter(t => {
      const w = norm(t);
      return w && (terms.has(w) || areas.some(a => a === w || a.startsWith(w + '/')));
    });
    if (hits.length) out.push({ id: p.id, name: p.name, hits });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

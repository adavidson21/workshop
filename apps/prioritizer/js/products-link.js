/* Docket: your products (Workshop docs/products.md), read from Settings so a task can name one with +product in
   Quick add or the Product field in its details. Settings owns the list (settings.products); Docket only reads
   it, and a task keeps the product's id (`product: 'p_<slug>'`), an extra field older readers keep as is.
   No products set up (or Docket on its own with none) means the tag and the field are simply not offered.

   matchProduct is pure (test/products-link.test.mjs); startProductsLink keeps the list fresh. */
import { ID, list, slugOf } from '../../../shared/products.js';

export const PRODUCT_ID = ID;

/** The +tag for a product: its slug. */
export const productTag = p => '+' + p.slug;

const keysOf = p => [p.slug, slugOf(p.name), ...(p.alsoCalled || []).map(slugOf)].filter(Boolean);

/** The active product a +tag names, or null. `x` is the text after the +. An exact slug, name or other name wins,
    then the first (by name) that starts with it. Needs a letter, so "+1" stays in the title. */
export function matchProduct(x, items) {
  const q = slugOf(x);
  if (!q || !/[a-z]/.test(q)) return null;
  const act = (items || []).filter(p => p && !p.archived);
  return act.find(p => keysOf(p).includes(q)) || act.find(p => keysOf(p).some(k => k.startsWith(q))) || null;
}

/** A task's product field, cleaned: a product id, or undefined (no product). */
export const cleanProduct = v => (typeof v === 'string' && ID.test(v) ? v : undefined);

let items = [];
/** Every product (archived too, so a task keeps showing its name), by name. */
export const allProducts = () => items;
/** The products you can pick: not archived. */
export const activeProducts = () => items.filter(p => !p.archived);
export const productById = id => (id && items.find(p => p.id === id)) || null;

/** Read Settings' products now and on every change. onChange: called after each read. */
export function startProductsLink(ws, onChange = () => {}) {
  if (!ws || !ws.data) return;
  const read = () => ws.data.get('products', { app: 'settings' }).then(env => { items = list(env); onChange(); }, () => {});
  read();
  try { ws.data.subscribe('products', read, { app: 'settings' }); } catch { /* no data backend */ }
}

/** For tests: set the list directly. */
export const setProducts = env => { items = list(env); };

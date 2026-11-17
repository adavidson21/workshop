/* Folio: product notes made from the products you set up in Workshop Settings (Workshop docs/products.md).

   Settings keeps the products (settings.products v1); Folio reads them with {app: 'settings'}. For each active
   product it has not handled, Folio writes products/<slug>.md from the product template (templates/product.md, yours
   or the starter), filled in with the name, other names, repos and area paths. Owners are not copied in: they live in
   Workshop's People ("Owns"), and Tandem reads them from there (docs/knowledge.md). A note that
   is already there (made by hand) is left alone. Either way the product is recorded in Folio's own collection
   `products-made` (notes.products-made v1, items {id: <product id>, path}), so a note you trash is never made again,
   and later changes in Settings never touch the note: it is yours, and Tandem's, from then on.

   It also makes the team handbook, team/handbook.md, once (recorded as `h_handbook` in the same collection), even with
   no products.

   toMake and productNoteText are pure (test/product-setup.test.mjs); startProductSetup does the reading and writing. */
import * as Products from '../../../shared/products.js';
import { PRODUCT_TPL, fill } from './templates.js';
import { HANDBOOK, HANDBOOK_PATH, PRODUCT_TEMPLATE, setField } from './products.js';

export const HANDBOOK_ID = 'h_handbook';

export const COLLECTION = 'products-made';
export const SCHEMA = 'notes.products-made';
const VERSION = 1;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

/**
 * What to do for each product: [{product, path, make}]. `make` false means the note is already there, so it is only
 * recorded. Products already handled (made, or a record deleted since) and archived ones are left out.
 * products: shared/products.js list(); made: notes.products-made envelope; paths: every path Folio has.
 */
export function toMake(products, made, paths) {
  const done = new Set([...((made && made.items) || []).map(i => i && i.id), ...Object.keys((made && made.deleted) || {})]);
  return (products || []).filter(p => p && !p.archived && !done.has(p.id))
    .map(p => ({ product: p, path: Products.notePath(p), make: !paths.has(Products.notePath(p)) }));
}

/* A frontmatter list as YAML flow: [a, b], quoted where a name would read as something else. */
function flow(list) {
  const plain = s => /^[^\s,[\]{}:#"'&*!|>%@`-]([^,[\]{}"]*[^\s,[\]{}:"])?$/.test(s) && !/: | #/.test(s);
  const item = s => (plain(s) ? s : JSON.stringify(s));
  return `[${(list || []).map(item).join(', ')}]`;
}

/**
 * A new product note's text: the template (yours, or the starter) filled with the product's name and slug, and the
 * frontmatter `also-called`, `repos` and `areas` set from Settings. `owners` is ignored since Knowledge base V1
 * (owners come from People); the argument stays so older callers keep working.
 */
export function productNoteText(product, owners = [], template = null, now = new Date()) {
  const tpl = typeof template === 'string' && template.trim() ? template : PRODUCT_TEMPLATE;
  let text = fill(tpl.replace(/\{\{\s*slug\s*\}\}/g, product.slug), { title: product.name, now });
  if (!/^﻿?---[ \t]*\r?\n/.test(text)) text = `---\ntitle: ${product.name}\n---\n${text}`;
  text = setField(text, 'also-called', flow(product.alsoCalled));
  text = setField(text, 'repos', flow(product.repos));
  if ((product.areas || []).length) text = setField(text, 'areas', flow(product.areas));
  return text;
}

/** True when the handbook should be made: not in Folio, and never made or trashed before. */
export function handbookToMake(made, paths) {
  const done = ((made && made.items) || []).some(i => i && i.id === HANDBOOK_ID) || Object.prototype.hasOwnProperty.call((made && made.deleted) || {}, HANDBOOK_ID);
  return !done && !paths.has(HANDBOOK_PATH);
}

/**
 * Watch Settings' products and make the notes. `notes` is Folio's store (data.js): files, refresh, load state.
 * onMade([{name, path, made}]) after a run that recorded anything. Returns {run}.
 */
export function startProductSetup(ws, notes, { onMade = () => {} } = {}) {
  let running = false, again = false;

  async function run() {
    if (running) { again = true; return 0; }
    running = true;
    let count = 0;
    try {
      if (!notes.loaded) return 0;
      const made = await ws.data.get(COLLECTION);
      if (!readable(made)) return 0; // a newer Folio wrote it: do nothing
      const paths = new Set(notes.files ? notes.files.keys() : []);
      let src = null;
      try { src = await ws.data.get(Products.COLLECTION, { app: Products.APP }); } catch { src = null; }
      const products = src && Products.readable(src) ? Products.list(src, { archived: false }) : [];
      const todo = toMake(products, made, paths);
      const handbook = handbookToMake(made, paths);
      if (!todo.length && !handbook) return 0;
      let template = null;
      try { const t = await ws.files.read(PRODUCT_TPL); template = t ? t.content : null; } catch { template = null; }
      const done = [];
      for (const t of todo) {
        if (t.make) {
          try { await ws.files.write(t.path, productNoteText(t.product, [], template), { create: true }); }
          catch (e) { if (e.code !== 'conflict') throw e; t.make = false; } // made by hand in the meantime: keep that one
        }
        done.push({ id: t.product.id, path: t.path, name: t.product.name, made: t.make });
      }
      if (handbook) {
        let wrote = true;
        try { await ws.files.write(HANDBOOK_PATH, HANDBOOK, { create: true }); }
        catch (e) { if (e.code !== 'conflict') throw e; wrote = false; }
        done.push({ id: HANDBOOK_ID, path: HANDBOOK_PATH, name: 'Team handbook', made: wrote, handbook: true });
      }
      const before = made || blank(), after = structuredClone(before);
      after.items.push(...done.map(d => ({ id: d.id, path: d.path })));
      ws.data.stamp(before, after);
      try { await ws.data.put(COLLECTION, after); }
      catch (e) {
        if (e.code !== 'conflict' || !e.current) throw e;
        await ws.data.put(COLLECTION, ws.data.merge(after, e.current));
      }
      for (const d of done) if (d.made) { try { await notes.refresh(d.path); } catch { /* shows on the next load */ } }
      count = done.length;
      onMade(done);
    } catch (e) {
      // Waiting for the folder, Settings not readable here, or a write failed: try again on the next change.
    } finally {
      running = false;
      if (again) { again = false; setTimeout(run, 0); }
    }
    return count;
  }

  try { ws.data.subscribe(Products.COLLECTION, run, { app: Products.APP }); } catch { /* no Settings here */ }
  return { run };
}

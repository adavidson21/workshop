/* Folio: product notes made from the products you set up in Workshop Settings (Workshop docs/products.md).

   Settings keeps the products (settings.products v1); Folio reads them with {app: 'settings'}. For each active
   product it has not handled, Folio writes products/<slug>.md from the product template (templates/product.md, yours
   or the starter), filled in with the name, other names, repos, area paths and owners (People's "Owns"). A note that
   is already there (made by hand) is left alone. Either way the product is recorded in Folio's own collection
   `products-made` (notes.products-made v1, items {id: <product id>, path}), so a note you trash is never made again,
   and later changes in Settings never touch the note: it is yours, and Tandem's, from then on.

   toMake and productNoteText are pure (test/product-setup.test.mjs); startProductSetup does the reading and writing. */
import * as Products from '../../../shared/products.js';
import { PRODUCT_TPL, fill } from './templates.js';
import { PRODUCT_TEMPLATE, setField } from './products.js';

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

/* `- line` bullets right under `## <heading>` (after the blank line that follows it), or a new section at the end. */
function addLines(text, heading, lines) {
  if (!lines.length) return text;
  const src = String(text);
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const rows = src.split(/\r?\n/);
  const at = rows.findIndex(l => new RegExp(`^##[ \\t]+${heading}[ \\t]*$`, 'i').test(l));
  const bullets = lines.map(l => `- ${l}`);
  if (at < 0) return src.replace(/\s*$/, '') + `${nl}${nl}## ${heading}${nl}${nl}${bullets.join(nl)}${nl}`;
  let end = at + 1;
  while (end < rows.length && !/^#{1,2}[ \t]/.test(rows[end])) end++;
  const body = rows.slice(at + 1, end);
  const kept = body.join('').trim() ? body.filter((l, i) => i < body.length - 1 || l.trim()) : [];
  rows.splice(at + 1, end - at - 1, '', ...kept.filter((l, i) => i > 0 || l.trim()), ...bullets, '');
  return rows.join(nl);
}

/**
 * A new product note's text: the template (yours, or the starter) filled with the product's name and slug, the
 * frontmatter `also-called`, `repos` and `areas` set from Settings, and its owners as bullets under `## People`.
 * owners: shared/products.js ownersOf().
 */
export function productNoteText(product, owners = [], template = null, now = new Date()) {
  const tpl = typeof template === 'string' && template.trim() ? template : PRODUCT_TEMPLATE;
  let text = fill(tpl.replace(/\{\{\s*slug\s*\}\}/g, product.slug), { title: product.name, now });
  if (!/^﻿?---[ \t]*\r?\n/.test(text)) text = `---\ntitle: ${product.name}\n---\n${text}`;
  text = setField(text, 'also-called', flow(product.alsoCalled));
  text = setField(text, 'repos', flow(product.repos));
  if ((product.areas || []).length) text = setField(text, 'areas', flow(product.areas));
  return addLines(text, 'People', owners.map(o => `${o.name}: owns ${o.hits.join(', ')}`));
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
      const src = await ws.data.get(Products.COLLECTION, { app: Products.APP });
      if (!src || !Products.readable(src)) return 0;
      const products = Products.list(src, { archived: false });
      if (!products.length) return 0;
      const made = await ws.data.get(COLLECTION);
      if (!readable(made)) return 0; // a newer Folio wrote it: do nothing
      const paths = new Set(notes.files ? notes.files.keys() : []);
      const todo = toMake(products, made, paths);
      if (!todo.length) return 0;
      let people = [];
      try { people = ws.people ? (await ws.people.get()).people || [] : []; } catch { people = []; }
      let template = null;
      try { const t = await ws.files.read(PRODUCT_TPL); template = t ? t.content : null; } catch { template = null; }
      const done = [];
      for (const t of todo) {
        if (t.make) {
          try { await ws.files.write(t.path, productNoteText(t.product, Products.ownersOf(t.product, people), template), { create: true }); }
          catch (e) { if (e.code !== 'conflict') throw e; t.make = false; } // made by hand in the meantime: keep that one
        }
        done.push({ id: t.product.id, path: t.path, name: t.product.name, made: t.make });
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

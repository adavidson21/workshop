// Rail order (docs/apps.md, Rail order): the order a person puts the apps on the rail in, by dragging a button or
// with Alt+Shift+Up and Down on it. Plain data plus pure helpers, no imports. The shell keeps the order in
// Settings' `rail` collection (settings.rail v1, `meta.order`) through the SDK, so it follows the data folder in
// every mode, and a copy in localStorage (CACHE_KEY) so the rail draws in that order before the data is read.
//
// An order lists app ids. Apps it does not name (a new app, or one turned back on) keep their place from the
// default order: right after the app before them there. Ids of apps that are not on the rail right now (turned
// off) stay in the saved order, so an app comes back where it was. An empty order is the default.
export const APP = 'settings';
export const COLLECTION = 'rail';
export const VERSION = 1;
export const SCHEMA = `${APP}.${COLLECTION}`;
export const CACHE_KEY = 'workshop.railOrder';
export const MAX = 100;
const ID = /^[a-z][a-z0-9-]{0,39}$/;

/** A clean order: app ids only, no repeats, at most MAX. Anything else is []. */
export function cleanOrder(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const id of v) if (typeof id === 'string' && ID.test(id) && !out.includes(id)) out.push(id);
  return out.slice(0, MAX);
}

/** `ids` (the default order) arranged by `order`: the ids it names first, in its order; each other id right after
 *  the id before it in `ids` (or first, when none before it is placed). */
export function arrange(ids, order) {
  const have = new Set(ids);
  const out = cleanOrder(order).filter(id => have.has(id));
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(ids[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, id);
  });
  return out;
}

/** The order to save once the rail shows `shown`: `shown`, with ids of the saved order that are not on the rail
 *  now kept right after the id they followed. */
export function nextOrder(saved, shown) {
  const all = cleanOrder(saved);
  for (const id of cleanOrder(shown)) if (!all.includes(id)) all.push(id);
  return arrange(all, shown);
}

/** `ids` with `id` moved by `by` places (clamped to the ends). The same array when it cannot move. */
export function move(ids, id, by) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, from + by));
  if (to === from) return ids;
  const out = ids.slice();
  out.splice(from, 1);
  out.splice(to, 0, id);
  return out;
}

/** The saved order in an envelope of the rail collection, or [] (none yet, another collection, a newer version). */
export function orderOf(env) {
  if (!env || env.schema !== SCHEMA || env.version !== VERSION || !env.meta) return [];
  return cleanOrder(env.meta.order);
}

/** The envelope to put for `order`, from the one last read (null when there is none yet). */
export function withOrder(env, order, now = Date.now()) {
  const base = env && env.schema === SCHEMA ? env : { schema: SCHEMA, version: VERSION, rev: 0, items: [] };
  const out = { schema: SCHEMA, version: VERSION, rev: base.rev || 0, items: Array.isArray(base.items) ? base.items : [], meta: { updatedAt: now, order: cleanOrder(order) } };
  if (base.deleted) out.deleted = base.deleted;
  return out;
}

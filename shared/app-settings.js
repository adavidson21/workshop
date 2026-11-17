/* App settings (docs/app-settings.md): simple settings an app declares in its manifest (`settings`), shown under
   that app in Settings, kept in Settings' folder as collection `app-settings` (settings.app-settings v1). One item
   per app, keyed by app id: {id, updatedAt, values: {<setting id>: value}}. Types: boolean (a switch), number,
   date ('YYYY-MM-DD' or ''), text (one line) and lines (a list of short lines). An app reads and changes its
   own values through the SDK's `ws.appSettings`; Settings changes any app's. Pure, no DOM or SDK
   (shared/test/app-settings.test.mjs). */
export const APP = 'settings';
export const COLLECTION = 'app-settings';
export const SCHEMA = 'settings.app-settings';
export const VERSION = 1;
export const MAX_SETTINGS = 20;
export const TYPES = Object.freeze(['boolean', 'number', 'date', 'text', 'lines']);
export const MAX_TEXT = 200;
export const MAX_LINES = 30;
export const MAX_LINE = 80;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[a-z][A-Za-z0-9-]{0,39}$/;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));
export const isAppId = v => typeof v === 'string' && ID.test(v);

/** A value of one declared type, cleaned; undefined when it is not one. */
export function typed(type, v, d = {}) {
  if (type === 'boolean') return typeof v === 'boolean' ? v : undefined;
  if (type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    let n = v;
    if (typeof d.min === 'number') n = Math.max(d.min, n);
    if (typeof d.max === 'number') n = Math.min(d.max, n);
    return n;
  }
  if (type === 'date') return typeof v === 'string' && (v === '' || DAY.test(v)) ? v : undefined;
  if (type === 'text') return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : undefined;
  if (type === 'lines') {
    if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) return undefined;
    return [...new Set(v.map(x => x.trim().slice(0, MAX_LINE)).filter(Boolean))].slice(0, MAX_LINES);
  }
  return undefined;
}
/** Any saved value, by its JavaScript type (saved values may outlive their declaration). */
const anyValue = v => typed(typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : Array.isArray(v) ? 'lines' : typeof v === 'string' ? 'text' : '', v);

/** A manifest's `settings`, cleaned: [{id, type, title, description, default, min?, max?}]. Bad entries dropped. */
export function declared(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object' || !TYPES.includes(s.type) || typeof s.id !== 'string' || !KEY.test(s.id)) continue;
    if (out.some(x => x.id === s.id) || typeof s.title !== 'string' || !s.title.trim()) continue;
    const d = { id: s.id, type: s.type, title: s.title.trim().slice(0, 80), description: typeof s.description === 'string' ? s.description.trim().slice(0, 300) : '' };
    if (s.type === 'number') { if (typeof s.min === 'number' && Number.isFinite(s.min)) d.min = s.min; if (typeof s.max === 'number' && Number.isFinite(s.max)) d.max = s.max; }
    const fallback = { boolean: false, number: d.min ?? 0, date: '', text: '', lines: [] }[s.type];
    const def = typed(s.type, s.default, d);
    d.default = def === undefined ? fallback : def;
    out.push(d);
    if (out.length >= MAX_SETTINGS) break;
  }
  return out;
}

/** The values saved for `app`, or {} when none. */
export function saved(env, app) {
  const it = env && Array.isArray(env.items) ? env.items.find(x => x && x.id === app) : null;
  const out = {};
  if (it && it.values && typeof it.values === 'object') for (const [k, v] of Object.entries(it.values)) { const c = anyValue(v); if (KEY.test(k) && c !== undefined) out[k] = c; }
  return out;
}

/** What an app sees: each declared setting's default, then whatever is saved over it. Saved values for settings the
    manifest does not declare (yet, or any more) are kept, so an app on its own site with no registry still reads them. */
export function valuesFor(env, app, decls) {
  const out = {};
  const ds = declared(decls);
  for (const d of ds) out[d.id] = d.default;
  for (const [k, v] of Object.entries(saved(env, app))) {
    const d = ds.find(x => x.id === k);
    if (!d) { out[k] = v; continue; }
    const c = typed(d.type, v, d);
    if (c !== undefined) out[k] = c; // a saved value of another type than declared keeps the default
  }
  return out;
}

/** Puts `patch` ({key: value}) into `app`'s item in a copy of the envelope's items (the caller stamps and saves).
    Values that are none of the types (objects, null, NaN) and bad keys are ignored. */
export function withValues(items, app, patch) {
  if (!isAppId(app)) throw new Error('Not an app id.');
  const clean = {};
  for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {})) { const c = anyValue(v); if (KEY.test(k) && c !== undefined) clean[k] = c; }
  const old = (items || []).find(x => x && x.id === app);
  const rest = (items || []).filter(x => x && x.id !== app);
  const values = Object.assign({}, old && old.values && typeof old.values === 'object' ? old.values : {}, clean);
  if (Object.keys(values).length > MAX_SETTINGS * 2) throw new Error('Too many settings for one app.');
  return [...rest, { ...(old || {}), id: app, values }];
}

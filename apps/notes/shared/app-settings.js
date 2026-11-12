/* App settings (docs/app-settings.md): simple switches an app declares in its manifest (`settings`), shown under
   that app in Settings, kept in Settings' folder as collection `app-settings` (settings.app-settings v1). One item
   per app, keyed by app id: {id, updatedAt, values: {<setting id>: true | false}}. An app reads and changes its
   own values through the SDK's `ws.appSettings`; Settings changes any app's. Pure, no DOM or SDK
   (shared/test/app-settings.test.mjs). */
export const APP = 'settings';
export const COLLECTION = 'app-settings';
export const SCHEMA = 'settings.app-settings';
export const VERSION = 1;
export const MAX_SETTINGS = 20;

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[a-z][A-Za-z0-9-]{0,39}$/;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));
export const isAppId = v => typeof v === 'string' && ID.test(v);

/** A manifest's `settings`, cleaned: [{id, type: 'boolean', title, description, default}]. Bad entries dropped. */
export function declared(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object' || s.type !== 'boolean' || typeof s.id !== 'string' || !KEY.test(s.id)) continue;
    if (out.some(x => x.id === s.id) || typeof s.title !== 'string' || !s.title.trim()) continue;
    out.push({ id: s.id, type: 'boolean', title: s.title.trim().slice(0, 80), description: typeof s.description === 'string' ? s.description.trim().slice(0, 300) : '', default: s.default === true });
    if (out.length >= MAX_SETTINGS) break;
  }
  return out;
}

/** The values saved for `app` (booleans only), or {} when none. */
export function saved(env, app) {
  const it = env && Array.isArray(env.items) ? env.items.find(x => x && x.id === app) : null;
  const out = {};
  if (it && it.values && typeof it.values === 'object') for (const [k, v] of Object.entries(it.values)) if (KEY.test(k) && typeof v === 'boolean') out[k] = v;
  return out;
}

/** What an app sees: each declared setting's default, then whatever is saved over it. Saved values for settings the
    manifest does not declare (yet, or any more) are kept, so an app on its own site with no registry still reads them. */
export function valuesFor(env, app, decls) {
  const out = {};
  for (const d of declared(decls)) out[d.id] = d.default;
  return Object.assign(out, saved(env, app));
}

/** Puts `patch` ({key: boolean}) into `app`'s item in a copy of the envelope's items (the caller stamps and saves).
    Non-boolean values and bad keys are ignored. */
export function withValues(items, app, patch) {
  if (!isAppId(app)) throw new Error('Not an app id.');
  const clean = {};
  for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {})) if (KEY.test(k) && typeof v === 'boolean') clean[k] = v;
  const old = (items || []).find(x => x && x.id === app);
  const rest = (items || []).filter(x => x && x.id !== app);
  const values = Object.assign({}, old && old.values && typeof old.values === 'object' ? old.values : {}, clean);
  if (Object.keys(values).length > MAX_SETTINGS * 2) throw new Error('Too many settings for one app.');
  return [...rest, { ...(old || {}), id: app, values }];
}

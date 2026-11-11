/* Dispatch: view prefs kept in this browser only. Today that is the project filter on Work. Projects and
   which run is in which live in the opencode connector (.work/_dashboard/projects.json), because agents need them.

   Shape (localStorage "dispatch.view"): { project: "all" | "<project id>" }

   Dispatch 1.x kept sidebar folders, pins and collapsed groups under "dispatch.sidebar". Dispatch 2.0 has no
   sidebar, so loadView removes that key once. Pure functions take and return the prefs; main.js loads and saves. */
export const VIEW_KEY = 'dispatch.view';
export const OLD_KEY = 'dispatch.sidebar';

export function emptyView() { return { project: 'all' }; }

/** Clean whatever was stored (another version, a hand edit) into the current shape. */
export function cleanView(raw) {
  const out = emptyView();
  if (raw && typeof raw === 'object' && typeof raw.project === 'string' && /^[\w-]{1,64}$/.test(raw.project)) out.project = raw.project;
  return out;
}

/** Read the prefs from a Storage-like object. Never throws: blocked storage gives the defaults. */
export function loadView(store) {
  try { if (store.getItem(OLD_KEY) != null && store.removeItem) store.removeItem(OLD_KEY); } catch (e) { /* blocked */ }
  try { return cleanView(JSON.parse(store.getItem(VIEW_KEY) || 'null')); } catch (e) { return emptyView(); }
}
export function saveView(store, view) {
  try { store.setItem(VIEW_KEY, JSON.stringify(cleanView(view))); return true; } catch (e) { return false; }
}

/** A project that is gone (deleted elsewhere) falls back to all projects. Returns true when it changed. */
export function pruneView(view, projectIds) {
  if (view.project === 'all' || projectIds.has(view.project)) return false;
  view.project = 'all';
  return true;
}

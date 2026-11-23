// App ids and their data folders (docs/data-format.md, App folders). Plain data and pure functions, no imports:
// the agent, the SDK and the workshop command all read it.
//
// Since the rename of November 2026 every app's id is the name people see (Tasks is `tasks`, Builds is `builds`)
// and its folder in the data folder is its id. What was saved under an old id or folder keeps working:
//   - the agent renames old folders on start (agent/lib/datadir.mjs moveOldFolders) and rewrites what they hold
//     (renameSaved below), once;
//   - the SDK reads anything still under an old name the same way (renameSaved on every read), and its browser
//     folder store uses an app's old folder while that is the only one there;
//   - old addresses, links (ws:prioritizer/task/x) and handoffs go to the new id (currentId).

/** Old app id -> its id now. */
export const RENAMED_IDS = Object.freeze({ prioritizer: 'tasks', slate: 'builds', receipts: 'people', runway: 'roadmaps' });

/** Folders an app's data was kept in before, newest first. Renamed to the app's id on the agent's start. */
export const OLD_FOLDERS = Object.freeze({
  tasks: Object.freeze(['docket', 'prioritizer']),
  builds: Object.freeze(['loom', 'slate']),
  people: Object.freeze(['rapport', 'receipts']),
  notes: Object.freeze(['folio']),
  roadmaps: Object.freeze(['runway']),
});

/** Folder names that differ from the app id. None since the rename; kept for callers that map ids to folders. */
export const APP_FOLDERS = Object.freeze({});

/** An app id as it is now: an old id gives the new one, anything else is returned as it is. */
export const currentId = id => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(RENAMED_IDS, id) ? RENAMED_IDS[id] : id);

/** A schema name ("prioritizer.tasks") with its app part as it is now ("tasks.tasks"). */
export function currentSchema(schema) {
  if (typeof schema !== 'string') return schema;
  const dot = schema.indexOf('.');
  if (dot < 1) return schema;
  const app = schema.slice(0, dot), now = currentId(app);
  return now === app ? schema : now + schema.slice(dot);
}

/** A "<app>/<rest>" address or ws: link target with its app part as it is now. */
export function currentPath(p) {
  if (typeof p !== 'string') return p;
  const slash = p.indexOf('/');
  const app = slash < 0 ? p : p.slice(0, slash), now = currentId(app);
  return now === app ? p : now + (slash < 0 ? '' : p.slice(slash));
}

/**
 * A collection envelope as it reads now: its schema's app part, and app ids inside the collections that keep them
 * (handoffs: `to` and `source.app`; Settings' app-settings: each item's id, and its tombstones). Returns the same
 * object when nothing changed, else a changed copy. Anything that is not an envelope is returned as it is.
 */
export function renameSaved(collection, env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return env;
  let out = env;
  const copy = () => { if (out === env) out = { ...env }; return out; };
  const schema = currentSchema(env.schema);
  if (schema !== env.schema) copy().schema = schema;
  const name = String(collection || '').split('/').pop();
  if (Array.isArray(env.items) && (name === 'handoffs' || name === 'app-settings')) {
    let changed = false;
    const items = env.items.map(it => {
      if (!it || typeof it !== 'object') return it;
      let n = it;
      if (name === 'handoffs') {
        if (currentId(it.to) !== it.to) n = { ...n, to: currentId(it.to) };
        if (it.source && typeof it.source === 'object' && currentId(it.source.app) !== it.source.app) n = { ...n, source: { ...it.source, app: currentId(it.source.app) } };
      } else if (currentId(it.id) !== it.id) n = { ...n, id: currentId(it.id) };
      if (n !== it) changed = true;
      return n;
    });
    if (changed) copy().items = items;
    if (name === 'app-settings' && env.deleted && typeof env.deleted === 'object' && Object.keys(env.deleted).some(k => currentId(k) !== k)) {
      copy().deleted = Object.fromEntries(Object.entries(env.deleted).map(([k, v]) => [currentId(k), v]));
    }
  }
  return out;
}

/** A "<app>:<rest>" key (a handled offer, say) with its app part as it is now. */
export function currentKey(k) {
  if (typeof k !== 'string') return k;
  const c = k.indexOf(':');
  if (c < 1) return k;
  const app = k.slice(0, c), now = currentId(app);
  return now === app ? k : now + k.slice(c);
}
/** A set or list of such keys, as a Set of keys as they are now. */
export const currentKeys = list => new Set([...(list || [])].map(currentKey));
/** The ids an app had before (none for most apps). */
export const formerIds = id => Object.keys(RENAMED_IDS).filter(k => RENAMED_IDS[k] === id);

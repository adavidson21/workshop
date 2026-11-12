/* Prioritizer: how the board is stored. Pure functions with no DOM, so Node tests can import them.

   The board is three collections in the Workshop data format (docs/data-format.md), stored by the SDK as
   <data folder>/prioritizer/<collection>.json (the agent, or Chrome's folder store in browser mode), or in
   IndexedDB in browser mode before a folder is chosen:

     lists     prioritizer.lists v1     items: {id, name, parentId}
     tasks     prioritizer.tasks v4     items: tasks as the board keeps them; meta: {capacity}. A task's `who` is
                                        people and group ids from Workshop's people directory (directory-model.js)
     settings  prioritizer.settings v1  no items; meta: {ado, onboarded, rowFields, follow}, Prioritizer's own ADO
                                        behavior, the date the first-run tour was shown (absent until then), the
                                        optional row fields that are hidden, {hidden: [keys]} (absent when none are),
                                        and delegating's {days, filled} (absent while days is 2 and nothing filled)

   Which view, lens, scope and PR filter a window shows is per window (saved with the other UI state), not data.
   tasks v4 replaced names in `people` with directory ids in `who`; a v3 file (or backup) is read, and its names
   become ids once the directory has loaded (directory.js adoptNames). Docket no longer keeps people of its own:
   an old prioritizer.people file is left as it is and not read. */

const COLLECTIONS = ['lists', 'tasks', 'settings']; // write order: a task's list is saved before the task
const VERSIONS = {lists: 1, tasks: 4, settings: 1};
const schemaOf = col => `prioritizer.${col}`;
const MAIN_LIST = 'l_main'; // the first list of a new board, the same in every window so two new boards merge cleanly

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const stamps = env => new Map((env && env.items || []).map(i => [i.id, i.updatedAt]));

/* The envelope for one collection as the board is now. Stamps and tombstones come from `shadow`, the
   envelope the board last matched, so unchanged items keep their stamps; ws.data.stamp then gives
   changed items a new one. `held` are tasks whose list this window doesn't have yet (see applyEnvelope);
   they are kept as they are. */
function envelopeFromBoard(col, board, shadow, held = []){
  const at = stamps(shadow);
  const item = o => { const c = clone(o); c.updatedAt = at.get(c.id) ?? 0; return c; };
  const env = {schema: schemaOf(col), version: VERSIONS[col], rev: shadow ? shadow.rev : 0, items: [], deleted: clone(shadow && shadow.deleted) || {}};
  const metaAt = shadow && shadow.meta ? shadow.meta.updatedAt : 0;
  if (col === 'lists') env.items = board.lists.map(item);
  if (col === 'tasks'){
    const here = new Set(board.tasks.map(t => t.id)), lists = new Set(board.lists.map(l => l.id));
    env.items = board.tasks.map(item).concat(held.filter(t => !here.has(t.id) && !lists.has(t.listId)).map(item));
    env.meta = {updatedAt: metaAt, capacity: board.capacity};
  }
  if (col === 'settings'){
    env.meta = {updatedAt: metaAt, ado: clone(board.ado) || {}};
    if (board.onboarded) env.meta.onboarded = board.onboarded;
    if (board.rowFields && Array.isArray(board.rowFields.hidden) && board.rowFields.hidden.length) env.meta.rowFields = clone(board.rowFields);
    if (board.follow && (board.follow.days !== 2 || board.follow.filled)) env.meta.follow = clone(board.follow);
  }
  return env;
}

/* Puts one collection's envelope into the board (which the caller then sanitizes). Returns the tasks it
   had to hold back because their list isn't on the board: another window saved a new list and its tasks,
   and the tasks arrived first. They are shown once the list arrives, and are never treated as deleted. */
function applyEnvelope(col, env, board){
  const items = (env && env.items || []).map(i => { const c = clone(i); delete c.updatedAt; return c; });
  if (col === 'lists') board.lists = items;
  if (col === 'tasks'){
    const lists = new Set(board.lists.map(l => l.id));
    board.tasks = items.filter(t => lists.has(t.listId));
    if (env && env.meta && env.meta.capacity !== undefined) board.capacity = env.meta.capacity;
    return items.filter(t => !lists.has(t.listId));
  }
  if (col === 'settings'){
    board.ado = clone(env && env.meta && env.meta.ado) || {};
    board.onboarded = env && env.meta && typeof env.meta.onboarded === 'string' ? env.meta.onboarded : null;
    board.rowFields = clone(env && env.meta && env.meta.rowFields) || {hidden: []};
    board.follow = clone(env && env.meta && env.meta.follow) || {};
  }
  return [];
}

/* One-time move of a board saved by the localStorage versions of Prioritizer (key prioritizer.v1, board
   versions 1 and 2) into envelopes. Keeps their change stamps and tombstones, so a copy moved here and a
   copy moved elsewhere still merge. Items without a stamp get `now`. */
function legacyToEnvelopes(raw, now = Date.now()){
  const dead = raw.dead && typeof raw.dead === 'object' ? raw.dead : {};
  const tomb = k => Object.fromEntries(Object.entries(dead[k] || {}).filter(([id, t]) => id && Number.isFinite(t)));
  const at = o => Number.isFinite(o.updatedAt) ? o.updatedAt : (Number.isFinite(raw.updatedAt) ? raw.updatedAt : now);
  const out = {};
  for (const col of COLLECTIONS) out[col] = {schema: schemaOf(col), version: VERSIONS[col], rev: 0, items: [], deleted: {}};
  out.lists.items = (raw.lists || []).map(l => Object.assign(clone(l), {updatedAt: at(l)}));
  out.lists.deleted = tomb('lists');
  out.tasks.items = (raw.tasks || []).map(t => Object.assign(clone(t), {updatedAt: at(t)}));
  out.tasks.deleted = tomb('tasks');
  out.tasks.meta = {updatedAt: Number.isFinite(raw.capacityAt) && raw.capacityAt ? raw.capacityAt : at(raw), capacity: raw.capacity ?? 20};
  out.settings.meta = {updatedAt: at(raw), ado: clone(raw.ado) || {}};
  for (const col of COLLECTIONS){
    const ids = new Set(out[col].items.map(i => i.id));
    for (const id of Object.keys(out[col].deleted)) if (ids.has(id) && out[col].deleted[id] < out[col].items.find(i => i.id === id).updatedAt) delete out[col].deleted[id];
  }
  return out;
}

/* Prioritizer's collections from a Workshop bundle (a backup from Settings or from Prioritizer's file
   menu). Throws an Error with a plain message when the file is not a bundle or can't be used here. */
function envelopesFromBundle(bundle){
  if (!bundle || bundle.schema !== 'workshop.bundle' || !Array.isArray(bundle.collections)) throw new Error('That file is not a Workshop backup.');
  if (bundle.version !== 1) throw new Error('That backup was made by a newer Workshop. Update Workshop, then import it.');
  const out = {};
  for (const row of bundle.collections){
    if (!row || row.app !== 'prioritizer' || !COLLECTIONS.includes(row.collection)) continue;
    const env = row.envelope;
    if (!env || env.schema !== schemaOf(row.collection) || !Array.isArray(env.items)) throw new Error(`The ${row.collection} in that backup are damaged.`);
    if (env.version > VERSIONS[row.collection]) throw new Error('That backup was made by a newer Workshop. Update Workshop, then import it.');
    // tasks v3 (names in `people`) reads as v4: the names become ids once the board has them (directory.js).
    const old = row.collection === 'tasks' && env.version === 3;
    if (env.version < VERSIONS[row.collection] && !old) throw new Error(`That backup has ${row.collection} in a format this version can't read.`);
    out[row.collection] = Object.assign(clone(env), old ? {version: VERSIONS.tasks} : {});
  }
  if (!Object.keys(out).length) throw new Error('That backup has no Docket board in it.');
  return out;
}

/* Same content, stamps and tombstones (rev and updatedAt of the envelope itself don't count). */
const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  : JSON.stringify(v);
const sameEnvelope = (a, b) => !!a && !!b && canon({i: a.items, d: a.deleted || {}, m: a.meta}) === canon({i: b.items, d: b.deleted || {}, m: b.meta});

export { COLLECTIONS, MAIN_LIST, VERSIONS, applyEnvelope, clone, envelopeFromBoard, envelopesFromBundle, legacyToEnvelopes, sameEnvelope, schemaOf };

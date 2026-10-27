/* Prioritizer: how the board is stored. Pure functions with no DOM, so Node tests can import them.

   The board is four collections in the Workshop data format (docs/data-format.md), stored by the SDK as
   <data folder>/prioritizer/<collection>.json (the agent, or Chrome's folder store in browser mode), or in
   IndexedDB in browser mode before a folder is chosen:

     lists     prioritizer.lists v1     items: {id, name, parentId}
     tasks     prioritizer.tasks v3     items: tasks as the board keeps them; meta: {capacity}
     people    prioritizer.people v1    items: {id: lower-case name, name}
     settings  prioritizer.settings v1  no items; meta: {ado}, Prioritizer's own ADO behavior

   Which view, lens and scope a window shows is per window (saved with the other UI state), not data.
   tasks is v3 because v1 and v2 were the localStorage board shapes this replaces. */

const COLLECTIONS = ['lists', 'tasks', 'people', 'settings']; // write order: a task's list is saved before the task
const VERSIONS = {lists: 1, tasks: 3, people: 1, settings: 1};
const schemaOf = col => `prioritizer.${col}`;
const MAIN_LIST = 'l_main'; // the first list of a new board, the same in every window so two new boards merge cleanly

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const stamps = env => new Map((env && env.items || []).map(i => [i.id, i.updatedAt]));
const personId = name => String(name).toLowerCase().slice(0, 200);

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
  if (col === 'people'){
    const seen = new Set();
    env.items = board.people.filter(n => { const k = personId(n); if (seen.has(k)) return false; seen.add(k); return true; })
      .map(n => item({id: personId(n), name: n}));
  }
  if (col === 'settings') env.meta = {updatedAt: metaAt, ado: clone(board.ado) || {}};
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
  if (col === 'people') board.people = items.map(p => p.name).filter(n => typeof n === 'string');
  if (col === 'settings') board.ado = clone(env && env.meta && env.meta.ado) || {};
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
  const peopleAt = raw.peopleAt && typeof raw.peopleAt === 'object' ? raw.peopleAt : {};
  const seen = new Set();
  out.people.items = (raw.people || []).map(String).filter(n => { const k = personId(n); if (!n.trim() || seen.has(k)) return false; seen.add(k); return true; })
    .map(n => ({id: personId(n), updatedAt: Number.isFinite(peopleAt[n.toLowerCase()]) ? peopleAt[n.toLowerCase()] : at(raw), name: n}));
  out.people.deleted = tomb('people');
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
    if (env.version < VERSIONS[row.collection]) throw new Error(`That backup has ${row.collection} in a format this version can't read.`);
    out[row.collection] = clone(env);
  }
  if (!Object.keys(out).length) throw new Error('That backup has no Prioritizer board in it.');
  return out;
}

/* Same content, stamps and tombstones (rev and updatedAt of the envelope itself don't count). */
const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  : JSON.stringify(v);
const sameEnvelope = (a, b) => !!a && !!b && canon({i: a.items, d: a.deleted || {}, m: a.meta}) === canon({i: b.items, d: b.deleted || {}, m: b.meta});

export { COLLECTIONS, MAIN_LIST, VERSIONS, applyEnvelope, clone, envelopeFromBoard, envelopesFromBundle, legacyToEnvelopes, sameEnvelope, schemaOf };

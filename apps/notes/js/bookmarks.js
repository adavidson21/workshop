/* Folio: bookmarks, the notes you pinned under Quick Notes. Folio's own collection `bookmarks`
   (notes.bookmarks v1): items {id: <note path>, at}, in the order they were added. Renames and moves carry a
   bookmark along; trashing a note drops it.

   The pure functions take and return envelopes; createBookmarks reads and writes them through ws.data. */

export const COLLECTION = 'bookmarks';
export const SCHEMA = 'notes.bookmarks';
export const VERSION = 1;
export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = (env) => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

/** Bookmarked note paths, oldest first. */
export function paths(env) {
  if (!env || !readable(env)) return [];
  return [...env.items].sort((a, b) => (a.at || 0) - (b.at || 0)).map(i => i.id);
}

/** A copy with `path` added or removed. */
export function toggled(env, path, now = Date.now()) {
  const next = structuredClone(env || blank());
  const k = next.items.findIndex(i => i.id === path);
  if (k >= 0) next.items.splice(k, 1);
  else next.items.push({ id: path, at: now });
  return next;
}

/** A copy with paths moved (Map old -> new) and paths in `gone` dropped; null when nothing changes. */
export function followed(env, moves = new Map(), gone = []) {
  if (!env || !readable(env)) return null;
  let changed = false;
  const next = structuredClone(env);
  next.items = next.items.flatMap(i => {
    if (gone.includes(i.id)) { changed = true; return []; }
    const to = moves.get(i.id);
    if (to && to !== i.id) { changed = true; return [{ ...i, id: to }]; }
    return [i];
  });
  return changed ? next : null;
}

export function createBookmarks(ws, { onChange = () => {} } = {}) {
  let env = null;
  async function read() {
    try { env = await ws.data.get(COLLECTION); } catch { env = null; }
    onChange();
  }
  async function write(after) {
    const before = env || blank();
    ws.data.stamp(before, after);
    try { await ws.data.put(COLLECTION, after); }
    catch (e) {
      if (e.code !== 'conflict' || !e.current) throw e;
      after = ws.data.merge(after, e.current);
      await ws.data.put(COLLECTION, after);
    }
    env = after;
    onChange();
  }
  read();
  try { ws.data.subscribe(COLLECTION, read); } catch { /* no subscriptions here */ }
  return {
    get list() { return paths(env); },
    has(path) { return paths(env).includes(path); },
    async toggle(path) { if (!readable(env)) return false; await write(toggled(env, path)); return this.has(path); },
    async follow(moves, gone) { const next = followed(env, moves, gone); if (next) await write(next); }
  };
}

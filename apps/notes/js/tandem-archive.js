/* Notes: archived Tandem runs (Notes 4.14.0). Runs you have read and acted on, out of the Tandem section's view but
   not deleted: nothing in .work changes, and Unarchive brings one back. Notes' own collection `tandem-archive`
   (notes.tandem-archive v1): items {id: <.work folder>, at}.

   An archived run shows again by itself when it needs you: Tandem is waiting on your review, or a file in it changed
   after you archived it. The pure functions take and return envelopes; createArchive reads and writes them through
   ws.data, like bookmarks.js. */

export const COLLECTION = 'tandem-archive';
export const SCHEMA = 'notes.tandem-archive';
export const VERSION = 1;
export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = (env) => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

/** folder -> when it was archived (ms). */
export function archivedAt(env) {
  const m = new Map();
  if (env && readable(env)) for (const i of env.items) if (i && typeof i.id === 'string') m.set(i.id, Number(i.at) || 0);
  return m;
}

/** A copy with `folder` archived (on) or back (off). */
export function setArchived(env, folder, on, now = Date.now()) {
  const next = structuredClone(env || blank());
  next.items = next.items.filter(i => i.id !== folder);
  if (on) next.items.push({ id: folder, at: now });
  return next;
}

/** Whether a run stays hidden: archived, not waiting on you, and nothing in it changed since. */
export function hidden(it, at) {
  if (at == null || !it || it.review) return false;
  return !(it.files || []).some(f => (f.mtime || 0) > at);
}

/** Runs split into the ones to show and the archived ones, each in the order given. */
export function splitRuns(items, at) {
  const shown = [], archived = [];
  for (const it of items || []) (hidden(it, at.get(it.folder)) ? archived : shown).push(it);
  return { shown, archived };
}

export function createArchive(ws, { onChange = () => {} } = {}) {
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
    get at() { return archivedAt(env); },
    async set(folder, on) { if (!readable(env)) return false; await write(setArchived(env, folder, on)); return true; }
  };
}

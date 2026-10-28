/* Receipts: reading and saving collections through the SDK's data API (ws.data), with the write loop from
   docs/data-format.md: stamp, put with the rev read, merge on a conflict, put again. No DOM, so Node tests
   drive it with a fake ws.data.

   Per collection it keeps two envelopes:
     base   what storage has, as last read or written (its rev is the one to send)
     local  what the page shows: base plus edits not saved yet, already stamped
   An edit stamps local against what it was before, then saves at once. If the save fails, the edit stays
   in local (on screen), the status says "Not saved yet", and the save is retried every 5 seconds. When
   another window or a program outside Workshop changes a collection, it is read again and merged with any
   edits not saved yet. A collection saved by a newer Receipts is shown but never written (read only). */
import { migrate } from './model.js';

export const RETRY_MS = 5000;
const MAX_CONFLICT_TRIES = 5;
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

/**
 * @param {object} o
 * @param {object} o.data   ws.data: get, put, subscribe, merge, stamp
 * @param {(s: {state: string, error?: Error}) => void} [o.status]  'saved', 'saving', 'error' or 'readonly'
 * @param {(collection: string) => void} [o.changed]  a collection changed from outside this window
 */
export function createStore({ data, status = () => {}, changed = () => {}, timers = globalThis }) {
  const base = new Map(), local = new Map(), edits = new Map();
  const readOnly = new Set(), dirty = new Set(), subs = new Map();
  let chain = Promise.resolve(), failed = null, pending = 0, retryTimer = null;

  const queue = fn => (chain = chain.then(fn, fn).catch(() => {}), chain);
  const report = () => status(readOnly.size && !failed && !pending ? { state: 'readonly' }
    : failed ? { state: 'error', error: failed } : pending ? { state: 'saving' } : { state: 'saved' });

  function accept(col, env) {
    const m = migrate(env, col);
    if (m.tooNew) readOnly.add(col);
    return m.env;
  }

  /** Reads a collection. Resolves the envelope shown (or null if it was never written). Rejects on errors. */
  async function load(col) {
    const env = accept(col, await data.get(col));
    if (env) base.set(col, clone(env)); else base.delete(col);
    if (!dirty.has(col)) { if (env) local.set(col, clone(env)); else local.delete(col); }
    else if (env) local.set(col, data.merge(local.get(col), env));
    watch(col);
    return local.get(col) || null;
  }

  /** Loads only collections not loaded before. */
  async function ensure(col) { return base.has(col) || local.has(col) || subs.has(col) ? (local.get(col) || null) : load(col); }

  function watch(col) {
    if (subs.has(col)) return;
    subs.set(col, data.subscribe(col, () => remote(col)));
  }

  /** Another window, or a program outside Workshop, changed this collection. */
  function remote(col) {
    return queue(async () => {
      let env;
      try { env = await data.get(col); } catch (e) { return; }
      if (!env) return;
      const b = base.get(col);
      if (b && env.rev <= b.rev && !(env.rev === b.rev && env.updatedAt !== b.updatedAt)) return;
      env = accept(col, env);
      base.set(col, clone(env));
      local.set(col, dirty.has(col) && local.get(col) && local.get(col).version === env.version ? data.merge(local.get(col), env) : clone(env));
      changed(col);
      report();
    });
  }

  /**
   * Changes a collection and saves it. `fn` gets a copy of the envelope (or of `init()` when the collection
   * does not exist yet) and returns the new one. Resolves once the save has run; never rejects (a failed save
   * shows in the status and is retried). Throws at once if the collection is read only.
   */
  function update(col, fn, init) {
    if (readOnly.has(col)) throw Object.assign(new Error('This was saved by a newer Receipts. Update Workshop to change it.'), { code: 'readonly' });
    const before = local.get(col) || null;
    const start = before ? clone(before) : init();
    const after = fn(start) || start;
    local.set(col, data.stamp(before, after));
    dirty.add(col);
    edits.set(col, (edits.get(col) || 0) + 1);
    watch(col);
    return save(col);
  }

  function save(col) {
    pending++; report();
    return queue(async () => {
      try {
        await putLoop(col);
        failed = null;
        if (![...dirty].length) { timers.clearTimeout(retryTimer); retryTimer = null; }
      } catch (e) {
        if (e && e.code === 'readonly') { changed(col); }
        else {
          failed = e || new Error('Could not save.');
          timers.clearTimeout(retryTimer);
          retryTimer = timers.setTimeout(() => { retryTimer = null; retry(); }, RETRY_MS);
        }
      } finally { pending--; report(); }
    });
  }

  async function putLoop(col) {
    if (!dirty.has(col)) return;
    const mark = edits.get(col);
    let env = clone(local.get(col));
    env.rev = base.has(col) ? base.get(col).rev : 0;
    delete env.updatedAt;
    for (let tries = 0; ; tries++) {
      try {
        const r = await data.put(col, env);
        const written = Object.assign(env, { rev: r.rev, updatedAt: r.updatedAt });
        base.set(col, clone(written));
        // Edits made during the write are saved by the save they queued.
        if (edits.get(col) === mark) { local.set(col, clone(written)); dirty.delete(col); }
        else local.set(col, Object.assign(local.get(col), { rev: r.rev }));
        return;
      } catch (e) {
        if (e && e.code === 'conflict' && e.current && tries < MAX_CONFLICT_TRIES) {
          const current = accept(col, e.current);
          base.set(col, clone(current));
          if (readOnly.has(col)) { local.set(col, clone(current)); dirty.delete(col); throw Object.assign(new Error('newer'), { code: 'readonly' }); }
          env = data.merge(env, current);
          env.rev = current.rev;
          delete env.updatedAt;
          local.set(col, data.merge(local.get(col), current));
          changed(col);
          continue;
        }
        throw e;
      }
    }
  }

  function retry() { for (const col of dirty) save(col); }

  /** Read every known collection again (after access to the folder or the agent came back). */
  function refresh() {
    for (const col of subs.keys()) remote(col);
    if (failed) retry();
    return chain;
  }

  function stop() {
    for (const off of subs.values()) try { off(); } catch (e) { /* already gone */ }
    subs.clear();
    timers.clearTimeout(retryTimer);
  }

  return {
    load, ensure, update, refresh, stop,
    get: col => local.get(col) || null,
    /** True when the collection was saved by a newer Receipts and is shown read only. */
    isReadOnly: col => readOnly.has(col),
    get anyReadOnly() { return readOnly.size > 0; },
    get unsaved() { return dirty.size > 0 || pending > 0; },
    /** Resolves after every queued save and update has run. */
    idle: () => chain,
    /** For tests: what storage has, as this window last saw it. */
    base: col => clone(base.get(col) || null)
  };
}

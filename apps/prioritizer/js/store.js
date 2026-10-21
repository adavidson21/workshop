/* Prioritizer: saving the board through the SDK's data API (ws.data.get/put/subscribe), and keeping two
   windows in step. No DOM, so Node tests can drive it with a fake backend.

   Per collection it keeps two envelopes:
     base    what storage has, as last read or written (has the rev to send)
     shadow  what the board on screen last matched; stamps for unchanged items come from here
   A save stamps the board against shadow and puts it with base.rev. On a conflict it merges with what is
   stored and puts again (the write loop in docs/data-format.md). When another window saves, the event
   brings the new envelope in, merged with any edits made here since, and the board is rebuilt.

   A failed write changes nothing on disk (the agent writes a temp file and renames it) and nothing on
   screen: the edits stay in memory, the status says "not saved", and the save is retried. */
import { COLLECTIONS, VERSIONS, applyEnvelope, clone, envelopeFromBoard, sameEnvelope } from './store-format.js';

const RETRY_MS = 5000, SAVE_DELAY_MS = 250, MAX_CONFLICT_TRIES = 5;

/**
 * @param {object} o
 * @param {object} o.data      ws.data: get, put, subscribe, merge, stamp
 * @param {() => object} o.board          the live board object
 * @param {(cols: string[]) => void} o.applied  called after envelopes were put into the board (sanitize and render there)
 * @param {(s: {state: string, error?: Error}) => void} [o.status]  'saved', 'saving', 'error' or 'readonly'
 */
function createStore({data, board, applied, status = () => {}, timers = globalThis}){
  const base = {}, shadow = {}, readOnly = {};
  let held = [];               // tasks whose list hasn't arrived yet
  let chain = Promise.resolve();
  let saveTimer = null, retryTimer = null, failed = null, pending = 0, started = false;
  const unsub = [];

  // Everything that touches base and shadow runs one at a time, in order.
  const queue = fn => (chain = chain.then(fn, fn).catch(() => {}), chain);
  const report = () => status(Object.values(readOnly).some(Boolean) ? {state: 'readonly'}
    : failed ? {state: 'error', error: failed} : pending ? {state: 'saving'} : {state: 'saved'});

  const local = col => data.stamp(shadow[col] || null, envelopeFromBoard(col, board(), shadow[col], held));
  // Items with stamp 0 were never saved or edited: the "Main" list of a new board. They give way to
  // anything stored, so a window opened on a new board doesn't add an empty Main list to a saved one.
  const placeholdersOut = env => Object.assign(env, {items: env.items.filter(i => i.updatedAt > 0)});
  // After the board was rebuilt (and sanitized), record what it matches now. Stamps and tombstones come
  // from `from`, the envelope it was built from.
  function markShadow(col, from){
    const env = envelopeFromBoard(col, board(), from, held);
    env.rev = from ? from.rev : 0;
    shadow[col] = env;
  }
  function apply(col, env){
    const b = board();
    if (col === 'tasks') held = applyEnvelope(col, env, b);
    else applyEnvelope(col, env, b);
    if (col === 'lists' && held.length){
      // A list arrived: show the tasks that were waiting for it.
      const lists = new Set(b.lists.map(l => l.id));
      b.tasks.push(...held.filter(t => lists.has(t.listId)));
      held = held.filter(t => !lists.has(t.listId));
    }
  }
  function tooNew(col, env){
    if (env && env.version > VERSIONS[col]){ readOnly[col] = true; return true; }
    return false;
  }

  /* First load: read every collection. Resolves {empty} (true when nothing was ever saved). */
  async function load(){
    const envs = {};
    for (const col of COLLECTIONS) envs[col] = await data.get(col);
    const empty = COLLECTIONS.every(c => !envs[c]);
    for (const col of COLLECTIONS) if (envs[col]){ base[col] = envs[col]; tooNew(col, envs[col]); apply(col, envs[col]); }
    applied(COLLECTIONS);
    for (const col of COLLECTIONS) markShadow(col, base[col]);
    report();
    return {empty};
  }

  /* Saves envelopes as they are, keeping their stamps (the one-time move of an old board). Merges with
     anything another window saved in the meantime. */
  function seed(envs){
    return queue(async () => {
      for (const col of COLLECTIONS){
        if (!envs[col] || readOnly[col]) continue;
        await putLoop(col, Object.assign(clone(envs[col]), {rev: base[col] ? base[col].rev : 0}));
        apply(col, base[col]);
      }
      applied(COLLECTIONS);
      for (const col of COLLECTIONS) markShadow(col, base[col]);
    });
  }

  /* Merges envelopes from a backup into the board and saves. */
  function importEnvelopes(envs){
    return queue(async () => {
      for (const col of COLLECTIONS){
        if (!envs[col] || readOnly[col]) continue;
        // The board is "remote" here, so its order comes first and it wins ties with the backup.
        const merged = data.merge(envs[col], placeholdersOut(local(col)));
        merged.rev = base[col] ? base[col].rev : 0;
        await putLoop(col, merged);
        apply(col, base[col]);
      }
      applied(COLLECTIONS);
      for (const col of COLLECTIONS) markShadow(col, base[col]);
    });
  }

  // put, and on a conflict merge with what's stored and put again. Leaves base at what was written.
  async function putLoop(col, env){
    for (let tries = 0; ; tries++){
      try {
        const r = await data.put(col, env);
        base[col] = Object.assign(env, {rev: r.rev, updatedAt: r.updatedAt});
        return;
      } catch (e){
        if (e && e.code === 'conflict' && e.current && tries < MAX_CONFLICT_TRIES){
          if (tooNew(col, e.current)){ base[col] = e.current; throw Object.assign(new Error('newer'), {code: 'readonly'}); }
          const merged = data.merge(env, e.current);
          merged.rev = e.current.rev;
          env = merged;
          continue;
        }
        throw e;
      }
    }
  }

  // Bring base into the board, keeping edits made here since shadow, then save if the result differs.
  function rebuild(cols){
    let again = false;
    const from = {};
    for (const col of cols){
      const merged = data.merge(placeholdersOut(local(col)), base[col]);
      apply(col, merged);
      from[col] = merged;
    }
    applied(cols);
    for (const col of cols){
      markShadow(col, from[col]);
      if (!sameEnvelope(shadow[col], base[col])) again = true;
    }
    if (again) schedule();
  }

  async function flush(col){
    if (readOnly[col]) return;
    const env = local(col);
    // Saving a new board's placeholder list makes it real.
    const now = Date.now();
    for (const i of env.items) if (!i.updatedAt) i.updatedAt = now;
    if (env.meta && !env.meta.updatedAt) env.meta.updatedAt = now;
    shadow[col] = clone(env);
    if (base[col] ? sameEnvelope(env, base[col]) : !env.items.length && !Object.keys(env.deleted).length && !env.meta) return;
    env.rev = base[col] ? base[col].rev : 0;
    const sent = clone(env);
    await putLoop(col, env);
    // A conflict was merged in: show what was saved, with anything edited during the write on top.
    if (!sameEnvelope(sent, base[col])) rebuild([col]);
  }

  /* Save every collection now. Resolves when done; never rejects (failures show in the status). */
  function flushAll(){
    timers.clearTimeout(saveTimer); saveTimer = null;
    pending++; report();
    return queue(async () => {
      try {
        for (const col of COLLECTIONS) await flush(col);
        failed = null;
        timers.clearTimeout(retryTimer); retryTimer = null;
      } catch (e){
        if (e && e.code === 'readonly'){ rebuild(COLLECTIONS.filter(c => readOnly[c])); }
        else {
          failed = e || new Error('Could not save.');
          timers.clearTimeout(retryTimer);
          retryTimer = timers.setTimeout(() => { retryTimer = null; flushAll(); }, RETRY_MS);
        }
      } finally { pending--; report(); }
    });
  }

  /* Save soon (edits come in bursts: drag, type, click). */
  function schedule(){
    if (!started) return;
    timers.clearTimeout(saveTimer);
    saveTimer = timers.setTimeout(flushAll, SAVE_DELAY_MS);
  }

  /* Another window (or Settings' import) saved this collection. */
  function remote(col){
    return queue(async () => {
      const env = await data.get(col);
      if (!env || (base[col] && env.rev <= base[col].rev)) return;
      base[col] = env;
      if (tooNew(col, env)){ apply(col, env); applied([col]); markShadow(col, env); report(); return; }
      rebuild([col]);
    });
  }

  /* Start listening for other windows. Call after load. */
  function start(){
    started = true;
    for (const col of COLLECTIONS) unsub.push(data.subscribe(col, () => remote(col)));
  }
  /* The agent came back after being unreachable: events sent meanwhile were missed. */
  function refresh(){ for (const col of COLLECTIONS) remote(col); if (failed) flushAll(); }
  function stop(){ unsub.splice(0).forEach(f => f()); timers.clearTimeout(saveTimer); timers.clearTimeout(retryTimer); started = false; }

  return {
    load, seed, importEnvelopes, schedule, flushAll, start, stop, refresh,
    /** Resolves after every queued save and update has run. */
    idle(){ return (saveTimer ? flushAll() : chain); },
    get unsaved(){ return !!saveTimer || pending > 0 || !!failed; },
    get readOnly(){ return Object.values(readOnly).some(Boolean); },
    /** True until something is saved: nothing stored yet. */
    get isNew(){ return COLLECTIONS.every(c => !base[c]); },
    /** For tests: what storage has, as this window last saw it. */
    base(col){ return clone(base[col]); }
  };
}

export { createStore, RETRY_MS, SAVE_DELAY_MS };

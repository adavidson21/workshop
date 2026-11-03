/* Runway's data, through the Workshop SDK. No DOM, so Node tests drive it with a fake `ws`.

   Collections (all version 1, docs/data-format.md):
     index       one item per roadmap: {id, title}. Deleting a roadmap tombstones it here; its file is kept.
     maps/<id>   one roadmap: lanes and items are the envelope's items, the roadmap's settings its meta.
     settings    meta: {lastOpen}
   Files (ws.files): exports/<id>.md, when you save a Markdown copy to the folder.

   Writes follow the data format's loop: stamp against what was read, put with its rev, and on a conflict
   merge with what is stored and put again. A failed write keeps the edit on screen, shows "Not saved yet"
   and retries every 5 seconds. */
import { APP, VERSION, blankDoc, fromEnvelope, newMapId, toEnvelopeParts, validMapId } from './model.js';

const RETRY_MS = 5000;
const DEBOUNCE_MS = 350;

const blank = (name, meta) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {}, ...(meta ? { meta: { updatedAt: 0, ...meta } } : {}) });
const err = (code, message) => Object.assign(new Error(message), { code });

export function createStore(ws, { onChange = () => {}, now = () => new Date(), retryMs = RETRY_MS, debounceMs = DEBOUNCE_MS } = {}) {
  const v = {
    loaded: false,
    waiting: false,        // the browser's folder store needs Allow
    list: [],              // [{id, title, changed}]
    mapId: null,
    doc: null,
    missing: false,        // the open roadmap's id is not in the index and has no file
    readOnly: '',          // set when a collection was saved by a newer Runway
    save: 'saved',         // 'saved' | 'saving' | 'unsaved'
    error: ''
  };
  const env = {};          // collection name -> envelope as last read or written
  let dirty = new Set();   // collection names with edits not written yet
  let timer = null, retry = null, running = null;
  const changed = () => onChange(v);
  const mapName = (id) => `maps/${id}`;

  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  async function read(name, meta) {
    const e = await ws.data.get(name);
    if (e && e.version > VERSION) { v.readOnly = 'This roadmap was saved by a newer Runway. Update to change it.'; env[name] = e; return e; }
    env[name] = e || blank(name, meta);
    return env[name];
  }

  /** The envelope to write for a collection, from what is on screen. */
  function compose(name) {
    const base = env[name];
    const after = structuredClone(base);
    if (name === 'index') {
      after.items = v.list.map(x => ({ id: x.id, title: x.title }));
    } else if (name === mapName(v.mapId) && v.doc) {
      const parts = toEnvelopeParts(v.doc);
      after.items = structuredClone(parts.items);
      after.meta = { ...structuredClone(parts.meta), updatedAt: base.meta ? base.meta.updatedAt : 0 };
    } else if (name === 'settings') {
      after.meta = { ...(base.meta || {}), lastOpen: v.mapId, updatedAt: base.meta ? base.meta.updatedAt : 0 };
    }
    // Items that did not change keep their stamp (stamp() only sets it on changed ones).
    const old = new Map(base.items.map(i => [i.id, i.updatedAt]));
    for (const i of after.items) if (old.has(i.id)) i.updatedAt = old.get(i.id);
    ws.data.stamp(base, after);
    return after;
  }

  async function put(name) {
    const after = compose(name);
    try {
      const r = await ws.data.put(name, after);
      env[name] = { ...after, rev: r.rev, updatedAt: r.updatedAt };
    } catch (e) {
      if (e.code !== 'conflict' || !e.current) throw e;
      const merged = ws.data.merge(after, e.current);
      const r = await ws.data.put(name, merged);
      env[name] = { ...merged, rev: r.rev, updatedAt: r.updatedAt };
      apply(name);
    }
  }

  /** Show a collection as stored (after a merge or another window's write). */
  function apply(name) {
    if (name === 'index') v.list = listFrom(env.index);
    if (name === mapName(v.mapId)) v.doc = fromEnvelope(env[name], now());
  }

  const listFrom = (e) => (e.items || []).filter(x => validMapId(x.id)).map(x => ({ id: x.id, title: String(x.title || 'Untitled roadmap').slice(0, 120), changed: x.updatedAt || 0 }));

  /** Write every dirty collection, one at a time. */
  function flush() {
    clearTimeout(timer); timer = null;
    if (running) return running.then(() => (dirty.size ? flush() : undefined));
    if (!dirty.size) return Promise.resolve();
    if (v.readOnly) { dirty.clear(); return Promise.resolve(); }
    v.save = 'saving'; changed();
    running = (async () => {
      const names = [...dirty];
      dirty = new Set();
      const failed = [];
      for (const name of names) {
        try { await put(name); }
        catch (e) {
          failed.push(name);
          if (waitFor(e)) v.error = 'Allow Workshop to use your folder to save.';
          else v.error = e && e.message ? e.message : 'Could not save.';
        }
      }
      for (const n of failed) dirty.add(n);
      v.save = dirty.size ? 'unsaved' : 'saved';
      if (!dirty.size) v.error = '';
      clearTimeout(retry);
      if (failed.length) retry = setTimeout(() => flush(), retryMs);
    })().finally(() => { running = null; changed(); });
    return running;
  }

  function touch(...names) {
    for (const n of names) dirty.add(n);
    v.save = 'unsaved';
    clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  return {
    v,
    flush,
    hasPending: () => dirty.size > 0 || !!running,

    async load() {
      try {
        await Promise.all([read('index'), read('settings', {})]);
        v.list = listFrom(env.index);
        v.loaded = true;
      } catch (e) {
        if (!waitFor(e)) throw e;
      }
      changed();
    },

    lastOpen: () => (env.settings && env.settings.meta && env.settings.meta.lastOpen) || null,

    /** Open a roadmap. Resolves false if there is no such roadmap. */
    async open(id) {
      if (!validMapId(id)) return false;
      if (dirty.size) await flush();
      const e = await ws.data.get(mapName(id));
      if (!e && !v.list.some(x => x.id === id)) { v.missing = true; changed(); return false; }
      v.missing = false;
      v.readOnly = '';
      if (e && e.version > VERSION) v.readOnly = 'This roadmap was saved by a newer Runway. Update to change it.';
      env[mapName(id)] = e || blank(mapName(id), {});
      v.mapId = id;
      v.doc = fromEnvelope(env[mapName(id)], now());
      if (!e) v.doc.meta.title = (v.list.find(x => x.id === id) || {}).title || v.doc.meta.title;
      if (env.settings && (env.settings.meta || {}).lastOpen !== id) touch('settings');
      changed();
      return true;
    },

    close() { v.mapId = null; v.doc = null; changed(); },

    /** Change the open roadmap. `fn(doc)` edits it in place. */
    edit(fn) {
      if (!v.doc || v.readOnly || v.waiting) return false;
      const title = v.doc.meta.title;
      fn(v.doc);
      const names = [mapName(v.mapId)];
      if (v.doc.meta.title !== title) {
        const row = v.list.find(x => x.id === v.mapId);
        if (row) { row.title = v.doc.meta.title; names.push('index'); }
      }
      touch(...names);
      changed();
      return true;
    },

    /** A new roadmap, optionally from a doc (an imported outline). Resolves its id. */
    async create(doc = blankDoc(undefined, now())) {
      if (v.waiting) throw err('unavailable', 'Allow Workshop to use your folder first.');
      const id = newMapId();
      v.list.unshift({ id, title: doc.meta.title, changed: Date.now() });
      env[mapName(id)] = blank(mapName(id), {});
      v.mapId = id;
      v.doc = doc;
      touch(mapName(id), 'index', 'settings');
      await flush();
      changed();
      return id;
    },

    /** Remove a roadmap from the list. Its file stays in the folder. */
    async remove(id) {
      v.list = v.list.filter(x => x.id !== id);
      if (v.mapId === id) { v.mapId = null; v.doc = null; }
      touch('index');
      await flush();
    },

    /** Another window or program changed a collection: show it, keeping edits not saved yet. */
    async reload(name) {
      if (!env[name]) return;
      if (dirty.has(name) || running) { await flush(); }
      if (dirty.has(name)) return;
      const e = await ws.data.get(name).catch(() => null);
      if (!e || e.version > VERSION) return;
      env[name] = e;
      apply(name);
      changed();
    },

    /** Save a Markdown copy in the folder: exports/<id>.md. Resolves the file path. */
    async saveMarkdown(id, text) {
      const path = `exports/${id}.md`;
      const cur = await ws.files.read(path);
      try { await ws.files.write(path, text, cur ? { mtime: cur.mtime } : { create: true }); }
      catch (e) {
        if (e.code !== 'conflict') throw e;
        await ws.files.write(path, text, e.current ? { mtime: e.current.mtime } : { create: true });
      }
      return path;
    }
  };
}

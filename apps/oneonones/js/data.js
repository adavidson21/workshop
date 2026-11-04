/* 1:1s: loading, saving, notes and the optional draft step through the SDK, with no DOM, so Node tests can
   drive it with a fake `ws`. main.js owns the page and repaints through onChange.

   Own collections (all version 1):
     people    the link table: {id, name, links: {docket?, receipts?, queue?}, cadenceDays, archived}
     settings  no items; meta: {aiDraft} (false turns the draft step off)
     handoffs  offers to Receipts (docs/handoffs.md), schema oneonones.handoffs
   Own files: notes/<person folder>/<yyyy-mm-dd>.md, plain Markdown.
   Read only: Docket's tasks and people, Receipts' entries and people, Queue's settings and snapshot, and
   Workshop's people directory (Settings' people). */
import { APP, VERSION, SOURCES, cleanPerson, isoDay, keepRecent, newPersonId, notePath, notesFor, sortPeople } from './model.js';

const OC = 'opencode';
const blank = (name, meta) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {}, ...(meta ? { meta: { updatedAt: 0, ...meta } } : {}) });
const OWN = ['people', 'settings', 'handoffs'];

export function createOneOnOnes(ws, { onChange = () => {}, now = () => Date.now() } = {}) {
  const v = {
    loaded: false,
    waiting: false,          // the browser's folder store needs Allow
    newer: '',               // one of our collections was saved by a newer 1:1s: read only
    people: [],
    settings: { aiDraft: true },
    src: Object.fromEntries(Object.keys(SOURCES).map(k => [k, null])),
    files: [],               // [{path, mtime, size}] under notes/
    oc: false,               // the opencode connector is ready
  };
  const env = {};
  const changed = () => onChange(v);

  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  async function read(name) {
    const e = await ws.data.get(name);
    if (e && e.version > VERSION) { v.newer = name; env[name] = e; return; }
    env[name] = e || blank(name, name === 'settings' ? { aiDraft: true } : null);
  }

  /* The write loop from the data format: stamp, put, and on a conflict merge with what is stored and put again. */
  async function save(name, mutate) {
    if (v.waiting) { const e = new Error('Allow Workshop to use your folder first.'); e.code = 'unavailable'; throw e; }
    if (v.newer === name) { const e = new Error('This was saved by a newer 1:1s. Update Workshop to change it.'); e.code = 'downgrade'; throw e; }
    const before = env[name];
    const after = structuredClone(before);
    mutate(after);
    ws.data.stamp(before, after);
    try {
      const r = await ws.data.put(name, after);
      env[name] = { ...after, rev: r.rev, updatedAt: r.updatedAt };
    } catch (err) {
      if (waitFor(err)) { changed(); throw err; }
      if (err.code !== 'conflict' || !err.current) throw err;
      const next = ws.data.merge(after, err.current);
      const r = await ws.data.put(name, next);
      env[name] = { ...next, rev: r.rev, updatedAt: r.updatedAt };
    }
    fromEnvelopes();
  }

  function fromEnvelopes() {
    v.people = sortPeople((env.people.items || []).map(cleanPerson).filter(p => p.id));
    const m = env.settings.meta || {};
    v.settings = { aiDraft: m.aiDraft !== false };
  }

  /** Another app's collection. Never written. A read failure counts as missing. */
  async function readSource(key) {
    const s = SOURCES[key];
    try { v.src[key] = await ws.data.get(s.collection, { app: s.app }); } catch (e) { if (!waitFor(e)) v.src[key] = null; }
  }

  async function loadFiles() {
    try { v.files = await ws.files.list('notes'); } catch (e) { if (!waitFor(e)) v.files = []; }
  }

  async function loadData() {
    try {
      await Promise.all(OWN.map(read));
      fromEnvelopes();
      v.loaded = true;
    } catch (e) {
      if (!waitFor(e)) throw e;
    }
    await Promise.all([...Object.keys(SOURCES).map(readSource), loadFiles()]);
    changed();
  }

  async function checkConnectors() {
    if (ws.backend !== 'agent') { v.oc = false; return changed(); }
    try {
      const o = (await ws.connectors.list()).find(x => x.id === OC);
      v.oc = !!(o && o.status && o.status.state === 'ready');
    } catch { v.oc = false; }
    changed();
  }

  async function loadAll() {
    const was = v.waiting;
    v.waiting = false;
    await loadData();
    await checkConnectors();
    if (was && !v.waiting) changed();
  }

  /* ---------- people ---------- */

  async function savePerson(input) {
    const id = input.id || newPersonId(now());
    const clean = cleanPerson({ ...input, id });
    await save('people', e => {
      const at = e.items.findIndex(x => x.id === id);
      // Keep fields this version does not know (data-format.md, Migrations, rule 2).
      const row = { ...(at >= 0 ? e.items[at] : {}), ...clean, updatedAt: at >= 0 ? e.items[at].updatedAt : 0 };
      if (at >= 0) e.items[at] = row; else e.items.push(row);
    });
    changed();
    return clean;
  }

  async function saveSettings(next) {
    await save('settings', e => { e.meta = { ...(e.meta || {}), aiDraft: next.aiDraft !== false }; });
    changed();
  }

  /* ---------- notes ---------- */

  const notesOf = personId => notesFor(v.files, personId);
  const readNote = path => ws.files.read(path);

  /** Writes a note. `mtime` is the version read, or null to create. Resolves the new file summary. */
  async function writeNote(path, content, mtime) {
    const r = await ws.files.write(path, content, mtime ? { mtime } : { create: true });
    const at = v.files.findIndex(f => f.path === path);
    const row = { path, mtime: r.mtime, size: r.size };
    if (at >= 0) v.files[at] = row; else v.files.push(row);
    changed();
    return r;
  }

  /* ---------- after the meeting ---------- */

  /** Offers wins to Receipts in our own handoffs collection. Same ids are replaced, never doubled. */
  async function offer(items) {
    if (!items.length) return 0;
    const today = isoDay(new Date(now()));
    await save('handoffs', e => {
      for (const h of items) {
        const at = e.items.findIndex(x => x.id === h.id);
        if (at >= 0) e.items[at] = { ...e.items[at], ...h, updatedAt: e.items[at].updatedAt };
        else e.items.push(h);
      }
      e.items = keepRecent(e.items, today);
    });
    changed();
    return items.length;
  }

  /* ---------- the optional draft step (opencode connector) ---------- */

  const draft = (personId, date, packet) => ws.connectors.call(OC, 'oneonone.draft', { personId, date, packet }, { confirm: true });
  const draftResult = (personId, date) => ws.connectors.call(OC, 'oneonone.result', { personId, date });

  /** Another window wrote one of our collections, or it changed on disk. */
  async function reload(name) {
    try {
      if (OWN.includes(name)) { await read(name); fromEnvelopes(); }
      changed();
    } catch (e) { waitFor(e); }
  }
  async function reloadSource(key) { await readSource(key); changed(); }
  async function reloadFiles() { await loadFiles(); changed(); }

  ws.on('online', p => { if (p && p.online) loadAll(); });

  return { v, loadAll, loadData, checkConnectors, savePerson, saveSettings, notesOf, readNote, writeNote, notePath, offer, draft, draftResult, reload, reloadSource, reloadFiles };
}

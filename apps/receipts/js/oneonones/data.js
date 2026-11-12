/* Rapport's 1:1s: loading, saving, notes and the optional draft step through the SDK, with no DOM, so Node
   tests can drive it with a fake `ws`. page.js owns the 1:1s parts of the page and repaints through onChange.

   Own collections (Rapport's, app id `receipts`, all version 1):
     oneonones/people    who you meet with: {id, personId, name, cadenceDays, archived}. personId is the person in
                         Workshop's people directory; id names their notes folder.
     oneonones/settings  no items; meta: {aiDraft, moved}. aiDraft false turns the draft step off; moved records
                         the copy from the old 1:1s app.
     handoffs            receipts.handoffs: follow-ups sent to Docket as accepted task handoffs (Workshop
                         docs/handoffs.md). Docket reads it; Rapport only adds and trims.
   Own files: oneonones/notes/<person folder>/<yyyy-mm-dd>.md, plain Markdown.
   Read only: Docket's summary. Rapport's own entries and the people directory are handed in with setOwn().

   The first load copies the old 1:1s app's people, settings and notes in (copyLegacy). The old files are never
   changed or removed. */
import { APP, VERSION, SOURCES, PEOPLE, SETTINGS, NOTES, LEGACY, LEGACY_FILES_DAYS, HANDOFFS, cleanPerson, readHandoffs, sentIds, withHandoffs, legacyEnvelope, legacyNotePath, newPersonId, notePath, notesFor, sortPeople } from './model.js';

const OC = 'opencode';
const blank = (name, meta) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {}, ...(meta ? { meta: { updatedAt: 0, ...meta } } : {}) });
const OWN = [PEOPLE, SETTINGS];
const READ = Object.keys(SOURCES).filter(k => !SOURCES[k].own);

export function createOneOnOnes(ws, { onChange = () => {}, now = () => Date.now() } = {}) {
  const v = {
    loaded: false,
    waiting: false,          // the browser's folder store needs Allow
    newer: '',               // one of our collections was saved by a newer Rapport: read only
    people: [],
    dir: null,               // the people directory (ws.people), from main.js
    settings: { aiDraft: true },
    src: Object.fromEntries(Object.keys(SOURCES).map(k => [k, null])),
    files: [],               // [{path, mtime, size}] under oneonones/notes/
    oc: false,               // the opencode connector is ready
    moved: null,             // {at, people, notes} once the old 1:1s data was copied in
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
    env[name] = e || blank(name, name === SETTINGS ? { aiDraft: true } : null);
  }

  /* The write loop from the data format: stamp, put, and on a conflict merge with what is stored and put again. */
  async function save(name, mutate) {
    if (v.waiting) { const e = new Error('Allow Workshop to use your folder first.'); e.code = 'unavailable'; throw e; }
    if (v.newer === name) { const e = new Error('This was saved by a newer Rapport. Update it to change this.'); e.code = 'downgrade'; throw e; }
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
    v.people = sortPeople((env[PEOPLE].items || []).map(cleanPerson).filter(p => p.id));
    const m = env[SETTINGS].meta || {};
    v.settings = { aiDraft: m.aiDraft !== false };
    v.moved = m.moved && typeof m.moved === 'object' ? m.moved : null;
  }

  /* ---------- the copy from the old 1:1s app ----------
     Collections: only when Rapport has none yet (never over Rapport's own). Notes: any old note missing here,
     for LEGACY_FILES_DAYS after the first copy; an existing note is never written over. The old app's data is
     only read. */
  async function copyLegacy() {
    const own = { people: await ws.data.get(PEOPLE), settings: await ws.data.get(SETTINGS) };
    const firstAt = own.settings && own.settings.meta && own.settings.meta.moved && own.settings.meta.moved.at;
    if (firstAt && now() - Date.parse(firstAt) > LEGACY_FILES_DAYS * 864e5) return null;
    let people = 0, notes = 0, copied = false;
    for (const name of ['people', 'settings']) {
      if (own[name]) continue;
      let old = null;
      try { old = legacyEnvelope(await ws.data.get(LEGACY[name], { app: LEGACY.app }), name); } catch { old = null; }
      if (!old) continue;
      try { await ws.data.put(name === 'people' ? PEOPLE : SETTINGS, old); copied = true; if (name === 'people') people = old.items.length; }
      catch (e) { if (e.code !== 'conflict') throw e; } // another window copied it first
    }
    let oldFiles = [];
    try { oldFiles = await ws.files.list(LEGACY.notes, { app: LEGACY.app }); } catch { oldFiles = []; }
    if (oldFiles.length) {
      const have = new Set((await ws.files.list(NOTES)).map(f => f.path));
      for (const f of oldFiles) {
        const to = legacyNotePath(f.path);
        if (!to || have.has(to)) continue;
        const file = await ws.files.read(f.path, { app: LEGACY.app });
        if (!file || typeof file.content !== 'string') continue;
        try { await ws.files.write(to, file.content, { create: true }); notes++; copied = true; }
        catch (e) { if (e.code !== 'conflict') throw e; }
      }
    }
    if (!copied) return null;
    await read(SETTINGS);
    const meta = env[SETTINGS].meta || {};
    const moved = meta.moved && meta.moved.at ? { ...meta.moved, notes: (meta.moved.notes || 0) + notes }
      : { at: new Date(now()).toISOString(), people, notes };
    await read(PEOPLE);
    fromEnvelopes();
    await save(SETTINGS, e => { e.meta = { ...(e.meta || {}), moved }; });
    return { people, notes, first: !firstAt };
  }

  /** Another app's collection. Never written. A read failure counts as missing. */
  async function readSource(key) {
    const s = SOURCES[key];
    try { v.src[key] = await ws.data.get(s.collection, { app: s.app }); } catch (e) { if (!waitFor(e)) v.src[key] = null; }
  }

  async function loadFiles() {
    try { v.files = await ws.files.list(NOTES); } catch (e) { if (!waitFor(e)) v.files = []; }
  }

  let lastCopy = null;
  async function loadData() {
    try {
      try { lastCopy = await copyLegacy(); } catch (e) { if (waitFor(e)) throw e; lastCopy = null; }
      await Promise.all(OWN.map(read));
      fromEnvelopes();
      v.loaded = true;
    } catch (e) {
      if (!waitFor(e)) throw e;
    }
    await Promise.all([...READ.map(readSource), loadFiles()]);
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
    return lastCopy;
  }

  /** Rapport's own entries envelope and the people directory, from main.js. */
  function setOwn(entries, dir) {
    v.src.receiptsEntries = entries || null;
    v.dir = dir || null;
  }

  /* ---------- people ---------- */

  async function savePerson(input) {
    const id = input.id || newPersonId(now());
    const clean = cleanPerson({ ...input, id });
    await save(PEOPLE, e => {
      const at = e.items.findIndex(x => x.id === id);
      // Keep fields this version does not know (data-format.md, Migrations, rule 2).
      const row = { ...(at >= 0 ? e.items[at] : {}), ...clean, updatedAt: at >= 0 ? e.items[at].updatedAt : 0 };
      if (at >= 0) e.items[at] = row; else e.items.push(row);
    });
    changed();
    return clean;
  }

  async function saveSettings(next) {
    await save(SETTINGS, e => { e.meta = { ...(e.meta || {}), aiDraft: next.aiDraft !== false }; });
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

  /* ---------- the optional draft step (opencode connector) ---------- */

  const draft = (personId, date, packet) => ws.connectors.call(OC, 'oneonone.draft', { personId, date, packet }, { confirm: true });
  const draftResult = (personId, date) => ws.connectors.call(OC, 'oneonone.result', { personId, date });

  /* ---------- follow-ups to Docket (receipts.handoffs, Workshop docs/handoffs.md) ---------- */

  /** Ids of follow-ups already sent. An unreadable collection counts as none sent. */
  async function sentHandoffs() {
    try { return sentIds(readHandoffs(await ws.data.get(HANDOFFS))); } catch { return new Set(); }
  }

  /** Adds handoff items (ids already there are skipped). Resolves how many were new. */
  async function sendHandoffs(items) {
    if (!items.length) return 0;
    for (let tries = 0; ; tries++) {
      const before = readHandoffs(await ws.data.get(HANDOFFS));
      if (!before) { const e = new Error('A newer Rapport saved your Docket follow-ups. Update Workshop to send more.'); e.code = 'downgrade'; throw e; }
      const have = sentIds(before);
      const fresh = items.filter(i => !have.has(i.id));
      if (!fresh.length) return 0;
      const after = withHandoffs(before, fresh, now());
      ws.data.stamp(before, after);
      try { await ws.data.put(HANDOFFS, after); return fresh.length; }
      catch (e) { if (e.code !== 'conflict' || tries >= 2) throw e; }
    }
  }

  /* ---------- Tidy notes (opencode connector) ---------- */

  const tidy = (personId, date, notes) => ws.connectors.call(OC, 'oneonone.tidy', { personId, date, notes }, { confirm: true });
  const tidyResult = (personId, date) => ws.connectors.call(OC, 'oneonone.tidyResult', { personId, date });

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

  return { v, loadAll, loadData, checkConnectors, setOwn, savePerson, saveSettings, notesOf, readNote, writeNote, notePath, draft, draftResult, tidy, tidyResult, sentHandoffs, sendHandoffs, reload, reloadSource, reloadFiles, READ };
}

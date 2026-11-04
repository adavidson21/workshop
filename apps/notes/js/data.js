/* Notes: everything that touches the Workshop folder, through ws.files only.

   The folder is the truth. On open, every note of the app is read; the index is built in memory and kept
   current from file events, so edits made in another window or another editor show up. Images are read
   only when a note shows them, as Blobs, and turned into blob: URLs that are revoked when they change.

   Saving: the open note is written with the mtime it was read at. A conflict never overwrites: the caller
   decides (load theirs, save mine as a copy, or overwrite). Other failures keep the text and retry. */
import { APP, ATTACHMENTS, buildIndex, freePath, isImagePath, isNote, slugify } from './model.js';

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const READ_BATCH = 8;

export function createNotes(ws, { onChange = () => {}, onExternal = () => {} } = {}) {
  const files = new Map();     // path -> {mtime, size} for every file of the app (notes and images)
  const texts = new Map();     // note path -> {content, mtime}
  const images = new Map();    // image path -> {mtime, url}
  let index = buildIndex([]);
  let loaded = false;
  let error = '';
  const others = [];           // [{app, path}] .md files of other apps, read only

  function rebuild() {
    index = buildIndex([...texts].map(([path, t]) => ({ path, content: t.content, mtime: t.mtime, size: files.get(path)?.size || 0 })));
    onChange();
  }

  async function readNote(path) {
    const f = await ws.files.read(path);
    if (!f) { texts.delete(path); files.delete(path); return null; }
    files.set(path, { mtime: f.mtime, size: f.size });
    texts.set(path, { content: f.content, mtime: f.mtime });
    return f;
  }

  async function load() {
    error = '';
    try {
      const list = await ws.files.list();
      files.clear();
      for (const f of list) files.set(f.path, { mtime: f.mtime, size: f.size });
      const notes = list.filter(f => isNote(f.path));
      for (const p of [...texts.keys()]) if (!files.has(p)) texts.delete(p);
      for (let i = 0; i < notes.length; i += READ_BATCH) {
        await Promise.all(notes.slice(i, i + READ_BATCH).map(async (f) => {
          const have = texts.get(f.path);
          if (have && have.mtime === f.mtime) return;
          try { await readNote(f.path); } catch (e) { if (e.code !== 'too_large') throw e; }
        }));
      }
      loaded = true;
    } catch (e) {
      error = e && e.message ? e.message : 'Workshop could not read your notes.';
    }
    rebuild();
  }

  // Changes by anyone else: another window, another app, or a program outside Workshop.
  ws.files.subscribe('', async (ev) => {
    const path = ev.path;
    if (ev.mtime === null) {
      files.delete(path); texts.delete(path); dropImage(path);
      rebuild(); onExternal({ path, gone: true });
      return;
    }
    if (isImagePath(path)) { files.set(path, { mtime: ev.mtime, size: 0 }); dropImage(path); onChange(); return; }
    if (!isNote(path)) return;
    try { await readNote(path); } catch { return; }
    rebuild(); onExternal({ path, gone: false });
  });

  async function loadOthers(apps) {
    others.length = 0;
    for (const app of apps) {
      if (app === APP) continue;
      try {
        for (const f of await ws.files.list(undefined, { app })) if (isNote(f.path)) others.push({ app, path: f.path });
      } catch { /* that app has no files, or cannot be read */ }
    }
    onChange();
  }

  /* -- notes -- */

  async function create(path, content) {
    const r = await ws.files.write(path, content, { create: true });
    files.set(path, { mtime: r.mtime, size: r.size });
    texts.set(path, { content, mtime: r.mtime });
    rebuild();
    return r;
  }

  /** Save with the mtime the text was read at. Resolves {mtime}; rejects with the SDK's error (conflict has .current). */
  async function save(path, content, mtime) {
    const r = await ws.files.write(path, content, { mtime });
    files.set(path, { mtime: r.mtime, size: r.size });
    texts.set(path, { content, mtime: r.mtime });
    rebuild();
    return r;
  }

  async function trash(path) {
    const t = texts.get(path) || files.get(path);
    const r = await ws.files.trash(path, t ? { mtime: t.mtime } : undefined);
    files.delete(path); texts.delete(path); dropImage(path);
    rebuild();
    return r;
  }

  /** Read one note again after a write made here outside the editor (Quick Notes pickup), and rebuild. */
  async function refresh(path) { const f = await readNote(path); rebuild(); return f; }

  /** Read another app's note (read only). */
  async function readOther(app, path) { return ws.files.read(path, { app }); }

  /* -- images -- */

  function dropImage(path) {
    const hit = images.get(path);
    if (hit && hit.url) URL.revokeObjectURL(hit.url);
    images.delete(path);
  }

  /** A blob: URL for an image in the folder, or null if there is none. */
  async function imageUrl(path) {
    const known = files.get(path);
    if (!known) return null;
    const hit = images.get(path);
    if (hit && hit.mtime === known.mtime) return hit.url;
    const f = await ws.files.read(path);
    if (!f) { files.delete(path); return null; }
    dropImage(path);
    const url = URL.createObjectURL(f.content);
    images.set(path, { mtime: f.mtime, url });
    return url;
  }

  /** Save an image the user pasted or dropped. Resolves its path in the app folder. */
  async function addImage(blob, nameHint = 'image', now = new Date()) {
    const ext = IMAGE_TYPES[blob.type];
    if (!ext) throw Object.assign(new Error('Only PNG, JPEG, GIF and WebP images can go in a note.'), { code: 'bad_request' });
    const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const base = slugify(String(nameHint).replace(/\.[a-z0-9]+$/i, ''), 'image').slice(0, 24).replace(/-+$/, '');
    const path = freePath(new Set(files.keys()), ATTACHMENTS, `${base}-${stamp}`.slice(0, 40), ext);
    const r = await ws.files.write(path, blob, { create: true });
    files.set(path, { mtime: r.mtime, size: r.size });
    onChange();
    return path;
  }

  return {
    load, loadOthers, readNote, refresh, create, save, trash, readOther, imageUrl, addImage,
    get index() { return index; },
    get loaded() { return loaded; },
    get error() { return error; },
    files, texts, others,
    contents() { return new Map([...texts].map(([p, t]) => [p, t.content])); }
  };
}

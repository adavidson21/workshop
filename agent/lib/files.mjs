// The files API (docs/agent-api.md, Files): plain .md and .json files in the data folder that are not collections.
// Conflicts are found by modified time. Delete moves to <dataDir>/.trash/ and never removes anything.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic, renameWithRetry } from './fsutil.mjs';
import { fail } from './http.mjs';
import { FILE_MAX, floorMs, isCollectionText, lexists, trashStamp } from './datapath.mjs';

// If the file system would give a new file the same modified time as before (a coarse clock, or one that went
// back), the agent moves it forward by the smallest of these steps that the file system keeps.
const BUMP_MS = [1, 2, 5, 10, 100, 1000, 2000];

export class Files {
  #root; #schemas; #log; #lock; #tracker;

  constructor({ root, schemas, log, lock, tracker }) {
    this.#root = root;
    this.#schemas = schemas;
    this.#log = log;
    this.#lock = lock;
    this.#tracker = tracker;
  }

  /** Files of one app, or of one folder in it, at every depth, sorted by path. Collections are left out. */
  async list(app, folder) {
    const out = [];
    for (const { rel, abs, stat } of await this.#root.walk(app, folder)) {
      const full = `${app}/${rel}`;
      if (rel.endsWith('.json') && stat.size <= FILE_MAX) {
        let text;
        try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
        if (isCollectionText(full, text)) { this.#tracker.kind(full, 'collection'); continue; }
        this.#tracker.kind(full, 'file');
      }
      out.push({ path: rel, mtime: floorMs(stat), size: stat.size });
    }
    return out;
  }

  /**
   * The file as {app, path, mtime, size, content}, or null if it does not exist. A file over 10 MB comes back
   * with `tooLarge: true` and empty content. A collection is refused with 400.
   */
  async #current(app, fpath, file) {
    const rel = `${app}/${fpath}`;
    let st;
    try { st = await fsp.stat(file); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
      this.#log.error(`Could not read ${rel}: ${e.code || e.message}`);
      fail('internal', `Workshop could not read ${fpath}.`);
    }
    if (!st.isFile()) fail('bad_request', `${fpath} is a folder, not a file.`);
    const view = { app, path: fpath, mtime: floorMs(st), size: st.size };
    if (st.size > FILE_MAX) return { ...view, content: '', tooLarge: true };
    let content;
    try { content = await fsp.readFile(file, 'utf8'); } catch (e) {
      this.#log.error(`Could not read ${rel}: ${e.code || e.message}`);
      fail('internal', `Workshop could not read ${fpath}.`);
    }
    if (isCollectionText(rel, content)) {
      this.#tracker.kind(rel, 'collection');
      fail('bad_request', `${fpath} is a collection. Use the data API for it.`);
    }
    this.#tracker.kind(rel, 'file');
    return { ...view, content };
  }

  /** The view of a file for a conflict body: the file schema, without the internal flag. */
  static #plain(cur) {
    if (!cur) return null;
    const { tooLarge, ...rest } = cur;
    return rest;
  }

  async read(app, fpath) {
    const cur = await this.#current(app, fpath, this.#root.inside(`${app}/${fpath}`));
    if (!cur) fail('not_found', `${app} has no file ${fpath}.`);
    if (cur.tooLarge) fail('too_large', `${fpath} is larger than 10 MB, so Workshop does not read it.`);
    return Files.#plain(cur);
  }

  /** Create (body.create) or replace (body.mtime) a file. Returns {app, path, mtime, size}. */
  put(app, fpath, body) {
    const rel = `${app}/${fpath}`;
    const file = this.#root.inside(rel);
    const errs = this.#schemas.validate('file-put', body);
    if (errs.length) fail('bad_request', `Send {"content": "...", "mtime": <the mtime you read>} or {"content": "...", "create": true}: ${errs[0]}`);
    const size = Buffer.byteLength(body.content, 'utf8');
    if (size > FILE_MAX) fail('too_large', 'A file can be at most 10 MB.');
    if (fpath.endsWith('.json')) {
      try { JSON.parse(body.content); } catch { fail('bad_request', `${fpath} must hold valid JSON.`); }
      if (isCollectionText(rel, body.content)) fail('bad_request', 'That content is a collection for this path. Save it with the data API instead.');
    }
    return this.#lock.run(rel, async () => {
      const cur = await this.#current(app, fpath, file);
      if (body.create) {
        if (cur) fail('conflict', `${fpath} already exists.`, { current: Files.#plain(cur) });
      } else if (!cur) {
        fail('conflict', 'That file is gone. It may have been moved to the trash.', { current: null });
      } else if (cur.mtime !== body.mtime) {
        fail('conflict', 'That file changed since you loaded it. Reload and try again.', { current: Files.#plain(cur) });
      }
      let mtime;
      try { mtime = await this.#write(rel, file, body.content, cur ? cur.mtime : null); } catch (e) {
        this.#log.error(`Could not write ${rel}: ${e.code || e.message}`);
        fail('internal', `Workshop could not save ${fpath}. The previous version is unchanged.`);
      }
      this.#tracker.kind(rel, 'file');
      return { app, path: fpath, mtime, size };
    });
  }

  /** Atomic write, then make sure the modified time differs from the one before. Returns the new mtime. */
  async #write(rel, file, text, prev) {
    await writeFileAtomic(file, text);
    let mt = floorMs(fs.statSync(file));
    for (const step of BUMP_MS) {
      if (prev === null || mt > prev) break;
      const t = new Date(prev + step);
      fs.utimesSync(file, t, t);
      mt = floorMs(fs.statSync(file));
    }
    this.#tracker.own(rel, mt);
    return mt;
  }

  /** Move a file to the trash. `mtime` (number or null) must match if given. Returns {app, path, trash}. */
  trash(app, fpath, mtime) {
    const rel = `${app}/${fpath}`;
    const file = this.#root.inside(rel);
    return this.#lock.run(rel, async () => {
      const cur = await this.#current(app, fpath, file);
      if (!cur) fail('not_found', `${app} has no file ${fpath}.`);
      if (mtime !== null && cur.mtime !== mtime) fail('conflict', 'That file changed since you loaded it. Reload and try again.', { current: Files.#plain(cur) });
      const m = /^(.*)\.(md|json)$/.exec(rel);
      const base = `.trash/${m[1]}.${trashStamp()}`;
      let dest = `${base}.${m[2]}`;
      for (let i = 1; lexists(this.#root.abs(dest)); i++) dest = `${base}-${i}.${m[2]}`;
      const abs = this.#root.abs(dest);
      try {
        if (!this.#root.contains(abs)) throw Object.assign(new Error('the trash folder leads outside the data folder'), { code: 'EOUTSIDE' });
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        this.#tracker.own(rel, 'gone');
        await renameWithRetry(file, abs);
      } catch (e) {
        this.#tracker.forget(rel);
        this.#log.error(`Could not move ${rel} to the trash: ${e.code || e.message}`);
        fail('internal', `Workshop could not move ${fpath} to the trash. It is unchanged.`);
      }
      return { app, path: fpath, trash: dest };
    });
  }
}

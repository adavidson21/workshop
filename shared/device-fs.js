/* Device storage for the Android app (docs/run-modes.md, Device store).

   In the Android app (android/, built with Capacitor) there is no agent and no Chrome folder picker, but the
   app may write files in its own private storage on the phone. This module makes that storage look like a
   folder picked in Chrome (a FileSystemDirectoryHandle with the few methods the SDK's folder store uses), so
   the folder store runs on it unchanged: the same layout, rev checks, trash, backups and change checks.

   Files live in the app's private data folder, under workshop/ (<app>/<collection>.json and so on). Nothing
   leaves the phone. Android removes them only when the app is uninstalled or its data is cleared.

   It talks to Capacitor's Filesystem plugin through the native bridge (window.Capacitor.nativePromise), so
   there is no bundler and no Capacitor JavaScript to load. Tests pass their own `call` (fake-capacitor.mjs).

     import { deviceAvailable, openDeviceRoot } from './device-fs.js';
     if (deviceAvailable()) root = await openDeviceRoot();   // pass root to makeFolderStore

   Writes are atomic: the content goes to a hidden temporary file next to the target, which then replaces
   the target. If the app stops between removing the old file and renaming the new one, the next read finds
   the temporary file and puts it in place, so a write is never half done. */

const DIRECTORY = 'DATA';   // Capacitor's Directory.Data: the app's private files folder
const ENCODING = 'utf8';
const BASE = 'workshop';
const TMP_PREFIX = '.';
const TMP_SUFFIX = '.workshop-tmp';
const STALE_TMP_MS = 10_000; // a temporary file this old belongs to a write that stopped, not one in progress

const domError = (name, message) => {
  const e = new Error(message || name);
  e.name = name;
  return e;
};
// Capacitor's "does not exist" error (OS-PLUG-FILE-0008), whatever the message says.
const notThere = (e) => !!e && (e.code === 'OS-PLUG-FILE-0008' || /does not exist|not exist|no such file/i.test(e.message || String(e)));

function nativeCall(method, options) {
  return window.Capacitor.nativePromise('Filesystem', method, options);
}

/** True in the Android (or iOS) app built from android/, where the Filesystem plugin is there. */
export function deviceAvailable(win = typeof window !== 'undefined' ? window : null) {
  const cap = win && win.Capacitor;
  if (!cap || typeof cap.nativePromise !== 'function') return false;
  try { if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return false; } catch (e) { return false; }
  const headers = cap.PluginHeaders;
  return !Array.isArray(headers) || headers.some(h => h && h.name === 'Filesystem');
}

/**
 * The device folder, made if missing. Resolves to a directory handle for the folder store.
 * @param {{call?: (method: string, options: object) => Promise<any>, base?: string, name?: string, now?: () => number}} [o]
 */
export async function openDeviceRoot(o = {}) {
  const fs = makeFs(o.call || nativeCall, o.now || (() => Date.now()));
  const base = o.base === undefined ? BASE : o.base;
  if (base) {
    try { await fs.call('mkdir', { path: base, directory: DIRECTORY, recursive: true }); }
    catch (e) { if (!(await fs.stat(base))) throw e; } // "already exists" is fine
  }
  return deviceRoot(Object.assign({}, o, { base }));
}

/** The device folder without making it (tests, and openDeviceRoot once the folder is there). */
export function deviceRoot(o = {}) {
  const base = o.base === undefined ? BASE : o.base;
  return new DeviceDir(makeFs(o.call || nativeCall, o.now || (() => Date.now())), base, o.name || 'this device');
}

function makeFs(call, now) {
  const join = (...parts) => parts.filter(Boolean).join('/');
  return {
    call, now, join,
    // {type, size, mtime} or null when nothing is there.
    async stat(path) {
      try { return await call('stat', { path, directory: DIRECTORY }); }
      catch (e) { if (notThere(e)) return null; throw e; }
    },
    async read(path) {
      try { return (await call('readFile', { path, directory: DIRECTORY, encoding: ENCODING })).data; }
      catch (e) { if (notThere(e)) throw domError('NotFoundError'); throw e; }
    },
    write(path, data) { return call('writeFile', { path, directory: DIRECTORY, data, encoding: ENCODING, recursive: false }); },
    remove(path) { return call('deleteFile', { path, directory: DIRECTORY }); },
    rename(from, to) { return call('rename', { from, to, directory: DIRECTORY, toDirectory: DIRECTORY }); },
    mkdir(path) { return call('mkdir', { path, directory: DIRECTORY, recursive: false }); },
    async list(path) {
      try { return (await call('readdir', { path, directory: DIRECTORY })).files || []; }
      catch (e) { if (notThere(e)) throw domError('NotFoundError'); throw e; }
    }
  };
}

const isDir = (st) => st && st.type === 'directory';
const tmpName = (name) => TMP_PREFIX + name + TMP_SUFFIX;

class DeviceDir {
  constructor(fs, path, name) { this.fs = fs; this.path = path; this.kind = 'directory'; this.name = name; }
  async queryPermission() { return 'granted'; }   // the app's own storage needs no permission
  async requestPermission() { return 'granted'; }
  async #alive() {
    if (this.path && !isDir(await this.fs.stat(this.path))) throw domError('NotFoundError', 'A requested file or directory could not be found.');
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    await this.#alive();
    const path = this.fs.join(this.path, name);
    const st = await this.fs.stat(path);
    if (st && !isDir(st)) throw domError('TypeMismatchError', 'That is a file.');
    if (!st) {
      if (!create) throw domError('NotFoundError');
      try { await this.fs.mkdir(path); } catch (e) { if (!isDir(await this.fs.stat(path))) throw e; }
    }
    return new DeviceDir(this.fs, path, name);
  }
  async getFileHandle(name, { create = false } = {}) {
    await this.#alive();
    const path = this.fs.join(this.path, name);
    let st = await this.fs.stat(path);
    if (st && isDir(st)) throw domError('TypeMismatchError', 'That is a folder.');
    if (!st && await this.#recover(name)) st = await this.fs.stat(path);
    if (!st) {
      if (!create) throw domError('NotFoundError');
      await this.fs.write(path, '');
    }
    return new DeviceFile(this.fs, this, name);
  }
  // A write that stopped after removing the old file: put its new content in place.
  async #recover(name) {
    const tmp = this.fs.join(this.path, tmpName(name));
    const st = await this.fs.stat(tmp);
    if (!st || isDir(st) || this.fs.now() - st.mtime < STALE_TMP_MS) return false;
    try { await this.fs.rename(tmp, this.fs.join(this.path, name)); return true; } catch (e) { return false; }
  }
  async removeEntry(name) {
    await this.#alive();
    const path = this.fs.join(this.path, name);
    const st = await this.fs.stat(path);
    if (!st) throw domError('NotFoundError');
    if (isDir(st)) throw domError('InvalidModificationError', 'Workshop never removes folders.');
    await this.fs.remove(path);
  }
  async *entries() {
    await this.#alive();
    const files = await this.fs.list(this.path);
    for (const f of files) {
      if (f.name.endsWith(TMP_SUFFIX)) continue; // a write in progress, not a file of Workshop's
      yield [f.name, f.type === 'directory' ? new DeviceDir(this.fs, this.fs.join(this.path, f.name), f.name) : new DeviceFile(this.fs, this, f.name)];
    }
  }
  async *values() { for await (const [, h] of this.entries()) yield h; }
  async *keys() { for await (const [k] of this.entries()) yield k; }
}

const READ_TRIES = 4;

class DeviceFile {
  constructor(fs, dir, name) { this.fs = fs; this.dir = dir; this.name = name; this.kind = 'file'; }
  get #path() { return this.fs.join(this.dir.path, this.name); }
  // {name, size, lastModified, type, text()} taken at one moment: the content and its modified time agree.
  async getFile() {
    for (let i = 0; ; i++) {
      const before = await this.fs.stat(this.#path);
      if (!before || isDir(before)) throw domError('NotFoundError');
      const content = await this.fs.read(this.#path);
      const after = await this.fs.stat(this.#path);
      if (after && !isDir(after) && after.mtime === before.mtime) {
        return { name: this.name, size: after.size, lastModified: after.mtime, type: '', text: async () => content };
      }
      if (i >= READ_TRIES) throw domError('InvalidStateError', 'That file keeps changing.');
    }
  }
  async createWritable() {
    const file = this, chunks = [];
    let closed = false;
    return {
      async write(data) {
        if (closed) throw domError('InvalidStateError');
        chunks.push(typeof data === 'string' ? data : await data.text());
      },
      async close() {
        if (closed) throw domError('InvalidStateError');
        closed = true;
        await file.#replace(chunks.join(''));
      },
      async abort() { closed = true; }
    };
  }
  // Write next to the target, then swap it in: the target is the old content or the new, never part of one.
  async #replace(content) {
    const target = this.#path;
    const tmp = this.fs.join(this.dir.path, tmpName(this.name));
    await this.fs.write(tmp, content);
    try { await this.fs.rename(tmp, target); return; }
    catch (e) { if (!(await this.fs.stat(target))) { await this.#cleanup(tmp); throw e; } }
    // Some file systems will not rename over an existing file: remove it first, then rename.
    await this.fs.remove(target);
    await this.fs.rename(tmp, target);
  }
  async #cleanup(tmp) { try { await this.fs.remove(tmp); } catch (e) { /* already gone */ } }
}

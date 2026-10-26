// Changes made outside Workshop (docs/agent-api.md, GET /api/events, Changes made outside Workshop).
// The agent watches the data folder and sends a "re-read" event (client null) for each collection or file that
// something else changed, added or removed. Events are debounced per path. Changes the agent made itself are
// recorded by the Tracker and do not cause an event.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FILE_MAX, floorMs, isCollectionText, isInside, isVisible, realpath } from './datapath.mjs';

export const DEBOUNCE_MS = 300;

/**
 * Remembers, per path relative to the data folder ("<app>/<path>.<ext>"):
 * - the modified time the agent's own last write left (or 'gone' after a move to the trash), so the watcher can
 *   tell its own changes from outside ones;
 * - whether the path was last known as a collection or a file, so a removed .json is reported as what it was.
 */
export class Tracker {
  #own = new Map();
  #kinds = new Map();

  own(rel, mtimeOrGone) { this.#own.set(rel, mtimeOrGone); }
  forget(rel) { this.#own.delete(rel); }
  /** True if the path is exactly as the agent's own last write left it. */
  isOwn(rel, mtimeOrGone) { return this.#own.has(rel) && this.#own.get(rel) === mtimeOrGone; }
  kind(rel, k) { if (k) this.#kinds.set(rel, k); return this.#kinds.get(rel); }
}

export class FolderWatch {
  #root; #tracker; #events; #log;
  #watcher = null;
  #timers = new Map();
  #stopped = false;

  constructor({ root, tracker, events, log }) {
    this.#root = root;
    this.#tracker = tracker;
    this.#events = events;
    this.#log = log;
  }

  /** Start watching. Best effort: a folder that cannot be watched is logged and the agent runs on. */
  start() {
    try {
      // Watch where the folder really is, so a data folder that is a link works on every platform.
      this.#watcher = fs.watch(this.#root.real, { recursive: true, persistent: false }, (type, filename) => this.#onChange(filename));
      this.#watcher.on('error', e => this.#log.warn(`Watching the data folder stopped: ${e.code || e.message}. Changes made outside Workshop will not be announced until the agent restarts.`));
    } catch (e) {
      this.#log.warn(`Cannot watch the data folder: ${e.code || e.message}. Changes made outside Workshop will not be announced.`);
    }
    this.#primeKinds().catch(() => {});
  }

  stop() {
    this.#stopped = true;
    try { this.#watcher?.close(); } catch { /* already closed */ }
    for (const t of this.#timers.values()) clearTimeout(t);
    this.#timers.clear();
  }

  #onChange(filename) {
    if (this.#stopped || !filename) return;
    const rel = String(filename).split(path.sep).join('/');
    // Ignored names (dot files and folders, including .trash and .backups) and temp files send nothing.
    if (rel.split('/').some(g => g.startsWith('.')) || rel.endsWith('.tmp')) return;
    if (!isVisible(rel)) return;
    clearTimeout(this.#timers.get(rel));
    const t = setTimeout(() => { this.#timers.delete(rel); this.#settled(rel).catch(e => this.#log.warn(`Could not check a change to ${rel}: ${e.message}`)); }, DEBOUNCE_MS);
    t.unref();
    this.#timers.set(rel, t);
  }

  /** The path has had no change for DEBOUNCE_MS: announce it unless it is as the agent's own write left it. */
  async #settled(rel) {
    if (this.#stopped) return;
    const abs = this.#root.abs(rel);
    let st = null;
    try { st = await fsp.stat(abs); } catch { /* removed */ }
    if (st && !st.isFile()) return;
    if (st) {
      let real;
      try { real = realpath(abs); } catch { return; }
      if (!isInside(real, this.#root.real)) return;
    }
    const now = st ? floorMs(st) : 'gone';
    if (this.#tracker.isOwn(rel, now)) return;
    this.#tracker.forget(rel);

    let kind = this.#tracker.kind(rel) || 'file';
    if (rel.endsWith('.json') && st && st.size <= FILE_MAX) {
      let text = '';
      try { text = await fsp.readFile(abs, 'utf8'); } catch { /* unreadable: keep the last known kind */ }
      kind = isCollectionText(rel, text) ? 'collection' : 'file';
    } else if (!rel.endsWith('.json')) kind = 'file';
    this.#tracker.kind(rel, kind);

    const [app, ...rest] = rel.split('/');
    const name = rest.join('/');
    if (kind === 'collection') this.#events.send('data', { app, collection: name.slice(0, -5), rev: null, updatedAt: null, client: null });
    else this.#events.send('file', { app, path: name, mtime: st ? now : null, client: null });
  }

  /** Learn which .json files are collections, so one removed before the agent ever read it is reported right. */
  async #primeKinds() {
    for (const app of this.#root.apps()) {
      for (const { rel, abs, stat } of await this.#root.walk(app)) {
        if (this.#stopped) return;
        const full = `${app}/${rel}`;
        if (this.#tracker.kind(full)) continue;
        if (!rel.endsWith('.json')) { this.#tracker.kind(full, 'file'); continue; }
        if (stat.size > FILE_MAX) continue;
        let text;
        try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
        if (!this.#tracker.kind(full)) this.#tracker.kind(full, isCollectionText(full, text) ? 'collection' : 'file');
      }
    }
  }
}

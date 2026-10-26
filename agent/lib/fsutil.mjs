// File helpers: atomic writes (temp file, flush, rename) and a per-key lock so two writes to the same file
// never interleave. Used for config.json, the token, app data, app files and connector storage.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Write `text` to `file` atomically: write `<file>.tmp` in the same folder, flush it, then rename it over
 * `file`. A failed write never loses the previous file. On Windows a rename can fail for a moment while
 * another program (for example a virus scanner) has the file open, so the rename is retried briefly.
 */
export async function writeFileAtomic(file, text, { mode } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const handle = await fsp.open(tmp, 'w', mode);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (e) {
      if (!RETRY_CODES.has(e.code) || attempt >= 9) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
      await sleep(20 * (attempt + 1));
    }
  }
}

/**
 * Rename `from` to `to`, retrying briefly when Windows reports the file busy (a virus scanner or indexer may
 * hold it open for a moment), as writeFileAtomic does.
 */
export async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      if (!RETRY_CODES.has(e.code) || attempt >= 9) throw e;
      await sleep(20 * (attempt + 1));
    }
  }
}

/** Write a JSON value pretty-printed with 2 spaces, atomically. */
export const writeJsonAtomic = (file, value, opts) => writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, opts);

/** Delete every leftover `*.tmp` file under `dir`, recursively. Returns the deleted paths. */
export function removeTmpFiles(dir) {
  const removed = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return removed; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) removed.push(...removeTmpFiles(p));
    else if (e.name.endsWith('.tmp')) { try { fs.rmSync(p, { force: true }); removed.push(p); } catch { /* left for next start */ } }
  }
  return removed;
}

/** Runs async functions one at a time per key, in the order they were queued. */
export class KeyedLock {
  #tails = new Map();

  run(key, fn) {
    const prev = this.#tails.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.#tails.set(key, tail);
    tail.then(() => { if (this.#tails.get(key) === tail) this.#tails.delete(key); });
    return next;
  }
}

// The data folder, readable without Workshop (docs/data-format.md, Readable without Workshop):
// - README.md at the top of the data folder, saying what each folder is;
// - a readable copy: every collection as a .csv (opens in Excel) and a .md, and every plain file copied, in
//   "<dataDir>/Readable copy/<App name>/". The folder name breaks the name rules, so Workshop never reads it.
// Reads collections only to write the copy; never changes them.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic, DATA_MODES } from './fsutil.mjs';

export const README = 'README.md';
export const COPY_DIR = 'Readable copy';
/** The first line of a README Workshop wrote. A README without it is the user's, and is left alone. */
export const MARK = '<!-- Written by Workshop. Delete this line to keep your own version of this file. -->';

/**
 * README.md for the data folder. `apps`: [{id, name, folder}] for the apps in this install.
 */
export function readmeText(apps) {
  const rows = apps.map(a => `| \`${a.folder}/\` | ${a.name} |`).join('\n');
  return `${MARK}
# Workshop data

This folder is yours. Workshop keeps everything it saves here, one folder per app, and keeps nothing of yours anywhere else. If you remove Workshop, this folder stays.

## What is where

| Folder | App |
| --- | --- |
${rows}
| \`${COPY_DIR}/\` | A copy of everything as spreadsheets (.csv) and documents (.md), made from Settings, Data or with \`workshop export --readable\` |
| \`.trash/\` | Files you deleted in Workshop. Workshop never empties it; delete what you no longer need |
| \`.backups/\` | Copies Workshop kept before it changed a file's format |
| \`.scratch/\` | Working files handed to opencode for one run. Removed 7 days after they last changed |

Folders starting with \`.\` are hidden on most computers.

## The files

- **\`.md\` files** are plain text notes (Markdown). Open them in any text editor, or in an app like Obsidian.
- **\`.json\` files** hold an app's records: \`items\` is the list, each with an \`id\`. Easiest to read in the readable copy. To edit one by hand, close Workshop first.
- **Images** are ordinary .png, .jpg, .gif or .webp files.

Nothing in this folder is uploaded by Workshop. If the folder is inside OneDrive, Dropbox, iCloud Drive or Google Drive, that service uploads it.
`;
}

/** Write README.md unless the user has their own (no MARK line). Returns 'written', 'same' or 'kept'. */
export async function writeReadme(dataDir, apps) {
  const file = path.join(dataDir, README);
  const text = readmeText(apps);
  let cur = null;
  try { cur = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (cur !== null && !cur.startsWith(MARK)) return 'kept';
  if (cur === text) return 'same';
  await writeFileAtomic(file, text, DATA_MODES);
  return 'written';
}

/* -- the readable copy -- */

const LABEL_KEYS = ['title', 'name', 'text', 'label', 'summary'];
const SKIP_KEYS = new Set(['id', 'updatedAt']);

/** A cell value as text: dates from millisecond stamps, objects and lists as compact JSON. */
export function cellText(key, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && /(At|At_|Date|date|time)$/.test(key) && v > 1e12 && v < 1e13) return new Date(v).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** RFC 4180 CSV, with a byte order mark so Excel reads UTF-8. */
export function toCsv(items) {
  const cols = [];
  for (const it of items) for (const k of Object.keys(it)) if (!cols.includes(k)) cols.push(k);
  const q = s => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [cols.map(q).join(','), ...items.map(it => cols.map(c => q(cellText(c, it[c]))).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

const oneLine = s => String(s).replace(/\s+/g, ' ').trim();

/** One Markdown section per item: a heading from its title (or name, text...), then its other fields. */
export function toMarkdown(title, env) {
  const out = [`# ${title}`, ''];
  const items = Array.isArray(env.items) ? env.items : [];
  if (!items.length) out.push('Nothing here yet.', '');
  for (const it of items) {
    const key = LABEL_KEYS.find(k => typeof it[k] === 'string' && it[k].trim());
    out.push(`## ${key ? oneLine(it[key]).slice(0, 120) : it.id}`, '');
    for (const [k, v] of Object.entries(it)) {
      if (SKIP_KEYS.has(k) || k === key || v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      const t = cellText(k, v);
      out.push(t.includes('\n') ? `- **${k}:**\n\n  ${t.split('\n').join('\n  ')}\n` : `- **${k}:** ${t}`);
    }
    out.push('');
  }
  if (env.meta && Object.keys(env.meta).some(k => k !== 'updatedAt')) out.push('## Settings', '', '```json', JSON.stringify(env.meta, null, 2), '```', '');
  return `${out.join('\n').trimEnd()}\n`;
}

/**
 * Make the readable copy. `root` is the DataRoot, `store` and `files` the agent's data and files APIs (so the
 * copy reads exactly what Workshop reads), `apps` [{id, name, folder}]. The old copy is replaced as a whole: it is
 * built next to it and swapped in, so a failure leaves the previous copy. Returns {dir, apps, collections, files}.
 */
export async function makeReadableCopy({ root, store, files, apps, now = new Date() }) {
  const dir = path.join(root.dir, COPY_DIR);
  const tmp = `${dir}.tmp-${process.pid}`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true, mode: 0o700 });
  const byId = new Map(apps.map(a => [a.id, a]));
  const counts = { apps: 0, collections: 0, files: 0 };
  const index = [];
  for (const id of root.apps()) {
    const app = byId.get(id) || { id, name: id, folder: root.folderOf(id) };
    const out = path.join(tmp, app.name.replace(/[\\/:*?"<>|]/g, '-'));
    let wrote = 0;
    for (const c of await store.list(id)) {
      let env;
      try { env = await store.get(id, c.collection); } catch { continue; } // damaged: the original stays in its folder
      if (!env) continue;
      const items = (env.items || []).filter(it => !(env.deleted && env.deleted[it.id] >= it.updatedAt));
      const base = path.join(out, ...c.collection.split('/'));
      await writeFileAtomic(`${base}.csv`, toCsv(items), DATA_MODES);
      await writeFileAtomic(`${base}.md`, toMarkdown(`${app.name}: ${c.collection}`, { ...env, items }), DATA_MODES);
      counts.collections++; wrote++;
    }
    for (const f of await files.list(id, '')) {
      const src = root.abs(`${id}/${f.path}`);
      const dest = path.join(out, ...f.path.split('/'));
      try {
        await fsp.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
        await fsp.copyFile(src, dest);
        await fsp.chmod(dest, 0o600).catch(() => {});
        counts.files++; wrote++;
      } catch { /* changed or gone while copying */ }
    }
    if (wrote) { counts.apps++; index.push(`- **${app.name}**: from \`${app.folder}/\``); }
  }
  await writeFileAtomic(path.join(tmp, README), `# Readable copy\n\nMade by Workshop on ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC from this data folder. It is a copy: changing it changes nothing in Workshop, and the next copy replaces it.\n\n- \`.csv\` files open in Excel or any spreadsheet app, one row per record.\n- \`.md\` files are the same records as a document.\n- Notes, summaries and images are copied as they are.\n\n${index.join('\n') || 'Nothing saved yet.'}\n`, DATA_MODES);
  const old = `${dir}.old-${process.pid}`;
  const had = fs.existsSync(dir);
  if (had) await fsp.rename(dir, old);
  try { await fsp.rename(tmp, dir); } catch (e) { if (had) await fsp.rename(old, dir).catch(() => {}); throw e; }
  if (had) await fsp.rm(old, { recursive: true, force: true });
  return { dir, ...counts };
}

// What is stored where, for `workshop doctor` and Settings, Data (docs/data-format.md, Where things are kept).
// Reads only: sizes, counts and dates. Never reads file contents, never changes or deletes anything.
import fs from 'node:fs';
import path from 'node:path';
import { looseDataDir } from './datadir.mjs';
import { APP_FOLDERS } from '../../shared/app-folders.js';

/** Folder names that mean a sync tool uploads the folder. Matched against path segments, case ignored. */
const SYNCED = [
  { name: 'OneDrive', test: s => /^onedrive( - .+)?$/i.test(s) || /^onedrive-/i.test(s) },
  { name: 'Dropbox', test: s => /^dropbox( \(.+\))?$/i.test(s) },
  { name: 'iCloud Drive', test: (s, all, i) => s === 'Mobile Documents' && all[i - 1] === 'Library' },
  { name: 'Google Drive', test: s => /^google ?drive$/i.test(s) || /^googledrive-/i.test(s) || s === 'My Drive' },
  { name: 'Box', test: s => /^box( sync)?$/i.test(s) },
];

/** Which sync tool's folder holds `dir`, by name, or null. Covers ~/Library/CloudStorage/<Provider>-... too. */
export function syncedProvider(dir) {
  const parts = path.resolve(dir).split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    for (const p of SYNCED) if (p.test(parts[i], parts, i)) return p.name;
  }
  return null;
}

/** Size in bytes and file count of a file or folder, following no links. Missing: null. */
export function sizeOf(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return null; }
  if (st.isFile()) return { bytes: st.size, files: 1, modified: st.mtimeMs };
  if (!st.isDirectory()) return { bytes: 0, files: 0, modified: st.mtimeMs };
  let bytes = 0, files = 0, modified = st.mtimeMs;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.isFile()) {
        try { const s = fs.statSync(q); bytes += s.size; files++; if (s.mtimeMs > modified) modified = s.mtimeMs; } catch { /* gone */ }
      }
    }
  };
  walk(p);
  return { bytes, files, modified };
}

/** Bytes as short text: 0 B, 12 KB, 3.4 MB. */
export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Content a person wrote that a connector keeps in the Workshop home instead of the data folder. After the
 * move to the data folder (docs/connector.md, ctx.content) these are old copies, kept until deleted by hand.
 */
export const CONNECTOR_CONTENT = [
  { id: 'opencode-chats', what: 'Chat list', rel: ['_connectors', 'opencode', 'chats.json'] },
  { id: 'opencode-hub', what: 'Hub requests', rel: ['_connectors', 'opencode', 'hub'] },
  { id: 'opencode-oneonones', what: '1:1 packets', rel: ['_connectors', 'opencode', 'oneonones'] },
];

/** The largest collections and files in the data folder, biggest first. Dot folders are skipped. */
export function largestFiles(dataDir, limit = 10) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const q = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(q, r);
      else if (e.isFile() && rel) { try { out.push({ path: r, bytes: fs.statSync(q).size }); } catch { /* gone */ } }
    }
  };
  walk(dataDir, '');
  return out.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

/**
 * Everything Workshop keeps, by place. Each entry: `id`, `what` (plain words), `path`, and `size` from sizeOf
 * (null when missing). Plus the data folder's permissions and sync tool.
 */
export function storageReport({ home, dataDir, platform = process.platform, folders = APP_FOLDERS }) {
  const data = path.join(home, 'data');
  const oldApps = [];
  try {
    for (const d of fs.readdirSync(data, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')) oldApps.push(d.name);
    }
  } catch { /* none */ }
  const entry = (id, what, p) => ({ id, what, path: p, size: sizeOf(p) });
  const leftovers = [
    ...(fs.existsSync(path.join(data, 'moved.json')) ? oldApps.map(a => entry(`old-${a}`, `Old copy of ${a} data, from before the data folder`, path.join(data, a))) : []),
    ...CONNECTOR_CONTENT.map(c => entry(c.id, c.what, path.join(data, ...c.rel))).filter(e => e.size && e.size.files),
  ];
  // App folders under their old names (shared/app-folders.js): renamed on the agent's next start, or left
  // because the new folder already had files.
  const oldNames = [];
  for (const [id, folder] of Object.entries(folders)) {
    if (!fs.statSync(path.join(dataDir, id), { throwIfNoEntry: false })?.isDirectory()) continue;
    const both = fs.existsSync(path.join(dataDir, folder));
    oldNames.push({ id, folder, both });
    if (both) leftovers.push({ ...entry(`folder-${id}`, `The ${id}/ folder, its old name (Workshop uses ${folder}/)`, path.join(dataDir, id)) });
  }
  return {
    dataDir,
    loose: looseDataDir(dataDir, platform),
    synced: syncedProvider(dataDir),
    data: sizeOf(dataDir),
    trash: sizeOf(path.join(dataDir, '.trash')),
    backups: sizeOf(path.join(dataDir, '.backups')),
    leftovers,
    oldNames,
  };
}

/** The lines `workshop doctor` prints about storage. `bad` is never set: these are notes, not failures. */
export function storageLines(report, { sizes = false, largest = largestFiles } = {}) {
  const lines = [];
  if (report.loose) lines.push(`Data folder permissions: ${report.loose}, so other users on this computer can read it. Run: chmod 700 "${report.dataDir}"`);
  if (report.synced) lines.push(`Data folder sync: it is inside ${report.synced}, so ${report.synced} uploads it. Workshop itself never uploads it.`);
  const t = report.trash, b = report.backups;
  if (t && t.files) lines.push(`Trash: ${t.files} file${t.files === 1 ? '' : 's'}, ${humanBytes(t.bytes)}. Workshop never empties it; delete files in ${path.join(report.dataDir, '.trash')} or use Settings, Data.`);
  if (b && b.files) lines.push(`Backups: ${b.files} file${b.files === 1 ? '' : 's'}, ${humanBytes(b.bytes)}, kept before format changes.`);
  for (const o of report.oldNames || []) if (!o.both) lines.push(`App folders: ${o.id}/ is renamed to ${o.folder}/ the next time Workshop starts.`);
  for (const l of report.leftovers) lines.push(`Old copy: ${l.what}, ${humanBytes(l.size.bytes)} in ${l.path}. Kept until you delete it (Settings, Data).`);
  if (sizes && report.data) {
    lines.push('Largest files in the data folder:');
    const top = largest(report.dataDir);
    if (!top.length) lines.push('  none yet');
    for (const f of top) lines.push(`  ${humanBytes(f.bytes).padStart(8)}  ${f.path}${f.bytes > 8 * 1024 * 1024 ? '  (near the 10 MB limit)' : ''}`);
  }
  return lines;
}

// The data folder on start (docs/config.md, Data folder; docs/data-format.md, Moving from ~/.workshop/data and
// Disk rules): which folder, checking it, creating it, cleaning up interrupted writes, and the one-time copy of
// app data from ~/.workshop/data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from './fsutil.mjs';
import { ConfigError } from './home.mjs';
import { NAME, SEG, FILE_NAME, MAX_SEGMENTS, DataRoot, isInside, lexists, realpath, floorMs } from './datapath.mjs';
import { RENAMED_IDS, renameSaved } from '../../shared/app-folders.js';

/** The default data folder: Workshop in the user's home folder (~/Workshop, %USERPROFILE%\Workshop). */
export const defaultDataDir = () => path.join(os.homedir(), 'Workshop');

/** Where a path really is, following links on the part that exists. Missing parts are joined as given. */
function realish(p) {
  let base = path.resolve(p);
  const tail = [];
  while (!lexists(base)) {
    const up = path.dirname(base);
    if (up === base) break;
    tail.unshift(path.basename(base));
    base = up;
  }
  try { base = realpath(base); } catch { /* keep as given */ }
  return path.join(base, ...tail);
}

/**
 * Why `dir` cannot be the data folder for this Workshop home, in plain words, or null if it can.
 * It must be an absolute path on this platform and not the home folder or inside it (links followed).
 */
export function dataDirProblem(dir, home) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return `The data folder must be an absolute path on this computer (got ${JSON.stringify(dir)}).`;
  const h = path.resolve(home);
  if (isInside(path.resolve(dir), h) || isInside(realish(dir), realish(h))) {
    return `The data folder (${dir}) may not be the Workshop home folder (${home}) or a folder inside it.`;
  }
  return null;
}

/**
 * Make sure the data folder exists and can be read and written. Throws ConfigError with plain words if not;
 * the agent never falls back to another folder.
 */
export function prepareDataDir(dir, home, folders = {}) {
  const problem = dataDirProblem(dir, home);
  if (problem) throw new ConfigError(`${problem} Change "dataDir" in ${path.join(home, 'config.json')}, then start Workshop again.`);
  const notAFolder = () => new ConfigError(`The data folder ${dir} is a file, not a folder. Move it or change "dataDir" in ${path.join(home, 'config.json')}.`);
  if (lexists(dir) && !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    if (fs.statSync(dir, { throwIfNoEntry: false })) throw notAFolder();
    throw new ConfigError(`The data folder ${dir} is a link to something that is not there. Fix the link or change "dataDir" in ${path.join(home, 'config.json')}.`);
  }
  // A new data folder is made for the user only. An existing one is the user's: its permissions are left alone
  // (doctor says when other users on this computer can read it).
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) {
    throw new ConfigError(`Workshop could not create the data folder ${dir} (${e.code || e.message}). Create it yourself or change "dataDir" in ${path.join(home, 'config.json')}.`);
  }
  let st;
  try { st = fs.statSync(dir); } catch (e) { throw new ConfigError(`Workshop cannot open the data folder ${dir} (${e.code || e.message}).`); }
  if (!st.isDirectory()) throw notAFolder();
  // Prove read and write with a real write: on Windows, access checks miss folder permissions. The probe name
  // starts with "." and ends in ".tmp", so nothing else ever treats it as data.
  const probe = path.join(dir, `.workshop-write-check-${process.pid}.tmp`);
  try {
    fs.readdirSync(dir);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    try { fs.rmSync(probe, { force: true }); } catch { /* nothing to clean up */ }
    throw new ConfigError(`Workshop cannot read and write the data folder ${dir} (${e.code || e.message}). Check its permissions or change "dataDir" in ${path.join(home, 'config.json')}.`);
  }
  return new DataRoot(dir, folders);
}

/** Does this folder hold any file, at any depth? Dot names count: they may be the user's. */
function hasAnyFile(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  return entries.some(e => e.isFile() || e.isSymbolicLink() || (e.isDirectory() && hasAnyFile(path.join(dir, e.name))));
}

/**
 * Move each app's data from a folder it used before (shared/app-folders.js OLD_FOLDERS: <dataDir>/docket and
 * <dataDir>/prioritizer become <dataDir>/tasks, and so on), and its trash with it. A rename, so nothing is copied
 * and nothing can be half done. When the app's folder already holds files the old one is left as it is (doctor
 * and Settings point at it) and the app's folder is used; an empty one is removed first. When a rename fails
 * (another program has a file open, say) the old folder keeps being used until the next start, so no data goes
 * missing. Each rename is logged and recorded in .backups/<yyyy-mm-dd>/renamed.json.
 * @returns {{folders: Record<string, string>, renamed: string[], left: string[]}} the folders to use where they
 *   are not the app id (pass to DataRoot), "old -> new" for each rename, and the old names left in place
 */
export function moveOldFolders(dir, oldFolders, log, now = new Date()) {
  const use = {}, renamed = [], left = [];
  const isDir = p => { const st = fs.lstatSync(p, { throwIfNoEntry: false }); return !!st && st.isDirectory(); };
  for (const [id, olds] of Object.entries(oldFolders || {})) {
    for (const old of olds) {
      const from = path.join(dir, old), to = path.join(dir, id);
      if (!isDir(from)) continue;
      if (fs.lstatSync(to, { throwIfNoEntry: false })) {
        if (hasAnyFile(to)) { left.push(old); log.warn(`Both ${old}/ and ${id}/ are in the data folder. Workshop uses ${id}/; ${old}/ is left as it is. Move anything you need from it, then delete it.`); continue; }
        try { fs.rmSync(to, { recursive: true }); } catch (e) { use[id] = old; log.warn(`Could not rename ${old}/ to ${id}/ (${e.code || e.message}). ${old}/ is used until the next start.`); break; }
      }
      try {
        fs.renameSync(from, to);
        renamed.push(`${old} -> ${id}`);
        log.info(`Renamed the ${old}/ folder to ${id}/ in the data folder.`);
      } catch (e) {
        use[id] = old;
        log.warn(`Could not rename ${old}/ to ${id}/ in the data folder (${e.code || e.message}). ${old}/ is used until the next start.`);
        break;
      }
    }
    // Its trash: .trash/<old> becomes .trash/<id> while there is none under the new name yet.
    for (const old of olds) {
      const from = path.join(dir, '.trash', old), to = path.join(dir, '.trash', id);
      if (!isDir(from) || fs.lstatSync(to, { throwIfNoEntry: false })) continue;
      try { fs.renameSync(from, to); renamed.push(`.trash/${old} -> .trash/${id}`); } catch { /* restored from its old place by hand */ }
    }
  }
  if (renamed.length) {
    const rec = path.join(dir, '.backups', now.toISOString().slice(0, 10), 'renamed.json');
    try {
      fs.mkdirSync(path.dirname(rec), { recursive: true, mode: 0o700 });
      let prev = [];
      try { prev = JSON.parse(fs.readFileSync(rec, 'utf8')).renamed || []; } catch { /* first today */ }
      fs.writeFileSync(rec, `${JSON.stringify({ renamed: [...prev, ...renamed], at: now.toISOString() }, null, 2)}\n`, { mode: 0o600 });
    } catch { /* the log has it */ }
  }
  return { folders: use, renamed, left };
}

const OLD_ID_TEXT = new RegExp(`"(${Object.keys(RENAMED_IDS).join('|')})[".]`);
/**
 * Rewrite saved collections that still name an app by its old id (shared/app-folders.js renameSaved): the
 * schema of everything in a renamed app's folder, and app ids in every app's handoffs and Settings'
 * app-settings. A file is only read when its text holds an old id, and only written when something changed; the
 * file as it was is kept in .backups/<yyyy-mm-dd>/renamed-ids/ first. Cheap, so it runs on every start.
 * @param {(id: string) => string} folderOf the folder an app id uses (DataRoot.folderOf)
 * @returns {string[]} the files rewritten, relative to the data folder
 */
export function renameSavedIds(dir, folderOf, log, now = new Date()) {
  const done = [];
  const files = [];
  const walk = (abs, rel, depth) => {
    let entries; try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && depth < MAX_SEGMENTS) walk(path.join(abs, e.name), `${rel}/${e.name}`, depth + 1);
      else if (e.isFile() && e.name.endsWith('.json')) files.push({ abs: path.join(abs, e.name), app: rel.split('/')[0], collection: `${rel.split('/').slice(1).concat(e.name.slice(0, -5)).join('/')}` });
    }
  };
  let top = []; try { top = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name); } catch { return done; }
  const renamedApps = new Set(Object.values(RENAMED_IDS));
  for (const id of new Set([...top, ...renamedApps])) {
    const folder = folderOf(id);
    if (!top.includes(folder)) continue;
    if (renamedApps.has(id)) walk(path.join(dir, folder), id, 1);
    else for (const name of ['handoffs.json', 'app-settings.json']) {
      const abs = path.join(dir, folder, name);
      if (fs.existsSync(abs)) files.push({ abs, app: id, collection: name.slice(0, -5) });
    }
  }
  for (const f of files) {
    let text;
    try { if (fs.statSync(f.abs).size > 16 * 1024 * 1024) continue; text = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
    if (!OLD_ID_TEXT.test(text)) continue;
    let env; try { env = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { continue; }
    if (!env || typeof env !== 'object' || typeof env.schema !== 'string') continue;
    const next = renameSaved(f.collection, env);
    if (next === env || next.schema !== `${f.app}.${f.collection}`) continue;
    const rel = path.relative(dir, f.abs);
    try {
      const keep = path.join(dir, '.backups', now.toISOString().slice(0, 10), 'renamed-ids', rel);
      fs.mkdirSync(path.dirname(keep), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, text, { mode: 0o600 });
      const tmp = `${f.abs}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, f.abs);
      done.push(rel.split(path.sep).join('/'));
    } catch (e) { log.warn(`Could not update ${rel} to the new app names (${e.code || e.message}). It is read as it is.`); }
  }
  if (done.length) log.info(`Updated ${done.length} saved file${done.length === 1 ? '' : 's'} to the new app names. The old copies are in .backups/${now.toISOString().slice(0, 10)}/renamed-ids/.`);
  return done;
}

/** Working files a connector hands to another program are removed this many days after they last changed. */
export const SCRATCH_DAYS = 7;

/**
 * Remove stale working files: each `<dataDir>/.scratch/<connector>/<area>/<item>` whose newest file is older
 * than SCRATCH_DAYS (docs/connector.md, ctx.scratch). The one place Workshop removes files in the data folder;
 * nothing outside .scratch is touched. Returns the removed items, relative to .scratch.
 */
export function cleanScratch(dataDir, now = Date.now(), days = SCRATCH_DAYS) {
  const root = path.join(dataDir, '.scratch');
  const cutoff = now - days * 86400000;
  const removed = [];
  const kids = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name); } catch { return []; } };
  const newest = p => {
    let m = 0;
    const walk = q => {
      let st; try { st = fs.lstatSync(q); } catch { return; }
      if (st.mtimeMs > m) m = st.mtimeMs;
      if (st.isDirectory()) for (const e of fs.readdirSync(q)) walk(path.join(q, e));
    };
    walk(p);
    return m;
  };
  for (const id of kids(root)) {
    for (const area of kids(path.join(root, id))) {
      let items; try { items = fs.readdirSync(path.join(root, id, area)); } catch { continue; }
      for (const item of items) {
        const p = path.join(root, id, area, item);
        if (newest(p) >= cutoff) continue;
        try { fs.rmSync(p, { recursive: true, force: true }); removed.push(`${id}/${area}/${item}`); } catch { /* next start */ }
      }
    }
  }
  return removed;
}

/**
 * Can other users on this computer open the data folder? Null on Windows (its ACL decides) and when the folder
 * is missing; otherwise the folder's permission bits as octal text when group or others have any, else false.
 */
export function looseDataDir(dir, platform = process.platform) {
  if (platform === 'win32') return null;
  const st = fs.statSync(dir, { throwIfNoEntry: false });
  if (!st) return null;
  return (st.mode & 0o077) ? (st.mode & 0o777).toString(8).padStart(3, '0') : false;
}

/**
 * Delete leftover "<name>.json.tmp" and "<name>.md.tmp" files from interrupted writes, next to collections and
 * files in app folders. Nothing else is touched: dot folders (.git and the like) and names that break the rules
 * are the user's. Returns the paths removed, relative to the data folder.
 */
export function removeDataTmpFiles(root) {
  const removed = [];
  const visit = (abs, parts) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (SEG.test(e.name) && parts.length < MAX_SEGMENTS) visit(p, [...parts, e.name]);
      } else if (e.isFile() && e.name.endsWith('.tmp') && FILE_NAME.test(e.name.slice(0, -4))) {
        try { fs.rmSync(p, { force: true }); removed.push([...parts, e.name].join('/')); } catch { /* left for next start */ }
      }
    }
  };
  for (const app of root.apps()) {
    const abs = root.abs(app);
    if (root.contains(abs)) visit(abs, [app]);
  }
  return removed;
}

/** Does the data folder hold app data: any .json or .md file under an app folder? */
async function hasAppData(root) {
  for (const app of root.apps()) if ((await root.walk(app)).length) return true;
  return false;
}

/**
 * The one-time copy of app data from <home>/data into an empty data folder. Copies each collection file byte for
 * byte, never overwrites, never deletes or changes the old files, then writes <home>/data/moved.json.
 * @returns {Promise<{copied: number, files: string[]} | null>} null when nothing was copied
 */
export async function moveOldData({ home, root, tracker, log }) {
  const old = path.join(home, 'data');
  let st;
  try { st = fs.statSync(old); } catch { return null; }
  if (!st.isDirectory() || lexists(path.join(old, 'moved.json'))) return null;
  const found = [];
  for (const d of fs.readdirSync(old, { withFileTypes: true })) {
    if (!d.isDirectory() || !NAME.test(d.name)) continue; // _connectors, _backup and dot names are skipped
    for (const f of fs.readdirSync(path.join(old, d.name), { withFileTypes: true })) {
      // <collection>.json only; version copies (<collection>.v<n>.json) and leftovers break the name rule.
      if (f.isFile() && f.name.endsWith('.json') && SEG.test(f.name.slice(0, -5))) found.push(`${d.name}/${f.name}`);
    }
  }
  if (!found.length || await hasAppData(root)) return null;
  const copied = [];
  for (const rel of found.sort()) {
    const dest = root.abs(rel);
    if (!root.contains(dest)) { log.warn(`Did not copy ${rel}: its folder in the data folder leads outside it.`); continue; }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(old, ...rel.split('/')), dest, fs.constants.COPYFILE_EXCL);
      tracker.own(rel, floorMs(fs.statSync(dest)));
      tracker.kind(rel, 'collection');
      copied.push(rel);
    } catch (e) {
      if (e.code === 'EEXIST') { log.warn(`Did not copy ${rel}: the data folder already has that file.`); continue; }
      throw new ConfigError(`Workshop could not copy ${rel} from ${old} to the data folder ${root.dir} (${e.code || e.message}). `
        + `The old files are unchanged. Copied so far: ${copied.length ? copied.join(', ') : 'nothing'}. Fix the problem and copy the rest by hand, or empty the data folder and start Workshop again.`);
    }
  }
  await writeJsonAtomic(path.join(old, 'moved.json'), { movedTo: root.dir, movedAt: new Date().toISOString(), collections: copied.length });
  log.info(`Copied ${copied.length} collection${copied.length === 1 ? '' : 's'} from ${old} to ${root.dir}. The old files are kept.`);
  return { copied: copied.length, files: copied };
}

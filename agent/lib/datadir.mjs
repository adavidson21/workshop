// The data folder on start (docs/config.md, Data folder; docs/data-format.md, Moving from ~/.workshop/data and
// Disk rules): which folder, checking it, creating it, cleaning up interrupted writes, and the one-time copy of
// app data from ~/.workshop/data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from './fsutil.mjs';
import { ConfigError } from './home.mjs';
import { NAME, SEG, FILE_NAME, MAX_SEGMENTS, DataRoot, isInside, lexists, realpath, floorMs } from './datapath.mjs';

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
export function prepareDataDir(dir, home) {
  const problem = dataDirProblem(dir, home);
  if (problem) throw new ConfigError(`${problem} Change "dataDir" in ${path.join(home, 'config.json')}, then start Workshop again.`);
  const notAFolder = () => new ConfigError(`The data folder ${dir} is a file, not a folder. Move it or change "dataDir" in ${path.join(home, 'config.json')}.`);
  if (lexists(dir) && !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    if (fs.statSync(dir, { throwIfNoEntry: false })) throw notAFolder();
    throw new ConfigError(`The data folder ${dir} is a link to something that is not there. Fix the link or change "dataDir" in ${path.join(home, 'config.json')}.`);
  }
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
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
  return new DataRoot(dir);
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

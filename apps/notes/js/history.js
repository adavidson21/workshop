/* Notes: version history. Before a save replaces a note, its previous text is kept as
   history/<key>/<stamp>.md, newest KEEP per note, so an overwritten edit can be brought back. history/ is not a
   note folder: it is left out of the tree, search, the index and backlinks.

   <key> is the note's path made into one name (Workshop's name rules allow one segment per folder, 40 characters
   each), with a short hash so two long paths never share a key. A rename does not move history: it stays under
   the old key. Pure: no DOM and no SDK. */
import { HISTORY_DIR as HISTORY } from './model.js';

export { HISTORY };
export const KEEP = 20;
/* At most one snapshot per note in this window: a burst of autosaves keeps the text from before the burst. */
export const SPACING_MS = 5 * 60 * 1000;

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The one-segment key for a note path: "runbooks/deploy.md" -> "runbooks-deploy-<hash>". */
export function historyKey(path) {
  const flat = path.replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
  const h = hash(path);
  return `${flat.slice(0, 39 - h.length).replace(/-+$/, '')}-${h}`;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** A snapshot's file name for a time: 20261105t171230123z.md (UTC). */
export function stampName(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}t${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}z.md`;
}
/** The time a snapshot name stands for, or null. */
export function stampTime(name) {
  const m = /^(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})(\d{3})z\.md$/.exec(name);
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null;
}

export const historyFolder = (path) => `${HISTORY}/${historyKey(path)}`;
export const isHistoryPath = (p) => p === HISTORY || p.startsWith(`${HISTORY}/`);

/**
 * A note's snapshots from a file listing ([{path, mtime}] relative to the app folder), newest first:
 * [{path, at}].
 */
export function snapshotsOf(path, listing) {
  const pre = historyFolder(path) + '/';
  return listing.filter(f => f.path.startsWith(pre) && !f.path.slice(pre.length).includes('/'))
    .map(f => ({ path: f.path, at: stampTime(f.path.slice(pre.length)) })).filter(s => s.at !== null)
    .sort((a, b) => b.at - a.at);
}

/**
 * What to do before saving over a note: {write: path | null, trash: [paths]}. Keeps the old text unless it is
 * empty or within SPACING_MS of the newest snapshot (unless `force`, as when restoring), and trims to KEEP.
 */
export function planSnapshot(path, oldText, snaps, now, { force = false } = {}) {
  const fresh = force ? !(snaps[0] && snaps[0].at === now) : !(snaps[0] && now - snaps[0].at < SPACING_MS);
  const write = oldText && oldText.trim() && fresh ? `${historyFolder(path)}/${stampName(now)}` : null;
  const kept = (write ? [{ path: write, at: now }, ...snaps] : snaps);
  return { write, trash: kept.slice(KEEP).map(s => s.path) };
}

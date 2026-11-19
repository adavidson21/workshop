// opencode connector: Chat's Files (Workshop docs/chat.md, Files; connector 1.27.0, Chat 4.0.0).
//
// Lists, reads and saves files in the workspace for Chat's editor, so you can look at or fix what an agent wrote
// without leaving Chat. Paths are relative to the workspace and must stay inside it, through symbolic links too (the
// real path is checked). Git's own folder is never listed, read or written.
//
// A save says which version it started from (the file's mtime when you opened it). If the file changed since (an
// agent edited it, or another editor did), nothing is written: the answer says so with the current mtime, and Chat
// asks whether to keep your version or theirs. Files over MAX_EDIT (the agent takes at most 1 MB per request) and
// files that are not UTF-8 text open read only, with a note.

import fs from "node:fs";
import path from "node:path";
import { httpError, inWorkspace, opt } from "./context.mjs";

export const MAX_EDIT = 900 * 1024;
export const MAX_LIST = 2000;
const SKIP = new Set([".git"]);

function root() {
  if (!opt || !opt.workspace) throw httpError(503, "The workspace is not set.");
  return path.resolve(opt.workspace);
}
const win = process.platform === "win32";
const under = (a, b) => { const [x, y] = win ? [a.toLowerCase(), b.toLowerCase()] : [a, b]; return x === y || x.startsWith(y + path.sep); };

/** A workspace path ("src/app.cs", "/" or "\\" separators) to its full path. "" is the workspace itself when `dir`. */
export function fullPath(rel, { dir = false } = {}) {
  const s = String(rel == null ? "" : rel).replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (s.includes("\0") || s.length > 1000 || s.startsWith("/") || /^[A-Za-z]:/.test(s)) throw httpError(400, "Bad path.");
  if (!s && !dir) throw httpError(400, "Pick a file.");
  const parts = s ? s.split("/") : [];
  if (parts.some((p) => !p || p === "." || p === ".." || SKIP.has(p.toLowerCase()))) throw httpError(400, "That path is not one Chat can open.");
  const f = path.resolve(root(), ...parts);
  if (f !== root() && !inWorkspace(f)) throw httpError(400, "That is not in the workspace.");
  return f;
}
/** The real file (links followed) must be in the real workspace too. A missing file is checked by its folder. */
function realInside(f) {
  let real;
  try { real = fs.realpathSync(f); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    const up = path.dirname(f);
    if (up === f) return;
    return realInside(up);
  }
  let r;
  try { r = fs.realpathSync(root()); } catch { r = root(); }
  if (!under(real, r)) throw httpError(400, "That is a link to somewhere outside the workspace.");
}
const relOf = (f) => path.relative(root(), f).split(path.sep).join("/");
function isDir(f) { try { return fs.statSync(f).isDirectory(); } catch { return false; } }
function fsError(e, what) {
  if (e && e.status) return e;
  if (e.code === "ENOENT") return httpError(404, `${what} is gone.`);
  if (e.code === "EACCES" || e.code === "EPERM") return httpError(403, `You do not have permission to open ${what}.`);
  if (e.code === "EBUSY") return httpError(409, `${what} is in use by another program.`);
  return httpError(500, `Could not open ${what} (${e.code || e.message}).`);
}

/** files.tree: one folder's files and folders, folders first, by name. */
export function filesTree({ dir = "" } = {}) {
  const f = fullPath(dir, { dir: true });
  realInside(f);
  let list;
  try { list = fs.readdirSync(f, { withFileTypes: true }); } catch (e) { throw fsError(e, dir || "The workspace"); }
  const items = [];
  for (const e of list) {
    if (SKIP.has(e.name.toLowerCase())) continue;
    const p = path.join(f, e.name);
    items.push({ name: e.name, path: relOf(p), dir: e.isDirectory() || (e.isSymbolicLink() && isDir(p)) });
  }
  items.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
  return { dir: f === root() ? "" : relOf(f), items: items.slice(0, MAX_LIST), more: Math.max(0, items.length - MAX_LIST) };
}

/** files.read: a file's text and mtime. `tooBig` or `binary` instead of the text when it cannot be edited here. */
export function filesRead({ path: rel }) {
  const f = fullPath(rel);
  realInside(f);
  let st;
  try { st = fs.statSync(f); } catch (e) { throw fsError(e, rel); }
  if (st.isDirectory()) throw httpError(400, "That is a folder.");
  const base = { path: relOf(f), mtime: st.mtimeMs, size: st.size };
  if (st.size > MAX_EDIT) return { ...base, tooBig: true };
  let buf;
  try { buf = fs.readFileSync(f); } catch (e) { throw fsError(e, rel); }
  if (buf.subarray(0, 8000).includes(0)) return { ...base, binary: true };
  let content;
  // ignoreBOM keeps a byte order mark in the text, so saving writes it back.
  try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); } catch { return { ...base, binary: true }; }
  return { ...base, content };
}

/**
 * files.write: saves `content` if the file is still the version you opened (`mtime`), or creates it with `create`.
 * Answers {ok: true, mtime, size}, or {ok: false, conflict: "changed" | "gone" | "exists", mtime} and writes nothing.
 * `force` saves over whatever is there now.
 */
export function filesWrite({ path: rel, content, mtime, create = false, force = false }) {
  const f = fullPath(rel);
  realInside(f);
  const text = String(content == null ? "" : content);
  if (Buffer.byteLength(text) > MAX_EDIT) throw httpError(413, "That file is too big to save from Chat.");
  let st = null;
  try { st = fs.statSync(f); } catch (e) { if (e.code !== "ENOENT") throw fsError(e, rel); }
  if (st && st.isDirectory()) throw httpError(400, "That is a folder.");
  if (!force) {
    if (!st && !create) return { ok: false, conflict: "gone", mtime: null };
    if (st && create) return { ok: false, conflict: "exists", mtime: st.mtimeMs };
    if (st && typeof mtime === "number" && Math.abs(st.mtimeMs - mtime) > 1) return { ok: false, conflict: "changed", mtime: st.mtimeMs };
  }
  try {
    if (!st) fs.mkdirSync(path.dirname(f), { recursive: true });
    // In place, like an editor: keeps the file's permissions, owner and links.
    fs.writeFileSync(f, text);
    const now = fs.statSync(f);
    return { ok: true, path: relOf(f), mtime: now.mtimeMs, size: now.size };
  } catch (e) { throw fsError(e, rel); }
}

/** files.stat: whether the file changed since `mtime` (Chat checks open files when an agent finishes a turn). */
export function filesStat({ paths }) {
  const out = {};
  for (const rel of (Array.isArray(paths) ? paths : []).slice(0, 50)) {
    try { const f = fullPath(rel); realInside(f); const st = fs.statSync(f); out[rel] = st.isFile() ? st.mtimeMs : null; }
    catch { out[rel] = null; }
  }
  return { mtimes: out };
}

// opencode connector: which work items are linked to ADO (1.22.0; Workshop project doc
// claude/work-items-source-v1-plan.md, eng-agents Core 4.9.0 pipeline guide "Who links to ADO").
//
// Tandem's work items are the source of truth; ADO is an optional link per item, kept in workitem.md:
//   - ADO item: <number>                   linked to that ADO work item (a local L<n> item linked later)
//   - ADO item: unlinked                   local, even though the id is a number
//   - ADO item: unlinked (was <number>)    local; it was linked to <number> before (the one-time unlink)
// No line: a numbered item is linked to its id, an L<n> item is local.
//
// Workshop writes only that one line (item.link, item.unlink, and the one-time unlink of every numbered item on
// the first start of 1.22.0, recorded in _dashboard/ado-links.json). Nothing here talks to ADO: Builds asks the ADO
// connector (workitem.create, workitem.update) and then links with item.link.

import fs from "node:fs";
import path from "node:path";
import { httpError, stateDir, workRoot } from "./context.mjs";

const LINE = /^[ \t]*-[ \t]*ADO item:[ \t]*(.*?)[ \t]*$/im;

/** The link a workitem.md says, for an item id: { linked, ado (number as string or null), was }. */
export function linkOf(id, text) {
  const m = text ? LINE.exec(text) : null;
  if (m) {
    const v = m[1];
    if (/^\d{1,10}$/.test(v)) return { linked: true, ado: v, was: null };
    const w = /^unlinked(?:\s*\(was\s+(\d{1,10})\))?/i.exec(v);
    if (w) return { linked: false, ado: null, was: w[1] || null };
  }
  if (/^\d{1,10}$/.test(String(id || ""))) return { linked: true, ado: String(id), was: null };
  return { linked: false, ado: null, was: null };
}

/** workitem.md text with its ADO item line set to `value` (replaced, or added after the header list's first field). */
export function setLine(text, value) {
  const line = `- ADO item: ${value}`;
  const t = String(text || "");
  if (LINE.test(t)) return t.replace(LINE, line);
  const lines = t.split(/\r?\n/);
  const nl = /\r\n/.test(t) ? "\r\n" : "\n";
  const i = lines.findIndex((l) => /^\s*-\s+[A-Za-z][A-Za-z ]{0,30}:/.test(l));
  if (i < 0) return (t && !t.endsWith("\n") ? t + nl : t) + line + nl;
  lines.splice(i, 0, line);
  return lines.join(nl);
}

const file = (folder) => path.join(workRoot, folder, "workitem.md");
function read(folder) {
  try {
    return fs.readFileSync(file(folder), "utf8");
  } catch {
    return null;
  }
}
function write(folder, text) {
  const f = file(folder);
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, f);
}

/** For state: { <folder>: { linked, ado, was } } for every work item. */
export function adoLinksData(items) {
  const out = {};
  for (const it of items || []) if (it.kind === "item") out[it.folder] = linkOf(it.id, read(it.folder));
  return out;
}

function itemOrThrow(it) {
  if (!it || it.kind !== "item") throw httpError(404, "No such work item. Refresh the page.");
  if (read(it.folder) === null) throw httpError(409, `${it.folder} has no workitem.md to record the link in.`);
}

/** Link an item to an ADO work item number. */
export function linkItem(it, ado) {
  itemOrThrow(it);
  const n = String(ado || "").replace(/^#|^AB#/i, "").trim();
  if (!/^\d{1,10}$/.test(n)) throw httpError(400, "An ADO work item is a number, like 41207.");
  write(it.folder, setLine(read(it.folder), n));
  return { ok: true, folder: it.folder, ...linkOf(it.id, read(it.folder)) };
}

/** Unlink an item: it stays as it is, ADO is never updated for it again. */
export function unlinkItem(it) {
  itemOrThrow(it);
  const cur = linkOf(it.id, read(it.folder));
  const was = cur.ado || cur.was;
  write(it.folder, setLine(read(it.folder), was ? `unlinked (was ${was})` : "unlinked"));
  return { ok: true, folder: it.folder, ...linkOf(it.id, read(it.folder)) };
}

// ------------------------------------------------------------------ the one-time unlink
const markFile = () => path.join(stateDir, "ado-links.json");
let mark = null; // { version, unlinkedAt, count, folders, seen }

export function loadAdoLinks() {
  try {
    mark = JSON.parse(fs.readFileSync(markFile(), "utf8"));
  } catch {
    mark = null;
  }
}
export function resetAdoLinks() {
  mark = null;
}
function saveMark() {
  const tmp = markFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(mark, null, 2));
  fs.renameSync(tmp, markFile());
}

/**
 * Once per workspace: every numbered item with no ADO item line becomes local ("unlinked (was <id>)"), so Workshop
 * starts from Tandem's items. Items started from ADO afterwards are linked as usual. Returns how many it changed,
 * or null when it already ran.
 */
export function unlinkAllOnce(items) {
  if (mark && mark.unlinkedAt) return null;
  const folders = [];
  for (const it of items || []) {
    if (it.kind !== "item" || !/^\d+$/.test(String(it.id))) continue;
    const text = read(it.folder);
    if (text === null || LINE.test(text)) continue;
    try {
      write(it.folder, setLine(text, `unlinked (was ${it.id})`));
      folders.push(it.folder);
    } catch {}
  }
  mark = { version: 1, unlinkedAt: new Date().toISOString(), count: folders.length, folders: folders.slice(0, 500), seen: folders.length === 0 };
  try { saveMark(); } catch {}
  return folders.length;
}

/** For state: the one-time unlink's notice, until Builds marks it seen. */
export function adoNotice() {
  return mark && mark.unlinkedAt && !mark.seen ? { count: mark.count, at: mark.unlinkedAt } : null;
}
export function adoNoticeSeen() {
  if (mark) {
    mark.seen = true;
    try { saveMark(); } catch {}
  }
  return { ok: true };
}

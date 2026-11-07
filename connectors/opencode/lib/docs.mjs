// opencode connector: Tandem's .work documents for Notebook (the Notes app) and Dispatch's editor. Workshop only,
// not in the eng-agents live server.
//
// docs.list: every .work folder the parser knows, with its Markdown files (name, size, modified time), so Notebook
// can show them as a Tandem section without a copy anywhere. `review` names the file waiting on you (spec.md,
// plan.md, bug.md or review.md while the step needs you).
//
// writeWorkFile: one .md file at the top of an existing .work folder, with file.write's conflict check
// (lib/slate.mjs). Refused while Tandem is working on that folder (its session is busy or autopilot runs it), so
// you never edit a plan the agent is writing.
import fs from "node:fs";
import path from "node:path";
import { httpError } from "./context.mjs";
import { MAX_FILE, PM_FILE } from "./slate.mjs";

// A .work folder name: what the parser lists (41207-fix-login, spike-cache, pr-4812, L3-local).
export const WORK_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
// The file waiting on you at each gated step (the same map as Dispatch's gateFileLink).
export const GATE = { spec: "spec.md", plan: "plan.md", bug: "bug.md", review: "review.md" };
// Files Notebook lists first, in this order; the rest follow by name.
const ORDER = ["brief.md", "spec.md", "plan.md", "bug.md", "tasks.md", "review.md", "pr.md", "findings.md", "answer.md", "tsd.md", "triage.md", "workitem.md", "progress.md", "repos.md"];
export const MAX_DOC_FOLDERS = 500;

const rank = (f) => {
  const i = ORDER.indexOf(f);
  return i < 0 ? ORDER.length : i;
};

/** The file the item waits on you to read, or null. */
export function reviewFile(it) {
  if (!it || it.paused || !it.next || !it.next.needsYou) return null;
  const f = GATE[it.next.stage];
  return f && (it.files || []).includes(f) ? f : null;
}

/**
 * Notebook's view of .work. model: the parser's model; busyFor(folder): a reason string while Tandem works on it,
 * else null. Resolves {items: [{folder, kind, id, title, stage, lane, busy, review, files: [{file, size, mtime}]}]},
 * newest change first.
 */
export function listDocs(model, busyFor, root) {
  const out = [];
  for (const it of (model && model.items) || []) {
    if (!it || !WORK_FOLDER.test(String(it.folder || ""))) continue;
    const files = [];
    for (const f of it.files || []) {
      if (!PM_FILE.test(f)) continue;
      try {
        const st = fs.statSync(path.join(root, it.folder, f));
        if (st.isFile()) files.push({ file: f, size: st.size, mtime: Math.round(st.mtimeMs) });
      } catch {
        // gone since the parser read the folder; the watcher refreshes the model
      }
    }
    if (!files.length) continue;
    files.sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
    out.push({
      folder: it.folder,
      kind: it.kind || "item",
      id: it.id == null ? null : String(it.id),
      title: String(it.title || it.folder).slice(0, 300),
      stage: it.stage || null,
      lane: it.lane || null,
      busy: busyFor(it.folder) || null,
      review: reviewFile(it),
      files,
    });
  }
  const newest = (x) => Math.max(...x.files.map((f) => f.mtime));
  out.sort((a, b) => newest(b) - newest(a));
  return { items: out.slice(0, MAX_DOC_FOLDERS) };
}

/**
 * Write one .md file at the top of an existing .work folder. `expected` is the text you read (omit it to create a
 * file that must not exist); a file that changed since answers 409 with `current` and nothing is written.
 * Resolves {folder, file, size}.
 */
export function writeWorkFile({ folder, file, text, expected }, { root, busyFor = () => null }) {
  const f = String(folder || "");
  if (!WORK_FOLDER.test(f)) throw httpError(400, `"${f}" is not a .work folder.`);
  const dir = path.join(root, f);
  if (!dir.startsWith(root + path.sep)) throw httpError(400, `"${f}" is not a .work folder.`);
  try {
    if (!fs.statSync(dir).isDirectory()) throw new Error();
  } catch {
    throw httpError(404, `.work/${f} not found.`);
  }
  const why = busyFor(f);
  if (why) throw httpError(409, `${why}. Wait until it stops, then save again.`);
  const name = String(file || "");
  if (!PM_FILE.test(name)) throw httpError(400, "Only a .md file at the top of the folder can be written.");
  const body = String(text ?? "");
  if (Buffer.byteLength(body) > MAX_FILE) throw httpError(400, "The file is too big (200 KB at most).");
  const full = path.join(dir, name);
  let now = null;
  try {
    now = fs.readFileSync(full, "utf8");
  } catch {
    now = null;
  }
  const want = expected === undefined ? null : String(expected);
  if (now !== want) {
    const e = httpError(409, now === null ? `.work/${f}/${name} is gone.` : `.work/${f}/${name} changed since you read it.`);
    e.current = now;
    throw e;
  }
  const tmp = full + ".tmp";
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, full);
  return { folder: f, file: name, size: Buffer.byteLength(body) };
}

// opencode connector: the PM steps behind Builds (apps/builds). Each one runs a Tandem command in a new session,
// the same way a spike does (lib/workspace.mjs runLoose), and links the session to its .work folder once that
// folder exists, so Builds can follow it with `state` and read its files with `file.read`.
//
//   triage.start   /triage <id | words | folder>  .work/triage-<id or short name>/triage.md   (eng-agents Core 2.12.0)
//   shape.start    /shape <idea> | triage-<n> | shape-<n> [brief|more]
//                                                  .work/shape-<name>/questions.md, understanding.md, brief.md (Core 2.16.0)
//   scope.start    /scope <idea> | shape-<n> | scope-<name>   .work/scope-<name>/epics.md, stories.md
//   slice.start    /slice scope-<name>            .work/scope-<name>/milestones.md
//   refine.start   /refine <title> | shape-<n> | refine-<n>   .work/refine-<name>/refine.md   (Core 2.12.0; shape-<n> 2.16.0)
//   handoff.start  /handoff <id> <name>           .work/handoff-<id>/handoff.md                (Core 2.12.0)
//   approve        /approve scope-<name> [stories|milestones] | /approve refine-<name>
//   file.write     one .md file at the top of a PM folder (Builds' panel edits, a triage's or a shape's answers.md)
//
// Nothing here talks to Azure DevOps or git. Not part of eng-agents' copied server (README.md, Source).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { httpError, workRoot } from "./context.mjs";
import { runLoose } from "./workspace.mjs";
import { freeName } from "./names.mjs";

/** The PM folders Builds may start, approve and edit. */
export const PM_FOLDER = /^(triage|shape|scope|refine|handoff)-[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const PM_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/;
export const MAX_FILE = 200000;

const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const exists = (folder, root = workRoot) => {
  try {
    return fs.statSync(path.join(root, folder)).isDirectory();
  } catch {
    return false;
  }
};
const listPrefix = (prefix) => {
  try {
    return fs.readdirSync(workRoot).filter((n) => n.startsWith(prefix) && exists(n));
  } catch {
    return [];
  }
};
/** A find() for linkFrom: the folder once it exists. */
const when = (folder) => () => (exists(folder) ? folder : null);
/** A find() for linkFrom: the first <prefix> folder that was not there before. */
const newFolder = (prefix) => {
  const before = new Set(listPrefix(prefix));
  return () => listPrefix(prefix).find((f) => !before.has(f)) || null;
};
/** A run from words (1.36.0): Workshop names the folder and sends `--name`; the find() prefers that folder, and
 *  falls back to the first new one for a Tandem older than Core 4.18.0. Resolves {args, find}. */
const named = (kind, words, text) => {
  const name = freeName(text, kind, workRoot);
  const exact = when(`${kind}-${name}`), any = newFolder(`${kind}-`);
  return { args: `${words} --name ${name}`, find: () => exact() || any() };
};

export function checkFolder(folder, kinds, root = workRoot) {
  const f = String(folder || "");
  if (!PM_FOLDER.test(f) || !kinds.some((k) => f.startsWith(`${k}-`))) throw httpError(400, `"${f}" is not a ${kinds.join(" or ")} folder.`);
  if (!exists(f, root)) throw httpError(404, `.work/${f} not found.`);
  return f;
}

/**
 * /triage <id>, /triage <words>, or /triage triage-<name> to triage again (after the requester answered). With an
 * id the folder is known (triage-<id>); with words it is the agent's to name, so the session is linked to the first
 * new triage- folder and `folder` is null until then. Resolves {session, folder}.
 */
export async function startTriage({ id, text, folder }) {
  if (folder) {
    const f = checkFolder(folder, ["triage"]);
    return { ...(await runLoose("triage", f, when(f))), folder: f };
  }
  if (id != null && id !== "") {
    const n = String(id);
    if (!/^[0-9]{1,10}$/.test(n)) throw httpError(400, "The work item id is a number.");
    const f = `triage-${n}`;
    // A note after the id (who asked, why it matters): /triage keeps it in note.md (Core 2.18.0).
    const note = oneLine(text).slice(0, 1000);
    return { ...(await runLoose("triage", note ? `${n} ${note}` : n, when(f))), folder: f };
  }
  const t = oneLine(text);
  if (!t) throw httpError(400, "Give the work item id, or say what is being asked.");
  if (t.length > 2000) throw httpError(400, "Keep the request under 2000 characters.");
  if (/^triage-/.test(t)) throw httpError(400, "To triage a folder again, pass it as folder.");
  const n = named("triage", t, t);
  return { ...(await runLoose("triage", n.args, n.find)), folder: null };
}

/**
 * /shape: one round of the interview. `idea` starts one (the agent names the folder, so `folder` is null until
 * the first new shape- folder appears); `from` (a triage-<name> folder) starts one from a triage, in
 * shape-<the rest>; `folder` (a shape-<name> folder) runs the next round, with `mode` "brief" (write the brief now)
 * or "more" (ask another round). Resolves {session, folder}.
 */
export async function startShape({ idea, from, folder, mode }) {
  if (mode != null && mode !== "" && !["brief", "more"].includes(mode)) throw httpError(400, 'mode is "brief" or "more".');
  if (folder) {
    const f = checkFolder(folder, ["shape"]);
    return { ...(await runLoose("shape", mode ? `${f} ${mode}` : f, when(f))), folder: f };
  }
  if (mode) throw httpError(400, "mode needs a shape folder.");
  if (from) {
    const t = checkFolder(from, ["triage"]);
    const f = `shape-${t.slice("triage-".length)}`;
    return { ...(await runLoose("shape", t, when(f))), folder: f };
  }
  const t = oneLine(idea);
  if (!t) throw httpError(400, "Say what the idea is.");
  if (t.length > 4000) throw httpError(400, "Keep the idea under 4000 characters.");
  if (/^(shape|triage)-/.test(t)) throw httpError(400, "To continue a shape, pass it as folder; to start from a triage, pass it as from.");
  const n = named("shape", t, t);
  return { ...(await runLoose("shape", n.args, n.find)), folder: null };
}

/** The scope- or refine- folder a shape's brief becomes: the same name after the prefix. */
const fromShape = (from, kind) => {
  const f = checkFolder(from, ["shape"]);
  return { shape: f, folder: `${kind}-${f.slice("shape-".length)}`, kind };
};
/** The folder a brief becomes; if the agent named it otherwise, the first new folder of that kind (1.36.0). */
const fromShapeFind = (x) => {
  const exact = when(x.folder), any = newFolder(`${x.kind}-`);
  return () => exact() || any();
};

/** /scope <idea>, /scope shape-<name> (from a shaped brief), or /scope scope-<name> to revise a draft. */
export async function startScope({ idea, from, folder }) {
  if (from) {
    const x = fromShape(from, "scope");
    return { ...(await runLoose("scope", x.shape, fromShapeFind(x))), folder: x.folder };
  }
  if (folder) {
    const f = checkFolder(folder, ["scope"]);
    return { ...(await runLoose("scope", f, when(f))), folder: f };
  }
  const t = oneLine(idea);
  if (!t) throw httpError(400, "Say what the idea is.");
  if (t.length > 4000) throw httpError(400, "Keep the idea under 4000 characters.");
  const n = named("scope", t, t);
  return { ...(await runLoose("scope", n.args, n.find)), folder: null };
}

/** /slice scope-<name> (stories.md must be approved; /slice says so if not). */
export async function startSlice({ folder }) {
  const f = checkFolder(folder, ["scope"]);
  return { ...(await runLoose("slice", f, when(f))), folder: f };
}

/**
 * /refine <title> (with an optional description and parent), or /refine refine-<name> to revise a draft. The agent
 * names a new folder, so the session is linked to the first new refine- folder and `folder` is null until then.
 */
export async function startRefine({ title, description, parent, folder, from }) {
  if (from) {
    const x = fromShape(from, "refine");
    return { ...(await runLoose("refine", x.shape, fromShapeFind(x))), folder: x.folder };
  }
  if (folder) {
    const f = checkFolder(folder, ["refine"]);
    return { ...(await runLoose("refine", f, when(f))), folder: f };
  }
  const t = oneLine(title);
  if (!t) throw httpError(400, "Give the story a title.");
  if (t.length > 200) throw httpError(400, "Keep the title under 200 characters.");
  if (/^refine-/.test(t)) throw httpError(400, "To revise a draft, pass it as folder.");
  if (parent != null && parent !== "" && !/^[0-9]{1,10}$/.test(String(parent))) throw httpError(400, "The parent is a work item id.");
  const parts = [t];
  if (parent) parts.push(`Parent: #${parent}`);
  const d = oneLine(description);
  if (d) parts.push(`Description: ${d.slice(0, 4000)}`);
  const n = named("refine", parts.join(". "), t);
  return { ...(await runLoose("refine", n.args, n.find)), folder: null };
}

/** /handoff <id> <assignee>. */
export async function startHandoff({ id, assignee }) {
  const n = String(id ?? "");
  if (!/^([0-9]{1,10}|L[0-9]{1,10})$/.test(n)) throw httpError(400, "The work item id is a number, or L and a number for local work.");
  const who = oneLine(assignee);
  if (!who) throw httpError(400, "Say who the work goes to.");
  if (who.length > 200) throw httpError(400, "Keep the name under 200 characters.");
  const folder = `handoff-${n}`;
  return { ...(await runLoose("handoff", `${n} ${who}`, when(folder))), folder };
}

/**
 * Approve a scope's stories or milestones, or a refined story (1.36.0: in code, not a Tandem session). Your click is
 * the approval; what /approve did with a model is plain file work: pick the draft, check its open questions, see
 * whether you edited it (eng-agents scripts/work/DraftHash.ps1, same hash), set `Status: APPROVED` and log it in
 * progress.md with the Stats line /stats reads. Open questions that are not marked "accepted risk" stop it: the
 * answer is {open: [lines]} and nothing changes; call again with acceptRisk to mark them and approve.
 * Resolves {folder, file, approved: true, gate} or {folder, file, approved: false, open}.
 */
export function approveFolder({ folder, what, acceptRisk = false }, root = workRoot, today = new Date()) {
  const f = checkFolder(folder, ["scope", "refine"], root);
  if (what != null && what !== "") {
    if (!f.startsWith("scope-") || !["stories", "milestones"].includes(what)) throw httpError(400, 'For a scope, approve "stories" or "milestones". A refine folder has one file.');
  }
  const dir = path.join(root, f);
  const read = (name) => { try { return fs.readFileSync(path.join(dir, name), "utf8"); } catch { return null; } };
  const status = (text) => { const m = text && /^[ \t]*Status[ \t]*:[ \t]*([A-Za-z]+)/m.exec(text); return m ? m[1].toUpperCase() : null; };
  let file;
  if (f.startsWith("refine-")) file = "refine.md";
  else if (what) file = `${what}.md`;
  else file = status(read("stories.md")) === "DRAFT" ? "stories.md" : "milestones.md";
  const text = read(file);
  if (text == null) throw httpError(404, `.work/${f}/${file} not found.`);
  const st = status(text);
  if (st !== "DRAFT") throw httpError(409, `.work/${f}/${file} says Status: ${st || "(none)"}, not DRAFT.`);
  // Open questions: the file's, and for stories the epic's too.
  const others = file === "stories.md" ? ["epics.md"] : [];
  const open = [];
  for (const name of [file, ...others]) for (const l of openLines(name === file ? text : read(name))) open.push({ file: name, line: l });
  if (open.length && !acceptRisk) return { folder: f, file, approved: false, open: open.map((o) => o.line) };
  const gate = draftGate(text);
  const marked = new Map();
  for (const o of open) marked.set(o.file, markRisk(marked.get(o.file) ?? (o.file === file ? text : read(o.file)), o.line));
  let out = marked.get(file) ?? text;
  out = out.replace(/^([ \t]*Status[ \t]*:[ \t]*)DRAFT\b/m, "$1APPROVED");
  fs.writeFileSync(path.join(dir, file), out);
  for (const [name, t] of marked) if (name !== file) fs.writeFileSync(path.join(dir, name), t);
  const kind = file.replace(/\.md$/, "");
  const day = today.toISOString().slice(0, 10);
  const entry = [`\n## ${day} | /approve | Workshop`, "", `- Did: approved ${file} from Builds${open.length ? `, with ${open.length} open question${open.length === 1 ? "" : "s"} marked accepted risk` : ""}.`, `- Files changed: ${[file, ...[...marked.keys()].filter((n) => n !== file)].join(", ")}`, `- Stats: gate=${gate} file=${kind}`, "- Notes: none", `- Next: ${NEXT[kind] ? NEXT[kind].replace("<f>", f) : "none"}`, ""].join("\n");
  try { fs.appendFileSync(path.join(dir, "progress.md"), entry); } catch { /* progress.md is a log: approving does not depend on it */ }
  return { folder: f, file, approved: true, gate };
}
const NEXT = { stories: "`/slice <f>`", milestones: "Create the items from Builds (`/backlog <f>`)", refine: "Publish it from Builds" };

/** The open questions in a file: the bullets under "Open questions" that are not "None" or marked accepted risk. */
export function openLines(text) {
  if (!text) return [];
  const m = /^#{2,3}[ \t]+Open questions[^\n]*\n([\s\S]*?)(?=^#{1,3}[ \t]|(?![\s\S]))/im.exec(text);
  if (!m) return [];
  return m[1].split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => /^\s*[-*]\s+\S/.test(l))
    .filter((l) => !/^\s*[-*]\s+(none\.?|n\/a|-)\s*$/i.test(l) && !/accepted risk/i.test(l) && !/^\s*[-*]\s+<.*>\s*$/.test(l));
}
const markRisk = (text, line) => text.replace(line, `${line} (accepted risk)`);

/** The same word Test-DraftHash.ps1 prints: unchanged, edited or no-hash. */
export function draftGate(text) {
  const stored = /^\s*Draft-hash\s*:\s*([0-9a-f]{12})\s*$/mi.exec(text);
  if (!stored) return "no-hash";
  const kept = String(text).split(/\r?\n/).filter((l) => !/^\s*(Status|Draft-hash)\s*:/i.test(l)).map((l) => l.replace(/\s+$/, ""));
  const hash = crypto.createHash("sha256").update(kept.join("\n").trim(), "utf8").digest("hex").slice(0, 12);
  return hash === stored[1].toLowerCase() ? "unchanged" : "edited";
}

/**
 * Write one Markdown file at the top of a PM folder. `expected` is the text you read (omit it to create a file
 * that must not exist): if the file changed since, it answers 409 with the text as it is now and writes nothing.
 * Resolves {folder, file, size}.
 */
export function writePmFile({ folder, file, text, expected }, root = workRoot) {
  const f = checkFolder(folder, ["triage", "shape", "scope", "refine", "handoff"], root);
  const name = String(file || "");
  if (!PM_FILE.test(name)) throw httpError(400, "Only a .md file at the top of the folder can be written.");
  const body = String(text ?? "");
  if (Buffer.byteLength(body) > MAX_FILE) throw httpError(400, "The file is too big (200 KB at most).");
  const full = path.join(root, f, name);
  if (!full.startsWith(path.join(root, f) + path.sep)) throw httpError(400, "Only a .md file at the top of the folder can be written.");
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
  // The .work watcher (lib/model.mjs) reads the folder again and tells apps with a `model` event.
  return { folder: f, file: name, size: Buffer.byteLength(body) };
}

// opencode connector: Chat's Changes view and suggested next prompt (connector 1.29.0, Chat 4.1.0, docs/chat.md).
//
// Changes: the files a chat's agent edited (its edit, write and patch tool calls), each with its diff against the
// repo's last commit, so you can read what the chat changed in one place and comment on lines. The comments go back
// to the chat as one message (the page writes it). Files outside a git repo, or new and not yet added, show all
// their lines as added.
//
// Suggested next prompt: after a turn, one short message you might send next, written by the chat's model in a
// scratch session that only sees the last exchange (never the files, never the whole chat), then deleted. Read only:
// it asks Tandem's chat agent, or opencode's plan agent. Off in Settings (opencode connector, Suggest a next prompt).

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { httpError, log, opt } from "./context.mjs";
import { oc } from "./opencode-state.mjs";
import { chatSessionOf } from "./chat.mjs";

export const MAX_FILES = 60;
export const DIFF_MAX = 60000;
export const TOTAL_MAX = 400000;
const EDIT_TOOLS = /^(edit|write|multiedit|patch|apply_patch|str_replace_based_edit_tool|create)$/i;

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 20000, maxBuffer: 8 << 20, windowsHide: true, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(stdout || "") }));
  });
}

/** The workspace-relative paths a chat's turns edited, in the order they were first edited. */
export function editedPaths(turns) {
  const seen = new Set();
  for (const t of turns || []) {
    for (const p of t.parts || []) {
      if (p.type === "tool" && EDIT_TOOLS.test(p.tool || "") && p.status !== "error" && p.input) seen.add(String(p.input).trim());
      else if (p.type === "patch") for (const f of p.files || []) seen.add(String(f).trim());
    }
  }
  return [...seen].filter((f) => f && !/[\0\r\n]/.test(f)).slice(0, MAX_FILES);
}

const count = (diff, ch) => diff.split("\n").filter((l) => l.startsWith(ch) && !l.startsWith(ch + ch + ch)).length;
function allAdded(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n");
}
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 400000 || buf.subarray(0, 8000).includes(0)) return null;
  return buf.toString("utf8");
}

/** One file's change: {path, repo, status: modified | added | deleted | clean | binary, additions, deletions, diff}. */
export async function fileChange(ws, rel) {
  const abs = path.resolve(ws, rel);
  if (!abs.startsWith(ws + path.sep)) return null;
  const exists = fs.existsSync(abs);
  let dir = path.dirname(abs);
  while (!fs.existsSync(dir) && dir.startsWith(ws + path.sep)) dir = path.dirname(dir);
  // git names the repo by its real path (macOS temp folders are links, Windows may use short names): compare real paths.
  const wsReal = real(ws);
  const top = (await git(dir, ["rev-parse", "--show-toplevel"])).out.trim();
  const topReal = top ? real(top) : null;
  const root = topReal && (topReal === wsReal || topReal.startsWith(wsReal + path.sep)) ? topReal : null;
  const repo = root ? path.relative(wsReal, root).replace(/\\/g, "/") || "." : null;
  const absReal = path.join(real(dir), path.relative(dir, abs));
  const out = (status, diff = "") => ({ path: rel, repo, status, additions: count(diff, "+"), deletions: count(diff, "-"), diff: diff.length > DIFF_MAX ? diff.slice(0, DIFF_MAX) + "\n... (cut)" : diff });
  if (root) {
    const inRepo = path.relative(root, absReal).replace(/\\/g, "/");
    const tracked = (await git(root, ["ls-files", "--error-unmatch", "--", inRepo])).code === 0;
    if (tracked || !exists) {
      const d = await git(root, ["diff", "--no-color", "--no-ext-diff", "-U3", "HEAD", "--", inRepo]);
      const body = d.out.split("\n");
      const at = body.findIndex((l) => l.startsWith("@@"));
      if (/^Binary files/m.test(d.out)) return out("binary");
      if (at < 0) return out(exists ? "clean" : "deleted");
      return out(exists ? "modified" : "deleted", body.slice(at).join("\n").replace(/\n$/, ""));
    }
  }
  if (!exists) return out("deleted");
  const text = readText(abs);
  return text == null ? out("binary") : out("added", allAdded(text));
}

/** A short fingerprint of what the chat changed (1.30.0), so Chat can tell a review of it went stale. */
export function changesKey(files) {
  const h = crypto.createHash("sha1");
  for (const f of files || []) h.update(`${f.path}\0${f.status}\0${f.diff || ""}\0`);
  return h.digest("hex").slice(0, 12);
}

/** What a chat changed (chat.changes): {files: [fileChange], key, at}. */
export async function chatChanges({ session }) {
  const sid = chatSessionOf(session);
  if (!oc.connected || !oc.api || !oc.api.richMessages) throw httpError(503, "opencode is not connected.");
  const turns = await oc.api.richMessages(sid, 400);
  const ws = path.resolve(opt.workspace);
  const files = [];
  let total = 0;
  for (const rel of editedPaths(turns)) {
    const f = await fileChange(ws, rel).catch(() => null);
    if (!f) continue;
    total += f.diff.length;
    if (total > TOTAL_MAX) { f.diff = ""; f.cut = true; }
    files.push(f);
  }
  return { files, key: changesKey(files), at: new Date().toISOString() };
}

/* ---------- suggested next prompt ---------- */

const suggested = new Map(); // session -> {key, text}
export const SUGGEST_AGENTS = ["chat", "plan"];
/** Tests start fresh. */
export function resetSuggest() { suggested.clear(); }
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "..." : t; };

/** The prompt the scratch session gets: only the last exchange, cut short. */
export function suggestPrompt(you, agent) {
  return [
    "Below is the end of a conversation between a developer and a coding agent.",
    "",
    `Developer: ${clip(you, 1500)}`,
    "",
    `Agent: ${clip(agent, 3000)}`,
    "",
    "Write the one message the developer is most likely to send next, in their own words, under 15 words.",
    "Reply with only that message: no quotes, no preamble. If nothing obvious comes next, reply NONE.",
  ].join("\n");
}
/** Cleans the model's answer to one line, or null for NONE or nothing usable. */
export function cleanSuggestion(text) {
  const t = String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  const s = t.replace(/^["'`]+|["'`]+$/g, "").replace(/^(developer|you|message)\s*:\s*/i, "").trim();
  if (!s || /^none\.?$/i.test(s) || s.length > 160) return null;
  return s;
}

/** chat.suggest: {text | null}. The same last answer gives the same suggestion without asking again. */
export async function chatSuggest({ session }, { config } = {}) {
  if (config && config.suggestPrompts === false) return { text: null, off: true };
  const sid = chatSessionOf(session);
  if (!oc.connected || !oc.api || !oc.api.promptWait || !oc.api.deleteSession) return { text: null };
  const list = await oc.api.messages(sid, 12);
  let you = "", agent = "", key = "";
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!agent && m.role === "assistant" && m.text) { agent = m.text; key = `${list.length}:${String(m.text).length}`; continue; }
    if (agent && m.role === "user" && m.text) { you = m.text; break; }
  }
  if (!agent) return { text: null };
  const was = suggested.get(sid);
  if (was && was.key === key) return { text: was.text };
  const names = oc.agents && oc.agents.size ? oc.agents : new Set(SUGGEST_AGENTS);
  const pick = SUGGEST_AGENTS.find((a) => names.has(a)) || null;
  let scratch = null, text = null;
  try {
    scratch = await oc.api.createSession("Workshop: suggested next prompt");
    text = cleanSuggestion(await oc.api.promptWait(scratch.id, { text: suggestPrompt(you, agent), agent: pick }));
  } catch (e) {
    log(`suggested prompt: ${e.message}`);
  } finally {
    if (scratch) oc.api.deleteSession(scratch.id).catch(() => {});
  }
  suggested.set(sid, { key, text });
  return { text };
}

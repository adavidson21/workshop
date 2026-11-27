// opencode connector: the permission prompt log (1.42.0). Every permission prompt opencode raises in this workspace,
// and the answer when it is known, is one JSON line in .work/_dashboard/prompts.jsonl. Builds' Health > Tandem reads
// the summary (tandem.health `permissions`): which prompts come up most, how they were answered, and which shell
// patterns you always allow, as lines to paste into eng-agents' personal/permissions/guards.json.
//
// Nothing here changes a permission. The log stays on this computer, next to the rest of the floor's state, and is
// trimmed to its newest half when it passes MAX_BYTES. Answers given in opencode's own window are logged only when
// opencode says what they were (1.x `permission.replied` with a reply); the rest count as unknown.

import fs from "node:fs";
import path from "node:path";

export const PROMPT_FILE = "prompts.jsonl";
export const MAX_BYTES = 512 * 1024;
/** A shell pattern asked about at least this often, never rejected and answered yes at least SUGGEST_YES times, is suggested. */
export const SUGGEST_MIN = 3;
export const SUGGEST_YES = 2;
// Never suggested, however often you allow them: pushes and publishes (your second gate), secrets and credentials,
// admin rights and machine-wide settings. Those stay prompts on purpose (eng-agents core/permissions/guards.json).
const NEVER_SUGGEST = /\bpush\b|\bpublish\b|credential|secret|\.env|\.ssh|\.aws|\.azure|\.npmrc|\bsudo\b|\brunas\b|-Verb RunAs|Set-ExecutionPolicy|\breg(\.exe)?\b|HKLM:|HKCU:|setx|SetEnvironmentVariable|\bnv:/i;

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const seenAsked = new Set();
const seenAnswered = new Set();

/** Forget which prompt ids were logged (a connector restart, tests). */
export function resetPromptLog() {
  seenAsked.clear();
  seenAnswered.clear();
}

function remember(set, id) {
  set.add(id);
  if (set.size > 5000) set.delete(set.values().next().value);
}

function append(dir, rec) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, PROMPT_FILE);
    fs.appendFileSync(file, JSON.stringify(rec) + "\n");
    if (fs.statSync(file).size > MAX_BYTES) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
      fs.renameSync(tmp, file);
    }
  } catch {} // best effort: a log that cannot be written never stops a prompt
}

/** The pattern a prompt is grouped by: opencode's own "always" pattern when it gives one, else the first pattern, else the title. */
export function promptKey(p) {
  const always = Array.isArray(p.always) ? p.always : [];
  const patterns = Array.isArray(p.patterns) ? p.patterns : [];
  return clip(always[0] || patterns[0] || p.title || "", 300);
}

/** Logs a prompt the first time its id is seen. `session` is {title, command} when known. */
export function logPrompt(dir, p, session = null, now = new Date()) {
  if (!p || !p.id || seenAsked.has(p.id)) return false;
  remember(seenAsked, p.id);
  append(dir, {
    at: now.toISOString(),
    kind: "asked",
    id: clip(p.id, 100),
    permission: clip(p.permission || "unknown", 40),
    key: promptKey(p),
    title: clip(p.title, 300),
    command: session && session.command ? clip(session.command, 60) : null,
  });
  return true;
}

/** Logs the answer to a prompt once: "once", "always" or "reject". `via` is "workshop" or "opencode". */
export function logAnswer(dir, id, reply, via = "workshop", now = new Date()) {
  if (!id || seenAnswered.has(id)) return false;
  const r = { allow: "once", deny: "reject" }[reply] || reply;
  if (!["once", "always", "reject"].includes(r)) return false;
  remember(seenAnswered, id);
  append(dir, { at: now.toISOString(), kind: "answered", id: clip(id, 100), reply: r, via });
  return true;
}

/**
 * The summary Builds shows: { total, groups: [{permission, key, asked, once, always, reject, unknown, last, command}],
 * suggest: [{key, asked}] } with groups most asked first (at most 15). `since` (YYYY-MM-DD) keeps prompts asked on or
 * after that day. A missing log is an empty summary.
 */
export function promptSummary(dir, { since = null } = {}) {
  const empty = { total: 0, groups: [], suggest: [] };
  if (!dir) return empty;
  let text = "";
  try {
    text = fs.readFileSync(path.join(dir, PROMPT_FILE), "utf8");
  } catch {
    return empty;
  }
  const asked = new Map(); // id -> record
  const answers = new Map(); // id -> reply
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== "object" || !r.id) continue;
    if (r.kind === "asked" && (!since || String(r.at || "").slice(0, 10) >= since)) asked.set(r.id, r);
    else if (r.kind === "answered") answers.set(r.id, r.reply);
  }
  const groups = new Map();
  for (const [id, r] of asked) {
    const k = `${r.permission}\u0000${r.key || ""}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { permission: r.permission, key: r.key || "", asked: 0, once: 0, always: 0, reject: 0, unknown: 0, last: null, command: null }));
    g.asked++;
    const a = answers.get(id);
    if (a === "once" || a === "always" || a === "reject") g[a]++;
    else g.unknown++;
    if (!g.last || String(r.at) > g.last) {
      g.last = String(r.at);
      g.command = r.command || g.command;
    }
  }
  const list = [...groups.values()].sort((a, b) => b.asked - a.asked || String(b.last).localeCompare(String(a.last)));
  const suggest = list
    .filter((g) => g.permission === "bash" && g.key && g.asked >= SUGGEST_MIN && g.reject === 0 && g.once + g.always >= SUGGEST_YES && !NEVER_SUGGEST.test(g.key))
    .map((g) => ({ key: g.key, asked: g.asked }));
  return { total: asked.size, groups: list.slice(0, 15), suggest };
}

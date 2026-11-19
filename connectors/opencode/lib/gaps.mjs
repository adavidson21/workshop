// opencode connector: knowledge gaps (1.21.0, eng-agents Core 4.9.0). What Tandem's agents needed to know and
// could not find, in .work/gaps.md, one line each, written only by eng-agents' Add-Gap.ps1 and Close-Gap.ps1:
//   - G<n> | <yyyy-mm-dd> | <kind> | <product> | <source> | <question> | <assumed> | open
//   - G<n> | ... | answered <yyyy-mm-dd>: <where the answer was written>
// <assumed> is "-" when the agent had no safe assumption and stopped: that build waits on the gap.
//
// Loom and Docket show open gaps as Teach cards. Answering one (gap.answer) runs Tandem's /teach, which writes
// the answer where it belongs and closes the line. Workshop never writes gaps.md; it keeps only which answers
// it sent, in .work/_dashboard/gaps.json, so the card shows "Saving" until /teach closes the line.

import fs from "node:fs";
import path from "node:path";
import { httpError, stateDir, workRoot } from "./context.mjs";

export const KINDS = ["fact", "term", "repo", "process"];
const LINE = /^-\s+G(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([a-z]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*(.+?)\s*$/;
const MAX = 200;
export const MAX_ANSWER = 500;

/** Parses gaps.md text. "-" reads as null; status is "open" or "answered" (with `where`). */
export function parseGaps(text) {
  const out = [];
  if (!text) return out;
  const dash = (v) => (!v || v === "-" ? null : v);
  for (const line of String(text).split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const st = m[8];
    const ans = /^answered\s+(\d{4}-\d{2}-\d{2}):\s*(.*)$/i.exec(st);
    out.push({
      id: `G${m[1]}`, n: Number(m[1]), date: m[2], kind: KINDS.includes(m[3]) ? m[3] : "fact",
      product: dash(m[4]), source: dash(m[5]), question: m[6], assumed: dash(m[7]),
      status: /^open$/i.test(st) ? "open" : "answered", answeredOn: ans ? ans[1] : null, where: ans ? ans[2] : null,
    });
  }
  return out;
}

const stateFile = () => path.join(stateDir, "gaps.json");
let sent = {}; // { "G3": { at, session } }: answers sent to /teach, not closed yet
let closedHooks = [];

export function loadGaps() {
  try {
    const d = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    sent = d && typeof d === "object" && d.sent && typeof d.sent === "object" ? d.sent : {};
  } catch {
    sent = {};
  }
}
export function resetGaps() {
  sent = {};
  closedHooks = [];
}
function save() {
  try {
    const tmp = stateFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, sent }, null, 2));
    fs.renameSync(tmp, stateFile());
  } catch {}
}

/** Called with a gap id when a gap Workshop sent an answer for is closed in gaps.md (autopilot resumes). */
export function onGapClosed(fn) {
  closedHooks.push(fn);
}

function readAll() {
  if (!workRoot) return [];
  try {
    return parseGaps(fs.readFileSync(path.join(workRoot, "gaps.md"), "utf8"));
  } catch {
    return [];
  }
}

// Answers sent whose line is now closed: forget them and tell the hooks.
function settle(all) {
  let changed = false;
  for (const id of Object.keys(sent)) {
    const g = all.find((x) => x.id === id);
    if (g && g.status === "open") continue;
    delete sent[id];
    changed = true;
    for (const fn of closedHooks) {
      try { fn(id); } catch {}
    }
  }
  if (changed) save();
}

/** For state: open gaps (newest first, with `sent` when an answer is on its way) and how many were answered. */
export function gapsData() {
  const all = readAll();
  settle(all);
  const open = all.filter((g) => g.status === "open").sort((a, b) => b.n - a.n).slice(0, MAX).map((g) => ({ ...g, sent: sent[g.id] ? sent[g.id].at : null }));
  return { open, answered: all.filter((g) => g.status === "answered").length };
}

/** The open gap with no safe assumption that a work item (by id, like L12 or 41207) stopped on, or null. */
export function holdingGap(itemId) {
  if (!itemId) return null;
  const id = String(itemId).toLowerCase();
  return readAll().filter((g) => g.status === "open" && !g.assumed && g.source && g.source.toLowerCase() === id).sort((a, b) => b.n - a.n)[0] || null;
}

/** One line for /teach: no newlines, at most MAX_ANSWER characters. */
export function cleanAnswer(text) {
  const t = String(text || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) throw httpError(400, "Write the answer first.");
  if (t.length > MAX_ANSWER) throw httpError(400, `Keep the answer to ${MAX_ANSWER} characters.`);
  return t;
}

/**
 * Sends an answer: runs `/teach <id> <answer>` with `run(name, args)` (workspace.mjs runLoose).
 * Refuses a gap that is not open, or one already being answered.
 */
export async function answerGap({ id, answer }, run) {
  const g = readAll().find((x) => x.id === id);
  if (!g) throw httpError(404, `No gap ${id}. Refresh the page.`);
  if (g.status !== "open") throw httpError(409, `${id} is already answered.`);
  if (sent[id]) throw httpError(409, `An answer to ${id} is already being saved.`);
  const text = cleanAnswer(answer);
  const r = await run("teach", `${id} ${text}`);
  sent[id] = { at: new Date().toISOString(), session: (r && r.session) || null };
  save();
  return { ok: true, id, session: (r && r.session) || null };
}

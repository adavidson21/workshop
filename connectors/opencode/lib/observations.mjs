// opencode connector: observations (eng-agents Core 4.8.0). Things Tandem's agents noticed out of scope, in
// .work/observations.md, one line each, written only by eng-agents' Add-Observation.ps1:
//   - O<n> | <yyyy-mm-dd> | <kind> | <repo> | <source> | <text>
// The file is the agents'; what you did with each one (dismissed, started as a Quick change, sent to Docket) is
// kept here, in .work/_dashboard/observations.json, so the file is never written by Workshop.

import fs from "node:fs";
import path from "node:path";
import { httpError, stateDir, workRoot } from "./context.mjs";

export const KINDS = ["bug", "debt", "docs", "tests", "idea"];
const LINE = /^-\s+O(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([a-z]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*(.+?)\s*$/;
const MAX = 500; // newest first, the rest are left out of state

/** Parses observations.md text. Unknown kinds read as "idea"; "-" reads as null. */
export function parseObservations(text) {
  const out = [];
  if (!text) return out;
  const dash = (v) => (!v || v === "-" ? null : v);
  for (const line of String(text).split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    out.push({ id: `O${m[1]}`, n: Number(m[1]), date: m[2], kind: KINDS.includes(m[3]) ? m[3] : "idea", repo: dash(m[4]), source: dash(m[5]), text: m[6] });
  }
  return out;
}

const stateFile = () => path.join(stateDir, "observations.json");
let decided = {}; // { "O3": { status: "dismissed" | "started" | "sent", at, folder? } }

export function loadObservations() {
  try {
    const d = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    decided = d && typeof d === "object" && d.decided && typeof d.decided === "object" ? d.decided : {};
  } catch {
    decided = {};
  }
}
export function resetObservations() {
  decided = {};
}
function save() {
  const tmp = stateFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, decided }, null, 2));
  fs.renameSync(tmp, stateFile());
}

function readAll() {
  if (!workRoot) return [];
  try {
    return parseObservations(fs.readFileSync(path.join(workRoot, "observations.md"), "utf8"));
  } catch {
    return [];
  }
}

/** For state: the open ones (newest first) and how many were handled. */
export function observationsData() {
  const all = readAll();
  const open = all.filter((o) => !decided[o.id]).sort((a, b) => b.n - a.n).slice(0, MAX);
  return { open, handled: all.length - all.filter((o) => !decided[o.id]).length };
}

export function findObservation(id) {
  const o = readAll().find((x) => x.id === id);
  if (!o) throw httpError(404, `No observation ${id}. Refresh the page.`);
  return o;
}

/** Records what you did with one. `status`: dismissed, started (with the folder) or sent (to Docket). */
export function decideObservation(id, status, extra = {}) {
  if (!["dismissed", "started", "sent"].includes(status)) throw httpError(400, "Bad status.");
  findObservation(id);
  decided[id] = { status, at: new Date().toISOString(), ...extra };
  save();
  return { ok: true, id, status };
}

/** A Quick change's start.local arguments from an observation. */
export function startArgs(o) {
  const lines = [o.text, "", `Noticed by Tandem (${o.id}, ${o.date}${o.source ? `, while working on ${o.source}` : ""}).`];
  if (o.repo) lines.push(`Repo: ${o.repo}`);
  return { title: o.text.length > 200 ? o.text.slice(0, 197) + "..." : o.text, description: lines.join("\n"), lane: "quick" };
}

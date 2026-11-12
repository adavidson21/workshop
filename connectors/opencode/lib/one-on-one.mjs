// opencode connector: the optional draft step of Rapport's 1:1s (js/oneonones in adavidson21/receipts). Not in the eng-agents live
// server; Workshop only.
//
// oneonone.draft saves the app's packet (Markdown, people data) as packet.md in this connector's own storage
// folder, <Workshop home>/data/_connectors/opencode/oneonones/<personId>-<date>/, never in the code workspace
// or .work, and runs Tandem's /one-on-one <path to packet.md> in a new session (eng-agents Core 2.8.0). The
// people-prep agent writes draft.md next to it. oneonone.result reads that back.
//
// oneonone.tidy does the same for Rapport's Tidy notes: the note's rough lines go in notes.md in a folder of
// their own, <personId>-<date>-tidy/, and the same people-prep agent is asked (a plain message, no Tandem
// command) to write draft.md there with a Follow-ups and a Wins section. oneonone.tidyResult reads it back.

import fs from "node:fs";
import path from "node:path";
import { ctx, httpError, log } from "./context.mjs";
import { sessions } from "./opencode-state.mjs";
import { promptLoose, runLoose } from "./workspace.mjs";

export const MAX_PACKET_BYTES = 51200; // about 50 KB
export const MAX_NOTES_BYTES = 20480; // about 20 KB of rough 1:1 notes
export const TIDY_AGENT = "people-prep";
const MAX_DRAFT_BYTES = 200000;
export const PERSON_ID = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

// folder name -> opencode session id of the last draft run, for this start of the connector.
const runs = new Map();
export function resetOneOnOnes() {
  runs.clear();
}

/** The connector's own folder for 1:1 packets (docs/connector.md, ctx.storage lives in the same place). */
export function oneOnOneRoot(home = ctx && ctx.home) {
  if (!home) throw httpError(503, "The opencode connector is not ready yet.");
  return path.join(home, "data", "_connectors", "opencode", "oneonones");
}

/** The folder for one person and day (`suffix` "-tidy" for Tidy notes). Refuses anything that is not a plain
    id and date. */
export function folderFor({ personId, date }, root, suffix = "") {
  if (!PERSON_ID.test(String(personId || ""))) throw httpError(400, "That is not a 1:1s person id.");
  if (!DAY.test(String(date || ""))) throw httpError(400, "The date must be YYYY-MM-DD.");
  return path.join(root, `${personId}-${date}${suffix}`);
}

const busy = (sid) => !!(sid && sessions.get(sid) && sessions.get(sid).status !== "idle");

/**
 * Save the packet and run /one-on-one on it in a new session. Any draft.md from an earlier run is removed
 * first, so oneonone.result never returns a stale draft. Refused while a draft for the same 1:1 runs.
 */
export async function draftOneOnOne({ personId, date, packet }, { root = oneOnOneRoot(), start = runLoose } = {}) {
  const dir = folderFor({ personId, date }, root);
  const name = path.basename(dir);
  const text = String(packet || "");
  if (!text.trim()) throw httpError(400, "The packet is empty.");
  if (Buffer.byteLength(text, "utf8") > MAX_PACKET_BYTES) throw httpError(400, "The packet is over 50 KB. Shorten the period or the notes and try again.");
  if (busy(runs.get(name))) throw httpError(409, "A draft for this 1:1 is already running.");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "packet.md");
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.rmSync(path.join(dir, "draft.md"), { force: true });
  const r = await start("one-on-one", file, null);
  runs.set(name, r.session);
  log(`1:1 draft ${name} started in ${r.session}`);
  return { session: r.session, folder: name };
}

/**
 * Where the draft is: {state: 'none'} (never asked), 'running', 'done' with `text`, or 'failed' with `error`.
 */
export function oneOnOneResult({ personId, date }, { root = oneOnOneRoot(), suffix = "" } = {}) {
  const dir = folderFor({ personId, date }, root, suffix);
  const sid = runs.get(path.basename(dir));
  const draft = path.join(dir, "draft.md");
  if (busy(sid)) return { state: "running", session: sid };
  if (fs.existsSync(draft)) {
    const buf = fs.readFileSync(draft);
    return { state: "done", text: buf.subarray(0, MAX_DRAFT_BYTES).toString("utf8"), ...(sid ? { session: sid } : {}) };
  }
  if (!sid) return { state: "none" };
  const s = sessions.get(sid);
  return { state: "failed", session: sid, error: (s && s.error) || "The step ended without writing draft.md. Check its session in Dispatch." };
}

/** The message for people-prep: tidy notes.md into draft.md. Plain words, so no Tandem command is needed. */
export function tidyPrompt(notesFile) {
  const draft = path.join(path.dirname(notesFile), "draft.md");
  return [
    `Tidy the rough notes from a 1:1 at ${notesFile}. This is not a talking points draft.`,
    "",
    "- Read that notes.md. Do not open any other file.",
    `- Write ${draft} (replace it if it is there) with exactly two sections, in this order:`,
    "  - `## Follow-ups`: one task line per action someone agreed to. `- [ ] (me) <what>` when the manager does it, `- [ ] (them) <what>` when the person they met does it. The notes call that person \"them\".",
    "  - `## Wins`: one bullet per thing that person finished or did well: `- <what>`.",
    "- Under a heading with nothing for it, write `Nothing in the notes.`",
    "- Only facts from the notes, short, in the notes' own words. Never add a rating, a judgment, a date or a name that is not in the notes.",
    `- Reply with one line: Tidied notes written to ${draft}.`
  ].join("\n");
}

/**
 * Save the note's rough lines and ask people-prep to tidy them in a new session. Any draft.md from an earlier
 * run is removed first. Refused while a tidy for the same 1:1 runs.
 */
export async function tidyOneOnOne({ personId, date, notes }, { root = oneOnOneRoot(), start = promptLoose } = {}) {
  const dir = folderFor({ personId, date }, root, "-tidy");
  const name = path.basename(dir);
  const text = String(notes || "");
  if (!text.trim()) throw httpError(400, "The note is empty.");
  if (Buffer.byteLength(text, "utf8") > MAX_NOTES_BYTES) throw httpError(400, "The note is over 20 KB. Tidy a shorter part of it.");
  if (busy(runs.get(name))) throw httpError(409, "Tidy notes for this 1:1 is already running.");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "notes.md");
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.rmSync(path.join(dir, "draft.md"), { force: true });
  const r = await start("Tidy 1:1 notes", tidyPrompt(file), TIDY_AGENT);
  runs.set(name, r.session);
  log(`1:1 tidy ${name} started in ${r.session}`);
  return { session: r.session, folder: name };
}

/** Where a tidy is, like oneOnOneResult. */
export const tidyResult = (args, opts = {}) => oneOnOneResult(args, { ...opts, suffix: "-tidy" });

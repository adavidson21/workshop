// opencode connector: Writing voice (Settings, Writing; docs/writing.md). Workshop only, not in the eng-agents
// live server.
//
// voice.run sends one prompt that Settings built (style guide, samples, rules, the draft) to opencode in a new
// session, with the read-only "plan" agent when opencode has one, so a draft that happens to contain
// instructions cannot make the agent edit files or run commands. voice.result reads the reply back: the last
// assistant message of that session. Nothing is written to disk here; the samples and rules are Settings' data.

import { httpError, log } from "./context.mjs";
import { needAi } from "./chat.mjs";
import { oc, sessions, upsertSession } from "./opencode-state.mjs";

export const MAX_PROMPT = 60000; // characters
export const KINDS = ["style", "rewrite", "learn"];
const TITLES = { style: "Writing: build style guide", rewrite: "Writing: rewrite a draft", learn: "Writing: learn from an edit" };
const MAX_REPLY = 40000;
export const READ_ONLY_AGENT = "plan";

// session id -> {kind, at}, for this start of the connector.
const runs = new Map();
export function resetVoice() {
  runs.clear();
}

const busy = (sid) => !!(sid && sessions.get(sid) && sessions.get(sid).status !== "idle");

/** The agent to use: opencode's read-only "plan", else Tandem's read-only "chat", else opencode's default. */
export function agentFor(agents) {
  if (agents && agents.has(READ_ONLY_AGENT)) return READ_ONLY_AGENT;
  if (agents && agents.has("chat")) return "chat";
  return undefined;
}

/** Start a Writing run. `prompt` is the whole message; Settings builds it (apps/settings/js/voice-model.js). */
export async function runVoice({ kind, prompt }, { config } = {}) {
  needAi(config);
  if (!KINDS.includes(kind)) throw httpError(400, "Unknown Writing step.");
  const text = String(prompt || "").trim();
  if (!text) throw httpError(400, "The prompt is empty.");
  if (text.length > MAX_PROMPT) throw httpError(400, "That is too much text at once. Remove some samples or shorten the draft.");
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
  const title = TITLES[kind];
  const created = await oc.api.createSession(title);
  const sid = created.id;
  upsertSession(sid, { title: created.title || title, status: "busy", busySince: Date.now(), activity: `Starting ${title}`, error: null, text: null, command: title });
  runs.set(sid, { kind, at: Date.now() });
  try {
    await oc.api.prompt(sid, text, agentFor(oc.agents));
  } catch (e) {
    upsertSession(sid, { status: "idle", activity: null, error: `${title}: ${e.message}` });
    throw e;
  }
  log(`writing ${kind} started in ${sid}`);
  return { session: sid };
}

/** Where a run is: 'running', 'done' with `text` (the agent's last reply), or 'failed' with `error`. */
export async function voiceResult({ session }, { config } = {}) {
  needAi(config);
  if (!runs.has(session)) throw httpError(404, "That Writing run is not known. Start it again.");
  if (busy(session)) return { state: "running" };
  const s = sessions.get(session);
  if (s && s.error) return { state: "failed", error: s.error };
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
  const turns = await oc.api.messages(session, 20);
  const last = turns.filter((m) => m.role === "assistant" && m.text).pop();
  if (!last) return { state: "failed", error: "The agent ended without a reply. Try again." };
  return { state: "done", text: last.text.slice(0, MAX_REPLY) };
}

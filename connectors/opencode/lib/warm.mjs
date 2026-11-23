// opencode connector: warm up (1.41.0). Why a new chat's first answer came in bursts.
//
// opencode loads its plugins and model catalog during the first answer after it starts (45 plugin.added events,
// then catalog.updated), and that work stops its text deltas for about a second, two or three times, so the answer
// arrives in bursts. Every answer after that streams smoothly, new chats included. A local model server has its own
// cold start too: Ollama unloads a model after 5 idle minutes, and loading it again takes seconds before any text.
//
// So the connector asks for one tiny answer in a scratch session, in the background: once when opencode connects
// (both cold starts happen there, not in your first chat), and again when Chat opens after a local model has been
// idle long enough to be unloaded. The scratch session is deleted afterwards. It uses opencode's read-only `plan`
// agent with its tools on: a warm up with tools switched off loads the plugins but leaves the tool setup for your
// first answer, which then still pauses (measured with opencode 1.19.6). `plan` cannot change files.
import { log } from "./context.mjs";
import { oc, sessionEvents, sessions } from "./opencode-state.mjs";

export const WARM_TEXT = "Reply with the single word OK. Do not use any tools.";
export const WARM_TITLE = "Workshop: warming up";
/** Ollama keeps a model loaded for 5 minutes by default; warm again a little before that. */
export const LOCAL_IDLE_MS = 4 * 60 * 1000;
/** A warm up never waits longer than this for its answer. */
export const WARM_TIMEOUT = 120000;

let lastActive = 0; // the last time any session started or finished a turn (the model was in use)
let warming = null; // the warm up in flight
let warmedAt = 0;
let onActivity = null;

/** Remember model activity, so Chat does not warm a model that is already loaded. */
export function watchActivity() {
  if (onActivity) return;
  onActivity = () => { lastActive = Date.now(); };
  sessionEvents.on("busy", onActivity);
  sessionEvents.on("idle", onActivity);
}

export function resetWarm() {
  if (onActivity) {
    sessionEvents.off("busy", onActivity);
    sessionEvents.off("idle", onActivity);
  }
  onActivity = null;
  lastActive = 0;
  warming = null;
  warmedAt = 0;
}

/** Is any session working right now? Then the model is warm and a warm up would only queue behind it. */
function anyBusy() {
  for (const s of sessions.values()) if (s && s.status === "busy") return true;
  return false;
}

/**
 * Should a warm up run? `reason` is "connect" (opencode just connected: always, once per connection) or "open"
 * (Chat opened: only for a local model, and only when nothing used it for LOCAL_IDLE_MS). Pure, for tests.
 */
export function needWarm({ reason, local, now, lastActive: active, warmedAt: warmed, busy, off }) {
  if (off || busy) return false;
  if (reason === "connect") return true;
  if (!local) return false;
  const last = Math.max(active || 0, warmed || 0);
  return now - last >= LOCAL_IDLE_MS;
}

/**
 * Run one warm up in the background. Never throws; resolves {warmed, ms} or {skipped}. `api` is opencode's adapter
 * (needs createSession, promptWait and deleteSession); `agents` the agent names opencode reported.
 */
export function warmUp({ reason = "connect", local = false, off = false, now = Date.now(), api = oc.api, agents = oc.agents, busy = anyBusy() } = {}) {
  if (warming) return warming;
  if (!api || !api.createSession || !api.promptWait || !api.deleteSession) return Promise.resolve({ skipped: "unsupported" });
  if (!needWarm({ reason, local, now, lastActive, warmedAt, busy, off })) return Promise.resolve({ skipped: "not needed" });
  const agent = agents && agents.has && agents.has("plan") ? "plan" : null;
  warming = (async () => {
    const start = Date.now();
    let scratch = null;
    try {
      scratch = await api.createSession(WARM_TITLE);
      await api.promptWait(scratch.id, { text: WARM_TEXT, agent, tools: agent ? null : { "*": false }, timeout: WARM_TIMEOUT });
      warmedAt = Date.now();
      log(`warmed up opencode and the model in ${warmedAt - start} ms (${reason})`);
      return { warmed: true, ms: warmedAt - start };
    } catch (e) {
      log(`warm up: ${e.message}`);
      return { warmed: false, error: e.message };
    } finally {
      if (scratch) api.deleteSession(scratch.id).catch(() => {});
      warming = null;
    }
  })();
  return warming;
}

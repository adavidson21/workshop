// opencode connector: conversations from Dispatch (Workshop docs/chat.md). Workshop only, not in the eng-agents
// live server.
//
// Two kinds of conversation, both with Tandem's read-only `chat` agent (eng-agents Core 2.14.0):
// - "you": an ad hoc chat started from Dispatch's Chat tab (chat.start).
// - "hub": a hub message's session (hub.run) that you follow up on from its card (chat.send).
// Every message names agent "chat", so a follow-up never goes to opencode's default agent, which can edit code.
//
// The list of conversations is kept in this connector's own folder, <Workshop home>/data/_connectors/opencode/
// chats.json (mode 0600), so a thread can go on after a restart. The turns themselves stay in opencode.
// Everything is refused unless the connector's `hub` setting is on: one AI switch for the hub and chats.

import fs from "node:fs";
import path from "node:path";
import { ctx, httpError, log } from "./context.mjs";
import { broadcastLive } from "./live.mjs";
import { oc, permissions, questions, sessions, upsertSession } from "./opencode-state.mjs";

export const AGENT = "chat";
export const KEEP = 100;
export const MAX_TEXT = 20000;
export const MAX_TURNS = 100;
const TITLE_MAX = 80;

let chats = null; // session id -> {session, from, title, hub?, intent?, at, last, replies, hidden?, renamed?}
let fileOverride = null;
let hubDirOverride = null;

/** Tests point the list at a temp file (and the hub requests at a temp folder). */
export function resetChats(file = null, hubDir = null) {
  chats = null;
  fileOverride = file;
  hubDirOverride = hubDir;
}
function chatFile() {
  if (fileOverride) return fileOverride;
  if (!ctx || !ctx.home) throw httpError(503, "The opencode connector is not ready yet.");
  return path.join(ctx.home, "data", "_connectors", "opencode", "chats.json");
}
function load() {
  if (chats) return chats;
  chats = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(chatFile(), "utf8"));
    for (const c of Array.isArray(d.items) ? d.items : []) {
      if (c && typeof c.session === "string" && (c.from === "you" || c.from === "hub")) chats.set(c.session, c);
    }
  } catch { /* none yet */ }
  return chats;
}
function save() {
  const items = [...load().values()].sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, KEEP);
  chats = new Map(items.map((c) => [c.session, c]));
  const f = chatFile();
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/* A hub message's intent (ask, capture, go, act, clarify) from its route.json, read loosely: Dispatch checks the
   route itself. hub.mjs records it through noteIntent once it reads the route; this covers runs from before 1.9.0. */
function hubDir() {
  if (hubDirOverride) return hubDirOverride;
  return ctx && ctx.home ? path.join(ctx.home, "data", "_connectors", "opencode", "hub") : null;
}
function routeIntent(id) {
  const dir = hubDir();
  if (!dir || !/^[a-z0-9][a-z0-9_-]{2,59}$/.test(String(id || ""))) return null;
  try {
    const m = /"intent"\s*:\s*"([a-z]+)"/.exec(fs.readFileSync(path.join(dir, id, "route.json"), "utf8").slice(0, 64000));
    return m ? m[1] : null;
  } catch { return null; }
}
/** hub.result calls this when it has read a route, so the Chat list can leave captures and go out. */
export function noteIntent(hubId, intent) {
  if (typeof intent !== "string" || !intent) return;
  let changed = false;
  for (const c of load().values()) if (c.hub === hubId && c.intent !== intent) { c.intent = intent; changed = true; }
  if (changed) try { save(); } catch (e) { log(`chat list not saved: ${e.message}`); }
}
/** Captures and go are done on the page; everything else from the hub is a conversation. */
const NOT_A_CHAT = new Set(["capture", "go"]);
function isChat(c) {
  if (c.hidden) return false;
  if (c.from === "you" || c.replies > 0) return true;
  if (!c.intent) { const i = routeIntent(c.hub); if (i) c.intent = i; }
  return !NOT_A_CHAT.has(c.intent);
}

const titleOf = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || "Chat";

/** Refuses unless the `hub` setting is on. */
export function needAi(config = ctx && ctx.config) {
  if (!config || config.hub !== true) throw httpError(503, "AI is off. Turn on Hub in the opencode connector's settings (Workshop on this computer).");
}
function needChat() {
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
  if (oc.agents.size && !oc.agents.has(AGENT)) throw httpError(400, `opencode has no ${AGENT} agent. Run the Tandem install command again (eng-agents Core 2.14.0), then restart opencode.`);
}
function cleanText(text) {
  const t = String(text || "").trim();
  if (!t) throw httpError(400, "Type a message first.");
  if (t.length > MAX_TEXT) throw httpError(400, `The message is over ${MAX_TEXT} characters.`);
  return t;
}
function known(session) {
  const c = load().get(String(session || ""));
  if (!c) throw httpError(404, "That is not a hub thread or chat from Dispatch.");
  return c;
}
const busy = (sid) => !!(sessions.get(sid) && sessions.get(sid).status !== "idle");
const waiting = (sid) => [...permissions.values()].some((p) => p.sessionID === sid) || [...questions.values()].some((q) => q.sessionID === sid);

/** hub.run calls this, so a hub thread can be followed up even after the connector restarts. */
export function recordHub(session, id, text, now = Date.now()) {
  load().set(session, { session, from: "hub", hub: id, title: titleOf(text), at: now, last: now, replies: 0 });
  try { save(); } catch (e) { log(`chat list not saved: ${e.message}`); }
}

async function send(session, text) {
  await oc.api.prompt(session, text, AGENT);
  upsertSession(session, { status: "busy", busySince: Date.now(), activity: "Reading your message", error: null, text: null });
  broadcastLive();
}

/** A new ad hoc chat: a new session, first message to the chat agent. */
export async function startChat({ text }, { config, now = Date.now() } = {}) {
  needAi(config);
  const t = cleanText(text);
  needChat();
  const created = await oc.api.createSession(titleOf(t));
  const sid = created.id;
  load().set(sid, { session: sid, from: "you", title: titleOf(t), at: now, last: now, replies: 0 });
  save();
  await send(sid, t);
  log(`chat started in ${sid}`);
  return { session: sid };
}

/** The next message in a hub thread or chat. Refused while the agent is still answering. */
export async function sendChat({ session, text }, { config, now = Date.now() } = {}) {
  needAi(config);
  const c = known(session);
  const t = cleanText(text);
  needChat();
  if (busy(c.session)) throw httpError(409, "Tandem is still answering. Wait for it, or stop it first.");
  await send(c.session, t);
  c.last = now;
  c.replies = (c.replies || 0) + 1;
  save();
  return { ok: true };
}

/**
 * The turns of a hub thread or chat, oldest first, text only: [{role: "you" | "tandem", text, at}]. For a hub
 * thread the /hub run itself (the command and its routing reply) is left out: the card already shows it.
 */
export async function chatMessages({ session }, { config } = {}) {
  needAi(config);
  const c = known(session);
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
  let turns = await oc.api.messages(c.session, MAX_TURNS * 2);
  if (c.from === "hub") {
    const first = turns.findIndex((m) => m.role === "user");
    let i = first < 0 ? 0 : first + 1;
    while (i < turns.length && turns[i].role === "assistant") i++;
    turns = turns.slice(i);
  }
  const s = sessions.get(c.session);
  return {
    session: c.session,
    from: c.from,
    title: c.title,
    busy: busy(c.session),
    waiting: waiting(c.session),
    ...(s && s.error ? { error: s.error } : {}),
    turns: turns.filter((m) => m.text).slice(-MAX_TURNS).map((m) => ({ role: m.role === "user" ? "you" : "tandem", text: m.text.slice(0, MAX_TEXT), at: m.at })),
  };
}

/**
 * Conversations for the Chat tab, newest activity first: every chat you started, and every hub message that is not
 * a capture or go (Connector 1.9.0; before, only hub threads you followed up on). With `hubs: true`, the newest HUB_RECENT hub threads instead (followed up or not), so Dispatch can show its
 * hub cards again after a reload.
 */
export const HUB_RECENT = 12;
export function listChats({ config, hubs = false } = {}) {
  needAi(config);
  if (hubs) {
    const items = [...load().values()].filter((c) => c.from === "hub").sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, HUB_RECENT)
      .map((c) => ({ session: c.session, from: c.from, title: c.title, at: c.at, last: c.last, replies: c.replies || 0, hub: c.hub, busy: busy(c.session), waiting: waiting(c.session) }));
    return { items };
  }
  const items = [...load().values()]
    .filter(isChat)
    .sort((a, b) => (b.last || 0) - (a.last || 0))
    .map((c) => ({ session: c.session, from: c.from, title: c.title, at: c.at, last: c.last, replies: c.replies || 0, busy: busy(c.session), waiting: waiting(c.session),
      ...(c.hub ? { hub: c.hub } : {}), ...(c.intent ? { intent: c.intent } : {}) }));
  return { items };
}

/** Stops listing a conversation in the Chat tab. The opencode session is kept. */
export function removeChat({ session }, { config } = {}) {
  needAi(config);
  const c = known(session);
  if (c.from === "hub") c.hidden = true;
  else load().delete(c.session);
  save();
  return { ok: true };
}

/** Renames a conversation in the Chat tab (Dispatch's list only; the opencode session keeps its own title). */
export function renameChat({ session, title }, { config } = {}) {
  needAi(config);
  const c = known(session);
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) throw httpError(400, "Type a name first.");
  c.title = t.slice(0, TITLE_MAX);
  save();
  return { ok: true, title: c.title };
}

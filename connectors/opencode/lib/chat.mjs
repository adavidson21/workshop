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

let chats = null; // session id -> {session, from, title, hub?, at, last, replies}
let fileOverride = null;

/** Tests point the list at a temp file. */
export function resetChats(file = null) {
  chats = null;
  fileOverride = file;
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
 * Conversations for the Chat tab, newest activity first: every chat you started, and hub threads you followed up
 * on. With `hubs: true`, the newest HUB_RECENT hub threads instead (followed up or not), so Dispatch can show its
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
    .filter((c) => !c.hidden && (c.from === "you" || c.replies > 0))
    .sort((a, b) => (b.last || 0) - (a.last || 0))
    .map((c) => ({ session: c.session, from: c.from, title: c.title, at: c.at, last: c.last, busy: busy(c.session), waiting: waiting(c.session), ...(c.hub ? { hub: c.hub } : {}) }));
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

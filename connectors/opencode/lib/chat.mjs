// opencode connector: the Chat app's conversations with opencode (Workshop docs/chat.md). Workshop only, not in the
// eng-agents live server.
//
// Since connector 1.15.0 Chat works like the opencode TUI: any agent (build, plan, Tandem's agents), any model of a
// connected provider, slash commands, !shell, @file, undo and redo, compact, and every session in the workspace,
// with tool calls, diffs and permission prompts shown in the thread. opencode's own permission settings decide what
// an agent may do, exactly as in the terminal. Chat only ever acts on a message you send or a button you click.
//
// Three kinds of conversation in the list:
// - "you": a chat started from Chat (chat.start, chat.command, chat.shell without a session).
// - "hub": a hub message's session (hub.run) that you follow up on.
// - "oc": any other opencode session in the workspace that you opened from All sessions and sent a message in.
// And one kept out of it: "side", a side chat (chat.side, connector 1.26.0): a copy of a chat so far (opencode's
// fork) for questions that should not land in that chat. One per chat; its turns are shown from the copy point on.
//
// A message can carry pasted images (connector 1.26.0): PNG, JPEG, GIF or WebP, sent to opencode as data URLs, at
// most MAX_IMAGES and MAX_IMAGE_DATA base64 characters together (the agent takes 1 MB per request; Chat shrinks
// big pictures before sending). chat.image reads one back for the thread, so turns never carry the pictures.
// A message with no agent named goes to opencode's default agent (build unless your opencode config says
// otherwise); a hub thread's follow-ups default to Tandem's read-only `chat` agent.
//
// The list is kept in the data folder, <dataDir>/chat/chats.json (mode 0600), so a thread can go on after a
// restart and the list stays with your data when Workshop is removed. Before connector 1.18.0 it was in
// <Workshop home>/data/_connectors/opencode/chats.json; the first load copies that once and keeps the old file. The turns themselves stay in opencode. Since 1.17.0 there is no
// separate AI switch: turning the connector off in Settings is the off switch.

import fs from "node:fs";
import path from "node:path";
import { ctx, httpError, inWorkspace, log, opt } from "./context.mjs";
import { broadcastLive } from "./live.mjs";
import { oc, permissions, questions, sessions, upsertSession } from "./opencode-state.mjs";
import { IMAGE_URL } from "./chat-parts.mjs";

/** Hub threads' follow-ups default to this read-only agent (eng-agents Core 2.14.0). */
export const AGENT = "chat";
export const MAX_FILES = 20;
export const MAX_ALL = 200;
export const KEEP = 100;
export const MAX_TEXT = 20000;
export const MAX_TURNS = 100;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_DATA = 920000;
/** A side chat's agent unless you pick one: Tandem's read-only chat agent, else opencode's plan agent. */
export const SIDE_AGENTS = ["chat", "plan"];
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
/** Where the list was kept before connector 1.18.0, in the Workshop home. */
export function oldChatFile(home = ctx && ctx.home) {
  return home ? path.join(home, "data", "_connectors", "opencode", "chats.json") : null;
}
function chatFile() {
  if (fileOverride) return fileOverride;
  if (!ctx || !ctx.home) throw httpError(503, "The opencode connector is not ready yet.");
  return ctx.dataDir ? path.join(ctx.dataDir, "chat", "chats.json") : oldChatFile();
}
/** Copy the list from the Workshop home into the data folder once. The old file is kept, never changed. */
export function moveOldChats(to, from) {
  if (!from || from === to || fs.existsSync(to) || !fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(to, 0o600); } catch { /* Windows */ }
  return true;
}
function load() {
  if (chats) return chats;
  chats = new Map();
  if (!fileOverride) {
    try { if (moveOldChats(chatFile(), oldChatFile())) log("chat list copied into the data folder (chat/chats.json); the old copy is kept"); }
    catch (e) { log(`chat list not copied: ${e.message}`); }
  }
  try {
    const d = JSON.parse(fs.readFileSync(chatFile(), "utf8"));
    for (const c of Array.isArray(d.items) ? d.items : []) {
      if (c && typeof c.session === "string" && (c.from === "you" || c.from === "hub" || c.from === "oc" || c.from === "side")) chats.set(c.session, c);
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
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/* A hub message's intent (ask, capture, go, act, clarify) from its route.json, read loosely: Dispatch checks the
   route itself. hub.mjs records it through noteIntent once it reads the route; this covers runs from before 1.9.0. */
function hubDir() {
  if (hubDirOverride) return hubDirOverride;
  return ctx && ctx.home ? hubRoot() : null;
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
  if (c.hidden || c.from === "side") return false;
  if (c.from === "you" || c.from === "oc" || c.replies > 0) return true;
  if (!c.intent) { const i = routeIntent(c.hub); if (i) c.intent = i; }
  return !NOT_A_CHAT.has(c.intent);
}

const titleOf = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || "Chat";

/**
 * Since connector 1.17.0 AI is on whenever this connector is on: the old `hub` setting is no longer read (turn the
 * connector off in Settings to stop it). Kept as the one place to add a check again.
 */
export function needAi() {}
/** opencode must be connected; a named agent must be one opencode has (when it lists them). */
function needOc() {
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
}
const AGENT_RE = /^[A-Za-z0-9._-]{1,64}$/;
function cleanAgent(agent) {
  if (agent == null || agent === "") return null;
  const a = String(agent);
  if (!AGENT_RE.test(a)) throw httpError(400, "Bad agent name.");
  if (oc.agents.size && !oc.agents.has(a)) {
    if (a === AGENT) throw httpError(400, `opencode has no ${AGENT} agent. Run the Tandem install command again (eng-agents Core 2.14.0), then restart opencode.`);
    throw httpError(400, `opencode has no agent named ${a}.`);
  }
  return a;
}
const MODEL_PART = /^[A-Za-z0-9._:@/+-]{1,200}$/;
function cleanModel(model) {
  if (model == null || model === "") return null;
  const m = typeof model === "string" ? { provider: model.split("/")[0], id: model.split("/").slice(1).join("/") } : model;
  if (!m || !MODEL_PART.test(String(m.provider || "")) || !MODEL_PART.test(String(m.id || ""))) throw httpError(400, "Bad model.");
  return { provider: String(m.provider), id: String(m.id) };
}
/** @path mentions: workspace files only, sent as absolute paths. */
function cleanFiles(files) {
  if (files == null) return [];
  if (!Array.isArray(files) || files.length > MAX_FILES) throw httpError(400, `Up to ${MAX_FILES} files.`);
  const root = opt && opt.workspace;
  return files.map((f) => {
    const s = String(f || "").trim();
    if (!s || s.length > 500 || s.includes("\0") || !root) throw httpError(400, "Bad file.");
    const full = path.resolve(root, s);
    if (!inWorkspace(full)) throw httpError(400, `${s} is not in the workspace.`);
    return full;
  });
}
/* Pasted images: the type each says it is must match its first bytes, as the agent's files API checks. */
const MAGIC = {
  "image/png": (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.length >= 6 && b.subarray(0, 4).toString("latin1") === "GIF8",
  "image/webp": (b) => b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
export function cleanImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw httpError(400, `Up to ${MAX_IMAGES} images in one message.`);
  let total = 0;
  return images.map((im, i) => {
    const mime = String((im && im.mime) || "");
    const data = String((im && im.data) || "");
    if (!MAGIC[mime]) throw httpError(400, "Images must be PNG, JPEG, GIF or WebP.");
    if (!data || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw httpError(400, "That image could not be read.");
    total += data.length;
    if (total > MAX_IMAGE_DATA) throw httpError(413, "Those images are too big together. Send fewer or smaller ones.");
    if (!MAGIC[mime](Buffer.from(data.slice(0, 32), "base64"))) throw httpError(400, "That image is not the type it says it is.");
    const name = String((im && im.name) || "").replace(/[^A-Za-z0-9 ._()-]/g, "").trim().slice(0, 80) || `image-${i + 1}.${EXT[mime]}`;
    return { mime, data, name };
  });
}
function cleanText(text) {
  const t = String(text || "").trim();
  if (!t) throw httpError(400, "Type a message first.");
  if (t.length > MAX_TEXT) throw httpError(400, `The message is over ${MAX_TEXT} characters.`);
  return t;
}
/** A conversation in the list, or any opencode session in the workspace (All sessions). */
function known(session) {
  const sid = String(session || "");
  const c = load().get(sid);
  if (c) return c;
  if (sid && sessions.has(sid)) return { session: sid, from: "oc", title: (sessions.get(sid) || {}).title || "Session", unlisted: true };
  throw httpError(404, "That is not a chat or an opencode session in this workspace.");
}
/** Sending in a session from All sessions lists it. */
function adopt(c, now) {
  if (!c.unlisted) return c;
  const e = { session: c.session, from: "oc", title: titleOf(c.title), at: now, last: now, replies: 0 };
  load().set(c.session, e);
  return e;
}
const busy = (sid) => !!(sessions.get(sid) && sessions.get(sid).status !== "idle");
/** The session and the subagent sessions under it (their permission prompts belong to this chat). */
function family(sid) {
  const out = new Set([sid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of sessions.values()) if (s.parent && out.has(s.parent) && !out.has(s.id)) { out.add(s.id); grew = true; }
  }
  return out;
}
function promptsFor(sid) {
  const fam = family(sid);
  const list = [];
  for (const p of permissions.values()) if (fam.has(p.sessionID)) list.push({ kind: "permission", id: p.id, session: p.sessionID, permission: p.permission || "", title: p.title || "", patterns: (p.patterns || []).slice(0, 20), always: (p.always || []).slice(0, 20), message: p.message || null });
  for (const q of questions.values()) if (fam.has(q.sessionID)) list.push({ kind: "question", id: q.id, session: q.sessionID, title: q.title || "", questions: q.questions || [] });
  return list;
}
const waiting = (sid) => promptsFor(sid).length > 0;

/** hub.run calls this, so a hub thread can be followed up even after the connector restarts. */
export function recordHub(session, id, text, now = Date.now()) {
  load().set(session, { session, from: "hub", hub: id, title: titleOf(text), at: now, last: now, replies: 0 });
  try { save(); } catch (e) { log(`chat list not saved: ${e.message}`); }
}

function markBusy(sid, activity) {
  upsertSession(sid, { status: "busy", busySince: Date.now(), activity, error: null, text: null });
  broadcastLive();
}
/** For calls opencode answers only when the agent finishes: the error, if any, lands on the session. */
function later(sid, promise) {
  Promise.resolve(promise).then((r) => {
    if (r && r.ok === false) { upsertSession(sid, { status: "idle", activity: null, error: `opencode: ${errOf(r)}` }); broadcastLive(); }
  }, (e) => { if (e && e.name !== "AbortError") { upsertSession(sid, { status: "idle", activity: null, error: e.message }); broadcastLive(); } });
}
function errOf(r) {
  const d = r && r.data;
  const m = d && typeof d === "object" ? d.message || (d.data && d.data.message) || d.name : null;
  return m ? String(m).slice(0, 300) : `HTTP ${r ? r.status : "?"}`;
}

async function send(session, { text, agent, model, files, images }) {
  if (images && images.length && oc.kind !== "v1") throw httpError(501, "This opencode cannot take pasted images from Chat.");
  if (oc.api.promptRich) await oc.api.promptRich(session, { text, agent, model, files, images });
  else await oc.api.prompt(session, text, agent);
  markBusy(session, "Reading your message");
}
function opts(args, { forHub = false } = {}) {
  const agent = cleanAgent(args.agent != null && args.agent !== "" ? args.agent : forHub ? AGENT : null);
  return { agent, model: cleanModel(args.model), files: cleanFiles(args.files), images: cleanImages(args.images) };
}
async function newSession(title, now) {
  const created = await oc.api.createSession(titleOf(title));
  const sid = created.id;
  upsertSession(sid, { title: created.title || titleOf(title) });
  load().set(sid, { session: sid, from: "you", title: titleOf(title), at: now, last: now, replies: 0 });
  save();
  return sid;
}
function touch(c, now) {
  c.last = now;
  c.replies = (c.replies || 0) + 1;
  save();
}
function needIdle(sid) {
  if (busy(sid)) throw httpError(409, "opencode is still working in this chat. Wait for it, or stop it first.");
}

/** A new chat: a new session, first message to the agent you picked (opencode's default when none). */
export async function startChat(args, { config, now = Date.now() } = {}) {
  needAi(config);
  const t = cleanText(args.text);
  needOc();
  const o = opts(args);
  const sid = await newSession(t, now);
  await send(sid, { text: t, ...o });
  log(`chat started in ${sid}${o.agent ? ` with ${o.agent}` : ""}`);
  return { session: sid };
}

/** The next message in a chat or any workspace session. Refused while opencode is still working (Chat queues it). */
export async function sendChat(args, { config, now = Date.now() } = {}) {
  needAi(config);
  const c = known(args.session);
  const t = cleanText(args.text);
  needOc();
  const o = opts(args, { forHub: c.from === "hub" });
  needIdle(c.session);
  await send(c.session, { text: t, ...o });
  touch(adopt(c, now), now);
  return { ok: true };
}

/** A slash command (/name args), in a chat or in a new one. */
export async function commandChat(args, { config, now = Date.now() } = {}) {
  needAi(config);
  const name = String(args.name || "").replace(/^\//, "");
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(name)) throw httpError(400, "Bad command name.");
  const rest = String(args.args || "").trim();
  if (rest.length > MAX_TEXT) throw httpError(400, `The arguments are over ${MAX_TEXT} characters.`);
  if (args.session) known(args.session);
  needOc();
  if (oc.commands.size && !oc.commands.has(name)) throw httpError(400, `opencode has no /${name} command.`);
  const o = { agent: cleanAgent(args.agent), model: cleanModel(args.model) };
  let sid;
  if (args.session) { const c = known(args.session); needIdle(c.session); sid = c.session; touch(adopt(c, now), now); }
  else sid = await newSession(`/${name}${rest ? " " + rest : ""}`, now);
  markBusy(sid, `/${name}`);
  upsertSession(sid, { command: `/${name}${rest ? " " + rest : ""}` });
  if (oc.api.commandRich) later(sid, oc.api.commandRich(sid, { name, args: rest, ...o }));
  else later(sid, oc.api.runCommand(sid, name, rest).then((e) => (e ? { ok: false, status: 502, data: { message: e } } : { ok: true })));
  return { session: sid };
}

/** !command: a shell command run through opencode in the workspace (the TUI's shell mode). */
export async function shellChat(args, { config, now = Date.now() } = {}) {
  needAi(config);
  const command = String(args.command || "").trim();
  if (!command) throw httpError(400, "Type a command first.");
  if (command.length > 4000) throw httpError(400, "The command is over 4000 characters.");
  needOc();
  if (!oc.api.shell) throw httpError(501, "This opencode cannot run shell commands from Chat.");
  const o = { agent: cleanAgent(args.agent), model: cleanModel(args.model) };
  let sid;
  if (args.session) { const c = known(args.session); needIdle(c.session); sid = c.session; touch(adopt(c, now), now); }
  else sid = await newSession(`!${command}`, now);
  markBusy(sid, `$ ${command.split(/\r?\n/)[0].slice(0, 120)}`);
  later(sid, oc.api.shell(sid, { command, ...o }));
  return { session: sid };
}

/** /undo: takes back the last message and the file changes after it (opencode's revert). */
export async function undoChat({ session }, { config } = {}) {
  needAi(config);
  const c = known(session);
  needOc();
  if (!oc.api.revert) throw httpError(501, "This opencode cannot undo from Chat.");
  needIdle(c.session);
  const info = await oc.api.sessionInfo(c.session);
  const turns = await oc.api.richMessages(c.session, MAX_TURNS * 2);
  const users = turns.filter((m) => m.role === "user" && m.id);
  const stop = info.revert ? turns.findIndex((m) => m.id === info.revert) : turns.length;
  const target = users.filter((m) => turns.indexOf(m) < (stop < 0 ? turns.length : stop)).pop();
  if (!target) throw httpError(400, "Nothing to undo.");
  await oc.api.revert(c.session, target.id);
  broadcastLive();
  return { ok: true, text: target.text };
}

/** /redo: brings back what undo took back. */
export async function redoChat({ session }, { config } = {}) {
  needAi(config);
  const c = known(session);
  needOc();
  if (!oc.api.unrevert) throw httpError(501, "This opencode cannot redo from Chat.");
  needIdle(c.session);
  await oc.api.unrevert(c.session);
  broadcastLive();
  return { ok: true };
}

/** /compact: opencode summarizes the session so far to free up context. */
export async function compactChat({ session, model }, { config, now = Date.now() } = {}) {
  needAi(config);
  const c = known(session);
  needOc();
  if (!oc.api.summarize) throw httpError(501, "This opencode cannot compact from Chat.");
  needIdle(c.session);
  let m = cleanModel(model);
  if (!m) {
    const turns = await oc.api.richMessages(c.session, 20).catch(() => []);
    const last = turns.filter((t) => t.role === "assistant" && t.model).pop();
    m = last ? last.model : null;
  }
  markBusy(c.session, "Compacting");
  touch(adopt(c, now), now);
  later(c.session, oc.api.summarize(c.session, m));
  return { ok: true };
}

/** What the composer can offer: agents, models, commands. */
export async function chatOptions({ config } = {}) {
  needAi(config);
  needOc();
  const [agents, models, commands] = await Promise.all([
    oc.api.agentList ? oc.api.agentList().catch(() => []) : [...oc.agents].map((name) => ({ name, description: "", mode: "all" })),
    oc.api.modelList ? oc.api.modelList().catch(() => ({ models: [], defaults: {} })) : { models: [], defaults: {} },
    oc.api.commandList ? oc.api.commandList().catch(() => []) : [...oc.commands].map((name) => ({ name, description: "" })),
  ]);
  return {
    kind: oc.kind,
    version: oc.version || null,
    agents: agents.filter((a) => a.mode !== "subagent" && !a.hidden).map(({ name, description, mode, builtIn }) => ({ name, description: String(description).slice(0, 300), mode, builtIn })),
    subagents: agents.filter((a) => a.mode === "subagent" && !a.hidden).map(({ name, description }) => ({ name, description: String(description).slice(0, 300) })),
    models: models.models.slice(0, 500),
    defaults: models.defaults,
    commands: commands.slice(0, 300).map((c) => ({ name: c.name, description: String(c.description).slice(0, 300) })),
    can: { shell: !!oc.api.shell, undo: !!oc.api.revert, compact: !!oc.api.summarize, files: !!oc.api.findFiles, images: oc.kind === "v1", side: !!oc.api.fork, terminal: !!oc.api.ptyCreate },
  };
}

/** Workspace files for @ mentions. */
export async function chatFiles({ query }, { config } = {}) {
  needAi(config);
  needOc();
  const q = String(query || "").trim().slice(0, 200);
  if (!oc.api.findFiles) return { files: [] };
  return { files: (await oc.api.findFiles(q)).slice(0, 50) };
}

/**
 * A chat's turns, oldest first, with their parts (chat-parts.mjs): [{id, role: "you" | "tandem", text, at, agent,
 * model, tokens, cost, error, parts}]. For a hub thread the /hub run itself (the command and its routing reply) is
 * left out: the card already shows it. Also the session's state: busy, what it is doing, permission prompts and
 * questions (its subagents' too), whether an undo is pending, and totals.
 */
export async function chatMessages({ session }, { config } = {}) {
  needAi(config);
  const c = known(session);
  needOc();
  const rich = !!oc.api.richMessages;
  let turns = rich ? await oc.api.richMessages(c.session, MAX_TURNS * 2) : await oc.api.messages(c.session, MAX_TURNS * 2);
  if (c.from === "hub") {
    const first = turns.findIndex((m) => m.role === "user");
    let i = first < 0 ? 0 : first + 1;
    while (i < turns.length && turns[i].role === "assistant") i++;
    turns = turns.slice(i);
  }
  // A side chat shows only what was asked in it: the copied chat is its context, not its thread.
  let copied = 0;
  if (c.from === "side") {
    const i = c.mark ? turns.findIndex((m) => m.id === c.mark) : -1;
    if (i >= 0) { copied = i + 1; turns = turns.slice(i + 1); }
  }
  const side = c.from === "side" ? null : sideOf(c.session);
  const info = oc.api.sessionInfo ? await oc.api.sessionInfo(c.session).catch(() => null) : null;
  const s = sessions.get(c.session);
  const shown = turns.filter((m) => m.text || (m.parts && m.parts.length) || m.error).slice(-MAX_TURNS);
  let cost = 0, context = 0, agent = null, model = null;
  for (const m of turns) {
    if (typeof m.cost === "number") cost += m.cost;
    if (m.role === "assistant" && m.tokens) { const t = m.tokens; const sum = t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite; if (sum) context = sum; }
    if (m.role === "user" && m.agent) agent = m.agent;
    if (m.model) model = m.model;
  }
  const prompts = promptsFor(c.session);
  return {
    session: c.session,
    from: c.from,
    title: c.title || (info && info.title) || "Chat",
    listed: !c.unlisted,
    busy: busy(c.session),
    waiting: prompts.length > 0,
    prompts,
    activity: (s && s.status !== "idle" && s.activity) || null,
    revert: (info && info.revert) || null,
    parent: (info && info.parent) || (s && s.parent) || null,
    agent,
    model,
    totals: { cost, context },
    ...(c.from === "side" ? { main: c.parent, copied } : {}),
    ...(side ? { side: side.session } : {}),
    ...(s && s.error ? { error: s.error } : {}),
    turns: shown.map((m) => ({
      id: m.id || "",
      role: m.role === "user" ? "you" : "tandem",
      text: String(m.text || "").slice(0, MAX_TEXT),
      at: m.at,
      ...(rich ? { agent: m.agent || null, model: m.model || null, tokens: m.tokens || null, cost: m.cost == null ? null : m.cost, error: m.error || null, parts: m.parts || [], ...(m.summary ? { summary: true } : {}) } : {}),
    })),
  };
}

/**
 * Conversations for the Chat list, newest activity first: every chat you started, every hub message that is not a
 * capture or go, and sessions from All sessions you sent in. With `all: true`, every top-level opencode session in
 * the workspace as well (runs, PR reviews, the terminal), like the TUI's /sessions. With `hubs: true`, the newest
 * HUB_RECENT hub threads instead (followed up or not), so the hub can show its cards again after a reload.
 */
export const HUB_RECENT = 12;
export function listChats({ config, hubs = false, all = false } = {}) {
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
  if (!all) return { items };
  const have = new Set(load().keys());
  const others = [...sessions.values()]
    .filter((s) => !s.parent && !have.has(s.id))
    .map((s) => {
      const t = typeof s.updated === "number" ? s.updated : Date.parse(s.updated || "") || 0;
      return { session: s.id, from: "opencode", title: s.title || "Untitled session", at: t, last: t, replies: 0, busy: busy(s.id), waiting: waiting(s.id) };
    })
    .sort((a, b) => (b.last || 0) - (a.last || 0))
    .slice(0, MAX_ALL);
  return { items: items.concat(others) };
}

/** Stops listing a conversation in the Chat list. The opencode session is kept. */
export function removeChat({ session }, { config } = {}) {
  needAi(config);
  const c = known(session);
  if (c.unlisted) return { ok: true };
  if (c.from === "hub") c.hidden = true;
  else load().delete(c.session); // a side chat too: the next question starts a new one
  save();
  return { ok: true };
}

/** Renames a conversation in the Chat list (the opencode session keeps its own title). */
export function renameChat({ session, title }, { config, now = Date.now() } = {}) {
  needAi(config);
  const c = adopt(known(session), now);
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) throw httpError(400, "Type a name first.");
  c.title = t.slice(0, TITLE_MAX);
  save();
  return { ok: true, title: c.title };
}

/* ---------- side chats (connector 1.26.0, Chat 4.0.0) ---------- */

/** The side chat of a chat, if it has one. */
function sideOf(sid) {
  let found = null;
  for (const c of load().values()) if (c.from === "side" && c.parent === sid && (!found || (c.at || 0) > (found.at || 0))) found = c;
  return found;
}
function sideAgent() {
  for (const a of SIDE_AGENTS) if (oc.agents.has(a)) return a;
  return null;
}

/**
 * chat.side: a question about a chat that should not land in it. The first one copies the chat so far (opencode's
 * fork) and asks there; later ones (with `side`) go to the same side chat, which keeps its own thread. Tandem's
 * read-only chat agent answers unless you pick another (opencode's plan agent when Tandem is not installed). Nothing
 * is added to the chat itself.
 */
export async function sideChat(args, { config, now = Date.now() } = {}) {
  needAi(config);
  const main = known(args.session);
  if (main.from === "side") throw httpError(400, "That is a side chat already. Ask in it, or in its chat.");
  const t = cleanText(args.text);
  needOc();
  if (!oc.api.fork) throw httpError(501, "This opencode cannot start side chats.");
  const agent = cleanAgent(args.agent != null && args.agent !== "" ? args.agent : sideAgent());
  const model = cleanModel(args.model);
  const images = cleanImages(args.images);
  let side = null;
  if (args.side) {
    side = load().get(String(args.side));
    if (!side || side.from !== "side" || side.parent !== main.session) throw httpError(404, "That side chat is gone. Ask again to start a new one.");
    needIdle(side.session);
  } else {
    const f = await oc.api.fork(main.session);
    const last = await (oc.api.richMessages || oc.api.messages)(f.id, 1).catch(() => []);
    const title = titleOf(`Side chat: ${main.title || (sessions.get(main.session) || {}).title || "Chat"}`);
    side = { session: f.id, from: "side", parent: main.session, title, at: now, last: now, replies: 0, mark: (last[last.length - 1] || {}).id || null };
    upsertSession(f.id, { title, status: "idle" });
    for (const c of [...load().values()]) if (c.from === "side" && c.parent === main.session) load().delete(c.session);
    load().set(f.id, side);
    save();
    if (oc.api.setTitle) oc.api.setTitle(f.id, title).catch(() => {});
    log(`side chat ${f.id} started from ${main.session}`);
  }
  await send(side.session, { text: t, agent, model, files: [], images });
  touch(side, now);
  return { side: side.session };
}

/** chat.image: one pasted image of a turn, as {mime, data} (base64), for the thread. */
export async function chatImage({ session, message, part }, { config } = {}) {
  needAi(config);
  const c = known(session);
  needOc();
  if (!oc.api.rawMessage) throw httpError(501, "This opencode cannot show pasted images in Chat.");
  if (!/^msg[A-Za-z0-9_-]{1,100}$/.test(String(message || ""))) throw httpError(400, "Bad message id.");
  const m = await oc.api.rawMessage(c.session, message);
  const p = m && Array.isArray(m.parts) ? m.parts[part] : null;
  const hit = p && p.type === "file" && typeof p.url === "string" ? IMAGE_URL.exec(p.url) : null;
  if (!hit) throw httpError(404, "That image is not in the chat any more.");
  return { mime: hit[1], data: p.url.slice(hit[0].length) };
}

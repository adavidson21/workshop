// Tests for lib/chat.mjs (conversations from Dispatch) with a stand-in opencode API. Synthetic data only.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT, KEEP, MAX_IMAGE_DATA, chatFiles, chatImage, chatMessages, chatOptions, cleanImages, commandChat, compactChat, listChats, noteIntent, recordHub, redoChat, removeChat, renameChat, resetChats, sendChat, shellChat, sideChat, startChat, undoChat } from "../lib/chat.mjs";
import { oc, permissions, questions, sessions, upsertSession } from "../lib/opencode-state.mjs";
import { configure } from "../lib/context.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-chat-"));
const file = path.join(dir, "chats.json");
const hubs = path.join(dir, "hub");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
configure({ config: { workspace: dir }, env: () => undefined, log: { info() {}, warn() {} } });
const on = { hub: true };
let prompts, turns, made, rich;
beforeEach(() => {
  try { fs.rmSync(file); } catch { /* none */ }
  resetChats(file, hubs);
  fs.rmSync(hubs, { recursive: true, force: true });
  sessions.clear(); permissions.clear(); questions.clear();
  oc.commands = new Set();
  prompts = []; turns = {}; made = 0;
  oc.connected = true;
  oc.agents = new Set(["build", "plan", "hub", "chat"]);
  oc.api = {
    async createSession(title) { made++; return { id: `ses_${made}`, title }; },
    async prompt(id, text, agent) { prompts.push({ id, text, agent }); },
    async messages(id) { return turns[id] || []; },
  };
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));

test("there is no AI switch: chats work with the old hub setting off or missing (1.17.0)", async () => {
  assert.deepEqual(await startChat({ text: "hi" }, { config: {} }), { session: "ses_1" });
  assert.equal(listChats({ config: { hub: false } }).items.length, 1);
});

test("a new chat goes to opencode's default agent unless you pick one, with the model and files you picked", async () => {
  const r = await startChat({ text: "  What does the sample api log on startup?  " }, { config: on, now: 10 });
  assert.deepEqual(r, { session: "ses_1" });
  assert.deepEqual(prompts, [{ id: "ses_1", text: "What does the sample api log on startup?", agent: null }]);
  assert.equal(sessions.get("ses_1").status, "busy");
  await rejects(sendChat({ session: "ses_1", text: "and?" }, { config: on }), "conflict", /still working/);
  upsertSession("ses_1", { status: "idle" });
  rich = [];
  oc.api.promptRich = async (id, o) => { rich.push({ id, ...o }); };
  await sendChat({ session: "ses_1", text: "fix it", agent: "build", model: { provider: "anthropic", id: "claude-x" }, files: ["src/app.cs"] }, { config: on, now: 20 });
  assert.equal(rich[0].agent, "build");
  assert.deepEqual(rich[0].model, { provider: "anthropic", id: "claude-x" });
  assert.equal(rich[0].files[0], path.join(dir, "src", "app.cs"), "files are sent as workspace paths");
  upsertSession("ses_1", { status: "idle" });
  await rejects(sendChat({ session: "ses_1", text: "x", agent: "nope" }, { config: on }), "bad_request", /no agent named nope/);
  await rejects(sendChat({ session: "ses_1", text: "x", files: ["../outside.txt"] }, { config: on }), "bad_request", /not in the workspace/);
  await rejects(sendChat({ session: "ses_1", text: "x", model: { provider: "a b", id: "c" } }, { config: on }), "bad_request", /Bad model/);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.items[0].from, "you");
  assert.equal(saved.items[0].last, 20);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("any opencode session in the workspace can be opened and continued, which lists it", async () => {
  await rejects(sendChat({ session: "ses_nowhere", text: "x" }, { config: on }), "not_found");
  await rejects(startChat({ text: "   " }, { config: on }), "bad_request");
  upsertSession("ses_term", { status: "idle", title: "From the terminal", updated: 50 });
  upsertSession("ses_kid", { status: "idle", title: "Subagent", parent: "ses_term" });
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.session), [], "not listed until you use it");
  assert.deepEqual(listChats({ config: on, all: true }).items.map((c) => [c.session, c.from]), [["ses_term", "opencode"]], "All sessions: top level only");
  await sendChat({ session: "ses_term", text: "carry on" }, { config: on, now: 60 });
  assert.deepEqual(listChats({ config: on }).items.map((c) => [c.session, c.from, c.title]), [["ses_term", "oc", "From the terminal"]]);
  oc.connected = false;
  await rejects(startChat({ text: "hi" }, { config: on }), "unavailable");
});

test("a hub thread: listed right away, the /hub run left out of its turns, kept across restarts", async () => {
  recordHub("ses_h", "hub_abc", "which .NET is the sample api on?", 5);
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.session), ["ses_h"], "a question is a chat before any reply (1.9.0)");
  resetChats(file, hubs);
  oc.agents = new Set(["build", "hub"]);
  await rejects(sendChat({ session: "ses_h", text: "x" }, { config: on }), "bad_request", /Core 2\.14\.0/);
  oc.agents = new Set(["build", "hub", "chat"]);
  await sendChat({ session: "ses_h", text: "and the tests project?" }, { config: on, now: 30 });
  assert.equal(prompts[0].agent, AGENT, "a hub thread's follow-ups default to the read-only chat agent");
  const items = listChats({ config: on }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].from, "hub");
  assert.equal(items[0].hub, "hub_abc");
  turns.ses_h = [
    { role: "user", text: "Handle the hub request at C:\\x\\request.md ... long command template", at: 1 },
    { role: "assistant", text: "", at: 2 },
    { role: "assistant", text: "It is on net8.0. Wrote route.json and answer.md.", at: 3 },
    { role: "user", text: "and the tests project?", at: 4 },
    { role: "assistant", text: "Also net8.0 (**Confirmed**: tests.csproj line 4).", at: 5 },
  ];
  const m = await chatMessages({ session: "ses_h" }, { config: on });
  assert.deepEqual(m.turns, [{ id: "", role: "you", text: "and the tests project?", at: 4 }, { id: "", role: "tandem", text: "Also net8.0 (**Confirmed**: tests.csproj line 4).", at: 5 }]);
  assert.equal(m.busy, true);
  recordHub("ses_h2", "hub_def", "open my board", 6);
  assert.deepEqual(listChats({ config: on, hubs: true }).items.map((c) => [c.session, c.hub, c.replies]), [["ses_h2", "hub_def", 0], ["ses_h", "hub_abc", 1]], "hub threads for the cards, newest first");
});

test("the list: newest first, waiting shown, removing hides it, and only the newest KEEP are kept", async () => {
  await startChat({ text: "first" }, { config: on, now: 1 });
  await startChat({ text: "second" }, { config: on, now: 2 });
  permissions.set("perm_1", { id: "perm_1", sessionID: "ses_1" });
  const items = listChats({ config: on }).items;
  assert.deepEqual(items.map((c) => [c.session, c.title, c.waiting]), [["ses_2", "second", false], ["ses_1", "first", true]]);
  removeChat({ session: "ses_2" }, { config: on });
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.session), ["ses_1"]);
  for (let i = 0; i < KEEP + 5; i++) recordHub(`ses_x${i}`, `hub_${i}`, "x", 100 + i);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).items.length, KEEP);
});

test("captures and go stay out of the list; the intent comes from hub.result or route.json", () => {
  recordHub("ses_a", "hub_ask", "what is on net8?", 1);
  recordHub("ses_c", "hub_cap", "t call vendor friday", 2);
  recordHub("ses_g", "hub_go", "open my board", 3);
  recordHub("ses_old", "hub_old", "r thanks to sam", 4);
  noteIntent("hub_cap", "capture");
  noteIntent("hub_go", "go");
  noteIntent("hub_ask", "ask");
  fs.mkdirSync(path.join(hubs, "hub_old"), { recursive: true });
  fs.writeFileSync(path.join(hubs, "hub_old", "route.json"), '```json\n{"intent": "capture", "proposals": []}\n```');
  assert.deepEqual(listChats({ config: on }).items.map((c) => [c.session, c.intent]), [["ses_a", "ask"]]);
  resetChats(file, hubs);
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.session), ["ses_a"], "the intent is kept across restarts");
});

test("rename changes the title in the list only, and needs a name", async () => {
  await startChat({ text: "first question" }, { config: on, now: 1 });
  assert.deepEqual(renameChat({ session: "ses_1", title: "  Sample   api  " }, { config: on }), { ok: true, title: "Sample api" });
  assert.equal(listChats({ config: on }).items[0].title, "Sample api");
  assert.throws(() => renameChat({ session: "ses_1", title: "  " }, { config: on }), (e) => e.code === "bad_request" || /name/.test(e.message));
  assert.throws(() => renameChat({ session: "nope", title: "x" }, { config: on }), (e) => /not a chat/.test(e.message));
});

test("slash commands, !shell, undo, redo and compact act on the chat and wait for nothing", async () => {
  const calls = [];
  let resolveCmd;
  Object.assign(oc.api, {
    commandRich: (id, o) => { calls.push(["command", id, o]); return new Promise((r) => { resolveCmd = r; }); },
    shell: async (id, o) => { calls.push(["shell", id, o]); return { ok: true }; },
    sessionInfo: async (id) => ({ id, title: "x", parent: null, revert: info.revert }),
    richMessages: async () => [{ id: "msg_1", role: "user", text: "one" }, { id: "msg_2", role: "assistant", text: "a", model: { provider: "p", id: "m" } }, { id: "msg_3", role: "user", text: "two" }, { id: "msg_4", role: "assistant", text: "b" }],
    revert: async (id, mid) => { calls.push(["revert", id, mid]); info.revert = mid; },
    unrevert: async (id) => { calls.push(["unrevert", id]); info.revert = null; },
    summarize: async (id, m) => { calls.push(["summarize", id, m]); return { ok: true }; },
  });
  const info = { revert: null };
  oc.commands = new Set(["spike", "review"]);
  await rejects(commandChat({ name: "nope" }, { config: on }), "bad_request", /no \/nope/);
  const r = await commandChat({ name: "/spike", args: "how does auth work", agent: "plan" }, { config: on, now: 5 });
  assert.equal(r.session, "ses_1");
  assert.deepEqual(calls[0], ["command", "ses_1", { name: "spike", args: "how does auth work", agent: "plan", model: null }]);
  assert.equal(listChats({ config: on }).items[0].title, "/spike how does auth work");
  assert.equal(sessions.get("ses_1").status, "busy", "returns at once; opencode answers when the agent is done");
  resolveCmd({ ok: false, status: 400, data: { message: "bad template" } });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(sessions.get("ses_1").error, /bad template/, "a failed command shows on the chat");
  await shellChat({ session: "ses_1", command: "git status" }, { config: on });
  assert.deepEqual(calls[1], ["shell", "ses_1", { command: "git status", agent: null, model: null }]);
  upsertSession("ses_1", { status: "idle" });
  assert.deepEqual(await undoChat({ session: "ses_1" }, { config: on }), { ok: true, text: "two" });
  await undoChat({ session: "ses_1" }, { config: on });
  assert.deepEqual(calls.filter((c) => c[0] === "revert").map((c) => c[2]), ["msg_3", "msg_1"], "each undo goes one message further back");
  await rejects(undoChat({ session: "ses_1" }, { config: on }), "bad_request", /Nothing to undo/);
  await redoChat({ session: "ses_1" }, { config: on });
  assert.equal(info.revert, null);
  await compactChat({ session: "ses_1" }, { config: on });
  assert.deepEqual(calls.at(-1), ["summarize", "ses_1", { provider: "p", id: "m" }], "compact uses the chat's last model");
  await rejects(undoChat({ session: "ses_1" }, { config: on }), "conflict", /still working/);
});

test("options list primary agents apart from subagents, plus models and commands; files come from opencode", async () => {
  Object.assign(oc.api, {
    agentList: async () => [{ name: "build", mode: "primary", description: "Builds" }, { name: "plan", mode: "primary" }, { name: "general", mode: "subagent" }, { name: "secret", mode: "primary", hidden: true }],
    modelList: async () => ({ models: [{ provider: "anthropic", providerName: "Anthropic", id: "m1", name: "M1" }], defaults: { anthropic: "m1" } }),
    commandList: async () => [{ name: "spike", description: "Investigate" }],
    findFiles: async (q) => [`src/${q}.cs`],
    shell: async () => ({}),
  });
  const o = await chatOptions({ config: on });
  assert.deepEqual(o.agents.map((a) => a.name), ["build", "plan"]);
  assert.deepEqual(o.subagents.map((a) => a.name), ["general"]);
  assert.equal(o.models[0].id, "m1");
  assert.deepEqual(o.commands, [{ name: "spike", description: "Investigate" }]);
  assert.equal(o.can.shell, true);
  assert.deepEqual(await chatFiles({ query: "app" }, { config: on }), { files: ["src/app.cs"] });
  oc.connected = false;
  await assert.rejects(chatOptions({ config: on }), (e) => e.code === "unavailable", "opencode not connected");
});

test("a chat's messages carry parts, totals and the prompts of its subagents", async () => {
  await startChat({ text: "go" }, { config: on, now: 1 });
  upsertSession("ses_child", { parent: "ses_1", status: "busy" });
  permissions.set("per_1", { id: "per_1", sessionID: "ses_child", permission: "bash", title: "rm -rf build", patterns: ["rm *"], always: ["rm *"] });
  questions.set("que_1", { id: "que_1", sessionID: "ses_other", questions: [] });
  oc.api.richMessages = async () => [
    { id: "u1", role: "user", text: "go", agent: "build", parts: [{ type: "text", text: "go" }] },
    { id: "a1", role: "assistant", text: "", agent: "build", model: { provider: "p", id: "m" }, tokens: { input: 100, output: 20, reasoning: 0, cacheRead: 5, cacheWrite: 0 }, cost: 0.01, parts: [{ type: "tool", tool: "bash", status: "running", input: "rm -rf build" }] },
  ];
  oc.api.sessionInfo = async () => ({ id: "ses_1", revert: null, parent: null });
  const m = await chatMessages({ session: "ses_1" }, { config: on });
  assert.equal(m.turns.length, 2, "a turn with only a tool call is kept");
  assert.equal(m.turns[1].parts[0].tool, "bash");
  assert.deepEqual(m.prompts.map((p) => [p.kind, p.id, p.session]), [["permission", "per_1", "ses_child"]]);
  assert.equal(m.waiting, true);
  assert.deepEqual(m.totals, { cost: 0.01, context: 125 });
  assert.equal(m.agent, "build");
  assert.deepEqual(m.model, { provider: "p", id: "m" });
  assert.equal(listChats({ config: on }).items[0].waiting, true, "the list shows a subagent's prompt too");
});

/* ---------- Chat 4.0.0: pasted images and side chats ---------- */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]).toString("base64");

test("pasted images: checked against their type and size, then sent with the message", async () => {
  assert.deepEqual(cleanImages(undefined), []);
  const [a, b] = cleanImages([{ mime: "image/png", data: PNG, name: "screen shot<1>.png" }, { mime: "image/jpeg", data: JPG }]);
  assert.deepEqual([a.name, b.name], ["screen shot1.png", "image-2.jpg"]);
  assert.throws(() => cleanImages([{ mime: "image/svg+xml", data: PNG }]), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => cleanImages([{ mime: "image/jpeg", data: PNG }]), /not the type it says/);
  assert.throws(() => cleanImages([{ mime: "image/png", data: "not base64!" }]), /could not be read/);
  assert.throws(() => cleanImages(Array(5).fill({ mime: "image/png", data: PNG })), /Up to 4/);
  assert.throws(() => cleanImages([{ mime: "image/png", data: PNG + "A".repeat(MAX_IMAGE_DATA) }]), (e) => e.code === "too_large");
  rich = [];
  oc.kind = "v1";
  oc.api.promptRich = async (id, o) => { rich.push({ id, ...o }); };
  await startChat({ text: "what is wrong here?", images: [{ mime: "image/png", data: PNG, name: "err.png" }] }, { config: on });
  assert.deepEqual(rich[0].images, [{ mime: "image/png", data: PNG, name: "err.png" }]);
  oc.kind = "v2";
  upsertSession("ses_1", { status: "idle" });
  await rejects(sendChat({ session: "ses_1", text: "and this?", images: [{ mime: "image/png", data: PNG }] }, { config: on }), "bad_request", /cannot take pasted images/);
  oc.kind = null;
});

test("chat.image reads one pasted image back; anything else is not found", async () => {
  await startChat({ text: "hi" }, { config: on });
  oc.api.rawMessage = async (sid, mid) => (mid === "msg_1" ? { info: { id: "msg_1" }, parts: [{ type: "text", text: "hi" }, { type: "file", url: `data:image/png;base64,${PNG}` }, { type: "file", url: "file:///w/a.cs" }] } : null);
  assert.deepEqual(await chatImage({ session: "ses_1", message: "msg_1", part: 1 }, { config: on }), { mime: "image/png", data: PNG });
  await rejects(chatImage({ session: "ses_1", message: "msg_1", part: 2 }, { config: on }), "not_found");
  await rejects(chatImage({ session: "ses_1", message: "msg_2", part: 1 }, { config: on }), "not_found");
  await rejects(chatImage({ session: "ses_1", message: "../x", part: 1 }, { config: on }), "bad_request");
});

test("a side chat copies the chat so far, keeps its own thread, and stays out of the list and the chat", async () => {
  await startChat({ text: "refactor the sample api" }, { config: on, now: 1 });
  upsertSession("ses_1", { status: "busy" });
  const forks = [];
  rich = [];
  const titles = {};
  oc.api.promptRich = async (id, o) => { rich.push({ id, ...o }); };
  oc.api.fork = async (id) => { forks.push(id); return { id: `ses_side${forks.length}`, title: "x (fork #1)" }; };
  oc.api.setTitle = async (id, t) => { titles[id] = t; return true; };
  oc.api.richMessages = async (id, limit) => {
    const all = [
      { id: "msg_a", role: "user", text: "refactor the sample api", parts: [] },
      { id: "msg_b", role: "assistant", text: "Working on it.", parts: [] },
      ...(id === "ses_side1" && turns.side ? turns.side : []),
    ];
    return all.slice(-limit);
  };
  const r = await sideChat({ session: "ses_1", text: "what does Program.cs do?" }, { config: on, now: 5 });
  assert.deepEqual(r, { side: "ses_side1" });
  assert.deepEqual(forks, ["ses_1"], "even while the chat is working");
  assert.equal(rich[0].id, "ses_side1");
  assert.equal(rich[0].agent, "chat", "Tandem's read-only chat agent unless you pick one");
  assert.equal(titles.ses_side1, "Side chat: refactor the sample api");
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.session), ["ses_1"], "not in the list");
  sessions.set("ses_side1", { id: "ses_side1", status: "idle", title: "Side chat" });
  assert.deepEqual(listChats({ config: on, all: true }).items.map((c) => c.session), ["ses_1"], "not in All sessions either");
  // The thread of the side chat starts after the copy.
  turns.side = [{ id: "msg_c", role: "user", text: "what does Program.cs do?", parts: [] }, { id: "msg_d", role: "assistant", text: "It starts the host.", parts: [] }];
  const side = await chatMessages({ session: "ses_side1" }, { config: on });
  assert.deepEqual(side.turns.map((t) => t.text), ["what does Program.cs do?", "It starts the host."]);
  assert.deepEqual([side.from, side.main, side.copied], ["side", "ses_1", 2]);
  upsertSession("ses_1", { status: "idle" });
  assert.equal((await chatMessages({ session: "ses_1" }, { config: on })).side, "ses_side1", "the chat knows its side chat");
  // A follow-up goes to the same side chat; plan when Tandem is not installed; a picked agent wins.
  oc.agents = new Set(["build", "plan"]);
  await sideChat({ session: "ses_1", side: "ses_side1", text: "and Startup.cs?" }, { config: on, now: 6 });
  assert.deepEqual([forks.length, rich[1].id, rich[1].agent], [1, "ses_side1", "plan"]);
  upsertSession("ses_side1", { status: "idle" });
  await sideChat({ session: "ses_1", side: "ses_side1", text: "x", agent: "build" }, { config: on });
  assert.equal(rich[2].agent, "build");
  await rejects(sideChat({ session: "ses_side1", text: "x" }, { config: on }), "bad_request", /side chat already/);
  await rejects(sideChat({ session: "ses_1", side: "ses_nope", text: "x" }, { config: on }), "not_found");
  // Start over: forget it; the next question copies the chat again, and only one side chat is kept per chat.
  removeChat({ session: "ses_side1" }, { config: on });
  await sideChat({ session: "ses_1", text: "fresh question" }, { config: on, now: 9 });
  assert.equal(forks.length, 2);
  const saved = JSON.parse(fs.readFileSync(file, "utf8")).items.filter((c) => c.from === "side");
  assert.deepEqual(saved.map((c) => [c.session, c.parent, c.mark]), [["ses_side2", "ses_1", "msg_b"]], "kept across restarts, with where the copy ends");
});

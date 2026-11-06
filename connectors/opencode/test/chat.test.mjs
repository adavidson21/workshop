// Tests for lib/chat.mjs (conversations from Dispatch) with a stand-in opencode API. Synthetic data only.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT, KEEP, chatMessages, listChats, recordHub, removeChat, resetChats, sendChat, startChat } from "../lib/chat.mjs";
import { oc, permissions, sessions, upsertSession } from "../lib/opencode-state.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-chat-"));
const file = path.join(dir, "chats.json");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const on = { hub: true };
let prompts, turns, made;
beforeEach(() => {
  try { fs.rmSync(file); } catch { /* none */ }
  resetChats(file);
  sessions.clear(); permissions.clear();
  prompts = []; turns = {}; made = 0;
  oc.connected = true;
  oc.agents = new Set(["build", "hub", "chat"]);
  oc.api = {
    async createSession(title) { made++; return { id: `ses_${made}`, title }; },
    async prompt(id, text, agent) { prompts.push({ id, text, agent }); },
    async messages(id) { return turns[id] || []; },
  };
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));

test("everything is refused while AI (the Hub setting) is off", async () => {
  await rejects(startChat({ text: "hi" }, { config: {} }), "unavailable", /Hub/);
  assert.throws(() => listChats({ config: { hub: false } }), (e) => e.code === "unavailable");
});

test("a new chat makes a session and sends the first message to the chat agent, never the default", async () => {
  const r = await startChat({ text: "  What does the sample api log on startup?  " }, { config: on, now: 10 });
  assert.deepEqual(r, { session: "ses_1" });
  assert.deepEqual(prompts, [{ id: "ses_1", text: "What does the sample api log on startup?", agent: AGENT }]);
  assert.equal(sessions.get("ses_1").status, "busy");
  await rejects(sendChat({ session: "ses_1", text: "and?" }, { config: on }), "conflict", /still answering/);
  upsertSession("ses_1", { status: "idle" });
  await sendChat({ session: "ses_1", text: "and on shutdown?" }, { config: on, now: 20 });
  assert.deepEqual(prompts.map((p) => p.agent), [AGENT, AGENT]);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.items[0].from, "you");
  assert.equal(saved.items[0].last, 20);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("messages go only to hub threads and chats from Dispatch, and need the chat agent", async () => {
  await rejects(sendChat({ session: "ses_pipeline", text: "x" }, { config: on }), "not_found");
  await rejects(startChat({ text: "   " }, { config: on }), "bad_request");
  oc.agents = new Set(["build", "hub"]);
  await rejects(startChat({ text: "hi" }, { config: on }), "bad_request", /Core 2\.14\.0/);
  oc.agents = new Set();
  await startChat({ text: "hi" }, { config: on });
  assert.equal(prompts.length, 1, "an opencode that does not list agents is not refused");
  oc.connected = false;
  await rejects(startChat({ text: "hi" }, { config: on }), "unavailable");
});

test("a hub thread: listed only after a follow-up, the /hub run left out of its turns, kept across restarts", async () => {
  recordHub("ses_h", "hub_abc", "which .NET is the sample api on?", 5);
  assert.deepEqual(listChats({ config: on }).items, []);
  resetChats(file);
  await sendChat({ session: "ses_h", text: "and the tests project?" }, { config: on, now: 30 });
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
  assert.deepEqual(m.turns, [{ role: "you", text: "and the tests project?", at: 4 }, { role: "tandem", text: "Also net8.0 (**Confirmed**: tests.csproj line 4).", at: 5 }]);
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

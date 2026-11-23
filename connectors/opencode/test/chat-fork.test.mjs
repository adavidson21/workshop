// Tests for Chat 4.6.0's opencode parity (connector 1.39.0): copy a chat (fork), undo from one of your messages,
// reasoning effort, rename that reaches opencode, /status and MCP servers on and off. Stand-in opencode API, synthetic data.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatMcp, chatOptions, chatStatus, forkChat, listChats, renameChat, resetChats, sendChat, startChat, undoChat } from "../lib/chat.mjs";
import { variantsOf } from "../lib/opencode-v1.mjs";
import { oc, permissions, questions, sessions, upsertSession } from "../lib/opencode-state.mjs";
import { configure } from "../lib/context.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-chatfork-"));
const file = path.join(dir, "chats.json");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
configure({ config: { workspace: dir }, env: () => undefined, log: { info() {}, warn() {} } });
const on = {};
let calls, mcp;
const TURNS = [
  { id: "msg_1", role: "user", text: "one" }, { id: "msg_2", role: "assistant", text: "a" },
  { id: "msg_3", role: "user", text: "two" }, { id: "msg_4", role: "assistant", text: "b" },
];
beforeEach(() => {
  try { fs.rmSync(file); } catch { /* none */ }
  resetChats(file, path.join(dir, "hub"));
  sessions.clear(); permissions.clear(); questions.clear();
  calls = [];
  mcp = { github: { status: "connected" }, jira: { status: "failed", error: "no token" } };
  oc.connected = true;
  oc.kind = "v1";
  oc.agents = new Set(["build", "plan"]);
  oc.api = {
    async createSession(title) { return { id: "ses_1", title }; },
    async promptRich(id, o) { calls.push(["prompt", id, o]); },
    async richMessages() { return TURNS; },
    async sessionInfo(id) { return { id, title: "x", parent: null, revert: null }; },
    async revert(id, m) { calls.push(["revert", id, m]); },
    async fork(id, before) { calls.push(["fork", id, before]); return { id: `ses_f${calls.filter((c) => c[0] === "fork").length}`, title: "x (fork #1)" }; },
    async setTitle(id, t) { calls.push(["title", id, t]); return true; },
    async toolStatus() { return { mcp: Object.entries(mcp).map(([name, v]) => ({ name, ...v })), lsp: [{ name: "typescript", status: "connected", root: "/w" }], formatters: [{ name: "prettier", on: true, extensions: [".ts"] }] }; },
    async mcpSwitch(name, onOff) { calls.push(["mcp", name, onOff]); mcp[name] = { status: onOff ? "connected" : "disabled" }; },
  };
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));
const idle = () => upsertSession("ses_1", { status: "idle" });

test("a chat copies into a new one: whole, or up to and including one message; the chat itself is left alone", async () => {
  await startChat({ text: "refactor the api" }, { config: on, now: 1 });
  idle();
  const r = await forkChat({ session: "ses_1" }, { config: on, now: 2 });
  assert.deepEqual(r, { ok: true, session: "ses_f1", title: "refactor the api (copy)" });
  assert.deepEqual(calls.find((c) => c[0] === "fork"), ["fork", "ses_1", null], "the whole chat");
  assert.deepEqual(calls.find((c) => c[0] === "title" && c[1] === "ses_f1"), ["title", "ses_f1", "refactor the api (copy)"], "opencode shows the same name");
  // Fork from here on the first answer: opencode copies what comes before the message it is given, so it gets the next one.
  await forkChat({ session: "ses_1", message: "msg_2" }, { config: on, now: 3 });
  assert.deepEqual(calls.filter((c) => c[0] === "fork")[1], ["fork", "ses_1", "msg_3"]);
  await forkChat({ session: "ses_1", message: "msg_4" }, { config: on, now: 4 });
  assert.deepEqual(calls.filter((c) => c[0] === "fork")[2], ["fork", "ses_1", null], "the last message: the whole chat");
  assert.equal((await forkChat({ session: "ses_f1" }, { config: on, now: 5 })).title, "refactor the api (copy)", "a copy of a copy keeps one (copy)");
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.session).sort(), ["ses_1", "ses_f1", "ses_f2", "ses_f3", "ses_f4"], "copies are chats of their own");
  await rejects(forkChat({ session: "ses_1", message: "msg_gone" }, { config: on }), "not_found");
  await rejects(forkChat({ session: "ses_nope" }, { config: on }), "not_found");
  delete oc.api.fork;
  await rejects(forkChat({ session: "ses_1" }, { config: on }), "bad_request", /cannot copy/);
});

test("undo from one of your messages reverts it and everything after it, and gives its text back", async () => {
  await startChat({ text: "one" }, { config: on });
  idle();
  assert.deepEqual(await undoChat({ session: "ses_1", message: "msg_1" }, { config: on }), { ok: true, text: "one" });
  assert.deepEqual(calls.at(-1), ["revert", "ses_1", "msg_1"]);
  await rejects(undoChat({ session: "ses_1", message: "msg_2" }, { config: on }), "not_found", /not in this chat/);
});

test("reasoning effort goes to opencode as the variant; models list theirs", async () => {
  await startChat({ text: "think hard", variant: "high" }, { config: on });
  assert.equal(calls[0][2].variant, "high");
  idle();
  await sendChat({ session: "ses_1", text: "again" }, { config: on });
  assert.equal(calls.at(-1)[2].variant, null, "none picked: the model's default");
  idle();
  await rejects(sendChat({ session: "ses_1", text: "x", variant: "very high" }, { config: on }), "bad_request", /reasoning effort/);
  assert.deepEqual(variantsOf({ variants: { low: {}, high: {}, "bad key!": {} } }), { variants: ["low", "high"] });
  assert.deepEqual(variantsOf({ variants: {} }), {});
  oc.api.agentList = async () => [];
  oc.api.modelList = async () => ({ models: [], defaults: {} });
  oc.api.commandList = async () => [];
  const o = await chatOptions({ config: on });
  assert.deepEqual([o.can.fork, o.can.status, o.can.effort], [true, true, true]);
});

test("a rename reaches opencode too", async () => {
  await startChat({ text: "hi" }, { config: on });
  renameChat({ session: "ses_1", title: "Sample api" }, { config: on });
  assert.deepEqual(calls.at(-1), ["title", "ses_1", "Sample api"]);
  assert.equal(sessions.get("ses_1").title, "Sample api");
});

test("/status lists MCP servers, language servers and formatters; an MCP server switches on and off", async () => {
  const s = await chatStatus({ config: on });
  assert.deepEqual(s.mcp, [{ name: "github", status: "connected" }, { name: "jira", status: "failed", error: "no token" }]);
  assert.equal(s.lsp[0].name, "typescript");
  assert.equal(s.formatters[0].name, "prettier");
  const r = await chatMcp({ name: "github", on: false }, { config: on });
  assert.deepEqual(calls.at(-1), ["mcp", "github", false]);
  assert.equal(r.mcp[0].status, "disabled");
  await rejects(chatMcp({ name: "nope", on: true }, { config: on }), "not_found");
});

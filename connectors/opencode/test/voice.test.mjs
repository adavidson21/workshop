// Tests for lib/voice.mjs (Settings, Writing) with a stand-in opencode API. Synthetic data only.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MAX_PROMPT, agentFor, resetVoice, runVoice, voiceResult } from "../lib/voice.mjs";
import { oc, sessions, upsertSession } from "../lib/opencode-state.mjs";

const on = { config: { hub: true } };
let prompts, turns, made;
beforeEach(() => {
  resetVoice();
  sessions.clear();
  prompts = []; turns = {}; made = 0;
  oc.connected = true;
  oc.agents = new Set(["build", "plan", "chat"]);
  oc.api = {
    async createSession(title) { made++; return { id: `ses_${made}`, title }; },
    async prompt(id, text, agent, model, tools) { prompts.push({ id, text, agent, ...(tools ? { tools } : {}) }); },
    async messages(id) { return turns[id] || []; },
  };
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));

test("there is no AI switch: it runs with the old hub setting missing (1.17.0)", async () => {
  assert.ok((await runVoice({ kind: "rewrite", prompt: "x" }, { config: {} })).session);
});

test("a run uses the read-only plan agent and returns the last reply once idle", async () => {
  const r = await runVoice({ kind: "rewrite", prompt: "  Rewrite this  " }, on);
  assert.deepEqual(r, { session: "ses_1" });
  assert.deepEqual(prompts, [{ id: "ses_1", text: "Rewrite this", agent: "plan" }]);
  assert.deepEqual(await voiceResult({ session: "ses_1" }, on), { state: "running", chars: 0 });
  upsertSession("ses_1", { text: "Short" });
  assert.deepEqual(await voiceResult({ session: "ses_1" }, on), { state: "running", chars: 5 });
  upsertSession("ses_1", { status: "idle" });
  turns.ses_1 = [{ role: "user", text: "Rewrite this" }, { role: "assistant", text: "first" }, { role: "assistant", text: "Shorter draft." }];
  assert.deepEqual(await voiceResult({ session: "ses_1" }, on), { state: "done", text: "Shorter draft." });
});

test("agent choice: plan, then chat, then opencode's default", () => {
  assert.equal(agentFor(new Set(["plan", "chat"])), "plan");
  assert.equal(agentFor(new Set(["chat"])), "chat");
  assert.equal(agentFor(new Set(["build"])), undefined);
  assert.equal(agentFor(new Set()), undefined);
});

test("bad input and unknown runs are refused; a run with no reply fails", async () => {
  await rejects(runVoice({ kind: "nope", prompt: "x" }, on), "bad_request");
  await rejects(runVoice({ kind: "style", prompt: "   " }, on), "bad_request");
  await rejects(runVoice({ kind: "style", prompt: "x".repeat(MAX_PROMPT + 1) }, on), "bad_request");
  await rejects(voiceResult({ session: "ses_9" }, on), "not_found");
  await runVoice({ kind: "learn", prompt: "x" }, on);
  upsertSession("ses_1", { status: "idle" });
  assert.equal((await voiceResult({ session: "ses_1" }, on)).state, "failed");
  upsertSession("ses_1", { error: "boom" });
  assert.deepEqual(await voiceResult({ session: "ses_1" }, on), { state: "failed", error: "boom" });
  oc.connected = false;
  await rejects(runVoice({ kind: "style", prompt: "x" }, on), "unavailable");
});

test("Notes' Clean up runs as its own kind, titled for it, with the read-only agent (1.35.0)", async () => {
  const r = await runVoice({ kind: "cleanup", prompt: "Clean up the document at the end." }, on);
  assert.equal(sessions.get(r.session).title, "Notes: clean up a document");
  assert.equal(prompts[0].agent, "plan");
  assert.deepEqual(prompts[0].tools, { "*": false }, "no tool definitions go to the model");
});

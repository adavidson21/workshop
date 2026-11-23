// Warm up (connector 1.41.0, lib/warm.mjs): when it runs, what it sends, and that the scratch session goes away.
// A stand-in opencode API; synthetic data only.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_IDLE_MS, WARM_TEXT, needWarm, resetWarm, warmUp } from "../lib/warm.mjs";
import { configure } from "../lib/context.mjs";

configure({ config: {}, env: () => undefined, log: { info() {}, warn() {} } });

let made, sent, deleted;
const api = {
  async createSession(title) { made.push(title); return { id: `ses_${made.length}` }; },
  async promptWait(id, body) { sent.push({ id, ...body }); return "OK"; },
  async deleteSession(id) { deleted.push(id); return true; },
};
beforeEach(() => { resetWarm(); made = []; sent = []; deleted = []; });

test("needWarm: always on connect; on open only for a local model idle long enough to be unloaded", () => {
  const now = 10 * LOCAL_IDLE_MS;
  assert.equal(needWarm({ reason: "connect", now }), true);
  assert.equal(needWarm({ reason: "connect", now, off: true }), false);
  assert.equal(needWarm({ reason: "connect", now, busy: true }), false, "a busy model is already warm");
  assert.equal(needWarm({ reason: "open", local: false, now }), false, "a hosted model has no cold start to hide");
  assert.equal(needWarm({ reason: "open", local: true, now, lastActive: now - 1000 }), false);
  assert.equal(needWarm({ reason: "open", local: true, now, lastActive: now - LOCAL_IDLE_MS }), true);
  assert.equal(needWarm({ reason: "open", local: true, now, warmedAt: now - 1000 }), false);
});

test("warmUp: without plan, one tiny answer with tools off in a scratch session, deleted afterwards", async () => {
  const r = await warmUp({ reason: "connect", api, agents: new Set(["build"]), busy: false });
  assert.equal(r.warmed, true);
  assert.equal(made.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, WARM_TEXT);
  assert.equal(sent[0].agent, null);
  assert.deepEqual(sent[0].tools, { "*": false });
  assert.deepEqual(deleted, ["ses_1"]);
});

test("warmUp: opencode's read-only plan agent with its tools, so the tool setup is warm too", async () => {
  await warmUp({ reason: "connect", api, agents: new Set(["build", "plan", "quick"]), busy: false });
  assert.equal(sent[0].agent, "plan");
  assert.equal(sent[0].tools, null);
});

test("warmUp: two calls at once share one request; a warm model is not warmed again on open", async () => {
  const [a, b] = await Promise.all([warmUp({ reason: "connect", api, busy: false }), warmUp({ reason: "connect", api, busy: false })]);
  assert.equal(made.length, 1);
  assert.deepEqual(a, b);
  const again = await warmUp({ reason: "open", local: true, api, busy: false });
  assert.equal(again.skipped, "not needed");
  assert.equal(made.length, 1);
});

test("warmUp: a failure is logged, not thrown, and the scratch session is still deleted", async () => {
  const bad = { ...api, async promptWait() { throw new Error("model not loaded"); } };
  const r = await warmUp({ reason: "connect", api: bad, busy: false });
  assert.equal(r.warmed, false);
  assert.deepEqual(deleted, ["ses_1"]);
});

test("warmUp: skipped when opencode's API cannot do it", async () => {
  const r = await warmUp({ reason: "connect", api: { createSession() {} }, busy: false });
  assert.equal(r.skipped, "unsupported");
});

// lib/workspace.mjs (1.36.0): the board's runs get autopilot's protections. A model error runs the command again
// once, a minute later, in the same session; a run with no word from the model for the stall time is stopped and
// handled the same way; a run waiting on your answer is never a stall. Fake opencode, no timers of the real kind.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { loose, looseFailed, looseTiming, looseWatch } from "../lib/workspace.mjs";
import { oc, questions, sessions, upsertSession } from "../lib/opencode-state.mjs";

const calls = [];
const saved = { connected: oc.connected, api: oc.api };
function fake() {
  calls.length = 0;
  oc.connected = true;
  oc.api = {
    runCommand: async (sid, name, args) => { calls.push(["run", sid, name, args]); return null; },
    prompt: async (sid, text, agent) => { calls.push(["prompt", sid, agent]); },
    abort: async (sid) => { calls.push(["abort", sid]); },
  };
}
afterEach(() => { loose.clear(); sessions.clear(); questions.clear(); oc.connected = saved.connected; oc.api = saved.api; looseTiming.retryMs = 60e3; });
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a model error runs the same command again once, in the same session; the second error stays", async () => {
  fake();
  looseTiming.retryMs = 1;
  loose.set("ses_1", { command: "/triage csv export", at: Date.now(), name: "triage", args: "csv export --name csv-export", label: "/triage", tries: 0 });
  upsertSession("ses_1", { status: "busy" });
  looseFailed("ses_1", "/triage failed: connection refused");
  assert.match(sessions.get("ses_1").error, /connection refused\. Trying again at/);
  await tick(); await tick();
  assert.deepEqual(calls, [["run", "ses_1", "triage", "csv export --name csv-export"]]);
  assert.equal(sessions.get("ses_1").status, "busy");
  looseFailed("ses_1", "/triage failed: connection refused");
  await tick();
  assert.equal(calls.length, 1, "only one retry");
  assert.match(sessions.get("ses_1").error, /It failed 2 times\. If the model server is down or busy, check it \(workshop doctor\)/);
});

test("errors that a retry cannot fix are shown at once", () => {
  fake();
  loose.set("ses_2", { command: "/shape x", at: Date.now(), name: "shape", args: "x", label: "/shape", tries: 0 });
  looseFailed("ses_2", "/shape failed: The prompt does not fit the model's context window");
  assert.equal(loose.get("ses_2").retryAt, undefined);
  assert.doesNotMatch(sessions.get("ses_2").error, /Trying again/);
});

test("the watchdog stops a silent run, but never one that waits on your answer", async () => {
  fake();
  looseTiming.retryMs = 1;
  const old = Date.now() - 31 * 60e3;
  loose.set("ses_3", { command: "/scope x", at: old, name: "scope", args: "x", label: "/scope", tries: 0 });
  loose.set("ses_4", { command: "/docs y", at: old, name: "docs", args: "y", label: "/docs", tries: 0 });
  upsertSession("ses_3", { status: "busy" }); sessions.get("ses_3").seenAt = old;
  upsertSession("ses_4", { status: "busy" }); sessions.get("ses_4").seenAt = old;
  questions.set("q1", { sessionID: "ses_4" });
  looseWatch();
  assert.deepEqual(calls.filter((c) => c[0] === "abort"), [["abort", "ses_3"]]);
  assert.match(sessions.get("ses_3").error, /no word from the model for 30 minutes\. Trying again/);
  assert.equal(sessions.get("ses_4").error, null, "waiting on you is not a stall");
  await tick(); await tick();
  assert.ok(calls.some((c) => c[0] === "run" && c[1] === "ses_3"), "the stalled run starts again");
});

test("a plain prompt (Tidy notes) is sent again as a prompt", async () => {
  fake();
  looseTiming.retryMs = 1;
  loose.set("ses_5", { command: "Tidy notes", at: Date.now(), prompt: "rough lines", agent: "people-prep", label: "Tidy notes", tries: 0 });
  looseFailed("ses_5", "Tidy notes: socket hang up");
  await tick(); await tick();
  assert.deepEqual(calls, [["prompt", "ses_5", "people-prep"]]);
});

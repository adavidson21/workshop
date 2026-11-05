// Tests for lib/hub.mjs (the hub on Dispatch's page) without PowerShell or opencode: start() stands in for runLoose
// and the test plays the hub agent by writing route.json and answer.md and ending the session. Synthetic data only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import oc from "../index.mjs";
import { KEEP, MAX_MESSAGE, folderFor, hubResult, hubRoot, prune, requestText, resetHub, runHub } from "../lib/hub.mjs";
import { sessions, upsertSession } from "../lib/opencode-state.mjs";
import { schemas } from "../../../tests/contract/helpers.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-hub-"));
const root = hubRoot(home);
after(() => fs.rmSync(home, { recursive: true, force: true }));
const on = { hub: true };

let started;
const start = async (name, args) => {
  const sid = `ses_${started.length + 1}`;
  started.push({ name, args });
  upsertSession(sid, { status: "busy" });
  return { session: sid };
};
beforeEach(() => { started = []; resetHub(); sessions.clear(); });
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));
const CONTEXT = { people: [{ id: "p_one", name: "Person One", handle: "person", relation: "report", team: true }, { id: "p_two", name: "Person\nTwo ## x", relation: "manager" },
  { id: "g_lead", name: "Leadership", handle: "leadership", kind: "group", members: ["p_one", "p_two", "p_gone"] }], lists: ["Inbox"], areas: [] };

test("the request goes to the connector's own folder, never the workspace", () => {
  assert.equal(root, path.join(home, "data", "_connectors", "opencode", "hub"));
  assert.equal(folderFor("hub_abc", root), path.join(root, "hub_abc"));
  assert.throws(() => folderFor("../x", root), (e) => e.code === "bad_request");
  assert.throws(() => folderFor("a", root), (e) => e.code === "bad_request");
});

test("everything is refused while the hub setting is off", async () => {
  await rejects(runHub({ id: "hub_abc", text: "x" }, { root, start, config: {} }), "unavailable", /Hub/);
  assert.throws(() => hubResult({ id: "hub_abc" }, { root, config: { hub: false } }), (e) => e.code === "unavailable");
  assert.equal(started.length, 0);
});

test("request.md: the message and one-line names, in the docs/hub.md layout", () => {
  const t = requestText({ text: "dont forget the doc for person", context: CONTEXT }, "2026-11-03");
  assert.match(t, /^# Hub request\n\nDate: 2026-11-03\n\n## Message\n\ndont forget the doc for person\n/);
  assert.match(t, /- p_one: Person One @person \(report, on my team\)\n/);
  assert.match(t, /- g_lead: Leadership @leadership \(group: Person One, Person Two ## x\)\n/);
  assert.match(t, /- p_two: Person Two ## x \(manager\)\n/, "a name never adds Markdown structure");
  assert.match(t, /## Docket lists\n\n- Inbox\n/);
  assert.match(t, /## Team areas\n\nNone\.\n/);
});

test("run saves request.md, clears old results, runs /hub <path>, and result follows the agent", async () => {
  const dir = folderFor("hub_abc", root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "route.json"), "{}");
  fs.writeFileSync(path.join(dir, "answer.md"), "old");
  const r = await runHub({ id: "hub_abc", text: "what version is the sample api on?", context: CONTEXT }, { root, start, config: on, now: new Date("2026-11-03T15:00:00") });
  assert.deepEqual(r, { session: "ses_1", id: "hub_abc" });
  assert.deepEqual(started, [{ name: "hub", args: path.join(dir, "request.md") }]);
  assert.equal(fs.existsSync(path.join(dir, "route.json")), false);
  assert.equal(fs.existsSync(path.join(dir, "answer.md")), false);
  assert.deepEqual(hubResult({ id: "hub_abc" }, { root, config: on }), { state: "running", session: "ses_1" });
  await rejects(runHub({ id: "hub_abc", text: "again" }, { root, start, config: on }), "conflict", /already running/);
  const route = { version: 1, intent: "ask", ask: { repos: ["sample-api"] } };
  fs.writeFileSync(path.join(dir, "route.json"), JSON.stringify(route));
  assert.deepEqual(hubResult({ id: "hub_abc" }, { root, config: on }), { state: "running", session: "ses_1", route }, "the route shows while it answers");
  fs.writeFileSync(path.join(dir, "answer.md"), "net8.0\n");
  upsertSession("ses_1", { status: "idle" });
  assert.deepEqual(hubResult({ id: "hub_abc" }, { root, config: on }), { state: "done", session: "ses_1", route, answer: "net8.0\n" });
});

test("a capture ends at routed; bad JSON and a silent end are failed; never asked is none", async () => {
  await runHub({ id: "hub_cap", text: "t a" }, { root, start, config: on });
  fs.writeFileSync(path.join(folderFor("hub_cap", root), "route.json"), JSON.stringify({ version: 1, intent: "go", go: { app: "queue" } }));
  upsertSession("ses_1", { status: "idle" });
  assert.equal(hubResult({ id: "hub_cap" }, { root, config: on }).state, "routed");
  await runHub({ id: "hub_bad", text: "x" }, { root, start, config: on });
  fs.writeFileSync(path.join(folderFor("hub_bad", root), "route.json"), "{nope");
  upsertSession("ses_2", { status: "idle" });
  assert.match(hubResult({ id: "hub_bad" }, { root, config: on }).error, /not valid JSON/);
  await runHub({ id: "hub_none", text: "x" }, { root, start, config: on });
  upsertSession("ses_3", { status: "idle", error: "/hub failed: boom" });
  assert.deepEqual(hubResult({ id: "hub_none" }, { root, config: on }), { state: "failed", session: "ses_3", error: "/hub failed: boom" });
  assert.deepEqual(hubResult({ id: "hub_never" }, { root, config: on }), { state: "none" });
});

test("empty and oversized messages are refused before anything runs", async () => {
  await rejects(runHub({ id: "hub_e", text: "  " }, { root, start, config: on }), "bad_request", /empty/);
  await rejects(runHub({ id: "hub_e", text: "x".repeat(MAX_MESSAGE + 1) }, { root, start, config: on }), "bad_request");
  assert.equal(started.length, 0);
});

test("prune keeps the newest folders", () => {
  const r = hubRoot(fs.mkdtempSync(path.join(os.tmpdir(), "workshop-hubp-")));
  fs.mkdirSync(r, { recursive: true });
  for (let i = 0; i < 5; i++) { const d = path.join(r, `hub_${i}aa`); fs.mkdirSync(d); fs.utimesSync(d, i + 1, i + 1); }
  assert.equal(prune(r, 3), 2);
  assert.deepEqual(fs.readdirSync(r).sort(), ["hub_2aa", "hub_3aa", "hub_4aa"]);
  assert.equal(KEEP, 200);
});

test("the actions: run needs confirm (write), result does not; the setting is off by default and local only", () => {
  assert.equal(oc.actions["hub.run"].write, true);
  assert.equal(oc.actions["hub.result"].write, false);
  const h = oc.configSchema.properties.hub;
  assert.equal(h.default, false);
  assert.equal(h["x-workshop-hosted"], undefined, "a hosted page cannot turn the hub on");
  const a = oc.actions["hub.run"].argsSchema;
  assert.deepEqual(schemas.validate(a, { id: "hub_abc", text: "hi", context: CONTEXT }), []);
  assert.notDeepEqual(schemas.validate(a, { id: "hub_abc", text: "hi", extra: 1 }), []);
  assert.notDeepEqual(schemas.validate(a, { id: "../etc", text: "hi" }), []);
  assert.notDeepEqual(schemas.validate(a, { id: "hub_abc", text: "hi", context: { people: [{ id: "p", name: "x", secret: 1 }] } }), []);
});

// Tests for lib/one-on-one.mjs (the 1:1s draft step) without PowerShell or opencode: start() stands in for
// runLoose and the test plays the agent by writing draft.md and ending the session. The full path through
// a fake opencode is in connector.test.mjs. Synthetic data only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import oc from "../index.mjs";
import { MAX_NOTES_BYTES, MAX_PACKET_BYTES, TIDY_AGENT, draftOneOnOne, folderFor, oneOnOneResult, oneOnOneRoot, resetOneOnOnes, tidyOneOnOne, tidyResult } from "../lib/one-on-one.mjs";
import { sessions, upsertSession } from "../lib/opencode-state.mjs";
import { schemas } from "../../../tests/contract/helpers.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-1on1-"));
const root = oneOnOneRoot(home);
after(() => fs.rmSync(home, { recursive: true, force: true }));

let started;
const start = async (name, args, agent) => {
  const sid = `ses_${started.length + 1}`;
  started.push(agent ? { name, args, agent } : { name, args });
  upsertSession(sid, { status: "busy" });
  return { session: sid };
};
beforeEach(() => {
  started = [];
  resetOneOnOnes();
  sessions.clear();
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));
const ARGS = { personId: "p_mh3k9x2a", date: "2026-11-03" };

test("the packet goes to the connector's own folder in the Workshop home, never the workspace", () => {
  assert.equal(root, path.join(home, "data", "_connectors", "opencode", "oneonones"));
  assert.equal(folderFor(ARGS, root), path.join(root, "p_mh3k9x2a-2026-11-03"));
  assert.throws(() => folderFor({ ...ARGS, personId: "../x" }, root), (e) => e.code === "bad_request");
  assert.throws(() => folderFor({ ...ARGS, date: "2026-11-03/../../x" }, root), (e) => e.code === "bad_request");
});

test("draft saves packet.md, clears an old draft, and runs /one-on-one <packet path> in a new session", async () => {
  const dir = folderFor(ARGS, root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "draft.md"), "old draft");
  const r = await draftOneOnOne({ ...ARGS, packet: "# 1:1 packet\n" }, { root, start });
  assert.deepEqual(r, { session: "ses_1", folder: "p_mh3k9x2a-2026-11-03" });
  assert.deepEqual(started, [{ name: "one-on-one", args: path.join(dir, "packet.md") }]);
  assert.equal(fs.readFileSync(path.join(dir, "packet.md"), "utf8"), "# 1:1 packet\n");
  assert.equal(fs.existsSync(path.join(dir, "draft.md")), false, "no stale draft");
  assert.deepEqual(oneOnOneResult(ARGS, { root }), { state: "running", session: "ses_1" });
  await rejects(draftOneOnOne({ ...ARGS, packet: "again" }, { root, start }), "conflict", /already running/);
  // The agent writes draft.md, then the session goes idle.
  fs.writeFileSync(path.join(dir, "draft.md"), "## Wins to recognize\n\n- Shipped the import fix\n");
  assert.equal(oneOnOneResult(ARGS, { root }).state, "running", "not done while the session still works");
  upsertSession("ses_1", { status: "idle" });
  assert.deepEqual(oneOnOneResult(ARGS, { root }), { state: "done", text: "## Wins to recognize\n\n- Shipped the import fix\n", session: "ses_1" });
});

test("a session that ends without draft.md is failed, with its error when it has one", async () => {
  await draftOneOnOne({ personId: "p_other", date: "2026-11-03", packet: "x" }, { root, start });
  upsertSession("ses_1", { status: "idle", error: "/one-on-one failed: boom" });
  assert.deepEqual(oneOnOneResult({ personId: "p_other", date: "2026-11-03" }, { root }), { state: "failed", session: "ses_1", error: "/one-on-one failed: boom" });
  assert.deepEqual(oneOnOneResult({ personId: "p_never", date: "2026-11-03" }, { root }), { state: "none" });
});

test("empty and oversized packets are refused before anything is written or run", async () => {
  await rejects(draftOneOnOne({ ...ARGS, date: "2026-11-04", packet: "  " }, { root, start }), "bad_request", /empty/);
  await rejects(draftOneOnOne({ ...ARGS, date: "2026-11-04", packet: "x".repeat(MAX_PACKET_BYTES + 1) }, { root, start }), "bad_request", /50 KB/);
  assert.equal(started.length, 0);
  assert.equal(fs.existsSync(folderFor({ ...ARGS, date: "2026-11-04" }, root)), false);
});

test("the actions: draft needs confirm (write), result does not; args are checked", () => {
  assert.equal(oc.actions["oneonone.draft"].write, true);
  assert.equal(oc.actions["oneonone.result"].write, false);
  const d = oc.actions["oneonone.draft"].argsSchema;
  assert.deepEqual(schemas.validate(d, { ...ARGS, packet: "# p" }), []);
  assert.notDeepEqual(schemas.validate(d, { ...ARGS, packet: "# p", extra: 1 }), []);
  assert.notDeepEqual(schemas.validate(d, { ...ARGS, personId: "../../etc", packet: "# p" }), []);
  assert.notDeepEqual(schemas.validate(d, { ...ARGS, packet: "x".repeat(MAX_PACKET_BYTES + 1) }), []);
  assert.deepEqual(schemas.validate(oc.actions["oneonone.result"].argsSchema, ARGS), []);
  assert.notDeepEqual(schemas.validate(oc.actions["oneonone.result"].argsSchema, { ...ARGS, date: "today" }), []);
});

test("tidy saves notes.md in its own -tidy folder and asks people-prep to write draft.md there", async () => {
  const ARGS = { personId: "p_mh3k9x2a", date: "2026-11-06" };
  const dir = folderFor(ARGS, root, "-tidy");
  assert.equal(dir, path.join(root, "p_mh3k9x2a-2026-11-06-tidy"), "never the talking points folder");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "draft.md"), "old tidy");
  const r = await tidyOneOnOne({ ...ARGS, notes: "- them to send the doc\n" }, { root, start });
  assert.deepEqual(r, { session: "ses_1", folder: "p_mh3k9x2a-2026-11-06-tidy" });
  assert.equal(started.length, 1);
  assert.equal(started[0].agent, TIDY_AGENT);
  assert.ok(started[0].args.includes(path.join(dir, "notes.md")) && started[0].args.includes(path.join(dir, "draft.md")), "the message names both files");
  assert.match(started[0].args, /## Follow-ups/);
  assert.match(started[0].args, /## Wins/);
  assert.equal(fs.readFileSync(path.join(dir, "notes.md"), "utf8"), "- them to send the doc\n");
  assert.equal(fs.existsSync(path.join(dir, "draft.md")), false, "no stale tidy");
  assert.deepEqual(tidyResult(ARGS, { root }), { state: "running", session: "ses_1" });
  assert.deepEqual(oneOnOneResult(ARGS, { root }), { state: "none" }, "talking points are separate");
  await rejects(tidyOneOnOne({ ...ARGS, notes: "again" }, { root, start }), "conflict", /already running/);
  fs.writeFileSync(path.join(dir, "draft.md"), "## Follow-ups\n\n- [ ] (them) Send the doc\n");
  upsertSession("ses_1", { status: "idle" });
  assert.deepEqual(tidyResult(ARGS, { root }), { state: "done", text: "## Follow-ups\n\n- [ ] (them) Send the doc\n", session: "ses_1" });
});

test("tidy refuses empty and oversized notes before anything is written or run", async () => {
  await rejects(tidyOneOnOne({ ...ARGS, date: "2026-11-05", notes: " " }, { root, start }), "bad_request", /empty/);
  await rejects(tidyOneOnOne({ ...ARGS, date: "2026-11-05", notes: "x".repeat(MAX_NOTES_BYTES + 1) }, { root, start }), "bad_request", /20 KB/);
  assert.equal(started.length, 0);
  assert.equal(fs.existsSync(folderFor({ ...ARGS, date: "2026-11-05" }, root, "-tidy")), false);
});

test("the tidy actions: tidy needs confirm (write), its result does not; args are checked", () => {
  assert.equal(oc.actions["oneonone.tidy"].write, true);
  assert.equal(oc.actions["oneonone.tidyResult"].write, false);
  const t = oc.actions["oneonone.tidy"].argsSchema;
  assert.deepEqual(schemas.validate(t, { ...ARGS, notes: "- x" }), []);
  assert.notDeepEqual(schemas.validate(t, { ...ARGS, notes: "- x", packet: "y" }), []);
  assert.notDeepEqual(schemas.validate(t, { ...ARGS, personId: "../../etc", notes: "- x" }), []);
  assert.notDeepEqual(schemas.validate(t, { ...ARGS, notes: "x".repeat(MAX_NOTES_BYTES + 1) }), []);
  assert.deepEqual(schemas.validate(oc.actions["oneonone.tidyResult"].argsSchema, ARGS), []);
});

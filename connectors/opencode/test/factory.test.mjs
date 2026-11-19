// The software factory's pure parts (1.21.0): factory settings, fair slots, overlaps, gaps and publish helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FACTORY_DEFAULTS, factoryOptions, writeFactoryFile } from "../lib/factory.mjs";
import { pickNext } from "../lib/autopilot.mjs";
import { overlapsOf, taskFiles } from "../lib/overlap.mjs";
import { cleanAnswer, parseGaps } from "../lib/gaps.mjs";
import { reviewQuestions } from "../lib/publish.mjs";

test("factory settings: defaults, ranges and the file Tandem reads", () => {
  assert.deepEqual(factoryOptions(undefined), { ...FACTORY_DEFAULTS });
  assert.deepEqual(factoryOptions({ taskFileCap: 99, quickTasks: 0, retries: 2, autoFix: "blockers", reviewRounds: 3, uiChecks: false, regression: false, worktrees: "busy" }),
    { taskFileCap: 6, quickTasks: 3, retries: 2, autoFix: "blockers", reviewRounds: 3, uiChecks: false, regression: false, worktrees: "busy" });
  assert.equal(factoryOptions({ autoFix: "nits" }).autoFix, "should-fix");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-"));
  assert.equal(writeFactoryFile(dir, FACTORY_DEFAULTS), true);
  assert.equal(writeFactoryFile(dir, FACTORY_DEFAULTS), false, "unchanged: not written again");
  const j = JSON.parse(fs.readFileSync(path.join(dir, "factory.json"), "utf8"));
  assert.equal(j.version, 1);
  assert.equal(j.taskFileCap, 6);
  assert.equal(writeFactoryFile(null, FACTORY_DEFAULTS), false);
});

test("fair slots: a project with nothing running goes first, then project order, then oldest", () => {
  const proj = { a1: "pA", a2: "pA", b1: "pB", c1: "pC", i1: "inbox" };
  const q = (f, t) => [f, { queued: t }];
  const opts = { projectOf: (f) => proj[f], order: ["pA", "pB", "pC", "inbox"] };
  // pA has a build running: pB's goes first even though pA's queued earlier.
  assert.equal(pickNext([q("a2", "1"), q("b1", "2")], ["a1"], opts)[0], "b1");
  // Neither running: project order wins over age.
  assert.equal(pickNext([q("c1", "1"), q("b1", "2")], [], opts)[0], "b1");
  // Same project: oldest first.
  assert.equal(pickNext([q("a2", "2"), q("a1", "1")], [], opts)[0], "a1");
  // Fair slots off: oldest first, whatever runs.
  assert.equal(pickNext([q("a2", "1"), q("b1", "2")], ["a1"], { ...opts, fair: false })[0], "a2");
  assert.equal(pickNext([], [], opts), null);
});

const TASKS = `# Tasks: L1 x

## [ ] Task 1: Add the field

- Repo: \`portal-api\`
- Covers: AC-1
- Files:
  - \`src/Orders/Refund.cs\` (changed)
  - \`tests/Orders/RefundTests.cs\` (new)
- Pattern to follow: \`src/Orders/Cancel.cs\`
- Verify: \`dotnet test\`

## [x] Task 2: Show it

- Repo: portal-ui
- Files:
  - \`src\\app\\refund.component.ts\` (changed)
  - \`<path/to/File.cs>\` (changed)
- Steps:
  1. x
`;

test("overlap: files from tasks.md, and items that share them", () => {
  assert.deepEqual(taskFiles(TASKS), ["portal-api/src/orders/refund.cs", "portal-api/tests/orders/refundtests.cs", "portal-ui/src/app/refund.component.ts"]);
  assert.deepEqual(taskFiles(""), []);
  const o = overlapsOf({ L1: ["portal-api/src/orders/refund.cs", "x/a"], L2: ["portal-api/src/orders/refund.cs"], L3: ["y/b"] });
  assert.deepEqual(o, { L1: [{ with: "L2", files: ["portal-api/src/orders/refund.cs"] }], L2: [{ with: "L1", files: ["portal-api/src/orders/refund.cs"] }] });
});

test("gaps: parse open and answered lines, clean answers", () => {
  const g = parseGaps("# Knowledge gaps\n\n- G1 | 2026-11-18 | fact | Portal | L12 | May a refund exceed the total? | No, capped | open\n- G2 | 2026-11-18 | odd | - | - | Who approves? | - | answered 2026-11-19: team/handbook.md, Releases\nnot a line\n");
  assert.deepEqual(g[0], { id: "G1", n: 1, date: "2026-11-18", kind: "fact", product: "Portal", source: "L12", question: "May a refund exceed the total?", assumed: "No, capped", status: "open", answeredOn: null, where: null });
  assert.equal(g[1].kind, "fact", "unknown kinds read as fact");
  assert.equal(g[1].status, "answered");
  assert.equal(g[1].where, "team/handbook.md, Releases");
  assert.equal(g[1].assumed, null);
  assert.equal(cleanAnswer("  a\nb  "), "a b");
  assert.throws(() => cleanAnswer("   "), /Write the answer/);
  assert.throws(() => cleanAnswer("x".repeat(501)), /500 characters/);
});

test("publish: review questions, placeholders left out", () => {
  const text = "# Review\n\n## Questions for you\n\nThings the reviewer was not sure are problems.\n\n- `api/a.cs:3`: is a null total possible?\n- None\n\n## Manual validation\n- not a question\n";
  assert.deepEqual(reviewQuestions(text), ["`api/a.cs:3`: is a null total possible?"]);
  assert.deepEqual(reviewQuestions("## Questions for you\n\n- <`repo/path/File.cs:42`: question, or \"None\">\n"), []);
  assert.deepEqual(reviewQuestions(null), []);
});

test("ADO links: the line in workitem.md, linked and local, and setting it", async () => {
  const { linkOf, setLine } = await import("../lib/ado-link.mjs");
  assert.deepEqual(linkOf("41207", "# Work item 41207: x\n- Type: Bug\n"), { linked: true, ado: "41207", was: null });
  assert.deepEqual(linkOf("L3", "# Work item L3: x\n"), { linked: false, ado: null, was: null });
  assert.deepEqual(linkOf("L3", "- ADO item: 5012\n"), { linked: true, ado: "5012", was: null });
  assert.deepEqual(linkOf("41207", "- ADO item: unlinked (was 41207)\n"), { linked: false, ado: null, was: "41207" });
  assert.deepEqual(linkOf("41207", "- ADO item: unlinked\n"), { linked: false, ado: null, was: null });
  const wi = "# Work item L3: Add export\n\n- Type: Feature\n- State: New\n\n## Description\n- not a field line: x\n";
  const once = setLine(wi, "5012");
  assert.equal(once, "# Work item L3: Add export\n\n- ADO item: 5012\n- Type: Feature\n- State: New\n\n## Description\n- not a field line: x\n");
  assert.equal(setLine(once, "unlinked (was 5012)"), once.replace("- ADO item: 5012", "- ADO item: unlinked (was 5012)"));
  assert.equal(setLine("# Work item L4: y", "unlinked"), "# Work item L4: y\n- ADO item: unlinked\n");
});

test("regression suite results: read from tests/, a failure after the change keeps a build out of Publish all ready (1.26.0)", async () => {
  const { testResults, checksFailed } = await import("../lib/publish.mjs");
  const { configure, shutdown } = await import("../lib/context.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suite-"));
  const folder = "L9-refund";
  const tdir = path.join(dir, ".work", folder, "tests");
  fs.mkdirSync(tdir, { recursive: true });
  const w = (name, r) => fs.writeFileSync(path.join(tdir, `results-${name}.json`), "\uFEFF" + JSON.stringify({ version: 1, name, ...r }));
  w("before", { verdict: "fail", passed: 1, failed: 1, failures: [{ file: "orders.spec.ts", title: "Orders > exports csv", error: "x" }] });
  w("after", { verdict: "pass", passed: 3, failed: 0, flaky: 1, preExisting: [{ file: "orders.spec.ts", title: "Orders > exports csv" }], flakyTests: [{ file: "orders.spec.ts", title: "Orders > lists" }], newTests: [{ file: "refund.spec.ts", title: "saves [AC-1]", status: "expected" }], acceptance: ["AC-1", "bad"] });
  fs.writeFileSync(path.join(tdir, "playwright-after.json"), "{}");
  try {
    configure({ config: { workspace: dir }, env: () => undefined });
    const rows = testResults(folder);
    assert.deepEqual(rows.map((r) => [r.name, r.verdict]), [["before", "fail"], ["after", "pass"]]);
    const after = rows[1];
    assert.equal(after.flaky, 1);
    assert.deepEqual(after.acceptance, ["AC-1"], "only AC-<n> ids are kept");
    assert.equal(after.preExisting.length, 1);
    assert.deepEqual(testResults("L10-none"), []);
    assert.equal(checksFailed({ ui: [], tests: rows }), false, "a failing before run does not count");
    assert.equal(checksFailed({ ui: [], tests: [...rows, { name: "pr", verdict: "fail" }] }), true);
    assert.equal(checksFailed({ ui: [{ name: "after", verdict: "fail" }], tests: [] }), true);
  } finally {
    try { shutdown(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

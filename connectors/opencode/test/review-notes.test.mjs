// lib/review-notes.mjs (1.28.0): Tandem's findings at their lines, and the files in reading order.
// Run: node --test "connectors/opencode/test/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";
import { findingsOf, isGenerated, isTest, locOf, notesFor, questionsOf, readingOrder, tasksWithFiles } from "../lib/review-notes.mjs";

const REVIEW = (rows, q = "- None") => `# Review: L1 x\n\nVerdict: READY\n\n## Pass 2: Code quality\n\n| # | Severity | Category | Location | Problem | Suggested fix |\n|---|---|---|---|---|---|\n${rows}\n\n## Questions for you\n\n${q}\n`;

test("locations: the repo folder comes off; another repo's path is not this repo's", () => {
  assert.deepEqual(locOf("`gateway/src/a.ts:42`", "gateway", ["gateway", "web"]), { path: "src/a.ts", line: 42 });
  assert.deepEqual(locOf("src/a.ts:7-9", "gateway", ["gateway"]), { path: "src/a.ts", line: 7 });
  assert.equal(locOf("web/x.ts:3", "gateway", ["gateway", "web"]), null);
  assert.equal(locOf("src/a.ts", "gateway"), null, "no line");
});

test("findings and questions from review.md; placeholders are left out", () => {
  const f = findingsOf(REVIEW("| 1 | Blocker | security | `gateway/a.ts:3` | Token logged | Remove it |\n| 2 | <Blocker / Should fix / Nit> | <category> | x | y | z |"));
  assert.deepEqual(f, [{ n: "1", severity: "blocker", category: "security", location: "gateway/a.ts:3", problem: "Token logged", fix: "Remove it" }]);
  assert.deepEqual(questionsOf(REVIEW("", "- `gateway/b.ts:10`: Is the cap per user?\n- A question with no place")), [{ location: "gateway/b.ts:10", text: "Is the cap per user?" }]);
});

test("notes: earlier rounds' Blockers and Should fix show as fixed, the current review's as open, with questions", () => {
  const rounds = [
    { name: "review-2026-11-19-1", text: REVIEW("| 1 | Blocker | correctness | `gateway/a.ts:3` | Off by one | Use <= |\n| 2 | Nit | tests | `gateway/a.test.ts:9` | Name | Rename |") },
    { name: "review", text: REVIEW("| 1 | Nit | consistency | `gateway/a.ts:5` | Spacing | Format |", "- `gateway/a.ts:8`: Should this be cached?") },
  ];
  const n = notesFor(rounds, "gateway", ["gateway"]);
  assert.deepEqual(n.map((x) => [x.path, x.line, x.kind, x.severity, x.state, x.round]), [
    ["a.ts", 3, "finding", "blocker", "fixed", 1],
    ["a.test.ts", 9, "finding", "nit", "open", 1],
    ["a.ts", 5, "finding", "nit", "open", 2],
    ["a.ts", 8, "question", "question", "open", 2],
  ]);
  assert.equal(n[0].text, "Off by one Fix: Use <=");
});

test("reading order: by task, tests after their code, files no task named next, generated and lock files last and folded", () => {
  const tasks = tasksWithFiles("# Tasks\n\n## [x] Task 1: Add the reason field\n\n- Repo: `web`\n- Files:\n  - `src/refund.ts` (changed)\n  - `src/refund.test.ts` (new)\n- Verify: `npm test`\n\n## [ ] Task 2: Show it\n\n- Repo: `web`\n- Files:\n  - `web/src/view.ts` (changed)\n- Verify: `npm test`\n\n## [x] Task 3: Other repo\n\n- Repo: `api`\n- Files:\n  - `src/view.ts` (changed)\n");
  assert.deepEqual(tasks.map((t) => [t.n, t.repo, t.files]), [[1, "web", ["src/refund.ts", "src/refund.test.ts"]], [2, "web", ["web/src/view.ts"]], [3, "api", ["src/view.ts"]]]);
  const files = ["package-lock.json", "src/view.ts", "src/refund.test.ts", "src/extra.ts", "src/refund.ts"].map((path) => ({ path, status: "modified", additions: 1, deletions: 0 }));
  const o = readingOrder(files, tasks, "web");
  assert.deepEqual(o.map((f) => [f.path, f.task && f.task.n, f.folded]), [
    ["src/refund.ts", 1, false],
    ["src/refund.test.ts", 1, false],
    ["src/view.ts", 2, false],
    ["src/extra.ts", null, false],
    ["package-lock.json", null, true],
  ]);
  assert.equal(isGenerated("db/Migrations/2026_Init.Designer.cs"), true);
  assert.equal(isTest("tests/OrdersTests.cs"), true);
  assert.equal(isTest("src/orders.ts"), false);
});

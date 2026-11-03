// The .work parser (parser/New-Dashboard.ps1, a copy of eng-agents' core/scripts/dashboard/New-Dashboard.ps1)
// run directly on the synthetic example workspace. Needs PowerShell; skipped without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hasPowerShell, makeWorkspace, REPO } from "./harness.mjs";

const skip = hasPowerShell ? false : "PowerShell is not installed (the .work parser needs it)";
const ps = ["pwsh", "powershell"].find((exe) => spawnSync(exe, ["-NoProfile", "-Command", "1"], { windowsHide: true }).status === 0);
const script = path.join(REPO, "connectors", "opencode", "parser", "New-Dashboard.ps1");

test("a TSD that /publish marked PUBLISHED to <path> on <date> shows as Published", { skip }, () => {
  const ws = makeWorkspace();
  try {
    const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-WorkRoot", ws.work, "-AsJson"], { cwd: ws.dir, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const tsd = JSON.parse(r.stdout).items.find((i) => i.folder === "tsd-billing-api");
    assert.ok(tsd, "the example TSD is listed");
    assert.equal(tsd.state, "Published");
  } finally { ws.remove(); }
});

test("a pr-<id> folder is a PR review: title, recommendation, and comments from review.md", { skip }, () => {
  const ws = makeWorkspace();
  try {
    const dir = path.join(ws.work, "pr-812");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "context.md"), "# Pull request 812: Add discount to cart total\n\n- Repo: orders-api (folder `orders-api`)\n- Author: Dev One\n- Link: https://ado.example.test/tfs/Coll/Shop/_git/orders-api/pullrequest/812\n- Source commit: 4b16cacb238ad944fc6f56fb40447dc4a6aff3fa\n");
    fs.writeFileSync(path.join(dir, "review.md"), "# PR review: 812 Add discount\n\nReviewed commit: 4b16cac\nReviewed: 2026-11-02\nRecommendation: Request changes\nRisk: medium\n\n## Summary\n\nAdds a discount.\n\n## Comments\n\n### C1\n- File: `src/cart.js`\n- Line: 3\n- Severity: blocking\n- Why: Negative discounts raise the total.\n\n> Can we reject a negative discount here?\n\n## Questions for the author\n\n- None\n");
    const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-WorkRoot", ws.work, "-AsJson"], { cwd: ws.dir, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const it = JSON.parse(r.stdout).items.find((i) => i.folder === "pr-812");
    assert.equal(it.kind, "pr");
    assert.equal(it.title, "Add discount to cart total");
    assert.equal(it.state, "Request changes, 1 comment");
    assert.equal(it.prReview.risk, "medium");
    assert.deepEqual(it.prReview.counts, { blocking: 1, "should-fix": 0, optional: 0 });
    assert.deepEqual(it.prReview.comments, [{ id: "C1", file: "src/cart.js", line: "3", severity: "blocking", why: "Negative discounts raise the total.", comment: "Can we reject a negative discount here?" }]);
    assert.deepEqual(it.prReview.questions, []);
    fs.writeFileSync(path.join(dir, "context.md"), fs.readFileSync(path.join(dir, "context.md"), "utf8").replace("4b16cac", "9999999"));
    const again = JSON.parse(spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-WorkRoot", ws.work, "-AsJson"], { cwd: ws.dir, encoding: "utf8", windowsHide: true }).stdout);
    assert.equal(again.items.find((i) => i.folder === "pr-812").state, "Review is for an older commit");
  } finally { ws.remove(); }
});

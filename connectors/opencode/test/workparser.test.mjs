// lib/workparser.mjs, the .work parser in JavaScript: it must read every folder the way parser/New-Dashboard.ps1
// does. The parity tests run both on the same workspaces and compare the models (skipped without PowerShell);
// the rest check the JavaScript on its own, so they run everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readWork, isoLocal, remoteWeb, branchLinks, field, section } from "../lib/workparser.mjs";
import { hasGit, hasPowerShell, makeWorkspace, REPO } from "./harness.mjs";

const ps = ["pwsh", "powershell"].find((exe) => spawnSync(exe, ["-NoProfile", "-Command", "1"], { windowsHide: true }).status === 0);
const script = path.join(REPO, "connectors", "opencode", "parser", "New-Dashboard.ps1");
const noPs = hasPowerShell ? false : "PowerShell is not installed (the parity tests run New-Dashboard.ps1)";
const noGit = hasGit ? false : "git is not installed";

function fromPs(work, config) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-WorkRoot", work, "-AsJson", "-ConfigPath", config];
  const r = spawnSync(ps, args, { cwd: path.dirname(work), encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
// Everything but the clock and the command that re-runs the PowerShell page.
// Sort-Object is not stable, so items (and activity) with the same time come out in either order: compare ties by folder.
const comparable = (m) => {
  const c = structuredClone(m);
  delete c.generated; delete c.generatedMs; delete c.refreshShell;
  c.items.sort((a, b) => b.modifiedMs - a.modifiedMs || a.folder.localeCompare(b.folder));
  c.activity.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.modifiedMs - a.modifiedMs || b.order - a.order || a.folder.localeCompare(b.folder));
  return c;
};

const g = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function gitRepo(dir, { branch = "main", remote = null, commits = 1 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.email", "t@example.com"); g(dir, "config", "user.name", "T"); g(dir, "config", "commit.gpgsign", "false");
  for (let i = 0; i < commits; i++) { fs.writeFileSync(path.join(dir, `f${i}.txt`), `${i}\n`); g(dir, "add", "."); g(dir, "commit", "-q", "-m", `commit ${i}: café`); }
  if (remote) g(dir, "remote", "add", "origin", remote);
  if (branch !== "main") g(dir, "checkout", "-q", "-b", branch);
}

// The edge cases New-Dashboard.ps1 handles: CRLF files, placeholders, odd case, local ids, PR reviews, scopes,
// paused and blocked items, a changed file list, categories, and repos with remotes of every kind.
function richWorkspace() {
  const ws = makeWorkspace({ repos: hasGit });
  const w = (rel, text, crlf = false) => { const p = path.join(ws.work, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, crlf ? text.replace(/\n/g, "\r\n") : text); };
  w("L7-local-thing/workitem.md", "# Work item L7: Local thing ✓\n\n- Type: Bug\n- Link: https://example.test/notes/7\n");
  w("L7-local-thing/progress.md", "# Progress: L7 Local thing\n\n## 2026-11-01 09:00 | /do-task | build\n- Did: Tried it\n- Verify: FAIL tests\n- Notes: Blocked on the API\n");
  w("L7-local-thing/repos.md", "Lane: bug\n\n| Order | Folder | Branch | Shared | Why |\n|---|---|---|---|---|\n| 1 | `Platform/api` | dev/bug/L7-local-thing | y | API |\n");
  w("L7-local-thing/tasks.md", "## [ ] Task 1: Fix it\n- Repo: Platform/api\n## [x] Task 2: Test it\n");
  w("50001-crlf-item/workitem.md", "# Work item 50001: CRLF item\n\n- Type: User Story\n- State: New\n- ADO: work (Main/Web Shop)\n- Fetched: 2026-11-02\n", true);
  w("50001-crlf-item/repos.md", "- Lane: Feature\n\n| Order | Folder | Branch | Shared | Why |\n| --- | --- | --- | --- | --- |\n| 1 | `gh-repo` | `dev/feature/50001-crlf` | no | <why> |\n| 2 | ado repo | dev/feature/50001-crlf | | |\n", true);
  w("50001-crlf-item/spec.md", "# Spec\n\nStatus: APPROVED\n", true);
  w("50001-crlf-item/plan.md", "Status: DRAFT\n", true);
  w("50001-crlf-item/paused.md", "# Paused\n\nStatus: paused\n- Paused: 2026-11-03\n- Reason: Not given\n- In progress: Task 2\n\n## Work in progress\n\nNone.\n\n## Waiting on\n\n- Nothing\n", true);
  w("50001-crlf-item/pr.md", "# PR text\n\n## gh-repo\n\n- **Branch:** `dev/feature/50001-crlf` → `develop`\n**Title:** Add the thing\n\n**Description:**\n\n---\nBody line one\n<!-- note -->\n\n## missing-repo\nBranch: a -> b\nTitle: <title>\nDescription: <desc>\n", true);
  w("50002-reviewed/workitem.md", "# Work item 50002: Reviewed\n\n- Type: Bug\n");
  w("50002-reviewed/repos.md", "Lane: bug\n| 1 | gh-repo | dev/bug/50002 | | |\n");
  w("50002-reviewed/bug.md", "Status: APPROVED\n");
  w("50002-reviewed/tasks.md", "## [x] Task 1: Done thing\n");
  w("50002-reviewed/review.md", "Verdict: changes requested\n");
  w("PR-77/context.md", "# Pull request 77: Tidy logging\n\n- Repo: gh-repo (folder `gh-repo`)\n- Author: Dev Two\n- Branch: feature/logs\n- Source commit: abcdef123\n- Size: 3 files\n");
  w("PR-77/review.md", "Reviewed commit: abcdef1\nReviewed: 2026-11-04\nRecommendation: Approve\nRisk: low\n\n## Summary\n\nFine.\n\n## Comments\n\n### c2\n- File: `a.js`\n- Severity: Should fix\n> Rename this.\n> Please.\n\n### C3\n- Severity: weird\n\n## Questions for the author\n\n- Why now?\n- None\n* <q>\n");
  w("PR-77/history/review-1.md", "old\n");
  w("scope-payments/epics.md", "Epic: Payments v2\n");
  w("scope-payments/stories.md", "Status: APPROVED\n");
  w("scope-payments/milestones.md", "Status: APPROVED\n");
  w("scope-payments/backlog.csv", "a,b\n");
  w("docs-onboarding/sources.md", "x\n");
  w("docs-onboarding/check.md", "x\n");
  w("random-folder/notes.md", "x\n");
  w("_private/ignored.md", "x\n");
  w("41207-fix-login-timeout/zz-extra.md", "x\n");
  w("41207-fix-login-timeout/Another.md", "x\n");
  fs.mkdirSync(path.join(ws.dir, "Platform"), { recursive: true });
  fs.mkdirSync(path.join(ws.dir, "Empty Category"), { recursive: true });
  if (hasGit) {
    const origin = path.join(path.dirname(ws.dir), "origin-gh.git");
    g(path.dirname(ws.dir), "init", "-q", "--bare", origin);
    gitRepo(path.join(ws.dir, "gh-repo"), { branch: "dev/feature/50001-crlf", remote: "git@github.com:acme/gh-repo.git", commits: 2 });
    gitRepo(path.join(ws.dir, "ado repo"), { branch: "dev/feature/50001-crlf", remote: "https://user@dev.azure.com/acme/Web%20Shop/_git/ado-repo" });
    gitRepo(path.join(ws.dir, "Platform", "api"), { branch: "dev/bug/L7-local-thing", remote: "ssh://git@ssh.example.org:2222/team/api.git" });
    gitRepo(path.join(ws.dir, "Platform", "web"), { remote: origin });
    g(path.join(ws.dir, "Platform", "web"), "push", "-q", "-u", "origin", "main");
    fs.writeFileSync(path.join(ws.dir, "Platform", "web", "dirty \"q\".txt"), "x\n");
    fs.writeFileSync(path.join(ws.dir, "Platform", "web", "f0.txt"), "changed\n");
    g(path.join(ws.dir, "Platform", "web"), "commit", "-q", "-am", "ahead by one");
    gitRepo(path.join(ws.dir, "Platform", "empty"), { commits: 0 });
  }
  const config = path.join(path.dirname(ws.dir), "eng-config.json");
  fs.writeFileSync(config, JSON.stringify({ default: "work", connections: { work: { serverUrl: "https://ado.example.test/tfs/", collection: "Main", project: "Web Shop" } } }));
  return { ...ws, config };
}

test("parity: the example workspace reads the same as New-Dashboard.ps1", { skip: noPs }, async () => {
  const ws = makeWorkspace({ repos: hasGit });
  try {
    const config = path.join(ws.dir, "no-config.json");
    const js = await readWork({ workRoot: ws.work, configPath: config });
    assert.deepEqual(comparable(js), comparable(fromPs(ws.work, config)));
  } finally { ws.remove(); }
});

test("parity: edge cases (CRLF, odd case, local ids, PR reviews, scopes, paused, blocked, remotes, categories)", { skip: noPs || noGit }, async () => {
  const ws = richWorkspace();
  try {
    const js = await readWork({ workRoot: ws.work, configPath: ws.config });
    const pw = fromPs(ws.work, ws.config);
    for (const it of pw.items) assert.deepEqual(js.items.find((x) => x.folder === it.folder), it, `item ${it.folder}`);
    assert.deepEqual(comparable(js), comparable(pw));
  } finally { ws.remove(); }
});

test("parity: no git on PATH reads items and repos without git state", { skip: noPs }, async () => {
  const ws = makeWorkspace({ repos: hasGit });
  try {
    const config = path.join(ws.dir, "none.json");
    const js = await readWork({ workRoot: ws.work, configPath: config, gitOk: false });
    assert.equal(js.gitAvailable, false);
    for (const r of js.repos) { assert.equal(r.git.isGit, true); assert.equal(r.git.branch, null); }
  } finally { ws.remove(); }
});

test("the example workspace gives the items docs/examples/work/expected.json describes", async () => {
  const ws = makeWorkspace();
  try {
    const js = await readWork({ workRoot: ws.work, configPath: path.join(ws.dir, "none.json") });
    const expected = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "examples", "work", "expected.json"), "utf8")).items;
    for (const e of expected) {
      const it = js.items.find((x) => x.folder === e.folder);
      assert.ok(it, e.folder);
      for (const k of ["kind", "id", "title", "type", "adoState", "lane", "laneGuessed", "gates", "bucket", "stage"]) if (k in e) assert.deepEqual(it[k], e[k], `${e.folder}.${k}`);
    }
  } finally { ws.remove(); }
});

test("edge cases on their own: local ids, blocked, paused, PR review, scope, CRLF", { skip: noGit }, async () => {
  const ws = richWorkspace();
  try {
    const m = await readWork({ workRoot: ws.work, configPath: ws.config });
    const by = (f) => m.items.find((i) => i.folder === f);
    assert.equal(by("L7-local-thing").url, "https://example.test/notes/7");
    assert.equal(by("L7-local-thing").blocked, "Blocked on the API");
    assert.equal(by("L7-local-thing").next.command, "/bug L7");
    assert.equal(by("50001-crlf-item").bucket, "paused");
    assert.equal(by("50001-crlf-item").paused.reason, null);
    assert.equal(by("50001-crlf-item").url, "https://ado.example.test/tfs/Main/Web%20Shop/_workitems/edit/50001");
    assert.equal(by("50001-crlf-item").pr[0].target, "develop");
    assert.equal(by("50001-crlf-item").pr[0].links.pr, "https://github.com/acme/gh-repo/compare/develop...dev/feature/50001-crlf?expand=1");
    assert.equal(by("50002-reviewed").stage, "review");
    assert.equal(by("PR-77").state, "Approve, 2 comments");
    assert.deepEqual(by("PR-77").prReview.counts, { blocking: 0, "should-fix": 1, optional: 1 });
    assert.deepEqual(by("PR-77").prReview.questions, ["Why now?"]);
    assert.equal(by("PR-77").prReview.history, 1);
    assert.equal(by("scope-payments").state, "Import file ready");
    assert.equal(by("_private"), undefined);
    assert.deepEqual(m.repoCategories, ["Empty Category", "Platform"]);
    assert.ok(m.repos.some((r) => r.folder === "Platform/api" && r.owner === "L7" && r.ownerKnown));
  } finally { ws.remove(); }
});

test("helpers match .NET: remotes, links, fields, sections, ISO dates", () => {
  assert.deepEqual(remoteWeb("git@ssh.dev.azure.com:v3/org/Proj/repo"), { url: "https://dev.azure.com/org/Proj/_git/repo", kind: "ado" });
  assert.deepEqual(remoteWeb("https://me:tok@github.com/a/b.git/"), { url: "https://github.com/a/b", kind: "github" });
  assert.deepEqual(remoteWeb("ssh://git@host:22/x/y.git"), { url: "https://host/x/y", kind: "other" });
  assert.equal(remoteWeb("not a remote"), null);
  assert.deepEqual(branchLinks({ url: "https://h/c/p/_git/r", kind: "ado" }, "dev/x(1)", "main"), { branch: "https://h/c/p/_git/r?version=GBdev%2Fx%281%29", pr: "https://h/c/p/_git/r/pullrequestcreate?sourceRef=dev%2Fx%281%29&targetRef=main" });
  assert.equal(field("x\n- Type: `<type>`\n", "Type"), null);
  assert.equal(field("TYPE:  Bug  \r\n", "type"), "Bug");
  assert.equal(section("## Summary\r\n\r\nHi <!-- x -->\r\n## Next\n", "Summary"), "Hi");
  assert.match(isoLocal(1762613010123456700n), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.1234567[+-]\d{2}:\d{2}$/);
});

test("a missing work folder is an error that says what to pass", async () => {
  await assert.rejects(readWork({ workRoot: path.join(REPO, "no-such-folder", ".work") }), /No work folder at/);
});

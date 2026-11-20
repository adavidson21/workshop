// Merge without a PR (1.29.0): planning and pushing a merge against a real origin, in temp folders. Synthetic data only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mergeItem, mergesRepo, planMerge, pushMerge, safeRef, targetName } from "../lib/merge.mjs";
import { factoryOptions } from "../lib/factory.mjs";

let hasGit = true;
try { execFileSync("git", ["--version"]); } catch { hasGit = false; }
const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "Engineer A", GIT_AUTHOR_EMAIL: "a@example.test", GIT_COMMITTER_NAME: "Engineer A", GIT_COMMITTER_EMAIL: "a@example.test" } }).trim();

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-merge-"));
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "gateway");
  g(root, "init", "--quiet", "--bare", "-b", "main", origin);
  g(root, "clone", "--quiet", origin, repo);
  g(repo, "config", "user.name", "Engineer A");
  g(repo, "config", "user.email", "a@example.test");
  g(repo, "checkout", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\n");
  g(repo, "add", ".");
  g(repo, "commit", "--quiet", "-m", "start");
  g(repo, "push", "--quiet", "origin", "main");
  g(repo, "checkout", "--quiet", "-b", "dev/feature/41610-headers");
  fs.writeFileSync(path.join(repo, "b.txt"), "headers\n");
  g(repo, "add", ".");
  g(repo, "commit", "--quiet", "-m", "headers");
  g(repo, "checkout", "--quiet", "main");
  // Someone else moves main on origin, in another clone.
  const other = path.join(root, "other");
  g(root, "clone", "--quiet", origin, other);
  g(other, "config", "user.name", "Engineer B");
  g(other, "config", "user.email", "b@example.test");
  const bump = (file, text, msg) => { fs.writeFileSync(path.join(other, file), text); g(other, "add", "."); g(other, "commit", "--quiet", "-m", msg); g(other, "push", "--quiet", "origin", "main"); };
  return { root, origin, repo, bump, remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("settings: Merge, no PR is per machine, optionally only some repos; refs are checked", () => {
  assert.deepEqual([factoryOptions({}).publish, factoryOptions({}).mergeOnly], ["pr", ""]);
  const f = factoryOptions({ publish: "merge", mergeOnly: " gateway , web-app,bad;name " });
  assert.deepEqual([f.publish, f.mergeOnly], ["merge", "gateway, web-app"]);
  assert.equal(mergesRepo(f, "gateway"), true);
  assert.equal(mergesRepo(f, "billing"), false);
  assert.equal(mergesRepo(factoryOptions({ publish: "merge" }), "billing"), true, "blank: every repo");
  assert.equal(mergesRepo(factoryOptions({}), "gateway"), false);
  assert.equal(safeRef("dev/bug/1-x"), true);
  for (const bad of ["-x", "a..b", "a b", "x/", ""]) assert.equal(safeRef(bad), false, bad);
  assert.equal(targetName("origin/main"), "main");
});

test("a clean merge is one merge commit on origin's main; nothing is checked out and the branch is not pushed", { skip: !hasGit }, async () => {
  const s = setup();
  try {
    s.bump("c.txt", "other work\n", "other work");
    const before = g(s.repo, "status", "--porcelain");
    const r = await mergeItem([{ repo: "gateway", dir: s.repo, branch: "dev/feature/41610-headers", target: "main" }], (row) => `Merge ${row.branch}: Rate limit headers`);
    assert.equal(r.ok, true);
    const tip = g(s.origin, "rev-parse", "main");
    assert.equal(r.repos[0].merged, tip);
    assert.equal(g(s.origin, "log", "-1", "--format=%s", "main"), "Merge dev/feature/41610-headers: Rate limit headers");
    assert.equal(g(s.origin, "rev-list", "--parents", "-n", "1", "main").split(" ").length, 3, "two parents");
    assert.deepEqual(g(s.origin, "ls-tree", "--name-only", "main").split("\n").sort(), ["a.txt", "b.txt", "c.txt"]);
    assert.equal(g(s.repo, "branch", "--show-current"), "main", "still on main, untouched");
    assert.equal(g(s.repo, "status", "--porcelain"), before);
    assert.equal(g(s.origin, "branch", "--list", "dev/*"), "", "the branch itself is never pushed");
    // Publishing again: main has it already.
    const again = await planMerge(s.repo, { branch: "dev/feature/41610-headers", target: "main", message: "x" });
    assert.equal(again.already, true);
  } finally { s.remove(); }
});

test("a conflict pushes nothing and names the files; a target that moved after the plan is planned again", { skip: !hasGit }, async () => {
  const s = setup();
  try {
    g(s.repo, "checkout", "--quiet", "dev/feature/41610-headers");
    fs.writeFileSync(path.join(s.repo, "a.txt"), "one\nTWO from the branch\nthree\n");
    g(s.repo, "commit", "--quiet", "-am", "edit a");
    g(s.repo, "checkout", "--quiet", "main");
    s.bump("a.txt", "one\ntwo from main\nthree\n", "edit a on main");
    const tip = g(s.origin, "rev-parse", "main");
    const r = await mergeItem([{ repo: "gateway", dir: s.repo, branch: "dev/feature/41610-headers", target: "main" }], () => "m");
    assert.deepEqual([r.conflict.repo, r.conflict.target, r.conflict.files], ["gateway", "main", ["a.txt"]]);
    assert.equal(g(s.origin, "rev-parse", "main"), tip, "nothing pushed");
  } finally { s.remove(); }
  const t = setup();
  try {
    const plan = await planMerge(t.repo, { branch: "dev/feature/41610-headers", target: "main", message: "m" });
    assert.ok(plan.commit);
    t.bump("d.txt", "late\n", "late work");
    assert.deepEqual(await pushMerge(t.repo, plan), { moved: true }, "never forced over the new work");
    // mergeItem plans again after a move, so the new work stays.
    let pushes = 0;
    const r = await mergeItem([{ repo: "gateway", dir: t.repo, branch: "dev/feature/41610-headers", target: "main" }], () => "m", {
      push: async (dir, p) => { pushes++; if (pushes === 1) t.bump("e.txt", "later\n", "later work"); return pushMerge(dir, p); },
    });
    assert.equal(r.ok, true);
    assert.equal(pushes, 2);
    assert.deepEqual(g(t.origin, "ls-tree", "--name-only", "main").split("\n").sort(), ["a.txt", "b.txt", "d.txt", "e.txt"]);
  } finally { t.remove(); }
});

test("every repo is planned before any is pushed; a repo with no origin or no branch says so", { skip: !hasGit }, async () => {
  const s = setup();
  try {
    const lone = path.join(s.root, "lone");
    g(s.root, "init", "--quiet", "-b", "main", lone);
    const tip = g(s.origin, "rev-parse", "main");
    await assert.rejects(mergeItem([
      { repo: "gateway", dir: s.repo, branch: "dev/feature/41610-headers", target: "main" },
      { repo: "lone", dir: lone, branch: "dev/x", target: "main" },
    ], () => "m"), /lone has no origin remote/);
    assert.equal(g(s.origin, "rev-parse", "main"), tip, "gateway was not pushed either");
    await assert.rejects(mergeItem([{ repo: "gateway", dir: s.repo, branch: "dev/nope", target: "main" }], () => "m"), /gateway has no local branch dev\/nope/);
  } finally { s.remove(); }
});

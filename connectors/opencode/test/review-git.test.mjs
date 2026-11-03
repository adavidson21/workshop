// Tests for lib/review-git.mjs. Run: node --test "connectors/opencode/test/*.test.mjs"
// Builds a throwaway repo in the OS temp folder. Needs only git and Node 18+.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FILE_BYTES, branchHead, changedFiles, fileAt, isSafeBranch, isSafePath, mergeBase } from "../lib/review-git.mjs";

let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const lines = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix} line ${i + 1}`).join("\n") + "\n";

let base, head, mainTip;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-git-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test User");
  git("config", "commit.gpgsign", "false");
  write("src/keep.ts", lines(5, "keep"));
  write("src/old-name.ts", lines(20, "move"));
  write("src/gone.ts", "export const gone = 1;\n");
  write("assets/logo.bin", Buffer.from([0, 1, 2, 3]));
  git("add", "-A");
  git("commit", "-q", "-m", "Base");
  base = git("rev-parse", "HEAD");

  git("checkout", "-q", "-b", "dev/feature/1-sample");
  write("src/keep.ts", lines(5, "keep").replace("keep line 3", "changed line 3") + "added line\n");
  git("mv", "src/old-name.ts", "src/new-name.ts");
  git("rm", "-q", "src/gone.ts");
  write("src/with space.ts", "export const a = 1;\n");
  write("assets/logo.bin", Buffer.from([0, 9, 9, 9]));
  write("big.txt", "x".repeat(MAX_FILE_BYTES + 1));
  git("add", "-A");
  git("commit", "-q", "-m", "Feature");
  head = git("rev-parse", "HEAD");

  git("checkout", "-q", "main");
  write("src/main-only.ts", "export const m = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Main moves on");
  mainTip = git("rev-parse", "HEAD");
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("name checks", () => {
  test("isSafeBranch", () => {
    assert.ok(isSafeBranch("dev/feature/12-x"));
    for (const bad of ["-x", "a..b", "a b", "a;b", "", null]) assert.equal(isSafeBranch(bad), false, String(bad));
  });
  test("isSafePath", () => {
    assert.ok(isSafePath("src/x.ts"));
    assert.ok(isSafePath("src/with space.ts"));
    for (const bad of ["../x", "a/../b", "/etc/passwd", "C:/x", "-x", "a\\b", "a//b", "", "a\0b"]) assert.equal(isSafePath(bad), false, bad);
  });
});

describe("shas", () => {
  test("branchHead finds a local branch and returns null for a missing one", async () => {
    assert.equal(await branchHead(dir, "dev/feature/1-sample"), head);
    assert.equal(await branchHead(dir, "dev/feature/missing"), null);
  });
  test("branchHead rejects unsafe names", async () => {
    await assert.rejects(branchHead(dir, "--all"));
  });
  test("mergeBase uses the fork point, not the moving tip of main", async () => {
    assert.equal(await mergeBase(dir, mainTip, head), base);
  });
});

describe("changedFiles", () => {
  test("lists adds, modifies, deletes, renames, and binaries with counts", async () => {
    const files = await changedFiles(dir, base, head);
    const by = Object.fromEntries(files.map((f) => [f.path, f]));

    assert.deepEqual(by["src/keep.ts"], { path: "src/keep.ts", status: "modified", additions: 2, deletions: 1, binary: false });
    assert.deepEqual(by["src/new-name.ts"], { path: "src/new-name.ts", oldPath: "src/old-name.ts", status: "renamed", additions: 0, deletions: 0, binary: false });
    assert.deepEqual(by["src/gone.ts"], { path: "src/gone.ts", status: "deleted", additions: 0, deletions: 1, binary: false });
    assert.deepEqual(by["src/with space.ts"], { path: "src/with space.ts", status: "added", additions: 1, deletions: 0, binary: false });
    assert.equal(by["assets/logo.bin"].binary, true);
    assert.equal(by["assets/logo.bin"].status, "modified");
    assert.ok(by["big.txt"]);
    assert.equal(by["src/main-only.ts"], undefined, "a change only on main is not part of the branch diff");
    assert.equal(files.length, 6);
  });
  test("rejects anything but full shas", async () => {
    await assert.rejects(changedFiles(dir, "main", head));
  });
});

describe("fileAt", () => {
  test("text at either side", async () => {
    assert.deepEqual(await fileAt(dir, base, "src/old-name.ts"), { kind: "text", text: lines(20, "move") });
    assert.equal((await fileAt(dir, head, "src/keep.ts")).text.includes("changed line 3"), true);
  });
  test("missing for a file that does not exist on that side", async () => {
    assert.deepEqual(await fileAt(dir, base, "src/with space.ts"), { kind: "missing" });
    assert.deepEqual(await fileAt(dir, head, "src/gone.ts"), { kind: "missing" });
    assert.deepEqual(await fileAt(dir, head, "src"), { kind: "missing" }, "a folder is not a file");
  });
  test("binary and too large return placeholders, not content", async () => {
    assert.deepEqual(await fileAt(dir, head, "assets/logo.bin"), { kind: "binary", size: 4 });
    assert.deepEqual(await fileAt(dir, head, "big.txt"), { kind: "too_large", size: MAX_FILE_BYTES + 1 });
  });
  test("rejects unsafe paths", async () => {
    await assert.rejects(fileAt(dir, head, "../outside"));
  });
});

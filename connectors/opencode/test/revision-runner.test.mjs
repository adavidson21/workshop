// Tests for lib/revision-runner.mjs. Run: node --test "connectors/opencode/test/*.test.mjs"
// Uses a fake opencode launcher; the "agent" is the test writing commits and the response file.

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createCodeReview } from "../lib/code-review.mjs";
import { buildRevisionPrompt, createRevisionRunner } from "../lib/revision-runner.mjs";

const REPO = "sample-repo";
const BRANCH = "dev/feature/12-sample";
const FOLDER = "12-sample";

let ws, repoDir, workRoot, item, api, runner, sessionEvents, launched, headSha, startFails;
const roots = [];

const git = (...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, rel), content);
};
const reviewDir = () => path.join(workRoot, FOLDER, "code-review", REPO);
const readRun = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(reviewDir(), "run.json"), "utf8"));
  } catch {
    return {};
  }
};
const tick = () => new Promise((r) => setTimeout(r, 20));
async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

function feedback() {
  return {
    workItemId: "12",
    repo: REPO,
    revision: 1,
    headSha,
    verdict: "request_changes",
    summary: "A few fixes.",
    comments: [
      { id: "c1", path: "src/app.ts", side: "new", startLine: 2, endLine: 2, quotedCode: "two", type: "must_fix", body: "Use a constant." },
      { id: "c2", path: "src/app.ts", side: "new", startLine: 1, endLine: 1, quotedCode: "one", type: "question", body: "Why here?", suggestedCode: "ONE" },
    ],
  };
}

// The agent finishing its turn: commit, write the response file, go idle.
function agentFinishes({ responses = [{ commentId: "c1", status: "fixed", note: "Done." }], commit = true, rewrite = false } = {}) {
  if (rewrite) {
    git("reset", "-q", "--hard", "main");
    write("src/app.ts", "rewritten\n");
    git("commit", "-q", "-am", "Rewritten");
  } else if (commit) {
    write("src/app.ts", "one\nTWO\n");
    git("commit", "-q", "-am", "Address review");
  }
  if (responses) fs.writeFileSync(path.join(reviewDir(), "rev-1-response.json"), typeof responses === "string" ? responses : JSON.stringify(responses));
  sessionEvents.emit("idle", "ses_test1", null);
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "revision-runner-"));
  roots.push(ws);
  repoDir = path.join(ws, REPO);
  workRoot = path.join(ws, ".work");
  fs.mkdirSync(path.join(workRoot, FOLDER), { recursive: true });
  fs.mkdirSync(repoDir);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test User");
  git("config", "commit.gpgsign", "false");
  write("src/app.ts", "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Base");
  git("checkout", "-q", "-b", BRANCH);
  write("src/app.ts", "one\ntwo\n");
  git("commit", "-q", "-am", "Feature");
  headSha = git("rev-parse", "HEAD");

  item = { id: "12", folder: FOLDER, stage: "ship", pr: [{ repo: REPO, branch: BRANCH, target: "main" }] };
  launched = [];
  startFails = null;
  sessionEvents = new EventEmitter();
  api = createCodeReview({ workspace: ws, workRoot, findItem: () => item, runInfo: (f, r) => runner.runData(f, r) });
  runner = createRevisionRunner({
    codeReview: api,
    workspace: ws,
    workRoot,
    sessionEvents,
    delayMs: 0,
    launcher: {
      start: async (args) => {
        if (startFails) throw new Error(startFails);
        launched.push(args);
        return "ses_test1";
      },
    },
  });
});

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe("buildRevisionPrompt", () => {
  test("follows the template, with every comment, quoted code, and the response path", () => {
    const p = buildRevisionPrompt({ workItemId: "12", repo: REPO, branch: BRANCH, responsePath: ".work/12-sample/code-review/sample-repo/rev-1-response.json", feedback: { ...feedback(), comments: [{ ...feedback().comments[0], quotedCode: "a\nb" }, feedback().comments[1]] } });
    assert.match(p, /^You are revising work item 12 on branch dev\/feature\/12-sample in repo folder sample-repo\./);
    assert.match(p, /- Fix all MUST_FIX items\./);
    assert.match(p, /write \.work\/12-sample\/code-review\/sample-repo\/rev-1-response\.json as JSON/);
    assert.match(p, /Reviewer summary:\nA few fixes\./);
    assert.match(p, /\[c1\] MUST_FIX src\/app\.ts lines 2-2 \(new\)\n> a\n> b\nUse a constant\./);
    assert.match(p, /\[c2\] QUESTION src\/app\.ts lines 1-1 \(new\)\n> one\nWhy here\?\nProposed replacement:\nONE/);
  });
  test("says (none) for an empty summary or no comments", () => {
    const p = buildRevisionPrompt({ workItemId: "12", repo: REPO, branch: BRANCH, responsePath: "x", feedback: { summary: "", comments: [] } });
    assert.match(p, /Reviewer summary:\n\(none\)/);
    assert.match(p, /Comments:\n\(none\)/);
  });
});

describe("revision runner", () => {
  test("request changes starts one revision task in opencode", async () => {
    await api.submit("12", REPO, feedback());
    await until(() => launched.length === 1, "launch");
    assert.equal(launched[0].folder, FOLDER);
    assert.match(launched[0].title, /code review revision 1 \(sample-repo\)/);
    assert.match(launched[0].prompt, /\[c1\] MUST_FIX/);
    await until(() => readRun().session === "ses_test1", "run.json");
    assert.equal(readRun().status, "running");
    assert.equal(readRun().branch, BRANCH);
    assert.equal((await api.getSession("12", REPO)).revisionRun.status, "running");
  });

  test("approve does not start anything", async () => {
    await api.submit("12", REPO, { ...feedback(), verdict: "approve", comments: [], summary: undefined });
    await tick();
    assert.equal(launched.length, 0);
  });

  test("when the agent finishes, the item returns to review as revision 2", async () => {
    const ready = new Promise((r) => runner.events.once("revision-ready", r));
    await api.submit("12", REPO, feedback());
    await until(() => launched.length === 1, "launch");
    await until(() => fs.existsSync(path.join(reviewDir(), "run.json")) && readRun().session, "run.json");
    agentFinishes();
    const ev = await ready;
    assert.equal(ev.revision, 2);

    const s = await api.getSession("12", REPO);
    assert.equal(s.revision, 2);
    assert.equal(s.status, "awaiting_review");
    assert.equal(s.previousFeedback.headSha, headSha);
    assert.deepEqual(s.previousResponses, [{ commentId: "c1", status: "fixed", note: "Done." }]);
    assert.deepEqual(s.sinceLastReview.map((f) => f.path), ["src/app.ts"]);
    assert.equal(s.revisionRun.status, "done");
    assert.equal(git("rev-list", "--count", `${headSha}..HEAD`), "1", "the fix is a new commit on top");
  });

  test("a missing response file leaves the review revising and says why", async () => {
    await api.submit("12", REPO, feedback());
    await until(() => readRun().session, "run.json");
    agentFinishes({ responses: null });
    await until(() => readRun().status === "failed", "failure");
    assert.match(readRun().message, /did not write \.work\/12-sample\/code-review\/sample-repo\/rev-1-response\.json/);
    assert.equal(api.readState(FOLDER, REPO).status, "revising");

    // The engineer replies, the agent writes the file, its turn ends: the checks run again.
    fs.writeFileSync(path.join(reviewDir(), "rev-1-response.json"), JSON.stringify([{ commentId: "c1", status: "fixed" }]));
    sessionEvents.emit("idle", "ses_test1", null);
    await until(() => readRun().status === "done", "recovery");
    assert.equal(api.readState(FOLDER, REPO).revision, 2);
  });

  test("an invalid response file is a failure", async () => {
    await api.submit("12", REPO, feedback());
    await until(() => readRun().session, "run.json");
    agentFinishes({ responses: '[{"commentId":"c1","status":"done"}]' });
    await until(() => readRun().status === "failed", "failure");
    assert.match(readRun().message, /not valid/);
  });

  test("rewritten history is a failure", async () => {
    await api.submit("12", REPO, feedback());
    await until(() => readRun().session, "run.json");
    agentFinishes({ rewrite: true });
    await until(() => readRun().status === "failed", "failure");
    assert.match(readRun().message, /history was rewritten/);
    assert.equal(api.readState(FOLDER, REPO).status, "revising");
  });

  test("a launch failure is recorded on the run", async () => {
    startFails = "opencode did not take the reply";
    await api.submit("12", REPO, feedback());
    await until(() => fs.existsSync(path.join(reviewDir(), "run.json")) && readRun().status === "failed", "failure");
    assert.match(readRun().message, /Could not start the revision: opencode did not take the reply/);
  });

  test("idle events from other sessions are ignored", async () => {
    await api.submit("12", REPO, feedback());
    await until(() => readRun().session, "run.json");
    fs.writeFileSync(path.join(reviewDir(), "rev-1-response.json"), "[]");
    sessionEvents.emit("idle", "ses_other", null);
    await tick();
    assert.equal(readRun().status, "running");
  });

  test("load() follows unfinished runs after a restart", async () => {
    await api.submit("12", REPO, feedback());
    await until(() => readRun().session, "run.json");
    const fresh = new EventEmitter();
    const restarted = createRevisionRunner({ codeReview: api, workspace: ws, workRoot, sessionEvents: fresh, delayMs: 0, launcher: { start: async () => "x" } });
    restarted.load();
    write("src/app.ts", "one\nTWO\n");
    git("commit", "-q", "-am", "Address review");
    fs.writeFileSync(path.join(reviewDir(), "rev-1-response.json"), "[]");
    fresh.emit("idle", "ses_test1", null);
    await until(() => api.readState(FOLDER, REPO).revision === 2, "revision 2 after restart");
  });
});

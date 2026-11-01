// Tests for lib/code-review.mjs. Run: node --test "connectors/opencode/test/*.test.mjs"
// Builds a throwaway workspace (one repo plus .work) in the OS temp folder. Needs only git and Node 18+.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createCodeReview, feedbackProblem } from "../lib/code-review.mjs";

const REPO = "sample-repo";
const BRANCH = "dev/feature/12-sample";
const FOLDER = "12-sample";

let ws, repoDir, workRoot, item, api, baseSha, headSha;
const roots = [];

const git = (...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, rel), content);
};

function feedback(over = {}) {
  return {
    workItemId: "12",
    repo: REPO,
    revision: 1,
    headSha,
    verdict: "request_changes",
    summary: "Please tidy this up.",
    comments: [
      { id: "c1", path: "src/app.ts", side: "new", startLine: 2, endLine: 3, quotedCode: "two\nthree", type: "must_fix", body: "Rename this." },
    ],
    submittedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

// Waits for the next event of a name, or fails after a second.
function nextEvent(name) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${name} event`)), 1000);
    api.events.once(name, (e) => {
      clearTimeout(t);
      resolve(e);
    });
  });
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-"));
  roots.push(ws);
  repoDir = path.join(ws, REPO);
  workRoot = path.join(ws, ".work");
  fs.mkdirSync(path.join(workRoot, FOLDER), { recursive: true });
  fs.mkdirSync(repoDir);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test User");
  git("config", "commit.gpgsign", "false");
  write("src/app.ts", "one\ntwo\n");
  write("src/old.ts", "a\nb\nc\nd\ne\nf\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Base");
  baseSha = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", BRANCH);
  write("src/app.ts", "one\ntwo\nthree\n");
  git("mv", "src/old.ts", "src/new.ts");
  write("src/added.ts", "export {};\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Feature");
  headSha = git("rev-parse", "HEAD");

  item = { id: "12", folder: FOLDER, stage: "pr", pr: [{ repo: REPO, branch: BRANCH, target: "main" }] };
  api = createCodeReview({
    workspace: ws,
    workRoot,
    findItem: (wid) => (wid === "12" ? item : null),
    now: () => new Date("2026-11-01T12:00:00.000Z"),
  });
});

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe("GET session", () => {
  test("returns revision 1 awaiting review with the file list", async () => {
    const s = await api.getSession("12", REPO);
    assert.equal(s.workItemId, "12");
    assert.equal(s.repo, REPO);
    assert.equal(s.revision, 1);
    assert.equal(s.status, "awaiting_review");
    assert.equal(s.branch, BRANCH);
    assert.equal(s.baseBranch, "main", "no origin in this clone, so the local target is used");
    assert.equal(s.baseSha, baseSha);
    assert.equal(s.headSha, headSha);
    assert.equal(s.previousFeedback, undefined);
    const paths = s.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["src/added.ts", "src/app.ts", "src/new.ts"]);
    assert.equal(s.files.find((f) => f.path === "src/new.ts").oldPath, "src/old.ts");
  });

  test("prefers origin/<target> when the clone has it", async () => {
    git("update-ref", "refs/remotes/origin/main", baseSha);
    const s = await api.getSession("12", REPO);
    assert.equal(s.baseBranch, "origin/main");
  });

  test("409 with status not_ready before the pr stage", async () => {
    item.stage = "review";
    await assert.rejects(api.getSession("12", REPO), (e) => e.status === 409 && e.code === "conflict" && /not ready for review \(stage: review\)/.test(e.message));
  });

  test("409 when pr.md has no section for the repo", async () => {
    await assert.rejects(api.getSession("12", "other-repo"), (e) => e.status === 409 && /no pr.md section/.test(e.message));
  });

  test("400 for bad ids and repo names, 404 for unknown items", async () => {
    await assert.rejects(api.getSession("12;rm", REPO), (e) => e.status === 400);
    await assert.rejects(api.getSession("12", "../x"), (e) => e.status === 400);
    await assert.rejects(api.getSession("12", null), (e) => e.status === 400);
    await assert.rejects(api.getSession("99", REPO), (e) => e.status === 404);
  });
});

describe("GET file", () => {
  test("old side reads baseSha, new side reads headSha", async () => {
    assert.deepEqual(await api.getFile("12", REPO, "src/app.ts", "old"), { kind: "text", text: "one\ntwo\n" });
    assert.deepEqual(await api.getFile("12", REPO, "src/app.ts", "new"), { kind: "text", text: "one\ntwo\nthree\n" });
  });
  test("renames: the client passes oldPath for the old side", async () => {
    assert.equal((await api.getFile("12", REPO, "src/old.ts", "old")).kind, "text");
    assert.deepEqual(await api.getFile("12", REPO, "src/new.ts", "old"), { kind: "absent" });
  });
  test("absent for the missing side of an added file", async () => {
    assert.deepEqual(await api.getFile("12", REPO, "src/added.ts", "old"), { kind: "absent" });
  });
  test("400 for a bad side or path", async () => {
    await assert.rejects(api.getFile("12", REPO, "src/app.ts", "both"), (e) => e.status === 400);
    await assert.rejects(api.getFile("12", REPO, "../secret", "new"), (e) => e.status === 400);
  });
});

describe("POST submit", () => {
  test("request changes saves rev-1.json and state.json, sets revising, and emits an event", async () => {
    const ev = nextEvent("changes-requested");
    const r = await api.submit("12", REPO, feedback({ extra: "dropped" }));
    assert.deepEqual(r, { ok: true, status: "revising", revision: 1, submittedAt: "2026-11-01T12:00:00.000Z" });

    const dir = path.join(workRoot, FOLDER, "code-review", REPO);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "rev-1.json"), "utf8"));
    assert.equal(saved.extra, undefined, "only contract fields are stored");
    assert.equal(saved.submittedAt, "2026-11-01T12:00:00.000Z", "the server stamps the time");
    assert.equal(saved.comments[0].quotedCode, "two\nthree");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")), { revision: 1, status: "revising", lastReviewedHeadSha: headSha });

    const e = await ev;
    assert.equal(e.folder, FOLDER);
    assert.equal(e.repo, REPO);
    assert.equal(e.branch, BRANCH);
    assert.equal(e.revision, 1);
    assert.equal(e.feedback.comments.length, 1);

    const s = await api.getSession("12", REPO);
    assert.equal(s.status, "revising");
  });

  test("approve records the verdict, sets approved, and never touches the branch", async () => {
    const ev = nextEvent("approved");
    const r = await api.submit("12", REPO, feedback({ verdict: "approve", comments: [], summary: undefined }));
    assert.equal(r.status, "approved");
    assert.equal((await ev).feedback.verdict, "approve");
    assert.equal(git("rev-parse", BRANCH), headSha);
    assert.equal(git("branch", "--show-current"), BRANCH);
  });

  test("409 on a stale head and nothing is saved", async () => {
    write("src/app.ts", "changed by the agent\n");
    git("commit", "-q", "-am", "Agent moved on");
    let fired = false;
    api.events.once("changes-requested", () => (fired = true));
    await assert.rejects(api.submit("12", REPO, feedback()), (e) => e.status === 409 && /changed since this review was loaded/.test(e.message));
    assert.equal(fs.existsSync(path.join(workRoot, FOLDER, "code-review")), false);
    await new Promise((r) => setImmediate(r));
    assert.equal(fired, false);
  });

  test("409 for a second verdict on the same revision", async () => {
    await api.submit("12", REPO, feedback());
    await assert.rejects(api.submit("12", REPO, feedback()), (e) => e.status === 409 && /revising/.test(e.message));
  });

  test("409 for the wrong revision number", async () => {
    await assert.rejects(api.submit("12", REPO, feedback({ revision: 2 })), (e) => e.status === 409 && /This is revision 1, not 2/.test(e.message));
  });

  test("400 when the body does not match the URL", async () => {
    await assert.rejects(api.submit("12", REPO, feedback({ workItemId: "13" })), (e) => e.status === 400);
    await assert.rejects(api.submit("12", REPO, feedback({ repo: "other" })), (e) => e.status === 400);
  });

  test("409 before the pr stage", async () => {
    item.stage = "build";
    await assert.rejects(api.submit("12", REPO, feedback()), (e) => e.status === 409 && /not ready for review/.test(e.message));
  });
});

describe("revision 2", () => {
  test("serves previousFeedback from the last round once the runner moves the state on", async () => {
    await api.submit("12", REPO, feedback());
    // What the revision runner does: commit on the branch, then bump the revision and reopen review.
    write("src/app.ts", "one\ntwo\nTHREE\n");
    git("commit", "-q", "-am", "Address review");
    api.writeState(FOLDER, REPO, { revision: 2, status: "awaiting_review", lastReviewedHeadSha: headSha });
    item.stage = "build"; // a saved review is served whatever stage the item shows

    const s = await api.getSession("12", REPO);
    assert.equal(s.revision, 2);
    assert.equal(s.status, "awaiting_review");
    assert.equal(s.previousFeedback.revision, 1);
    assert.equal(s.previousFeedback.headSha, headSha);
    assert.notEqual(s.headSha, headSha);
  });
});

describe("feedbackProblem", () => {
  test("accepts a valid body", () => {
    headSha = "a".repeat(40);
    assert.equal(feedbackProblem(feedback()), null);
  });
  test("rejects request changes with no comments and no summary", () => {
    headSha = "a".repeat(40);
    assert.match(feedbackProblem(feedback({ comments: [], summary: "  " })), /at least one comment/);
    assert.equal(feedbackProblem(feedback({ verdict: "approve", comments: [], summary: undefined })), null);
  });
  test("rejects bad comments", () => {
    headSha = "a".repeat(40);
    const c = feedback().comments[0];
    const bad = [
      { ...c, side: "both" },
      { ...c, startLine: 5, endLine: 2 },
      { ...c, startLine: 0 },
      { ...c, type: "nit" },
      { ...c, path: "../x" },
      { ...c, id: "" },
    ];
    for (const b of bad) assert.notEqual(feedbackProblem(feedback({ comments: [b] })), null, JSON.stringify(b));
    assert.match(feedbackProblem(feedback({ comments: [c, c] })), /repeats id/);
  });
});

describe("revision 2 extras", () => {
  async function toRevision2() {
    await api.submit("12", REPO, feedback());
    write("src/app.ts", "one\ntwo\nTHREE\n");
    write("src/later.ts", "export const later = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "Address review");
    api.writeState(FOLDER, REPO, { revision: 2, status: "awaiting_review", lastReviewedHeadSha: headSha });
  }

  test("sinceLastReview lists only the agent's new changes", async () => {
    await toRevision2();
    const s = await api.getSession("12", REPO);
    assert.deepEqual(s.sinceLastReview.map((f) => f.path).sort(), ["src/app.ts", "src/later.ts"]);
    assert.equal(s.files.length, 4, "the full view still covers base to head");
  });

  test("previousResponses comes from the agent's response file when it is valid", async () => {
    await toRevision2();
    const dir = path.join(workRoot, FOLDER, "code-review", REPO);
    fs.writeFileSync(path.join(dir, "rev-1-response.json"), JSON.stringify([{ commentId: "c1", status: "fixed", note: "Renamed." }]));
    assert.deepEqual((await api.getSession("12", REPO)).previousResponses, [{ commentId: "c1", status: "fixed", note: "Renamed." }]);
    fs.writeFileSync(path.join(dir, "rev-1-response.json"), "not json");
    assert.equal((await api.getSession("12", REPO)).previousResponses, undefined);
  });

  test("side=prev reads the last reviewed head", async () => {
    await toRevision2();
    assert.deepEqual(await api.getFile("12", REPO, "src/app.ts", "prev"), { kind: "text", text: "one\ntwo\nthree\n" });
    assert.deepEqual(await api.getFile("12", REPO, "src/later.ts", "prev"), { kind: "absent" });
  });

  test("side=prev is refused on revision 1", async () => {
    await assert.rejects(api.getFile("12", REPO, "src/app.ts", "prev"), (e) => e.status === 400);
  });

  test("request changes is refused before saving when a revision cannot start", async () => {
    const blocked = createCodeReview({ workspace: ws, workRoot, findItem: () => item, canRevise: () => "opencode is not connected." });
    await assert.rejects(blocked.submit("12", REPO, feedback()), (e) => e.status === 503 && e.code === "unavailable" && /opencode is not connected/.test(e.message));
    assert.equal(fs.existsSync(path.join(workRoot, FOLDER, "code-review")), false);
    const ok = await blocked.submit("12", REPO, feedback({ verdict: "approve", comments: [], summary: undefined }));
    assert.equal(ok.status, "approved", "approve does not need the agent");
  });
});

describe("parseResponses", () => {
  test("accepts the template shape and rejects the rest", async () => {
    const { parseResponses } = await import("../lib/code-review.mjs");
    assert.deepEqual(parseResponses('[{"commentId":"c1","status":"answered"}]').list, [{ commentId: "c1", status: "answered", note: "" }]);
    for (const bad of ["{}", "[{}]", '[{"commentId":"c1","status":"done"}]', "nope"]) assert.ok(parseResponses(bad).problem, bad);
  });
});

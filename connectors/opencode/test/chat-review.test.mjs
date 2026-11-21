// Chat 4.2.0 (connector 1.30.0): Review code on a chat's changes, with a stand-in opencode API and real git in a
// temp folder. Synthetic data only.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetChats, startChat } from "../lib/chat.mjs";
import { chatChanges } from "../lib/chat-more.mjs";
import { MAX_FINDINGS, REVIEW_TIMEOUT, chatReview, chatReviewState, parseReview, resetReviews, reviewPrompt } from "../lib/chat-review.mjs";
import { oc, sessions } from "../lib/opencode-state.mjs";
import { configure } from "../lib/context.mjs";

const noGit = (() => { try { execFileSync("git", ["--version"]); return false; } catch { return true; } })();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-chat-review-"));
const ws = path.join(dir, "ws");
fs.mkdirSync(ws);
const file = path.join(dir, "chats.json");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
configure({ config: { workspace: ws }, env: () => undefined, log: { info() {}, warn() {} } });
const on = {};
let rich, made, sent, deleted, answer, fail;
beforeEach(() => {
  try { fs.rmSync(file); } catch { /* none */ }
  resetChats(file, path.join(dir, "hub"));
  resetReviews();
  sessions.clear();
  rich = {}; made = 0; sent = []; deleted = []; answer = "SUMMARY | No findings."; fail = null;
  oc.connected = true;
  oc.kind = "v1";
  oc.agents = new Set(["build", "plan", "chat"]);
  oc.api = {
    async createSession(title) { made++; return { id: `ses_${made}`, title }; },
    async prompt() {},
    async promptRich() {},
    async messages() { return []; },
    async richMessages(id) { return rich[id] || []; },
    async promptWait(id, o) { sent.push({ id, ...o }); if (fail) throw fail; return answer; },
    async deleteSession(id) { deleted.push(id); return true; },
  };
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.status === code && (!re || re.test(e.message)));

test("parseReview: findings at their files and lines, worst first, whole-file and unknown paths kept, summary read", () => {
  const text = [
    "Here is what I found:",
    "NIT | `src/util.js:3` | Name this better.",
    "- BLOCKER | api/src/auth.cs:42 | The token is logged in plain text. Drop the log line.",
    "1. Should fix | ./src/util.js:0 | No test covers the empty list.",
    "SHOULD-FIX | elsewhere.md:9 | Mention the new flag.",
    "**BLOCKER** | auth.cs:7 | Null check is missing.",
    "MAYBE | src/util.js:1 | not a severity",
    "SUMMARY | Two blockers in auth; the rest is small.",
  ].join("\n");
  const r = parseReview(text, ["api/src/auth.cs", "src/util.js"]);
  assert.equal(r.summary, "Two blockers in auth; the rest is small.");
  assert.deepEqual(r.findings.map((f) => [f.severity, f.path, f.line, f.known]), [
    ["blocker", "api/src/auth.cs", 42, true],
    ["blocker", "api/src/auth.cs", 7, true],
    ["should-fix", "src/util.js", null, true],
    ["should-fix", "elsewhere.md", 9, false],
    ["nit", "src/util.js", 3, true],
  ]);
  assert.deepEqual(parseReview("SUMMARY | No findings.").findings, []);
  const many = Array.from({ length: 30 }, (_, i) => `NIT | a.js:${i + 1} | n${i}`).join("\n");
  assert.equal(parseReview(many, ["a.js"]).findings.length, MAX_FINDINGS);
});

test("reviewPrompt: read only, the reply format, every file's diff; cut and binary files say so", () => {
  const p = reviewPrompt([
    { path: "a.js", status: "modified", additions: 1, deletions: 1, diff: "@@ -1 +1 @@\n-x\n+y" },
    { path: "big.js", status: "added", additions: 9000, deletions: 0, diff: "", cut: true },
    { path: "img.png", status: "binary", additions: 0, deletions: 0, diff: "" },
  ]);
  assert.match(p, /Do not change, create or delete any file/);
  assert.match(p, /BLOCKER \| path\/to\/file\.ext:42 \|/);
  assert.match(p, /--- a\.js \(modified, \+1 -1\)\n@@ -1 \+1 @@\n-x\n\+y/);
  assert.match(p, /--- big\.js .*\n\(too big to show here/);
  assert.match(p, /--- img\.png .*\n\(no text diff\)/);
});

test("chat.review: reviews what the chat changed in a scratch session (deleted), read only, findings and a key; stale key after an edit", { skip: noGit }, async () => {
  const repo = path.join(ws, "gateway");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Engineer A"); g("config", "user.email", "a@example.test");
  fs.writeFileSync(path.join(repo, "src", "headers.cs"), "line 1\nline 2\nline 3\n");
  g("add", "."); g("commit", "-q", "-m", "start");
  await startChat({ text: "fix headers" }, { config: on });
  rich.ses_1 = [{ role: "assistant", parts: [{ type: "tool", tool: "edit", status: "completed", input: "gateway/src/headers.cs" }] }];

  await rejects(chatReview({ session: "ses_1" }, { wait: true }), 409, /no uncommitted changes/);
  assert.deepEqual(chatReviewState({ session: "ses_1" }), { status: "none" });

  fs.writeFileSync(path.join(repo, "src", "headers.cs"), "line 1\nline two\nline 3\n");
  answer = "SHOULD FIX | src/headers.cs:2 | Keep the old wording.\nSUMMARY | One small thing.";
  const r = await chatReview({ session: "ses_1", model: "prov/model-a" }, { wait: true });
  assert.equal(r.status, "done");
  assert.deepEqual(r.files, ["gateway/src/headers.cs"]);
  assert.equal(r.agent, "chat", "Tandem's read-only chat agent");
  assert.deepEqual(r.findings.map((f) => [f.severity, f.path, f.line, f.text]), [["should-fix", "gateway/src/headers.cs", 2, "Keep the old wording."]]);
  assert.equal(r.summary, "One small thing.");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, "ses_2", "a scratch session, not the chat");
  assert.deepEqual(sent[0].model, { provider: "prov", id: "model-a" });
  assert.equal(sent[0].timeout, REVIEW_TIMEOUT);
  assert.match(sent[0].text, /\+line two/);
  assert.deepEqual(deleted, ["ses_2"]);
  const now = await chatChanges({ session: "ses_1" });
  assert.equal(now.key, r.key, "same changes, same key");
  assert.deepEqual(chatReviewState({ session: "ses_1" }).findings, r.findings);
  fs.writeFileSync(path.join(repo, "src", "headers.cs"), "line 1\nline 2b\nline 3\n");
  assert.notEqual((await chatChanges({ session: "ses_1" })).key, r.key, "edited since: the review is stale");

  oc.agents = new Set(["build", "plan"]);
  fail = new Error("opencode did not answer (timeout).");
  const bad = await chatReview({ session: "ses_1" }, { wait: true });
  assert.deepEqual([bad.status, bad.error, bad.agent], ["failed", "opencode did not answer (timeout).", "plan"]);
  assert.equal(deleted.length, 2, "deleted when it fails too");
});

test("chat.review: one at a time per chat, a bad model is refused, opencode must be connected and able", { skip: noGit }, async () => {
  const repo = path.join(ws, "solo");
  fs.mkdirSync(repo, { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "new\n");
  await startChat({ text: "add a" }, { config: on });
  rich.ses_1 = [{ role: "assistant", parts: [{ type: "tool", tool: "write", status: "completed", input: "solo/a.txt" }] }];
  let release;
  oc.api.promptWait = (id, o) => { sent.push({ id, ...o }); return new Promise((res) => { release = res; }); };
  const first = await chatReview({ session: "ses_1" });
  assert.equal(first.status, "running");
  await rejects(chatReview({ session: "ses_1" }), 409, /already running/);
  release("SUMMARY | No findings.");
  await new Promise((r) => setTimeout(r, 10));
  const st = chatReviewState({ session: "ses_1" });
  assert.deepEqual([st.status, st.findings, st.summary], ["done", [], "No findings."]);
  await rejects(chatReview({ session: "ses_1", model: "no slash" }), 400, /Bad model/);
  delete oc.api.promptWait;
  await rejects(chatReview({ session: "ses_1" }), 400, /cannot review/);
  oc.connected = false;
  await rejects(chatReview({ session: "ses_1" }), 503);
});

// Chat 4.1.0 (connector 1.29.0): archive, search in messages, PDF attachments, the Changes view and the suggested
// next prompt, with a stand-in opencode API and real git in temp folders. Synthetic data only.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveChat, listChats, resetChats, resetSearch, searchChats, sendChat, startChat } from "../lib/chat.mjs";
import { MAX_PIECE, attachPiece, readAttachments, resetAttachments } from "../lib/chat-attach.mjs";
import { chatChanges, chatSuggest, cleanSuggestion, editedPaths, fileChange, resetSuggest, suggestPrompt } from "../lib/chat-more.mjs";
import { oc, permissions, questions, sessions, upsertSession } from "../lib/opencode-state.mjs";
import { configure } from "../lib/context.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-chat-more-"));
const ws = path.join(dir, "ws");
fs.mkdirSync(ws);
const file = path.join(dir, "chats.json");
const attach = path.join(dir, "attachments");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
configure({ config: { workspace: ws }, env: () => undefined, log: { info() {}, warn() {} } });
const on = {};
let turns, rich, made, sent, deleted, answers;
beforeEach(() => {
  try { fs.rmSync(file); } catch { /* none */ }
  resetChats(file, path.join(dir, "hub"));
  resetSearch(); resetSuggest(); resetAttachments(attach);
  sessions.clear(); permissions.clear(); questions.clear();
  turns = {}; rich = {}; made = 0; sent = []; deleted = []; answers = [];
  oc.connected = true;
  oc.kind = "v1";
  oc.agents = new Set(["build", "plan", "chat"]);
  oc.api = {
    async createSession(title) { made++; return { id: `ses_${made}`, title }; },
    async prompt() {},
    async promptRich(id, o) { sent.push({ id, ...o }); },
    async messages(id) { return turns[id] || []; },
    async richMessages(id) { return rich[id] || []; },
    async promptWait(id, o) { sent.push({ id, ...o }); return answers.shift() ?? "NONE"; },
    async deleteSession(id) { deleted.push(id); return true; },
  };
});
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));

test("archive: out of the list with its thread kept, its own list, back on its next message", async () => {
  await startChat({ text: "first" }, { config: on, now: 10 });
  await startChat({ text: "second" }, { config: on, now: 20 });
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.title), ["second", "first"]);
  assert.deepEqual(archiveChat({ session: "ses_1" }, { config: on, now: 30 }), { ok: true, archived: true });
  const l = listChats({ config: on });
  assert.deepEqual([l.items.map((c) => c.title), l.archived], [["second"], 1]);
  assert.deepEqual(listChats({ config: on, archived: true }).items.map((c) => [c.title, c.archived]), [["first", 30]]);
  upsertSession("ses_1", { status: "idle" });
  await sendChat({ session: "ses_1", text: "again" }, { config: on, now: 40 });
  assert.deepEqual(listChats({ config: on }).items.map((c) => c.title), ["first", "second"], "a message brings it back");
  archiveChat({ session: "ses_2" }, { config: on, now: 50 });
  archiveChat({ session: "ses_2", archived: false }, { config: on, now: 60 });
  assert.equal(listChats({ config: on }).archived, 0);
});

test("search finds words in messages as well as titles, archived chats too, and reads a chat again only after new activity", async () => {
  await startChat({ text: "Header limits" }, { config: on, now: 10 });
  await startChat({ text: "Login timeout" }, { config: on, now: 20 });
  turns.ses_1 = [{ role: "user", text: "Why are the rate limit headers missing?" }, { role: "assistant", text: "The middleware runs after the response is written, so X-RateLimit-Remaining never makes it out." }];
  turns.ses_2 = [{ role: "user", text: "Fix the login timeout" }, { role: "assistant", text: "Raised the session timeout to 30 minutes." }];
  archiveChat({ session: "ses_2" }, { config: on, now: 30 });
  let calls = 0;
  const messages = oc.api.messages;
  oc.api.messages = async (id, n) => { calls++; return messages(id, n); };
  let r = await searchChats({ query: "RateLimit-Remaining" }, { config: on });
  assert.deepEqual(r.items.map((c) => c.session), ["ses_1"]);
  assert.match(r.items[0].snippet, /^\.\.\..*so X-RateLimit-Remaining never makes it out\.$/);
  r = await searchChats({ query: "TIMEOUT" }, { config: on });
  assert.deepEqual(r.items.map((c) => [c.session, !!c.archived]), [["ses_2", true]]);
  assert.equal(calls, 2, "each chat read once");
  await searchChats({ query: "minutes" }, { config: on });
  assert.equal(calls, 2, "nothing new: no reads");
  await rejects(searchChats({ query: "x" }, { config: on }), "bad_request", /two letters/);
});

test("PDFs: attached in pieces, checked, sent as a file part with the message, then deleted; not a PDF is refused", async () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(900000, 65)]);
  const b64 = pdf.toString("base64");
  const pieces = [];
  for (let i = 0; i < b64.length; i += 600000) pieces.push(b64.slice(i, i + 600000));
  assert.ok(pieces[0].length <= MAX_PIECE && pieces.length === 3);
  const first = attachPiece({ name: "spec v2.pdf", mime: "application/pdf", data: pieces[0] });
  assert.match(first.id, /^a[0-9a-f]{24}$/);
  let done = null;
  for (const p of pieces.slice(1)) done = attachPiece({ id: first.id, data: p });
  assert.equal(done.bytes, pdf.length);
  await startChat({ text: "Summarize the spec", attachments: [{ id: first.id }] }, { config: on });
  assert.equal(sent[0].images.length, 1);
  assert.deepEqual([sent[0].images[0].mime, sent[0].images[0].name, sent[0].images[0].data === b64], ["application/pdf", "spec v2.pdf", true]);
  assert.deepEqual(fs.readdirSync(attach), [], "deleted once sent");
  assert.throws(() => attachPiece({ name: "a.pdf", mime: "application/pdf", data: Buffer.from("hello world!").toString("base64") }), /not a PDF/);
  assert.throws(() => attachPiece({ name: "a.doc", mime: "application/msword", data: "AAAA" }), /attaches PDFs/);
  assert.throws(() => readAttachments([{ id: "a" + "0".repeat(24) }]), /gone/);
  oc.kind = "v2";
  const again = attachPiece({ name: "x.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 x").toString("base64") });
  await assert.rejects(startChat({ text: "hi", attachments: [{ id: again.id }] }, { config: on }), /cannot take pasted images or PDFs/);
});

test("Changes: the files a chat edited, each diffed against the last commit; new and outside-git files are all added", { skip: (() => { try { execFileSync("git", ["--version"]); return false; } catch { return true; } })() }, async () => {
  const repo = path.join(ws, "gateway");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Engineer A"); g("config", "user.email", "a@example.test");
  fs.writeFileSync(path.join(repo, "src", "headers.cs"), "line 1\nline 2\nline 3\n");
  g("add", "."); g("commit", "-q", "-m", "start");
  fs.writeFileSync(path.join(repo, "src", "headers.cs"), "line 1\nline two\nline 3\n");
  fs.writeFileSync(path.join(repo, "src", "new.cs"), "a\nb\n");
  fs.writeFileSync(path.join(ws, "notes.md"), "outside git\n");
  await startChat({ text: "fix headers" }, { config: on });
  rich.ses_1 = [{ role: "assistant", parts: [
    { type: "tool", tool: "edit", status: "completed", input: "gateway/src/headers.cs" },
    { type: "tool", tool: "write", status: "completed", input: "gateway/src/new.cs" },
    { type: "tool", tool: "read", status: "completed", input: "gateway/src/other.cs" },
    { type: "tool", tool: "edit", status: "error", input: "gateway/src/failed.cs" },
    { type: "patch", files: ["notes.md", "gateway/src/headers.cs"] },
  ] }];
  assert.deepEqual(editedPaths(rich.ses_1), ["gateway/src/headers.cs", "gateway/src/new.cs", "notes.md"]);
  const r = await chatChanges({ session: "ses_1" });
  const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
  assert.deepEqual([by["gateway/src/headers.cs"].repo, by["gateway/src/headers.cs"].status, by["gateway/src/headers.cs"].additions, by["gateway/src/headers.cs"].deletions], ["gateway", "modified", 1, 1]);
  assert.match(by["gateway/src/headers.cs"].diff, /^@@ -1,3 \+1,3 @@\n line 1\n-line 2\n\+line two\n line 3$/);
  assert.deepEqual([by["gateway/src/new.cs"].status, by["gateway/src/new.cs"].diff], ["added", "@@ -0,0 +1,2 @@\n+a\n+b"]);
  assert.deepEqual([by["notes.md"].repo, by["notes.md"].status, by["notes.md"].additions], [null, "added", 1]);
  // A workspace reached through a link (macOS temp folders are; Windows short names act alike): git names the real path.
  const link = path.join(dir, "ws-link");
  try { fs.symlinkSync(ws, link, "dir"); } catch { /* no links here */ }
  if (fs.existsSync(link)) {
    const viaLink = await fileChange(link, "gateway/src/headers.cs");
    assert.deepEqual([viaLink.repo, viaLink.status, viaLink.additions], ["gateway", "modified", 1]);
  }
  g("commit", "-q", "-am", "commit it");
  assert.equal((await chatChanges({ session: "ses_1" })).files.find((f) => f.path === "gateway/src/headers.cs").status, "clean");
});

test("suggested prompt: from the last exchange only, in a scratch session that is deleted; cached per answer; off in Settings", async () => {
  await startChat({ text: "add headers" }, { config: on });
  turns.ses_1 = [{ role: "user", text: "Add the rate limit headers" }, { role: "assistant", text: "Added X-RateLimit-Limit and X-RateLimit-Remaining. Tests pass." }];
  answers.push('"Commit it and open the PR"');
  let r = await chatSuggest({ session: "ses_1" }, { config: on });
  assert.equal(r.text, "Commit it and open the PR");
  const ask = sent.find((s) => s.id === "ses_2");
  assert.equal(ask.agent, "chat", "Tandem's read-only agent");
  assert.match(ask.text, /Developer: Add the rate limit headers\n\nAgent: Added X-RateLimit-Limit/);
  assert.deepEqual(deleted, ["ses_2"]);
  r = await chatSuggest({ session: "ses_1" }, { config: on });
  assert.equal(r.text, "Commit it and open the PR");
  assert.equal(made, 2, "the same answer: no second request");
  assert.deepEqual(await chatSuggest({ session: "ses_1" }, { config: { suggestPrompts: false } }), { text: null, off: true });
  assert.equal(cleanSuggestion("NONE"), null);
  assert.equal(cleanSuggestion("Developer: run the tests\nextra"), "run the tests");
  assert.ok(suggestPrompt("x".repeat(5000), "y").length < 2200, "cut short");
});

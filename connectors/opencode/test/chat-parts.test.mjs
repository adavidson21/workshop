// Tests for lib/chat-parts.mjs (one turn shape from both opencode APIs) and the 1.x adapter's Chat calls against
// the fake opencode. Synthetic data only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUT_MAX, cut, relPath, toolSubject, v1Turn, v2Turn } from "../lib/chat-parts.mjs";
import { configure } from "../lib/context.mjs";
import { makeV1 } from "../lib/opencode-v1.mjs";
import { startFakeOpencode } from "./fake-opencode.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-parts-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("cut keeps the start and the end; relPath shows workspace files relative to it", () => {
  assert.equal(cut("short"), "short");
  const long = "a".repeat(OUT_MAX) + "END";
  const c = cut(long);
  assert.ok(c.length < long.length + 100 && c.endsWith("END") && c.includes("characters cut"));
  assert.equal(relPath("/w/space/src/a.cs", "/w/space"), "src/a.cs");
  assert.equal(relPath("C:\\Repos\\App\\x.cs", "c:\\repos"), "App/x.cs");
  assert.equal(relPath("/elsewhere/a", "/w/space"), "/elsewhere/a");
  assert.equal(toolSubject("bash", { command: "dotnet test" }), "dotnet test");
  assert.equal(toolSubject("grep", { pattern: "TODO", include: "*.cs" }), "TODO  (*.cs)");
});

test("a 1.x message: text, reasoning, tools with diffs and todos, files; synthetic text left out", () => {
  const t = v1Turn({
    info: { id: "msg_1", role: "assistant", agent: "build", providerID: "anthropic", modelID: "m1", time: { created: 1, completed: 2 }, tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } }, cost: 0.02 },
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Thinking it over" },
      { type: "text", text: "Hidden", synthetic: true },
      { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/w/src/a.cs", oldString: "x", newString: "y" }, title: "src/a.cs", metadata: { diff: "--- a\n+++ b\n-x\n+y" }, output: "" } },
      { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos: [{ content: "Write tests", status: "in_progress" }] } } },
      { type: "tool", tool: "task", state: { status: "running", input: { subagent_type: "general", description: "Find usages" }, metadata: { sessionId: "ses_kid" } } },
      { type: "tool", tool: "bash", state: { status: "error", input: { command: "make" }, error: "exit 2" } },
      { type: "text", text: "Done." },
      { type: "patch", files: ["/w/src/a.cs"] },
    ],
  }, "/w");
  assert.equal(t.text, "Done.");
  assert.deepEqual(t.model, { provider: "anthropic", id: "m1" });
  assert.deepEqual(t.tokens, { input: 10, output: 5, reasoning: 1, cacheRead: 2, cacheWrite: 0 });
  assert.deepEqual(t.parts.map((p) => p.type + (p.tool ? ":" + p.tool : "")), ["reasoning", "tool:edit", "tool:todowrite", "tool:task", "tool:bash", "text", "patch"]);
  const [, edit, todo, task, bash] = t.parts;
  assert.equal(edit.input, "src/a.cs");
  assert.match(edit.diff, /\+y/);
  assert.deepEqual(todo.todos, [{ content: "Write tests", status: "in_progress" }]);
  assert.equal(task.child, "ses_kid");
  assert.equal(task.input, "general: Find usages");
  assert.equal(bash.status, "error");
  assert.equal(bash.error, "exit 2");
  assert.deepEqual(t.parts[6].files, ["src/a.cs"]);
  const u = v1Turn({ info: { id: "msg_0", role: "user", agent: "plan", model: { providerID: "p", modelID: "m" }, error: { name: "MessageAbortedError" } }, parts: [{ type: "text", text: "hi" }, { type: "file", filename: "a.cs", source: { path: "/w/src/a.cs" } }] }, "/w");
  assert.equal(u.role, "user");
  assert.equal(u.agent, "plan");
  assert.equal(u.tokens, null);
  assert.equal(u.error, "Stopped.");
  assert.deepEqual(u.parts[1], { type: "file", name: "src/a.cs" });
});

test("a 2.x message is read loosely: text, tools and unknown content", () => {
  const t = v2Turn({ id: "m2", type: "assistant", content: [{ type: "text", text: "Hi" }, { type: "tool", name: "read", input: { filePath: "/w/b.cs" }, status: "done" }, { type: "mystery" }] }, "/w");
  assert.equal(t.text, "Hi");
  assert.deepEqual(t.parts.map((p) => p.type), ["text", "tool"]);
  assert.equal(t.parts[1].status, "completed");
  assert.equal(t.parts[1].input, "b.cs");
});

test("the 1.x adapter sends the agent, model, files, commands, shell, undo and compact the way opencode reads them", async () => {
  configure({ config: { workspace: root }, env: () => undefined, log: { info() {}, warn() {} } });
  const fake = await startFakeOpencode({ kind: "v1" });
  try {
    fake.state.agents = true;
    const api = makeV1(fake.url);
    const file = path.join(root, "src", "a.cs");
    await api.promptRich("ses_1", { text: "fix", agent: "build", model: { provider: "anthropic", id: "m1" }, files: [file] });
    const body = (route) => fake.bodiesFor(route).pop();
    const sent = body("POST /session/ses_1/prompt_async");
    assert.equal(sent.agent, "build");
    assert.deepEqual(sent.model, { providerID: "anthropic", modelID: "m1" });
    assert.equal(sent.parts[1].type, "file");
    assert.match(sent.parts[1].url, /^file:\/\/\/.+\/src\/a\.cs$/);
    await api.commandRich("ses_1", { name: "spike", args: "auth", model: { provider: "p", id: "m" } });
    assert.deepEqual(body("POST /session/ses_1/command"), { command: "spike", arguments: "auth", model: "p/m" });
    await api.shell("ses_1", { command: "ls" });
    assert.deepEqual(body("POST /session/ses_1/shell"), { command: "ls", agent: "build" });
    await api.revert("ses_1", "msg_9");
    assert.deepEqual(body("POST /session/ses_1/revert"), { messageID: "msg_9" });
    await api.unrevert("ses_1");
    await api.summarize("ses_1", { provider: "p", id: "m" });
    assert.deepEqual(body("POST /session/ses_1/summarize"), { providerID: "p", modelID: "m" });
    assert.deepEqual(await api.findFiles("app"), ["src/app.cs"]);
    assert.deepEqual((await api.agentList()).map((a) => [a.name, a.mode]), [["build", "primary"], ["general", "subagent"]]);
    const models = await api.modelList();
    assert.deepEqual(models.models, [], "the fake lists providers without models");
    assert.equal((await api.richMessages("ses_1"))[0].text, "Last reply in ses_1");
  } finally {
    await fake.close();
  }
});

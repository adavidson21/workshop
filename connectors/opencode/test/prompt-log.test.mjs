// lib/prompt-log.mjs: the permission prompt log (connector 1.42.0) and the summary Builds' Health > Tandem shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_BYTES, PROMPT_FILE, logAnswer, logPrompt, promptKey, promptSummary, resetPromptLog } from "../lib/prompt-log.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "prompt-log-"));
const bash = (id, cmd, always = [cmd.split(" ")[0] + " *"]) => ({ id, sessionID: "s1", permission: "bash", patterns: [cmd], always, title: cmd });

test("the key is opencode's always pattern, then the first pattern, then the title", () => {
  assert.equal(promptKey(bash("a", "rm -rf out")), "rm *");
  assert.equal(promptKey({ patterns: ["src/x.cs"], always: [] }), "src/x.cs");
  assert.equal(promptKey({ title: "Edit AGENTS.md" }), "Edit AGENTS.md");
});

test("a prompt is logged once however often it is seen, and an answer once", () => {
  resetPromptLog();
  const dir = tmp();
  assert.equal(logPrompt(dir, bash("p1", "git reset HEAD x"), { command: "do-task" }), true);
  assert.equal(logPrompt(dir, bash("p1", "git reset HEAD x")), false, "a refresh sets it again");
  assert.equal(logAnswer(dir, "p1", "once"), true);
  assert.equal(logAnswer(dir, "p1", "once", "opencode"), false);
  assert.equal(logAnswer(dir, "p2", "maybe"), false, "not an answer");
  const lines = fs.readFileSync(path.join(dir, PROMPT_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.kind), ["asked", "answered"]);
  assert.equal(lines[0].key, "git *");
  assert.equal(lines[0].command, "do-task");
  assert.equal(logPrompt(null, bash("p9", "ls")), true, "no folder yet: nothing written, nothing thrown");
});

test("the summary groups by pattern, counts answers and suggests only safe, always-allowed shell patterns", () => {
  resetPromptLog();
  const dir = tmp();
  const t = new Date("2026-11-20T10:00:00Z");
  for (let i = 0; i < 4; i++) { logPrompt(dir, bash(`rm${i}`, `Remove-Item tmp${i}`), null, t); logAnswer(dir, `rm${i}`, i ? "once" : "always"); }
  for (let i = 0; i < 3; i++) { logPrompt(dir, bash(`k${i}`, `Stop-Process -Id ${i}`), null, t); if (i < 2) logAnswer(dir, `k${i}`, "once"); }
  for (let i = 0; i < 3; i++) { logPrompt(dir, bash(`r${i}`, "git reset --hard"), null, t); logAnswer(dir, `r${i}`, i === 2 ? "reject" : "once"); }
  for (let i = 0; i < 5; i++) { logPrompt(dir, bash(`push${i}`, "git push origin x", ["git push *"]), null, t); logAnswer(dir, `push${i}`, "once"); }
  logPrompt(dir, { id: "e1", permission: "edit", patterns: ["repo/AGENTS.md"], always: [] }, null, t);
  const s = promptSummary(dir);
  assert.equal(s.total, 16);
  assert.equal(s.groups[0].key, "git push *");
  const rm = s.groups.find((g) => g.key === "Remove-Item *");
  assert.deepEqual([rm.asked, rm.once, rm.always, rm.reject, rm.unknown], [4, 3, 1, 0, 0]);
  const kill = s.groups.find((g) => g.key === "Stop-Process *");
  assert.equal(kill.unknown, 1, "answered in opencode's window without saying how");
  assert.deepEqual(s.suggest.map((x) => x.key).sort(), ["Remove-Item *", "Stop-Process *"], "no push, nothing rejected, no edits");
  assert.equal(promptSummary(dir, { since: "2026-11-21" }).total, 0);
  assert.deepEqual(promptSummary(tmp()), { total: 0, groups: [], suggest: [] });
});

test("the log is trimmed to its newest half past the cap", () => {
  resetPromptLog();
  const dir = tmp();
  const big = "x".repeat(250);
  for (let i = 0; fs.existsSync(path.join(dir, PROMPT_FILE)) ? fs.statSync(path.join(dir, PROMPT_FILE)).size < MAX_BYTES * 0.9 : true; i++) logPrompt(dir, bash(`b${i}`, `echo ${big}${i}`));
  for (let i = 0; i < 400; i++) logPrompt(dir, bash(`c${i}`, `echo ${big}c${i}`));
  const size = fs.statSync(path.join(dir, PROMPT_FILE)).size;
  assert.ok(size <= MAX_BYTES, `trimmed (${size})`);
  assert.match(fs.readFileSync(path.join(dir, PROMPT_FILE), "utf8"), /"id":"c399"/);
});

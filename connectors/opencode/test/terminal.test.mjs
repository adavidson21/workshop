// Open in terminal (Windows): the PowerShell command is built from quoted parts, and "Agent not found" errors
// say that opencode needs a restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalCommand } from "../lib/actions.mjs";
import { commandError } from "../lib/context.mjs";

test("terminalCommand quotes each part for PowerShell", () => {
  assert.equal(terminalCommand("opencode", ["--session", "ses_abc"]), "& 'opencode' '--session' 'ses_abc'");
  assert.equal(terminalCommand("C:\\Program Files\\o'c\\opencode.cmd", []), "& 'C:\\Program Files\\o''c\\opencode.cmd'");
});

test("commandError explains Agent not found, and leaves other errors as they are", () => {
  assert.match(commandError("pr-review", "Agent not found: pr-reviewer"), /^\/pr-review failed: Agent not found: pr-reviewer\. opencode was probably started before/);
  assert.equal(commandError("start", "boom"), "/start failed: boom");
});

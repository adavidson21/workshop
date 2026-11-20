// lib/preview.mjs (1.28.0): the command Try it hands opencode. Run: node --test "connectors/opencode/test/*.test.mjs"
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { IDLE_MS, scriptCommand, uiScripts } from "../lib/preview.mjs";

test("Try it runs Tandem's installed script with quoted paths", () => {
  assert.equal(uiScripts("/home/me"), path.join("/home/me", ".config", "opencode", "eng-agents", "scripts", "ui"));
  const cmd = scriptCommand("Start-UiApp.ps1", { WorkFolder: "/ws/.work/L1-a", Repo: "/ws/my repo", Guide: '/ws/my repo/AGENTS.md"' }, { home: "/home/me", exe: "pwsh" });
  assert.equal(cmd, `pwsh -NoProfile -ExecutionPolicy Bypass -File "${path.join("/home/me", ".config", "opencode", "eng-agents", "scripts", "ui", "Start-UiApp.ps1")}" -WorkFolder "/ws/.work/L1-a" -Repo "/ws/my repo" -Guide "/ws/my repo/AGENTS.md"`);
  assert.equal(IDLE_MS, 30 * 60 * 1000);
});

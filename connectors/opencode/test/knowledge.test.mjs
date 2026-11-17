// lib/knowledge.mjs: the knowledge base's workspace side (docs/knowledge.md). Synthetic workspace only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configure } from "../lib/context.mjs";
import { KEPT_FILE, MARKER, draftArgs, guideFacts, knowledgeRepos, readMap, writeMap } from "../lib/knowledge.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-know-"));
const repo = (rel, guide) => {
  const dir = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (guide) fs.writeFileSync(path.join(dir, guide.file), guide.text);
};
repo("shared-lib", { file: "AGENTS.md", text: "# shared-lib\n\nStack: dotnet\n\n## Purpose\n\nDomain models used by several products. More text.\n\n## Remembered\n\n- Run the tests with --no-build. (2026-11-01, PR 9)\n- Never edit Generated/.\n" });
repo("Platform/portal-ui", { file: "AGENTS.local.md", text: "# portal-ui\n\nStack: `angular`\n\n## Purpose\n\nTODO(you): fill in\n" });
repo("Platform/no-guide");
configure({ config: { workspace: root }, env: () => undefined, log: { info() {}, warn() {} } });

test("a repo guide's stack, purpose and remembered lines", () => {
  assert.deepEqual(guideFacts("Stack: dotnet, angular\n## Purpose\n\n- Screens for the portal. Also more.\n## Remembered\n- a\n* b\n## Other\n- c"), { stack: "dotnet, angular", purpose: "Screens for the portal.", remembered: ["- a", "* b"] });
  assert.deepEqual(guideFacts(""), { stack: "", purpose: "", remembered: [] });
});

test("knowledge.repos lists every repo with what its guide says", () => {
  const { repos } = knowledgeRepos();
  const by = Object.fromEntries(repos.map((r) => [r.folder, r]));
  assert.deepEqual(Object.keys(by).sort(), ["Platform/no-guide", "Platform/portal-ui", "shared-lib"]);
  assert.equal(by["shared-lib"].guide, "AGENTS.md");
  assert.equal(by["shared-lib"].stack, "dotnet");
  assert.equal(by["shared-lib"].purpose, "Domain models used by several products.");
  assert.equal(by["shared-lib"].remembered.length, 2);
  assert.equal(by["Platform/portal-ui"].guide, "AGENTS.local.md");
  assert.equal(by["Platform/portal-ui"].stack, "angular");
  assert.equal(by["Platform/portal-ui"].purpose, "", "TODO(you) is not a purpose");
  assert.equal(by["Platform/no-guide"].guide, null);
});

test("knowledge.map.write keeps a hand-written map once, refuses text without the marker, and reads back", () => {
  const file = path.join(root, "AGENTS.md");
  assert.deepEqual(readMap(), { path: file, exists: false, generated: false, text: "" });
  fs.writeFileSync(file, "# Workspace repo map\n\nby hand\n");
  assert.equal(readMap().generated, false);
  assert.throws(() => writeMap({ text: "# no marker" }), /marker/);
  const one = writeMap({ text: `${MARKER}\n# Workspace repo map\n\nfirst\n` });
  assert.equal(one.kept, path.join(root, KEPT_FILE));
  assert.equal(fs.readFileSync(one.kept, "utf8"), "# Workspace repo map\n\nby hand\n");
  assert.ok(readMap().generated);
  const two = writeMap({ text: `${MARKER}\n# Workspace repo map\n\nsecond\n` });
  assert.equal(two.kept, null, "a map Workshop wrote is not kept");
  assert.equal(two.changed, true);
  assert.equal(writeMap({ text: `${MARKER}\n# Workspace repo map\n\nsecond\n` }).changed, false);
  // A second hand edit that drops the marker: kept copy is never overwritten.
  fs.writeFileSync(file, "hand again\n");
  writeMap({ text: `${MARKER}\nthird\n` });
  assert.equal(fs.readFileSync(path.join(root, KEPT_FILE), "utf8"), "# Workspace repo map\n\nby hand\n");
  assert.deepEqual(fs.readdirSync(root).filter((f) => f.endsWith(".tmp")), []);
});

test("knowledge.draft quotes a product name with spaces", () => {
  assert.equal(draftArgs("Sample Portal"), 'draft "Sample Portal"');
  assert.equal(draftArgs('Wiki "Edge"\n'), 'draft "Wiki Edge"');
  assert.equal(draftArgs("portal"), "draft portal");
  assert.throws(() => draftArgs("  "), /Name the product/);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

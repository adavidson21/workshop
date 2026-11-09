// lib/workspace.mjs: local work items, repo URLs and the repo map, and reading opencode's provider list.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addToRepoMap, categoryFolder, createLocalItem, localWorkItemText, nextLocalNumber, prFromUrl, repoNameFromUrl, slugOf } from "../lib/workspace.mjs";
import { parseProviders } from "../lib/opencode-state.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oc-ws-"));

test("local work items get L<n> ids that are never reused, in folders the parser reads", () => {
  const root = tmp();
  try {
    assert.equal(nextLocalNumber(root), 1);
    const a = createLocalItem({ title: "Add CSV export to the reports page", description: "Users ask for it.", lane: "feature" }, root);
    assert.deepEqual(a, { id: "L1", folder: "L1-add-csv-export-reports-page" });
    const wi = fs.readFileSync(path.join(root, a.folder, "workitem.md"), "utf8");
    assert.match(wi, /^# Work item L1: Add CSV export to the reports page$/m, "the parser's title line");
    assert.match(wi, /^- Type: Feature$/m);
    assert.match(wi, /Users ask for it\./);
    assert.match(wi, /## Repro steps \(bugs only\)\n\nNot a bug/);
    const b = createLocalItem({ title: "Export\nfails", repro: "1. Click twice", lane: "bug" }, root);
    assert.equal(b.id, "L2");
    assert.match(fs.readFileSync(path.join(root, b.folder, "workitem.md"), "utf8"), /- Type: Bug[\s\S]*<describe the work here>[\s\S]*1\. Click twice/);
    fs.rmSync(path.join(root, b.folder), { recursive: true });
    assert.equal(nextLocalNumber(root), 3, "a removed item's number is not reused (.local-ids)");
    assert.throws(() => createLocalItem({ title: "  ", lane: "feature" }, root), /title/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("slugs match the eng-agents scripts", () => {
  assert.equal(slugOf("The export job fails when retried"), "export-job-fails-retried");
  assert.equal(slugOf("!!!"), "item");
  assert.match(localWorkItemText({ id: "L9", title: "T", type: "Feature", date: "2026-11-01" }), /- Source: Local \(no tracker item\)\n- Created: 2026-11-01/);
});

test("repo names come from clone URLs; anything else is refused", () => {
  assert.equal(repoNameFromUrl("https://github.com/owner/web-app.git"), "web-app");
  assert.equal(repoNameFromUrl("git@github.com:owner/api.git"), "api");
  assert.equal(repoNameFromUrl("https://dev.azure.com/org/proj/_git/billing-service"), "billing-service");
  assert.equal(repoNameFromUrl("ssh://git@host:22/team/tools/"), "tools");
  for (const bad of ["", "owner/repo", "--upload-pack=x", "https://host/ a", "file:///etc", "https://github.com/owner/.git"]) assert.equal(repoNameFromUrl(bad), null, bad);
});

test("the repo map is created, extended, and never gets a repo twice", () => {
  const ws = tmp();
  try {
    assert.equal(addToRepoMap(ws, "web-app", "The | web app\n"), "created");
    let map = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
    assert.match(map, /## Repos[\s\S]*\| web-app \| The web app \| \| No \|/);
    assert.equal(addToRepoMap(ws, "api", ""), "added");
    assert.equal(addToRepoMap(ws, "WEB-APP", "again"), "listed");
    map = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
    assert.match(map, /\| web-app [^\n]*\n\| api \| TODO\(you\)/);
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "# My map\r\n\r\n## Products\r\n\r\nStuff\r\n");
    assert.equal(addToRepoMap(ws, "docs", "Docs"), "added");
    assert.match(fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8"), /# My map[\s\S]*## Products[\s\S]*## Repos[\s\S]*\| docs \| Docs \|/, "a hand-written map keeps its content");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("connected AI providers are read from both opencode shapes", () => {
  assert.deepEqual(parseProviders({ all: [{ id: "anthropic", name: "Anthropic" }], connected: ["anthropic", "custom"] }), ["Anthropic", "custom"]);
  assert.deepEqual(parseProviders({ data: { all: [], connected: [] } }), []);
  assert.deepEqual(parseProviders({ providers: [{ id: "openai", name: "OpenAI" }, { id: "x" }] }), ["OpenAI", "x"]);
  assert.equal(parseProviders({ something: 1 }), null);
  assert.equal(parseProviders(null), null);
});

test("PR links: the number and a clean link from ADO pull request URLs; anything else is refused", () => {
  assert.deepEqual(prFromUrl("https://ado.example.test/tfs/Coll/Shop/_git/orders-api/pullrequest/812?_a=files#c1"), { id: "812", url: "https://ado.example.test/tfs/Coll/Shop/_git/orders-api/pullrequest/812" });
  assert.deepEqual(prFromUrl(" https://dev.azure.com/org/proj/_git/repo/pullrequest/42/ "), { id: "42", url: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42" });
  for (const bad of ["", "812", "https://github.com/o/r/pull/3", "https://x/_git/r/pullrequest/1;calc", "https://x/a b/_git/r/pullrequest/1", "file:///_git/r/pullrequest/1", "https://x/_git/r/pullrequest/abc"]) assert.equal(prFromUrl(bad), null, bad);
});

test("Add a repo's category: empty is the top of the workspace, else a folder path (up to 3 deep) with no repo on the way", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "oc-cat-"));
  try {
    fs.mkdirSync(path.join(ws, "Platform"));
    fs.mkdirSync(path.join(ws, "api", ".git"), { recursive: true });
    fs.writeFileSync(path.join(ws, "notes.txt"), "x");
    assert.equal(categoryFolder(ws, ""), null);
    assert.equal(categoryFolder(ws, null), null);
    assert.equal(categoryFolder(ws, " Platform "), "Platform");
    assert.equal(categoryFolder(ws, "Data"), "Data", "a new category is fine; addRepo makes it");
    assert.throws(() => categoryFolder(ws, "api"), /is a repo, not a category/);
    assert.throws(() => categoryFolder(ws, "notes.txt"), /file named notes.txt/);
    assert.equal(categoryFolder(ws, "Platform/Lighthouse Edge"), "Platform/Lighthouse Edge", "nested, with a space");
    assert.equal(categoryFolder(ws, "Platform\\New\\Deep"), "Platform/New/Deep", "a backslash becomes /");
    assert.throws(() => categoryFolder(ws, "api/inner"), /api is a repo, not a category/, "a repo on the way is refused");
    for (const bad of ["a/b/c/d", "..", ".hidden", "-x", "a/../b", " a /b", "a/ b", "a/"]) assert.throws(() => categoryFolder(ws, bad), /not a valid category/, bad);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

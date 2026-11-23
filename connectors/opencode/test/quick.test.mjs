// lib/quick.mjs (1.38.0): Quick answers look up the notes for a question in code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chunks, corpus, docsFor, quickSystem, rank, terms } from "../lib/quick.mjs";

test("terms: the words that matter, with simple plurals", () => {
  assert.deepEqual(terms("When do we release the builds?").sort(), ["build", "builds", "release"].sort());
  assert.ok(terms("Who reviews a PR?").includes("pr"));
});

test("chunks cut at headings and keep the note's title", () => {
  const c = chunks("---\ntags: x\n---\n# Handbook\n\nIntro.\n\n## Releases\n\nThursdays.\n", "Handbook");
  assert.deepEqual(c.map((x) => x.title), ["Handbook", "Handbook > Releases"]);
  assert.match(c[1].text, /Thursdays/);
});

test("rank prefers the passage that matches, within the budget", () => {
  const ps = [
    { source: "folio/meetings/lunch.md", title: "Lunch", text: "Tacos on Friday." },
    { source: "folio/team/handbook.md", title: "Handbook > Releases", text: "We release on Thursdays after the check." },
    { source: "folio/team/handbook.md", title: "Handbook > Sprints", text: "Two weeks." },
  ];
  const r = rank("When do we release?", ps);
  assert.deepEqual(r.map((p) => p.title), ["Handbook > Releases"]);
  assert.deepEqual(rank("When do we release?", ps, 5), [], "nothing over the budget");
  assert.deepEqual(rank("the and of", ps), [], "no words that matter");
});

test("corpus reads Folio notes, Settings' glossary and the repo map; skips history and templates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quick-"));
  const data = path.join(root, "data"), ws = path.join(root, "ws");
  for (const d of ["folio/team", "folio/history/x", "folio/templates", "settings"]) fs.mkdirSync(path.join(data, d), { recursive: true });
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(data, "folio/team/handbook.md"), "# Handbook\n\nWe release on Thursdays.\n");
  fs.writeFileSync(path.join(data, "folio/history/x/old.md"), "# Old\n\nWe release on Mondays.\n");
  fs.writeFileSync(path.join(data, "folio/templates/meeting.md"), "# Meeting\n\nrelease\n");
  fs.writeFileSync(path.join(data, "settings/glossary.json"), JSON.stringify({ items: [{ id: "g1", word: "SKU", meaning: "stock keeping unit" }] }));
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "# Repo map\n\n## Repos\n\nbilling-api: invoices\n");
  const c = corpus({ dataDir: data, workspace: ws });
  assert.deepEqual([...new Set(c.map((p) => p.source))].sort(), ["AGENTS.md", "folio/team/handbook.md", "settings/glossary.json"]);
  assert.match(c.find((p) => p.source === "settings/glossary.json").text, /word: SKU; meaning: stock keeping unit/);
  const d = docsFor("When do we release?", { dataDir: data, workspace: ws });
  assert.deepEqual(d.sources, ["folio/team/handbook.md"]);
  assert.match(d.system, /\[folio\/team\/handbook\.md\] Handbook/);
  assert.match(d.system, /Sources:/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("with no notes that fit, the prompt says so and asks for no Sources line", () => {
  const s = quickSystem("q", []);
  assert.match(s, /No notes matched/);
  assert.doesNotMatch(s, /End with a line `Sources:`/);
});

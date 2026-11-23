// lib/builds.mjs: Builds' PM steps. The commands themselves run in opencode (connector.test.mjs covers runLoose);
// here: which folders and files Builds may touch, and file.write's conflict check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PM_FILE, PM_FOLDER, approveFolder, checkFolder, draftGate, openLines, startRefine, startScope, startShape, writePmFile } from "../lib/builds.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oc-builds-"));

test("only triage, shape, scope, refine and handoff folders, and .md files at their top", () => {
  for (const ok of ["triage-41207", "triage-csv-export-reports-page", "shape-bulk-export", "shape-41207", "scope-change-request", "refine-export-orders", "handoff-L3"]) assert.ok(PM_FOLDER.test(ok), ok);
  for (const bad of ["41207-export", "spike-cache", "scope-", "scope-../x", "triage-a/b", ".work", "pr-12"]) assert.ok(!PM_FOLDER.test(bad), bad);
  for (const ok of ["triage.md", "answers.md", "refine.md"]) assert.ok(PM_FILE.test(ok), ok);
  for (const bad of ["notes.txt", "../x.md", "a/b.md", ".hidden.md", "x.md.exe"]) assert.ok(!PM_FILE.test(bad), bad);
});

test("checkFolder names the kinds it takes and refuses a folder that is not there", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "scope-orders"));
    assert.equal(checkFolder("scope-orders", ["scope"], root), "scope-orders");
    assert.throws(() => checkFolder("scope-orders", ["refine"], root), /not a refine folder/);
    assert.throws(() => checkFolder("refine-missing", ["refine"], root), (e) => e.status === 404);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("file.write creates, replaces only what you read, and refuses anything else", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "triage-41207"));
    const file = path.join(root, "triage-41207", "answers.md");
    assert.deepEqual(writePmFile({ folder: "triage-41207", file: "answers.md", text: "Yes, CSV." }, root), { folder: "triage-41207", file: "answers.md", size: 9 });
    assert.equal(fs.readFileSync(file, "utf8"), "Yes, CSV.");
    assert.throws(() => writePmFile({ folder: "triage-41207", file: "answers.md", text: "again" }, root), (e) => e.status === 409, "creating a file that exists");
    assert.throws(() => writePmFile({ folder: "triage-41207", file: "answers.md", text: "x", expected: "old" }, root), (e) => e.status === 409 && e.current === "Yes, CSV.");
    writePmFile({ folder: "triage-41207", file: "answers.md", text: "Yes, CSV and PDF.", expected: "Yes, CSV." }, root);
    assert.equal(fs.readFileSync(file, "utf8"), "Yes, CSV and PDF.");
    assert.throws(() => writePmFile({ folder: "triage-41207", file: "x.txt", text: "x" }, root), (e) => e.status === 400);
    assert.throws(() => writePmFile({ folder: "41207-export", file: "a.md", text: "x" }, root), (e) => e.status === 400);
    assert.throws(() => writePmFile({ folder: "triage-41207", file: "big.md", text: "x".repeat(200001) }, root), /too big/);
    assert.ok(!fs.existsSync(file + ".tmp"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shape.start, and scope or refine from a shape, refuse bad arguments before anything runs", async () => {
  await assert.rejects(startShape({ folder: "shape-x", mode: "later" }), (e) => e.status === 400 && /brief.*more/.test(e.message));
  await assert.rejects(startShape({ idea: "Bulk export", mode: "brief" }), (e) => e.status === 400 && /needs a shape folder/.test(e.message));
  await assert.rejects(startShape({ idea: "  " }), (e) => e.status === 400);
  await assert.rejects(startShape({ idea: "shape-bulk-export" }), (e) => e.status === 400 && /pass it as folder/.test(e.message));
  await assert.rejects(startShape({ idea: "x".repeat(4001) }), /4000/);
  await assert.rejects(startShape({ from: "scope-orders" }), (e) => e.status === 400 && /not a triage folder/.test(e.message));
  await assert.rejects(startShape({ folder: "triage-41207" }), (e) => e.status === 400 && /not a shape folder/.test(e.message));
  await assert.rejects(startShape({ folder: "shape-not-there-xyz" }), (e) => e.status === 404);
  await assert.rejects(startScope({ from: "triage-41207" }), (e) => e.status === 400 && /not a shape folder/.test(e.message));
  await assert.rejects(startRefine({ from: "shape-not-there-xyz" }), (e) => e.status === 404);
});

test("file.write takes a shape folder (Builds writes the interview's answers.md)", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "shape-bulk-export"));
    assert.deepEqual(writePmFile({ folder: "shape-bulk-export", file: "answers.md", text: "## Round 1" }, root), { folder: "shape-bulk-export", file: "answers.md", size: 10 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 1.36.0: approving is file work in Workshop, not a Tandem session. The hash is eng-agents' DraftHash.ps1
// (this text, stamped by Set-DraftHash.ps1, gives de719b7228d9).
const STORIES = "# Stories\n\nStatus: DRAFT\nDraft-hash: de719b7228d9\n\n## Story 1  \r\nAs a user\n\n## Open questions\n\n- Which region first?\n";

test("draftGate gives the word Test-DraftHash.ps1 prints; openLines skips None, placeholders and accepted risk", () => {
  assert.equal(draftGate(STORIES), "unchanged");
  assert.equal(draftGate(STORIES.replace("Status: DRAFT", "Status: APPROVED")), "unchanged", "the Status line does not count");
  assert.equal(draftGate(STORIES.replace("As a user", "As an admin")), "edited");
  assert.equal(draftGate("Status: DRAFT\nNo hash\n"), "no-hash");
  assert.deepEqual(openLines(STORIES), ["- Which region first?"]);
  assert.deepEqual(openLines("## Open questions\n\n- None.\n\n## Next\n- not a question\n"), []);
  assert.deepEqual(openLines("## Open questions\n- <question>\n- Old one (accepted risk)\n- New one\n"), ["- New one"]);
  assert.deepEqual(openLines("No such section"), []);
});

test("approve: open questions stop it with nothing changed; acceptRisk marks them; then Status, progress.md and the gate", () => {
  const root = tmp();
  try {
    const dir = path.join(root, "scope-orders");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "stories.md"), STORIES);
    fs.writeFileSync(path.join(dir, "epics.md"), "# Epics\n\n## Open questions\n\n- Who owns billing?\n");
    fs.writeFileSync(path.join(dir, "progress.md"), "# Progress: scope-orders Orders\n");
    const day = new Date("2026-11-23T12:00:00Z");
    const first = approveFolder({ folder: "scope-orders" }, root, day);
    assert.deepEqual(first, { folder: "scope-orders", file: "stories.md", approved: false, open: ["- Which region first?", "- Who owns billing?"] });
    assert.equal(fs.readFileSync(path.join(dir, "stories.md"), "utf8"), STORIES, "nothing changed");
    const r = approveFolder({ folder: "scope-orders", acceptRisk: true }, root, day);
    assert.deepEqual(r, { folder: "scope-orders", file: "stories.md", approved: true, gate: "unchanged" });
    const after = fs.readFileSync(path.join(dir, "stories.md"), "utf8");
    assert.match(after, /^Status: APPROVED$/m);
    assert.match(after, /^- Which region first\? \(accepted risk\)$/m);
    assert.match(fs.readFileSync(path.join(dir, "epics.md"), "utf8"), /^- Who owns billing\? \(accepted risk\)$/m);
    const log = fs.readFileSync(path.join(dir, "progress.md"), "utf8");
    assert.match(log, /## 2026-11-23 \| \/approve \| Workshop/);
    assert.match(log, /- Stats: gate=unchanged file=stories/);
    assert.match(log, /- Next: `\/slice scope-orders`/);
    assert.throws(() => approveFolder({ folder: "scope-orders", what: "stories" }, root, day), (e) => e.status === 409 && /APPROVED, not DRAFT/.test(e.message));
    fs.writeFileSync(path.join(dir, "milestones.md"), "# Milestones\n\nStatus: DRAFT\n\n## Open questions\n\n- None.\n");
    assert.deepEqual(approveFolder({ folder: "scope-orders" }, root, day), { folder: "scope-orders", file: "milestones.md", approved: true, gate: "no-hash" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("approve: a refine folder has one file, and a scope's what must be stories or milestones", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "refine-export"));
    fs.writeFileSync(path.join(root, "refine-export", "refine.md"), "# Refine\n\nStatus: DRAFT\n");
    assert.throws(() => approveFolder({ folder: "refine-export", what: "stories" }, root), (e) => e.status === 400);
    assert.equal(approveFolder({ folder: "refine-export" }, root).approved, true);
    assert.match(fs.readFileSync(path.join(root, "refine-export", "refine.md"), "utf8"), /Status: APPROVED/);
    assert.equal(fs.existsSync(path.join(root, "refine-export", "progress.md")), true, "a missing progress.md is started");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

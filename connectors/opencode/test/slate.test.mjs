// lib/slate.mjs: Slate's PM steps. The commands themselves run in opencode (connector.test.mjs covers runLoose);
// here: which folders and files Slate may touch, and file.write's conflict check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PM_FILE, PM_FOLDER, checkFolder, startRefine, startScope, startShape, writePmFile } from "../lib/slate.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oc-slate-"));

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

test("file.write takes a shape folder (Slate writes the interview's answers.md)", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "shape-bulk-export"));
    assert.deepEqual(writePmFile({ folder: "shape-bulk-export", file: "answers.md", text: "## Round 1" }, root), { folder: "shape-bulk-export", file: "answers.md", size: 10 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// lib/docs.mjs: Notebook's list of .work documents and the editor's writes to item folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORK_FOLDER, listDocs, reviewFile, writeWorkFile } from "../lib/docs.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oc-docs-"));
const none = () => null;

test("reviewFile names the file a gated step waits on, only while it needs you", () => {
  const it = { files: ["spec.md", "plan.md"], next: { stage: "plan", needsYou: true } };
  assert.equal(reviewFile(it), "plan.md");
  assert.equal(reviewFile({ ...it, paused: true }), null);
  assert.equal(reviewFile({ ...it, next: { stage: "plan", needsYou: false } }), null);
  assert.equal(reviewFile({ ...it, next: { stage: "build", needsYou: true } }), null);
  assert.equal(reviewFile({ files: ["spec.md"], next: { stage: "plan", needsYou: true } }), null, "file not written yet");
});

test("docs.list lists Markdown files per folder, gate files first, newest folder first", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "41207-login"));
    fs.mkdirSync(path.join(root, "spike-cache"));
    for (const f of ["workitem.md", "plan.md", "spec.md", "notes.txt"]) fs.writeFileSync(path.join(root, "41207-login", f), "x");
    fs.writeFileSync(path.join(root, "spike-cache", "findings.md"), "y");
    const old = Date.now() / 1000 - 3600;
    for (const f of ["workitem.md", "plan.md", "spec.md"]) fs.utimesSync(path.join(root, "41207-login", f), old, old);
    const model = { items: [
      { folder: "41207-login", kind: "item", id: 41207, title: "Login", stage: "plan", lane: "feature", files: ["workitem.md", "plan.md", "spec.md", "notes.txt", "gone.md"], next: { stage: "plan", needsYou: true } },
      { folder: "spike-cache", kind: "spike", id: null, title: "Cache", files: ["findings.md"] },
      { folder: "../escape", files: ["x.md"] },
    ] };
    const r = listDocs(model, (f) => (f === "spike-cache" ? "Tandem is working on this item" : null), root);
    assert.deepEqual(r.items.map((i) => i.folder), ["spike-cache", "41207-login"]);
    const login = r.items[1];
    assert.deepEqual(login.files.map((f) => f.file), ["spec.md", "plan.md", "workitem.md"]);
    assert.equal(login.id, "41207");
    assert.equal(login.review, "plan.md");
    assert.equal(login.busy, null);
    assert.equal(r.items[0].busy, "Tandem is working on this item");
    assert.equal(typeof login.files[0].mtime, "number");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("writeWorkFile writes item folders with the conflict check, and refuses while Tandem works", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "41207-login"));
    const file = path.join(root, "41207-login", "plan.md");
    fs.writeFileSync(file, "# Plan");
    assert.deepEqual(writeWorkFile({ folder: "41207-login", file: "plan.md", text: "# Plan\n\nMore.", expected: "# Plan" }, { root, busyFor: none }), { folder: "41207-login", file: "plan.md", size: 13 });
    assert.equal(fs.readFileSync(file, "utf8"), "# Plan\n\nMore.");
    assert.throws(() => writeWorkFile({ folder: "41207-login", file: "plan.md", text: "x", expected: "# Plan" }, { root, busyFor: none }), (e) => e.status === 409 && e.current === "# Plan\n\nMore.");
    assert.throws(() => writeWorkFile({ folder: "41207-login", file: "plan.md", text: "x" }, { root, busyFor: none }), (e) => e.status === 409, "creating a file that exists");
    assert.throws(() => writeWorkFile({ folder: "41207-login", file: "plan.md", text: "x", expected: "# Plan\n\nMore." }, { root, busyFor: () => "Tandem is working on this item" }), (e) => e.status === 409 && /working/.test(e.message));
    assert.equal(fs.readFileSync(file, "utf8"), "# Plan\n\nMore.", "nothing written while busy");
    assert.throws(() => writeWorkFile({ folder: "41207-login", file: "../x.md", text: "x" }, { root }), (e) => e.status === 400);
    assert.throws(() => writeWorkFile({ folder: "41207-login", file: "plan.txt", text: "x" }, { root }), (e) => e.status === 400);
    assert.throws(() => writeWorkFile({ folder: "..", file: "a.md", text: "x" }, { root }), (e) => e.status === 400);
    assert.throws(() => writeWorkFile({ folder: ".hidden", file: "a.md", text: "x" }, { root }), (e) => e.status === 400);
    assert.throws(() => writeWorkFile({ folder: "41999-missing", file: "a.md", text: "x" }, { root }), (e) => e.status === 404);
    assert.ok(!fs.existsSync(file + ".tmp"));
    for (const ok of ["41207-login", "spike-cache", "pr-4812", "L3-local"]) assert.ok(WORK_FOLDER.test(ok), ok);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

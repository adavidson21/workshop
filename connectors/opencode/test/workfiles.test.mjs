// Tests for lib/workfiles.mjs (Chat's Files) in a temp workspace. Synthetic data only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_EDIT, filesRead, filesStat, filesTree, filesWrite, fullPath } from "../lib/workfiles.mjs";
import { configure } from "../lib/context.mjs";

const top = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-files-"));
const ws = path.join(top, "work");
const outside = path.join(top, "outside");
after(() => fs.rmSync(top, { recursive: true, force: true }));
fs.mkdirSync(path.join(ws, "api", "src"), { recursive: true });
fs.mkdirSync(path.join(ws, ".git"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(ws, "api", "src", "app.cs"), "class App {}\n");
fs.writeFileSync(path.join(ws, "README.md"), "\uFEFF# Sample\r\n");
fs.writeFileSync(path.join(ws, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
fs.writeFileSync(path.join(ws, ".git", "config"), "[core]\n");
fs.writeFileSync(path.join(outside, "secret.txt"), "not yours\n");
configure({ config: { workspace: ws }, env: () => undefined, log: { info() {}, warn() {} } });
const throwsCode = (fn, code, re) => assert.throws(fn, (e) => e.code === code && (!re || re.test(e.message)));

test("a folder lists folders first, without git's own folder", () => {
  const top = filesTree({});
  assert.equal(top.dir, "");
  // .work (Tandem's work folder, made by configure) shows like any other folder.
  assert.deepEqual(top.items.filter((i) => i.name !== ".work").map((i) => [i.name, i.dir]), [["api", true], ["logo.png", false], ["README.md", false]]);
  assert.deepEqual(filesTree({ dir: "api/src" }).items, [{ name: "app.cs", path: "api/src/app.cs", dir: false }]);
  throwsCode(() => filesTree({ dir: "nope" }), "not_found");
});

test("paths stay in the workspace and out of .git", () => {
  for (const bad of ["../outside/secret.txt", "/etc/passwd", "C:/Windows/win.ini", "api/../../outside/secret.txt", ".git/config", "api/.GIT/x", "a\0b"]) {
    throwsCode(() => fullPath(bad), "bad_request");
  }
  assert.equal(fullPath("api\\src\\app.cs"), path.join(ws, "api", "src", "app.cs"), "backslashes work too");
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));
    fs.symlinkSync(outside, path.join(ws, "linkdir"));
    throwsCode(() => filesRead({ path: "link.txt" }), "bad_request", /outside the workspace/);
    throwsCode(() => filesWrite({ path: "linkdir/new.txt", content: "x", create: true }), "bad_request", /outside the workspace/);
    assert.equal(fs.readdirSync(outside).length, 1, "nothing was written outside");
    fs.rmSync(path.join(ws, "link.txt"));
    fs.rmSync(path.join(ws, "linkdir"));
  }
});

test("reading: text with its mtime; images and huge files are not opened as text; a BOM is kept", () => {
  const r = filesRead({ path: "api/src/app.cs" });
  assert.equal(r.content, "class App {}\n");
  assert.equal(r.path, "api/src/app.cs");
  assert.equal(typeof r.mtime, "number");
  assert.equal(filesRead({ path: "README.md" }).content, "\uFEFF# Sample\r\n", "BOM and line endings as they are");
  assert.equal(filesRead({ path: "logo.png" }).binary, true);
  fs.writeFileSync(path.join(ws, "big.log"), "x".repeat(MAX_EDIT + 1));
  const big = filesRead({ path: "big.log" });
  assert.equal(big.tooBig, true);
  assert.equal(big.content, undefined);
  fs.rmSync(path.join(ws, "big.log"));
  throwsCode(() => filesRead({ path: "api" }), "bad_request", /folder/);
  throwsCode(() => filesRead({ path: "gone.txt" }), "not_found");
});

test("saving: only over the version you opened, unless you say so", () => {
  const file = path.join(ws, "api", "src", "app.cs");
  const opened = filesRead({ path: "api/src/app.cs" });
  const saved = filesWrite({ path: "api/src/app.cs", content: "class App { }\n", mtime: opened.mtime });
  assert.equal(saved.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), "class App { }\n");
  // An agent changes it while it is open.
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(file, "class App { int x; }\n");
  fs.utimesSync(file, later, later);
  const clash = filesWrite({ path: "api/src/app.cs", content: "mine\n", mtime: saved.mtime });
  assert.deepEqual([clash.ok, clash.conflict], [false, "changed"]);
  assert.equal(fs.readFileSync(file, "utf8"), "class App { int x; }\n", "nothing written");
  assert.equal(filesWrite({ path: "api/src/app.cs", content: "mine\n", mtime: saved.mtime, force: true }).ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), "mine\n");
  assert.equal(filesWrite({ path: "api/src/gone.cs", content: "x", mtime: 1 }).conflict, "gone");
  assert.equal(filesWrite({ path: "README.md", content: "x", create: true }).conflict, "exists");
  const made = filesWrite({ path: "docs/new/notes.md", content: "# Notes\n", create: true });
  assert.equal(made.ok, true);
  assert.equal(fs.readFileSync(path.join(ws, "docs", "new", "notes.md"), "utf8"), "# Notes\n");
  throwsCode(() => filesWrite({ path: "big.txt", content: "x".repeat(MAX_EDIT + 1), create: true }), "too_large");
});

test("stat says when open files last changed, null for gone ones", () => {
  const r = filesStat({ paths: ["README.md", "nope.txt", "../outside/secret.txt"] });
  assert.equal(typeof r.mtimes["README.md"], "number");
  assert.equal(r.mtimes["nope.txt"], null);
  assert.equal(r.mtimes["../outside/secret.txt"], null);
});

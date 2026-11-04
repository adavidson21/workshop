// lib/projects.mjs: Dispatch projects, run assignment, Inbox, pending starts, and the file on disk.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  INBOX, assignPending, assignRun, checkProject, createProject, deleteProject, forgetRun, instructionsBlock,
  loadProjects, projectOf, projectsData, resetProjects, updateProject, useStateDir,
} from "../lib/projects.mjs";
import { createLocalItem } from "../lib/workspace.mjs";

let ws, state;
const file = () => path.join(state, "projects.json");
const onDisk = () => JSON.parse(fs.readFileSync(file(), "utf8"));
const code = (re, status) => (e) => {
  assert.match(e.message, re);
  if (status) assert.equal(e.status, status);
  return true;
};

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "oc-proj-"));
  state = path.join(ws, ".work", "_dashboard");
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(ws, "orders-api"));
  useStateDir(state);
  resetProjects();
});
afterEach(() => {
  useStateDir(null);
  resetProjects();
  fs.rmSync(ws, { recursive: true, force: true });
});

test("Inbox is always listed first and holds runs with no project", () => {
  const d = projectsData();
  assert.equal(d.inbox, INBOX);
  assert.deepEqual(d.projects.map((p) => p.id), [INBOX]);
  assert.equal(d.projects[0].builtIn, true);
  assert.equal(projectOf("41207-fix-login"), INBOX);
  assert.throws(() => updateProject({ id: INBOX, name: "Mine" }), code(/built in/, 400));
  assert.throws(() => deleteProject({ id: INBOX }), code(/built in/, 400));
});

test("projects are created with unique ids, saved, and read back", () => {
  const a = createProject({ name: "Orders API", repo: "orders-api", baseBranch: "develop", instructions: "Use the repo's test script.", color: "teal" }).project;
  assert.equal(a.id, "p-orders-api");
  assert.equal(a.color, "teal");
  const b = createProject({ name: "Orders  API!" }).project;
  assert.equal(b.id, "p-orders-api-2", "same slug gets a number");
  assert.equal(onDisk().projects.length, 2);
  resetProjects();
  loadProjects();
  const ids = projectsData().projects.map((p) => p.id);
  assert.deepEqual(ids, [INBOX, "p-orders-api", "p-orders-api-2"]);
  assert.equal(projectsData().projects[1].baseBranch, "develop");
});

test("a repo one folder down (Category/repo) can be a project's repo", () => {
  fs.mkdirSync(path.join(ws, "Platform", "gateway"), { recursive: true });
  assert.equal(createProject({ name: "Gateway", repo: "Platform/gateway" }).project.repo, "Platform/gateway");
  assert.equal(createProject({ name: "Gateway 2", repo: "Platform\\gateway" }).project.repo, "Platform/gateway", "a backslash becomes /");
  assert.throws(() => createProject({ name: "X", repo: "Platform/nope" }), code(/no Platform\/nope folder/, 404));
  for (const bad of ["a/b/c", "Platform/../etc", "/Platform/gateway", "Platform/.git", "Platform/"]) assert.throws(() => createProject({ name: "X", repo: bad }), code(/not a valid repo/, 400), bad);
});

test("bad input is refused in plain words", () => {
  assert.throws(() => createProject({ name: "  " }), code(/name/, 400));
  assert.throws(() => createProject({ name: "X", repo: "../etc" }), code(/not a valid repo/, 400));
  assert.throws(() => createProject({ name: "X", repo: "billing" }), code(/no billing folder/, 404));
  assert.throws(() => createProject({ name: "X", baseBranch: "-x" }), code(/branch/, 400));
  assert.throws(() => createProject({ name: "X", baseBranch: "a..b" }), code(/branch/, 400));
  assert.throws(() => createProject({ name: "X", color: "neon" }), code(/Color/, 400));
  assert.equal(fs.existsSync(file()), false, "nothing saved after refusals");
});

test("update changes only the fields given; an empty string clears", () => {
  const { id } = createProject({ name: "Orders", repo: "orders-api", baseBranch: "main" }).project;
  const p = updateProject({ id, baseBranch: "", instructions: "Keep PRs small." }).project;
  assert.equal(p.name, "Orders");
  assert.equal(p.repo, "orders-api");
  assert.equal(p.baseBranch, null);
  assert.equal(p.instructions, "Keep PRs small.");
  assert.throws(() => updateProject({ id, name: "" }), code(/name/, 400));
  assert.throws(() => updateProject({ id: "p-nope", name: "A" }), code(/No project/, 404));
});

test("runs move between projects and back to Inbox; removing a project moves its runs to Inbox", () => {
  const { id } = createProject({ name: "Orders" }).project;
  assignRun({ folder: "41207-fix-login", project: id });
  assignRun({ folder: "L3-csv-export", project: id });
  assert.equal(projectOf("41207-fix-login"), id);
  assignRun({ folder: "L3-csv-export", project: INBOX });
  assert.equal(projectOf("L3-csv-export"), INBOX);
  assert.deepEqual(onDisk().runs, { "41207-fix-login": id });
  assert.throws(() => assignRun({ folder: "x", project: "p-nope" }), code(/No project/, 404));
  assert.throws(() => assignRun({ folder: "../x", project: id }), code(/folder/, 400));
  assert.throws(() => assignRun({ folder: "gone", project: id }, () => false), code(/No work item folder/, 404));
  assert.deepEqual(deleteProject({ id }), { ok: true, movedToInbox: 1 });
  assert.equal(projectOf("41207-fix-login"), INBOX);
  assert.deepEqual(onDisk(), { version: 1, projects: [], runs: {}, pending: {} });
});

test("a run started by work item id joins its project once the .work folder exists", () => {
  const { id } = createProject({ name: "Orders" }).project;
  assignPending("456", id);
  assert.deepEqual(projectsData(() => null).runs, {}, "no folder yet");
  assert.deepEqual(onDisk().pending, { 456: id });
  const d = projectsData((wid) => (wid === "456" ? "456-new-thing" : null));
  assert.deepEqual(d.runs, { "456-new-thing": id });
  assert.deepEqual(onDisk().pending, {});
  forgetRun("456-new-thing");
  assert.deepEqual(onDisk().runs, {});
});

test("a hand-broken file means no projects, and bad rows are dropped", () => {
  fs.writeFileSync(file(), "{not json");
  loadProjects();
  assert.equal(projectsData().projects.length, 1);
  fs.writeFileSync(file(), JSON.stringify({
    projects: [{ id: "p-ok", name: "OK", color: "neon" }, { id: "bad id", name: "X" }, { id: "p-ok", name: "dup" }, null],
    runs: { "41207-x": "p-ok", "L1-y": "p-missing", "../z": "p-ok" },
  }));
  loadProjects();
  const d = projectsData();
  assert.deepEqual(d.projects.map((p) => p.id), [INBOX, "p-ok"]);
  assert.equal(d.projects[1].color, "slate", "unknown color falls back");
  assert.deepEqual(d.runs, { "41207-x": "p-ok" });
});

test("start actions check the project first; instructions go in workitem.md", () => {
  assert.equal(checkProject(undefined), null);
  assert.equal(checkProject(INBOX), null);
  assert.throws(() => checkProject("p-nope"), code(/No project/, 404));
  const { id } = createProject({ name: "Orders", repo: "orders-api", baseBranch: "develop", instructions: "Run npm test before every commit." }).project;
  assert.equal(checkProject(id), id);
  const block = instructionsBlock(id);
  assert.match(block, /^Project: Orders/);
  assert.match(block, /Run npm test before every commit\./);
  assert.match(block, /Repo: orders-api/);
  assert.match(block, /Base branch: develop/);
  assert.equal(instructionsBlock(createProject({ name: "Empty" }).project.id), null);
  const root = path.join(ws, ".work");
  const item = createLocalItem({ title: "Add CSV export", lane: "feature", extra: block }, root);
  const wi = fs.readFileSync(path.join(root, item.folder, "workitem.md"), "utf8");
  assert.match(wi, /## Extra context from the engineer\n\nProject: Orders[\s\S]*Base branch: develop\n$/);
  const plain = createLocalItem({ title: "Other", lane: "feature" }, root);
  assert.match(fs.readFileSync(path.join(root, plain.folder, "workitem.md"), "utf8"), /## Extra context from the engineer\n\nNone\n$/);
});

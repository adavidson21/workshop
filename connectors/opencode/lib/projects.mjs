// opencode connector: Dispatch projects. A project is a named scope for runs (work items): one repo in the
// workspace, a base branch, a color, and instructions the agent gets with every run started in it.
// Runs are the .work/<folder> items; this file only says which project each one belongs to.
//
// Stored in .work/_dashboard/projects.json, next to sessions.json, so it stays on this computer:
//   { "version": 1,
//     "projects": [ { "id", "name", "color", "repo", "baseBranch", "instructions", "model", "agent", "tracker", "created" } ],
//     "runs":    { "<folder>": "<project id>" },
//     "pending": { "<work item id>": "<project id>" } }   // started, .work folder not there yet
//
// Inbox is built in: it is never stored, cannot be changed or removed, and holds every run with no project.
// Folders and pins are view state and stay in the browser (Dispatch), not here.

import fs from "node:fs";
import path from "node:path";
import { httpError, opt, REPO_FOLDER_MAX, repoFolder, stateDir } from "./context.mjs";

export const INBOX = "inbox";
export const COLORS = ["slate", "blue", "teal", "green", "amber", "orange", "red", "rose", "violet"];
const VERSION = 1;
const MAX_PROJECTS = 200;

let data = empty();
let fileOverride = null; // tests: a root folder instead of the configured workspace

function empty() {
  return { version: VERSION, projects: [], runs: {}, pending: {} };
}
const fileIn = (dir) => path.join(dir, "projects.json");
const filePath = () => fileIn(fileOverride || stateDir);
const workspaceDir = () => (fileOverride ? path.resolve(fileOverride, "..", "..") : opt.workspace);

/** Use another _dashboard folder (tests). Null goes back to the configured workspace. */
export function useStateDir(dir) {
  fileOverride = dir;
}

export function resetProjects() {
  data = empty();
}

/** Read projects.json. A missing or hand-broken file means no projects, never an error. */
export function loadProjects() {
  data = empty();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath(), "utf8"));
  } catch {
    return;
  }
  if (!raw || typeof raw !== "object") return;
  const ids = new Set();
  for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
    if (!p || typeof p.id !== "string" || !/^p-[a-z0-9-]{1,60}$/.test(p.id) || ids.has(p.id) || typeof p.name !== "string") continue;
    ids.add(p.id);
    data.projects.push(clean(p));
  }
  for (const key of ["runs", "pending"]) {
    const m = raw[key] && typeof raw[key] === "object" ? raw[key] : {};
    for (const [k, v] of Object.entries(m)) if (typeof v === "string" && ids.has(v) && validKey(k)) data[key][k] = v;
  }
}

function save() {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const validKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 200 && !k.startsWith(".") && !/[\\/\0]/.test(k);

function clean(p) {
  return {
    id: p.id,
    name: String(p.name).slice(0, 80),
    color: COLORS.includes(p.color) ? p.color : "slate",
    repo: typeof p.repo === "string" ? p.repo : null,
    baseBranch: typeof p.baseBranch === "string" ? p.baseBranch : null,
    instructions: typeof p.instructions === "string" ? p.instructions : "",
    model: typeof p.model === "string" ? p.model : null,
    agent: typeof p.agent === "string" ? p.agent : null,
    tracker: typeof p.tracker === "string" ? p.tracker : null,
    created: typeof p.created === "string" ? p.created : null,
  };
}

// ------------------------------------------------------------------ validation

function text(v, label, max, { required = false } = {}) {
  if (v == null || v === "") {
    if (required) throw httpError(400, `Give the project a ${label}.`);
    return null;
  }
  const s = String(v).trim();
  if (required && !s) throw httpError(400, `Give the project a ${label}.`);
  if (s.length > max) throw httpError(400, `Keep the ${label} under ${max} characters.`);
  return s || null;
}

function repoName(v) {
  const raw = text(v, "repo folder", REPO_FOLDER_MAX);
  if (!raw) return null;
  const s = repoFolder(raw);
  if (!s) throw httpError(400, `"${raw}" is not a valid repo folder name.`);
  const ws = workspaceDir();
  if (ws && !fs.existsSync(path.join(ws, s))) throw httpError(404, `There is no ${s} folder in the workspace. Add the repo first.`);
  return s;
}

function branchName(v) {
  const s = text(v, "base branch", 200);
  if (!s) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(s) || s.startsWith("-") || s.includes("..") || s.endsWith("/") || s.endsWith(".lock")) throw httpError(400, `"${s}" is not a valid branch name.`);
  return s;
}

function color(v) {
  if (v == null || v === "") return null;
  if (!COLORS.includes(v)) throw httpError(400, `Color must be one of: ${COLORS.join(", ")}.`);
  return v;
}

function slug(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "project";
}

function find(id) {
  if (id === INBOX) throw httpError(400, "Inbox is built in and cannot be changed.");
  const p = data.projects.find((x) => x.id === id);
  if (!p) throw httpError(404, `No project "${id}". Refresh the page.`);
  return p;
}

function known(id) {
  return id === INBOX || data.projects.some((p) => p.id === id);
}

// ------------------------------------------------------------------ reads

/**
 * Projects for the `state` action. `itemFor(token)` maps a work item id to its .work folder (links.mjs
 * folderForToken); pending assignments whose folder now exists move to `runs` here.
 */
export function projectsData(itemFor = () => null) {
  let moved = false;
  for (const [wid, pid] of Object.entries(data.pending)) {
    const folder = itemFor(wid);
    if (!folder) continue;
    if (!data.runs[folder]) data.runs[folder] = pid;
    delete data.pending[wid];
    moved = true;
  }
  if (moved) {
    try { save(); } catch {}
  }
  return {
    inbox: INBOX,
    colors: COLORS,
    projects: [{ id: INBOX, name: "Inbox", color: "slate", builtIn: true, repo: null, baseBranch: null, instructions: "", model: null, agent: null, tracker: null, created: null }, ...data.projects.map((p) => ({ ...p, builtIn: false }))],
    runs: { ...data.runs },
  };
}

/** The project a run belongs to (Inbox when none). */
export function projectOf(folder) {
  return data.runs[folder] || INBOX;
}

/** A project's stored record, or null for Inbox or an unknown id. */
export function projectById(id) {
  return data.projects.find((p) => p.id === id) || null;
}

// ------------------------------------------------------------------ writes

export function createProject(args) {
  if (data.projects.length >= MAX_PROJECTS) throw httpError(400, `Keep it to ${MAX_PROJECTS} projects.`);
  const name = text(args.name, "name", 80, { required: true });
  const base = `p-${slug(name)}`;
  let id = base;
  for (let n = 2; data.projects.some((p) => p.id === id); n++) id = `${base}-${n}`;
  const p = clean({
    id,
    name,
    color: color(args.color) || COLORS[data.projects.length % COLORS.length],
    repo: repoName(args.repo),
    baseBranch: branchName(args.baseBranch),
    instructions: text(args.instructions, "instructions", 20000) || "",
    model: text(args.model, "model", 200),
    agent: text(args.agent, "agent", 200),
    tracker: text(args.tracker, "tracker link", 500),
    created: new Date().toISOString(),
  });
  data.projects.push(p);
  save();
  return { project: { ...p, builtIn: false } };
}

/** Change the fields given. An empty string clears a field (except the name). */
export function updateProject(args) {
  const p = find(args.id);
  const next = { ...p };
  if ("name" in args) next.name = text(args.name, "name", 80, { required: true });
  if ("color" in args) next.color = color(args.color) || p.color;
  if ("repo" in args) next.repo = repoName(args.repo);
  if ("baseBranch" in args) next.baseBranch = branchName(args.baseBranch);
  if ("instructions" in args) next.instructions = text(args.instructions, "instructions", 20000) || "";
  if ("model" in args) next.model = text(args.model, "model", 200);
  if ("agent" in args) next.agent = text(args.agent, "agent", 200);
  if ("tracker" in args) next.tracker = text(args.tracker, "tracker link", 500);
  Object.assign(p, clean(next));
  save();
  return { project: { ...p, builtIn: false } };
}

/** Remove a project. Its runs move to Inbox; their .work folders are not touched. */
export function deleteProject({ id }) {
  find(id);
  data.projects = data.projects.filter((p) => p.id !== id);
  let moved = 0;
  for (const key of ["runs", "pending"]) {
    for (const [k, v] of Object.entries(data[key])) {
      if (v !== id) continue;
      delete data[key][k];
      if (key === "runs") moved++;
    }
  }
  save();
  return { ok: true, movedToInbox: moved };
}

/** Put a run (a .work folder) in a project, or back in Inbox. */
export function assignRun({ folder, project }, exists = () => true) {
  if (!validKey(folder)) throw httpError(400, "Not a work item folder.");
  if (!known(project)) throw httpError(404, `No project "${project}". Refresh the page.`);
  if (!exists(folder)) throw httpError(404, `No work item folder "${folder}". Refresh the page.`);
  if (project === INBOX) delete data.runs[folder];
  else data.runs[folder] = project;
  save();
  return { folder, project };
}

/** Remember the project for a work item started by id, before its .work folder exists. */
export function assignPending(workItemId, project) {
  if (!project || project === INBOX) return;
  if (!known(project)) throw httpError(404, `No project "${project}". Refresh the page.`);
  data.pending[String(workItemId)] = project;
  save();
}

/** Forget a removed run. */
export function forgetRun(folder) {
  if (!(folder in data.runs)) return;
  delete data.runs[folder];
  try { save(); } catch {}
}

/** Check a project id given to a start action before anything is created. */
export function checkProject(project) {
  if (project == null || project === "" || project === INBOX) return null;
  if (!known(project)) throw httpError(404, `No project "${project}". Refresh the page.`);
  return project;
}

/**
 * The project's instructions as a block for workitem.md's "Extra context from the engineer" section,
 * so every agent step that reads the work item sees them. Null when there is nothing to add.
 */
export function instructionsBlock(project) {
  const p = projectById(project);
  if (!p) return null;
  const lines = [];
  if (p.instructions && p.instructions.trim()) lines.push(p.instructions.trim());
  if (p.repo) lines.push(`Repo: ${p.repo}`);
  if (p.baseBranch) lines.push(`Base branch: ${p.baseBranch}`);
  if (!lines.length) return null;
  return `Project: ${p.name}\n\n${lines.join("\n\n")}`;
}

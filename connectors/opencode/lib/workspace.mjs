// opencode connector: the workspace actions Dispatch needs to be used on its own, without Docket or a
// terminal. Start a described (local) work item, start a spike, review a teammate's PR, add a repo,
// write a repo's guide, and say whether ADO is set up.
//
// Local work items match eng-agents core/scripts/work/New-LocalWorkItem.ps1: the folder is
// .work/L<number>-<short-name>/ and workitem.md has the same shape. Keep the two in step.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { httpError, log, opt, workRoot } from "./context.mjs";
import { model, refresh } from "./model.mjs";
import { currentSession, folderForToken, linkFrom } from "./links.mjs";
import { oc, sessions, upsertSession } from "./opencode-state.mjs";
import { broadcastLive } from "./live.mjs";
import { needOpencode, runCommand } from "./actions.mjs";
import { INBOX, assignRun, checkProject, instructionsBlock } from "./projects.mjs";

// ------------------------------------------------------------------ local work items

const STOP = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "at", "with", "is", "be", "when", "from", "by"]);

/** The folder short name from a title, as ConvertTo-Slug in the eng-agents scripts makes it. */
export function slugOf(title) {
  const words = String(title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  let slug = words.slice(0, 5).join("-");
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+$/, "");
  return slug || "item";
}

/** The next local id number: one more than .work/.local-ids or any L<number>- folder. */
export function nextLocalNumber(root) {
  let max = 0;
  try {
    const t = fs.readFileSync(path.join(root, ".local-ids"), "utf8").trim();
    if (/^\d+$/.test(t)) max = Number(t);
  } catch {}
  for (const name of fs.readdirSync(root)) {
    const m = /^L(\d+)-/.exec(name);
    if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  return max + 1;
}

/** workitem.md for a local item. Same shape as New-LocalWorkItem.ps1 writes. */
export function localWorkItemText({ id, title, type, description, repro, date, extra }) {
  const desc = String(description || "").trim() || "<describe the work here>";
  const steps = type === "Bug" ? String(repro || "").trim() || "See the description" : "Not a bug";
  return `# Work item ${id}: ${title}

- Type: ${type}
- Source: Local (no tracker item)
- Created: ${date}

## Description

${desc}

## Acceptance criteria

None provided

## Repro steps (bugs only)

${steps}

## Extra context from the engineer

${String(extra || "").trim() || "None"}
`;
}

/** Create .work/L<n>-<slug>/workitem.md. Returns {id, folder}. */
export function createLocalItem({ title, description, repro, lane, extra }, root = workRoot) {
  const t = String(title || "").replace(/[\r\n]+/g, " ").trim();
  if (!t) throw httpError(400, "Give the work a title.");
  if (t.length > 200) throw httpError(400, "Keep the title under 200 characters.");
  fs.mkdirSync(root, { recursive: true });
  const n = nextLocalNumber(root);
  const id = `L${n}`;
  const folder = `${id}-${slugOf(t)}`;
  fs.writeFileSync(path.join(root, ".local-ids"), `${n}\n`);
  fs.mkdirSync(path.join(root, folder));
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(root, folder, "workitem.md"), localWorkItemText({ id, title: t, type: lane === "bug" ? "Bug" : "Feature", description, repro, date, extra }));
  return { id, folder };
}

/**
 * Describe-it start: create the local item, then run /start L<n> <lane> in a new session. With a project,
 * the run is put in it and the project's instructions go in workitem.md (lib/projects.mjs).
 */
export async function startLocal({ title, description, repro, lane, project }) {
  needOpencode();
  if (lane !== "feature" && lane !== "bug") throw httpError(400, 'Lane must be "feature" or "bug".');
  if (oc.commands.size && !oc.commands.has("start")) throw httpError(400, "opencode has no /start command. Run the Tandem install command again, then restart opencode.");
  const pid = checkProject(project);
  const { id, folder } = createLocalItem({ title, description, repro, lane, extra: pid ? instructionsBlock(pid) : null });
  if (pid) assignRun({ folder, project: pid });
  await refresh();
  if (!model || !(model.items || []).some((i) => i.folder === folder)) throw httpError(500, `Created .work/${folder}, but could not read it back. Refresh the page and click its Start step.`);
  const r = await runCommand({ folder, command: `/start ${id} ${lane}` }, { fresh: true });
  log(`local item ${id} (${folder}) started`);
  return { id, folder, session: r.session, project: pid || INBOX };
}

// ------------------------------------------------------------------ sessions with no work item

// Spikes and repo guides run in their own session, not tied to a work item. They are kept here so
// Dispatch can show them (and their questions and replies) until the person dismisses them.
export const loose = new Map(); // sid -> { command, at }
const LOOSE_KEEP_MS = 24 * 3600e3;
export function resetWorkspace() {
  loose.clear();
}
export function looseData() {
  const out = [];
  for (const [sid, e] of loose) {
    if (Date.now() - e.at > LOOSE_KEEP_MS) {
      loose.delete(sid);
      continue;
    }
    out.push({ session: sid, command: e.command, at: e.at });
  }
  return out;
}
export function dismissLoose({ session }) {
  loose.delete(session);
  broadcastLive();
  return { ok: true };
}

/** Runs /<name> <args> in a new session, listed in `others` until dismissed. Resolves {session}. */
export async function runLoose(name, args, find) {
  needOpencode();
  if (oc.commands.size && !oc.commands.has(name)) throw httpError(400, `opencode has no /${name} command. Run the Tandem install command again, then restart opencode.`);
  const command = `/${name} ${args}`.trim();
  const created = await oc.api.createSession(command.slice(0, 120));
  const sid = created.id;
  upsertSession(sid, { title: created.title, status: "busy", busySince: Date.now(), activity: `Starting /${name}`, error: null, text: null, command });
  loose.set(sid, { command, at: Date.now() });
  if (find) linkFrom(sid, find, command);
  broadcastLive();
  oc.api
    .runCommand(sid, name, args)
    .then((err) => {
      if (err) {
        upsertSession(sid, { status: "idle", activity: null, error: `/${name} failed: ${err}` });
        broadcastLive();
      }
    })
    .catch((e) => {
      upsertSession(sid, { error: `/${name}: ${e.message}` });
      broadcastLive();
    });
  log(`run ${command} in ${sid}`);
  return { session: sid };
}

/** /spike <topic>: an investigation with no code changes. Linked to its spike-<name> folder once it exists. */
export function startSpike({ topic }) {
  const t = String(topic || "").replace(/[\r\n]+/g, " ").trim();
  if (!t) throw httpError(400, "Say what to investigate.");
  if (t.length > 500) throw httpError(400, "Keep the question under 500 characters.");
  const before = new Set(spikeFolders());
  return runLoose("spike", t, () => spikeFolders().find((f) => !before.has(f)) || null);
}
const spikeFolders = () => ((model && model.items) || []).filter((i) => /^spike-/.test(i.folder)).map((i) => i.folder);

/**
 * The PR number in an Azure DevOps pull request link (.../_git/<repo>/pullrequest/<number>), and the link
 * without its query or hash. Null if it is not one.
 */
export function prFromUrl(url) {
  const u = String(url || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (u.length > 500 || /[\s"'`<>|&;$\\]/.test(u)) return null;
  const m = /^https?:\/\/[^/]+\/.+\/_git\/[^/]+\/pullrequest\/(\d{1,10})$/i.exec(u);
  return m ? { id: m[1], url: u } : null;
}

/**
 * /pr-review <link> [again]: a first-pass review of someone else's PR (eng-agents Core 2.6.0). It only
 * writes .work/pr-<id>/ and never posts. Linked to that folder once it exists; until then it is listed in
 * `others` so a failure (repo not cloned, ADO not set up) still shows.
 */
export function startReview({ url, again }) {
  const pr = prFromUrl(url);
  if (!pr) throw httpError(400, "Paste the pull request's link from Azure DevOps. It ends in /pullrequest/<number>.");
  const folder = `pr-${pr.id}`;
  const busy = (sid) => sid && sessions.get(sid) && sessions.get(sid).status !== "idle";
  const existing = folderForToken(folder);
  if (existing && busy(currentSession(existing))) throw httpError(409, `PR ${pr.id} is already being reviewed.`);
  for (const [sid, e] of loose) {
    if (busy(sid) && e.command.startsWith(`/pr-review ${pr.url}`)) throw httpError(409, `PR ${pr.id} is already being reviewed.`);
  }
  return runLoose("pr-review", again ? `${pr.url} again` : pr.url, () => folderForToken(folder));
}

/** /onboard-repo <folder>: draft the repo's guide (AGENTS.md) for the person to review. */
export function onboardRepo({ repo }) {
  const name = repoFolderName(repo);
  if (!fs.existsSync(path.join(opt.workspace, name, ".git"))) throw httpError(404, `${name} is not a git repo in the workspace.`);
  return runLoose("onboard-repo", name, null);
}

// ------------------------------------------------------------------ repos

function repoFolderName(name) {
  const n = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(n) || n.startsWith(".") || n.startsWith("-")) throw httpError(400, `"${n}" is not a valid repo folder name.`);
  return n;
}

/** The folder name a git URL clones to: its last path part without .git. Null if it is not a git URL. */
export function repoNameFromUrl(url) {
  const u = String(url || "").trim();
  if (!u || /\s/.test(u) || u.startsWith("-")) return null;
  const ok = /^https?:\/\/[^/]+\/.+/i.test(u) || /^ssh:\/\/[^/]+\/.+/i.test(u) || /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:.+/.test(u);
  if (!ok) return null;
  const last = u.replace(/[?#].*$/, "").replace(/\/+$/, "").split(/[/:]/).pop().replace(/\.git$/i, "");
  return /^[A-Za-z0-9._-]{1,100}$/.test(last) && !last.startsWith(".") && !last.startsWith("-") ? last : null;
}

function git(args, cwd) {
  return new Promise((resolve) => {
    let out = "";
    let p;
    try {
      // No terminal prompts (they would hang with no terminal). Credential helpers, such as Git Credential
      // Manager's sign-in window, still work.
      p = spawn("git", args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    } catch (e) {
      return resolve({ code: -1, out: e.message });
    }
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => resolve({ code: -1, out: e.code === "ENOENT" ? "git is not installed." : e.message }));
    p.on("close", (code) => resolve({ code, out: out.trim() }));
  });
}

const REPO_MAP_HEAD = `# Workspace repo map

Agents: use this file to choose repos for a work item. Match the work item to a repo by what each one is.

Started by Dispatch. Add detail as the workspace grows: products, a glossary, and how the repos depend on each other (the full template is company/repo-map.template.md in the eng-agents repo).
`;
const REPOS_SECTION = `## Repos

One row per repo folder in this workspace.

| Folder | What it is (one line) | Stack | Shared? |
|---|---|---|---|
`;

/**
 * Add a repo row to the workspace repo map (AGENTS.md), creating the map if there is none. A repo already
 * named in the Repos table is left alone. Returns "created", "added" or "listed".
 */
export function addToRepoMap(workspace, folder, about) {
  const file = path.join(workspace, "AGENTS.md");
  const what = String(about || "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim() || "TODO(you): what it is, in one line";
  const row = `| ${folder} | ${what} | | No |\n`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${REPO_MAP_HEAD}\n${REPOS_SECTION}${row}`);
    return "created";
  }
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Repos\s*$/i.test(l));
  if (start < 0) {
    fs.writeFileSync(file, `${text.replace(/\s*$/, "\n")}\n${REPOS_SECTION}${row}`);
    return "added";
  }
  // The table: the first run of lines starting with "|" after the heading.
  let i = start + 1;
  while (i < lines.length && !lines[i].startsWith("|") && !/^##\s/.test(lines[i])) i++;
  let last = -1;
  for (let j = i; j < lines.length && lines[j].startsWith("|"); j++) {
    last = j;
    const cell = lines[j].split("|")[1];
    if (cell && cell.trim().toLowerCase() === folder.toLowerCase()) return "listed";
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (last < 0) lines.splice(start + 1, 0, "", ...REPOS_SECTION.trim().split("\n").slice(2), row.trimEnd());
  else lines.splice(last + 1, 0, row.trimEnd());
  fs.writeFileSync(file, lines.join(eol));
  return "added";
}

/** Clone a repo into the workspace by its git URL and list it in the repo map. */
export async function addRepo({ url, about }) {
  const name = repoNameFromUrl(url);
  if (!name) throw httpError(400, "That does not look like a git URL. Copy the clone URL from the repo's page, for example https://github.com/owner/repo.git");
  const dest = path.join(opt.workspace, name);
  if (fs.existsSync(dest)) throw httpError(409, `There is already a ${name} folder in the workspace.`);
  const r = await git(["clone", "--", String(url).trim(), name], opt.workspace);
  if (r.code !== 0) {
    fs.rmSync(dest, { recursive: true, force: true });
    const auth = /authentication|could not read username|permission denied|403|401|terminal prompts disabled/i.test(r.out);
    const msg = r.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
    throw httpError(auth ? 403 : 502, auth
      ? `git could not sign in to clone ${name}. Sign in to your git host on this computer once (for example by cloning any private repo in a terminal, or with gh auth login for GitHub), then try again. git said: ${msg}`
      : `git could not clone ${name}: ${msg}`);
  }
  const map = addToRepoMap(opt.workspace, name, about);
  await refresh();
  log(`cloned ${name} into the workspace (repo map: ${map})`);
  return { folder: name, repoMap: map };
}

// ------------------------------------------------------------------ ADO

/** Is ADO set up for Tandem? True when its config.json lists at least one connection. */
export function adoConfigured() {
  const file = opt && opt.config ? opt.config : path.join(os.homedir(), ".config", "eng-agents", "config.json");
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (c && Array.isArray(c.connections)) return c.connections.length > 0;
    if (c && c.connections && typeof c.connections === "object") return Object.keys(c.connections).length > 0;
    return !!(c && (c.serverUrl || c.server));
  } catch {
    return false;
  }
}

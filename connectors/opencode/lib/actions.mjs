// opencode connector: the actions. Run a command, start an item, reply, answer prompts, push, abort,
// remove, open a terminal. Also the shell status data (the `status` action).
//
// Copied from eng-agents core/scripts/dashboard/server/actions.mjs. Changes: the status `version` is
// the connector's version; resetActions() for a restart. The rules (push protections, confirm on
// remove, one session per item) are unchanged.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APP, FRESH_SESSION, VERSION, httpError, isWin, log, opt, sameDir, workRoot } from "./context.mjs";
import { model, modelError, refresh, scheduleRefresh } from "./model.mjs";
import { currentSession, folderForSession, folderForToken, linkFrom, linkSession, links, saveLinks } from "./links.mjs";
import { oc, permissions, questions, sessions, upsertSession } from "./opencode-state.mjs";
import { autoActive, autoOnFail, autoOnReply, autopilot, saveAuto } from "./autopilot.mjs";
import { broadcastLive } from "./live.mjs";

export function parseCommand(text) {
  const m = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] || "").trim() };
}

export function findItem(folder) {
  return model && (model.items || []).find((i) => i.folder === folder);
}

function labelFor(item) {
  return item.id ? String(item.id) : item.folder;
}

export function needOpencode() {
  if (!oc.connected || !oc.api) throw httpError(503, oc.error || "opencode is not connected.");
}

// fresh: always use a new session (autopilot runs every step in one). fromAuto: autopilot is the caller.
export async function runCommand({ folder, command }, { fresh = false, fromAuto = false } = {}) {
  needOpencode();
  const item = findItem(folder);
  if (!item) throw httpError(404, `No work item folder "${folder}". Refresh the page.`);
  const cmd = parseCommand(command);
  if (!cmd) throw httpError(400, `Not a command: ${command}`);
  if (oc.commands.size && !oc.commands.has(cmd.name)) throw httpError(400, `opencode has no /${cmd.name} command. Re-run eng-agents install.ps1, then restart opencode.`);
  if (!fromAuto && autoActive(folder)) throw httpError(409, "Autopilot is running this item. Stop it first.");

  let sid = fresh || FRESH_SESSION.has(cmd.name) ? null : currentSession(folder);
  if (sid) {
    const s = sessions.get(sid);
    if (!s) sid = null; // deleted in opencode
    else if (s.status !== "idle") throw httpError(409, "This item's session is still working. Wait for it, or stop it first.");
  }
  if (!sid) {
    const created = await oc.api.createSession(`${labelFor(item)}: /${cmd.name}${cmd.args ? " " + cmd.args : ""}`);
    sid = created.id;
    upsertSession(sid, { title: created.title });
  }
  const full = `/${cmd.name} ${cmd.args}`.trim();
  linkSession(folder, sid, full);
  upsertSession(sid, { status: "busy", busySince: Date.now(), activity: `Starting /${cmd.name}`, error: null, text: null, command: full });
  broadcastLive();

  oc.api
    .runCommand(sid, cmd.name, cmd.args)
    .then((err) => {
      if (err) {
        upsertSession(sid, { status: "idle", activity: null, error: `/${cmd.name} failed: ${err}` });
        broadcastLive();
        autoOnFail(sid, `/${cmd.name} failed: ${err}`);
      }
    })
    .catch((e) => {
      upsertSession(sid, { error: `/${cmd.name}: ${e.message}` });
      broadcastLive();
      autoOnFail(sid, `/${cmd.name}: ${e.message}`);
    });
  log(`run ${full} (${folder}) in ${sid}`);
  return { session: sid };
}

// /start for a work item that has no .work folder yet (from a shell such as Prioritizer).
// The folder appears once /start creates it; the session is linked to it then.
export const starting = new Map(); // id -> { sid, at }, until its folder shows up (or 10 minutes pass)
const START_FORGET_MS = 10 * 60e3;
const pushing = new Set();
export function resetActions() {
  starting.clear();
  pushing.clear();
}
export async function startItem({ id, lane }) {
  needOpencode();
  const wid = String(id || "").trim();
  if (!/^\d{1,10}$/.test(wid)) throw httpError(400, "The work item id must be a number.");
  if (lane !== "feature" && lane !== "bug") throw httpError(400, 'Lane must be "feature" or "bug".');
  if (folderForToken(wid)) throw httpError(409, `Work item ${wid} is already started. Open the dashboard to continue it.`);
  const prev = starting.get(wid);
  if (prev && (sessions.get(prev.sid) || {}).status !== "idle") throw httpError(409, `Work item ${wid} is already starting.`);
  if (oc.commands.size && !oc.commands.has("start")) throw httpError(400, "opencode has no /start command. Re-run eng-agents install.ps1, then restart opencode.");

  const args = `${wid} ${lane}`;
  const created = await oc.api.createSession(`${wid}: /start ${args}`);
  const sid = created.id;
  starting.set(wid, { sid, at: Date.now() });
  upsertSession(sid, { title: created.title, status: "busy", busySince: Date.now(), activity: "Starting /start", error: null, text: null, command: `/start ${args}` });
  linkFrom(sid, () => folderForToken(wid), `/start ${args}`);
  broadcastLive();
  oc.api
    .runCommand(sid, "start", args)
    .then((err) => {
      if (err) {
        upsertSession(sid, { status: "idle", activity: null, error: `/start failed: ${err}` });
        broadcastLive();
      }
      scheduleRefresh(0);
    })
    .catch((e) => {
      upsertSession(sid, { error: `/start: ${e.message}` });
      broadcastLive();
    });
  log(`run /start ${args} in ${sid} (from the shell)`);
  return { session: sid };
}

// The next step in plain words, the way the dashboard page says it ("Task 3: Update invoice totals").
// The next step in plain words. New-Dashboard.ps1 words it (next.text, stepWords); this only adds paused.
function stepText(it) {
  const n = it.next || {};
  if (it.paused) return (model && model.stepWords && model.stepWords.resume) || "Resume this item";
  return n.text || n.action || n.command || null;
}

// Version of the shell API contract in docs/shell-api.md.
export const SHELL_API = 1;

// What a shell needs to badge its tasks: one row per numbered work item, plus /start in progress.
export function shellData() {
  const items = [];
  for (const it of (model && model.items) || []) {
    if (it.kind !== "item" || !it.id) continue;
    const sid = currentSession(it.folder);
    const s = sid ? sessions.get(sid) : null;
    items.push({
      id: String(it.id),
      title: it.title,
      lane: it.lane,
      stage: it.stage,
      bucket: it.bucket,
      next: it.next ? { command: it.next.command || null, action: it.next.action || null, text: stepText(it), needsYou: !!it.next.needsYou } : null,
      tasks: it.tasks ? { done: it.tasks.done || 0, total: it.tasks.total || 0 } : null,
      paused: !!it.paused,
      blocked: !!it.blocked,
      agent: s ? s.status : null,
      waiting: !!s && ([...permissions.values()].some((p) => p.sessionID === sid) || [...questions.values()].some((q) => q.sessionID === sid)),
      autopilot: autopilot[it.folder] && ["running", "waiting"].includes(autopilot[it.folder].status)
        ? { status: autopilot[it.folder].status, message: autopilot[it.folder].message || null } : null,
    });
  }
  // Started from the shell, folder not there yet: /start is running, waiting on the engineer (it asks
  // when it cannot fetch the item), or done and the next refresh will pick the folder up.
  const pending = [];
  for (const [wid, st] of starting) {
    const s = sessions.get(st.sid);
    if (folderForToken(wid) || !s || Date.now() - st.at > START_FORGET_MS) {
      starting.delete(wid);
      continue;
    }
    const waiting = [...permissions.values()].some((p) => p.sessionID === st.sid) || [...questions.values()].some((q) => q.sessionID === st.sid);
    pending.push({ id: wid, agent: s.status, waiting, error: s.error || null });
  }
  return {
    app: APP,
    api: SHELL_API, // bump on a breaking change to this shape (docs/shell-api.md)
    version: VERSION,
    workspace: path.basename(opt.workspace),
    opencode: { connected: oc.connected, error: oc.error },
    error: modelError,
    items,
    starting: pending,
  };
}

export async function reply({ session, text }) {
  needOpencode();
  if (!sessions.has(session)) throw httpError(404, "Unknown session.");
  const t = String(text || "").trim();
  if (!t) throw httpError(400, "Type a reply first.");
  if (t.startsWith("/")) {
    const folder = folderForSession(session);
    if (folder) return runCommand({ folder, command: t });
  }
  await oc.api.prompt(session, t);
  upsertSession(session, { status: "busy", busySince: Date.now(), activity: "Reading your reply", error: null, text: null });
  autoOnReply(session);
  broadcastLive();
  return { ok: true };
}

export async function answerPermission({ id, reply: answer }) {
  needOpencode();
  const p = permissions.get(id);
  if (!p) throw httpError(404, "That prompt was already answered.");
  if (!["once", "always", "reject"].includes(answer)) throw httpError(400, "Bad answer.");
  await oc.api.replyPermission(p, answer);
  permissions.delete(id);
  broadcastLive();
  return { ok: true };
}

export async function answerQuestion({ id, answers, reject }) {
  needOpencode();
  const q = questions.get(id);
  if (!q) throw httpError(404, "That question was already answered.");
  if (reject) await oc.api.rejectQuestion(q);
  else {
    if (!Array.isArray(answers)) throw httpError(400, "Bad answer.");
    await oc.api.replyQuestion(q, answers);
  }
  questions.delete(id);
  broadcastLive();
  return { ok: true };
}

// Push one branch from the PR panel: `git -C <repo> push -u origin <branch>`, run here, not by the
// agent. The engineer's click is the approval that the agent's `git push` would ask for. Only the
// branch named in pr.md for that repo, never the target or default branch, never --force.
function gitRun(cwd, args, timeout) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }; // fail instead of waiting on a hidden prompt
    const p = spawn("git", args, { cwd, env, windowsHide: true });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { p.kill(); } catch { }
      resolve({ code: null, out: out + "\nTimed out." });
    }, timeout);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: null, out: e.code === "ENOENT" ? "git is not on PATH." : e.message });
    });
    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

export async function pushBranch({ folder, repo }) {
  const it = findItem(folder);
  if (!it) throw httpError(404, `No work item folder "${folder}". Refresh the page.`);
  const row = (it.pr || []).find((p) => p.repo === repo);
  if (!row) throw httpError(404, `pr.md has no section for ${repo}. Refresh the page.`);
  const branch = row.branch;
  if (!branch) throw httpError(400, `pr.md names no branch for ${repo}.`);
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) throw httpError(400, `"${branch}" is not a branch name the dashboard will push.`);
  const protectedNames = new Set(["main", "master", "develop", "dev", String(row.target || "").toLowerCase()]);
  if (protectedNames.has(branch.toLowerCase())) throw httpError(400, `The dashboard does not push ${branch}. Push it yourself if you mean to.`);
  const ws = path.resolve(opt.workspace);
  const dir = path.resolve(ws, String(repo || ""));
  if (!repo || path.isAbsolute(repo) || String(repo).split(/[\\/]/).includes("..") || !dir.startsWith(ws + path.sep)) throw httpError(400, "Bad repo folder.");
  if (!fs.existsSync(dir)) throw httpError(404, `Repo folder ${repo} not found in the workspace.`);

  const key = `${repo}\n${branch}`;
  if (pushing.has(key)) throw httpError(409, `Already pushing ${branch} in ${repo}.`);
  pushing.add(key);
  try {
    const ref = await gitRun(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], 15000);
    if (ref.code !== 0) throw httpError(400, `${repo} has no local branch ${branch}.`);
    log(`push: git -C ${repo} push -u origin ${branch}`);
    const r = await gitRun(dir, ["push", "-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`], 180000);
    const tail = r.out.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(" | ");
    if (r.code !== 0) {
      log(`push failed (${repo} ${branch}): ${r.out.trim()}`);
      throw httpError(502, `Push failed for ${repo}: ${tail || "no output from git"}`);
    }
    log(`pushed ${repo} ${branch}`);
    return { ok: true, message: `Pushed ${branch} in ${repo}.` };
  } finally {
    pushing.delete(key);
    scheduleRefresh(0);
  }
}

export async function abort({ session }) {
  needOpencode();
  await oc.api.abort(session);
  return { ok: true };
}

// Abandon an item, or clean one up after its PRs merge: deletes .work/<folder> and the dashboard's
// links and autopilot state for it. The page asks first; `confirm` must be the item id (or the folder
// name for spikes, docs, and TSDs) typed by the engineer. Repos, branches, and opencode sessions are
// left alone.
export async function removeItem({ folder, confirm }) {
  const it = findItem(folder);
  if (!it) throw httpError(404, `No work item folder "${folder}". Refresh the page.`);
  const expected = it.id ? String(it.id) : it.folder;
  if (String(confirm || "").trim() !== expected) throw httpError(400, `Type ${expected} to confirm.`);
  if (autoActive(folder)) throw httpError(409, "Autopilot is running this item. Stop it first.");
  const s = sessions.get(currentSession(folder));
  if (s && s.status !== "idle") throw httpError(409, "This item's agent is still working. Stop it first.");

  // Only a real folder directly inside .work, never _dashboard or a hidden one, never through a link.
  if (!/^[^\\/:*?"<>|]+$/.test(folder) || folder.startsWith(".") || folder.startsWith("_") || folder.includes("..")) throw httpError(400, "Bad folder name.");
  const full = path.join(workRoot, folder);
  if (!sameDir(path.dirname(full), workRoot)) throw httpError(400, "Bad folder name.");
  let st;
  try {
    st = fs.lstatSync(full);
  } catch {
    scheduleRefresh(0);
    throw httpError(404, `.work/${folder} is already gone.`);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw httpError(400, `.work/${folder} is not a plain folder. Delete it yourself.`);

  try {
    fs.rmSync(full, { recursive: true, force: false, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    scheduleRefresh(0);
    throw httpError(500, `Could not delete .work/${folder}: ${e.code || e.message}. Close any editor or terminal using a file in it, then try again.`);
  }
  if (links[folder]) {
    delete links[folder];
    saveLinks();
  }
  if (autopilot[folder]) {
    delete autopilot[folder];
    saveAuto();
  }
  log(`removed .work/${folder}`);
  await refresh();
  broadcastLive();
  return { ok: true, removed: folder };
}

export function attachCommand(session) {
  return oc.api ? oc.api.attachCommand(session) : null;
}

// Opens a terminal window with the opencode TUI on a session (Windows and macOS).
export function openTerminal({ session }) {
  needOpencode();
  if (session && !/^ses_[A-Za-z0-9]+$/.test(session)) throw httpError(400, "Bad session id.");
  const tui = [opt.opencodeCmd, ...oc.api.terminalArgs(session)].join(" ");
  if (isWin) {
    const ws = opt.workspace.replace(/'/g, "''");
    const inner = tui.replace(/'/g, "''");
    const script = `Start-Process -FilePath powershell.exe -WorkingDirectory '${ws}' -ArgumentList @('-NoExit','-Command','${inner}')`;
    const enc = Buffer.from(script, "utf16le").toString("base64");
    spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", enc], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return { ok: true };
  }
  if (process.platform === "darwin") {
    const sh = `cd '${opt.workspace.replace(/'/g, "'\\''")}' && ${tui}`;
    const as = `tell application "Terminal" to do script "${sh.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\ntell application "Terminal" to activate`;
    spawn("osascript", ["-e", as], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  }
  throw httpError(501, "Opening a terminal is only supported on Windows and macOS. Copy the command instead.");
}

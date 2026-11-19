// opencode connector: Try it (1.27.0, Workshop project doc claude/build-self-check-v1-plan.md, eng-agents Core 4.15.0).
//
// A build keeps its app running while Tandem checks each task's pages (eng-agents scripts/ui/Start-UiApp.ps1, the
// record in .work/<item>/ui/app.json). Try it opens that app for you: the connector asks opencode to run
// Start-UiApp.ps1 in a session of its own (opencode's shell API, so Workshop's agent still starts no program), waits
// for app.json and the address to answer, and Loom opens it in a new tab. Stop runs Stop-UiApp.ps1 the same way.
// An app nothing has opened or built with for 30 minutes is stopped on its own.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { httpError, log, opt, workRoot } from "./context.mjs";
import { oc, sessions, upsertSession } from "./opencode-state.mjs";
import { autopilot } from "./autopilot.mjs";
import { broadcastLive } from "./live.mjs";

export const IDLE_MS = 30 * 60 * 1000;
const WAIT_MS = 200 * 1000; // Start-UiApp.ps1 waits up to 180 seconds for the app
const previews = new Map(); // folder -> { status: starting | running | failed, url, message, at, opened }
let shellSession = null;
let timer = null;

/** Where Tandem's UI scripts are installed (eng-agents install.ps1: ~/.config/opencode/eng-agents/scripts/ui). */
export function uiScripts(home = os.homedir()) {
  return path.join(home, ".config", "opencode", "eng-agents", "scripts", "ui");
}

const quote = (s) => `"${String(s).replace(/"/g, "")}"`;
const ps = () => (process.platform === "win32" ? "powershell" : "pwsh");

/** The command that runs one of the UI scripts with its arguments. */
export function scriptCommand(script, args, { home, exe } = {}) {
  const parts = [exe || ps(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", quote(path.join(uiScripts(home), script))];
  for (const [k, v] of Object.entries(args)) parts.push(`-${k}`, quote(v));
  return parts.join(" ");
}

/** The repo a build's app runs from: its worktree Path when it has one, the repo guide from the repo folder. */
export function appRepo(it, repo) {
  const rows = (it && it.repos) || [];
  const row = (repo && rows.find((r) => r.folder === repo)) || rows[0];
  if (!row || !opt || !opt.workspace) return null;
  const ws = path.resolve(opt.workspace);
  const dir = path.resolve(ws, row.path || row.folder);
  const repoDir = path.resolve(ws, row.folder);
  if (!dir.startsWith(ws + path.sep) || !repoDir.startsWith(ws + path.sep)) return null;
  const local = path.join(repoDir, "AGENTS.local.md");
  return { repo: row.folder, dir, guide: fs.existsSync(local) ? local : path.join(repoDir, "AGENTS.md") };
}

function readApp(folder) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(workRoot, folder, "ui", "app.json"), "utf8"));
    return a && typeof a.url === "string" && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(a.url) ? a : null;
  } catch {
    return null;
  }
}

async function up(url) {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function runShell(command, title) {
  if (!oc.connected || !oc.api) throw httpError(503, oc.error || "opencode is not connected.");
  if (!oc.api.shell) throw httpError(501, "This opencode cannot run shell commands, so Try it cannot start the app.");
  const s = shellSession ? sessions.get(shellSession) : null;
  if (!s) {
    const created = await oc.api.createSession(title);
    shellSession = created.id;
    upsertSession(shellSession, { title: created.title });
  }
  upsertSession(shellSession, { status: "busy", busySince: Date.now(), activity: title, error: null });
  await oc.api.shell(shellSession, { command });
  return shellSession;
}

/** For `state`: each item's Try it: {"<folder>": {status, url, message, at}}, plus apps already running (app.json). */
export function previewData(items) {
  const out = {};
  for (const it of items || []) {
    if (it.kind !== "item") continue;
    const p = previews.get(it.folder);
    const a = readApp(it.folder);
    if (p) out[it.folder] = { status: p.status === "starting" || p.status === "failed" ? p.status : a ? "running" : "stopped", url: (a && a.url) || p.url || null, message: p.message || null, at: p.at };
    else if (a) out[it.folder] = { status: "running", url: a.url, message: null, at: a.started || null };
  }
  return out;
}

/** `preview.open`: start (or reuse) the build's app and say its address. Loom polls state for it. */
export async function openPreview({ folder, repo }, findItem) {
  const it = findItem(folder);
  if (!it || it.kind !== "item") throw httpError(404, "No such work item. Refresh the page.");
  const now = Date.now();
  const a = readApp(folder);
  if (a && (await up(a.url))) {
    previews.set(folder, { status: "running", url: a.url, message: null, at: new Date().toISOString(), opened: now });
    broadcastLive();
    return { ok: true, status: "running", url: a.url };
  }
  const r = appRepo(it, repo);
  if (!r) throw httpError(409, "This item has no repo to start an app from.");
  const was = previews.get(folder);
  if (was && was.status === "starting" && now - was.started < WAIT_MS) return { ok: true, status: "starting" };
  const cmd = scriptCommand("Start-UiApp.ps1", { WorkFolder: path.join(workRoot, folder), Repo: r.dir, Guide: r.guide });
  previews.set(folder, { status: "starting", url: null, message: null, at: new Date().toISOString(), started: now, opened: now });
  broadcastLive();
  try {
    await runShell(cmd, `Try it: ${it.id || folder}`);
  } catch (e) {
    previews.set(folder, { status: "failed", url: null, message: e.message, at: new Date().toISOString(), opened: now });
    broadcastLive();
    throw e;
  }
  watch();
  return { ok: true, status: "starting" };
}

/** `preview.stop`: stop the build's app (Stop-UiApp.ps1). */
export async function stopPreview({ folder }, findItem) {
  const it = findItem(folder);
  if (!it || it.kind !== "item") throw httpError(404, "No such work item. Refresh the page.");
  previews.delete(folder);
  if (!readApp(folder)) { broadcastLive(); return { ok: true, stopped: false }; }
  await runShell(scriptCommand("Stop-UiApp.ps1", { WorkFolder: path.join(workRoot, folder) }), `Stop the app: ${it.id || folder}`);
  broadcastLive();
  return { ok: true, stopped: true };
}

// While an app is starting: watch for app.json and its address, every second, up to WAIT_MS.
function watch() {
  if (timer) return;
  timer = setInterval(async () => {
    const starting = [...previews.entries()].filter(([, p]) => p.status === "starting");
    if (!starting.length) { clearInterval(timer); timer = null; return; }
    for (const [folder, p] of starting) {
      const a = readApp(folder);
      if (a && (await up(a.url))) {
        previews.set(folder, { ...p, status: "running", url: a.url, at: new Date().toISOString() });
        broadcastLive();
      } else if (Date.now() - p.started > WAIT_MS) {
        previews.set(folder, { ...p, status: "failed", message: "The app did not start. Its UI checks table may be missing, or the app needs something it cannot get on this computer (see ui/app.log in the work folder).", at: new Date().toISOString() });
        broadcastLive();
      }
    }
  }, 1000);
  if (timer.unref) timer.unref();
}

/** Every few minutes: stop apps nothing has built with or opened for IDLE_MS. Returns the folders stopped. */
export async function sweepIdle(items, { now = Date.now() } = {}) {
  const stopped = [];
  for (const it of items || []) {
    if (it.kind !== "item") continue;
    const a = readApp(it.folder);
    if (!a || a.ours === false) continue;
    const auto = autopilot[it.folder];
    if (auto && (auto.status === "running" || auto.status === "queued")) continue;
    const p = previews.get(it.folder);
    const last = Math.max(Date.parse(a.started || "") || 0, (p && p.opened) || 0);
    if (now - last < IDLE_MS) continue;
    try {
      await runShell(scriptCommand("Stop-UiApp.ps1", { WorkFolder: path.join(workRoot, it.folder) }), `Stop the app: ${it.id || it.folder}`);
      previews.delete(it.folder);
      stopped.push(it.folder);
    } catch (e) {
      log(`preview: could not stop ${it.folder}: ${e.message}`);
      break; // opencode is not there: try again next time
    }
  }
  if (stopped.length) broadcastLive();
  return stopped;
}

/** On stop or restart. */
export function resetPreviews() {
  previews.clear();
  shellSession = null;
  if (timer) clearInterval(timer);
  timer = null;
}

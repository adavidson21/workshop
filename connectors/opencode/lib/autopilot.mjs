// eng-agents live dashboard: Autopilot: runs approve, tasks, do-task, review and pr in order, each in a new session, and stops when it needs the engineer.

import fs from "node:fs";
import path from "node:path";
import { httpError, log, stateDir } from "./context.mjs";
import { model, runModel, setModel } from "./model.mjs";
import { currentSession, linkSessionsFromModel } from "./links.mjs";
import { sessions } from "./opencode-state.mjs";
import { findItem, needOpencode, parseCommand, runCommand } from "./actions.mjs";
import { broadcast, broadcastLive, pageData } from "./live.mjs";

//
// Runs the build half of the pipeline for one work item without you switching sessions:
//   (/approve <id> plan|bug) -> /tasks -> /do-task <id> <n> for each open task -> /review <id> auto -> /pr
// Every step runs in a new session, and the next step comes from the same Get-NextStep rules
// as the page, read fresh from disk after each step. It never pushes.
//
// It stops and waits for you when:
//   - the next step needs you (a draft to approve, a blocked task, review findings it cannot turn into tasks)
//   - a step ends without moving the item forward (for example the agent asked you something in its reply)
//   - a step fails or you press Stop on the agent
//   - the review still is not READY after MAX_FIX_ROUNDS rounds of fix tasks
// Permission prompts and agent questions do not stop it: the step waits for your answer on the page.
// Replying to the agent in a waiting step's session resumes it.

const autoFile = path.join(stateDir, "autopilot.json");
const AUTO_STEPS = new Set(["approve", "tasks", "do-task", "review", "pr"]);
const MAX_FIX_ROUNDS = 2;

// { "<folder>": { status, message, command, lastCommand, session, inFlight, sawBusy,
//                 approveFirst, fixRounds, started, updated, log: [{ at, text }] } }
// status: "running" | "waiting" (needs you) | "done" | "stopped"
export let autopilot = {};
try {
  autopilot = JSON.parse(fs.readFileSync(autoFile, "utf8")) || {};
} catch {
  autopilot = {};
}
for (const a of Object.values(autopilot)) {
  if (a.status === "running") {
    a.status = "waiting";
    a.inFlight = false;
    a.message = "The dashboard restarted. Click Resume to carry on.";
  }
}
try {
  if (Object.keys(autopilot).length) saveAuto();
} catch {}

export function saveAuto() {
  const tmp = autoFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(autopilot, null, 2));
  fs.renameSync(tmp, autoFile);
}

export function autoActive(folder) {
  const a = autopilot[folder];
  return !!a && a.status === "running";
}

function autoLog(folder, text) {
  const a = autopilot[folder];
  if (!a) return;
  a.updated = new Date().toISOString();
  a.log = (a.log || []).concat({ at: a.updated, text }).slice(-30);
  log(`autopilot ${folder}: ${text}`);
}

function autoSet(folder, status, message) {
  const a = autopilot[folder];
  if (!a) return;
  a.status = status;
  a.message = message || null;
  a.inFlight = false;
  autoLog(folder, message || status);
  saveAuto();
  broadcastLive();
}

// Why the item needs you, in one line, from the page's own next step.
function needsYouText(it) {
  const n = it.next || {};
  if (it.blocked) return `Task blocked: ${it.blocked}`;
  if (n.stage === "review") return "The review is not READY and there are no fix tasks to run. Read review.md, add fix tasks or fix it yourself, then click Resume.";
  if (n.action) return `${n.action}${n.command ? ` (${n.command})` : ""}. Then click Resume.`;
  return "The next step needs you. Then click Resume.";
}

const stepping = new Set();
// finished: called because the step autopilot started just ended (not a start or resume).
async function autoStep(folder, finished = false) {
  const a = autopilot[folder];
  if (!a || a.status !== "running" || a.inFlight || stepping.has(folder)) return;
  stepping.add(folder);
  try {
    // Fresh read of .work, not the debounced one: the step that just ended may have written files.
    const r = await runModel();
    if (r.error) return autoSet(folder, "waiting", `Could not read .work: ${r.error}`);
    setModel(r.data);
    linkSessionsFromModel();
    broadcast("model", pageData());

    const it = findItem(folder);
    if (!it || it.kind !== "item") return autoSet(folder, "stopped", "The work item folder is gone.");
    if (it.paused) return autoSet(folder, "waiting", `The item is paused. Run /resume ${it.id}, then click Resume.`);

    // How did the last step end?
    const last = a.session ? sessions.get(a.session) : null;
    if (finished && last && last.error) return autoSet(folder, "waiting", `${a.command} stopped: ${last.error}`);
    // A review that turned Blockers into fix tasks starts a fix round.
    if (finished && a.command && /^\/review\b.*\sauto$/.test(a.command) && it.gates.review && it.gates.review !== "READY") a.fixRounds = (a.fixRounds || 0) + 1;

    const n = it.next || {};
    if (n.stage === "ship") return autoSet(folder, "done", "PR text is ready in pr.md. Push the branches and open the PRs.");

    let cmd = n.command;
    const approving = cmd && /^\/approve\b/.test(cmd) && (n.stage === "plan" || n.stage === "bug");
    if (approving && a.approveFirst) cmd = `/approve ${it.id} ${n.stage}`;
    else if (n.needsYou || !cmd) return autoSet(folder, "waiting", needsYouText(it));

    const parsed = parseCommand(cmd);
    if (!parsed || !AUTO_STEPS.has(parsed.name)) return autoSet(folder, "waiting", `Next is ${cmd}, which autopilot does not run. Run it yourself, then click Resume.`);

    // The same step again means the last run did not move the item forward.
    if (cmd === a.lastCommand) {
      const said = finished && last && last.text ? ` The agent said: "${String(last.text).trim().split(/\r?\n/).slice(-1)[0].slice(0, 200)}"` : "";
      return autoSet(folder, "waiting", `${cmd} ended without finishing. Reply to the agent, or fix it yourself, then click Resume.${said}`);
    }

    let full = cmd;
    if (parsed.name === "review") {
      if ((a.fixRounds || 0) >= MAX_FIX_ROUNDS) autoLog(folder, `${MAX_FIX_ROUNDS} fix rounds done. This review will ask you which findings to fix.`);
      else full = `${cmd} auto`;
    }

    a.lastCommand = cmd;
    a.command = full;
    a.inFlight = true;
    a.sawBusy = false;
    if (approving) a.approveFirst = false;
    const run = await runCommand({ folder, command: full }, { fresh: true, fromAuto: true });
    a.session = run.session;
    autoLog(folder, `Running ${full}`);
    saveAuto();
    broadcastLive();
  } catch (e) {
    autoSet(folder, "waiting", `Could not start the next step: ${e.message}`);
  } finally {
    stepping.delete(folder);
  }
}

function autoForSession(sid) {
  for (const [folder, a] of Object.entries(autopilot)) if (a.session === sid) return [folder, a];
  return [null, null];
}

export function autoOnBusy(sid) {
  const [, a] = autoForSession(sid);
  if (a && a.inFlight) a.sawBusy = true;
}

export function autoOnIdle(sid) {
  const [folder, a] = autoForSession(sid);
  if (!a || a.status !== "running" || !a.inFlight || !a.sawBusy) return;
  a.inFlight = false;
  saveAuto();
  // Give the agent's last file writes and the error event (opencode 1.x) a moment to land.
  setTimeout(() => autoStep(folder, true), 1500);
}

export function autoOnFail(sid, msg) {
  const [folder, a] = autoForSession(sid);
  if (a && a.status === "running") autoSet(folder, "waiting", msg);
}

// You answered the agent in the step it stopped on: pick up again when that turn ends.
export function autoOnReply(sid) {
  const [folder, a] = autoForSession(sid);
  if (!a || a.status !== "waiting") return;
  a.status = "running";
  a.message = null;
  a.inFlight = true;
  a.sawBusy = false;
  autoLog(folder, "Resumed by your reply");
  saveAuto();
}

export async function autopilotAction({ folder, action }) {
  const it = findItem(folder);
  if (!it || it.kind !== "item") throw httpError(404, `No work item folder "${folder}". Refresh the page.`);
  const a = autopilot[folder];

  if (action === "stop") {
    if (!a) return { ok: true };
    autoSet(folder, "stopped", a.inFlight ? `Stopped. ${a.command} finishes on its own; nothing runs after it.` : "Stopped.");
    return { ok: true };
  }
  if (action === "dismiss") {
    delete autopilot[folder];
    saveAuto();
    broadcastLive();
    return { ok: true };
  }
  if (!["start", "approve-start", "resume"].includes(action)) throw httpError(400, "Bad action.");

  needOpencode();
  if (a && a.status === "running") throw httpError(409, "Autopilot is already running this item.");
  if (it.paused) throw httpError(409, `The item is paused. Run /resume ${it.id} first.`);
  const s = sessions.get(currentSession(folder));
  if (s && s.status !== "idle") throw httpError(409, "This item's agent is still working. Wait for it, or stop it first.");

  const gate = it.lane === "bug" ? it.gates.bug : it.gates.plan;
  const n = it.next || {};
  const canApprove = n.command && /^\/approve\b/.test(n.command) && (n.stage === "plan" || n.stage === "bug");
  if (action === "approve-start" && !canApprove) throw httpError(409, "There is no plan or bug analysis waiting for approval.");
  const pendingApprove = action === "resume" && a && a.approveFirst && canApprove;
  if (action !== "approve-start" && !pendingApprove && gate !== "APPROVED") {
    throw httpError(409, `Autopilot starts after ${it.lane === "bug" ? "bug.md" : "plan.md"} is approved.`);
  }

  if (action === "resume" && a) {
    a.status = "running";
    a.message = null;
    a.lastCommand = null; // you fixed something: allow the same step once more
    a.inFlight = false;
    autoLog(folder, "Resumed");
  } else {
    autopilot[folder] = { status: "running", message: null, command: null, lastCommand: null, session: null, inFlight: false, sawBusy: false, approveFirst: action === "approve-start", fixRounds: 0, started: new Date().toISOString(), log: [] };
    autoLog(folder, action === "approve-start" ? "Started: approve, then build" : "Started");
  }
  saveAuto();
  broadcastLive();
  await autoStep(folder);
  const now = autopilot[folder];
  if (now && now.status === "waiting") throw httpError(409, now.message);
  return { ok: true };
}

export function autoData() {
  const out = {};
  for (const [folder, a] of Object.entries(autopilot)) {
    out[folder] = { status: a.status, message: a.message, command: a.command, session: a.session, fixRounds: a.fixRounds || 0, maxFixRounds: MAX_FIX_ROUNDS, started: a.started, updated: a.updated, log: (a.log || []).slice(-8) };
  }
  return out;
}

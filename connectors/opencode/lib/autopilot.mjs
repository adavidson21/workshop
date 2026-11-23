// opencode connector: autopilot. Runs approve, tasks, do-task, review and pr in order, each in a new
// session, and stops when it needs the engineer.
//
// Copied from eng-agents core/scripts/dashboard/server/autopilot.mjs (gone from eng-agents since Core 2.11.0; this is the only copy). Changes: autopilot.json is read by
// loadAuto() on each start; status changes also send an `autopilot` event. The rules are unchanged.

import fs from "node:fs";
import path from "node:path";
import { current, httpError, later, log, opt, running, stateDir, workRoot } from "./context.mjs";
import { runModel, setModel } from "./model.mjs";
import { currentSession, linkSessionsFromModel } from "./links.mjs";
import { oc, permissions, questions, sessions } from "./opencode-state.mjs";
import { findItem, needOpencode, parseCommand, runCommand } from "./actions.mjs";
import { broadcastLive, emitAutopilot, emitModel } from "./live.mjs";
import { projectOf, projectOrder } from "./projects.mjs";
import { holdingGap } from "./gaps.mjs";

//
// Runs the build half of the pipeline for one work item without you switching sessions:
//   (/approve <id> plan|bug|quick) -> /tasks (kept as is when /spec drafted it) -> /do-task <id> <n> for each open task -> /review <id> auto -> /pr
// With eng-agents Core 4.0.0's one feature gate, /approve <id> plan approves the draft spec with the plan.
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
//
// 1.20.0 (eng-agents Core 4.8.0):
//   - Parallel builds: at most opt.autoMaxRuns (default 2, cap 3) run at once. Starting one more queues it
//     (status "queued"); the oldest queued build starts when a running one stops running.
//   - Hands-off Quick changes (opt.quickHandsOff, review by exception): a quick-lane item can start before its
//     plan exists. Autopilot runs /quick <id> auto, then /approve <id> quick auto, which approves quick.md only
//     when it is clean and otherwise leaves it, so autopilot waits for you like any other gate.
//
// 1.21.0 (software factory, eng-agents Core 4.9.0):
//   - Up to 5 builds at once. With opt.fairSlots (default on), a free slot goes first to a queued build whose
//     project has nothing running, then by project order, then oldest first.
//   - A build may wait for another one (`after`, chosen at approval when both change the same files): it stays
//     queued until that item's PR text is ready.
//   - A step that ends without moving the item forward gets one more try in a fresh session before it waits.
//   - A step that stopped on a knowledge gap with no safe assumption waits on that gap; answering it (gap.answer)
//     resumes the build.
//   - A restart keeps queued and running builds queued; they start again once opencode is connected.
//   - Review rounds come from the factory settings.
//
// 1.28.0 (eng-agents Core 4.15.0, Workshop project docs claude/publish-review-v1-plan.md and claude/after-publish-v1-plan.md):
//   - A build can start with one command of Workshop's own before the usual steps (`pending`, startPending): /revise
//     after a Send back from the code review, /pr-fix after Publish. Then the next-step rules carry on as always
//     (the fix tasks, a review round, the PR text) until the item is ready to publish again.
//   - /revise that wrote `Status: HOLD` in revise.md waits for you with its Needs you lines.
//   - onAutoChange(fn) hears every status change (the code review follows a Send back with it).
//
// 1.34.0 (hardening for long hands-off runs on a local model):
//   - A step that fails on a model or connection error (the model server restarted, a VPN blip) runs again on its
//     own, up to MODEL_RETRIES times, 1 and then 5 minutes later, before it waits for you.
//   - A watchdog (autoWatch, every 30 seconds): a step with no word from opencode for the stall time (autopilot
//     stallMinutes, default 30) is stopped and handled like a model error; a step whose session went idle while
//     Workshop missed it (the event stream reconnected) moves on; a step whose session is gone waits with why.
//     A step waiting on your permission prompt or question is never a stall.
//   - After a restart, a step still running in opencode is waited for instead of started again beside it, and a
//     step cut off by Workshop stopping is not a failure: the build resumes when Workshop starts again.
//   - Resume after a failed Approve and build approves the plan again, instead of refusing.

const autoFile = () => path.join(stateDir, "autopilot.json");
const AUTO_STEPS = new Set(["quick", "approve", "tasks", "do-task", "review", "pr"]);
// 1.23.0 (eng-agents Core 4.10.0): a story from an approved breakdown, or a product's trial run, also starts and specs
// on its own (/start <id> <lane> auto, /spec <id> auto), and a story's plan is approved with /approve <id> spec auto,
// which holds it for you only when it drifts from the breakdown.
const HANDS_OFF_STEPS = new Set(["start", "spec"]);
const isStory = (it) => !!(it && it.story && it.story.breakdown);
// A trial run, or a product's backfilled regression tests (/cover, Core 4.14.0): a quick change built hands-off.
const isQuickRun = (it) => !!(it && (it.trial || it.coverage));
const isHandsOff = (it) => isStory(it) || isQuickRun(it);
// Review rounds before a not-READY review waits for you: the factory's reviewRounds (default 2).
const maxFixRounds = () => (opt && opt.factory && opt.factory.reviewRounds) || 2;
// Model or connection errors: tries of the same step before it waits for you, and the wait before each.
export const MODEL_RETRIES = 2;
// The waits, and how long an unnoticed idle may last; tests shorten them.
export const autoTiming = { retryDelays: [60e3, 5 * 60e3], missedIdleMs: 20e3 };
// No word from opencode on a step for this long (and no prompt waiting on you): a stall.
const stallMs = () => Math.max(5, (opt && opt.autoStallMinutes) || 30) * 60e3;
// Errors that are not worth a retry: you stopped it, or the command itself is wrong.
// ("connection refused" is not here: a model server that is down is the main case to retry.)
const NO_RETRY = /^Stopped\.?$|has no \/|not found|context window|Not a command/i;
const clock = (ms) => new Date(Date.now() + ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// { "<folder>": { status, message, command, lastCommand, session, inFlight, sawBusy,
//                 approveFirst, fixRounds, started, updated, log: [{ at, text }] } }
// status: "running" | "queued" (waits for a free slot) | "waiting" (needs you) | "done" | "stopped"
export let autopilot = {};
export function loadAuto() {
  stepping.clear();
  try {
    autopilot = JSON.parse(fs.readFileSync(autoFile(), "utf8")) || {};
  } catch {
    autopilot = {};
  }
  // A restart keeps builds going: running and queued ones are queued again and start once opencode is
  // connected (resumeQueued), oldest first.
  for (const a of Object.values(autopilot)) {
    if (a.status === "queued" || a.status === "running") {
      if (a.status === "running") a.queued = a.started || new Date().toISOString();
      a.status = "queued";
      a.inFlight = false;
      a.lastCommand = null;
      a.message = "Workshop restarted the opencode connector. It carries on when opencode is connected.";
      a.restarted = true;
    }
  }
  try {
    if (Object.keys(autopilot).length) saveAuto();
  } catch {}
}

export function saveAuto() {
  const tmp = autoFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(autopilot, null, 2));
  fs.renameSync(tmp, autoFile());
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

/** The settings Loom needs: hands-off Quick changes and the parallel limit. */
export function autoOptions() {
  return { maxRuns: (opt && opt.autoMaxRuns) || 2, quickHandsOff: !opt || opt.quickHandsOff !== false, fairSlots: !opt || opt.fairSlots !== false, factory: (opt && opt.factory) || null };
}
const runningCount = () => Object.values(autopilot).filter((a) => a.status === "running").length;

// A build that waits for another item (`after`) may start once that item is gone, or has its PR text
// (stage ship), or its own build stopped for good.
function afterDone(a) {
  if (!a.after) return true;
  const other = findItem(a.after);
  if (!other || other.kind !== "item") return true;
  if (other.next && other.next.stage === "ship") return true;
  const oa = autopilot[a.after];
  return !!oa && (oa.status === "done" || oa.status === "stopped");
}

/**
 * Which queued build starts next. Pure: `queued` is [[folder, a]], `running` the folders running now,
 * `projectOf(folder)` a project id, `order` the project ids in their order.
 * With fair slots, a build from a project with nothing running goes first, then by project order, then oldest.
 */
export function pickNext(queued, running, { fair = true, projectOf: pOf = () => null, order = [] } = {}) {
  if (!queued.length) return null;
  const busy = new Set(running.map((f) => pOf(f)));
  const rank = (f) => {
    const i = order.indexOf(pOf(f));
    return i < 0 ? order.length : i;
  };
  const sorted = queued.slice().sort((x, y) => {
    if (fair) {
      const fx = busy.has(pOf(x[0])) ? 1 : 0, fy = busy.has(pOf(y[0])) ? 1 : 0;
      if (fx !== fy) return fx - fy;
      const r = rank(x[0]) - rank(y[0]);
      if (r) return r;
    }
    return String(x[1].queued || "").localeCompare(String(y[1].queued || ""));
  });
  return sorted[0];
}

// A slot is free: start the next queued build (see pickNext). Builds waiting on another item are skipped.
function startQueued() {
  while (runningCount() < autoOptions().maxRuns) {
    const queued = Object.entries(autopilot).filter(([, a]) => a.status === "queued" && afterDone(a));
    const running = Object.entries(autopilot).filter(([, a]) => a.status === "running").map(([f]) => f);
    const next = pickNext(queued, running, { fair: autoOptions().fairSlots, projectOf, order: projectOrder() });
    if (!next) return;
    const [folder, a] = next;
    a.status = "running";
    a.message = null;
    autoLog(folder, a.restarted ? "Workshop restarted: carrying on" : a.after ? `${a.after} is ready: started` : "A slot freed up: started");
    a.restarted = false;
    saveAuto();
    emitAutopilot(folder, "running", null);
    broadcastLive();
    autoStep(folder).catch(() => {});
  }
}

/** After a restart: start queued builds once opencode is connected. */
export function resumeQueued() {
  later(startQueued, 0);
}

const changeHooks = new Set();
/** fn(folder, status, message) after every status change. Returns a function that removes it. */
export function onAutoChange(fn) {
  changeHooks.add(fn);
  return () => changeHooks.delete(fn);
}
function changed(folder, status, message) {
  for (const fn of changeHooks) setImmediate(() => { try { fn(folder, status, message); } catch (e) { log(`autopilot hook: ${e.message}`); } });
}

function autoSet(folder, status, message) {
  const a = autopilot[folder];
  if (!a) return;
  const wasRunning = a.status === "running";
  a.status = status;
  a.message = message || null;
  a.inFlight = false;
  autoLog(folder, message || status);
  saveAuto();
  emitAutopilot(folder, status, a.message);
  broadcastLive();
  changed(folder, status, a.message);
  if (wasRunning && status !== "running") later(startQueued, 0);
}

/** revise.md's status and Needs you lines (eng-agents Core 4.15.0 /revise), or null when there is none. */
export function reviseStatus(folder) {
  let t;
  try {
    t = fs.readFileSync(path.join(workRoot, folder, "revise.md"), "utf8");
  } catch {
    return null;
  }
  const st = (/^\s*-\s*Status:\s*(READY|HOLD)\b/im.exec(t) || [])[1] || null;
  const sec = /^##\s+Needs you\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(t);
  const needs = sec ? sec[1].split(/\r?\n/).map((l) => (/^\s*[-*]\s+(.+?)\s*$/.exec(l) || [])[1]).filter((l) => l && !/^none\.?$/i.test(l) && !/^</.test(l)) : [];
  return { status: st ? st.toUpperCase() : null, needs };
}

// Why the item needs you, in one line, from the page's own next step.
function needsYouText(it) {
  const n = it.next || {};
  if (it.blocked) return `Task blocked: ${it.blocked}`;
  if (n.stage === "review") return "The review is not READY and there are no fix tasks to run. Read review.md, add fix tasks or fix it yourself, then click Resume.";
  if (n.action) return `${n.action}${n.command ? ` (${n.command})` : ""}. Then click Resume.`;
  return "The next step needs you. Then click Resume.";
}

/**
 * A step failed (`why`). A model or connection error runs the same step again later, up to MODEL_RETRIES times;
 * anything else, or the last try, waits for you with what to do.
 */
function stepFailed(folder, why) {
  const a = autopilot[folder];
  // Workshop is stopping: the step's request dies with opencode. Keep the build as it is, so the restart resumes it.
  if (!running || !a || a.status !== "running") return;
  const text = String(why || "the step failed").trim();
  const tries = a.errRetries || 0;
  if (!NO_RETRY.test(text.replace(/^.*?stopped:\s*/, "")) && tries < MODEL_RETRIES) {
    const d = autoTiming.retryDelays;
    const wait = d[Math.min(tries, d.length - 1)];
    a.errRetries = tries + 1;
    a.inFlight = false;
    a.lastCommand = null; // the retry is the same step on purpose, not "it did not move forward"
    a.retried = null;
    a.message = `${text}. Trying again at ${clock(wait)} (${a.errRetries} of ${MODEL_RETRIES}).`;
    autoLog(folder, a.message);
    saveAuto();
    emitAutopilot(folder, "running", a.message);
    broadcastLive();
    const at = (a.retryAt = Date.now() + wait);
    later(() => {
      const b = autopilot[folder];
      if (b && b.status === "running" && b.retryAt === at) {
        b.retryAt = null;
        autoStep(folder).catch(() => {});
      }
    }, wait);
    return;
  }
  const after = tries ? ` It failed ${tries + 1} times.` : "";
  autoSet(folder, "waiting", `${text}.${after} If the model server is down or busy, check it (workshop doctor), then click Resume.`);
}

/**
 * The watchdog, every 30 seconds: stalls, missed idles and lost sessions of running steps (see 1.34.0 above).
 * `now` is for tests.
 */
export function autoWatch(now = Date.now()) {
  if (!oc.connected) return; // nothing is known until opencode is back; the reconnect reloads every session
  for (const [folder, a] of Object.entries(autopilot)) {
    if (a.status !== "running" || !a.inFlight || !a.session || stepping.has(folder)) continue;
    const s = sessions.get(a.session);
    if (!s) {
      autoSet(folder, "waiting", `${a.command}: its opencode session is gone (opencode was reset or the session deleted). Click Resume to run the step again.`);
      continue;
    }
    if (s.status === "idle") {
      // Idle, but autopilot never heard it (the event stream dropped and came back): carry on.
      const since = s.idleSeen || (s.idleSeen = now);
      if (now - since >= autoTiming.missedIdleMs) {
        s.idleSeen = null;
        a.inFlight = false;
        autoLog(folder, `${a.command} ended while Workshop was not listening: carrying on`);
        saveAuto();
        autoStep(folder, true).catch(() => {});
      }
      continue;
    }
    s.idleSeen = null;
    const asking = [...permissions.values(), ...questions.values()].some((p) => p.sessionID === a.session);
    if (asking) continue; // waits on you: never a stall
    const last = Math.max(s.seenAt || 0, a.stepAt || 0);
    if (last && now - last >= stallMs()) {
      const mins = Math.round(stallMs() / 60e3);
      const sid = a.session;
      if (oc.api && oc.api.abort) oc.api.abort(sid).catch(() => {});
      stepFailed(folder, `${a.command}: no word from the model for ${mins} minutes`);
    }
  }
}

const stepping = new Set();
// finished: called because the step autopilot started just ended (not a start or resume).
async function autoStep(folder, finished = false) {
  const a = autopilot[folder];
  if (!a || a.status !== "running" || a.inFlight || stepping.has(folder)) return;
  stepping.add(folder);
  try {
    // Fresh read of .work, not the debounced one: the step that just ended may have written files.
    const alive = current(() => true);
    const r = await runModel();
    if (!alive()) return;
    if (r.error) return autoSet(folder, "waiting", `Could not read .work: ${r.error}`);
    setModel(r.data);
    linkSessionsFromModel();
    emitModel();

    const it = findItem(folder);
    if (!it || it.kind !== "item") return autoSet(folder, "stopped", "The work item folder is gone.");
    if (it.paused) return autoSet(folder, "waiting", `The item is paused. Run /resume ${it.id}, then click Resume.`);

    // How did the last step end?
    const last = a.session ? sessions.get(a.session) : null;
    // After a Workshop restart the step may still be running in opencode (its own service): wait for it rather than
    // start the same step again beside it (1.34.0).
    if (!finished && last && last.status !== "idle" && !a.pending) {
      a.inFlight = true;
      a.sawBusy = true;
      a.stepAt = Date.now();
      autoLog(folder, `${a.command || "The last step"} is still running in opencode: waiting for it`);
      saveAuto();
      broadcastLive();
      return;
    }
    if (finished && last && last.error) return stepFailed(folder, `${a.command} stopped: ${last.error}`);
    if (finished) a.errRetries = 0; // a step that ended cleanly resets the model-error tries
    // /revise put something on hold (a new dependency, a migration, auth code, another repo): wait for you.
    if (finished && a.command && /^\/revise\b/.test(a.command)) {
      const rv = reviseStatus(folder);
      if (rv && rv.status === "HOLD") return autoSet(folder, "waiting", `Needs you: ${rv.needs.join(" ") || "some comments need you; read revise.md"} Answer in the code review or fix it, then click Resume.`);
    }
    // Workshop's own first command (1.28.0): /revise after a Send back, /pr-fix after Publish.
    if (a.pending && !finished) {
      const full = a.pending;
      a.lastCommand = full;
      a.retried = null;
      a.gap = null;
      a.command = full;
      a.inFlight = true;
      a.sawBusy = false;
      const run = await runCommand({ folder, command: full }, { fresh: true, fromAuto: true });
      a.pending = null;
      a.session = run.session;
      a.stepAt = Date.now();
      autoLog(folder, `Running ${full}`);
      saveAuto();
      broadcastLive();
      return;
    }
    // A review that turned Blockers into fix tasks starts a fix round.
    if (finished && a.command && /^\/review\b.*\sauto$/.test(a.command) && it.gates.review && it.gates.review !== "READY") a.fixRounds = (a.fixRounds || 0) + 1;
    // The step stopped on a knowledge gap it could not work around: wait for your answer (gap.answer resumes).
    const gap = finished ? holdingGap(it.id) : null;
    if (gap) {
      a.gap = gap.id;
      return autoSet(folder, "waiting", `Needs you: answer ${gap.id} (Teach): ${gap.question}`);
    }

    const n = it.next || {};
    if (n.stage === "ship") return autoSet(folder, "done", "Ready to publish: the PR text is in pr.md. Click Publish to push the branches and open the PRs.");

    let cmd = n.command;
    const approving = cmd && /^\/approve\b/.test(cmd) && (n.stage === "plan" || n.stage === "bug" || n.stage === "quick");
    // A trial run or a coverage item is a quick change: hands-off like one, even with hands-off Quick changes off.
    const handsOff = it.lane === "quick" && (autoOptions().quickHandsOff || isQuickRun(it));
    const story = isStory(it) && it.lane === "feature";
    let autoApprove = false;
    if (approving && a.approveFirst) cmd = `/approve ${it.id} ${n.stage}`;
    else if (approving && n.stage === "quick" && handsOff) { cmd = `/approve ${it.id} quick`; autoApprove = true; }
    else if (approving && n.stage === "plan" && story) { cmd = `/approve ${it.id} spec`; autoApprove = true; }
    else if (n.needsYou || !cmd) return autoSet(folder, "waiting", needsYouText(it));
    // A trial run or a coverage item starts in the quick lane.
    if (n.stage === "start" && isQuickRun(it)) cmd = `/start ${it.id} quick`;

    const parsed = parseCommand(cmd);
    const allowed = parsed && (AUTO_STEPS.has(parsed.name) || (isHandsOff(it) && HANDS_OFF_STEPS.has(parsed.name)));
    if (!allowed) return autoSet(folder, "waiting", `Next is ${cmd}, which autopilot does not run. Run it yourself, then click Resume.`);

    // The same step again means the last run did not move the item forward.
    if (cmd === a.lastCommand && autoApprove) {
      const why = finished && last && last.text ? `: ${String(last.text).trim().split(/\r?\n/).slice(-1)[0].replace(/^Needs you:\s*/i, "").slice(0, 200)}` : "";
      if (story && n.stage === "plan") return autoSet(folder, "waiting", `The plan drifts from the approved breakdown, so it needs your review${why}. Read spec.md, plan.md and tasks.md, then click Approve and build.`);
      return autoSet(folder, "waiting", `quick.md needs your review (it was not clean enough to approve on its own${why}). Read quick.md and tasks.md, then click Approve and build.`);
    }
    if (cmd === a.lastCommand && a.retried !== cmd) {
      // One more try in a fresh session before it waits (core rule 6: the agent wrote what it tried in progress.md).
      a.retried = cmd;
      autoLog(folder, `${cmd} ended without finishing: one more try in a fresh session`);
    } else if (cmd === a.lastCommand) {
      const said = finished && last && last.text ? ` The agent said: "${String(last.text).trim().split(/\r?\n/).slice(-1)[0].slice(0, 200)}"` : "";
      return autoSet(folder, "waiting", `${cmd} ended without finishing, twice. Reply to the agent, or fix it yourself, then click Resume.${said}`);
    }

    if (parsed.name === "quick" && !handsOff) return autoSet(folder, "waiting", `Next is ${cmd}. Run it yourself, then approve quick.md (or turn on hands-off Quick changes in opencode settings).`);

    let full = cmd;
    if (parsed.name === "quick" || autoApprove) full = `${cmd} auto`; // review by exception: asks nothing, approves only a clean plan
    if (HANDS_OFF_STEPS.has(parsed.name)) full = `${cmd} auto`; // a story or trial run: asks nothing (Core 4.10.0)
    if (parsed.name === "review") {
      if ((a.fixRounds || 0) >= maxFixRounds()) autoLog(folder, `${maxFixRounds()} review rounds done. This review will ask you which findings to fix.`);
      else full = `${cmd} auto`;
    }

    if (a.lastCommand !== cmd) a.retried = null;
    a.lastCommand = cmd;
    a.gap = null;
    a.command = full;
    a.inFlight = true;
    a.sawBusy = false;
    // approveFirst stays until the plan is approved, so Resume after a failed approve approves again.
    if (!approving) a.approveFirst = false;
    const run = await runCommand({ folder, command: full }, { fresh: true, fromAuto: true });
    a.session = run.session;
    a.stepAt = Date.now();
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
  later(() => autoStep(folder, true), 1500);
}

export function autoOnFail(sid, msg) {
  const [folder, a] = autoForSession(sid);
  if (a && a.status === "running" && a.inFlight) stepFailed(folder, msg);
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
  emitAutopilot(folder, "running", null);
}

export async function autopilotAction({ folder, action, after }) {
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
  if (after != null) {
    const other = findItem(after);
    if (!other || other.kind !== "item" || after === folder) throw httpError(400, `No other work item folder "${after}" to build after.`);
  }

  needOpencode();
  if (a && (a.status === "running" || a.status === "queued")) throw httpError(409, a.status === "queued" ? "This build is already queued." : "Autopilot is already running this item.");
  if (it.paused) throw httpError(409, `The item is paused. Run /resume ${it.id} first.`);
  const s = sessions.get(currentSession(folder));
  if (s && s.status !== "idle") throw httpError(409, "This item's agent is still working. Wait for it, or stop it first.");

  const gate = it.lane === "bug" ? it.gates.bug : it.lane === "quick" ? it.gates.quick : it.gates.plan;
  const n = it.next || {};
  const canApprove = n.command && /^\/approve\b/.test(n.command) && (n.stage === "plan" || n.stage === "bug" || n.stage === "quick");
  if (action === "approve-start" && !canApprove) throw httpError(409, "There is no plan, quick plan or bug analysis waiting for approval.");
  // Resume on a build whose approve step failed (approveFirst, or an older record whose last step was /approve).
  const pendingApprove = action === "resume" && a && (a.approveFirst || /^\/approve\b/.test(a.command || "")) && canApprove;
  if (pendingApprove) a.approveFirst = true;
  // Hands-off Quick change: may start before quick.md exists or while it is a draft (review by exception).
  const handsOffStart = (it.lane === "quick" && autoOptions().quickHandsOff && (n.stage === "quick") && action !== "approve-start")
    // A story from an approved breakdown or a trial run may start before it is set up or planned (Core 4.10.0).
    || (isHandsOff(it) && ["start", "spec", "plan", "quick"].includes(n.stage) && action !== "approve-start");
  if (action !== "approve-start" && !pendingApprove && !handsOffStart && gate !== "APPROVED") {
    throw httpError(409, `Autopilot starts after ${it.lane === "bug" ? "bug.md" : it.lane === "quick" ? "quick.md" : "plan.md"} is approved.`);
  }

  const wait = after != null && !afterDone({ after });
  const full = wait || runningCount() >= autoOptions().maxRuns;
  if (action === "resume" && a) {
    a.status = full ? "queued" : "running";
    if (full) a.queued = new Date().toISOString();
    if (after !== undefined) a.after = after || null;
    a.retried = null;
    a.gap = null;
    a.message = null;
    a.lastCommand = null; // you fixed something: allow the same step once more
    a.errRetries = 0;
    a.retryAt = null;
    a.inFlight = false;
    autoLog(folder, "Resumed");
  } else {
    autopilot[folder] = { status: full ? "queued" : "running", queued: full ? new Date().toISOString() : null, message: null, command: null, lastCommand: null, retried: null, gap: null, after: after || null, session: null, inFlight: false, sawBusy: false, approveFirst: action === "approve-start", fixRounds: 0, started: new Date().toISOString(), log: [] };
    autoLog(folder, action === "approve-start" ? "Started: approve, then build" : "Started");
  }
  if (full) {
    const n2 = autoOptions().maxRuns;
    autopilot[folder].message = wait ? `Queued: builds after ${after}, which changes the same files. It starts when ${after}'s PR text is ready.` : `Queued: ${n2} build${n2 === 1 ? " is" : "s are"} running. It starts when one finishes.`;
    autoLog(folder, "Queued");
    saveAuto();
    emitAutopilot(folder, "queued", autopilot[folder].message);
    broadcastLive();
    return { ok: true, queued: true };
  }
  saveAuto();
  emitAutopilot(folder, "running", null);
  broadcastLive();
  await autoStep(folder);
  const now = autopilot[folder];
  if (now && now.status === "waiting") throw httpError(409, now.message);
  return { ok: true };
}

/**
 * Starts (or queues) a build whose first step is Workshop's own command: `/revise <id> auto` after a Send back, or
 * `/pr-fix <id> ci|conflict auto` after Publish. The item's plan is approved already, so no gate is checked here;
 * the usual next-step rules run after it. `why` goes in the log.
 */
export async function startPending(folder, command, why) {
  const it = findItem(folder);
  if (!it || it.kind !== "item") throw httpError(404, `No work item folder "${folder}". Refresh the page.`);
  needOpencode();
  const a0 = autopilot[folder];
  if (a0 && (a0.status === "running" || a0.status === "queued")) throw httpError(409, "Tandem is already working on this item. Wait for it, or stop it first.");
  if (it.paused) throw httpError(409, `The item is paused. Run /resume ${it.id} first.`);
  const s = sessions.get(currentSession(folder));
  if (s && s.status !== "idle") throw httpError(409, "This item's agent is still working. Wait for it, or stop it first.");
  const full = runningCount() >= autoOptions().maxRuns;
  const now = new Date().toISOString();
  autopilot[folder] = { status: full ? "queued" : "running", queued: full ? now : null, message: null, command: null, lastCommand: null, retried: null, gap: null, after: null, session: null, inFlight: false, sawBusy: false, approveFirst: false, fixRounds: 0, pending: command, started: now, log: (a0 && a0.log) || [] };
  autoLog(folder, why || `Started with ${command}`);
  if (full) {
    autopilot[folder].message = `Queued: ${autoOptions().maxRuns} builds are running. It starts when one finishes.`;
    saveAuto();
    emitAutopilot(folder, "queued", autopilot[folder].message);
    changed(folder, "queued", autopilot[folder].message);
    broadcastLive();
    return { ok: true, queued: true };
  }
  saveAuto();
  emitAutopilot(folder, "running", null);
  changed(folder, "running", null);
  broadcastLive();
  await autoStep(folder);
  return { ok: true };
}

export function autoData() {
  const out = {};
  for (const [folder, a] of Object.entries(autopilot)) {
    out[folder] = { status: a.status, queued: a.queued || null, message: a.message, command: a.command, pending: a.pending || null, session: a.session, fixRounds: a.fixRounds || 0, maxFixRounds: maxFixRounds(), after: a.after || null, gap: a.gap || null, started: a.started, updated: a.updated, log: (a.log || []).slice(-8) };
  }
  return out;
}

/** A gap was answered: resume the builds that waited on it. Returns the folders resumed. */
export function resumeAfterGap(gapId) {
  const out = [];
  for (const [folder, a] of Object.entries(autopilot)) {
    if (a.status !== "waiting" || a.gap !== gapId) continue;
    a.gap = null;
    a.lastCommand = null;
    a.retried = null;
    a.status = runningCount() >= autoOptions().maxRuns ? "queued" : "running";
    if (a.status === "queued") a.queued = new Date().toISOString();
    a.message = null;
    autoLog(folder, `${gapId} answered: resumed`);
    out.push(folder);
    emitAutopilot(folder, a.status, null);
    if (a.status === "running") autoStep(folder).catch(() => {});
  }
  if (out.length) {
    saveAuto();
    broadcastLive();
  }
  return out;
}

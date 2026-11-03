// opencode connector: wires the code review API (code-review.mjs) and the revision runner
// (revision-runner.mjs) to this connector's model, sessions and events. New; the live server did
// the same in live-server.mjs on eng-agents branch dev/feature/review-api.

import { log, opt, workRoot } from "./context.mjs";
import { model } from "./model.mjs";
import { currentSession, folderForToken, linkSession } from "./links.mjs";
import { oc, sessionEvents, sessions, upsertSession } from "./opencode-state.mjs";
import { autoActive } from "./autopilot.mjs";
import { broadcastLive, emit } from "./live.mjs";
import { createCodeReview } from "./code-review.mjs";
import { createRevisionRunner } from "./revision-runner.mjs";

export let codeReview = null;
let runner = null;
let idleListener = null;

// Sends a revision prompt the way a reply is sent: in the item's current session when it is idle (the
// agent keeps its context), else in a new session linked to the item.
async function startRevision({ folder, title, prompt }) {
  if (!oc.connected || !oc.api) throw new Error(oc.error || "opencode is not connected.");
  let sid = currentSession(folder);
  const s = sid ? sessions.get(sid) : null;
  if (!s || s.status !== "idle" || autoActive(folder)) {
    const created = await oc.api.createSession(title);
    sid = created.id;
    upsertSession(sid, { title: created.title });
  }
  linkSession(folder, sid, title);
  upsertSession(sid, { status: "busy", busySince: Date.now(), activity: "Starting the code review revision", error: null, text: null, command: title });
  broadcastLive();
  try {
    await oc.api.prompt(sid, prompt);
  } catch (e) {
    upsertSession(sid, { status: "idle", activity: null, error: e.message });
    broadcastLive();
    throw e;
  }
  return sid;
}

// `review`: a review's status or revision changed. Small, like every connector event; Dispatch calls
// review.session for the data.
function emitReview(folder, repo) {
  if (!codeReview) return;
  try {
    const st = codeReview.readState(folder, repo);
    const item = ((model && model.items) || []).find((i) => i.folder === folder);
    emit("review", { id: item && item.id ? String(item.id) : null, folder, repo, status: st.status, revision: st.revision });
  } catch {}
}

/** After configure(): set up for this workspace and follow unfinished revisions. */
export function loadReview() {
  resetReview();
  codeReview = createCodeReview({
    workspace: opt.workspace,
    workRoot,
    findItem: (wid) => {
      const folder = folderForToken(wid);
      return folder ? ((model && model.items) || []).find((i) => i.folder === folder) || null : null;
    },
    canRevise: () => (oc.connected && oc.api ? null : oc.error || "opencode is not connected."),
    runInfo: (folder, repo) => (runner ? runner.runData(folder, repo) : null),
  });
  // The runner adds its own listener; keep a handle so a restart removes only ours.
  const events = { on: (name, fn) => { if (name === "idle") idleListener = fn; sessionEvents.on(name, fn); } };
  runner = createRevisionRunner({ codeReview, workspace: opt.workspace, workRoot, launcher: { start: startRevision }, sessionEvents: events, log });
  runner.load();
  for (const name of ["approved", "changes-requested"]) codeReview.events.on(name, (ev) => setImmediate(() => emitReview(ev.folder, ev.repo)));
  runner.events.on("run", ({ folder, repo }) => emitReview(folder, repo));
}

/** On stop or restart. */
export function resetReview() {
  if (idleListener) sessionEvents.off("idle", idleListener);
  idleListener = null;
  if (codeReview) codeReview.events.removeAllListeners();
  if (runner) runner.events.removeAllListeners();
  codeReview = null;
  runner = null;
}

/** For `state`: each ready-to-ship item's review per repo, so Dispatch can show it on the PR card.
 *  {"<folder>": {"<repo>": {status, revision, started, run}}}. started: false means nobody has
 *  reviewed it yet (no state.json); run is the latest revision run, or null. */
export function reviewSummary() {
  const out = {};
  if (!codeReview) return out;
  for (const it of (model && model.items) || []) {
    for (const p of it.pr || []) {
      if (!p.repo || /[\\/:*?"<>|]/.test(p.repo) || p.repo.startsWith(".")) continue;
      let st;
      try { st = codeReview.readState(it.folder, p.repo); } catch { continue; }
      (out[it.folder] ||= {})[p.repo] = { status: st.status, revision: st.revision, started: st.saved, run: runner ? runner.runData(it.folder, p.repo) : null };
    }
  }
  return out;
}

export function needReview() {
  if (!codeReview) {
    const e = new Error("The opencode connector is not ready yet.");
    e.status = 503;
    e.code = "unavailable";
    throw e;
  }
  return codeReview;
}

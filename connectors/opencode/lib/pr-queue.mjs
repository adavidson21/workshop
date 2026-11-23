// opencode connector: wires the PR review queue (review-queue.mjs) to this connector's model, sessions,
// timers and events. New (not in eng-agents).

import path from "node:path";
import { cancel, ctx, every, httpError, later, log, opt, stateDir } from "./context.mjs";
import { autopilot } from "./autopilot.mjs";
import { model } from "./model.mjs";
import { oc, permissions, questions, sessionEvents, sessions } from "./opencode-state.mjs";
import { broadcastLive, emit } from "./live.mjs";
import { prFromUrl, startReview } from "./workspace.mjs";
import { cleanPr, createReviewQueue } from "./review-queue.mjs";

let queue = null;

const reviewFor = (id) => {
  const it = ((model && model.items) || []).find((i) => i.folder === `pr-${id}`);
  return it ? it.prReview || null : null;
};
const asking = (sid) => [...permissions.values()].some((p) => p.sessionID === sid) || [...questions.values()].some((q) => q.sessionID === sid);

/** After configure(): load the queue for this workspace and follow it. */
export function loadPrQueue() {
  resetPrQueue();
  const cfg = (ctx && ctx.config) || {};
  queue = createReviewQueue({
    file: path.join(stateDir, "pr-queue.json"),
    start: (url) => startReview({ url, again: false }),
    review: reviewFor,
    session: (sid) => sessions.get(sid),
    ready: () => (oc.connected && oc.api ? null : oc.error || "opencode is not connected."),
    // 1.36.0: a local model has one GPU, so a review waits while autopilot is building.
    wait: () => (opt && opt.local && Object.values(autopilot).some((a) => a && a.status === "running") ? "Waiting for the build to finish: the local model does one thing at a time." : null),
    asking,
    sessionEvents,
    nightlyAt: (cfg.prReviews && cfg.prReviews.nightlyAt) || "",
    onSync: onSyncSetting(cfg, opt && opt.local),
    log,
    timers: { later, every, cancel },
  });
  // `prQueue`: the queue changed. Small, like every connector event; Dispatch calls `state` for the data.
  queue.events.on("change", (d) => {
    emit("prQueue", { status: d.status, counts: d.counts });
    broadcastLive();
  });
  queue.load();
}

/** prReviews.onSync: on by default, but off with a local model (1.36.0) unless you turned it on yourself, because
 *  every new PR and every new commit would take the one GPU from your builds and chats. */
export function onSyncSetting(cfg, local) {
  const v = cfg && cfg.prReviews ? cfg.prReviews.onSync : undefined;
  return local ? v === true : v !== false;
}

export function resetPrQueue() {
  if (queue) queue.stop();
  queue = null;
}

function need() {
  if (!queue) throw httpError(503, "The opencode connector is not ready.");
  return queue;
}

const clean = (list) => (Array.isArray(list) ? list : []).map((p) => cleanPr(p, prFromUrl)).filter(Boolean);

/** `pr.reviewAll`: queue PRs for /pr-review, one at a time. With no PRs, resumes a paused or stopped queue. */
export function reviewAll({ prs }) {
  const q = need();
  if (!Array.isArray(prs) || !prs.length) return q.resume();
  const list = clean(prs);
  if (!list.length) throw httpError(400, "None of those are Azure DevOps pull request links.");
  return q.add(list, "manual");
}

export const saveInbox = ({ prs }) => need().saveInbox(clean(prs));

/** `pr.reviews`: where each PR's first-pass review stands. */
export function prReviews({ ids }) {
  const q = need();
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9]{1,10}$/.test(x)).slice(0, 200);
  return { onSync: q.onSync, ready: !!(oc.connected && oc.api), prs: q.status(list) };
}
export const stopQueue = () => need().stopRun();
export function clearQueue() {
  try {
    return need().clear();
  } catch (e) {
    throw e.status === 409 && !e.code ? httpError(409, e.message) : e;
  }
}
export const prQueueData = () => (queue ? queue.data() : null);

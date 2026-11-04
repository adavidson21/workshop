// opencode connector: the PR review queue. New (not in eng-agents).
//
// "Review all" runs Tandem's /pr-review (pr-reviewer agent, eng-agents Core 2.6.0) on a list of pull
// requests one at a time, each in its own session, so the queue keeps going with Dispatch closed. An
// optional nightly run queues the PRs that were waiting on you the last time Dispatch checked Azure
// DevOps (connectors do not call each other, so Dispatch hands this connector the inbox it got from the
// ADO connector's sync.prs; see saveInbox).
//
// Nothing here posts to Azure DevOps: /pr-review only drafts comments in .work/pr-<id>/review.md.
//
// State is one JSON file (pr-queue.json in the connector's state folder):
//   { status, source, message, started, finished, items: [{ id, url, title, commit, state, message,
//     session, startedAt, endedAt }], inbox: { at, prs }, nightly: { at, last } }
//   status: "idle" (nothing queued) | "running" | "paused" (Workshop restarted mid-run) | "stopped" | "done"
//   item state: "queued" | "running" | "done" | "asking" (the reviewer asked you something) | "failed" | "skipped"

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

export const MAX_QUEUE = 25;
export const INBOX_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // older than this, the nightly run skips the inbox
const FINISH_DELAY_MS = 1500; // let the agent's last file writes land before reading the review
const POLL_MS = 10_000;
const NIGHTLY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const NIGHTLY_12_RE = /^(1[0-2]|0?[1-9]):([0-5]\d)\s*([ap])\.?m?\.?$/i;
const KEEP_DONE = 50;

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const clip = (s, n = 300) => (s == null ? null : String(s).slice(0, n));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A clean PR from the caller: { id, url, title, commit, waiting }, or null. */
export function cleanPr(p, prFromUrl) {
  if (!p || typeof p !== "object") return null;
  const pr = prFromUrl(p.url);
  if (!pr) return null;
  const commit = typeof p.commit === "string" && /^[0-9a-f]{7,40}$/i.test(p.commit) ? p.commit.toLowerCase() : null;
  return { id: pr.id, url: pr.url, title: clip(typeof p.title === "string" ? p.title : "", 200) || null, commit, waiting: p.waiting === true };
}

/** "HH:MM" (24-hour) or "h:MM AM/PM", as {h, m, text} with text always "HH:MM"; or null. */
export function nightlyTime(v) {
  const s = String(v || "").trim();
  let m = NIGHTLY_RE.exec(s);
  if (m) return { h: Number(m[1]), m: Number(m[2]), text: m[0] };
  m = NIGHTLY_12_RE.exec(s);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  return { h, m: Number(m[2]), text: `${String(h).padStart(2, "0")}:${m[2]}` };
}

/**
 * Whether a review in .work is already up to date for this commit. `review` is the parser's prReview.
 * Unknown commits are never up to date: /pr-review itself stops early when nothing changed.
 */
export function upToDate(review, commit) {
  if (!review || !review.reviewed || !review.reviewedCommit) return false;
  const c = commit || review.commit;
  if (!c) return false;
  return String(c).toLowerCase().startsWith(String(review.reviewedCommit).toLowerCase());
}

// deps:
//   file           absolute path of pr-queue.json
//   start(url)     runs /pr-review <url> in a new session; resolves { session }, throws an Error with a
//                  plain message (for example "PR 812 is already being reviewed.")
//   review(id)     the parser's prReview for .work/pr-<id>, or null
//   session(sid)   the tracked opencode session ({ status, error }) or undefined
//   ready()        null when opencode can run commands, else why not
//   asking(sid)    true when the session waits on a permission prompt or a question
//   sessionEvents  EventEmitter with "idle" (sessionId, error)
//   nightlyAt      "HH:MM" from the connector config, or empty for off
//   log, now, timers ({ later, every, cancel }), finishDelayMs, pollMs: tests and the connector
export function createReviewQueue({ file, start, review, session, ready = () => null, asking = () => false, sessionEvents, nightlyAt = "", log = () => {}, now = () => new Date(), timers, finishDelayMs = FINISH_DELAY_MS, pollMs = POLL_MS }) {
  const events = new EventEmitter();
  const T = timers || {
    later: (fn, ms) => setTimeout(fn, ms),
    every: (fn, ms) => setInterval(fn, ms),
    cancel: (t) => { clearTimeout(t); clearInterval(t); },
  };
  let q = blank();
  let pollTimer = null;
  let finishing = false;
  let starting = false;
  const night = nightlyTime(nightlyAt);

  function blank() {
    return { status: "idle", source: null, message: null, started: null, finished: null, items: [], inbox: null, nightly: { at: null, last: null } };
  }

  function save() {
    q.items = q.items.slice(-KEEP_DONE - MAX_QUEUE);
    try {
      writeJsonAtomic(file, q);
    } catch (e) {
      log(`Could not save the PR review queue: ${e.message}`);
    }
    events.emit("change", data());
  }

  const runningItem = () => q.items.find((i) => i.state === "running") || null;
  const queued = () => q.items.filter((i) => i.state === "queued");

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      q = { ...blank(), ...raw, items: Array.isArray(raw.items) ? raw.items : [], nightly: { ...blank().nightly, ...(raw.nightly || {}) } };
    } catch {
      q = blank();
    }
    if (q.status === "running") {
      // Workshop restarted the connector mid-run. The review that was running may still be going in
      // opencode, so do not start it again on our own: wait for Resume.
      const cur = runningItem();
      if (cur) {
        cur.state = "queued";
        cur.message = "Interrupted when Workshop restarted. Resume checks it and carries on.";
        cur.interrupted = true;
      }
      q.status = "paused";
      q.message = "Workshop restarted the opencode connector. Resume to carry on.";
    }
    // A new or changed nightly time never fires for a time already past today: it starts tonight.
    const was = q.nightly.at;
    q.nightly.at = night ? night.text : null;
    if (night && was !== night.text && minutesNow() >= night.h * 60 + night.m) q.nightly.last = ymd(now());
    save();
    sessionEvents.on("idle", onIdle);
    pollTimer = T.every(tick, pollMs);
  }

  function stop() {
    sessionEvents.off("idle", onIdle);
    if (pollTimer) T.cancel(pollTimer);
    pollTimer = null;
    events.removeAllListeners();
  }

  const minutesNow = () => { const d = now(); return d.getHours() * 60 + d.getMinutes(); };

  /** Queues PRs. Returns { added: [ids], skipped: [{ id, reason }] }. */
  function add(prs, source = "manual") {
    const added = [];
    const skipped = [];
    const finished = !["running", "paused"].includes(q.status);
    if (finished) {
      // A new run: earlier results stay visible only until it starts.
      q.items = [];
      q.started = now().toISOString();
      q.finished = null;
      q.source = source;
    }
    for (const pr of prs) {
      if (!pr) continue;
      if (pr.waiting) { skipped.push({ id: pr.id, reason: "You voted Waiting for author." }); continue; }
      const inQueue = q.items.find((i) => i.id === pr.id && (i.state === "queued" || i.state === "running"));
      if (inQueue) { skipped.push({ id: pr.id, reason: "Already in the queue." }); continue; }
      if (upToDate(review(pr.id), pr.commit)) { skipped.push({ id: pr.id, reason: "Already reviewed at this commit." }); continue; }
      if (queued().length + (runningItem() ? 1 : 0) >= MAX_QUEUE) { skipped.push({ id: pr.id, reason: `The queue holds ${MAX_QUEUE} at a time.` }); continue; }
      q.items.push({ id: pr.id, url: pr.url, title: pr.title || null, commit: pr.commit || null, state: "queued", message: null, session: null, startedAt: null, endedAt: null });
      added.push(pr.id);
    }
    if (!added.length) {
      if (finished) {
        q.status = q.items.length ? q.status : "idle";
        q.message = source === "nightly" ? "Nightly run: nothing new to review." : null;
        if (source === "nightly") q.finished = now().toISOString();
      }
      save();
      return { added, skipped };
    }
    q.status = "running";
    q.message = null;
    log(`PR review queue: ${added.length} added (${source}), ${skipped.length} skipped`);
    save();
    pump();
    return { added, skipped };
  }

  /** Starts the next queued review if nothing is running. */
  async function pump() {
    if (q.status !== "running" || starting || runningItem()) return;
    const next = queued()[0];
    if (!next) return complete();
    const why = ready();
    if (why) {
      q.status = "paused";
      q.message = `Paused: ${why}`;
      save();
      return;
    }
    if (next.interrupted) {
      delete next.interrupted;
      // It may have finished while Workshop was down.
      const r = review(next.id);
      if (upToDate(r, next.commit)) {
        next.state = "done";
        next.message = null;
        next.endedAt = now().toISOString();
        save();
        return pump();
      }
    }
    starting = true;
    next.state = "running";
    next.message = null;
    next.startedAt = now().toISOString();
    save();
    try {
      const r = await start(next.url);
      next.session = r && r.session ? r.session : null;
      save();
    } catch (e) {
      next.state = "failed";
      next.message = clip(e.message) || "Could not start the review.";
      next.endedAt = now().toISOString();
      save();
      T.later(() => pump(), 0);
    } finally {
      starting = false;
    }
  }

  function complete() {
    if (q.status !== "running") return;
    const counts = summary();
    q.status = "done";
    q.finished = now().toISOString();
    q.message = null;
    log(`PR review queue finished: ${counts.done} reviewed, ${counts.asking} asking, ${counts.failed} failed`);
    save();
  }

  function onIdle(sid) {
    const cur = runningItem();
    if (!cur || cur.session !== sid || finishing) return;
    finishing = true;
    T.later(() => { finishing = false; finish(cur); }, finishDelayMs);
  }

  // A review's session went idle: read what it left in .work and move on.
  function finish(item) {
    if (item.state !== "running") return;
    const s = item.session ? session(item.session) : undefined;
    if (s && s.status !== "idle") return; // a reply woke it up again
    const r = review(item.id);
    item.endedAt = now().toISOString();
    if (s && s.error) {
      item.state = "failed";
      item.message = clip(s.error);
    } else if (upToDate(r, null)) { // reviewed at the commit Get-PullRequest.ps1 just fetched
      item.state = "done";
      item.message = null;
    } else if (item.session && asking(item.session)) {
      item.state = "asking";
      item.message = "The reviewer is asking you something. Answer it on the review's card.";
    } else {
      item.state = "asking";
      item.message = "The review stopped before writing review.md. Open it to see what the reviewer said.";
    }
    save();
    pump();
  }

  // Every pollMs: catch sessions that ended without an idle event (a command that failed to start) and
  // run the nightly review when it is due.
  function tick() {
    const cur = runningItem();
    if (cur && !finishing && !starting) {
      const s = cur.session ? session(cur.session) : undefined;
      if (cur.session && s && s.status === "idle" && !asking(cur.session)) finish(cur);
      else if (cur.session && !s && Date.now() - Date.parse(cur.startedAt || 0) > 60_000) {
        cur.state = "failed";
        cur.message = "Lost track of the review's session.";
        cur.endedAt = now().toISOString();
        save();
        pump();
      }
    }
    nightlyDue();
  }

  function nightlyDue() {
    if (!night) return;
    const today = ymd(now());
    if (q.nightly.last === today || minutesNow() < night.h * 60 + night.m) return;
    if (ready()) return; // try again on the next tick, once opencode is connected
    q.nightly.last = today;
    const inbox = q.inbox;
    if (!inbox || !Array.isArray(inbox.prs)) {
      q.message = "Nightly run skipped: Dispatch has not checked the PRs waiting on you yet.";
      save();
      return;
    }
    if (now().getTime() - Date.parse(inbox.at) > INBOX_MAX_AGE_MS) {
      q.message = "Nightly run skipped: the list of PRs waiting on you is more than a week old. Open To review in Dispatch to refresh it.";
      save();
      return;
    }
    log(`PR review queue: nightly run with ${inbox.prs.length} PRs from ${inbox.at}`);
    add(inbox.prs, "nightly");
  }

  /** The PRs waiting on you, as Dispatch last got them from the ADO connector. For the nightly run. */
  function saveInbox(prs) {
    q.inbox = { at: now().toISOString(), prs: prs.filter(Boolean).slice(0, 200) };
    save();
    return { ok: true, count: q.inbox.prs.length };
  }

  /** Stop after the review that is running; the rest are skipped. */
  function stopRun() {
    if (!["running", "paused"].includes(q.status)) return { ok: true };
    for (const i of queued()) {
      i.state = "skipped";
      i.message = "Stopped before it started.";
      delete i.interrupted;
    }
    const cur = runningItem();
    q.status = "stopped";
    q.finished = now().toISOString();
    q.message = cur ? `Stopped. The review of PR ${cur.id} finishes on its own.` : "Stopped.";
    save();
    return { ok: true };
  }

  function resume() {
    if (q.status !== "paused" && q.status !== "stopped") return { ok: true, resumed: 0 };
    if (q.status === "stopped") for (const i of q.items) if (i.state === "skipped" && i.message === "Stopped before it started.") { i.state = "queued"; i.message = null; }
    const n = queued().length;
    if (!n && !runningItem()) {
      q.status = "done";
      save();
      return { ok: true, resumed: 0 };
    }
    q.status = "running";
    q.message = null;
    q.finished = null;
    save();
    pump();
    return { ok: true, resumed: n };
  }

  /** Forget the last run's results (not while it runs). */
  function clear() {
    if (q.status === "running") {
      const e = new Error("The queue is running. Stop it first.");
      e.status = 409;
      throw e;
    }
    q.status = "idle";
    q.items = [];
    q.message = null;
    q.source = null;
    q.started = q.finished = null;
    save();
    return { ok: true };
  }

  function summary() {
    const c = { queued: 0, running: 0, done: 0, asking: 0, failed: 0, skipped: 0 };
    for (const i of q.items) c[i.state] = (c[i.state] || 0) + 1;
    return c;
  }

  /** What Dispatch shows (state action, liveMode.live.prQueue). */
  function data() {
    return {
      status: q.status,
      source: q.source,
      message: q.message,
      started: q.started,
      finished: q.finished,
      counts: summary(),
      items: q.items.map((i) => ({ id: i.id, url: i.url, title: i.title, state: i.state, message: i.message, session: i.session, startedAt: i.startedAt, endedAt: i.endedAt })),
      nightly: { at: q.nightly.at, last: q.nightly.last },
      inbox: q.inbox ? { at: q.inbox.at, count: q.inbox.prs.length } : null,
    };
  }

  return { load, stop, add, saveInbox, stopRun, resume, clear, data, tick, events };
}

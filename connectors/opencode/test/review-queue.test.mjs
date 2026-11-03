// Tests for lib/review-queue.mjs. Run: node --test "connectors/opencode/test/*.test.mjs"
// Fake opencode: start() records the link and hands back a session; the test plays the agent by
// writing the "review" the parser would read and ending the session.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cleanPr, createReviewQueue, nightlyTime, upToDate } from "../lib/review-queue.mjs";
import { prFromUrl } from "../lib/workspace.mjs";

const LINK = (n) => `https://ado.example.test/tfs/Coll/Shop/_git/orders-api/pullrequest/${n}`;
const SHA = (n) => String(n).padEnd(40, "a"); // distinct first 7 characters per PR
const pr = (n, extra = {}) => cleanPr({ url: LINK(n), title: `Change ${n}`, commit: SHA(n), ...extra }, prFromUrl);

let dir, file, q, events, sessions, reviews, started, startError, clock, waitingOn, notReady;
const dirs = [];

// Timers the test runs by hand: later() fires on flush(), every() on tick().
let pending = [];
const timers = { later: (fn) => { pending.push(fn); return fn; }, every: () => 1, cancel: () => {} };
async function flush() {
  for (let i = 0; i < 20 && pending.length; i++) {
    const run = pending;
    pending = [];
    for (const fn of run) await fn();
    await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setImmediate(r));
}

function make(opts = {}) {
  q = createReviewQueue({
    file,
    start: async (url) => {
      if (startError) throw new Error(startError);
      const sid = `ses_${started.length + 1}`;
      started.push(url);
      sessions.set(sid, { status: "busy", error: null });
      return { session: sid };
    },
    review: (id) => reviews.get(id) || null,
    session: (sid) => sessions.get(sid),
    ready: () => notReady,
    asking: (sid) => waitingOn.has(sid),
    sessionEvents: events,
    timers,
    now: () => new Date(clock),
    finishDelayMs: 0,
    ...opts,
  });
  q.load();
  return q;
}

// The agent finishes: writes review.md for that commit and goes idle.
async function agentDone(sid, id, { commit, reviewed = true, error = null } = {}) {
  if (reviewed) reviews.set(id, { reviewed: true, commit: commit || SHA(id), reviewedCommit: (commit || SHA(id)).slice(0, 7) });
  sessions.set(sid, { status: "idle", error });
  events.emit("idle", sid, error);
  await flush();
}
const item = (id) => q.data().items.find((i) => i.id === String(id));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-queue-"));
  dirs.push(dir);
  file = path.join(dir, "_dashboard", "pr-queue.json");
  events = new EventEmitter();
  sessions = new Map();
  reviews = new Map();
  started = [];
  startError = null;
  waitingOn = new Set();
  notReady = null;
  pending = [];
  clock = "2026-11-02T14:00:00";
});
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe("PR review queue", () => {
  test("helpers: PR cleaning, the nightly time, and what counts as up to date", () => {
    assert.deepEqual(pr(812), { id: "812", url: LINK(812), title: "Change 812", commit: SHA(812), waiting: false });
    assert.equal(cleanPr({ url: "https://github.com/o/r/pull/3" }, prFromUrl), null);
    assert.equal(cleanPr({ url: LINK(5), commit: "not-a-sha" }, prFromUrl).commit, null);
    assert.deepEqual(nightlyTime("02:30"), { h: 2, m: 30, text: "02:30" });
    assert.equal(nightlyTime("24:00"), null);
    assert.equal(nightlyTime(""), null);
    assert.equal(upToDate({ reviewed: true, reviewedCommit: "1aaaaaa" }, SHA(1)), true);
    assert.equal(upToDate({ reviewed: true, reviewedCommit: "bbbbbbb" }, SHA(1)), false);
    assert.equal(upToDate({ reviewed: false, reviewedCommit: "1aaaaaa" }, SHA(1)), false);
    assert.equal(upToDate({ reviewed: true, reviewedCommit: "aaaaaaa" }, null), false, "no commit known: not up to date");
  });

  test("reviews one PR at a time, in order, and finishes", async () => {
    make();
    const r = q.add([pr(1), pr(2), pr(3)]);
    assert.deepEqual(r.added, ["1", "2", "3"]);
    await flush();
    assert.deepEqual(started, [LINK(1)], "only the first starts");
    assert.equal(q.data().status, "running");
    assert.equal(item(1).state, "running");
    assert.equal(item(2).state, "queued");

    await agentDone("ses_1", "1");
    assert.equal(item(1).state, "done");
    assert.deepEqual(started, [LINK(1), LINK(2)]);
    await agentDone("ses_2", "2");
    await agentDone("ses_3", "3");
    const d = q.data();
    assert.equal(d.status, "done");
    assert.deepEqual(d.counts, { queued: 0, running: 0, done: 3, asking: 0, failed: 0, skipped: 0 });
    assert.ok(d.finished);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).status, "done", "saved to disk");
  });

  test("skips PRs waiting for the author, already queued, or already reviewed at their commit", async () => {
    make();
    reviews.set("2", { reviewed: true, commit: SHA(2), reviewedCommit: SHA(2).slice(0, 7) });
    reviews.set("4", { reviewed: true, commit: SHA(9), reviewedCommit: SHA(9).slice(0, 7) }); // new commits since
    const r = q.add([pr(1), pr(2), pr(3, { waiting: true }), pr(4), pr(1)]);
    assert.deepEqual(r.added, ["1", "4"]);
    assert.deepEqual(r.skipped.map((s) => [s.id, s.reason]), [
      ["2", "Already reviewed at this commit."],
      ["3", "You voted Waiting for author."],
      ["1", "Already in the queue."],
    ]);
    await flush();
    // More can be added while it runs; they go to the end.
    assert.deepEqual(q.add([pr(5)]).added, ["5"]);
    assert.deepEqual(q.data().items.map((i) => i.id), ["1", "4", "5"]);
  });

  test("nothing new: no run starts", () => {
    make();
    reviews.set("2", { reviewed: true, commit: SHA(2), reviewedCommit: SHA(2).slice(0, 7) });
    const r = q.add([pr(2)]);
    assert.deepEqual(r.added, []);
    assert.equal(q.data().status, "idle");
    assert.deepEqual(started, []);
  });

  test("a review that fails to start, errors, or stops to ask does not stop the queue", async () => {
    make();
    startError = "PR 1 is already being reviewed.";
    q.add([pr(1), pr(2), pr(3), pr(4)]);
    await flush();
    assert.equal(item(1).state, "failed");
    assert.equal(item(1).message, "PR 1 is already being reviewed.");
    startError = null;
    await flush();
    assert.deepEqual(started, [LINK(2)]);

    await agentDone("ses_1", "2", { reviewed: false, error: "/pr-review failed: boom" });
    assert.equal(item(2).state, "failed");
    assert.match(item(2).message, /boom/);

    // The reviewer asks which repo (AMBIGUOUS): the session idles with no review.md.
    waitingOn.add("ses_2");
    sessions.set("ses_2", { status: "idle", error: null });
    events.emit("idle", "ses_2", null);
    await flush();
    assert.equal(item(3).state, "asking");
    assert.match(item(3).message, /asking you something/);
    assert.deepEqual(started.at(-1), LINK(4));
    await agentDone("ses_3", "4");
    assert.equal(q.data().status, "done");
    assert.deepEqual(q.data().counts, { queued: 0, running: 0, done: 1, asking: 1, failed: 2, skipped: 0 });
  });

  test("the poll catches a session that ended without an idle event", async () => {
    make();
    q.add([pr(1), pr(2)]);
    await flush();
    reviews.set("1", { reviewed: true, commit: SHA(1), reviewedCommit: SHA(1).slice(0, 7) });
    sessions.set("ses_1", { status: "idle", error: null }); // no event
    q.tick();
    await flush();
    assert.equal(item(1).state, "done");
    assert.deepEqual(started, [LINK(1), LINK(2)]);
  });

  test("stop skips the rest; resume picks them up again; clear forgets", async () => {
    make();
    q.add([pr(1), pr(2), pr(3)]);
    await flush();
    q.stopRun();
    let d = q.data();
    assert.equal(d.status, "stopped");
    assert.match(d.message, /PR 1 finishes on its own/);
    assert.deepEqual(d.items.map((i) => i.state), ["running", "skipped", "skipped"]);
    await agentDone("ses_1", "1");
    assert.deepEqual(started, [LINK(1)], "nothing starts after a stop");
    assert.equal(q.resume().resumed, 2);
    await flush();
    assert.deepEqual(started, [LINK(1), LINK(2)]);
    assert.throws(() => q.clear(), /Stop it first/);
    q.stopRun();
    assert.equal(q.clear().ok, true);
    d = q.data();
    assert.equal(d.status, "idle");
    assert.deepEqual(d.items, []);
  });

  test("opencode not connected: the queue pauses, and resume carries on", async () => {
    make();
    notReady = "opencode is not connected.";
    q.add([pr(1)]);
    await flush();
    assert.equal(q.data().status, "paused");
    assert.match(q.data().message, /not connected/);
    notReady = null;
    q.resume();
    await flush();
    assert.deepEqual(started, [LINK(1)]);
  });

  test("a restart mid-run pauses; resume counts a review that finished meanwhile and goes on", async () => {
    make();
    q.add([pr(1), pr(2)]);
    await flush();
    q.stop();
    // The review of PR 1 finished while Workshop was down.
    reviews.set("1", { reviewed: true, commit: SHA(1), reviewedCommit: SHA(1).slice(0, 7) });
    make();
    let d = q.data();
    assert.equal(d.status, "paused");
    assert.match(d.message, /restarted/);
    assert.equal(item(1).state, "queued");
    q.resume();
    await flush();
    d = q.data();
    assert.equal(item(1).state, "done");
    assert.deepEqual(started, [LINK(1), LINK(2)], "PR 1 is not reviewed twice");
  });

  test("nightly: reviews the inbox Dispatch last saved, once a day, after the set time", async () => {
    clock = "2026-11-02T01:00:00";
    make({ nightlyAt: "02:00" });
    q.saveInbox([pr(1), pr(2, { waiting: true }), pr(3)]);
    q.tick();
    await flush();
    assert.deepEqual(started, [], "not yet two o'clock");
    clock = "2026-11-02T02:01:00";
    q.tick();
    await flush();
    const d = q.data();
    assert.equal(d.source, "nightly");
    assert.equal(d.nightly.last, "2026-11-02");
    assert.deepEqual(d.items.map((i) => i.id), ["1", "3"]);
    await agentDone("ses_1", "1");
    await agentDone("ses_2", "3");
    q.tick();
    await flush();
    assert.equal(started.length, 2, "once a day");
    clock = "2026-11-03T02:05:00";
    q.tick();
    await flush();
    assert.equal(q.data().message, "Nightly run: nothing new to review.", "the next night, nothing changed");
  });

  test("nightly: a time already past today starts tomorrow, and an old or missing inbox is skipped", async () => {
    clock = "2026-11-02T09:00:00";
    make({ nightlyAt: "02:00" });
    q.saveInbox([pr(1)]);
    q.tick();
    await flush();
    assert.deepEqual(started, [], "set at 9:00 for 2:00: not today");
    q.stop();

    clock = "2026-11-10T03:00:00"; // inbox saved eight days ago
    make({ nightlyAt: "02:00" });
    q.tick();
    await flush();
    assert.deepEqual(started, []);
    assert.match(q.data().message, /more than a week old/);
  });

  test("nightly waits for opencode instead of using up the day", async () => {
    clock = "2026-11-02T01:00:00";
    make({ nightlyAt: "02:00" });
    q.saveInbox([pr(1)]);
    clock = "2026-11-02T02:30:00";
    notReady = "opencode is not connected.";
    q.tick();
    await flush();
    assert.equal(q.data().nightly.last, null);
    notReady = null;
    q.tick();
    await flush();
    assert.deepEqual(started, [LINK(1)]);
  });
});

// opencode connector: wires the code review API (code-review.mjs) to this connector's model, autopilot and events.
//
// 1.28.0 (Workshop project doc claude/publish-review-v1-plan.md, eng-agents Core 4.15.0): the code review is the
// depth behind Publish. Approve publishes (Builds calls `publish` after the verdict). Send back (request changes)
// saves the comments and starts autopilot with `/revise <id> auto` first, so the comments become fix tasks and the
// build goes through the usual fix round, review, UI check and PR text before it comes back to Publish as the next
// revision. The ad hoc revision runner (revision-runner.mjs, one prompt on the branch with none of Tandem's checks)
// is gone.

import fs from "node:fs";
import path from "node:path";
import { opt, workRoot } from "./context.mjs";
import { model } from "./model.mjs";
import { folderForToken } from "./links.mjs";
import { oc } from "./opencode-state.mjs";
import { autopilot, onAutoChange, startPending } from "./autopilot.mjs";
import { broadcastLive, emit } from "./live.mjs";
import { createCodeReview, parseResponses } from "./code-review.mjs";
import { changedFiles, mergeBase, resolveSha, branchHead, isSafeBranch } from "./review-git.mjs";
import { notesFor, readingOrder, tasksWithFiles } from "./review-notes.mjs";

export let codeReview = null;
let offAuto = null;
let threadsFor = () => null; // set by the after-Publish watcher (lib/after-publish.mjs): teammates' PR comments
const startErrors = new Map(); // folder -> why /revise could not start (shown on the review's banner)

/** The after-Publish watcher hands in teammates' comments for a repo of an item: fn(folder, repo) => [thread] or null. */
export function setThreadSource(fn) {
  threadsFor = typeof fn === "function" ? fn : () => null;
}

const itemOf = (folder) => ((model && model.items) || []).find((i) => i.folder === folder) || null;

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// `review`: a review's status or revision changed. Small, like every connector event; Builds calls review.session for the data.
function emitReview(folder, repo) {
  if (!codeReview) return;
  try {
    const st = codeReview.readState(folder, repo);
    const item = itemOf(folder);
    emit("review", { id: item && item.id ? String(item.id) : null, folder, repo, status: st.status, revision: st.revision });
  } catch {}
}

/** The repos of an item that have a code review on disk (code-review/<repo>/state.json). */
export function reviewedRepos(folder) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(workRoot, folder, "code-review"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {}
  return names.filter((r) => fs.existsSync(path.join(workRoot, folder, "code-review", r, "state.json")));
}

/** Repos whose review waits on Tandem (status revising). */
function revisingRepos(folder) {
  if (!codeReview) return [];
  return reviewedRepos(folder).filter((r) => {
    try { return codeReview.readState(folder, r).status === "revising"; } catch { return false; }
  });
}

// The item's id, as /revise takes it.
const idOf = (folder) => {
  const it = itemOf(folder);
  return it && it.id ? String(it.id) : null;
};

/** Send back: start autopilot with /revise first. Throws when it cannot start (opencode, a build already running). */
export async function startRevise(folder) {
  const id = idOf(folder);
  if (!id) throw Object.assign(new Error("No such work item. Refresh the page."), { status: 404, code: "not_found" });
  try {
    const r = await startPending(folder, `/revise ${id} auto`, "Send back: Tandem is working on your comments");
    startErrors.delete(folder);
    return r;
  } catch (e) {
    startErrors.set(folder, e.message);
    throw e;
  }
}

/** The build is ready to publish again: every repo still revising becomes the next revision, with Tandem's answers. */
export function finishRevisions(folder) {
  if (!codeReview) return [];
  const done = [];
  for (const repo of revisingRepos(folder)) {
    try {
      const st = codeReview.readState(folder, repo);
      codeReview.writeState(folder, repo, { revision: st.revision + 1, status: "awaiting_review", lastReviewedHeadSha: st.lastReviewedHeadSha });
      done.push(repo);
      emitReview(folder, repo);
    } catch {}
  }
  if (done.length) broadcastLive();
  return done;
}

// Where a Send back stands, for the review screen's banner: { status: running | failed, message }.
function runInfo(folder, repo) {
  if (!codeReview) return null;
  let st;
  try { st = codeReview.readState(folder, repo); } catch { return null; }
  if (st.status !== "revising") return null;
  const a = autopilot[folder];
  if (!a) return { status: "failed", message: startErrors.has(folder) ? `Tandem could not start on them: ${startErrors.get(folder)}` : "Tandem is not working on these comments yet." };
  if (a.status === "running" || a.status === "queued" || a.status === "done") return { status: "running", message: a.message || (a.command ? `Running ${a.command}` : null) };
  return { status: "failed", message: a.message || "Tandem stopped." };
}

// What the review screen shows beside the diff: Tandem's findings, the reading order, teammates' comments.
function extras(item, repo, files) {
  const dir = path.join(workRoot, item.folder);
  let hist = [];
  try {
    hist = fs.readdirSync(path.join(dir, "history")).filter((n) => /^review-.*\.md$/i.test(n)).sort();
  } catch {}
  const rounds = hist.map((n) => ({ name: n.replace(/\.md$/i, ""), text: readText(path.join(dir, "history", n)) }));
  rounds.push({ name: "review", text: readText(path.join(dir, "review.md")) });
  const repos = (item.repos || []).map((r) => r.folder);
  const tasks = tasksWithFiles(readText(path.join(dir, "tasks.md")));
  return { files: readingOrder(files, tasks, repo), notes: notesFor(rounds, repo, repos), threads: threadsFor(item.folder, repo) || undefined };
}

/** After configure(): set up for this workspace, and pick up Send backs that finished while Workshop was off. */
export function loadReview() {
  resetReview();
  codeReview = createCodeReview({
    workspace: opt.workspace,
    workRoot,
    findItem: (wid) => {
      const folder = folderForToken(wid);
      return folder ? itemOf(folder) : null;
    },
    canRevise: () => (oc.connected && oc.api ? null : oc.error || "opencode is not connected."),
    runInfo,
    extras,
  });
  codeReview.events.on("approved", (ev) => setImmediate(() => emitReview(ev.folder, ev.repo)));
  codeReview.events.on("changes-requested", (ev) => setImmediate(async () => {
    emitReview(ev.folder, ev.repo);
    // Another repo of the same item may have started it already: one /revise reads every repo that is revising.
    const a = autopilot[ev.folder];
    if (a && (a.status === "running" || a.status === "queued")) return;
    try { await startRevise(ev.folder); } catch { /* the banner says so: runInfo reports it, Start Tandem on them retries */ }
    emitReview(ev.folder, ev.repo);
  }));
  offAuto = onAutoChange((folder, status) => {
    if (!revisingRepos(folder).length) return;
    if (status === "done") finishRevisions(folder);
    else for (const r of revisingRepos(folder)) emitReview(folder, r);
  });
  // A Send back whose build finished before a restart: ready to publish, nothing running.
  for (const it of (model && model.items) || []) {
    const a = autopilot[it.folder];
    if (it.next && it.next.stage === "ship" && (!a || a.status === "done") && revisingRepos(it.folder).length && fs.existsSync(path.join(workRoot, it.folder, "revise.md"))) finishRevisions(it.folder);
  }
}

/** On stop or restart. */
export function resetReview() {
  if (codeReview) codeReview.events.removeAllListeners();
  if (offAuto) offAuto();
  offAuto = null;
  codeReview = null;
}

/** `review.revise`: start Tandem on comments it is not working on (opencode was down, or it stopped). */
export async function reviseAgain(id) {
  const folder = folderForToken(String(id || ""));
  if (!folder || !itemOf(folder)) throw Object.assign(new Error("No such work item. Refresh the page."), { status: 404, code: "not_found" });
  if (!revisingRepos(folder).length) throw Object.assign(new Error("There are no comments waiting for Tandem on this item."), { status: 409, code: "conflict" });
  const r = await startRevise(folder);
  for (const repo of revisingRepos(folder)) emitReview(folder, repo);
  return r;
}

// The newest Send back of a repo: how many comments, and how many must fix comments Tandem declined last time.
function sendBackInfo(folder, repo, st) {
  const dir = path.join(workRoot, folder, "code-review", repo);
  const out = { comments: 0, openMustFix: 0 };
  if (st.status === "revising") {
    const fb = readJson(path.join(dir, `rev-${st.revision}.json`));
    out.comments = fb && Array.isArray(fb.comments) ? fb.comments.length + (fb.summary && String(fb.summary).trim() ? 1 : 0) : 0;
  }
  if (st.revision > 1) {
    const fb = readJson(path.join(dir, `rev-${st.revision - 1}.json`));
    const r = parseResponses(readText(path.join(dir, `rev-${st.revision - 1}-response.json`)) || "[]");
    const declined = new Set((r.list || []).filter((x) => x.status === "declined").map((x) => x.commentId));
    out.openMustFix = fb && Array.isArray(fb.comments) ? fb.comments.filter((c) => c.type === "must_fix" && declined.has(c.id)).length : 0;
  }
  return out;
}

/** For `state`: each item's review per repo. {"<folder>": {"<repo>": {status, revision, started, run, sentBack, openMustFix}}}.
 *  started: false means nobody has reviewed it yet (no state.json). */
export function reviewSummary() {
  const out = {};
  if (!codeReview) return out;
  for (const it of (model && model.items) || []) {
    const repos = new Set([...(it.pr || []).map((p) => p.repo), ...reviewedRepos(it.folder)]);
    for (const repo of repos) {
      if (!repo || /[\\/:*?"<>|]/.test(repo) || repo.startsWith(".")) continue;
      let st;
      try { st = codeReview.readState(it.folder, repo); } catch { continue; }
      const sb = st.saved ? sendBackInfo(it.folder, repo, st) : { comments: 0, openMustFix: 0 };
      (out[it.folder] ||= {})[repo] = { status: st.status, revision: st.revision, started: st.saved, run: runInfo(it.folder, repo), sentBack: sb.comments, openMustFix: sb.openMustFix };
    }
  }
  return out;
}

// --------------------------------------------------------------------------- diff size on the Publish block

const stats = new Map(); // "<folder>|<repo>" -> { head, files, additions, deletions }
const busy = new Set();
const pending = new Set(); // fills still running git: stop waits for them, since git holds the repo folder open on Windows

/** Resolves once no background git for the change size is running (the connector's stop awaits it). */
export async function reviewGone() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** `8 files, +214 -37` per repo of a ready item, from git (cached by the branch head; filled in the background). */
export function diffStats(it) {
  const out = [];
  for (const row of (it && it.pr) || []) {
    const s = stats.get(`${it.folder}|${row.repo}`);
    out.push(s ? { repo: row.repo, files: s.files, additions: s.additions, deletions: s.deletions } : { repo: row.repo, files: null, additions: null, deletions: null });
    const p = fill(it, row).catch(() => {});
    pending.add(p);
    p.then(() => pending.delete(p));
  }
  return out;
}

async function fill(it, row) {
  const key = `${it.folder}|${row.repo}`;
  if (busy.has(key) || !opt || !opt.workspace) return;
  const dir = path.resolve(opt.workspace, String(row.repo || ""));
  if (!row.repo || !dir.startsWith(path.resolve(opt.workspace) + path.sep) || !isSafeBranch(row.branch) || !isSafeBranch(String(row.target || "main"))) return;
  busy.add(key);
  try {
    const head = await branchHead(dir, row.branch);
    if (!head) return;
    const was = stats.get(key);
    if (was && was.head === head) return;
    const target = String(row.target || "main");
    const baseTip = (await resolveSha(dir, target.startsWith("origin/") ? target : `origin/${target}`)) || (await resolveSha(dir, target));
    if (!baseTip) return;
    const base = await mergeBase(dir, baseTip, head);
    if (!base) return;
    const files = await changedFiles(dir, base, head);
    stats.set(key, { head, files: files.length, additions: files.reduce((n, f) => n + (f.additions || 0), 0), deletions: files.reduce((n, f) => n + (f.deletions || 0), 0) });
    broadcastLive();
  } finally {
    busy.delete(key);
  }
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

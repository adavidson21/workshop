// opencode connector: the revision runner. When a reviewer requests changes in Dispatch, it
// turns the feedback into one revision task, runs it in opencode on the same branch, and returns the
// item to review as the next revision once the agent has written its response file.
//
//   1. code-review.mjs saves rev-<n>.json, sets the status to "revising", and emits "changes-requested".
//   2. This builds the revision prompt and sends it through the same opencode launcher the page uses,
//      in the item's current session when it is idle (so the agent keeps its context), else a new one.
//   3. When that session goes idle it checks the agent's work:
//        - rev-<n>-response.json exists and is valid
//        - the branch head still contains the last reviewed head (no rewritten history)
//      Then it sets revision n+1, status "awaiting_review", and emits "revision-ready".
//      If a check fails, the review stays "revising" and the run is marked failed with the reason.
//      Replying to the agent in that session re-runs the checks when its turn ends.
//
// Run state, next to the review: .work/<folder>/code-review/<repo>/run.json
//   { revision, branch, session, status: "running" | "failed" | "done", message, startedAt, updatedAt }
//
// Kept free of context.mjs: review.mjs passes in the launcher and the session events.
//
// Copied from eng-agents core/scripts/dashboard/server/revision-runner.mjs (gone from eng-agents since Core 2.11.0; this is the only copy) on branch
// dev/feature/review-api at 2626601, unchanged apart from these comments.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { parseResponses } from "./code-review.mjs";
import { branchHead, isAncestor } from "./review-git.mjs";

const CHECK_DELAY_MS = 1500; // let the agent's last file writes land before checking

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// The revision prompt from the spec's template. Paths use forward slashes: the agent runs from the
// workspace root, and opencode accepts them on every platform.
export function buildRevisionPrompt({ workItemId, repo, branch, responsePath, feedback }) {
  const out = [];
  out.push(`You are revising work item ${workItemId} on branch ${branch} in repo folder ${repo}.`);
  out.push("A reviewer requested changes. Address every comment below.");
  out.push("");
  out.push("Rules:");
  out.push("- Fix all MUST_FIX items.");
  out.push("- Apply SUGGESTION items unless you have a clear reason not to; if not, explain.");
  out.push("- Answer QUESTION items in your response file; change code only if needed.");
  out.push("- Commit on top of the current branch. Do not rewrite history.");
  out.push(`- When done, write ${responsePath} as JSON: [{"commentId": "...", "status": "fixed|declined|answered", "note": "..."}]`);
  out.push("");
  out.push("Reviewer summary:");
  out.push((feedback.summary || "").trim() || "(none)");
  out.push("");
  out.push("Comments:");
  if (!feedback.comments.length) out.push("(none)");
  for (const c of feedback.comments) {
    out.push("");
    out.push(`[${c.id}] ${c.type.toUpperCase()} ${c.path} lines ${c.startLine}-${c.endLine} (${c.side})`);
    for (const line of String(c.quotedCode).replace(/\r\n/g, "\n").split("\n")) out.push(`> ${line}`);
    out.push(c.body);
    if (c.suggestedCode !== undefined) {
      out.push("Proposed replacement:");
      out.push(c.suggestedCode);
    }
  }
  return out.join("\n") + "\n";
}

// deps:
//   codeReview      the object from createCodeReview (state and folders)
//   workspace       absolute workspace root
//   workRoot        absolute path of .work
//   launcher        { start({ folder, title, prompt }) => Promise<sessionId> }
//   sessionEvents   EventEmitter with "idle" (sessionId, error) when an opencode session's turn ends
//   log             (...args) => void
//   now, delayMs    tests
export function createRevisionRunner({ codeReview, workspace, workRoot, launcher, sessionEvents, log = () => {}, now = () => new Date(), delayMs = CHECK_DELAY_MS }) {
  const events = new EventEmitter();
  const bySession = new Map(); // sessionId -> { folder, repo }
  const checking = new Set();

  const runFile = (folder, repo) => path.join(codeReview.stateDir(folder, repo), "run.json");

  function readRun(folder, repo) {
    try {
      return JSON.parse(fs.readFileSync(runFile(folder, repo), "utf8"));
    } catch {
      return null;
    }
  }

  function saveRun(folder, repo, run) {
    run.updatedAt = now().toISOString();
    writeJsonAtomic(runFile(folder, repo), run);
    if (run.session && run.status !== "done") bySession.set(run.session, { folder, repo });
    else if (run.session) bySession.delete(run.session);
    events.emit("run", { folder, repo, run });
  }

  const relResponse = (folder, repo, n) => [".work", folder, "code-review", repo, `rev-${n}-response.json`].join("/");

  // Start the revision for a "changes-requested" event from code-review.mjs.
  async function onChangesRequested(ev) {
    const { workItemId, folder, repo, branch, revision, feedback } = ev;
    const prompt = buildRevisionPrompt({ workItemId, repo, branch, responsePath: relResponse(folder, repo, revision), feedback });
    const run = { revision, branch, session: null, status: "running", message: "Starting the revision.", startedAt: now().toISOString() };
    saveRun(folder, repo, run);
    try {
      run.session = await launcher.start({ folder, title: `${workItemId}: code review revision ${revision} (${repo})`, prompt });
      run.message = "The agent is revising.";
      saveRun(folder, repo, run);
      log(`code review: revision ${revision} of ${workItemId} (${repo}) running in ${run.session}`);
    } catch (e) {
      run.status = "failed";
      run.message = `Could not start the revision: ${e.message}`;
      saveRun(folder, repo, run);
      log(`code review: ${run.message}`);
    }
  }

  // Check the agent's work for one review. Safe to call more than once.
  async function check(folder, repo, sessionError) {
    const key = `${folder}\n${repo}`;
    if (checking.has(key)) return;
    checking.add(key);
    try {
      const run = readRun(folder, repo);
      const state = codeReview.readState(folder, repo);
      if (!run || run.status === "done" || state.status !== "revising" || run.revision !== state.revision) return;
      const n = state.revision;
      const fail = (message) => {
        run.status = "failed";
        run.message = message;
        saveRun(folder, repo, run);
        log(`code review: revision ${n} (${folder}, ${repo}) needs you: ${message}`);
      };

      const responseFile = path.join(workspace, ...relResponse(folder, repo, n).split("/"));
      let text;
      try {
        text = fs.readFileSync(responseFile, "utf8");
      } catch {
        return fail(`${sessionError ? `The agent stopped (${sessionError}). ` : ""}It did not write ${relResponse(folder, repo, n)}. Reply to the agent to finish.`);
      }
      const parsed = parseResponses(text);
      if (parsed.problem) return fail(`The response file is not valid: ${parsed.problem} Reply to the agent to fix it.`);

      const feedback = JSON.parse(fs.readFileSync(path.join(codeReview.stateDir(folder, repo), `rev-${n}.json`), "utf8"));
      const repoDir = path.resolve(workspace, repo);
      const head = run.branch ? await branchHead(repoDir, run.branch) : null;
      if (!head) return fail(`Could not find the branch head in ${repo}.`);
      const kept = await isAncestor(repoDir, feedback.headSha, head);
      if (kept === false) return fail("The branch no longer contains the reviewed commit, so history was rewritten. Restore it, then reply to the agent.");
      if (kept === null) return fail("Could not compare the branch with the reviewed commit.");

      codeReview.writeState(folder, repo, { revision: n + 1, status: "awaiting_review", lastReviewedHeadSha: feedback.headSha });
      run.status = "done";
      run.message = `Revision ${n + 1} is ready for review.`;
      saveRun(folder, repo, run);
      log(`code review: ${folder} (${repo}) is ready for review as revision ${n + 1}`);
      events.emit("revision-ready", { folder, repo, revision: n + 1, headSha: head });
    } finally {
      checking.delete(key);
    }
  }

  codeReview.events.on("changes-requested", (ev) => {
    onChangesRequested(ev).catch((e) => log(`code review: ${e.message}`));
  });

  sessionEvents.on("idle", (sid, error) => {
    const where = bySession.get(sid);
    if (!where) return;
    setTimeout(() => {
      check(where.folder, where.repo, error || null).catch((e) => log(`code review check: ${e.message}`));
    }, delayMs);
  });

  // After a restart: follow the runs that are not done yet.
  function load() {
    let folders = [];
    try {
      folders = fs.readdirSync(workRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."));
    } catch {
      return;
    }
    for (const f of folders) {
      const base = path.join(workRoot, f.name, "code-review");
      // Repo folders are "repo" or "Category/repo", so a folder with no run.json may hold repos one down.
      const dirs = (p) => {
        try {
          return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
        } catch {
          return [];
        }
      };
      const repos = [];
      for (const name of dirs(base)) {
        if (fs.existsSync(runFile(f.name, name))) repos.push(name);
        else for (const sub of dirs(path.join(base, name))) repos.push(`${name}/${sub}`);
      }
      for (const repo of repos) {
        const run = readRun(f.name, repo);
        if (run && run.session && run.status !== "done") bySession.set(run.session, { folder: f.name, repo });
      }
    }
  }

  // What Dispatch shows while a review is revising.
  function runData(folder, repo) {
    const run = readRun(folder, repo);
    return run ? { status: run.status, message: run.message || null, session: run.session || null, revision: run.revision } : null;
  }

  return { events, check, load, runData };
}

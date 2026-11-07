// opencode connector: the code review API for Dispatch's review screen (README.md, Code review).
//
// Copied from eng-agents core/scripts/dashboard/server/code-review.mjs (gone from eng-agents since Core 2.11.0; this is the only copy) on branch dev/feature/review-api
// at 2626601. Changes: errors carry the agent API's codes and no extra fields (Dispatch reloads the
// review on any conflict); the live server's HTTP route helpers are gone (index.mjs has actions).
//
// One review per work item and repo, served from git in the local workspace. Read-only toward repos:
// it never commits, checks out, or pushes. Approve only records the verdict; pushing is wired
// separately. Request changes records the feedback, sets the status to "revising", and emits
// "changes-requested" for the revision runner to pick up.
//
// Storage, per work item and repo:
//   .work/<folder>/code-review/<repo>/state.json    { revision, status, lastReviewedHeadSha }
//   .work/<folder>/code-review/<repo>/rev-<n>.json  the ReviewFeedback submitted for revision n
//   .work/<folder>/code-review/<repo>/rev-<n>-response.json  the agent's answers (revision-runner.mjs)
//
// Kept free of context.mjs: live-server.mjs passes in what it needs, so tests can run it alone.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { branchHead, changedFiles, fileAt, isSafeBranch, isSafePath, mergeBase, resolveSha } from "./review-git.mjs";

// The stage right before Push: pr.md is written ("pr" is the step that writes it), so the branch and its
// target are known.
export const READY_STAGE = "ship";
const STATUSES = new Set(["awaiting_review", "revising", "approved"]);
const COMMENT_TYPES = new Set(["must_fix", "suggestion", "question"]);
const RESPONSE_STATUSES = new Set(["fixed", "declined", "answered"]);
const MAX_COMMENTS = 500;
const MAX_TEXT = 100_000; // per text field

// Errors carry the status and code the agent API uses (docs/agent-api.md), like context.mjs's httpError.
const CODES = { 400: "bad_request", 404: "not_found", 409: "conflict", 500: "internal", 503: "unavailable" };
function httpError(status, message) {
  const e = new Error(message);
  e.status = CODES[status] ? status : 500;
  e.code = CODES[e.status];
  return e;
}

// Write a file so readers never see half of it: temp file, then rename.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw httpError(500, `Could not read ${path.basename(file)}: ${e.message}`);
  }
}

// A repo folder name from pr.md, used as one path segment under code-review/.
function isSafeRepoName(repo) {
  return typeof repo === "string" && !!repo && repo.length <= 255 && !/[\\/:*?"<>|\0]/.test(repo) && !repo.startsWith(".") && repo !== "..";
}

const isInt = (n) => Number.isInteger(n) && n >= 1;
const isStr = (s, max = MAX_TEXT) => typeof s === "string" && s.length <= max;

// Checks a ReviewFeedback body against the spec's types. Returns a plain-words problem, or null.
export function feedbackProblem(fb) {
  if (!fb || typeof fb !== "object" || Array.isArray(fb)) return "The body must be a ReviewFeedback object.";
  if (!isStr(fb.workItemId, 64) || !fb.workItemId) return "workItemId is required.";
  if (!isStr(fb.repo, 255) || !fb.repo) return "repo is required.";
  if (!isInt(fb.revision)) return "revision must be a whole number from 1.";
  if (!isStr(fb.headSha, 64) || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(fb.headSha)) return "headSha must be a full commit sha.";
  if (fb.verdict !== "approve" && fb.verdict !== "request_changes") return 'verdict must be "approve" or "request_changes".';
  if (fb.summary !== undefined && !isStr(fb.summary)) return "summary must be text.";
  if (!Array.isArray(fb.comments)) return "comments must be a list.";
  if (fb.comments.length > MAX_COMMENTS) return `At most ${MAX_COMMENTS} comments per review.`;
  const ids = new Set();
  for (const [i, c] of fb.comments.entries()) {
    const at = `Comment ${i + 1}`;
    if (!c || typeof c !== "object") return `${at} is not an object.`;
    if (!isStr(c.id, 128) || !c.id) return `${at} needs an id.`;
    if (ids.has(c.id)) return `${at} repeats id ${c.id}.`;
    ids.add(c.id);
    if (!isSafePath(c.path)) return `${at} has a bad path.`;
    if (c.side !== "old" && c.side !== "new") return `${at}: side must be "old" or "new".`;
    if (!isInt(c.startLine) || !isInt(c.endLine) || c.endLine < c.startLine) return `${at}: startLine and endLine must be whole numbers with startLine <= endLine.`;
    if (!isStr(c.quotedCode)) return `${at}: quotedCode must be text.`;
    if (!COMMENT_TYPES.has(c.type)) return `${at}: type must be must_fix, suggestion, or question.`;
    if (!isStr(c.body)) return `${at}: body must be text.`;
    if (c.suggestedCode !== undefined && !isStr(c.suggestedCode)) return `${at}: suggestedCode must be text.`;
  }
  if (fb.verdict === "request_changes" && fb.comments.length === 0 && !(fb.summary || "").trim()) {
    return "Request changes needs at least one comment or a summary.";
  }
  return null;
}

// Keep only the fields in the contract, so nothing extra lands on disk or reaches the agent.
function cleanFeedback(fb, submittedAt) {
  return {
    workItemId: fb.workItemId,
    repo: fb.repo,
    revision: fb.revision,
    headSha: fb.headSha,
    verdict: fb.verdict,
    ...(fb.summary !== undefined && { summary: fb.summary }),
    comments: fb.comments.map((c) => ({
      id: c.id,
      path: c.path,
      side: c.side,
      startLine: c.startLine,
      endLine: c.endLine,
      quotedCode: c.quotedCode,
      type: c.type,
      body: c.body,
      ...(c.suggestedCode !== undefined && { suggestedCode: c.suggestedCode }),
    })),
    submittedAt,
  };
}

// A response file the agent wrote: [{ commentId, status: fixed|declined|answered, note }].
// Returns the list, or a plain-words problem.
export function parseResponses(text) {
  let list;
  try {
    list = JSON.parse(text);
  } catch (e) {
    return { problem: `It is not valid JSON (${e.message}).` };
  }
  if (!Array.isArray(list)) return { problem: "It must be a JSON list." };
  for (const [i, r] of list.entries()) {
    if (!r || typeof r !== "object" || !isStr(r.commentId, 128) || !r.commentId) return { problem: `Entry ${i + 1} needs a commentId.` };
    if (!RESPONSE_STATUSES.has(r.status)) return { problem: `Entry ${i + 1}: status must be fixed, declined, or answered.` };
    if (r.note !== undefined && !isStr(r.note)) return { problem: `Entry ${i + 1}: note must be text.` };
  }
  return { list: list.map((r) => ({ commentId: r.commentId, status: r.status, note: r.note || "" })) };
}

// deps:
//   workspace   absolute workspace root (repos are folders directly inside it)
//   workRoot    absolute path of .work
//   findItem    (workItemId) => the work item from New-Dashboard.ps1 -AsJson, or null
//   canRevise   optional () => null, or a plain-words reason a revision cannot start right now
//               (checked before request changes is saved, so a verdict never strands an item)
//   runInfo     optional (folder, repo) => the revision run's { status, message, session, revision }, or null
//   now         () => Date (tests)
export function createCodeReview({ workspace, workRoot, findItem, canRevise = () => null, runInfo = () => null, now = () => new Date() }) {
  const events = new EventEmitter();
  const submitting = new Set();

  function stateDir(folder, repo) {
    return path.join(workRoot, folder, "code-review", repo);
  }

  function readState(folder, repo) {
    const s = readJson(path.join(stateDir(folder, repo), "state.json"));
    if (!s) return { revision: 1, status: "awaiting_review", lastReviewedHeadSha: null, saved: false };
    if (!isInt(s.revision) || !STATUSES.has(s.status)) throw httpError(500, `state.json for ${repo} is not valid. Fix or delete it.`);
    return { revision: s.revision, status: s.status, lastReviewedHeadSha: s.lastReviewedHeadSha || null, saved: true };
  }

  function writeState(folder, repo, state) {
    writeJsonAtomic(path.join(stateDir(folder, repo), "state.json"), {
      revision: state.revision,
      status: state.status,
      lastReviewedHeadSha: state.lastReviewedHeadSha,
    });
  }

  // The work item, its pr.md row for the repo, and the repo folder on disk.
  function locate(workItemId, repo) {
    const wid = String(workItemId || "").trim();
    if (!/^(\d{1,10}|L\d{1,10})$/.test(wid)) throw httpError(400, "The work item id must be a number, or L and a number for a local item.");
    if (!isSafeRepoName(repo)) throw httpError(400, "Pass the repo folder as ?repo=.");
    const item = findItem(wid);
    if (!item) throw httpError(404, `No work item ${wid} in .work. Refresh and try again.`);
    const row = (item.pr || []).find((p) => p.repo === repo);
    const dir = path.resolve(workspace, repo);
    if (path.isAbsolute(repo) || !dir.startsWith(path.resolve(workspace) + path.sep)) throw httpError(400, "Bad repo folder.");
    return { wid, item, row, dir };
  }

  // Shas for the review. Base is pr.md's target: origin/<target> if this clone has it, else <target>.
  async function resolveShas(row, dir, repo) {
    if (!fs.existsSync(dir)) throw httpError(404, `Repo folder ${repo} not found in the workspace.`);
    const branch = row.branch;
    if (!isSafeBranch(branch)) throw httpError(409, `pr.md names no usable branch for ${repo}.`);
    const target = String(row.target || "");
    if (!isSafeBranch(target)) throw httpError(409, `pr.md names no usable target branch for ${repo}.`);
    const headSha = await branchHead(dir, branch);
    if (!headSha) throw httpError(409, `${repo} has no local branch ${branch}.`);
    const baseRef = target.startsWith("origin/") ? target : (await resolveSha(dir, `origin/${target}`)) ? `origin/${target}` : target;
    const baseTip = await resolveSha(dir, baseRef);
    if (!baseTip) throw httpError(409, `${repo} has no branch ${target} to compare against.`);
    const baseSha = await mergeBase(dir, baseTip, headSha);
    if (!baseSha) throw httpError(409, `${branch} and ${baseRef} share no history in ${repo}.`);
    return { branch, baseBranch: baseRef, baseSha, headSha };
  }

  // Not ready: no saved review yet and the item is not at the ship stage.
  function notReady(item, repo, row) {
    if (!row) throw httpError(409, `Work item ${item.id} has no pr.md section for ${repo} yet.`);
    throw httpError(409, `Work item ${item.id} is not ready for review (stage: ${item.stage || "unknown"}).`);
  }

  // GET /api/shell/code-review/:workItemId?repo=
  async function getSession(workItemId, repo) {
    const { wid, item, row, dir } = locate(workItemId, repo);
    const state = readState(item.folder, repo);
    if (!row || (!state.saved && item.stage !== READY_STAGE)) notReady(item, repo, row);
    const shas = await resolveShas(row, dir, repo);
    const files = await changedFiles(dir, shas.baseSha, shas.headSha);
    const dirOf = stateDir(item.folder, repo);
    const prev = state.revision > 1 ? readJson(path.join(dirOf, `rev-${state.revision - 1}.json`)) : null;
    let responses = null;
    if (prev) {
      try {
        const r = parseResponses(fs.readFileSync(path.join(dirOf, `rev-${state.revision - 1}-response.json`), "utf8"));
        if (r.list) responses = r.list;
      } catch {} // no response file: nothing to show
    }
    // Changes since the last reviewed head, when that commit is still in the repo.
    let since = null;
    const prevSha = state.revision > 1 ? state.lastReviewedHeadSha : null;
    if (prevSha && (await resolveSha(dir, prevSha))) since = await changedFiles(dir, prevSha, shas.headSha);
    const run = runInfo(item.folder, repo);
    return {
      workItemId: wid,
      repo,
      revision: state.revision,
      branch: shas.branch,
      baseBranch: shas.baseBranch,
      baseSha: shas.baseSha,
      headSha: shas.headSha,
      status: state.status,
      files,
      ...(prev && { previousFeedback: prev }),
      ...(responses && { previousResponses: responses }),
      ...(since && { sinceLastReview: since }),
      ...(run && { revisionRun: run }),
    };
  }

  // GET /api/shell/code-review/:workItemId/file?repo=&path=&side=
  // side=old reads the path at baseSha (pass oldPath for renames); side=new reads it at headSha;
  // side=prev reads it at the last reviewed head (revision 2 and later).
  async function getFile(workItemId, repo, filePath, side) {
    const { item, row, dir } = locate(workItemId, repo);
    if (side !== "old" && side !== "new" && side !== "prev") throw httpError(400, 'side must be "old", "new", or "prev".');
    if (!isSafePath(filePath)) throw httpError(400, "Bad file path.");
    const state = readState(item.folder, repo);
    if (!row || (!state.saved && item.stage !== READY_STAGE)) notReady(item, repo, row);
    const shas = await resolveShas(row, dir, repo);
    let sha = side === "old" ? shas.baseSha : shas.headSha;
    if (side === "prev") {
      if (state.revision < 2 || !state.lastReviewedHeadSha) throw httpError(400, "side=prev is only for revision 2 and later.");
      if (!(await resolveSha(dir, state.lastReviewedHeadSha))) throw httpError(409, "The last reviewed commit is no longer in the repo.");
      sha = state.lastReviewedHeadSha;
    }
    const r = await fileAt(dir, sha, filePath);
    return r.kind === "missing" ? { kind: "absent" } : r;
  }

  // POST /api/shell/code-review/:workItemId/submit?repo=   body: ReviewFeedback
  async function submit(workItemId, repo, body) {
    const { wid, item, row, dir } = locate(workItemId, repo);
    const problem = feedbackProblem(body);
    if (problem) throw httpError(400, problem);
    if (body.workItemId !== wid) throw httpError(400, `The body is for work item ${body.workItemId}, not ${wid}.`);
    if (body.repo !== repo) throw httpError(400, `The body is for repo ${body.repo}, not ${repo}.`);

    const key = `${item.folder}\n${repo}`;
    if (submitting.has(key)) throw httpError(409, "A review for this item is already being submitted.");
    submitting.add(key);
    try {
      const state = readState(item.folder, repo);
      if (!row || (!state.saved && item.stage !== READY_STAGE)) notReady(item, repo, row);
      if (state.status !== "awaiting_review") throw httpError(409, `This review is ${state.status.replace("_", " ")}, so it cannot take a new verdict.`);
      if (body.revision !== state.revision) throw httpError(409, `This is revision ${state.revision}, not ${body.revision}. Reload the review.`);
      const shas = await resolveShas(row, dir, repo);
      if (body.headSha !== shas.headSha) {
        throw httpError(409, `${shas.branch} changed since this review was loaded. Reload to see the new code.`);
      }

      if (body.verdict === "request_changes") {
        const why = canRevise();
        if (why) throw httpError(503, `The agent cannot start a revision right now: ${why}`);
      }
      const feedback = cleanFeedback(body, now().toISOString());
      const revFile = path.join(stateDir(item.folder, repo), `rev-${state.revision}.json`);
      if (fs.existsSync(revFile)) throw httpError(409, `Revision ${state.revision} already has a verdict.`);
      writeJsonAtomic(revFile, feedback);
      const next = { revision: state.revision, status: feedback.verdict === "approve" ? "approved" : "revising", lastReviewedHeadSha: feedback.headSha };
      writeState(item.folder, repo, next);

      const event = { workItemId: wid, folder: item.folder, repo, repoDir: dir, branch: shas.branch, revision: state.revision, feedback };
      // Listeners run after the response is built; a throwing listener must not undo a saved verdict.
      setImmediate(() => {
        try {
          events.emit(feedback.verdict === "approve" ? "approved" : "changes-requested", event);
        } catch {}
      });
      return { ok: true, status: next.status, revision: next.revision, submittedAt: feedback.submittedAt };
    } finally {
      submitting.delete(key);
    }
  }

  return { events, getSession, getFile, submit, readState, writeState, stateDir };
}

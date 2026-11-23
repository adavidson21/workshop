// opencode connector: after Publish (1.28.0, Workshop project doc claude/after-publish-v1-plan.md, eng-agents Core 4.15.0).
//
// Workshop's agent watches each published PR (agent/lib/pr-watch.mjs, every 5 minutes): it asks this connector what to
// watch (`published.watch`), asks the ADO or GitHub connector where each PR stands (`pr.status`), and hands the answer
// back here (`published.record`). This module decides what follows, never pushing anything itself:
//   - CI failed, and the same check passes on the target branch: write ci/failure-<n>.md (the failed checks and the end
//     of their logs) and start autopilot with `/pr-fix <id> ci auto`, at most 2 rounds per PR. Tandem commits a fix on
//     the branch; Loom shows Push fix, and you push it.
//   - The PR conflicts with its base: ci/conflict-<n>.md and `/pr-fix <id> conflict auto` (a merge, never a rebase).
//   - Teammates' comments: kept in memory for the code review screen (lib/review.mjs), where you can send them back.
//   - Merged: the item is done. Its worktrees are removed (the .work folder stays) and `/retro <id> auto` runs.
//   - Abandoned: the publish record goes, so the item is back at Publish.
// The state lives in published.json (lib/publish.mjs), per repo under `watch`.
//
// 1.29.0, merge without a PR (lib/merge.mjs): a merge that conflicts writes ci/conflict-<n>.md and starts the same
// `/pr-fix <id> conflict auto` (startMergeFix); Loom shows its result and you publish again. A merge that went through
// finishes like a merged PR (finishMerged): worktrees removed, /retro.

import fs from "node:fs";
import path from "node:path";
import { httpError, log, opt, workRoot } from "./context.mjs";
import { publishedRecords, updatePublished, forgetPublished } from "./publish.mjs";
import { autopilot, onAutoChange, startPending } from "./autopilot.mjs";
import { remoteWeb } from "./workparser.mjs";
import { broadcastLive, emit } from "./live.mjs";
import { setThreadSource } from "./review.mjs";

export const MAX_FIX_ROUNDS = 2;
const threads = new Map(); // "<folder>|<repo>" -> [thread]
const mergeFixes = new Map(); // folder -> {repo, target, file, state: working | ready | not-fixed | needs-you, text, at}
let off = null;

const nowIso = () => new Date().toISOString();

/** What the watcher should check: published items not merged yet, each repo with its remote and host. */
export function watchList(items) {
  const out = [];
  const recs = publishedRecords();
  for (const [folder, rec] of Object.entries(recs)) {
    if (!rec || rec.merged) continue;
    const it = (items || []).find((i) => i.folder === folder);
    if (!it) continue;
    const repos = [];
    for (const r of rec.repos || []) {
      const row = (it.pr || []).find((p) => p.repo === r.repo) || {};
      const web = remoteWeb(row.web || "");
      if (!web || !r.branch) continue;
      repos.push({ repo: r.repo, branch: r.branch, target: r.target || "main", remote: web.url, host: web.kind === "ado" ? "ado" : "github", logs: true });
    }
    if (repos.length) out.push({ folder, id: it.id ? String(it.id) : null, repos });
  }
  return out;
}

function nextFile(folder, kind) {
  const dir = path.join(workRoot, folder, "ci");
  fs.mkdirSync(dir, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(dir, `${kind}-${n}.md`))) n++;
  return { dir, name: `${kind}-${n}.md` };
}

/** ci/failure-<n>.md: what Tandem's /pr-fix reads (eng-agents Core 4.15.0). */
export function failureText({ id, repo, branch, target, status }) {
  const lines = [`# CI failure: ${repo} PR ${status.id}`, "", `- Item: ${id}`, `- Repo: ${repo}`, `- Branch: ${branch}`, `- Base: ${target}`, `- PR: ${status.url}`, `- Commit: ${status.head || "unknown"}`, `- Found: ${nowIso()}`, ""];
  for (const c of (status.ci && status.ci.checks) || []) {
    if (c.state !== "failed") continue;
    lines.push(`## ${String(c.name).replace(/\r?\n/g, " ")}`, "", ...(c.url ? [`- Link: ${c.url}`, ""] : []), "```text", String(c.log || "No log was readable for this check.").replace(/```/g, "'''"), "```", "");
  }
  return lines.join("\n");
}

/** ci/conflict-<n>.md. */
export function conflictText({ id, repo, branch, target, status }) {
  return [`# Conflict: ${repo} PR ${status.id}`, "", `- Item: ${id}`, `- Repo: ${repo}`, `- Branch: ${branch}`, `- Base: ${target}`, `- PR: ${status.url}`, `- Commit: ${status.head || "unknown"}`, `- Found: ${nowIso()}`, ""].join("\n");
}

/** ci/conflict-<n>.md for a merge without a PR: the files git could not merge. */
export function mergeConflictText({ id, repo, branch, target, files, head }) {
  return [`# Conflict: ${repo} into ${target} (merge without a PR)`, "", `- Item: ${id}`, `- Repo: ${repo}`, `- Branch: ${branch}`, `- Base: ${target}`, "- PR: none (Publish merges without a PR)", `- Commit: ${head || "unknown"}`, `- Found: ${nowIso()}`, "",
    "## Files git could not merge", "", ...((files || []).length ? files.map((f) => `- \`${f}\``) : ["- (git did not name them)"]), ""].join("\n");
}

/** Publish's merge conflicted: write the ci file and start Tandem's merge of the target into the branch. */
export async function startMergeFix(it, c) {
  const id = it && it.id ? String(it.id) : null;
  if (!id) throw httpError(409, `${c.repo} conflicts with ${c.target}. Merge ${c.target} into ${c.branch} yourself, then publish again.`);
  const f = nextFile(it.folder, "conflict");
  fs.writeFileSync(path.join(f.dir, f.name), mergeConflictText({ id, ...c }));
  mergeFixes.set(it.folder, { repo: c.repo, target: c.target, file: `ci/${f.name}`, state: "working", text: null, at: nowIso() });
  try {
    await startPending(it.folder, `/pr-fix ${id} conflict auto`, `${c.repo} conflicts with ${c.target}: Tandem is merging it in`);
  } catch (e) {
    mergeFixes.set(it.folder, { ...mergeFixes.get(it.folder), state: "needs-you", text: `Tandem could not start: ${e.message}` });
  }
  broadcastLive();
}

/** Tandem's merge of the target into the branch after a merge conflict, for Loom, or null. */
export const mergeFixOf = (folder) => mergeFixes.get(folder) || null;
export const clearMergeFix = (folder) => mergeFixes.delete(folder);

/** An item is merged (every PR, or the merge without a PR): remove its worktrees and run the retro. */
export async function finishMerged(folder, it, deps, repo = null) {
  mergeFixes.delete(folder);
  emit("published", { folder, repo, event: "merged" });
  if (!it) return;
  const id = it.id ? String(it.id) : null;
  try { await deps.removeWorktrees(it); } catch (e) { log(`after publish: worktrees of ${folder}: ${e.message}`); }
  // 1.36.0: with a local model the retro is yours to run (/retro <id>), so a merge does not take the one GPU.
  const local = deps.local !== undefined ? deps.local : !!(opt && opt.local);
  if (id && local) { log(`after publish: ${folder} merged; no /retro on a local model (run /retro ${id} when you want one)`); return; }
  if (id) { try { await deps.runCommand({ folder, command: `/retro ${id} auto` }, { fresh: true }); } catch (e) { log(`after publish: /retro ${id}: ${e.message}`); } }
}

/** The `- Result:` line /pr-fix added to a ci file: {kind: fixed | not-fixed | needs-you, text}, or null. */
export function resultOf(text) {
  const m = /^\s*-\s*Result:\s*(FIXED|NOT FIXED|NEEDS YOU)\b\s*(.*)$/im.exec(String(text || ""));
  if (!m) return null;
  return { kind: m[1] === "FIXED" ? "fixed" : m[1] === "NOT FIXED" ? "not-fixed" : "needs-you", text: m[2].trim().slice(0, 400) };
}

function setWatch(folder, repo, fn) {
  return updatePublished(folder, (rec) => {
    const r = (rec.repos || []).find((x) => x.repo === repo);
    if (r) fn(r, rec);
  });
}

/**
 * `published.record`: one repo's PR status from the ADO or GitHub connector (or the error it gave). Returns what was
 * decided: {ok, started?: "ci" | "conflict", merged?, abandoned?}.
 * deps: findItem(folder), removeWorktrees(item), runCommand({folder, command}, opts)
 */
export async function recordStatus({ folder, repo, status, error }, deps) {
  const rec = publishedRecords()[folder];
  if (!rec) throw httpError(404, "That item is not published.");
  const row = (rec.repos || []).find((r) => r.repo === repo);
  if (!row) throw httpError(404, `${repo} was not published with this item.`);
  const it = deps.findItem(folder);
  const id = it && it.id ? String(it.id) : null;
  if (error) {
    setWatch(folder, repo, (r) => { r.watch = { ...(r.watch || {}), error: String(error).slice(0, 300), checkedAt: nowIso() }; });
    broadcastLive();
    return { ok: true };
  }
  if (!status || !status.found) {
    setWatch(folder, repo, (r) => { r.watch = { ...(r.watch || {}), found: false, error: null, checkedAt: nowIso() }; });
    broadcastLive();
    return { ok: true };
  }
  threads.set(`${folder}|${repo}`, Array.isArray(status.threads) ? status.threads.slice(0, 50) : []);
  const was = row.watch || {};
  const w = {
    found: true, error: null, checkedAt: nowIso(), pr: { id: status.id, url: status.url, title: status.title || "" }, head: status.head || null,
    ci: status.ci ? status.ci.state : "none", checks: ((status.ci && status.ci.checks) || []).map((c) => ({ name: c.name, state: c.state, url: c.url || null })).slice(0, 20),
    baseFailing: !!(status.ci && status.ci.baseFailing), review: status.review || "waiting", conflict: !!status.conflict, merged: !!status.merged, abandoned: !!status.abandoned,
    comments: (status.threads || []).filter((t) => !t.resolved).length, fix: was.fix || null, fixRounds: was.fixRounds || 0,
  };
  // A fix you pushed: the PR's head moved past the commit the fix was found on.
  if (w.fix && w.fix.state === "ready" && w.head && w.fix.head && w.head !== w.fix.head) w.fix = { ...w.fix, state: "pushed" };
  if (w.fix && w.fix.state === "pushed" && w.ci !== "failed" && !w.conflict) w.fix = null;
  const out = { ok: true };
  const busy = autopilot[folder] && ["running", "queued"].includes(autopilot[folder].status);
  const working = w.fix && w.fix.state === "working";
  if (!w.merged && !w.abandoned && id && !busy && !working) {
    const sameHead = w.fix && w.fix.head === w.head;
    if (w.conflict && !(sameHead && w.fix.kind === "conflict")) {
      const f = nextFile(folder, "conflict");
      fs.writeFileSync(path.join(f.dir, f.name), conflictText({ id, repo, branch: row.branch, target: row.target || "main", status }));
      w.fix = { state: "working", kind: "conflict", file: `ci/${f.name}`, head: w.head, at: nowIso() };
      out.started = "conflict";
    } else if (w.ci === "failed" && w.baseFailing) {
      w.fix = { state: "not-ours", kind: "ci", head: w.head, at: nowIso(), text: "The same check fails on the base branch: not caused by this change. Rerun it on the host once the base is fixed." };
    } else if (w.ci === "failed" && !(sameHead && w.fix.kind === "ci")) {
      if (w.fixRounds >= MAX_FIX_ROUNDS) w.fix = { state: "gave-up", kind: "ci", head: w.head, at: nowIso(), text: `Tandem tried ${MAX_FIX_ROUNDS} fixes on this PR. Look at the checks yourself.` };
      else {
        const f = nextFile(folder, "failure");
        fs.writeFileSync(path.join(f.dir, f.name), failureText({ id, repo, branch: row.branch, target: row.target || "main", status }));
        w.fix = { state: "working", kind: "ci", file: `ci/${f.name}`, head: w.head, at: nowIso() };
        w.fixRounds += 1;
        out.started = "ci";
      }
    }
  }
  setWatch(folder, repo, (r) => { r.watch = w; });
  if (out.started) {
    try {
      await startPending(folder, `/pr-fix ${id} ${out.started} auto`, out.started === "ci" ? `CI failed on ${repo}: Tandem is fixing it` : `${repo} conflicts with its base: Tandem is merging it in`);
      emit("published", { folder, repo, event: out.started === "ci" ? "ci-failed" : "conflict" });
    } catch (e) {
      setWatch(folder, repo, (r) => { r.watch = { ...r.watch, fix: { ...r.watch.fix, state: "needs-you", text: `Tandem could not start: ${e.message}` } }; });
    }
  }
  // Every repo merged: done.
  if (w.merged && (rec.repos || []).every((r) => r.repo === repo || (r.watch && r.watch.merged))) {
    updatePublished(folder, (x) => { x.merged = nowIso(); });
    out.merged = true;
    await finishMerged(folder, it, deps, repo);
  } else if (w.abandoned) {
    forgetPublished(folder);
    out.abandoned = true;
  }
  broadcastLive();
  return out;
}

// A /pr-fix build finished (or stopped): read the Result line it wrote.
function onFixDone(folder, status) {
  if (!["done", "waiting", "stopped"].includes(status)) return;
  const mf = mergeFixes.get(folder);
  if (mf && mf.state === "working") {
    let text = "";
    try { text = fs.readFileSync(path.join(workRoot, folder, mf.file), "utf8"); } catch {}
    const res = resultOf(text);
    const next = !res ? { state: "needs-you", text: (autopilot[folder] && autopilot[folder].message) || "Tandem stopped without writing a result." } : res.kind === "fixed" ? { state: "ready", text: res.text } : { state: res.kind, text: res.text };
    mergeFixes.set(folder, { ...mf, ...next, at: nowIso() });
    if (next.state === "ready") emit("published", { folder, repo: mf.repo, event: "merge-fixed" });
    broadcastLive();
  }
  const rec = publishedRecords()[folder];
  if (!rec) return;
  let changed = false;
  for (const r of rec.repos || []) {
    const f = r.watch && r.watch.fix;
    if (!f || f.state !== "working" || !f.file) continue;
    let text = "";
    try { text = fs.readFileSync(path.join(workRoot, folder, f.file), "utf8"); } catch {}
    const res = resultOf(text);
    const next = !res ? { state: "needs-you", text: (autopilot[folder] && autopilot[folder].message) || "Tandem stopped without writing a result." } : res.kind === "fixed" ? { state: "ready", text: res.text } : { state: res.kind, text: res.text };
    setWatch(folder, r.repo, (x) => { x.watch = { ...x.watch, fix: { ...f, ...next, at: nowIso() } }; });
    changed = true;
    if (next.state === "ready") emit("published", { folder, repo: r.repo, event: "fix-ready" });
  }
  if (changed) broadcastLive();
}

/** Teammates' comments for the code review screen. */
export const threadsFor = (folder, repo) => threads.get(`${folder}|${repo}`) || null;

export function loadAfterPublish() {
  resetAfterPublish();
  setThreadSource(threadsFor);
  off = onAutoChange(onFixDone);
}

export function resetAfterPublish() {
  if (off) off();
  off = null;
  mergeFixes.clear();
  threads.clear();
  setThreadSource(null);
}

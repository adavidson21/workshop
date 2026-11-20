// opencode connector: merge without a PR (1.29.0). Settings, Factory, "When you publish": "Merge, no PR" is for your
// own repos (a personal computer): Publish merges each branch into its target and pushes the target, so there is no
// PR, no team review and no CI before the merge. The factory's own checks (review, UI checks, regression tests) have
// run by then.
//
// Nothing is checked out: `git merge-tree --write-tree` (git 2.38 or later) merges in memory and `git commit-tree`
// writes a merge commit with two parents, so a build is one merge on the target (undo it with `git revert -m 1`).
// The push is never forced: if the target moved since the fetch, the merge is planned again once. Every repo is
// planned before any is pushed, so a conflict in one repo pushes nothing; Tandem's `/pr-fix <id> conflict` then
// merges the target into the branch (after-publish.mjs startMergeFix) and you publish again.

import { execFile } from "node:child_process";

/** git with stdout and stderr apart. {code, out, err}; code 0 is success. */
export function git(cwd, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout, maxBuffer: 8 << 20, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(stdout || ""), err: String(stderr || "") });
    });
  });
}

export const safeRef = (b) => typeof b === "string" && /^[A-Za-z0-9._\/-]+$/.test(b) && !b.startsWith("-") && !b.includes("..") && !b.endsWith("/");
const lastLine = (s) => String(s || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "";
export const targetName = (t) => String(t || "main").replace(/^origin\//, "").replace(/^refs\/heads\//, "");

/** Whether a repo publishes by merging, from the factory settings: publish "merge", and mergeOnly empty or naming it. */
export function mergesRepo(factory, repo) {
  if (!factory || factory.publish !== "merge") return false;
  const only = String(factory.mergeOnly || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !only.length || only.includes(String(repo || "").toLowerCase());
}

/**
 * Plans one repo's merge: fetch the target from origin, then merge the branch into it in memory.
 * Returns {commit, base, head, target} | {already: true, ...} (the target has the branch) | {conflict: true, files, ...}
 * | {error} (plain words, after the repo name).
 */
export async function planMerge(dir, { branch, target, message }) {
  const t = targetName(target);
  if (!safeRef(branch) || !safeRef(t)) return { error: `"${branch}" into "${t}" is not a merge Workshop will make` };
  if (branch.toLowerCase() === t.toLowerCase()) return { error: `the branch is ${t} itself` };
  const remote = await git(dir, ["remote", "get-url", "origin"]);
  if (remote.code !== 0) return { error: "has no origin remote to merge into" };
  const head = (await git(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`])).out.trim();
  if (!head) return { error: `has no local branch ${branch}` };
  const f = await git(dir, ["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${t}:refs/remotes/origin/${t}`], 180000);
  if (f.code !== 0) return { error: `could not fetch ${t}: ${lastLine(f.err) || "no output from git"}` };
  const base = (await git(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${t}^{commit}`])).out.trim();
  if (!base) return { error: `origin has no ${t}` };
  if ((await git(dir, ["merge-base", "--is-ancestor", head, base])).code === 0) return { already: true, base, head, target: t };
  const mt = await git(dir, ["merge-tree", "--write-tree", "--name-only", "--no-messages", base, head]);
  if (mt.code === 1) {
    const files = mt.out.split(/\r?\n/).slice(1).map((s) => s.trim()).filter(Boolean);
    return { conflict: true, files: [...new Set(files)].slice(0, 30), base, head, target: t };
  }
  const tree = mt.out.split(/\r?\n/)[0].trim();
  if (mt.code !== 0 || !/^[0-9a-f]{40,64}$/.test(tree)) {
    return { error: /usage|unknown option|write-tree/i.test(mt.err) ? "needs git 2.38 or later to merge without a checkout" : `could not merge: ${lastLine(mt.err) || "no output from git"}` };
  }
  const c = await git(dir, ["commit-tree", tree, "-p", base, "-p", head, "-m", message]);
  if (c.code !== 0) return { error: `could not write the merge commit: ${lastLine(c.err) || "no output from git"}` };
  return { commit: c.out.trim(), base, head, target: t };
}

/** Pushes a planned merge to the target, never forced. {ok} | {moved: true} (the target moved on) | {error}. */
export async function pushMerge(dir, plan) {
  const r = await git(dir, ["push", "--quiet", "origin", `${plan.commit}:refs/heads/${plan.target}`], 180000);
  if (r.code === 0) {
    await git(dir, ["update-ref", `refs/remotes/origin/${plan.target}`, plan.commit]);
    return { ok: true };
  }
  if (/non-fast-forward|fetch first|rejected/i.test(r.err)) return { moved: true };
  return { error: `push to ${plan.target} failed: ${lastLine(r.err) || "no output from git"}` };
}

/**
 * Merges every repo of an item: plans them all, pushes only when none conflicts or fails.
 * rows: [{repo, dir, branch, target}]; message(row) gives the merge commit's message.
 * Returns {ok: true, repos: [{repo, branch, target, merged (commit), already}]} | {conflict: {repo, branch, target, files,
 * base, head}} | throws an Error with the repo in its message. A push that fails after others went through says which did.
 */
export async function mergeItem(rows, message, { plan = planMerge, push = pushMerge } = {}) {
  const plans = [];
  for (const row of rows) {
    const p = await plan(row.dir, { branch: row.branch, target: row.target, message: message(row) });
    if (p.error) throw new Error(`${row.repo} ${p.error}.`);
    if (p.conflict) return { conflict: { repo: row.repo, branch: row.branch, target: p.target, files: p.files, base: p.base, head: p.head } };
    plans.push({ row, p });
  }
  const done = [];
  for (const { row, p: first } of plans) {
    let p = first;
    if (p.already) { done.push({ repo: row.repo, branch: row.branch, target: p.target, merged: p.base, already: true }); continue; }
    let r = await push(row.dir, p);
    if (r.moved) {
      p = await plan(row.dir, { branch: row.branch, target: row.target, message: message(row) });
      if (p.error || p.conflict) r = { error: p.error || `${p.target} moved on and now conflicts; publish again` };
      else if (p.already) r = { ok: true };
      else r = await push(row.dir, p);
      if (r.moved) r = { error: `${p.target} keeps moving; publish again` };
    }
    if (!r.ok) {
      const pushed = done.map((d) => d.repo).join(", ");
      throw Object.assign(new Error(`${row.repo}: ${r.error}.${pushed ? ` Already merged: ${pushed}.` : ""}`), { partial: done });
    }
    done.push({ repo: row.repo, branch: row.branch, target: p.target, merged: p.already ? p.base : p.commit, already: !!p.already });
  }
  return { ok: true, repos: done };
}

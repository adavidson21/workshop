// opencode connector: Publish (1.21.0), the software factory's second gate. An item is ready to publish when its
// next step is "ship" (review READY, pr.md written). Publish pushes every branch in pr.md (pushBranch: never the
// target or default branch, never --force) and returns each repo's "create PR" link for the browser to open.
// Publish all ready does the same for every ready item with no open review questions.
//
// What was published, and when, is kept in .work/_dashboard/published.json: { "<folder>": { at, repos: [...] } }.

import fs from "node:fs";
import path from "node:path";
import { httpError, stateDir, workRoot } from "./context.mjs";

const stateFile = () => path.join(stateDir, "published.json");
let published = {};

export function loadPublished() {
  try {
    const d = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    published = d && typeof d === "object" && d.published && typeof d.published === "object" ? d.published : {};
  } catch {
    published = {};
  }
}
export function resetPublished() {
  published = {};
}
function save() {
  const tmp = stateFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, published }, null, 2));
  fs.renameSync(tmp, stateFile());
}

/** The "Questions for you" lines in review.md text, minus placeholders like "None". */
export function reviewQuestions(text) {
  if (!text) return [];
  const m = /^##\s+Questions for you\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(text);
  if (!m) return [];
  return m[1].split(/\r?\n/).map((l) => /^\s*[-*]\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((x) => x[1])
    .filter((l) => !/^(none\.?|<.*>|`?<.*)$/i.test(l) && !/question, or "None"/.test(l));
}

/** UI check results the review recorded for an item: [{repo?, name, verdict, reason, changed, pages}] from ui/results-*.json. */
export function uiResults(folder) {
  const dir = path.join(workRoot, folder, "ui");
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^results-[a-z0-9-]{1,30}\.json$/.test(f));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      out.push({
        name: String(r.name || f.slice(8, -5)),
        verdict: ["pass", "fail", "skipped"].includes(r.verdict) ? r.verdict : "skipped",
        reason: r.reason ? String(r.reason).slice(0, 300) : null,
        changed: Array.isArray(r.changed) ? r.changed.slice(0, 40).map(String) : [],
        problems: Array.isArray(r.problems) ? r.problems.slice(0, 20).map(String) : [],
        pages: (Array.isArray(r.pages) ? r.pages : []).slice(0, 40).map((p) => ({ path: String(p.path || ""), width: Number(p.width) || 0, file: typeof p.file === "string" ? p.file : null, diff: p.diff && typeof p.diff.file === "string" ? p.diff.file : null, changedPct: p.diff ? p.diff.changedPct : null })),
      });
    } catch {}
  }
  return out.sort((a, b) => (a.name === "before" ? -1 : b.name === "before" ? 1 : a.name.localeCompare(b.name)));
}

/** Regression suite results for an item (eng-agents Core 4.14.0): [{name, verdict, reason, passed, failed, flaky,
 * skipped, failures, preExisting, flakyTests, newTests, acceptance}] from tests/results-*.json, "before" first. */
export function testResults(folder) {
  const dir = path.join(workRoot, folder, "tests");
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^results-[a-z0-9-]{1,30}\.json$/.test(f));
  } catch {
    return out;
  }
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const rows = (v, max) => (Array.isArray(v) ? v : []).slice(0, max).map((x) => ({ file: String((x && x.file) || ""), title: String((x && x.title) || "").slice(0, 300), ...(x && x.error ? { error: String(x.error).slice(0, 300) } : {}) }));
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^\uFEFF/, ""));
      out.push({
        name: String(r.name || f.slice(8, -5)),
        verdict: ["pass", "fail", "skipped"].includes(r.verdict) ? r.verdict : "skipped",
        reason: r.reason ? String(r.reason).slice(0, 300) : null,
        passed: n(r.passed), failed: n(r.failed), flaky: n(r.flaky), skipped: n(r.skipped),
        failures: rows(r.failures, 20), preExisting: rows(r.preExisting, 20), flakyTests: rows(r.flakyTests, 20), newTests: rows(r.newTests, 40),
        acceptance: (Array.isArray(r.acceptance) ? r.acceptance : []).map(String).filter((x) => /^AC-\d+$/.test(x)).slice(0, 40),
      });
    } catch {}
  }
  return out.sort((a, b) => (a.name === "before" ? -1 : b.name === "before" ? 1 : a.name.localeCompare(b.name)));
}

/** True when a ready item's checks failed after the change (UI checks or the regression suite). */
export const checksFailed = (info) => !!info && (info.ui.some((u) => u.name !== "before" && u.verdict === "fail") || (info.tests || []).some((t) => t.name !== "before" && t.verdict === "fail"));

/** Gate 2 for one item: ready (or why not), the open review questions, the UI results and when it was published. */
export function publishInfo(it) {
  if (!it || it.kind !== "item") return null;
  const ready = !!(it.next && it.next.stage === "ship");
  let questions = [];
  try {
    questions = reviewQuestions(fs.readFileSync(path.join(workRoot, it.folder, "review.md"), "utf8"));
  } catch {}
  const pushed = (it.pr || []).length > 0 && (it.pr || []).every((p) => p.push && p.push.remote && p.push.unpushed === 0);
  return { ready, questions, ui: uiResults(it.folder), tests: testResults(it.folder), published: published[it.folder] || null, pushed };
}

/** Publish info for every work item that is ready or was published, by folder. */
export function publishData(items) {
  const out = {};
  for (const it of items || []) {
    if (it.kind !== "item") continue;
    if (!(it.next && it.next.stage === "ship") && !published[it.folder]) continue;
    out[it.folder] = publishInfo(it);
  }
  return out;
}

/**
 * Publish one item: push each branch in pr.md with `push({folder, repo})` (actions.mjs pushBranch), then record it.
 * Returns { ok, folder, repos: [{repo, branch, target, pr (create PR link or null), message}] }.
 * A failed push stops there and says which repos were pushed.
 */
export async function publishItem(it, push) {
  if (!it || it.kind !== "item") throw httpError(404, "No such work item. Refresh the page.");
  if (!(it.next && it.next.stage === "ship")) throw httpError(409, `${it.id} is not ready to publish yet: ${(it.next && (it.next.text || it.next.action)) || "the build is not done"}.`);
  const rows = it.pr || [];
  if (!rows.length) throw httpError(409, "pr.md has no repo sections to publish.");
  const repos = [];
  for (const row of rows) {
    try {
      const r = await push({ folder: it.folder, repo: row.repo });
      repos.push({ repo: row.repo, branch: row.branch, target: row.target, pr: (row.links && row.links.pr) || null, message: r && r.message });
    } catch (e) {
      const done = repos.map((x) => x.repo).join(", ");
      throw httpError(e.status || 502, `${e.message}${done ? ` Already pushed: ${done}.` : ""}`);
    }
  }
  published[it.folder] = { at: new Date().toISOString(), repos: repos.map(({ repo, branch, target, pr }) => ({ repo, branch, target, pr })) };
  save();
  return { ok: true, folder: it.folder, repos };
}

/** The items Publish all ready would publish: ready, not published, no open review questions. */
export function readyToPublish(items) {
  return (items || []).filter((it) => {
    if (it.kind !== "item" || published[it.folder]) return false;
    const info = publishInfo(it);
    return info && info.ready && !info.questions.length && !checksFailed(info);
  });
}

/** Forget an item's publish record (the item was removed). */
export function forgetPublished(folder) {
  if (!published[folder]) return;
  delete published[folder];
  try { save(); } catch {}
}

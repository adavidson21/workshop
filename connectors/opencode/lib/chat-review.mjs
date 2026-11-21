// opencode connector: Review code on a chat's changes (connector 1.30.0, Chat 4.2.0, docs/chat.md, Review code).
//
// Like the /code-review card in Claude's desktop app: a read-only agent reads everything the chat changed (the same
// diffs as chat.changes) and answers with findings, each at a file and line. Chat shows them in its Changes tab
// with Fix this and Fix all, which send them back to the chat as one message. The review runs in a scratch session
// that is deleted when it ends, so nothing is added to the chat. Read only: Tandem's `chat` agent, or opencode's
// `plan` when Tandem is not installed; the prompt also tells it not to change anything.
//
// It can take minutes on a slow model, so chat.review only starts it and chat.review.state says where it is. One
// review per chat at a time; the last one is kept (in memory) until the next.

import { httpError, log } from "./context.mjs";
import { oc } from "./opencode-state.mjs";
import { chatSessionOf, cleanModel } from "./chat.mjs";
import { changesKey, chatChanges } from "./chat-more.mjs";

export const REVIEW_AGENTS = ["chat", "plan"];
export const REVIEW_DIFF_MAX = 80000;
export const MAX_FINDINGS = 15;
export const REVIEW_TIMEOUT = 10 * 60 * 1000;
export const SEVERITIES = ["blocker", "should-fix", "nit"];

const reviews = new Map(); // chat session -> {status, key, at, doneAt, summary, findings, error, files, agent}
/** Tests start fresh. */
export function resetReviews() { reviews.clear(); }

/** The scratch session's one message: the rules, then every changed file's diff (cut to REVIEW_DIFF_MAX). */
export function reviewPrompt(files) {
  const out = [
    "Review the uncommitted changes a coding agent made in this workspace. Do not change, create or delete any file:",
    "only read. Read the files themselves when the diff is not enough.",
    "",
    "Look for: bugs and wrong behavior, security problems, missing error handling, missing or broken tests, and",
    "needless complexity. Skip style a formatter would fix. Only report what you would ask a teammate to change.",
    "",
    `Reply with one line per finding, at most ${MAX_FINDINGS}, worst first, exactly like this:`,
    "BLOCKER | path/to/file.ext:42 | what is wrong and what to do",
    "SHOULD FIX | path/to/file.ext:7 | what is wrong and what to do",
    "NIT | path/to/file.ext:0 | what is wrong and what to do",
    "Use the line number in the new version of the file (the + side), or 0 when it is about the whole file.",
    "BLOCKER: it breaks something or is unsafe. SHOULD FIX: worth fixing before merging. NIT: small and optional.",
    "End with one line: SUMMARY | your overall verdict in one sentence.",
    "If nothing needs changing, reply with only: SUMMARY | No findings.",
    "",
    "The changes:",
  ];
  let used = 0;
  for (const f of files) {
    const head = `\n--- ${f.path} (${f.status}, +${f.additions || 0} -${f.deletions || 0})`;
    if (f.cut || !f.diff) { out.push(head, f.cut ? "(too big to show here: read the file)" : "(no text diff)"); continue; }
    if (used + f.diff.length > REVIEW_DIFF_MAX) { out.push(head, "(left out to keep this short: read the file and `git diff` it)"); continue; }
    used += f.diff.length;
    out.push(head, f.diff.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

const SEV = { blocker: "blocker", "should fix": "should-fix", shouldfix: "should-fix", "should-fix": "should-fix", should_fix: "should-fix", nit: "nit" };
const LINE = /^\s*(?:[-*]\s*|\d+[.)]\s*)?\**\s*(BLOCKER|SHOULD[ _-]?FIX|NIT)\s*\**\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/i;

/** Where a finding points: a changed file (exact, or the one whose path ends with it) and a line, or the whole file. */
function place(loc, paths) {
  const raw = String(loc).replace(/[`'"]/g, "").trim();
  const m = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(raw);
  let p = (m ? m[1] : raw).replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const line = m && m[2] ? +m[2] : 0;
  const hit = paths.find((x) => x === p) || paths.find((x) => x.endsWith("/" + p)) || paths.find((x) => p.endsWith("/" + x));
  if (hit) p = hit;
  return { path: p, line: line > 0 ? line : null, known: !!hit };
}

/** The reviewer's answer as {summary, findings: [{id, severity, path, line, known, text}]}, worst first. */
export function parseReview(text, paths = []) {
  const findings = [];
  let summary = "";
  for (const l of String(text || "").split(/\r?\n/)) {
    const s = /^\s*\**\s*SUMMARY\s*\**\s*\|\s*(.+?)\s*$/i.exec(l);
    if (s) { summary = s[1].slice(0, 300); continue; }
    const m = LINE.exec(l);
    if (!m || findings.length >= MAX_FINDINGS) continue;
    const severity = SEV[m[1].toLowerCase().replace(/\s+/g, " ")] || "should-fix";
    const body = m[3].replace(/\s+/g, " ").slice(0, 600);
    if (!body) continue;
    findings.push({ id: `f${findings.length + 1}`, severity, ...place(m[2], paths), text: body });
  }
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return { summary, findings };
}

function pickAgent() {
  const names = oc.agents && oc.agents.size ? oc.agents : new Set(REVIEW_AGENTS);
  return REVIEW_AGENTS.find((a) => names.has(a)) || null;
}

/** What the page gets: the review without its internals. */
function view(r) {
  if (!r) return { status: "none" };
  const { status, key, at, doneAt, summary, findings, error, files, agent } = r;
  return { status, key, at, doneAt: doneAt || null, summary: summary || "", findings: findings || [], error: error || "", files: files || [], agent: agent || null };
}

/** chat.review.state: {status: none | running | done | failed, key, at, doneAt, summary, findings, error, files, agent}. */
export function chatReviewState({ session }) {
  return view(reviews.get(chatSessionOf(session)));
}

/**
 * chat.review: starts a review of what the chat changed and answers at once with its state (running). 409 while
 * one is running for this chat; 409 when the chat changed nothing. `wait` (tests) resolves when it ends.
 */
export async function chatReview({ session, model }, { wait = false } = {}) {
  const sid = chatSessionOf(session);
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
  if (!oc.api.promptWait || !oc.api.createSession || !oc.api.deleteSession) throw httpError(501, "This opencode cannot review code from Chat. Update opencode (npm i -g opencode-ai), then restart it.");
  const was = reviews.get(sid);
  if (was && was.status === "running") throw httpError(409, "A review of this chat is already running.");
  const m = cleanModel(model);
  const { files } = await chatChanges({ session: sid });
  const changed = files.filter((f) => f.status !== "clean");
  if (!changed.length) throw httpError(409, "This chat has no uncommitted changes to review.");
  const agent = pickAgent();
  const r = { status: "running", key: changesKey(files), at: new Date().toISOString(), files: changed.map((f) => f.path), agent };
  reviews.set(sid, r);
  log(`chat review started for ${sid} (${changed.length} file${changed.length === 1 ? "" : "s"})`);
  const job = (async () => {
    let scratch = null;
    try {
      scratch = await oc.api.createSession("Workshop: review a chat's changes");
      const text = await oc.api.promptWait(scratch.id, { text: reviewPrompt(changed), agent, model: m, timeout: REVIEW_TIMEOUT });
      const out = parseReview(text, r.files);
      if (!out.findings.length && !out.summary && String(text || "").trim()) out.summary = String(text).trim().split(/\r?\n/)[0].slice(0, 300);
      Object.assign(r, { status: "done", ...out, doneAt: new Date().toISOString() });
      log(`chat review for ${sid}: ${out.findings.length} finding${out.findings.length === 1 ? "" : "s"}`);
    } catch (e) {
      Object.assign(r, { status: "failed", error: e.message || "The review did not finish.", doneAt: new Date().toISOString() });
      log(`chat review for ${sid} failed: ${e.message}`);
    } finally {
      if (scratch) oc.api.deleteSession(scratch.id).catch(() => {});
    }
  })();
  if (wait) await job;
  return view(r);
}

// opencode connector: the .work parser in JavaScript. Reads every item in .work and the git state of the workspace
// repos and returns the same model as parser/New-Dashboard.ps1 -AsJson (eng-agents' parser), so the connector no
// longer needs PowerShell to run. test/workparser.test.mjs checks both give the same answer on the same folders
// whenever PowerShell is installed. Keep the rules in step with New-Dashboard.ps1 (and so with Tandem's /status):
// a change to one is a change to both until eng-agents uses this file too.
//
// Read-only: it writes nothing and makes no network calls. Work item links come from workitem.md, Tandem's
// config.json, and each repo's git remote. Node 22, no dependencies.
//
// PowerShell's -match, -like, -eq and -contains ignore case; [regex]::Match does not. Each regex below keeps the
// case rule of the line it came from (an `i` flag where the PowerShell used -match or (?i)).

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_DEPTH } from "./context.mjs";

// Each pipeline command in plain words (stepWords). Dispatch shows these instead of the command.
export const STEP_WORDS = Object.freeze({
  start: "Set up the repos and branches", spec: "Write the spec", plan: "Write the plan", tasks: "Split the plan into tasks",
  bug: "Analyze the bug", review: "Review the changes", pr: "Write the PR text", resume: "Resume this item", approve: "Approve",
});

const FILE_ORDER = ["workitem.md", "brief.md", "repos.md", "spec.md", "bug.md", "plan.md", "tasks.md", "review.md", "pr.md", "paused.md", "progress.md", "findings.md", "tsd.md", "inventory.md", "sources.md", "check.md"];

// ------------------------------------------------------------------- helpers

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// [System.Uri]::EscapeDataString: encodeURIComponent plus ! ' ( ) *.
const escapeData = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
// Sort-Object on strings: culture order, case ignored first.
const cmp = (a, b) => String(a).localeCompare(String(b));
const lc = (s) => String(s).toLowerCase();

function readText(p) {
  try {
    if (!fs.statSync(p).isFile()) return null;
    return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
// Dot names are hidden to Get-ChildItem on macOS and Linux; Windows hides by attribute, which no item uses.
const hidden = (name) => name.startsWith(".");
function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !hidden(d.name)); } catch { return []; }
}
const mtimeNs = (p) => fs.statSync(p, { bigint: true }).mtimeNs;

// DateTime.ToString("o") for a local time: 2026-11-08T09:40:10.1234567-05:00 (100 ns ticks, local offset).
export function isoLocal(ns) {
  const ms = Number(ns / 1000000n);
  const d = new Date(ms);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const ticks = (ns % 1000000000n) / 100n;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oa = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(Number(ticks), 7)}${sign}${pad(Math.floor(oa / 60))}:${pad(oa % 60)}`;
}
const epochMs = (ns) => Number(ns / 1000000n);

// A template placeholder like "<state>" counts as empty.
export function cleanValue(value) {
  if (value === null || value === undefined) return null;
  let v = String(value).trim();
  const m = /^`([^`]*)`$/.exec(v);
  if (m) v = m[1].trim();
  if (!v) return null;
  if (/^<.*>$/i.test(v)) return null;
  return v;
}

// First "- Label: value" (or "Label: value") line in a markdown file.
export function field(text, label) {
  if (!text) return null;
  const m = new RegExp("^\\s*(?:-\\s*)?" + escRe(label) + "\\s*:[ \\t]*(.*?)\\s*$", "mi").exec(text);
  if (!m) return null;
  return cleanValue(m[1]);
}

// The body of "## Heading" up to the next "## ", without HTML comments.
export function section(text, heading) {
  if (!text) return null;
  const m = new RegExp("^##\\s+" + escRe(heading) + "[^\\r\\n]*\\r?$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))", "m").exec(text);
  if (!m) return null;
  const s = m[1].replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!s) return null;
  if (/^<[^>]*>$/i.test(s)) return null;
  return s;
}

// The value of a "Status:" line, upper case, or null if the file is missing.
function gateStatus(p) {
  const t = readText(p);
  if (t === null) return null;
  const m = /^\s*Status:\s*([A-Za-z ]+?)\s*$/im.exec(t);
  if (m) return m[1].toUpperCase();
  return "UNKNOWN";
}

// ---------------------------------------------------------------------- git

function makeGit(gitOk) {
  // Runs git in a repo. Resolves to stdout lines joined with LF, or null on failure.
  return (repo, args) => new Promise((resolve) => {
    if (!gitOk) return resolve(null);
    execFile("git", ["-C", repo, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (err, out) => {
      if (err) return resolve(null);
      const lines = String(out).split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      resolve(lines.join("\n"));
    });
  });
}

function hasGit() {
  return new Promise((resolve) => {
    execFile("git", ["--version"], { windowsHide: true }, (err) => resolve(!err));
  });
}

// Turns a git remote into a browsable URL and the link builders for it.
export function remoteWeb(remote) {
  if (!remote) return null;
  let u = remote.trim();
  let m;
  if (/^https?:\/\//i.test(u)) {
    u = u.replace(/^(https?:\/\/)[^@/]+@/i, "$1");
  } else if ((m = /^(?:[^@/]+@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/i.exec(u))) {
    u = `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`;
  } else if ((m = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u))) {
    u = `https://${m[1]}/${m[2]}`;
  } else if ((m = /^(?:[^@/]+@)?([^:/]+):(.+)$/i.exec(u))) {
    u = `https://${m[1]}/${m[2]}`;
  } else return null;
  u = u.replace(/\/+$/, "");
  let kind = "other";
  if (/\/_git\//i.test(u)) kind = "ado";
  else if (/\/\/github\.com\//i.test(u)) { kind = "github"; u = u.replace(/\.git$/i, ""); }
  else u = u.replace(/\.git$/i, "");
  return { url: u, kind };
}

export function branchLinks(web, branch, base) {
  if (!web || !branch) return null;
  const e = escapeData(branch);
  const b = escapeData(base == null ? "" : base);
  if (web.kind === "ado") return { branch: `${web.url}?version=GB${e}`, pr: `${web.url}/pullrequestcreate?sourceRef=${e}&targetRef=${b}` };
  if (web.kind === "github") return { branch: `${web.url}/tree/${branch}`, pr: `${web.url}/compare/${base}...${branch}?expand=1` };
  return null;
}

// ------------------------------------------------------------------ parsers

export function progressEntries(text) {
  const out = [];
  if (!text) return out;
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2}[^|]*?)\s*\|\s*(\S+)\s*(?:\|\s*(.*?))?\s*$/.exec(line);
    if (m) {
      cur = { date: m[1].trim(), command: m[2].trim().replace(/^`+|`+$/g, ""), agent: cleanValue(m[3] || ""), did: null, verify: null, notes: null, next: null, first: null };
      out.push(cur);
      continue;
    }
    if (/^##\s/i.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const f = /^\s*-\s*(Did|Verify|Notes|Next)\s*:\s*(.*)$/.exec(line);
    let mm;
    if (f) cur[f[1].toLowerCase()] = cleanValue(f[2]);
    else if (!cur.first && (mm = /^\s*-\s+(.+)$/i.exec(line))) cur.first = cleanValue(mm[1]);
  }
  for (const e of out) {
    if (!e.did) e.did = e.first;
    delete e.first;
    if (e.notes && /^none\.?$/i.test(e.notes)) e.notes = null;
  }
  return out;
}

export function tasksOf(text) {
  const list = [];
  if (!text) return list;
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s*\[([ xX])\]\s*Task\s+(\d+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) {
      const title = m[3];
      if (/^<.*>$/i.test(title)) { cur = null; continue; }
      cur = { n: parseInt(m[2], 10), title, done: m[1] !== " ", repo: null };
      list.push(cur);
      continue;
    }
    let r;
    if (cur && !cur.repo && (r = /^\s*-\s*Repo:\s*(.+)$/i.exec(line))) cur.repo = cleanValue(r[1]);
  }
  return list;
}

export function repoRows(text) {
  const rows = [];
  if (!text) return rows;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\|(.+)\|\s*$/i.exec(line);
    if (!m) continue;
    const cells = m[1].split("|").map((c) => c.trim().replace(/^`+|`+$/g, "").trim());
    if (cells.length < 3) continue;
    if (/^order$/i.test(cells[0]) || /^:?-+:?$/i.test(cells[0])) continue;
    if (!cleanValue(cells[1])) continue;
    rows.push({ folder: cells[1], branch: cleanValue(cells[2]), shared: cells.length > 3 && /^y/i.test(cells[3]), why: cells.length > 4 ? cleanValue(cells[4]) : null });
  }
  return rows;
}

// pr.md: one "## <repo>" section per repo with Branch, Title, and Description (templates/pr.md).
export function prSections(text) {
  const list = [];
  if (!text) return list;
  const t = text.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const parts = t.split(/^##[ \t]+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const head = nl >= 0 ? p.slice(0, nl) : p;
    const body = nl >= 0 ? p.slice(nl + 1) : "";
    const repo = cleanValue(head);
    if (!repo) continue;
    let branch = null, target = null, title = null, description = null;
    const bm = /^\s*(?:-\s*)?(?:\*\*)?Branch:(?:\*\*)?\s*`?([^`\s]+)`?\s*(?:->|=>|to|→)\s*`?([^`\s]+)`?/mi.exec(body);
    if (bm) { branch = cleanValue(bm[1]); target = cleanValue(bm[2]); }
    const tm = /^\s*(?:\*\*)?Title:(?:\*\*)?[ \t]*(.+?)\s*$/mi.exec(body);
    if (tm) title = cleanValue(tm[1].replace(/^\*+|\*+$/g, "").trim());
    const dm = /^\s*(?:\*\*)?Description:(?:\*\*)?[ \t]*\n?([\s\S]*)$/im.exec(body);
    if (dm) {
      const d = dm[1].replace(/^\s*-{3,}\s*$/gm, "").trim();
      if (d && !/^<[^>]*>$/i.test(d)) description = d;
    }
    list.push({ repo, branch, target, title, description });
  }
  return list;
}

// A first-pass review of someone else's PR (.work/pr-<id>/, written by /pr-review).
export function prReview(folder, prId) {
  const ctx = readText(path.join(folder, "context.md"));
  const rev = readText(path.join(folder, "review.md"));
  const out = {
    id: prId, title: null, repo: null, folder: null, author: null, branch: null, url: null,
    commit: null, size: null, reviewed: false, reviewedCommit: null, reviewedOn: null,
    recommendation: null, risk: null, summary: null,
    counts: { blocking: 0, "should-fix": 0, optional: 0 },
    comments: [], questions: [], history: 0, state: "Fetching", nextText: null,
  };
  const hist = path.join(folder, "history");
  if (exists(hist)) out.history = entries(hist).filter((d) => d.isFile() && /^review-.*\.md$/i.test(d.name)).length;
  let m;
  if (ctx) {
    if ((m = /^#\s+Pull request\s+\d+:\s*(.+?)\s*$/im.exec(ctx))) out.title = m[1];
    if ((m = /^-\s*Repo:\s*(.+?)\s*\(folder\s*`([^`]+)`\)/im.exec(ctx))) { out.repo = m[1]; out.folder = m[2]; }
    out.author = field(ctx, "Author");
    out.branch = field(ctx, "Branch");
    out.url = field(ctx, "Link");
    out.commit = field(ctx, "Source commit");
    out.size = field(ctx, "Size");
    out.state = "Reviewing";
    out.nextText = `Finish the review with \`/pr-review ${prId}\`.`;
  }
  if (rev) {
    const rc = field(rev, "Reviewed commit");
    out.reviewedCommit = rc;
    out.reviewedOn = field(rev, "Reviewed");
    out.recommendation = field(rev, "Recommendation");
    out.risk = field(rev, "Risk");
    out.summary = section(rev, "Summary");
    out.reviewed = !!out.recommendation;
    const comments = section(rev, "Comments");
    const list = [];
    if (comments) {
      for (const block of comments.split(/^###\s+/m)) {
        const bm = /^(C\d+)\s*\r?\n/i.exec(block);
        if (!bm) continue;
        const c = { id: bm[1], file: null, line: null, severity: null, why: null, comment: null };
        c.file = field(block, "File");
        c.line = field(block, "Line");
        let sev = field(block, "Severity");
        if (sev) sev = sev.toLowerCase().replace(/[^a-z-]/g, "");
        if (sev === "shouldfix") sev = "should-fix";
        c.severity = ["blocking", "should-fix", "optional"].includes(sev) ? sev : "optional";
        c.why = field(block, "Why");
        const quote = block.split(/\r?\n/).filter((l) => /^\s*>/i.test(l)).map((l) => l.replace(/^\s*>\s?/, ""));
        c.comment = quote.join("\n").trim() || null;
        out.counts[c.severity]++;
        list.push(c);
      }
    }
    out.comments = list;
    const qs = section(rev, "Questions for the author");
    if (qs) {
      out.questions = qs.split(/\r?\n/).filter((l) => /^\s*[-*]\s+/i.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).filter((q) => q && !/^(none\.?|<.*>)$/i.test(q));
    }
    if (out.reviewed) {
      const n = out.comments.length;
      out.state = `${out.recommendation}${n ? `, ${n} comment${n !== 1 ? "s" : ""}` : ""}`;
      out.nextText = n ? "Read the drafts in review.md and post the ones you agree with on the PR." : "Nothing to raise. Approve it on the PR if you agree.";
      if (out.commit && rc && !out.commit.startsWith(rc)) {
        out.state = "Review is for an older commit";
        out.nextText = `New commits since the review. Run \`/pr-review ${prId}\` again.`;
      }
    }
  }
  return out;
}

// The newest change of any (non-hidden) file under a folder, else the folder's own, in nanoseconds.
function lastModifiedNs(folder) {
  let best = null;
  const walk = (dir) => {
    for (const d of entries(dir)) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.isFile()) {
        const t = mtimeNs(p);
        if (best === null || t > best) best = t;
      }
    }
  };
  walk(folder);
  return best === null ? mtimeNs(folder) : best;
}

function fileList(folder) {
  const names = entries(folder).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name);
  const has = new Set(names.map(lc));
  const known = FILE_ORDER.filter((f) => has.has(f));
  const order = new Set(FILE_ORDER);
  const other = names.filter((n) => !order.has(lc(n))).sort(cmp);
  return [...known, ...other];
}

// ------------------------------------------------------- next step (/status)

function commandText(item, command) {
  if (!command) return null;
  const p = command.split(/\s+/);
  const name = p[0].replace(/^\/+/, "");
  if (name === "do-task" && p.length >= 3) {
    const n = parseInt(p[2], 10);
    const t = item.tasks.list.find((x) => x.n === n);
    return `Task ${n}${t ? `: ${t.title}` : ""}`;
  }
  if (Object.prototype.hasOwnProperty.call(STEP_WORDS, name)) return STEP_WORDS[name];
  return command;
}

// Mirrors the next-command rules in commands/status.md (and New-Dashboard.ps1's Get-NextStep). First match wins.
function nextStep(item, folder) {
  const { id, lane, gates: g } = item;
  const tasksPath = path.join(folder, "tasks.md");
  const reviewPath = path.join(folder, "review.md");
  const step = (stage, command, action, note, needs) => ({ stage, command, action, text: action || commandText(item, command), note, needsYou: !!needs });

  if (!item.hasRepos) return step("start", `/start ${id} ${lane}`, null, null, false);
  if (lane === "feature" && g.spec === null) return step("spec", `/spec ${id}`, null, null, false);
  if (g.spec === "DRAFT") return step("spec", `/approve ${id}`, "Review spec.md", `Answer its open questions first. After approval: /plan ${id}`, true);
  if (lane === "feature" && g.plan === null) return step("plan", `/plan ${id}`, null, null, false);
  if (g.plan === "DRAFT") return step("plan", `/approve ${id}`, "Review plan.md", `After approval: /tasks ${id}`, true);
  if (lane === "bug" && g.bug === null) return step("bug", `/bug ${id}`, null, null, false);
  if (g.bug === "DRAFT") return step("bug", `/approve ${id}`, "Review bug.md and tasks.md", `After approval: start a new session (/new), then /do-task ${id} 1`, true);
  if (item.tasks.total === 0 && !exists(tasksPath)) return step(lane === "bug" ? "bug" : "tasks", `/tasks ${id}`, null, null, false);
  const open = item.tasks.list.filter((t) => !t.done).sort((a, b) => a.n - b.n);
  if (open.length) {
    const n = open[0].n;
    if (item.blocked) return step("build", `/do-task ${id} ${n}`, `Task ${n} is blocked. Read the last progress.md entry, then split the task or fix the plan`, "Start a new session (/new) before /do-task.", true);
    return step("build", `/do-task ${id} ${n}`, null, "Start a new session (/new) first.", false);
  }
  let reviewStale = false;
  if (exists(reviewPath) && exists(tasksPath)) reviewStale = mtimeNs(tasksPath) > mtimeNs(reviewPath);
  if (g.review === null || reviewStale) return step("review", `/review ${id}`, null, null, false);
  if (/CHANGES/i.test(g.review)) return step("review", null, "Pick which review.md findings become fix tasks, then /do-task them", `Re-run /review ${id} if you closed that session before answering.`, true);
  if (!item.hasPr) return step("pr", `/pr ${id}`, null, null, false);
  return step("ship", null, "Push the branches and open the PRs (text is in pr.md)", null, false);
}

// ------------------------------------------------------------------- config

function readConfig(configPath) {
  const connections = new Map();
  let def = null;
  if (configPath && exists(configPath)) {
    try {
      const cfg = JSON.parse(readText(configPath));
      if (cfg && cfg.connections && typeof cfg.connections === "object") for (const [k, v] of Object.entries(cfg.connections)) connections.set(k, v);
      else if (cfg && cfg.serverUrl) connections.set("default", cfg);
      def = (cfg && cfg.default) || null;
    } catch { /* links may be missing, as in New-Dashboard.ps1 */ }
  }
  return { connections, def };
}

function workItemUrl(id, wiText, repoGits, conf) {
  const link = field(wiText, "Link");
  if (link && /^https?:\/\//i.test(link)) return link;
  // From the "- ADO: <connection> (<collection>/<project>)" line written by Get-WorkItem.ps1.
  const ado = field(wiText, "ADO");
  let m;
  if (ado && (m = /^(\S+)\s*\(([^/)]+)(?:\/([^)]+))?\)/i.exec(ado))) {
    const c = conf.connections.get(m[1]);
    const coll = m[2];
    let proj = m[3];
    const server = c && c.serverUrl;
    if (server) {
      if (!proj) proj = c.project;
      const base = `${String(server).replace(/\/+$/, "")}/${coll}`;
      return proj ? `${base}/${escapeData(proj)}/_workitems/edit/${id}` : `${base}/_workitems/edit/${id}`;
    }
  }
  // From an ADO repo remote: <server>/<collection>/<project>/_git/<repo>
  for (const r of repoGits) {
    if (r.web && (m = /^(.+?)\/_git\//i.exec(r.web))) return `${m[1]}/_workitems/edit/${id}`;
  }
  // From the default (or only) connection.
  let name = conf.def;
  if (!name && conf.connections.size === 1) name = [...conf.connections.keys()][0];
  if (name && conf.connections.has(name)) {
    const c = conf.connections.get(name);
    const server = c && c.serverUrl;
    if (server && !/example\.local/i.test(server)) {
      const base = `${String(server).replace(/\/+$/, "")}/${c.collection == null ? "" : c.collection}`;
      return c.project ? `${base}/${escapeData(c.project)}/_workitems/edit/${id}` : `${base}/_workitems/edit/${id}`;
    }
  }
  return null;
}

/** The hidden folders as a set of lower-case "a" or "a/b/..." paths (up to REPO_DEPTH names). Anything else (empty, "..", deeper) is ignored. */
export function hiddenSet(list) {
  const out = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const parts = String(raw || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length > REPO_DEPTH || parts.some((x) => !x || x === "." || x === "..")) continue;
    out.add(lc(parts.join("/")));
  }
  return out;
}

// ---------------------------------------------------------------- the model

/**
 * Reads .work and the workspace repos. Same result as `New-Dashboard.ps1 -WorkRoot <workRoot> -AsJson`
 * (with -Hide for o.hide).
 * @param {object} o
 * @param {string} o.workRoot     the .work folder
 * @param {string} [o.configPath] Tandem's config.json (default ~/.config/eng-agents/config.json)
 * @param {number} [o.recent]     how many progress entries to keep for Recent activity (default 80)
 * @param {boolean} [o.gitOk]     whether git is on PATH (found when left out)
 * @param {string[]} [o.hide]     workspace folders to leave out with everything under them: a category
 *                                ("Tools", "Platform/Lighthouse") or a repo ("gh-repo", "Tools/workshop"), up to
 *                                REPO_DEPTH names. Case is ignored; a backslash is read as "/".
 */
export async function readWork({ workRoot, configPath, recent = 80, gitOk, hide = [] } = {}) {
  if (!workRoot || !isDir(workRoot)) throw new Error(`No work folder at '${workRoot}'. Run this from your workspace root, or pass -WorkRoot <path to .work>.`);
  const workRootFull = path.resolve(workRoot);
  const workspace = path.dirname(workRootFull);
  if (!configPath) configPath = path.join(os.homedir(), ".config", "eng-agents", "config.json");
  if (gitOk === undefined) gitOk = await hasGit();
  const git = makeGit(gitOk);
  const conf = readConfig(configPath);
  const repoCache = new Map(); // lower-case path -> Promise of state
  const webOf = new WeakMap(); // state -> its remote web object (New-Dashboard.ps1's _webObj, never serialized)

  // Live git state of one repo folder. Cached by full path.
  const repoState = (p) => {
    const key = lc(p);
    if (!repoCache.has(key)) repoCache.set(key, readRepo(p));
    return repoCache.get(key);
  };
  async function readRepo(p) {
    const s = {
      exists: isDir(p), isGit: false, branch: null, detached: false, upstream: null,
      ahead: 0, behind: 0, gone: false, changed: 0, files: [],
      lastSha: null, lastDate: null, lastMsg: null,
      defaultBranch: "main", unpushed: null, web: null, links: null,
    };
    if (!(s.exists && exists(path.join(p, ".git")))) return s;
    s.isGit = true;
    const [st, log, def, remote] = await Promise.all([
      git(p, ["status", "--porcelain=v1", "-b"]),
      git(p, ["log", "-1", "--format=%h%x1f%cI%x1f%s"]),
      git(p, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
      git(p, ["remote", "get-url", "origin"]),
    ]);
    let m;
    if (st !== null) {
      const lines = st.split("\n").filter((l) => l !== "");
      if (lines.length && lines[0].startsWith("## ")) {
        const h = lines[0].slice(3);
        if ((m = /^No commits yet on (\S+)/i.exec(h))) s.branch = m[1];
        else if (/^HEAD \(no branch\)/i.test(h)) s.detached = true;
        else if ((m = /^(.+?)\.\.\.(\S+)(?: \[(.+)\])?$/i.exec(h))) {
          s.branch = m[1]; s.upstream = m[2];
          const track = m[3];
          if (track) {
            let t;
            if ((t = /ahead (\d+)/i.exec(track))) s.ahead = parseInt(t[1], 10);
            if ((t = /behind (\d+)/i.exec(track))) s.behind = parseInt(t[1], 10);
            if (/gone/i.test(track)) s.gone = true;
          }
        } else s.branch = h.replace(/ \[.*\]$/i, "");
        const changes = lines.slice(1);
        s.changed = changes.length;
        s.files = changes.slice(0, 8).map((l) => l.slice(3).replace(/^"+|"+$/g, ""));
      }
    }
    if (log) {
      const parts = log.split("\x1f");
      if (parts.length >= 3) { s.lastSha = parts[0]; s.lastDate = parts[1]; s.lastMsg = parts[2]; }
    }
    if (def) s.defaultBranch = def.trim().replace(/^origin\//i, "");
    if (s.branch && !s.upstream && s.branch !== s.defaultBranch) {
      const n = await git(p, ["rev-list", "--count", `origin/${s.defaultBranch}..HEAD`]);
      if (n !== null && /^\d+$/.test(n)) s.unpushed = parseInt(n, 10);
    }
    const web = remoteWeb(remote);
    if (web) {
      s.web = web.url;
      s.links = branchLinks(web, s.branch, s.defaultBranch);
      webOf.set(s, web);
    }
    return s;
  }

  // Whether a branch is on origin, from what this clone last saw (no network).
  async function pushState(repo, branch) {
    const s = { local: false, remote: false, unpushed: null };
    if (!branch) return s;
    const [l, r] = await Promise.all([
      git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]),
      git(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]),
    ]);
    s.local = l !== null;
    s.remote = r !== null;
    if (s.local && s.remote) {
      const n = await git(repo, ["rev-list", "--count", `origin/${branch}..${branch}`]);
      if (n !== null && /^\d+$/.test(n)) s.unpushed = parseInt(n, 10);
    }
    return s;
  }

  const items = [];
  const activity = [];
  const dirs = entries(workRootFull).filter((d) => d.isDirectory() && !d.name.startsWith("_"));

  for (const dir of dirs) {
    const folder = path.join(workRootFull, dir.name);
    const modNs = lastModifiedNs(folder);
    const base = { folder: dir.name, modified: isoLocal(modNs), modifiedMs: epochMs(modNs), files: fileList(folder) };

    // Spikes, docs, TSDs, scopes, and PR reviews: light treatment.
    let km = /^(spike|docs|tsd|scope|pr)-(.+)$/i.exec(dir.name);
    if (km) {
      const kind = km[1];
      base.kind = kind;
      base.id = null;
      base.title = km[2].replace(/-/g, " ");
      base.bucket = "notes";
      const k = lc(kind);
      let m;
      if (k === "spike") {
        const f = readText(path.join(folder, "findings.md"));
        if (f && (m = /^#\s+Spike findings:\s*(.+?)\s*$/im.exec(f)) && cleanValue(m[1])) base.title = m[1];
        base.summary = section(f, "Short answer");
        base.recommendation = section(f, "Recommendation");
        base.nextText = section(f, "Next step");
        base.state = f ? "Findings written" : "In progress";
      } else if (k === "tsd") {
        const t = readText(path.join(folder, "tsd.md"));
        if (t && (m = /^#\s+Technical spec:\s*(.+?)\s*$/im.exec(t)) && cleanValue(m[1])) base.title = m[1];
        const st = gateStatus(path.join(folder, "tsd.md"));
        const check = readText(path.join(folder, "check.md"));
        const wrong = check ? [...check.matchAll(/\|\s*(Wrong|Outdated)\s*\|/gim)].length : 0;
        const rel = `.work/${dir.name}/tsd.md`;
        if (!t) { base.state = "In progress"; base.nextText = "Finish the draft with `/tsd`."; }
        // /publish writes "Status: PUBLISHED to <path> on <date>", which the gate pattern (letters and spaces only)
        // reads as UNKNOWN, so look for the word itself too.
        else if (st === "PUBLISHED" || st === "APPROVED" || /^\s*Status:\s*PUBLISHED\b/im.test(t)) { base.state = "Published"; base.nextText = "Commit the published copy in the product docs folder, if you have not."; }
        else if (!check) { base.state = "Draft, not fact-checked"; base.nextText = `Start a new session, then \`/check-docs ${rel}\`.`; }
        else if (wrong > 0) { base.state = `Draft, fact-check found ${wrong} wrong or outdated`; base.nextText = `Fix what check.md flags (edit tsd.md or re-run \`/tsd\`), then \`/publish ${dir.name}\`.`; }
        else { base.state = "Draft, fact-checked"; base.nextText = `Read it once more, then \`/publish ${dir.name}\`.`; }
      } else if (k === "pr") {
        base.title = `Pull request ${km[2]}`;
        base.prReview = prReview(folder, km[2]);
        if (base.prReview.title) base.title = base.prReview.title;
        base.state = base.prReview.state;
        base.summary = base.prReview.summary;
        base.nextText = base.prReview.nextText;
      } else if (k === "scope") {
        const e = readText(path.join(folder, "epics.md"));
        if (e && (m = /^Epic:\s*(.+?)\s*$/im.exec(e)) && cleanValue(m[1])) base.title = m[1];
        const stories = gateStatus(path.join(folder, "stories.md"));
        const miles = gateStatus(path.join(folder, "milestones.md"));
        const hasCsv = exists(path.join(folder, "backlog.csv"));
        const hasPub = exists(path.join(folder, "published.md"));
        const n = dir.name;
        if (!stories) { base.state = "Scoping"; base.nextText = "Finish scoping with `/scope`."; }
        else if (stories !== "APPROVED") { base.state = "Stories in review"; base.nextText = `Review epics.md and stories.md, then \`/approve ${n}\`.`; }
        else if (!miles) { base.state = "Stories approved"; base.nextText = `\`/slice ${n}\``; }
        else if (miles !== "APPROVED") { base.state = "Milestones in review"; base.nextText = `Review milestones.md, then \`/approve ${n} milestones\`.`; }
        else if (hasPub) { base.state = "Work items created"; base.nextText = "See published.md, then `/start <id> feature` for the first story."; }
        else if (hasCsv) { base.state = "Import file ready"; base.nextText = "Import backlog.csv in ADO, then `/start <id> feature` for the first story."; }
        else { base.state = "Milestones approved"; base.nextText = `\`/backlog ${n}\``; }
      } else {
        const hasCheck = exists(path.join(folder, "check.md"));
        base.state = hasCheck ? "Fact-checked" : "Written, not checked yet";
        base.nextText = hasCheck ? "Read check.md and fix anything it flags." : "Run /check-docs in a new session.";
      }
      items.push(base);
      continue;
    }

    // A work item folder is <id>-<short-name>: a tracker number (ADO) or a local id, L<number>.
    const im = /^(\d+|L\d+)-(.*)$/i.exec(dir.name);
    if (!im) {
      Object.assign(base, { kind: "other", id: null, title: dir.name, bucket: "notes" });
      items.push(base);
      continue;
    }
    const id = im[1];
    const slug = im[2];
    const wi = readText(path.join(folder, "workitem.md"));
    const reposText = readText(path.join(folder, "repos.md"));
    const progressText = readText(path.join(folder, "progress.md"));
    const pausedText = readText(path.join(folder, "paused.md"));

    let title = null;
    let m;
    if (wi && (m = /^#\s+Work item\s+L?\d+\s*:\s*(.+?)\s*$/im.exec(wi))) title = cleanValue(m[1]);
    if (!title && progressText && (m = /^#\s+Progress:\s*L?\d+\s+(.+?)\s*$/im.exec(progressText))) title = cleanValue(m[1]);
    if (!title) title = slug.replace(/-/g, " ");

    const type = field(wi, "Type");
    let lane = field(reposText, "Lane");
    let laneGuessed = false;
    if (lane) lane = lane.toLowerCase();
    else { laneGuessed = true; lane = type && /bug/i.test(type) ? "bug" : "feature"; }

    const repoStates = [];
    for (const r of repoRows(reposText)) {
      const gs = await repoState(path.join(workspace, r.folder));
      const web = webOf.get(gs);
      const links = r.branch && web ? branchLinks(web, r.branch, gs.defaultBranch) : null;
      repoStates.push({ folder: r.folder, branch: r.branch, shared: r.shared, why: r.why, git: gs, links });
    }

    const taskList = tasksOf(readText(path.join(folder, "tasks.md")));
    const tasks = { total: taskList.length, done: taskList.filter((t) => t.done).length, list: taskList };

    const reviewText = readText(path.join(folder, "review.md"));
    let verdict = null;
    if (reviewText) {
      verdict = "UNKNOWN";
      if ((m = /^\s*Verdict:\s*(.+?)\s*$/im.exec(reviewText))) {
        const v = cleanValue(m[1]);
        if (v) verdict = v.toUpperCase();
      }
    }

    const ents = progressEntries(progressText);
    ents.forEach((e, i) => activity.push({ date: e.date, command: e.command, agent: e.agent, did: e.did, verify: e.verify, id, folder: dir.name, title, order: i, modifiedMs: base.modifiedMs }));
    const last = ents.length ? ents[ents.length - 1] : null;

    // The last /do-task run failed or says it is blocked.
    let blocked = null;
    if (last && /do-task/i.test(last.command)) {
      const txt = `${last.did ?? ""} ${last.notes ?? ""} ${last.verify ?? ""}`;
      if ((last.verify && /\bFAIL/i.test(last.verify)) || /\bblocked\b/i.test(txt)) blocked = last.notes || last.did || "Verify failed.";
    }

    let paused = null;
    let pausedStatus = null;
    if (pausedText && (m = /^\s*Status:\s*(\w+)/im.exec(pausedText))) pausedStatus = m[1].toUpperCase();
    if (pausedStatus === "PAUSED") {
      paused = {
        since: field(pausedText, "Paused"),
        reason: field(pausedText, "Reason"),
        inProgress: field(pausedText, "In progress"),
        wip: section(pausedText, "Work in progress"),
        waiting: section(pausedText, "Waiting on"),
      };
      if (paused.reason && /^not given$/i.test(paused.reason)) paused.reason = null;
      if (paused.wip && /^none\.?$/i.test(paused.wip)) paused.wip = null;
      if (paused.waiting && /^-?\s*nothing\.?$/i.test(paused.waiting)) paused.waiting = null;
    }

    let url;
    if (/^L/i.test(id)) {
      const l = field(wi, "Link");
      url = l && /^https?:\/\//i.test(l) ? l : null;
    } else url = workItemUrl(id, wi, repoStates.map((r) => r.git), conf);

    const item = {
      kind: "item", id, folder: base.folder, title,
      type, adoState: field(wi, "State"), fetched: field(wi, "Fetched"),
      lane, laneGuessed,
      url,
      hasRepos: !!reposText, hasPr: exists(path.join(folder, "pr.md")),
      gates: {
        spec: gateStatus(path.join(folder, "spec.md")),
        plan: gateStatus(path.join(folder, "plan.md")),
        bug: gateStatus(path.join(folder, "bug.md")),
        review: verdict,
      },
      tasks, blocked, paused, last,
      repos: repoStates,
      modified: base.modified, modifiedMs: base.modifiedMs,
      files: base.files,
    };

    // PR text per repo, with the ADO "create PR" link and whether the branch is pushed.
    const prList = [];
    if (item.hasPr) {
      for (const sec of prSections(readText(path.join(folder, "pr.md")))) {
        const row = repoStates.find((r) => lc(r.folder) === lc(sec.repo) || lc(path.basename(r.folder)) === lc(sec.repo));
        const folderName = row ? row.folder : sec.repo;
        const branch = sec.branch || (row ? row.branch : null) || null;
        const repoPath = path.join(workspace, folderName);
        const gs = await repoState(repoPath);
        const target = sec.target || gs.defaultBranch;
        const web = webOf.get(gs);
        const links = branch && web ? branchLinks(web, branch, target) : null;
        const push = gs.isGit ? await pushState(repoPath, branch) : null;
        const q = /\s/.test(folderName) ? `"${folderName}"` : folderName;
        prList.push({ repo: folderName, branch, target, title: sec.title, description: sec.description, links, web: gs.web, push, pushCmd: branch ? `git -C ${q} push -u origin ${branch}` : null });
      }
    }
    item.pr = prList;

    const next = nextStep(item, folder);
    item.next = next;
    item.stage = next.stage;
    item.bucket = paused ? "paused" : next.needsYou ? "needs" : next.stage === "ship" ? "ship" : "active";

    // What to type after a reboot.
    const resume = [`cd "${workspace}"`, "opencode"];
    if (paused) resume.push(`/resume ${id}`);
    else if (next.command) resume.push(next.command);
    item.resume = resume;

    items.push(item);
  }

  // ------------------------------------------------------- workspace repos
  // Repos anywhere up to REPO_DEPTH folders deep (<workspace>/<Category>/<Sub>/<repo>), so repos can be grouped by
  // product. A repo's own folders are never searched, nor are dot folders (.work) or node_modules. Every other folder
  // on the way is a category ("Platform", "Platform/Lighthouse"), even with no repos (Add a repo can clone into one).
  // Hidden folders (Settings, Repos, Hidden folders) are left out with everything under them: no repo, no category.
  const hiddenDirs = hiddenSet(hide);
  const itemIds = new Set(items.filter((i) => i.kind === "item").map((i) => lc(i.id)));
  const repoDirs = [];
  const repoCategories = [];
  const walkRepos = (dir, rel, depth) => {
    for (const d of entries(dir).filter((x) => x.isDirectory() && x.name !== "node_modules").sort((a, b) => cmp(a.name, b.name))) {
      const full = path.join(dir, d.name);
      const folder = rel ? `${rel}/${d.name}` : d.name;
      if (hiddenDirs.has(lc(folder))) continue;
      if (exists(path.join(full, ".git"))) { repoDirs.push({ folder, path: full }); continue; }
      if (depth >= REPO_DEPTH) continue;
      repoCategories.push(folder);
      walkRepos(full, folder, depth + 1);
    }
  };
  walkRepos(workspace, "", 1);
  const repos = [];
  for (const d of repoDirs) {
    const gs = await repoState(d.path);
    let owner = null;
    const om = gs.branch && /^dev\/[^/]+\/(\d+|L\d+)-/i.exec(gs.branch);
    if (om) owner = om[1];
    repos.push({ folder: d.folder, git: gs, owner, ownerKnown: !!(owner && itemIds.has(lc(owner))) });
  }

  const sortedActivity = activity
    .map((a, i) => ({ a, i }))
    .sort((x, y) => -cmp(x.a.date, y.a.date) || y.a.modifiedMs - x.a.modifiedMs || y.a.order - x.a.order || x.i - y.i)
    .slice(0, recent)
    .map((x) => x.a);

  const nowNs = BigInt(Date.now()) * 1000000n;
  return {
    generated: isoLocal(nowNs),
    generatedMs: epochMs(nowNs),
    workspace,
    workRoot: workRootFull,
    gitAvailable: gitOk,
    configFound: exists(configPath),
    stepWords: { ...STEP_WORDS },
    refreshCommand: "/dashboard static",
    refreshShell: null,
    items: items.map((it, i) => ({ it, i })).sort((x, y) => y.it.modifiedMs - x.it.modifiedMs || x.i - y.i).map((x) => x.it),
    repos,
    repoCategories,
    activity: sortedActivity,
  };
}

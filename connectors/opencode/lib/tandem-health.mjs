// Tandem health: the numbers behind Loom's Health > Tandem section (docs/tandem-health.md).
//
// pipelineStats and reviewFindings read .work the way eng-agents' Get-PipelineStats.ps1 and
// Get-ReviewFindings.ps1 do (Tandem Core 2.26.0). The two must agree: tests/contract/tandem-health.test.mjs
// checks this port against docs/examples/work/expected-health.json, and eng-agents' Test-HealthFormat.ps1
// checks the PowerShell scripts against the same file. Change both sides together.
//
// Local and read-only: no network, nothing is written.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HEALTH_VERSION = 1;

const GATE_FILES = ["spec", "plan", "bug", "stories", "milestones", "refine", "quick"];
const PHASES = ["start", "spec", "bug", "quick", "plan", "tasks", "do-task", "review", "pr"];
const ROUNDS = ["spec", "plan", "bug", "quick", "review"];

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
const lines = (t) => (t || "").split(/\r?\n/);
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function dirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(ordinal);
  } catch {
    return [];
  }
}

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const back = new Date(d);
  return back.getUTCMonth() === +m[2] - 1 && back.getUTCDate() === +m[3] ? d : null;
}
const day = (ms) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
const dayDiff = (a, b) => (a == null || b == null ? null : Math.round((b - a) / 86400000));

/** Half away from zero, as the PowerShell side ([MidpointRounding]::AwayFromZero). */
function roundAway(x, digits = 0) {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}
function median(values) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return roundAway(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, 1);
}
const rate = (part, whole) => (whole > 0 ? roundAway((100 * part) / whole) : null);

/** progress.md entries: date, command, verify, and the Stats key=value pairs. */
export function entries(text) {
  const list = [];
  let cur = null;
  for (const line of lines(text)) {
    const h = /^##\s+(\d{4}-\d{2}-\d{2})[^|]*\|\s*`?\/?([A-Za-z][\w-]*)/.exec(line);
    if (h) {
      cur = { date: parseDay(h[1]), command: h[2].toLowerCase(), verify: null, stats: {} };
      list.push(cur);
      continue;
    }
    if (/^##\s/i.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const v = /^\s*-\s*Verify\s*:.*?->\s*`?(PASS|FAIL)/i.exec(line);
    if (v) {
      cur.verify = v[1].toUpperCase();
      continue;
    }
    const s = /^\s*-\s*Stats\s*:\s*(.*)$/.exec(line);
    if (s) for (const p of s[1].matchAll(/([A-Za-z_]+)=([^\s,;]+)/g)) cur.stats[p[1].toLowerCase()] = p[2].replace(/^`+|`+$/g, "");
  }
  return list;
}
const intStat = (e, k) => (Object.prototype.hasOwnProperty.call(e.stats, k) && /^-?\d+$/.test(e.stats[k]) ? parseInt(e.stats[k], 10) : null);
const statIs = (e, k, want) => Object.prototype.hasOwnProperty.call(e.stats, k) && String(e.stats[k]).toUpperCase() === want.toUpperCase();
function firstDate(list, command) {
  const e = list.find((x) => x.command === command && x.date != null);
  return e ? e.date : null;
}

/** Same result as Get-PipelineStats.ps1 -AsJson, without "generated". */
export function pipelineStats(workRoot, { since = null } = {}) {
  const sinceMs = since ? parseDay(since) : null;
  if (since && sinceMs == null) throw new Error("since must be yyyy-MM-dd");
  const items = [];
  for (const name of dirs(workRoot)) {
    const nm = /^(\d+|L\d+)-(.+)$/.exec(name);
    if (!nm) continue;
    const folder = path.join(workRoot, name);
    const list = entries(readText(path.join(folder, "progress.md")));
    const repos = readText(path.join(folder, "repos.md"));
    let lane = null;
    let repoCount = null;
    if (repos) {
      const lm = /^\s*Lane\s*:\s*([a-z]+)/im.exec(repos);
      if (lm) lane = lm[1].toLowerCase();
      repoCount = (repos.match(/^\|\s*\d+\s*\|/gm) || []).length;
    }
    if (!lane) {
      const tm = /^\s*(?:-\s*)?Type\s*:\s*(.*?)\s*$/im.exec(readText(path.join(folder, "workitem.md")) || "");
      lane = tm && /bug/i.test(tm[1]) ? "bug" : "feature";
    }
    let started = firstDate(list, "start");
    if (started == null && list.length) started = list[0].date;
    if (sinceMs != null && (started == null || started < sinceMs)) continue;

    const phases = {};
    for (const c of PHASES) phases[c] = day(firstDate(list, c));
    const prDate = firstDate(list, "pr");
    const quickEscalated = list.some((e) => e.command === "quick" && statIs(e, "escalated", "1"));
    const rounds = {};
    for (const c of ROUNDS) rounds[c] = list.filter((e) => e.command === c).length;
    const gates = list.filter((e) => e.command === "approve").map((e) => ({
      file: Object.prototype.hasOwnProperty.call(e.stats, "file") ? e.stats.file.toLowerCase().replace(/\.md$/, "") : "unknown",
      result: Object.prototype.hasOwnProperty.call(e.stats, "gate") ? e.stats.gate.toLowerCase() : "unknown",
    }));
    let questions = null;
    let assumptions = null;
    for (const e of list) {
      const q = intStat(e, "questions");
      if (q != null) questions = (questions || 0) + q;
      const a = intStat(e, "assumptions");
      if (a != null) assumptions = (assumptions || 0) + a;
    }
    const doTasks = list.filter((e) => e.command === "do-task");
    const verifyFails = doTasks.filter((e) => e.verify === "FAIL" || statIs(e, "verify", "FAIL")).length;
    const fullFails = doTasks.filter((e) => statIs(e, "full", "FAIL")).length;

    const tasksText = readText(path.join(folder, "tasks.md"));
    let tasksTotal = null;
    let tasksDone = null;
    let tasksAdded = null;
    if (tasksText != null) {
      tasksTotal = (tasksText.match(/^##\s*\[[ xX]\]\s*Task\s+\d+/gm) || []).length;
      tasksDone = (tasksText.match(/^##\s*\[[xX]\]\s*Task\s+\d+/gm) || []).length;
      let planned = null;
      for (const e of list.filter((x) => ["tasks", "bug", "quick"].includes(x.command))) {
        const t = intStat(e, "tasks");
        if (t != null) planned = t;
      }
      if (planned != null) tasksAdded = Math.max(0, tasksTotal - planned);
    }

    const reviewText = readText(path.join(folder, "review.md"));
    let verdict = null;
    const findings = { blocker: null, shouldFix: null, nit: null };
    const categories = {};
    if (reviewText != null) {
      const vm = /^\s*Verdict\s*:\s*(READY|CHANGES NEEDED)/im.exec(reviewText);
      if (vm) verdict = vm[1].toUpperCase();
      findings.blocker = 0;
      findings.shouldFix = 0;
      findings.nit = 0;
      for (const row of reviewText.matchAll(/^\|\s*\d+\s*\|\s*(Blocker|Should fix|Nit)\s*\|(?:\s*([a-z-]+)\s*\|)?/gm)) {
        if (row[1] === "Blocker") findings.blocker++;
        else if (row[1] === "Should fix") findings.shouldFix++;
        else findings.nit++;
        if (row[2]) categories[row[2]] = (categories[row[2]] || 0) + 1;
      }
    }

    items.push({
      id: nm[1],
      name: nm[2],
      lane,
      repos: repoCount,
      started: day(started),
      prDrafted: day(prDate),
      daysToPr: dayDiff(started, prDate),
      phases,
      rounds,
      gates,
      questions,
      assumptions,
      doTaskRuns: doTasks.length,
      verifyFails,
      fullSuiteFails: fullFails,
      tasksTotal,
      tasksDone,
      tasksAdded,
      quickEscalated,
      retro: fs.existsSync(path.join(folder, "retro.md")),
      verdict,
      findings,
      categories,
    });
  }

  const withPr = items.filter((i) => i.daysToPr != null);
  const reviewed = items.filter((i) => i.rounds.review > 0);
  const gateSummary = {};
  for (const f of [...GATE_FILES, "unknown"]) {
    const rows = items.flatMap((i) => i.gates).filter((g) => g.file === f);
    if (!rows.length) continue;
    const unchanged = rows.filter((g) => g.result === "unchanged").length;
    const edited = rows.filter((g) => g.result === "edited").length;
    gateSummary[f] = {
      approvals: rows.length,
      unchanged,
      edited,
      noHash: rows.filter((g) => g.result === "no-hash" || g.result === "unknown").length,
      unchangedRate: rate(unchanged, unchanged + edited),
    };
  }
  const lanes = {};
  for (const i of items) lanes[i.lane || "unknown"] = (lanes[i.lane || "unknown"] || 0) + 1;
  const catTotals = {};
  for (const i of items) for (const [k, n] of Object.entries(i.categories)) catTotals[k] = (catTotals[k] || 0) + n;
  const qItems = items.filter((i) => i.questions != null);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const doTaskRuns = sum(items.map((i) => i.doTaskRuns));
  const verifyFailsAll = sum(items.map((i) => i.verifyFails));
  const summary = {
    items: items.length,
    lanes,
    reachedPr: withPr.length,
    medianDaysToPr: median(withPr.map((i) => i.daysToPr)),
    medianReviewRounds: median(reviewed.map((i) => i.rounds.review)),
    multiReviewRate: rate(reviewed.filter((i) => i.rounds.review > 1).length, reviewed.length),
    questions: qItems.length ? sum(qItems.map((i) => i.questions)) : null,
    assumptions: qItems.length ? sum(qItems.map((i) => i.assumptions || 0)) : null,
    doTaskRuns,
    verifyFailRate: rate(verifyFailsAll, doTaskRuns),
    fullSuiteFails: sum(items.map((i) => i.fullSuiteFails)),
    tasksAddedByReview: sum(items.filter((i) => i.tasksAdded != null).map((i) => i.tasksAdded)),
    blockers: sum(items.filter((i) => i.findings.blocker != null).map((i) => i.findings.blocker)),
    findingCategories: catTotals,
    retros: items.filter((i) => i.retro).length,
    quickEscalations: items.filter((i) => i.quickEscalated).length,
  };
  return { version: 1, since: sinceMs == null ? null : day(sinceMs), summary, gates: gateSummary, items };
}

function cells(line) {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  return t.replace(/^\|+|\|+$/g, "").split("|").map((c) => c.trim().replace(/^`+|`+$/g, "").trim());
}

/** Same result as Get-ReviewFindings.ps1 -AsJson (-Since and -Id). */
export function reviewFindings(workRoot, { since = null, id = null } = {}) {
  const sinceMs = since ? parseDay(since) : null;
  const findings = [];
  const reviewedItems = [];
  for (const name of dirs(workRoot)) {
    const nm = /^(\d+|L\d+)-(.+)$/.exec(name);
    if (!nm) continue;
    if (id && nm[1] !== id) continue;
    const folder = path.join(workRoot, name);
    const files = [];
    const hist = path.join(folder, "history");
    try {
      for (const f of fs.readdirSync(hist).filter((n) => /^review-.*\.md$/i.test(n)).sort(ordinal)) files.push({ rel: "history/" + f, full: path.join(hist, f) });
    } catch { /* no history */ }
    if (fs.existsSync(path.join(folder, "review.md"))) files.push({ rel: "review.md", full: path.join(folder, "review.md") });
    let any = false;
    for (const f of files) {
      if (sinceMs != null) {
        const m = fs.statSync(f.full).mtime;
        if (Date.UTC(m.getFullYear(), m.getMonth(), m.getDate()) < sinceMs) continue;
      }
      any = true;
      for (const line of lines(readText(f.full))) {
        const c = cells(line);
        if (!c || c.length < 5 || !/^\d+$/.test(c[0]) || !/^(Blocker|Should fix|Nit)$/.test(c[1])) continue;
        let cat, loc, prob;
        if (c.length >= 6) [cat, loc, prob] = [c[2].toLowerCase(), c[3], c[4]];
        else [cat, loc, prob] = ["uncategorized", c[2], c[3]];
        if (!cat || /^<.*>$/.test(cat)) cat = "uncategorized";
        const rm = /^([^/\\:\s]+)[/\\]/.exec(loc);
        findings.push({ id: nm[1], item: name, file: f.rel, severity: c[1], category: cat, repo: rm ? rm[1] : null, location: loc, problem: prob });
      }
    }
    if (any) reviewedItems.push(name);
  }
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.repo || "(no repo)"}|${f.category}`;
    if (!groups.has(key)) groups.set(key, { repo: f.repo, category: f.category, items: [], findings: 0, blockers: 0, examples: [] });
    const g = groups.get(key);
    if (!g.items.includes(f.item)) g.items.push(f.item);
    g.findings++;
    if (f.severity === "Blocker") g.blockers++;
    if (g.examples.length < 3) g.examples.push(`${f.item}: ${f.problem}`);
  }
  const patterns = [...groups.values()]
    .map((g) => ({ repo: g.repo, category: g.category, itemCount: g.items.length, items: g.items, findings: g.findings, blockers: g.blockers, repeats: g.items.length >= 2, examples: g.examples }))
    .sort((a, b) => b.itemCount - a.itemCount || b.findings - a.findings);
  return { version: 1, since: sinceMs == null ? null : day(sinceMs), itemsReviewed: reviewedItems.length, findings, patterns };
}

/** eng-agents' install manifest (install.ps1): version, commit and the clone it came from. */
export function installInfo(home = os.homedir()) {
  const file = path.join(home, ".config", "opencode", "eng-agents", "manifest.json");
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    const core = (m.components && m.components.core) || {};
    return { version: core.version || null, commit: core.commit || null, installed: core.installed || null, source: m.source || null };
  } catch {
    return null;
  }
}

/** The newest two eval results in <eng-agents clone>/evals/results (evals/README.md), summed up per case. */
export function evalResults(source) {
  if (!source) return null;
  const dir = path.join(source, "evals", "results");
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return null;
  }
  const runs = names
    .map((n) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
        return { file: n, date: d.date || null, tandem: d.tandem || null, model: d.model || null, runsPerCase: d.runsPerCase || null, cases: (d.cases || []).map((c) => ({ case: c.case, passes: c.passes ?? null, total: c.total ?? null, rate: c.rate ?? null, skipped: c.skipped || null })) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => ordinal(a.date || "", b.date || ""));
  if (!runs.length) return { latest: null, previous: null };
  return { latest: runs[runs.length - 1], previous: runs.length > 1 ? runs[runs.length - 2] : null };
}

/** Git repos in the workspace: top level and inside category folders, up to 4 deep (like the connector's parser). */
export function listRepos(workspace, maxDepth = 4) {
  const out = [];
  const walk = (rel, depth) => {
    let ents;
    try {
      ents = fs.readdirSync(path.join(workspace, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (fs.existsSync(path.join(workspace, r, ".git"))) out.push(r);
      else if (depth < maxDepth) walk(r, depth + 1);
    }
  };
  if (workspace) walk("", 1);
  return out.sort(ordinal);
}

/** Repo guides in the workspace: repos without one, and guides still holding TODO(you). */
export function repoGuides(workspace, repos) {
  const missing = [];
  const todo = [];
  for (const r of repos) {
    const dir = path.join(workspace, r);
    const guide = [path.join(dir, "AGENTS.local.md"), path.join(dir, "AGENTS.md")].find((p) => fs.existsSync(p));
    if (!guide) missing.push(r);
    else if (/TODO\(you\)/.test(readText(guide) || "")) todo.push(r);
  }
  return { total: repos.length, missing, todo };
}

/** Everything Health > Tandem shows (docs/tandem-health.md). */
export function tandemHealth({ workRoot, workspace, repos = listRepos(workspace), since = null, home } = {}) {
  const install = installInfo(home);
  return {
    version: HEALTH_VERSION,
    pipeline: pipelineStats(workRoot, { since }),
    findings: reviewFindings(workRoot, { since }),
    evals: install ? evalResults(install.source) : null,
    setup: { install, workspace: workspace || null, repoGuides: repoGuides(workspace, repos) },
  };
}

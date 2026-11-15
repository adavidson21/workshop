// lib/tandem-health.mjs: Tandem health (docs/tandem-health.md). The .work parts must read the example workspace exactly
// as docs/examples/work/expected-health.json says (eng-agents' Get-PipelineStats.ps1 and Get-ReviewFindings.ps1 are
// checked against the same file by its Test-HealthFormat.ps1).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evalResults, installInfo, listRepos, pipelineStats, repoGuides, reviewFindings, tandemHealth } from "../lib/tandem-health.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const example = path.join(REPO, "docs", "examples", "work");

function copyWithSameTimes(src, dest, when) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyWithSameTimes(s, d, when);
    else if (!e.name.startsWith("expected")) { fs.copyFileSync(s, d); fs.utimesSync(d, when, when); }
  }
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "tandem-health-")); }

test("the example workspace gives what expected-health.json says (pipeline and findings)", () => {
  const root = tmp();
  try {
    copyWithSameTimes(example, root, new Date("2026-10-18T12:00:00Z"));
    const want = JSON.parse(fs.readFileSync(path.join(example, "expected-health.json"), "utf8"));
    assert.deepEqual(pipelineStats(root), want.pipeline);
    assert.deepEqual(reviewFindings(root), want.findings);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("since keeps items started on or after the day, and refuses a bad day", () => {
  const root = tmp();
  try {
    copyWithSameTimes(example, root, new Date("2026-10-18T12:00:00Z"));
    const all = pipelineStats(root);
    const later = pipelineStats(root, { since: "2026-10-12" });
    assert.ok(later.items.length < all.items.length);
    assert.ok(later.items.every((i) => i.started >= "2026-10-12"));
    assert.equal(later.since, "2026-10-12");
    assert.throws(() => pipelineStats(root, { since: "2026-13-40" }), /yyyy-MM-dd/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("an empty .work gives zero items and nulls, not errors", () => {
  const root = tmp();
  try {
    const p = pipelineStats(root);
    assert.equal(p.summary.items, 0);
    assert.equal(p.summary.medianDaysToPr, null);
    assert.equal(p.summary.verifyFailRate, null);
    assert.deepEqual(p.gates, {});
    assert.deepEqual(reviewFindings(root).patterns, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a pattern repeats when one repo and category shows up in two items; rounds of one item count once", () => {
  const root = tmp();
  try {
    const row = (sev, cat, loc) => `| 1 | ${sev} | ${cat} | \`${loc}\` | problem | fix |\n`;
    for (const [id, files] of Object.entries({
      "1-a": { "review.md": row("Blocker", "correctness", "api/a.cs:1"), "history/review-2026-10-01-1.md": row("Nit", "correctness", "api/a.cs:2") },
      "2-b": { "review.md": row("Should fix", "correctness", "api\\b.cs:3") },
      "3-c": { "review.md": "| 1 | Nit | `web/c.ts:1` | old table | fix |\n" },
    })) {
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, id, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, id, rel), text);
      }
    }
    const f = reviewFindings(root);
    assert.equal(f.findings.length, 4);
    const top = f.patterns[0];
    assert.deepEqual([top.repo, top.category, top.itemCount, top.findings, top.blockers, top.repeats], ["api", "correctness", 2, 3, 1, true]);
    assert.equal(f.findings.find((x) => x.id === "3").category, "uncategorized");
    assert.equal(reviewFindings(root, { id: "2" }).findings.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("install record, eval results and repo guides", () => {
  const home = tmp();
  try {
    const source = path.join(home, "src", "eng-agents");
    fs.mkdirSync(path.join(home, ".config", "opencode", "eng-agents"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "opencode", "eng-agents", "manifest.json"), JSON.stringify({ source, components: { core: { version: "2.26.0", commit: "abc1234def", installed: "2026-11-14T10:00:00" } } }));
    assert.deepEqual(installInfo(home), { version: "2.26.0", commit: "abc1234def", installed: "2026-11-14T10:00:00", source });

    assert.deepEqual(evalResults(source), null, "no results folder: null");
    const dir = path.join(source, "evals", "results");
    fs.mkdirSync(dir, { recursive: true });
    assert.deepEqual(evalResults(source), { latest: null, previous: null });
    const run = (date, rate) => ({ date, tandem: "2.26.0", model: "m", runsPerCase: 3, cases: [{ case: "spec-basic", passes: rate === 100 ? 3 : 2, total: 3, rate }, { case: "do-task", skipped: "needs dotnet", runs: [] }] });
    fs.writeFileSync(path.join(dir, "2.25.0-1.json"), JSON.stringify(run("2026-11-01T10:00:00", 100)));
    fs.writeFileSync(path.join(dir, "2.26.0-2.json"), JSON.stringify(run("2026-11-14T10:00:00", 67)));
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    const e = evalResults(source);
    assert.equal(e.latest.file, "2.26.0-2.json");
    assert.equal(e.previous.file, "2.25.0-1.json");
    assert.equal(e.latest.cases[0].rate, 67);
    assert.equal(e.latest.cases[1].skipped, "needs dotnet");

    const ws = path.join(home, "work");
    for (const r of ["api", "Platform/web", "Platform/docs"]) fs.mkdirSync(path.join(ws, r, ".git"), { recursive: true });
    fs.writeFileSync(path.join(ws, "api", "AGENTS.md"), "# api\n");
    fs.writeFileSync(path.join(ws, "Platform", "web", "AGENTS.local.md"), "TODO(you) fill this in\n");
    fs.mkdirSync(path.join(ws, ".work"), { recursive: true });
    assert.deepEqual(listRepos(ws), ["Platform/docs", "Platform/web", "api"]);
    assert.deepEqual(repoGuides(ws, listRepos(ws)), { total: 3, missing: ["Platform/docs"], todo: ["Platform/web"] });

    const h = tandemHealth({ workRoot: path.join(ws, ".work"), workspace: ws, home });
    assert.equal(h.version, 1);
    assert.equal(h.pipeline.summary.items, 0);
    assert.equal(h.evals.latest.file, "2.26.0-2.json");
    assert.equal(h.setup.install.version, "2.26.0");
    assert.equal(h.setup.repoGuides.total, 3);
    assert.equal(tandemHealth({ workRoot: path.join(ws, ".work"), workspace: ws, home: path.join(home, "nobody") }).evals, null);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

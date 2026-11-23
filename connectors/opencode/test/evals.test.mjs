// lib/evals.mjs: Bench's reads of Tandem's eval cases and results, and the run command (docs/bench.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { commandFor, evalsHome, liftOf, listCases, listExperiments, listResults, openEvalsTerminal, readCommands, readGuards, readResult, runArgs, scriptArgs, summarize } from "../lib/evals.mjs";
import { evalResults } from "../lib/tandem-health.mjs";

function clone() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "bench-"));
  const ev = path.join(src, "evals");
  fs.mkdirSync(path.join(ev, "cases"), { recursive: true });
  fs.mkdirSync(path.join(ev, "results"), { recursive: true });
  fs.writeFileSync(path.join(ev, "Invoke-Evals.ps1"), "# stub\n");
  fs.writeFileSync(path.join(ev, "cases", "spec-basic.json"), JSON.stringify({ description: "spec stays DRAFT", command: "spec", arguments: "L1 auto", grader: "Test-SpecBasic" }));
  fs.writeFileSync(path.join(ev, "cases", "feature-outcome.json"), JSON.stringify({ description: "outcome", steps: [{ command: "spec" }, { approve: "spec.md" }], baseline: { prompt: "do it" }, needs: ["dotnet"] }));
  fs.writeFileSync(path.join(ev, "cases", "Bad Name.json"), "{}");
  return src;
}
const v2 = (date, t, b) => ({
  version: 2, tandem: "3.1.0", model: "opencode/free", runsPerCase: 3, autoApprove: true, arms: ["tandem", "baseline"], date,
  cases: [
    { case: "feature-outcome", arm: "tandem", passes: t, total: 3, rate: Math.round((100 * t) / 3), passAll: t === 3, meanSeconds: 300,
      runs: [{ run: 1, pass: true, seconds: 290, timedOut: false, failed: [], steps: [{ step: "/spec L1 auto", ok: true, seconds: 40, timedOut: false }], log: "/tmp/x.log" }] },
    { case: "feature-outcome", arm: "baseline", passes: b, total: 3, rate: Math.round((100 * b) / 3), passAll: b === 3, meanSeconds: 90,
      runs: [{ run: 1, pass: false, seconds: 88, timedOut: false, failed: [{ check: "threshold and rate live in PricingOptions", detail: "" }], steps: [] }] },
    { case: "spec-basic", arm: "tandem", passes: 3, total: 3, rate: 100, runs: [] },
  ],
});

test("evalsHome needs Invoke-Evals.ps1; listCases reads names, lift and steps, and skips bad names", () => {
  const src = clone();
  try {
    assert.equal(evalsHome(null), null);
    assert.equal(evalsHome(path.join(src, "nope")), null);
    const home = evalsHome(src);
    const cases = listCases(home);
    assert.deepEqual(cases.map((c) => c.name), ["feature-outcome", "spec-basic"]);
    assert.equal(cases[0].lift, true);
    assert.equal(cases[0].steps, 2);
    assert.deepEqual(cases[0].needs, ["dotnet"]);
    assert.equal(cases[1].lift, false);
    assert.equal(cases[1].command, "spec");
    assert.equal(cases[1].answers, 0);
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

test("listResults sums up version 1 and 2 files newest first, with the lift; readResult adds runs", () => {
  const src = clone();
  try {
    const dir = path.join(src, "evals", "results");
    fs.writeFileSync(path.join(dir, "3.0.0-1.json"), JSON.stringify({ version: 1, tandem: "3.0.0", model: "m", runsPerCase: 3, date: "2026-11-10T10:00:00", cases: [{ case: "spec-basic", passes: 2, total: 3, rate: 67, runs: [{ seconds: 10 }, { seconds: 20 }] }] }));
    fs.writeFileSync(path.join(dir, "3.1.0-2.json"), JSON.stringify(v2("2026-11-14T10:00:00", 2, 1)));
    fs.writeFileSync(path.join(dir, "9.0.0-3.json"), JSON.stringify({ version: 9, cases: [] }));
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    const home = evalsHome(src);
    const list = listResults(home);
    assert.deepEqual(list.map((r) => r.file), ["3.1.0-2.json", "3.0.0-1.json", "9.0.0-3.json"]);
    assert.equal(list[2].unsupported, true);
    const [latest, old] = list;
    assert.deepEqual(latest.arms, ["tandem", "baseline"]);
    assert.deepEqual(latest.lift, [{ case: "feature-outcome", model: null, tandem: 67, baseline: 33, lift: 34, tandemAll: false, baselineAll: false }]);
    assert.equal(old.cases[0].arm, "tandem", "version 1 rows are the tandem arm");
    assert.equal(old.cases[0].meanSeconds, 15, "mean seconds worked out from runs");
    assert.equal(old.cases[0].passAll, false);
    assert.equal(latest.cases[0].runs, undefined, "the list has no runs");

    const one = readResult(home, "3.1.0-2.json");
    assert.equal(one.cases[1].runs[0].failed[0].check, "threshold and rate live in PricingOptions");
    assert.equal(one.cases[0].runs[0].steps[0].step, "/spec L1 auto");
    assert.throws(() => readResult(home, "../secret.json"), (e) => e.status === 400);
    assert.throws(() => readResult(home, "missing.json"), (e) => e.status === 404);
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

test("Builds' Prompts (tandem.health evals) keeps the tandem arm only", () => {
  const src = clone();
  try {
    fs.writeFileSync(path.join(src, "evals", "results", "3.1.0-2.json"), JSON.stringify(v2("2026-11-14T10:00:00", 3, 0)));
    const e = evalResults(src);
    assert.deepEqual(e.latest.cases.map((c) => c.case), ["feature-outcome", "spec-basic"]);
    assert.equal(e.latest.cases[0].rate, 100);
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

test("summarize and liftOf ignore skipped rows and cases in one arm", () => {
  const s = summarize({ cases: [{ case: "a", arm: "tandem", skipped: "needs dotnet", runs: [] }, { case: "a", arm: "baseline", rate: 0, passes: 0, total: 3 }] }, "f.json");
  assert.deepEqual(s.lift, []);
  assert.equal(s.cases[0].passAll, null);
  assert.deepEqual(liftOf([]), []);
  assert.equal(summarize({ nope: 1 }, "f.json"), null);
});

test("runArgs builds checked arguments and refuses anything else", () => {
  const known = [{ name: "feature-outcome", lift: true }, { name: "spec-basic", lift: false }];
  assert.deepEqual(runArgs({ cases: ["feature-outcome"], arm: "both", runs: 3, model: "opencode/free-model", autoApprove: true }, known),
    ["-Case", "feature-outcome", "-Arm", "both", "-Runs", "3", "-Model", "opencode/free-model", "-AutoApprove"]);
  assert.deepEqual(runArgs({ cases: ["spec-basic", "spec-basic"] }, known), ["-Case", "spec-basic", "-Arm", "tandem", "-Runs", "3"]);
  const bad = (a) => assert.throws(() => runArgs(a, known), (e) => e.status === 400);
  bad({ cases: [] });
  bad({ cases: ["nope"] });
  bad({ cases: ["spec-basic; rm -rf ~"] });
  bad({ cases: ["spec-basic"], arm: "both" });
  bad({ cases: ["spec-basic"], arm: "all" });
  bad({ cases: ["spec-basic"], runs: 0 });
  bad({ cases: ["spec-basic"], runs: 11 });
  bad({ cases: ["spec-basic"], runs: 2.5 });
  bad({ cases: ["spec-basic"], model: "no slash" });
  bad({ cases: ["spec-basic"], model: "a/b'; calc" });
});

test("commandFor quotes for PowerShell and for sh; openEvalsTerminal opens a window on Windows and macOS only", async () => {
  const home = { source: "/Users/me/eng-agents", script: "/Users/me/eng-agents/evals/Invoke-Evals.ps1" };
  const args = ["-Case", "feature-outcome", "-Arm", "both", "-Runs", "3", "-AutoApprove"];
  assert.equal(commandFor(home, args, "darwin"), "pwsh -NoProfile -File '/Users/me/eng-agents/evals/Invoke-Evals.ps1' -Case 'feature-outcome' -Arm 'both' -Runs '3' -AutoApprove");
  assert.equal(commandFor({ ...home, script: "C:\\Users\\o'neil\\eng-agents\\evals\\Invoke-Evals.ps1" }, ["-Runs", "1"], "win32"), "& 'C:\\Users\\o''neil\\eng-agents\\evals\\Invoke-Evals.ps1' -Runs '1'");

  const calls = [];
  const fakeRun = (exe, argv, o) => { calls.push({ exe, argv, o }); const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit("spawn")); return c; };
  const mac = await openEvalsTerminal({ home, args, platform: "darwin", run: fakeRun });
  assert.equal(mac.ok, true);
  assert.equal(calls[0].exe, "osascript");
  assert.match(calls[0].argv[1], /tell application \\?"?Terminal/);
  assert.match(calls[0].argv[1], /cd '\/Users\/me\/eng-agents' && pwsh -NoProfile -File/);
  const win = await openEvalsTerminal({ home, args, platform: "win32", run: fakeRun });
  assert.equal(win.ok, true);
  // A new console window through cmd.exe's start (a detached powershell.exe got no window at all, 1.37.0).
  assert.match(calls[1].exe, /cmd\.exe$/i);
  assert.deepEqual(calls[1].argv.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(calls[1].argv[3], /^"start "Bench" powershell\.exe -NoLogo -NoExit -Command "& '.*Invoke-Evals\.ps1' -Case 'feature-outcome'.*""$/);
  assert.equal(calls[1].o.windowsVerbatimArguments, true);
  await assert.rejects(openEvalsTerminal({ home, args, platform: "linux", run: fakeRun, terminal: () => null }), (e) => e.status === 501);
  const lin = await openEvalsTerminal({ home, args, platform: "linux", run: fakeRun, terminal: () => ["/usr/bin/xterm", ["-e"]] });
  assert.equal(lin.ok, true);
  assert.equal(calls[2].exe, "/usr/bin/xterm");
  assert.deepEqual(calls[2].argv.slice(0, 3), ["-e", "sh", "-c"]);
  const boom = () => { throw new Error("blocked"); };
  await assert.rejects(openEvalsTerminal({ home, args, platform: "win32", run: boom }), (e) => e.status === 500);
});

test("version 3 files carry usage; a run without usage shows null, never 0", () => {
  const d = { version: 3, date: "2026-11-15T10:00:00", cases: [
    { case: "a", arm: "tandem", passes: 1, total: 2, rate: 50, usageKnown: true, meanTokens: 41000, meanCost: 0, tokensPerPass: 82000, costPerPass: 0, meanQuestions: 0.5, meanVerifyFails: 1, promptTokens: 17000 },
    { case: "a", arm: "baseline", passes: 0, total: 2, rate: 0, usageKnown: false, meanTokens: 0 },
  ] };
  const s = summarize(d, "v3.json");
  assert.equal(s.unsupported, undefined);
  assert.equal(s.cases[0].meanTokens, 41000);
  assert.equal(s.cases[0].tokensPerPass, 82000);
  assert.equal(s.cases[0].promptTokens, 17000);
  assert.equal(s.cases[1].meanTokens, null, "usage not known: null");
  assert.equal(summarize({ version: 5, cases: [] }, "v5.json").unsupported, true);
});

test("version 4: lift per case and model, kind, experiment id and files hash", () => {
  const d = { version: 4, models: ["p/one", "p/two"], model: "p/one", kind: "lift", overlay: "/x/eng-agents/evals/experiments/fix-spec-20261115-1-ab12/overlay", compareTo: "a.json", cases: [
    { case: "a", arm: "tandem", model: "p/one", rate: 100, passes: 1, total: 1, filesHash: "0123456789ab" },
    { case: "a", arm: "baseline", model: "p/one", rate: 0, passes: 0, total: 1, filesHash: null },
    { case: "a", arm: "tandem", model: "p/two", rate: 50, passes: 1, total: 2, filesHash: "nothex" },
    { case: "a", arm: "baseline", model: "p/two", rate: 50, passes: 1, total: 2 },
  ] };
  const s = summarize(d, "v4.json");
  assert.deepEqual(s.models, ["p/one", "p/two"]);
  assert.equal(s.kind, "lift");
  assert.equal(s.experiment, "fix-spec-20261115-1-ab12");
  assert.deepEqual(s.lift.map((l) => [l.model, l.lift]), [["p/one", 100], ["p/two", 0]]);
  assert.equal(s.cases[0].filesHash, "0123456789ab");
  assert.equal(s.cases[2].filesHash, null, "a bad hash is dropped");
});

test("runArgs presets: affected, release, lift, the model matrix, judge, budget and an experiment", () => {
  const known = [{ name: "feature-outcome", lift: true }, { name: "spec-basic", lift: false }];
  assert.deepEqual(runArgs({ preset: "affected", runs: 1 }, known), ["-Affected", "-Arm", "tandem", "-Runs", "1"]);
  assert.deepEqual(runArgs({ preset: "release", cases: ["spec-basic"], arm: "both" }, known), ["-Release", "-Runs", "3"]);
  assert.deepEqual(runArgs({ preset: "lift", runs: 5 }, known), ["-Case", "feature-outcome", "-Arm", "both", "-Runs", "5"]);
  assert.deepEqual(runArgs({ cases: ["spec-basic"], models: ["p/one", "p/two"], judge: "p/judge", maxRuns: 40 }, known),
    ["-Case", "spec-basic", "-Arm", "tandem", "-Runs", "3", "-Models", "p/one,p/two", "-Judge", "p/judge", "-MaxRuns", "40"]);
  const bad = (a) => assert.throws(() => runArgs(a, known), (e) => e.status === 400);
  bad({ preset: "nightly" });
  bad({ cases: ["spec-basic"], models: ["a/1", "a/2", "a/3", "a/4", "a/5"] });
  bad({ cases: ["spec-basic"], judge: "nope" });
  bad({ cases: ["spec-basic"], maxRuns: 0 });
  bad({ cases: ["spec-basic"], experiment: "../../etc" });
  const src = clone();
  try {
    const home = evalsHome(src);
    fs.mkdirSync(path.join(src, "evals", "experiments", "trim-spec-1-ab12", "overlay", "commands"), { recursive: true });
    const a = runArgs({ cases: ["spec-basic"], experiment: "trim-spec-1-ab12" }, listCases(home), home);
    assert.deepEqual(a.slice(-4), ["-Overlay", path.join(src, "evals", "experiments", "trim-spec-1-ab12", "overlay"), "-Label", "trim-spec-1-ab12"]);
    assert.throws(() => runArgs({ cases: ["spec-basic"], experiment: "trim-spec-2-ab12" }, listCases(home), home), (e) => e.status === 400);
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

test("commands.json, guard coverage and experiments are read from the clone; case commands and kinds", () => {
  const src = clone();
  try {
    const ev = path.join(src, "evals");
    fs.writeFileSync(path.join(ev, "commands.json"), JSON.stringify({ version: 1, commands: [{ command: "spec", agent: "planner", tokens: 4000, readTokens: 900, hash: "0123456789ab", files: ["core/commands/spec.md"] }, { command: "../x" }] }));
    fs.mkdirSync(path.join(ev, "guards"), { recursive: true });
    fs.writeFileSync(path.join(ev, "guards", "expected.json"), JSON.stringify({ all: [{}, {}], agents: { planner: [{}, {}] } }));
    fs.mkdirSync(path.join(src, "core", "agents"), { recursive: true });
    fs.writeFileSync(path.join(src, "core", "agents", "planner.md"), "x");
    fs.writeFileSync(path.join(src, "core", "agents", "chat.md"), "x");
    const exp = path.join(ev, "experiments", "trim-spec-20261115-1-ab12");
    fs.mkdirSync(exp, { recursive: true });
    fs.writeFileSync(path.join(exp, "experiment.json"), JSON.stringify({ id: "trim-spec-20261115-1-ab12", kind: "trim", command: "spec", file: "commands/spec.md", reason: "cut", created: "2026-11-15T10:00:00", status: "proposed", results: ["4.1.0-1.json", "../bad.json"] }));
    const home = evalsHome(src);
    assert.deepEqual(readCommands(home).map((c) => c.command), ["spec"]);
    assert.deepEqual(readGuards(home).agents, [{ agent: "chat", rows: 0 }, { agent: "planner", rows: 4 }]);
    const ex = listExperiments(home);
    assert.equal(ex[0].kind, "trim");
    assert.deepEqual(ex[0].results, ["4.1.0-1.json"]);
    const cases = listCases(home);
    assert.deepEqual(cases.find((c) => c.name === "feature-outcome").commands, ["spec"]);
    assert.equal(cases.find((c) => c.name === "feature-outcome").kind, "outcome");
    assert.equal(cases.find((c) => c.name === "spec-basic").kind, "behavior");
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

test("scriptArgs checks suggest, trim and keep requests", () => {
  const known = [{ name: "spec-basic" }];
  assert.deepEqual(scriptArgs("trim", { command: "tsd" }, known), { script: "Suggest-Trim.ps1", args: ["-Command", "tsd"] });
  assert.deepEqual(scriptArgs("keep", { id: "fix-spec-1-ab12", drop: true }, known), { script: "Keep-Experiment.ps1", args: ["-Id", "fix-spec-1-ab12", "-Drop"] });
  assert.deepEqual(scriptArgs("suggest", { file: "4.1.0-1.json", case: "spec-basic", model: "p/strong" }, known).args, ["-Results", "4.1.0-1.json", "-Case", "spec-basic", "-Model", "p/strong"]);
  const bad = (k, a) => assert.throws(() => scriptArgs(k, a, known), (e) => e.status === 400);
  bad("suggest", { file: "../x.json", case: "spec-basic", model: "p/m" });
  bad("suggest", { file: "a.json", case: "nope", model: "p/m" });
  bad("suggest", { file: "a.json", case: "spec-basic", model: "" });
  bad("trim", { command: "a b" });
  bad("keep", { id: "x;rm" });
  bad("rm", {});
  const home = { root: "/c/eng-agents/evals", script: "/c/eng-agents/evals/Invoke-Evals.ps1", source: "/c/eng-agents" };
  assert.equal(commandFor(home, ["-Command", "tsd"], "darwin", "Suggest-Trim.ps1"), `pwsh -NoProfile -File '${path.join(home.root, "Suggest-Trim.ps1")}' -Command 'tsd'`);
});

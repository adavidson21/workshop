// lib/evals.mjs: Bench's reads of Tandem's eval cases and results, and the run command (docs/bench.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { commandFor, evalsHome, liftOf, listCases, listResults, openEvalsTerminal, readResult, runArgs, summarize } from "../lib/evals.mjs";
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
    assert.deepEqual(latest.lift, [{ case: "feature-outcome", tandem: 67, baseline: 33, lift: 34, tandemAll: false, baselineAll: false }]);
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

test("Loom's Prompts (tandem.health evals) keeps the tandem arm only", () => {
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
  assert.equal(calls[1].exe, "powershell.exe");
  assert.deepEqual(calls[1].argv.slice(0, 3), ["-NoLogo", "-NoExit", "-Command"]);
  await assert.rejects(openEvalsTerminal({ home, args, platform: "linux", run: fakeRun }), (e) => e.status === 501);
  const boom = () => { throw new Error("blocked"); };
  await assert.rejects(openEvalsTerminal({ home, args, platform: "win32", run: boom }), (e) => e.status === 500);
});

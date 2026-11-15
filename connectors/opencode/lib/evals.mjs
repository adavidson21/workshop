// Bench's side of the opencode connector: Tandem's eval cases and results, read from the eng-agents clone that
// Tandem was installed from (its install record), and a way to start a run in a terminal you can see.
// Contract: docs/bench.md. The results format is eng-agents' evals/README.md (versions 1 to 3).
//
// Nothing here runs a model or git itself. evals.run opens a terminal window running eng-agents'
// evals/Invoke-Evals.ps1 with arguments checked against strict patterns (case names must be existing case files),
// exactly as if you had typed it, the same way Settings' Update button works.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const RESULTS_VERSIONS = [1, 2, 3];
export const ARMS = ["tandem", "baseline", "both"];
export const CASE_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
export const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/;
export const MODEL_RE = /^[A-Za-z0-9._-]{1,60}\/[A-Za-z0-9._:/-]{1,120}$/;
export const MAX_RUNS = 10;
export const MAX_FILES = 200;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v, max = 400) => (typeof v === "string" ? v.slice(0, max) : null);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** Where the evals live in an eng-agents clone, or null when the clone has none. */
export function evalsHome(source) {
  if (!source) return null;
  const root = path.join(source, "evals");
  const script = path.join(root, "Invoke-Evals.ps1");
  if (!fs.existsSync(script)) return null;
  return { source, root, script, cases: path.join(root, "cases"), results: path.join(root, "results") };
}

/** Every case: name, what it checks, whether it can show a lift (has a baseline prompt), its steps and needs. */
export function listCases(home) {
  if (!home) return [];
  let names;
  try {
    names = fs.readdirSync(home.cases).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((n) => {
      const name = n.slice(0, -5);
      if (!CASE_RE.test(name)) return null;
      const c = readJson(path.join(home.cases, n)) || {};
      const steps = Array.isArray(c.steps) ? c.steps.length : 1;
      return {
        name,
        description: text(c.description, 600) || "",
        command: Array.isArray(c.steps) ? null : text(c.command, 60),
        steps,
        lift: !!(c.baseline && typeof c.baseline.prompt === "string" && c.baseline.prompt.trim()),
        needs: Array.isArray(c.needs) ? c.needs.filter((x) => typeof x === "string").slice(0, 5) : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** One case entry of a results file, summed up. Version 1 files have no arm: they are the tandem arm. */
function caseSummary(c) {
  const runs = Array.isArray(c.runs) ? c.runs : [];
  const passes = num(c.passes);
  const total = num(c.total);
  const passAll = typeof c.passAll === "boolean" ? c.passAll : total ? passes === total : null;
  let meanSeconds = num(c.meanSeconds);
  if (meanSeconds == null && runs.length) {
    const s = runs.map((r) => num(r.seconds)).filter((x) => x != null);
    meanSeconds = s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
  }
  return {
    case: text(c.case, 80),
    arm: c.arm === "baseline" ? "baseline" : "tandem",
    passes,
    total,
    rate: num(c.rate),
    passAll: c.skipped ? null : passAll,
    meanSeconds,
    skipped: text(c.skipped, 200),
    // version 3: usage (null when the file has none, or opencode reported none)
    usageKnown: c.usageKnown === true,
    meanTokens: c.usageKnown === true ? num(c.meanTokens) : null,
    meanCost: c.usageKnown === true ? num(c.meanCost) : null,
    tokensPerPass: c.usageKnown === true ? num(c.tokensPerPass) : null,
    costPerPass: c.usageKnown === true ? num(c.costPerPass) : null,
    meanQuestions: num(c.meanQuestions),
    meanVerifyFails: num(c.meanVerifyFails),
    promptTokens: num(c.promptTokens),
  };
}

/** Lift per case that ran in both arms: Tandem's rate minus the baseline's, in points. */
export function liftOf(cases) {
  const by = new Map();
  for (const c of cases) {
    if (c.skipped || c.rate == null || !c.case) continue;
    if (!by.has(c.case)) by.set(c.case, {});
    by.get(c.case)[c.arm] = c;
  }
  const out = [];
  for (const [name, v] of by) {
    if (!v.tandem || !v.baseline) continue;
    out.push({ case: name, tandem: v.tandem.rate, baseline: v.baseline.rate, lift: v.tandem.rate - v.baseline.rate, tandemAll: v.tandem.passAll, baselineAll: v.baseline.passAll });
  }
  return out.sort((a, b) => (a.case < b.case ? -1 : 1));
}

/** A results file, summed up (no runs). Null when it is not a results file this Workshop reads. */
export function summarize(d, file) {
  if (!d || typeof d !== "object" || !Array.isArray(d.cases)) return null;
  const version = num(d.version) || 1;
  if (!RESULTS_VERSIONS.includes(version)) return { file, version, unsupported: true };
  const cases = d.cases.map(caseSummary).filter((c) => c.case);
  const arms = [...new Set(cases.map((c) => c.arm))];
  return {
    file,
    version,
    date: text(d.date, 40),
    tandem: text(d.tandem, 40),
    model: text(d.model, 200),
    runsPerCase: num(d.runsPerCase),
    autoApprove: d.autoApprove === true,
    arms,
    cases,
    lift: liftOf(cases),
  };
}

/** Every results file, newest first (by the date inside, then the file name). At most MAX_FILES. */
export function listResults(home) {
  if (!home) return [];
  let names;
  try {
    names = fs.readdirSync(home.results).filter((n) => FILE_RE.test(n));
  } catch {
    return [];
  }
  return names
    .map((n) => summarize(readJson(path.join(home.results, n)), n))
    .filter(Boolean)
    .sort((a, b) => ((b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : a.file < b.file ? 1 : -1))
    .slice(0, MAX_FILES);
}

/** One results file with every run: pass, seconds, failed checks, steps and the log path. */
export function readResult(home, file) {
  if (!home) return null;
  if (!FILE_RE.test(file || "")) {
    const e = new Error("Bad results file name.");
    e.status = 400;
    throw e;
  }
  const d = readJson(path.join(home.results, file));
  const s = summarize(d, file);
  if (!s) {
    const e = new Error("No such results file.");
    e.status = 404;
    throw e;
  }
  if (s.unsupported) return s;
  s.cases = d.cases.map((c) => ({
    ...caseSummary(c),
    runs: (Array.isArray(c.runs) ? c.runs : []).slice(0, 50).map((r) => ({
      run: num(r.run),
      pass: r.pass === true,
      seconds: num(r.seconds),
      timedOut: r.timedOut === true,
      tokens: r.usageKnown === true ? num(r.tokens) : null,
      cost: r.usageKnown === true ? num(r.cost) : null,
      questions: num(r.questions),
      verifyFails: num(r.verifyFails),
      failed: (Array.isArray(r.failed) ? r.failed : []).slice(0, 40).map((f) => ({ check: text(f.check, 200) || "", detail: text(f.detail, 600) || "" })),
      steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 40).map((st) => ({ step: text(st.step, 200) || "", ok: st.ok === true, seconds: num(st.seconds), timedOut: st.timedOut === true, tokens: r.usageKnown === true ? num(st.tokens) : null })),
      log: text(r.log, 500),
    })),
  })).filter((c) => c.case);
  return s;
}

/**
 * Checks a run request and returns Invoke-Evals.ps1's arguments (an array, each part its own item).
 * cases: names that must be existing case files. arm: tandem, baseline or both. runs: 1 to 10.
 * model: provider/model or empty for opencode's default. autoApprove: passes -AutoApprove.
 */
export function runArgs({ cases, arm = "tandem", runs = 3, model = "", autoApprove = false } = {}, known = []) {
  const bad = (m) => {
    const e = new Error(m);
    e.status = 400;
    return e;
  };
  const list = Array.isArray(cases) ? cases : [];
  if (!list.length) throw bad("Pick at least one case.");
  const names = new Set(known.map((c) => c.name));
  for (const c of list) {
    if (typeof c !== "string" || !CASE_RE.test(c) || !names.has(c)) throw bad(`Unknown case: ${String(c).slice(0, 60)}`);
  }
  if (!ARMS.includes(arm)) throw bad("Arm must be tandem, baseline or both.");
  if (arm !== "tandem") {
    const lift = new Set(known.filter((c) => c.lift).map((c) => c.name));
    if (!list.some((c) => lift.has(c))) throw bad("None of these cases has a baseline prompt, so there is no baseline arm to run.");
  }
  const n = Number(runs);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RUNS) throw bad(`Runs must be 1 to ${MAX_RUNS}.`);
  if (model && (typeof model !== "string" || !MODEL_RE.test(model))) throw bad("Model must look like provider/model.");
  const out = ["-Case", [...new Set(list)].join(","), "-Arm", arm, "-Runs", String(n)];
  if (model) out.push("-Model", model);
  if (autoApprove) out.push("-AutoApprove");
  return out;
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** The command a person would type, for each kind of shell. Windows PowerShell 5.1 runs the script as is. */
export function commandFor(home, args, platform = process.platform) {
  if (platform === "win32") return ["&", psq(home.script), ...args.map((a) => (a.startsWith("-") ? a : psq(a)))].join(" ");
  return ["pwsh", "-NoProfile", "-File", shq(home.script), ...args.map((a) => (a.startsWith("-") ? a : shq(a)))].join(" ");
}

/** Opens a terminal window you can see, in the eng-agents folder, running the evals. Windows and macOS. */
export function openEvalsTerminal({ home, args, platform = process.platform, run = spawn }) {
  const cmd = commandFor(home, args, platform);
  let exe, argv;
  if (platform === "win32") {
    exe = "powershell.exe";
    argv = ["-NoLogo", "-NoExit", "-Command", cmd];
  } else if (platform === "darwin") {
    const sh = `cd ${shq(home.source)} && ${cmd}`;
    exe = "osascript";
    argv = ["-e", `tell application "Terminal" to do script "${sh.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\ntell application "Terminal" to activate`];
  } else {
    const e = new Error("Opening a terminal works on Windows and macOS. Copy the command instead.");
    e.status = 501;
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    const failed = (err) => {
      const e = new Error(`Could not open a terminal (${err.message}). Copy the command instead.`);
      e.status = 500;
      reject(e);
    };
    let child;
    try {
      child = run(exe, argv, { cwd: home.source, detached: true, stdio: "ignore", windowsHide: false });
    } catch (err) {
      failed(err);
      return;
    }
    child.once("error", failed);
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, command: cmd });
    });
  });
}

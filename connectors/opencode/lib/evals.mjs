// Bench's side of the opencode connector: Tandem's eval cases and results, read from the eng-agents clone that
// Tandem was installed from (its install record), and a way to start a run in a terminal you can see.
// Contract: docs/bench.md. The results format is eng-agents' evals/README.md (versions 1 to 4).
//
// Nothing here runs a model or git itself. evals.run opens a terminal window running eng-agents'
// evals/Invoke-Evals.ps1 with arguments checked against strict patterns (case names must be existing case files),
// exactly as if you had typed it, the same way Settings' Update button works.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { openConsole } from "./console-window.mjs";

export const RESULTS_VERSIONS = [1, 2, 3, 4];
export const PRESETS = ["custom", "affected", "release", "lift"];
export const EXPERIMENT_RE = /^[a-z]+-[a-z0-9-]{1,100}$/;
export const MAX_MODELS = 4;
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

/** Every case: name, what it checks, whether it can show a lift (has a baseline prompt), its steps, needs and answers. */
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
      const commands = Array.isArray(c.steps)
        ? [...new Set(c.steps.map((st) => st && st.command).filter((x) => typeof x === "string" && CASE_RE.test(x)))]
        : typeof c.command === "string" && CASE_RE.test(c.command) ? [c.command] : [];
      return {
        name,
        description: text(c.description, 600) || "",
        command: Array.isArray(c.steps) ? null : text(c.command, 60),
        commands,
        kind: c.baseline ? "outcome" : c.expect && c.expect.judge ? "writing" : "behavior",
        judged: !!(c.expect && c.expect.judge),
        steps,
        lift: !!(c.baseline && typeof c.baseline.prompt === "string" && c.baseline.prompt.trim()),
        needs: Array.isArray(c.needs) ? c.needs.filter((x) => typeof x === "string").slice(0, 5) : [],
        // eng-agents Core 4.16.0: scripted answers for a command that stops to ask (the case's, or its steps').
        answers: (Array.isArray(c.answers) ? c.answers.length : 0) + (Array.isArray(c.steps) ? c.steps.reduce((n, st) => n + (st && Array.isArray(st.answers) ? st.answers.length : 0), 0) : 0),
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
    model: text(c.model, 200),
    filesHash: typeof c.filesHash === "string" && /^[0-9a-f]{12}$/.test(c.filesHash) ? c.filesHash : null,
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
    const key = `${c.case}\u0000${c.model || ""}`;
    if (!by.has(key)) by.set(key, { case: c.case, model: c.model || null });
    by.get(key)[c.arm] = c;
  }
  const out = [];
  for (const v of by.values()) {
    if (!v.tandem || !v.baseline) continue;
    out.push({ case: v.case, model: v.model, tandem: v.tandem.rate, baseline: v.baseline.rate, lift: v.tandem.rate - v.baseline.rate, tandemAll: v.tandem.passAll, baselineAll: v.baseline.passAll });
  }
  return out.sort((a, b) => (a.case === b.case ? ((a.model || "") < (b.model || "") ? -1 : 1) : a.case < b.case ? -1 : 1));
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
    models: Array.isArray(d.models) ? d.models.map((m) => text(m, 200)).filter(Boolean) : d.model ? [text(d.model, 200)] : [],
    kind: ["custom", "affected", "release", "lift", "experiment"].includes(d.kind) ? d.kind : null,
    label: text(d.label, 120),
    experiment: typeof d.overlay === "string" ? (/experiments[\\/]([a-z]+-[a-z0-9-]+)[\\/]overlay/.exec(d.overlay) || [])[1] || "other" : null,
    judge: text(d.judge, 200),
    compareTo: text(d.compareTo, 120),
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
      answered: num(r.answered),
      failed: (Array.isArray(r.failed) ? r.failed : []).slice(0, 40).map((f) => ({ check: text(f.check, 200) || "", detail: text(f.detail, 600) || "" })),
      steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 40).map((st) => ({ step: text(st.step, 200) || "", ok: st.ok === true, seconds: num(st.seconds), timedOut: st.timedOut === true, tokens: r.usageKnown === true ? num(st.tokens) : null, ...(st.answered != null ? { answered: num(st.answered), stillAsking: st.stillAsking === true } : {}) })),
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
export function runArgs({ cases, arm = "tandem", runs = 3, model = "", models, autoApprove = false, preset = "custom", maxRuns, judge = "", experiment = "" } = {}, known = [], home = null) {
  const bad = (m) => {
    const e = new Error(m);
    e.status = 400;
    return e;
  };
  if (!PRESETS.includes(preset)) throw bad("Preset must be custom, affected, release or lift.");
  const list = Array.isArray(cases) ? [...new Set(cases)] : [];
  const names = new Set(known.map((c) => c.name));
  for (const c of list) {
    if (typeof c !== "string" || !CASE_RE.test(c) || !names.has(c)) throw bad(`Unknown case: ${String(c).slice(0, 60)}`);
  }
  if (preset === "custom" && !list.length) throw bad("Pick at least one case.");
  if (preset === "lift" && !list.length) list.push(...known.filter((c) => c.lift).map((c) => c.name));
  if (preset === "lift") arm = "both";
  if (preset === "release") arm = "tandem";
  if (!ARMS.includes(arm)) throw bad("Arm must be tandem, baseline or both.");
  if (arm !== "tandem" && list.length) {
    const lift = new Set(known.filter((c) => c.lift).map((c) => c.name));
    if (!list.some((c) => lift.has(c))) throw bad("None of these cases has a baseline prompt, so there is no baseline arm to run.");
  }
  const n = Number(runs);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RUNS) throw bad(`Runs must be 1 to ${MAX_RUNS}.`);
  const modelList = (Array.isArray(models) && models.length ? models : model ? [model] : []).map((m) => String(m).trim()).filter(Boolean);
  if (modelList.length > MAX_MODELS) throw bad(`At most ${MAX_MODELS} models at once.`);
  for (const m of modelList) if (!MODEL_RE.test(m)) throw bad("Model must look like provider/model.");
  if (judge && !MODEL_RE.test(judge)) throw bad("Judge model must look like provider/model.");
  const out = [];
  if (preset === "release") out.push("-Release");
  else if (list.length) out.push("-Case", list.join(","));
  if (preset === "affected") out.push("-Affected");
  if (preset !== "release") out.push("-Arm", arm);
  out.push("-Runs", String(n));
  if (modelList.length === 1) out.push("-Model", modelList[0]);
  else if (modelList.length > 1) out.push("-Models", modelList.join(","));
  if (autoApprove) out.push("-AutoApprove");
  if (judge) out.push("-Judge", judge);
  if (maxRuns != null && maxRuns !== "") {
    const mr = Number(maxRuns);
    if (!Number.isInteger(mr) || mr < 1 || mr > 500) throw bad("Max runs must be 1 to 500.");
    out.push("-MaxRuns", String(mr));
  }
  if (experiment) {
    if (!EXPERIMENT_RE.test(experiment)) throw bad("Bad experiment id.");
    const overlay = home ? path.join(home.root, "experiments", experiment, "overlay") : null;
    if (home && !fs.existsSync(overlay)) throw bad("No such experiment.");
    out.push("-Overlay", overlay || `evals/experiments/${experiment}/overlay`, "-Label", experiment);
  }
  return out;
}

/** evals/commands.json from the clone: each command's agent, prompt sizes, files and hash. Empty when missing. */
export function readCommands(home) {
  if (!home) return [];
  const d = readJson(path.join(home.root, "commands.json"));
  if (!d || !Array.isArray(d.commands)) return [];
  return d.commands
    .filter((c) => c && typeof c.command === "string" && CASE_RE.test(c.command))
    .map((c) => ({ command: c.command, agent: text(c.agent, 60), tokens: num(c.tokens), readTokens: num(c.readTokens), hash: typeof c.hash === "string" ? c.hash.slice(0, 12) : null, files: (Array.isArray(c.files) ? c.files : []).slice(0, 40).map((f) => text(f, 200)).filter(Boolean) }));
}

/** Guard coverage from evals/guards/expected.json (checked in CI by Test-AgentGuards.ps1): rows per agent. */
export function readGuards(home) {
  if (!home) return null;
  const d = readJson(path.join(home.root, "guards", "expected.json"));
  if (!d || !d.agents || typeof d.agents !== "object") return null;
  let agents = [];
  try {
    agents = fs.readdirSync(path.join(home.source, "core", "agents")).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
  } catch { /* no agents folder */ }
  const all = Array.isArray(d.all) ? d.all.length : 0;
  return {
    agents: agents.sort().map((a) => ({ agent: a, rows: Array.isArray(d.agents[a]) ? d.agents[a].length + all : 0 })),
  };
}

/** Experiments in evals/experiments/<id>/experiment.json, newest first. */
export function listExperiments(home) {
  if (!home) return [];
  const root = path.join(home.root, "experiments");
  let ids;
  try {
    ids = fs.readdirSync(root).filter((n) => EXPERIMENT_RE.test(n));
  } catch {
    return [];
  }
  return ids
    .map((id) => {
      const m = readJson(path.join(root, id, "experiment.json"));
      if (!m) return null;
      return {
        id,
        kind: m.kind === "trim" ? "trim" : "fix",
        command: text(m.command, 60),
        file: text(m.file, 200),
        reason: text(m.reason, 600) || "",
        case: text(m.case, 80),
        created: text(m.created, 40),
        status: ["proposed", "kept", "dropped"].includes(m.status) ? m.status : "proposed",
        results: (Array.isArray(m.results) ? m.results : []).filter((f) => FILE_RE.test(f || "")).slice(0, 20),
      };
    })
    .filter(Boolean)
    .sort((a, b) => ((b.created || "") < (a.created || "") ? -1 : 1))
    .slice(0, 100);
}

/** Checks a request for one of the improve-loop scripts and returns {script, args}. */
export function scriptArgs(kind, args = {}, known = [], home = null) {
  const bad = (m) => {
    const e = new Error(m);
    e.status = 400;
    return e;
  };
  if (kind === "suggest") {
    if (!FILE_RE.test(args.file || "")) throw bad("Bad results file name.");
    if (!known.some((c) => c.name === args.case)) throw bad("Unknown case.");
    if (!MODEL_RE.test(args.model || "")) throw bad("Pick a suggestion model (provider/model) in Bench's settings.");
    return { script: "Suggest-Fix.ps1", args: ["-Results", home ? path.join(home.results, args.file) : args.file, "-Case", args.case, "-Model", args.model] };
  }
  if (kind === "trim") {
    if (!CASE_RE.test(args.command || "")) throw bad("Bad command name.");
    return { script: "Suggest-Trim.ps1", args: ["-Command", args.command] };
  }
  if (kind === "keep") {
    if (!EXPERIMENT_RE.test(args.id || "")) throw bad("Bad experiment id.");
    return { script: "Keep-Experiment.ps1", args: ["-Id", args.id, ...(args.drop ? ["-Drop"] : [])] };
  }
  throw bad("Unknown script.");
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** The command a person would type, for each kind of shell. Windows PowerShell 5.1 runs the script as is. */
export function commandFor(home, args, platform = process.platform, script = null) {
  const file = script ? path.join(home.root, script) : home.script;
  if (platform === "win32") return ["&", psq(file), ...args.map((a) => (a.startsWith("-") ? a : psq(a)))].join(" ");
  return ["pwsh", "-NoProfile", "-File", shq(file), ...args.map((a) => (a.startsWith("-") ? a : shq(a)))].join(" ");
}

/** Opens a terminal window you can see, in the eng-agents folder, running the evals (lib/console-window.mjs). */
export async function openEvalsTerminal({ home, args, platform = process.platform, run = spawn, script = null, terminal }) {
  const cmd = commandFor(home, args, platform, script);
  const r = await openConsole({ cwd: home.source, ps: cmd, sh: cmd, title: "Bench", platform, run, ...(terminal ? { terminal } : {}) });
  return { ...r, command: cmd };
}

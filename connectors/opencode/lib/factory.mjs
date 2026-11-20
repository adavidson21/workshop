// opencode connector: the software factory's settings (1.21.0, eng-agents Core 4.9.0).
// Settings, Factory edits `factory` in this connector's config. The connector keeps the clean values in
// opt.factory and writes them to <workspace>/.work/factory.json, which Tandem's commands read (eng-agents
// pipeline guide, Factory settings). The file is Workshop's: agents never write it.

import fs from "node:fs";
import path from "node:path";

export const FACTORY_DEFAULTS = Object.freeze({
  taskFileCap: 6,
  quickTasks: 3,
  retries: 3,
  autoFix: "should-fix",
  reviewRounds: 2,
  uiChecks: true,
  regression: true,
  uiCheckPerTask: true, // 1.28.0 (eng-agents Core 4.15.0): each task that changes UI files checks its own pages
  modelSeesImages: false, // 1.28.0: the per-task check also hands the screenshot to the model
  worktrees: "always",
});

const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/** Clean factory settings from the connector config's `factory` object. Unknown or bad values fall back to defaults. */
export function factoryOptions(cfg) {
  const f = cfg && typeof cfg === "object" ? cfg : {};
  const d = FACTORY_DEFAULTS;
  return {
    taskFileCap: int(f.taskFileCap, 2, 12, d.taskFileCap),
    quickTasks: int(f.quickTasks, 1, 5, d.quickTasks),
    retries: int(f.retries, 1, 5, d.retries),
    autoFix: f.autoFix === "blockers" ? "blockers" : d.autoFix,
    reviewRounds: int(f.reviewRounds, 1, 4, d.reviewRounds),
    uiChecks: f.uiChecks !== false,
    regression: f.regression !== false,
    uiCheckPerTask: f.uiCheckPerTask !== false,
    modelSeesImages: f.modelSeesImages === true,
    worktrees: f.worktrees === "busy" ? "busy" : d.worktrees,
  };
}

/** Writes .work/factory.json when it would change. Returns true when it wrote. Never throws. */
export function writeFactoryFile(workRoot, factory) {
  if (!workRoot) return false;
  const file = path.join(workRoot, "factory.json");
  const text = JSON.stringify({ version: 1, note: "Written by Workshop (Settings, Factory). Tandem reads it; do not edit.", ...factory }, null, 2) + "\n";
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

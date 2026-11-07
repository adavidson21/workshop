// opencode connector: the work model. Runs New-Dashboard.ps1 -AsJson and watches .work.
//
// Copied from eng-agents core/scripts/dashboard/server/model.mjs (gone from eng-agents since Core 2.11.0; this is the only copy). Changes: the parser is the copy in
// connectors/opencode/parser/; the watcher and poll stop with the connector; the static page snapshot
// (.work/dashboard.html) is not written, because its template is the eng-agents page (see README.md).

import { spawn } from "node:child_process";
import fs from "node:fs";
import { cancel, current, every, later, log, opt, psExe, running, scriptPath, workRoot } from "./context.mjs";
import { linkSessionsFromModel } from "./links.mjs";
import { emitModel } from "./live.mjs";

export let model = null;
export let modelError = null;
// The only way other modules change the model (ES module bindings are read-only outside this file).
export function setModel(data) {
  model = data;
  modelError = null;
}
let refreshing = false;
let refreshAgain = false;
let watcher = null;
let poller = null;
let debounce = null;
// The parser process running now, if any. Its working folder is the workspace, so on Windows the folder
// cannot be removed until it exits: stop ends it and waits (parserGone).
let child = null;
let childExit = Promise.resolve();

export function resetModel() {
  if (child) {
    try { child.kill(); } catch {}
  }
  model = null;
  modelError = null;
  refreshing = false;
  refreshAgain = false;
  for (const w of waiters) w();
  waiters = [];
  if (watcher) {
    try { watcher.close(); } catch {}
  }
  watcher = null;
  cancel(poller);
  cancel(debounce);
  poller = debounce = null;
}

export function runModel() {
  return new Promise((resolve) => {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-WorkRoot", workRoot, "-AsJson"];
    if (opt.config) args.push("-ConfigPath", opt.config);
    let p;
    try {
      p = spawn(psExe, args, { cwd: opt.workspace, windowsHide: true });
    } catch (e) {
      return resolve({ error: e.message });
    }
    child = p;
    childExit = new Promise((gone) => {
      p.on("close", gone);
      p.on("error", gone);
    }).then(() => {
      if (child === p) child = null;
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ error: e.message }));
    p.on("close", (code) => {
      if (code !== 0) return resolve({ error: (err || out || `exit ${code}`).trim().split(/\r?\n/).slice(-3).join(" ") });
      try {
        resolve({ data: JSON.parse(out) });
      } catch (e) {
        resolve({ error: "Could not read New-Dashboard.ps1 output: " + e.message });
      }
    });
  });
}

// Callers waiting for a read that starts after their change (for example start.local reading back the
// folder it just made). A call during a read used to return at once, before the new folder was seen.
let waiters = [];

/** Resolves once no parser process is running (after resetModel ends it). */
export function parserGone() {
  return childExit;
}

export async function refresh() {
  if (!running) return;
  if (refreshing) {
    refreshAgain = true;
    return new Promise((resolve) => waiters.push(resolve));
  }
  refreshing = true;
  const done = waiters;
  waiters = [];
  const apply = current((r) => {
    if (r.error) {
      modelError = r.error;
      log("refresh failed:", r.error);
    } else {
      setModel(r.data);
      linkSessionsFromModel();
    }
    emitModel();
  });
  try {
    apply(await runModel());
  } finally {
    refreshing = false;
    for (const w of done) w();
    if (refreshAgain && running) {
      refreshAgain = false;
      refresh();
    } else {
      for (const w of waiters) w();
      waiters = [];
    }
  }
}

export function scheduleRefresh(ms = 400) {
  cancel(debounce);
  debounce = later(refresh, ms);
}

export function watchWork() {
  const ignore = (f) => !f || /^_dashboard([\\/]|$)/.test(f) || /dashboard\.html(\.tmp)?$/i.test(f);
  try {
    watcher = fs.watch(workRoot, { recursive: true }, current((_e, f) => {
      if (!ignore(String(f || ""))) scheduleRefresh();
    }));
    watcher.on("error", () => {});
  } catch (e) {
    log("File watching is not available here; polling only.", e.message);
  }
  poller = every(() => scheduleRefresh(0), opt.poll * 1000);
}

// opencode connector: the work model. Reads .work with lib/workparser.mjs (in process, no PowerShell) and watches it.
//
// Copied from eng-agents core/scripts/dashboard/server/model.mjs (gone from eng-agents since Core 2.11.0; this is the only copy). Changes: the parser is
// lib/workparser.mjs (connector 1.6.0; it ran parser/New-Dashboard.ps1 before); the watcher and poll stop with the connector; the static page snapshot
// (.work/dashboard.html) is not written, because its template is the eng-agents page (see README.md).

import fs from "node:fs";
import { cancel, current, every, later, log, opt, running, workRoot } from "./context.mjs";
import { readWork } from "./workparser.mjs";
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
// The read in progress, if any: stop waits for it (parserGone) so nothing reads the folder after the connector stops.
let childExit = Promise.resolve();

export function resetModel() {
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
  const p = readWork({ workRoot, configPath: opt.config || undefined, hide: opt.hide }).then((data) => ({ data }), (e) => ({ error: e && e.message ? e.message : String(e) }));
  childExit = p.then(() => {});
  return p;
}

// Callers waiting for a read that starts after their change (for example start.local reading back the
// folder it just made). A call during a read used to return at once, before the new folder was seen.
let waiters = [];

/** Resolves once no read of .work is in progress. */
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

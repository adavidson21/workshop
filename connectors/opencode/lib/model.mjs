// eng-agents live dashboard: The work model: runs New-Dashboard.ps1 -AsJson, watches .work, and keeps .work/dashboard.html current.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log, opt, psExe, scriptPath, templatePath, workRoot } from "./context.mjs";
import { linkSessionsFromModel } from "./links.mjs";
import { broadcast, pageData } from "./live.mjs";

export let model = null;
export let modelError = null;
// The only way other modules change the model (ES module bindings are read-only outside this file).
export function setModel(data) {
  model = data;
  modelError = null;
}
let refreshing = false;
let refreshAgain = false;

export function runModel() {
  return new Promise((resolve) => {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-WorkRoot", workRoot, "-AsJson"];
    if (opt.config) args.push("-ConfigPath", opt.config);
    const p = spawn(psExe, args, { cwd: opt.workspace, windowsHide: true });
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

export async function refresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    const r = await runModel();
    if (r.error) {
      modelError = r.error;
      log("refresh failed:", r.error);
    } else {
      setModel(r.data);
      linkSessionsFromModel();
      writeSnapshot();
    }
    broadcast("model", pageData());
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      setTimeout(refresh, 50);
    }
  }
}

// Keeps .work/dashboard.html (the static page) current while this runs, so after a reboot that file
// shows where everything stood, with a link back here. Written only when something changed.
let lastSnapshot = null;
function writeSnapshot() {
  try {
    const { generated, generatedMs, ...rest } = model;
    const key = JSON.stringify(rest);
    if (key === lastSnapshot) return;
    const data = { ...model, liveUrl: `http://127.0.0.1:${opt.port}/` };
    const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    const html = fs.readFileSync(templatePath, "utf8").replace("__ENG_DATA__", () => json);
    const out = path.join(workRoot, "dashboard.html");
    fs.writeFileSync(out + ".tmp", html);
    fs.renameSync(out + ".tmp", out);
    lastSnapshot = key;
  } catch (e) {
    log("could not write .work/dashboard.html:", e.message);
  }
}

let debounce = null;
export function scheduleRefresh(ms = 400) {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, ms);
}

export function watchWork() {
  const ignore = (f) => !f || /^_dashboard([\\/]|$)/.test(f) || /dashboard\.html(\.tmp)?$/i.test(f);
  try {
    fs.watch(workRoot, { recursive: true }, (_e, f) => {
      if (!ignore(String(f || ""))) scheduleRefresh();
    });
  } catch (e) {
    log("File watching is not available here; polling only.", e.message);
  }
  setInterval(() => scheduleRefresh(0), opt.poll * 1000);
}

// eng-agents live dashboard: Finding and connecting to opencode, loading its state, and following its event stream.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { V1_DEFAULT_URL, isWin, log, opt, sleep, stateDir } from "./context.mjs";
import { currentSession, links, saveLinks } from "./links.mjs";
import { httpJson, oc, ocCli } from "./opencode-state.mjs";
import { makeV2 } from "./opencode-v2.mjs";
import { makeV1 } from "./opencode-v1.mjs";
import { broadcastLive } from "./live.mjs";

// 2.x: the background service. `opencode service start` starts it if needed and prints its URL.
async function v2Password() {
  if (process.env.OPENCODE_SERVER_PASSWORD) return process.env.OPENCODE_SERVER_PASSWORD;
  const files = [];
  const paths = await ocCli(["debug", "paths"]);
  const cfg = (paths.out.match(/^config\s+(.+)$/m) || [])[1];
  if (cfg) files.push(path.join(cfg.trim(), "service.json"));
  files.push(path.join(os.homedir(), ".config", "opencode", "service.json"));
  if (process.env.XDG_CONFIG_HOME) files.push(path.join(process.env.XDG_CONFIG_HOME, "opencode", "service.json"));
  for (const f of files) {
    try {
      const pw = JSON.parse(fs.readFileSync(f, "utf8")).password;
      if (pw) return pw;
    } catch {}
  }
  return null;
}

async function v2Service(start) {
  const r = await ocCli(["service", start ? "start" : "status"], 60000);
  const url = (r.out.match(/https?:\/\/\S+/) || [])[0];
  return url ? { url: url.replace(/\/+$/, "") } : { error: (r.err || r.out || "no output").split(/\r?\n/).slice(-2).join(" ") };
}

// Picks the adapter: an explicit --opencode URL is probed; otherwise the installed CLI decides.
async function pickAdapter() {
  if (opt.opencode) {
    const probe = await httpJson(opt.opencode + "/api/info", { timeout: 2500 }).catch(() => null);
    const isV2 = probe && (probe.ok || probe.status === 401) && /json/.test(probe.type);
    return isV2 ? makeV2(opt.opencode, await v2Password()) : makeV1(opt.opencode);
  }
  const ver = await ocCli(["--version"], 15000);
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(ver.out);
  if (!m) {
    oc.error = `Could not run "${opt.opencodeCmd} --version" (${ver.err || "no output"}). Is opencode on PATH?`;
    return makeV1(V1_DEFAULT_URL);
  }
  if (+m[1] >= 2) {
    const s = await v2Service(opt.startOpencode);
    if (s.error) {
      oc.error = `opencode ${m[0]}: ${opt.startOpencode ? "could not start" : "no"} background service (${s.error}). Start it with: opencode service start`;
      return null;
    }
    return makeV2(s.url, await v2Password());
  }
  return makeV1(V1_DEFAULT_URL);
}

// 1.x only: start `opencode serve` when nothing answers on the URL.
function startV1Serve(url) {
  const u = new URL(url);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) {
    oc.error = `No opencode server at ${url}, and it is not local, so it was not started.`;
    return;
  }
  const port = u.port || "4096";
  const logFile = path.join(stateDir, "opencode.log");
  const out = fs.openSync(logFile, "a");
  log(`Starting: ${opt.opencodeCmd} serve --port ${port} (log: ${logFile})`);
  const serveArgs = ["serve", "--port", port, "--hostname", "127.0.0.1"];
  const spawnOpts = { cwd: opt.workspace, stdio: ["ignore", out, out], windowsHide: true };
  // On Windows opencode is usually a .cmd shim, which needs a shell. The arguments are fixed, so one string is safe.
  const child = isWin ? spawn(`"${opt.opencodeCmd}" ${serveArgs.join(" ")}`, { ...spawnOpts, shell: true }) : spawn(opt.opencodeCmd, serveArgs, spawnOpts);
  child.on("error", (e) => {
    oc.error = `Could not start opencode (${e.message}). Start it yourself: opencode serve --port ${port}`;
    log(oc.error);
  });
  child.on("exit", (code) => {
    if (oc.started) log(`opencode serve exited (${code}). See ${logFile}`);
    oc.started = false;
  });
  oc.started = true;
  const stop = () => {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill();
    } catch {}
  };
  process.on("exit", stop);
}

export async function connectOpencode() {
  if (!oc.api) {
    oc.api = await pickAdapter();
    if (!oc.api) {
      oc.connected = false;
      broadcastLive();
      setTimeout(connectOpencode, 10000);
      return;
    }
    oc.kind = oc.api.kind;
    oc.url = oc.api.url;
  }
  let info = await oc.api.info().catch(() => null);
  if (!info && oc.kind === "v1" && opt.startOpencode && !oc.started && !opt.opencode) {
    startV1Serve(oc.url);
    for (let i = 0; i < 40 && !info; i++) {
      await sleep(750);
      info = await oc.api.info().catch(() => null);
    }
  }
  if (!info) {
    oc.connected = false;
    if (!oc.error || /Lost opencode/.test(oc.error)) {
      oc.error = oc.kind === "v2"
        ? `opencode's background service at ${oc.url} did not answer${oc.api && !oc.api.hasPassword ? " (no password found in service.json)" : ""}. Try: opencode service restart`
        : `opencode is not running at ${oc.url}. Start it with: opencode serve --port ${new URL(oc.url).port || 4096}`;
    }
    broadcastLive();
    // 2.x: the service may have moved or restarted with a new password; look it up again.
    if (oc.kind === "v2" && !opt.opencode) oc.api = null;
    setTimeout(connectOpencode, 5000);
    return;
  }
  oc.version = info.version;
  oc.error = null;
  try {
    await loadState();
  } catch (e) {
    log("opencode: could not load sessions:", e.message);
  }
  followEvents();
}

export async function loadState() {
  await oc.api.loadCommands().catch(() => {});
  const ids = await oc.api.loadSessions();
  // Drop links to sessions that no longer exist.
  if (ids) {
    const have = new Set(ids);
    let changed = false;
    for (const [f, e] of Object.entries(links)) {
      const keep = [];
      for (const s of e.sessions) if (have.has(s.id) || (await oc.api.sessionExists(s.id))) keep.push(s);
      if (keep.length !== e.sessions.length) {
        changed = true;
        if (keep.length) e.sessions = keep;
        else delete links[f];
      }
    }
    if (changed) saveLinks();
  }
  await oc.api.loadPrompts();
  await Promise.all(Object.keys(links).map((f) => oc.api.lastText(currentSession(f))));
}

let eventsCtrl = null;
async function followEvents() {
  if (eventsCtrl) eventsCtrl.abort();
  eventsCtrl = new AbortController();
  try {
    const req = oc.api.eventsRequest();
    const r = await fetch(req.url, { signal: eventsCtrl.signal, headers: { accept: "text/event-stream", ...req.headers } });
    if (!r.ok || !r.body) throw new Error(`event stream: HTTP ${r.status}`);
    oc.connected = true;
    log(`opencode ${oc.version || ""} connected at ${oc.url} (${oc.kind === "v2" ? "2.x API" : "1.x API"})`);
    broadcastLive();
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = chunk
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          if (oc.api.onEvent(JSON.parse(data))) broadcastLive();
        } catch (e) {
          log("bad event:", e.message);
        }
      }
    }
    throw new Error("event stream closed");
  } catch (e) {
    if (e.name === "AbortError") return;
    oc.connected = false;
    oc.error = `Lost opencode at ${oc.url} (${e.message}). Reconnecting.`;
    log(oc.error);
    broadcastLive();
    setTimeout(connectOpencode, 3000);
  }
}

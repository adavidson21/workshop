// eng-agents live dashboard: Shared context: command-line options, paths, the session token, allowed shell sites, logging, and finding PowerShell.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The dashboard folder (this file is in its server/ subfolder).
export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP = "eng-agents-dashboard";
export const FRESH_SESSION = new Set(["do-task", "check-docs"]); // the pipeline says: run these in a new session
export const isWin = process.platform === "win32";
export const V1_DEFAULT_URL = "http://127.0.0.1:4096";

// ------------------------------------------------------------------ options

function parseArgs(argv) {
  const o = {
    workspace: process.cwd(),
    port: 4300,
    opencode: null, // null: find it (2.x background service, else 1.x on 4096)
    startOpencode: true,
    opencodeCmd: "opencode",
    ps: null,
    config: null,
    open: true,
    poll: 20,
    checkUpdates: true,
    shellOrigins: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) fail(`Missing value for ${a}`);
      return argv[++i];
    };
    if (a === "--workspace") o.workspace = v();
    else if (a === "--port") o.port = +v();
    else if (a === "--opencode") o.opencode = v().replace(/\/+$/, "");
    else if (a === "--no-start-opencode") o.startOpencode = false;
    else if (a === "--opencode-cmd") o.opencodeCmd = v();
    else if (a === "--ps") o.ps = v();
    else if (a === "--config") o.config = v();
    else if (a === "--no-open") o.open = false;
    else if (a === "--no-update-check") o.checkUpdates = false;
    else if (a === "--poll") o.poll = Math.max(5, +v());
    else if (a === "--shell-origin") o.shellOrigins.push(v());
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node live-server.mjs [options]

  --workspace <dir>      Workspace root (the folder that holds .work). Default: current folder
  --port <n>             Dashboard port. Default: 4300
  --opencode <url>       opencode server to use. Default: found automatically
                         (2.x: the background service; 1.x: http://127.0.0.1:4096)
  --no-start-opencode    Do not start opencode if it is not running
  --opencode-cmd <cmd>   Command that runs opencode. Default: opencode
  --ps <exe>             PowerShell to run New-Dashboard.ps1. Default: pwsh, else powershell
  --config <path>        ADO config.json passed to New-Dashboard.ps1 (for work item links)
  --poll <seconds>       How often to re-read git state. Default: 20
  --no-open              Do not open the browser
  --no-update-check      Do not check for eng-agents updates (update.ps1 -Check)
  --shell-origin <url>   A site allowed to embed this dashboard and read item stages, for example
                         https://prioritizer.example.com. Repeatable. Also read from
                         "dashboard": { "shellOrigins": [...] } in the --config file.`);
      process.exit(0);
    } else fail(`Unknown option: ${a}. Run with --help.`);
  }
  o.workspace = path.resolve(o.workspace);
  return o;
}

export function fail(msg) {
  console.error(`live dashboard: ${msg}`);
  process.exit(1);
}

const major = +process.versions.node.split(".")[0];
if (major < 18) fail(`Node 18 or newer is required (found ${process.versions.node}).`);

export const opt = parseArgs(process.argv.slice(2));
export const workRoot = path.join(opt.workspace, ".work");
if (!fs.existsSync(workRoot)) fail(`No .work folder in ${opt.workspace}. Run this from your workspace root, or pass --workspace.`);
export const stateDir = path.join(workRoot, "_dashboard");
export const sessionsFile = path.join(stateDir, "sessions.json");
export const scriptPath = path.join(HERE, "New-Dashboard.ps1");
export const templatePath = path.join(HERE, "dashboard.template.html");
if (!fs.existsSync(scriptPath)) fail(`Missing ${scriptPath}. Re-run install.ps1.`);
if (!fs.existsSync(templatePath)) fail(`Missing ${templatePath}. Re-run install.ps1.`);
fs.mkdirSync(stateDir, { recursive: true });

export const token = crypto.randomBytes(18).toString("base64url");

// Sites allowed to embed this dashboard (a "shell" such as Prioritizer) and to use /api/shell/*.
// Off unless configured: --shell-origin, or "dashboard": { "shellOrigins": [...] } in config.json.
function normalizeOrigin(o) {
  try {
    const u = new URL(String(o).trim());
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null; // https, or http on this machine (for testing)
    if (u.pathname !== "/" || u.search || u.hash || u.username) return null;
    return u.origin;
  } catch {
    return null;
  }
}
function readShellOrigins() {
  const list = [...opt.shellOrigins];
  if (opt.config) {
    try {
      const cfg = JSON.parse(fs.readFileSync(opt.config, "utf8").replace(/^\uFEFF/, ""));
      const fromCfg = cfg && cfg.dashboard && cfg.dashboard.shellOrigins;
      if (Array.isArray(fromCfg)) list.push(...fromCfg);
    } catch {} // no config, or unreadable: New-Dashboard.ps1 reports that
  }
  const out = [];
  for (const o of list) {
    const n = normalizeOrigin(o);
    if (!n) console.warn(`live dashboard: ignoring shell origin "${o}" (use https://host, or http://localhost:<port> for testing).`);
    else if (!out.includes(n)) out.push(n);
  }
  return out;
}
export const shellOrigins = readShellOrigins();
export const selfOrigins = () => [`http://127.0.0.1:${opt.port}`, `http://localhost:${opt.port}`];
export const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
export const sameDir = (a, b) => {
  if (!a || !b) return false;
  const x = path.resolve(a), y = path.resolve(b);
  return isWin ? x.toLowerCase() === y.toLowerCase() : x === y;
};
// The workspace root or a folder inside it (a TUI started inside one of its repos).
export const inWorkspace = (dir) => {
  if (!dir) return false;
  const x = path.resolve(dir), y = opt.workspace;
  const [a, b] = isWin ? [x.toLowerCase(), y.toLowerCase()] : [x, y];
  return a === b || a.startsWith(b + path.sep);
};

function findPs() {
  if (opt.ps) return opt.ps;
  for (const exe of ["pwsh", "powershell"]) {
    const r = spawnSync(exe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) return exe;
  }
  fail("PowerShell not found. Install PowerShell 7 (pwsh) or pass --ps.");
}
export const psExe = findPs();


export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

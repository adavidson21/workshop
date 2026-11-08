// opencode connector: shared context. Settings from the connector config, paths, timers that stop with
// the connector, logging through ctx, and finding PowerShell.
//
// Copied from eng-agents core/scripts/dashboard/server/context.mjs (gone from eng-agents since Core 2.11.0; this is the only copy). The live server read command-line
// options once at import and exited on a bad one; a connector is started and stopped by the agent, so
// here configure() sets the same values from ctx.config on every start and reports problems instead.
// The values are `export let` bindings, so the other modules always see the current ones.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The connector folder (this file is in its lib/ subfolder).
export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = "1.6.0"; // the connector's version (index.mjs exports it)
export const APP = "eng-agents-dashboard"; // the shell status shape keeps this name (README, `status`)
export const FRESH_SESSION = new Set(["do-task", "check-docs"]); // the pipeline says: run these in a new session
export const isWin = process.platform === "win32";
export const V1_DEFAULT_URL = "http://127.0.0.1:4096";

// ------------------------------------------------------------------ settings

/**
 * The live server's options, from the connector config:
 *   workspace, port (none: the agent serves), opencode (url or null), startOpencode, opencodeCmd,
 *   ps (unused since 1.6.0), config (eng-agents config.json for work item links), poll, username, password.
 */
export let opt = null;
export let workRoot = null;
export let stateDir = null;
export let sessionsFile = null;
export let ctx = null;

/** True while the connector is started. Background work checks it before touching shared state. */
export let running = false;
let generation = 0;

/** Expands a leading ~ to the home folder. */
export function expandHome(p) {
  const s = String(p || "").trim();
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.join(os.homedir(), s.slice(2));
  return s;
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
/** An http URL on this computer, without a trailing slash, or null. */
export function loopbackUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!LOOPBACK.test(url.hostname) || url.username || url.password || url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Sets the options from the connector config. Returns a problem in plain words, or null.
 * Never throws: the connector reports a bad config in status().
 */
export function configure(c) {
  ctx = c;
  generation++;
  running = true;
  const cfg = c.config || {};
  const oc = cfg.opencode || {};
  const env = (name) => {
    if (!name) return undefined;
    try {
      return c.env(name);
    } catch {
      return undefined;
    }
  };
  opt = {
    workspace: cfg.workspace ? path.resolve(expandHome(cfg.workspace)) : null,
    opencode: null,
    startOpencode: oc.startServer !== false,
    opencodeCmd: oc.command || "opencode",
    ps: cfg.powershell || null,
    config: cfg.engAgentsConfig ? path.resolve(expandHome(cfg.engAgentsConfig)) : null,
    poll: Math.max(5, cfg.pollSeconds || 20),
    username: env(oc.usernameEnv) || "opencode",
    password: env(oc.passwordEnv) || null,
  };
  workRoot = stateDir = sessionsFile = null;
  if (oc.url) {
    opt.opencode = loopbackUrl(oc.url);
    if (!opt.opencode) return `The opencode server URL must be on this computer (http://127.0.0.1:<port>), not ${oc.url}.`;
  }
  if (!opt.workspace) return "Set the workspace folder (the folder that holds .work) in Settings.";
  workRoot = path.join(opt.workspace, ".work");
  // A new workspace has no .work yet: create it, so a fresh install works before the first /start.
  if (!fs.existsSync(opt.workspace)) return `The workspace folder ${opt.workspace} does not exist. Create it, or pick another one in opencode settings.`;
  try {
    fs.mkdirSync(workRoot, { recursive: true });
  } catch (e) {
    return `Could not create ${workRoot}: ${e.code || e.message}`;
  }
  stateDir = path.join(workRoot, "_dashboard");
  sessionsFile = path.join(stateDir, "sessions.json");
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (e) {
    return `Could not create ${stateDir}: ${e.code || e.message}`;
  }
  return null;
}

/** Marks the connector stopped and cancels every timer started with later() or every(). */
export function shutdown() {
  running = false;
  generation++;
  for (const t of timers) clearTimeout(t);
  timers.clear();
}

// ------------------------------------------------------------------ timers

const timers = new Set();
/** setTimeout that is cancelled when the connector stops, and never runs for a later start. */
export function later(fn, ms) {
  const gen = generation;
  const t = setTimeout(() => {
    timers.delete(t);
    if (running && gen === generation) fn();
  }, ms);
  t.unref?.();
  timers.add(t);
  return t;
}
export function cancel(t) {
  if (!t) return;
  clearTimeout(t);
  clearInterval(t);
  timers.delete(t);
}
/** setInterval that is cancelled when the connector stops. */
export function every(fn, ms) {
  const gen = generation;
  const t = setInterval(() => {
    if (running && gen === generation) fn();
  }, ms);
  t.unref?.();
  timers.add(t);
  return t;
}
/** Wraps a callback so it does nothing once the connector has stopped or restarted. */
export function current(fn) {
  const gen = generation;
  return (...a) => (running && gen === generation ? fn(...a) : undefined);
}

// ------------------------------------------------------------------ helpers

export const log = (...a) => ctx && ctx.log.info(a.map(String).join(" "));
export const warn = (...a) => ctx && ctx.log.warn(a.map(String).join(" "));
export const sameDir = (a, b) => {
  if (!a || !b) return false;
  const x = path.resolve(a), y = path.resolve(b);
  return isWin ? x.toLowerCase() === y.toLowerCase() : x === y;
};
// The workspace root or a folder inside it (a TUI started inside one of its repos).
export const inWorkspace = (dir) => {
  if (!dir || !opt) return false;
  const x = path.resolve(dir), y = opt.workspace;
  const [a, b] = isWin ? [x.toLowerCase(), y.toLowerCase()] : [x, y];
  return a === b || a.startsWith(b + path.sep);
};

// A repo folder in the workspace: "repo", or "Category/repo" for a repo one folder down. Returns the name
// with "/" as the separator (a "\" is accepted and turned into "/"), or null if it is not one.
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
export function repoFolder(name) {
  const s = String(name || "").trim().replace(/\\/g, "/");
  const parts = s.split("/");
  if (s.length > 201 || parts.length > 2) return null;
  return parts.every((p) => SEGMENT.test(p) && !p.startsWith(".") && !p.startsWith("-")) ? parts.join("/") : null;
}

// Errors carry the status and code the agent API uses (docs/agent-api.md).
const CODES = { 400: "bad_request", 404: "not_found", 409: "conflict", 500: "internal", 503: "unavailable" };
export function httpError(status, message) {
  // The live server used 501 (not supported here) and 502 (opencode refused); the agent API has codes for neither.
  const s = status === 501 ? 400 : status === 502 ? 503 : status;
  const e = new Error(message);
  e.status = CODES[s] ? s : 500;
  e.code = CODES[e.status];
  return e;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A command's error as Dispatch shows it. opencode reads its agents when it starts, so an agent installed after
 * that (a Tandem install or update) is "not found" until opencode restarts: say so.
 */
export function commandError(name, err) {
  const msg = `/${name} failed: ${err}`;
  return /agent not found/i.test(String(err))
    ? `${msg}. opencode was probably started before this agent was installed. Restart it with: workshop restart --opencode (or opencode service stop, then opencode service start), then try again.`
    : msg;
}

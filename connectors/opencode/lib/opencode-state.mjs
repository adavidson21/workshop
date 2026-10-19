// opencode connector: live opencode state shared by both server APIs (sessions, prompts, replies) and HTTP helpers.
//
// Copied from eng-agents core/scripts/dashboard/server/opencode-state.mjs. Changes: resetState() for a
// restart, `agent.done` events, timers and requests that stop with the connector.

import { spawn } from "node:child_process";
import { cancel, ctx, isWin, later, log, opt } from "./context.mjs";
import { autoOnBusy, autoOnIdle } from "./autopilot.mjs";
import { broadcastLive, emitDone } from "./live.mjs";

export const oc = {
  api: null, // the adapter in use
  kind: null, // "v2" | "v1"
  url: null,
  connected: false,
  version: null,
  error: null,
  started: false, // we started a 1.x `opencode serve`
  commands: new Set(),
};
export const sessions = new Map(); // id -> { id, title, status, activity, text, textAt, busySince, error, command }
export const permissions = new Map(); // id -> normalized request
export const questions = new Map(); // id -> normalized request

export function resetState() {
  Object.assign(oc, { api: null, kind: null, url: null, connected: false, version: null, error: null, started: false, commands: new Set() });
  sessions.clear();
  permissions.clear();
  questions.clear();
  turnText.clear();
  doneFor.clear();
  cancel(promptsTimer);
  promptsTimer = null;
}

export function upsertSession(id, patch) {
  if (!id) return {};
  const s = sessions.get(id) || { id, title: null, status: "idle", activity: null, text: null, error: null, updated: null };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) s[k] = v;
  sessions.set(id, s);
  return s;
}

export function setBusy(sid) {
  const prev = sessions.get(sid);
  const starting = !prev || prev.status === "idle";
  upsertSession(sid, { status: "busy", ...(starting ? { error: null, busySince: Date.now() } : {}) });
  autoOnBusy(sid);
}

const doneFor = new Map(); // session id -> busySince of the turn agent.done was sent for
export function setIdle(sid, error) {
  const s = upsertSession(sid, { status: "idle", activity: null, ...(error !== undefined ? { error } : {}) });
  if (oc.api) oc.api.lastText(sid).then(broadcastLive, () => {});
  // One agent.done per turn: opencode 1.x reports idle twice (session.status, then session.idle).
  if (s.busySince && doneFor.get(sid) !== s.busySince) {
    doneFor.set(sid, s.busySince);
    if (doneFor.size > 500) doneFor.delete(doneFor.keys().next().value);
    emitDone(sid, s.error || null);
  }
  autoOnIdle(sid);
}

const turnText = new Map(); // text block key -> text so far
export function appendText(sid, key, delta) {
  const t = (turnText.get(key) || "") + (delta || "");
  turnText.set(key, t);
  if (turnText.size > 500) turnText.delete(turnText.keys().next().value);
  upsertSession(sid, { text: t, textAt: Date.now(), activity: "Writing a reply" });
}

export function setText(sid, key, text) {
  if (key) turnText.set(key, text || "");
  upsertSession(sid, { text: text || "", textAt: Date.now(), activity: "Writing a reply" });
}

export function toolLine(name, input, title) {
  const inp = input || {};
  const what = title || inp.description || inp.command || inp.filePath || inp.path || inp.pattern || "";
  return `${name}${what ? ": " + String(what).split(/\r?\n/)[0].slice(0, 160) : ""}`;
}

let promptsTimer = null;
export function refreshPromptsSoon() {
  cancel(promptsTimer);
  promptsTimer = later(() => {
    if (oc.api) oc.api.loadPrompts().then(broadcastLive, (e) => log("prompts:", e.message));
  }, 120);
}

// ------------------------------------------------------------------ HTTP helpers for opencode

export async function httpJson(url, { method = "GET", body, headers = {}, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = timeout ? setTimeout(() => ctrl.abort(), timeout) : null;
  // Stopping the connector aborts every request to opencode (ctx.signal).
  const signal = ctx && ctx.signal ? AbortSignal.any([ctrl.signal, ctx.signal]) : ctrl.signal;
  try {
    const r = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: r.ok, status: r.status, data, type: r.headers.get("content-type") || "" };
  } finally {
    if (t) clearTimeout(t);
  }
}

export function errText(r) {
  const d = r && r.data;
  const msg = d && typeof d === "object" ? d.message || (d.data && d.data.message) || d.name || d._tag : null;
  return msg ? String(msg).slice(0, 300) : `HTTP ${r ? r.status : "?"}`;
}

// Runs the opencode CLI (fixed arguments only) and returns its output. Never blocks the page.
export function ocCli(args, timeout = 30000) {
  return new Promise((resolve) => {
    const o = { cwd: opt.workspace, windowsHide: true };
    // On Windows opencode may be a .cmd shim, which needs a shell. The arguments are fixed, so one string is safe.
    const p = isWin ? spawn(`"${opt.opencodeCmd}" ${args.join(" ")}`, { ...o, shell: true }) : spawn(opt.opencodeCmd, args, o);
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      err += " (timed out)";
      try { p.kill(); } catch {}
    }, timeout);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, out: "", err: e.message });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out: out.trim(), err: err.trim() });
    });
  });
}

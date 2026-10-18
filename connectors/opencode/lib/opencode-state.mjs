// eng-agents live dashboard: Live opencode state shared by both server APIs (sessions, prompts, replies) and HTTP helpers.

import { spawn } from "node:child_process";
import { isWin, log, opt } from "./context.mjs";
import { starting } from "./actions.mjs";
import { autoOnBusy, autoOnIdle } from "./autopilot.mjs";
import { broadcastLive } from "./live.mjs";

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

export function setIdle(sid, error) {
  upsertSession(sid, { status: "idle", activity: null, ...(error !== undefined ? { error } : {}) });
  oc.api.lastText(sid).then(broadcastLive, () => {});
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
  clearTimeout(promptsTimer);
  promptsTimer = setTimeout(() => {
    oc.api.loadPrompts().then(broadcastLive, (e) => log("prompts:", e.message));
  }, 120);
}

// ------------------------------------------------------------------ HTTP helpers for opencode

export async function httpJson(url, { method = "GET", body, headers = {}, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = timeout ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const r = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
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

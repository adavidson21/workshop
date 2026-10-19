// opencode connector: the full state (what the dashboard page showed) and connector events.
//
// Copied from eng-agents core/scripts/dashboard/server/live.mjs. The live server pushed the whole
// model and live state to open pages over its own event stream. Connector events go through the
// agent's /api/events and must stay small (docs/connector.md), so they say what changed and the app
// calls the `state` or `status` action for the data, as the agent API does for data events.

import { cancel, ctx, isWin, later, opt, running } from "./context.mjs";
import { model, modelError } from "./model.mjs";
import { currentSession, folderForSession, links } from "./links.mjs";
import { oc, permissions, questions, sessions } from "./opencode-state.mjs";
import { attachCommand } from "./actions.mjs";
import { autoData, autopilot } from "./autopilot.mjs";

export function liveData() {
  const items = {};
  for (const [folder, e] of Object.entries(links)) {
    items[folder] = { current: currentSession(folder), sessions: e.sessions.map((s) => ({ ...s, title: (sessions.get(s.id) || {}).title || null })) };
  }
  const tracked = {};
  for (const [id, s] of sessions) {
    const f = folderForSession(id);
    const relevant = f || s.status !== "idle" || [...permissions.values()].some((p) => p.sessionID === id) || [...questions.values()].some((q) => q.sessionID === id);
    if (relevant) tracked[id] = { ...s, folder: f, attach: attachCommand(id) };
  }
  return {
    opencode: { url: oc.url, kind: oc.kind, connected: oc.connected, version: oc.version, error: oc.error, started: oc.started, attach: attachCommand(null) },
    items,
    sessions: tracked,
    permissions: [...permissions.values()].map((p) => ({ ...p, folder: folderForSession(p.sessionID) })),
    questions: [...questions.values()].map((q) => ({ id: q.id, sessionID: q.sessionID, questions: q.questions, folder: folderForSession(q.sessionID) })),
    autopilot: autoData(),
    canOpenTerminal: isWin || process.platform === "darwin",
  };
}

/** The `state` action: the model from New-Dashboard.ps1 plus live opencode state, as the page got it. */
export function pageData() {
  const base = model || { items: [], repos: [], activity: [], workspace: opt.workspace, generatedMs: Date.now(), generated: new Date().toISOString() };
  return { ...base, liveMode: { error: modelError, live: liveData() } };
}

// ------------------------------------------------------------------ events

const clip = (s, n = 300) => (s == null ? null : String(s).slice(0, n));

export function emit(event, payload) {
  if (!running || !ctx) return;
  try {
    ctx.emit(event, payload);
  } catch (e) {
    ctx.log.warn(`Could not send the ${event} event: ${e.message}`);
  }
}

/** `model`: .work was read again. */
export function emitModel() {
  emit("model", { generated: model ? model.generated || null : null, items: model ? (model.items || []).length : 0, error: clip(modelError) });
}

const seenPrompts = new Set();
let liveTimer = null;
let lastConnected = null;
export function resetLive() {
  seenPrompts.clear();
  lastConnected = null;
  cancel(liveTimer);
  liveTimer = null;
}

/** `live`: opencode state changed. Also `agent.waiting` for each new permission prompt or question. */
export function broadcastLive() {
  if (liveTimer || !running) return;
  liveTimer = later(() => {
    liveTimer = null;
    const now = new Set();
    for (const p of permissions.values()) {
      now.add(p.id);
      if (!seenPrompts.has(p.id)) emit("agent.waiting", { folder: folderForSession(p.sessionID), session: p.sessionID, kind: "permission", question: clip(p.title || p.permission) });
    }
    for (const q of questions.values()) {
      now.add(q.id);
      const first = (q.questions || [])[0] || {};
      if (!seenPrompts.has(q.id)) emit("agent.waiting", { folder: folderForSession(q.sessionID), session: q.sessionID, kind: "question", question: clip(first.question || first.header || q.title) });
    }
    seenPrompts.clear();
    for (const id of now) seenPrompts.add(id);
    // The connector's status() reports the opencode connection, so tell the agent when it changes.
    if (oc.connected !== lastConnected) {
      lastConnected = oc.connected;
      try { ctx.statusChanged(); } catch {}
    }
    let busy = 0;
    for (const s of sessions.values()) if (s.status && s.status !== "idle") busy++;
    emit("live", {
      connected: oc.connected,
      error: clip(oc.error),
      busy,
      waiting: permissions.size + questions.size,
      autopilot: Object.values(autopilot).filter((a) => a.status === "running").length,
    });
  }, 200);
}

/** `agent.done`: a session tied to a work item finished a turn. */
export function emitDone(sid, error) {
  const folder = folderForSession(sid);
  if (folder) emit("agent.done", { folder, session: sid, error: clip(error) });
}

/** `autopilot`: autopilot changed status for an item. */
export function emitAutopilot(folder, status, message) {
  emit("autopilot", { folder, status, message: clip(message) });
}

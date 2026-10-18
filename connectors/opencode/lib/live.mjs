// eng-agents live dashboard: Page data and the server-sent event stream to open pages.

import { isWin, opt, shellOrigins, token } from "./context.mjs";
import { model, modelError } from "./model.mjs";
import { currentSession, folderForSession, links } from "./links.mjs";
import { oc, permissions, questions, sessions } from "./opencode-state.mjs";
import { attachCommand } from "./actions.mjs";
import { autoData } from "./autopilot.mjs";
import { updateData } from "./updates.mjs";

function liveData() {
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
    updates: updateData(),
    canOpenTerminal: isWin || process.platform === "darwin",
  };
}

export function pageData() {
  const base = model || { items: [], repos: [], activity: [], workspace: opt.workspace, generatedMs: Date.now(), generated: new Date().toISOString() };
  return { ...base, liveMode: { token, error: modelError, live: liveData(), embedOrigins: shellOrigins } };
}

export const clients = new Set();
export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

let liveTimer = null;
export function broadcastLive() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    broadcast("live", liveData());
  }, 200);
}

// eng-agents live dashboard: Which opencode session belongs to which work item (.work/_dashboard/sessions.json).

import fs from "node:fs";
import { sessionsFile } from "./context.mjs";
import { model } from "./model.mjs";

// { "<folder>": { "sessions": [ { "id": "ses_...", "command": "/do-task 41207 3", "created": "<iso>" } ] } }
export let links = {};
try {
  links = JSON.parse(fs.readFileSync(sessionsFile, "utf8")) || {};
} catch {
  links = {};
}

export function saveLinks() {
  const tmp = sessionsFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(links, null, 2));
  fs.renameSync(tmp, sessionsFile);
}

export function linkSession(folder, id, command) {
  if (!folder || !id) return;
  const entry = (links[folder] = links[folder] || { sessions: [] });
  const found = entry.sessions.find((s) => s.id === id);
  if (found) {
    if (command) found.command = command;
    entry.sessions = entry.sessions.filter((s) => s.id !== id).concat(found);
  } else {
    entry.sessions.push({ id, command: command || null, created: new Date().toISOString() });
    if (entry.sessions.length > 20) entry.sessions = entry.sessions.slice(-20);
  }
  saveLinks();
}

export function currentSession(folder) {
  const e = links[folder];
  if (!e || !e.sessions.length) return null;
  return e.sessions[e.sessions.length - 1].id;
}

export function folderForSession(id) {
  for (const [f, e] of Object.entries(links)) if (e.sessions.some((s) => s.id === id)) return f;
  return null;
}

// Which item a token belongs to: "41207", "tsd-x", ".work/docs-y/guide.md".
export function folderForToken(tok) {
  if (!model || !tok) return null;
  const t = String(tok).trim().replace(/\\/g, "/");
  for (const it of model.items || []) {
    if (it.id && t === String(it.id)) return it.folder;
    if (t === it.folder) return it.folder;
    if (t.includes(`.work/${it.folder}/`) || t === `.work/${it.folder}`) return it.folder;
  }
  return null;
}

// From command arguments ("41207 3").
export function folderForArgs(args) {
  return folderForToken(String(args || "").trim().split(/\s+/)[0]);
}

// From an expanded eng-agents command prompt. Each one names its item in bold on the first line,
// for example "Do task **3** of work item **41207**." (opencode 2.x sends only the expanded text).
export function folderForPrompt(text) {
  const first = String(text || "").split(/\r?\n/)[0];
  const bold = first.match(/\*\*([^*]+)\*\*/g) || [];
  for (const b of bold) {
    const f = folderForToken(b.slice(2, -2).trim().split(/\s+/)[0]);
    if (f) return f;
  }
  return null;
}

// Commands run before the model existed (or before an item folder existed) get linked once it does.
const unlinked = new Map(); // sessionID -> { find: () => folder, command }
export function linkSessionsFromModel() {
  for (const [sid, u] of unlinked) {
    const f = u.find();
    if (f) {
      linkSession(f, sid, u.command);
      unlinked.delete(sid);
    }
  }
}

export function linkFrom(sid, find, command) {
  if (!sid || folderForSession(sid)) return;
  const f = find();
  if (f) linkSession(f, sid, command);
  else unlinked.set(sid, { find, command });
}

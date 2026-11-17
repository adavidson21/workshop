// opencode connector: the knowledge base's workspace side (docs/knowledge.md). Workshop only, not in eng-agents.
//
// Settings builds the repo map from its own data (shared/knowledge.js); this file only reads and writes the
// workspace: each repo's guide (stack, purpose, remembered lines), and the repo map file, <workspace>/AGENTS.md.
// A map that does not start with Workshop's marker is never overwritten without being kept once beside it.

import fs from "node:fs";
import path from "node:path";
import { httpError, log, opt } from "./context.mjs";
import { listRepos } from "./tandem-health.mjs";
import { model } from "./model.mjs";

export const MARKER = "<!-- Written by Workshop -->";
export const MAP_FILE = "AGENTS.md";
export const KEPT_FILE = "AGENTS.md.hand-written.md";
export const MAX_MAP = 400000; // characters
const MAX_GUIDE = 300000;

const isGenerated = (t) => String(t || "").replace(/^﻿/, "").trimStart().startsWith(MARKER);

function needWorkspace() {
  if (!opt || !opt.workspace) throw httpError(409, "Set the workspace folder in opencode settings first.");
  if (!fs.existsSync(opt.workspace)) throw httpError(409, `The workspace folder ${opt.workspace} does not exist.`);
  return opt.workspace;
}

function readText(file, max = MAX_GUIDE) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** What a repo guide says: {stack, purpose, remembered[]}. */
export function guideFacts(text) {
  const lines = String(text || "").split(/\r?\n/);
  const stackLine = lines.find((l) => /^\s*Stack:\s*\S/i.test(l));
  const stack = stackLine ? stackLine.replace(/^\s*Stack:\s*/i, "").replace(/`/g, "").trim().slice(0, 120) : "";
  const sectionAt = (name) => lines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`, "i").test(l.trim()));
  let purpose = "";
  const p = sectionAt("Purpose");
  if (p >= 0) {
    for (let i = p + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) {
      const l = lines[i].trim();
      if (!l || l.startsWith("<!--") || /TODO\(you\)/.test(l)) continue;
      purpose = l.replace(/^[-*]\s+/, "").split(/(?<=\.)\s/)[0].slice(0, 200);
      break;
    }
  }
  const remembered = [];
  const r = sectionAt("Remembered");
  if (r >= 0) for (let i = r + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) if (/^\s*[-*]\s+\S/.test(lines[i])) remembered.push(lines[i].trim().slice(0, 500));
  return { stack, purpose, remembered: remembered.slice(0, 200) };
}

/** knowledge.repos: each workspace repo with what its guide says. Hidden folders are left out (the parsed model). */
export function knowledgeRepos() {
  const workspace = needWorkspace();
  const folders = model && Array.isArray(model.repos) && model.repos.length ? model.repos.map((r) => r.folder).filter(Boolean) : listRepos(workspace);
  const repos = folders.map((folder) => {
    const dir = path.join(workspace, ...folder.split("/"));
    const guide = ["AGENTS.local.md", "AGENTS.md"].find((g) => fs.existsSync(path.join(dir, g))) || null;
    const facts = guide ? guideFacts(readText(path.join(dir, guide))) : { stack: "", purpose: "", remembered: [] };
    return { folder, guide, ...facts };
  });
  return { workspace, repos };
}

/** knowledge.map.read: the repo map file as it is now. */
export function readMap() {
  const workspace = needWorkspace();
  const file = path.join(workspace, MAP_FILE);
  const text = fs.existsSync(file) ? readText(file, MAX_MAP * 2) : null;
  return { path: file, exists: text !== null, generated: text !== null && isGenerated(text), text: text || "" };
}

/**
 * knowledge.map.write: write the repo map Settings built. Refuses text without the marker. A file that is not
 * Workshop's is kept once as AGENTS.md.hand-written.md (an existing kept copy is never overwritten). Atomic.
 */
export function writeMap({ text }) {
  const workspace = needWorkspace();
  const body = String(text || "");
  if (!isGenerated(body)) throw httpError(400, "The repo map must start with Workshop's marker.");
  if (body.length > MAX_MAP) throw httpError(400, "The repo map is too long.");
  const file = path.join(workspace, MAP_FILE);
  let kept = null;
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file, "utf8");
    if (!isGenerated(old)) {
      const keep = path.join(workspace, KEPT_FILE);
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, old);
      kept = keep;
    }
    if (old === body) return { path: file, kept, changed: false };
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  log(`knowledge: wrote ${file}${kept ? ` (kept the hand-written map as ${KEPT_FILE})` : ""}`);
  return { path: file, kept, changed: true };
}

/** The product name as /product-notes draft takes it: one line, quoted when it has spaces. */
export function draftArgs(product) {
  const name = String(product || "").replace(/["\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw httpError(400, "Name the product.");
  if (name.length > 120) throw httpError(400, "That product name is too long.");
  return `draft ${name.includes(" ") ? `"${name}"` : name}`;
}

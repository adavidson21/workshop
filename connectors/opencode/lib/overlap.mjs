// opencode connector: overlap check (1.21.0). Two active items whose tasks change the same file in the same repo
// would conflict if built side by side. tasks.md lists each task's repo and files; this reads them for every
// item still being planned or built (not ready to publish) and reports, per item, the others it shares files with.
// Builds shows it when you approve a plan, with Build after <other> (autopilot's `after`) or Build now.

import fs from "node:fs";
import path from "node:path";
import { workRoot } from "./context.mjs";

/** The files a tasks.md says it changes: ["repo/path", ...] (lower case, forward slashes, no duplicates). */
export function taskFiles(text) {
  const out = new Set();
  if (!text) return [];
  let repo = null;
  let inFiles = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^##\s*\[[ xX]\]\s*Task\s+\d+/.test(line)) { repo = null; inFiles = false; continue; }
    let m;
    if ((m = /^\s*-\s*Repo:\s*`?([^`]+?)`?\s*$/i.exec(line))) { repo = m[1].trim(); inFiles = false; continue; }
    if (/^\s*-\s*Files:\s*$/i.test(line)) { inFiles = true; continue; }
    if (inFiles && (m = /^\s{2,}-\s*`([^`]+)`/.exec(line))) {
      const file = m[1].trim();
      if (!repo || /^<.*>$/.test(file) || /^<.*>$/.test(repo)) continue;
      out.add(`${repo}/${file}`.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase());
      continue;
    }
    if (inFiles && /^\s*-\s*\S/.test(line) && !/^\s{2,}-/.test(line)) inFiles = false;
  }
  return [...out];
}

/**
 * Overlaps between items. `files` maps folder -> files (taskFiles). Returns { folder: [{ with, files }] } for
 * folders that share at least one file with another, each list sorted by folder.
 */
export function overlapsOf(files) {
  const out = {};
  const folders = Object.keys(files).sort();
  for (let i = 0; i < folders.length; i++) {
    for (let j = i + 1; j < folders.length; j++) {
      const a = folders[i], b = folders[j];
      const set = new Set(files[a]);
      const shared = files[b].filter((f) => set.has(f));
      if (!shared.length) continue;
      (out[a] = out[a] || []).push({ with: b, files: shared.slice(0, 20) });
      (out[b] = out[b] || []).push({ with: a, files: shared.slice(0, 20) });
    }
  }
  return out;
}

/** Overlaps for the model's active items (planned or building, not ready to publish, not paused). */
export function overlapData(items) {
  const files = {};
  for (const it of items || []) {
    if (it.kind !== "item" || it.paused || !it.next || ["ship", "start"].includes(it.next.stage)) continue;
    let text = null;
    try {
      text = fs.readFileSync(path.join(workRoot, it.folder, "tasks.md"), "utf8");
    } catch {
      continue;
    }
    const f = taskFiles(text);
    if (f.length) files[it.folder] = f;
  }
  return overlapsOf(files);
}

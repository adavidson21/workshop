// opencode connector: remove every work item at once (Settings, Data, Start over; docs/agent-api.md, Reset).
//
// The agent's reset calls the `work.reset` action after it has zipped .work into the person's backup. This
// removes every item folder in .work the way `remove` does one: each item's git worktrees with
// `git worktree remove` (never --force, so one with uncommitted changes is kept and named), then the folder.
// Then the floor's state about items in .work/_dashboard (sessions, autopilot, Noticed, gaps, published,
// epics, the PR review queue) and .work/_onboarding. Kept: factory.json, projects.json, ado-links.json (a
// one-time marker), the repos, their branches and opencode's own sessions.
import fs from "node:fs";
import path from "node:path";
import { log, sameDir, workRoot } from "./context.mjs";
import { findItem, removeWorktrees } from "./actions.mjs";
import { currentSession } from "./links.mjs";
import { oc, sessions } from "./opencode-state.mjs";
import { autopilot, saveAuto } from "./autopilot.mjs";

/** The phrase the caller sends, so this never runs by accident (the agent sends it after the person typed theirs). */
export const WORK_RESET_PHRASE = "remove every work item";

/** State files in .work/_dashboard that describe items. Removing them empties the floor's memory of items. */
export const ITEM_STATE_FILES = ["sessions.json", "autopilot.json", "observations.json", "gaps.json", "published.json", "epics.json", "pr-queue.json"];

/** The item folders in .work: plain folders not starting with _ or . (the parser's rule). */
export function itemFolders(root = workRoot) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((d) => d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith("_") && !d.name.startsWith(".")).map((d) => d.name).sort();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops autopilot, stops agents still working on an item, then removes every item folder and the item state.
 * Returns { removed: [folder], kept: [worktree: why], failed: [folder: why], stopped: n }.
 * A folder that cannot be deleted (a file held open) is listed in `failed` and left; the rest still go.
 */
export async function resetWork() {
  if (!workRoot) throw Object.assign(new Error("The opencode connector has no workspace."), { status: 503 });
  // Autopilot first, so no step starts while folders go.
  for (const k of Object.keys(autopilot)) delete autopilot[k];
  try {
    saveAuto();
  } catch {}
  const folders = itemFolders();
  let stopped = 0;
  if (oc.connected && oc.api) {
    for (const f of folders) {
      const sid = currentSession(f);
      const s = sid && sessions.get(sid);
      if (!s || s.status === "idle") continue;
      try {
        await oc.api.abort(sid);
        stopped++;
      } catch (e) {
        log(`reset: could not stop session ${sid} (${e.message})`);
      }
    }
    if (stopped) await wait(1500); // let opencode let go of files before they are deleted (Windows)
  }
  const removed = [], kept = [], failed = [];
  for (const f of folders) {
    const full = path.join(workRoot, f);
    if (!sameDir(path.dirname(full), workRoot)) continue;
    const it = findItem(f);
    if (it) {
      try {
        kept.push(...(await removeWorktrees(it)));
      } catch (e) {
        kept.push(`${f}: worktrees not removed (${e.message})`);
      }
    }
    try {
      fs.rmSync(full, { recursive: true, force: false, maxRetries: 3, retryDelay: 200 });
      removed.push(f);
    } catch (e) {
      failed.push(`${f}: ${e.code || e.message}`);
    }
  }
  const dash = path.join(workRoot, "_dashboard");
  for (const name of ITEM_STATE_FILES) {
    try {
      fs.rmSync(path.join(dash, name), { force: true });
    } catch (e) {
      failed.push(`_dashboard/${name}: ${e.code || e.message}`);
    }
  }
  try {
    fs.rmSync(path.join(workRoot, "_onboarding"), { recursive: true, force: true });
  } catch (e) {
    failed.push(`_onboarding: ${e.code || e.message}`);
  }
  log(`reset: removed ${removed.length} work item folder(s)${kept.length ? `, kept ${kept.length} worktree(s)` : ""}${failed.length ? `, could not remove ${failed.length}` : ""}`);
  return { removed, kept, failed, stopped };
}

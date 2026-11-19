// opencode connector: epics that hand off to builds, and products that onboard themselves (1.23.0, eng-agents Core
// 4.10.0; Workshop project doc claude/loom-floor-v1-plan.md).
//
// Epics. Approving an epic's breakdown (milestones.md) is enough: `epic.build` runs Tandem's `/backlog <scope> local`,
// which makes one local item per story with "- Epic:", "- Story:", "- Depends on:", "- Repos:", "- Areas:" and
// "- Breakdown: approved" lines (workparser storyOf). Once they exist, every story of an epic you asked to build
// gets autopilot, each one after the story it depends on. Autopilot starts, specs and approves a story's plan on its
// own (`/approve <id> spec auto` holds it when it drifts from the breakdown); every PR still waits for Publish.
//
// Onboarding. `product.onboard` runs `/onboard-product <product>`. Tandem records its steps in
// .work/_onboarding/<product>.md (workparser onboardingOf) and makes a trial run, a local item with "- Trial:".
// The trial run gets autopilot on its own; when it reaches Ready to publish the product is live.
//
// Regression tests (1.25.0, eng-agents Core 4.13.0). `tests.cover` runs `/cover <product> [-- <area>]`, which makes one
// local Quick change per UI repo with "- Coverage: <product>". Each gets autopilot on its own, like a trial run.
//
// Workshop keeps only what it asked for, in .work/_dashboard/epics.json: { epics: { <scope>: { at } },
// onboarding: { <product>: { at, session, live } }, coverage: { <product>: { at, session } } }. Tandem's files stay
// Tandem's.

import fs from "node:fs";
import path from "node:path";
import { httpError, log, stateDir, workRoot } from "./context.mjs";
import { autopilot, autopilotAction } from "./autopilot.mjs";

const SCOPE = /^scope-[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const file = () => path.join(stateDir, "epics.json");
const empty = () => ({ epics: {}, onboarding: {}, coverage: {} });
let state = empty();

export function loadEpics() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), "utf8"));
    const obj = (v) => (v && typeof v === "object" ? v : {});
    state = { epics: obj(d && d.epics), onboarding: obj(d && d.onboarding), coverage: obj(d && d.coverage) };
  } catch {
    state = empty();
  }
}
export function resetEpics() {
  state = empty();
}
function save() {
  try {
    const tmp = file() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...state }, null, 2));
    fs.renameSync(tmp, file());
  } catch (e) {
    log(`Could not save epics.json: ${e.message}`);
  }
}
const lc = (s) => String(s || "").toLowerCase();

/** The story items of an epic (scope folder), in story order. */
export function storiesOf(scope, items) {
  const num = (s) => String(s || "").split(".").map((n) => Number(n) || 0);
  return (items || []).filter((it) => it.kind === "item" && it.story && lc(it.story.epic) === lc(scope))
    .sort((a, b) => { const x = num(a.story.story), y = num(b.story.story); return (x[0] - y[0]) || ((x[1] || 0) - (y[1] || 0)) || String(a.id).localeCompare(String(b.id)); });
}

/** The folder a story builds after: the last story it depends on that has no PR text yet, or null. */
export function storyAfter(it, items) {
  if (!it || !it.story || !it.story.dependsOn.length) return null;
  const waiting = it.story.dependsOn
    .map((id) => (items || []).find((x) => x.kind === "item" && lc(x.id) === lc(id)))
    .filter((x) => x && x.stage !== "ship" && x.bucket !== "done");
  return waiting.length ? waiting[waiting.length - 1].folder : null;
}

/** A story or trial run Workshop builds hands-off (no plan approval needed from you unless it drifts). */
export const handsOffItem = (it) => !!it && it.kind === "item" && ((it.story && it.story.breakdown) || !!it.trial || !!it.coverage);

/**
 * Build an epic: make its stories (Tandem's /backlog <scope> local) unless they exist, and remember that you asked,
 * so every story gets autopilot as soon as it exists. `run` is workspace.mjs runLoose.
 */
export async function buildEpic({ folder }, { items = [], run, start = autopilotAction } = {}) {
  const scope = String(folder || "");
  if (!SCOPE.test(scope)) throw httpError(400, `"${scope}" is not an epic (scope-) folder.`);
  const epic = (items || []).find((x) => x.folder === scope);
  if (!epic) throw httpError(404, `.work/${scope} not found.`);
  state.epics[scope] = { at: new Date().toISOString() };
  save();
  const stories = storiesOf(scope, items);
  if (!stories.length) {
    const r = await run("backlog", `${scope} local`, null);
    return { ok: true, split: true, session: r && r.session ? r.session : null, started: [] };
  }
  await startWaiting(items, start);
  // The stories building now: started here, or a moment earlier by the model hook (the .work watcher saw them first).
  return { ok: true, split: false, started: stories.filter((it) => autopilot[it.folder]).map((it) => it.folder) };
}

// One pass at a time: the model hook and epic.build can both ask, and a second pass must see what the first started.
let pass = Promise.resolve();
/** Starts autopilot for every story of an epic you asked to build, and every trial run, that has none yet. */
export function startWaiting(items, start = autopilotAction) {
  const next = pass.then(() => startNow(items, start));
  pass = next.catch(() => {});
  return next;
}
async function startNow(items, start) {
  const started = [];
  const want = (it) => (it.story && it.story.breakdown && state.epics[it.story.epic]) || (it.trial && state.onboarding[onboardKey(it.trial)])
    || (it.coverage && state.coverage[onboardKey(it.coverage)]);
  const list = (items || []).filter((it) => handsOffItem(it) && want(it) && !autopilot[it.folder] && it.stage !== "ship" && it.bucket !== "done" && !it.paused);
  // Stories in story order, so each one's `after` is already known when it queues.
  for (const it of list.sort((a, b) => String(a.story && a.story.story).localeCompare(String(b.story && b.story.story)))) {
    try {
      const after = it.story ? storyAfter(it, items) : null;
      await start({ folder: it.folder, action: "start", ...(after ? { after } : {}) });
      started.push(it.folder);
    } catch (e) {
      log(`Could not start ${it.folder} hands-off: ${e.message}`);
    }
  }
  return started;
}

/** For Loom: each epic you asked to build (or that has stories), its stories and where they are. */
export function epicsData(items) {
  const scopes = new Set(Object.keys(state.epics));
  for (const it of items || []) if (it.kind === "item" && it.story) scopes.add(it.story.epic);
  const out = [];
  for (const scope of scopes) {
    const stories = storiesOf(scope, items);
    const epic = (items || []).find((x) => x.folder === scope) || null;
    out.push({
      folder: scope, title: epic ? epic.title || scope : scope, asked: state.epics[scope] ? state.epics[scope].at : null,
      total: stories.length, ready: stories.filter((s) => s.stage === "ship").length,
      stories: stories.map((s) => ({ folder: s.folder, id: s.id, story: s.story.story, title: s.title, stage: s.stage, dependsOn: s.story.dependsOn, auto: autopilot[s.folder] ? autopilot[s.folder].status : null })),
    });
  }
  return out.sort((a, b) => String(b.asked || "").localeCompare(String(a.asked || "")));
}

// ------------------------------------------------------------------ onboarding

const onboardKey = (product) => lc(String(product || "").trim());

/** Onboard a product: runs Tandem's /onboard-product, and remembers it so its trial run builds hands-off. */
export async function onboardProduct({ product }, { run } = {}) {
  const name = String(product || "").replace(/[\r\n"]+/g, " ").trim();
  if (!name) throw httpError(400, "Name the product to onboard.");
  const r = await run("onboard-product", name, null);
  state.onboarding[onboardKey(name)] = { product: name, at: new Date().toISOString(), session: r && r.session ? r.session : null, live: null };
  save();
  return { ok: true, session: r && r.session ? r.session : null };
}

/** Backfill regression tests: runs Tandem's /cover, and remembers it so its items build hands-off. */
export async function coverProduct({ product, area }, { run } = {}) {
  const clean = (v) => String(v || "").replace(/[\r\n"]+/g, " ").trim();
  const name = clean(product);
  if (!name) throw httpError(400, "Name the product to add regression tests for.");
  const where = clean(area).slice(0, 200);
  // /cover reads the product before " -- " and the area after it.
  const r = await run("cover", `${name}${where ? " -- " + where : ""}`, null);
  state.coverage[onboardKey(name)] = { product: name, area: where || null, at: new Date().toISOString(), session: r && r.session ? r.session : null };
  save();
  return { ok: true, session: r && r.session ? r.session : null };
}

/** Stop showing a product's onboarding (it stays onboarded; Tandem's file is left alone). */
export function dismissOnboarding({ product }) {
  const k = onboardKey(product);
  if (state.onboarding[k]) { state.onboarding[k].dismissed = new Date().toISOString(); save(); }
  return { ok: true };
}

/**
 * For Loom: each product being onboarded, with its five steps: add, scan, gaps, trial, live, each "done", "now",
 * or "next". `files` is the model's onboarding list, `gaps` the open gaps, `items` the model's items.
 */
export function onboardingData(files, gaps, items, sessions) {
  const byKey = new Map();
  for (const f of files || []) byKey.set(onboardKey(f.product), { product: f.product, file: f });
  for (const [k, o] of Object.entries(state.onboarding)) if (!byKey.has(k)) byKey.set(k, { product: o.product || k, file: null });
  const out = [];
  let changed = false;
  for (const [k, { product, file: f }] of byKey) {
    const asked = state.onboarding[k] || null;
    if (asked && asked.dismissed) continue;
    const trial = f && f.trial ? (items || []).find((x) => x.kind === "item" && lc(x.id) === lc(f.trial)) || null : null;
    const open = (gaps || []).filter((g) => g.status === "open" && onboardKey(g.product) === k);
    const running = asked && asked.session && sessions && sessions.get && sessions.get(asked.session) && sessions.get(asked.session).status !== "idle";
    // Live once the trial run reached Ready to publish (kept, so it stays live after the trial folder is removed).
    let live = (f && f.live) || (asked && asked.live) || null;
    if (!live && trial && trial.stage === "ship") {
      live = new Date().toISOString().slice(0, 10);
      if (asked) { asked.live = live; changed = true; }
    }
    const scanned = !!(f && f.scan);
    const steps = [
      { id: "add", name: "Add", st: "done" },
      { id: "scan", name: "Scan", st: scanned ? "done" : running || asked ? "now" : "next" },
      { id: "gaps", name: "Fill the gaps", st: !scanned ? "next" : open.length ? "now" : "done" },
      { id: "trial", name: "Trial run", st: live ? "done" : f && f.trial ? "now" : "next" },
      { id: "live", name: "Live", st: live ? "done" : "next" },
    ];
    out.push({ product, steps, gaps: open.length, repos: scanned ? f.scan.repos : [], trial: trial ? { folder: trial.folder, id: trial.id, stage: trial.stage } : f && f.trial ? { folder: null, id: f.trial, stage: null } : null, live, session: asked ? asked.session : null, at: asked ? asked.at : null });
  }
  if (changed) save();
  return out;
}

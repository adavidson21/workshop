// opencode connector: the hub on Dispatch's page (apps/agents, Workshop docs/hub.md). Workshop only, not in the
// eng-agents live server.
//
// hub.run saves what Dispatch sends as request.md in this connector's own folder,
// <Workshop home>/data/_connectors/opencode/hub/<id>/, never in the workspace or .work, and runs Tandem's
// /hub <path to request.md> in a new session (eng-agents Core 2.9.0). The hub agent writes route.json and, for a
// question, answer.md next to it. hub.result reads them back. Both refuse unless the connector's `hub` setting is
// on (off by default; only Workshop on this computer can change it).

import fs from "node:fs";
import path from "node:path";
import { ctx, httpError, log } from "./context.mjs";
import { sessions } from "./opencode-state.mjs";
import { runLoose } from "./workspace.mjs";
import { recordHub } from "./chat.mjs";

export const HUB_ID = /^[a-z0-9][a-z0-9_-]{2,59}$/;
export const MAX_MESSAGE = 4000;
const MAX_ROUTE_BYTES = 64000;
const MAX_ANSWER_BYTES = 200000;
export const KEEP = 200;
const LIST_MAX = 200;

// folder name -> opencode session id of the last run, for this start of the connector.
const runs = new Map();
export function resetHub() {
  runs.clear();
}
/** Session ids started by the hub, so Dispatch can tell them apart from other loose sessions. */
export function hubSessions() {
  return new Set(runs.values());
}

/** The connector's own folder for hub requests. */
export function hubRoot(home = ctx && ctx.home) {
  if (!home) throw httpError(503, "The opencode connector is not ready yet.");
  return path.join(home, "data", "_connectors", "opencode", "hub");
}

/** The folder for one request id. Refuses anything that is not a plain id. */
export function folderFor(id, root) {
  if (!HUB_ID.test(String(id || ""))) throw httpError(400, "That is not a hub request id.");
  return path.join(root, id);
}

/** Refuses unless the `hub` setting is on. */
export function needHub(config = ctx && ctx.config) {
  if (!config || config.hub !== true) throw httpError(503, "The hub is off. Turn on Hub in the opencode connector's settings (Workshop on this computer).");
}

const line = (v, max = 200) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const list = (v) => (Array.isArray(v) ? v.slice(0, LIST_MAX) : []);

/** request.md from what Dispatch sends (Workshop docs/hub.md, request.md). Names are one line each, never Markdown structure. */
export function requestText({ text, context = {} }, today) {
  const people = list(context.people).filter((p) => p && typeof p.id === "string" && typeof p.name === "string");
  const lists = list(context.lists).filter((l) => typeof l === "string");
  const areas = list(context.areas).filter((a) => typeof a === "string");
  const section = (title, rows) => `## ${title}\n\n${rows.length ? rows.map((r) => `- ${r}`).join("\n") : "None."}\n`;
  const names = new Map(people.map((p) => [p.id, line(p.name)]));
  const rel = (p) => p.kind === "group"
    ? `group: ${list(p.members).map((id) => names.get(id)).filter(Boolean).join(", ") || "no members"}`
    : [line(p.relation, 20), p.team ? "on my team" : ""].filter(Boolean).join(", ");
  const handle = (p) => (typeof p.handle === "string" && /^[a-z0-9][a-z0-9._-]{0,39}$/.test(p.handle) ? ` @${p.handle}` : "");
  return [
    "# Hub request\n",
    `Date: ${today}\n`,
    "## Message\n",
    String(text).slice(0, MAX_MESSAGE).trim() + "\n",
    section("People", people.map((p) => `${line(p.id, 110)}: ${line(p.name)}${handle(p)}${rel(p) ? ` (${rel(p)})` : ""}`)),
    section("Docket lists", lists.map((l) => line(l, 120))),
    section("Team areas", areas.map((a) => line(a, 300))),
  ].join("\n");
}

const busy = (sid) => !!(sid && sessions.get(sid) && sessions.get(sid).status !== "idle");
const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Keep the newest KEEP request folders. */
export function prune(root, keep = KEEP) {
  let names;
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && HUB_ID.test(d.name)).map((d) => d.name); }
  catch { return 0; }
  if (names.length <= keep) return 0;
  const aged = names.map((n) => { try { return [n, fs.statSync(path.join(root, n)).mtimeMs]; } catch { return [n, 0]; } }).sort((a, b) => b[1] - a[1]);
  let gone = 0;
  for (const [n] of aged.slice(keep)) {
    if (busy(runs.get(n))) continue;
    try { fs.rmSync(path.join(root, n), { recursive: true, force: true }); runs.delete(n); gone++; } catch { /* next time */ }
  }
  return gone;
}

/** Save the request and run /hub on it in a new session. Refused while the same id runs. */
export async function runHub({ id, text, context }, { root = hubRoot(), start = runLoose, config, now = new Date(), record = recordHub } = {}) {
  needHub(config);
  const dir = folderFor(id, root);
  const msg = String(text || "");
  if (!msg.trim()) throw httpError(400, "The message is empty.");
  if (msg.length > MAX_MESSAGE) throw httpError(400, `The message is over ${MAX_MESSAGE} characters.`);
  if (busy(runs.get(id))) throw httpError(409, "This hub message is already running.");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "request.md");
  fs.writeFileSync(file, requestText({ text: msg, context: context || {} }, localDay(now)), { mode: 0o600 });
  fs.rmSync(path.join(dir, "route.json"), { force: true });
  fs.rmSync(path.join(dir, "answer.md"), { force: true });
  const r = await start("hub", file, null);
  runs.set(id, r.session);
  record(r.session, id, msg);
  log(`hub ${id} started in ${r.session}`);
  prune(root);
  return { session: r.session, id };
}

const MAX_SAID = 20000;

/** route.json text to JSON. Models sometimes wrap it in a code fence or add a line around it, so the outermost
 * {...} is tried when the whole text does not parse. Throws when neither does. */
export function parseRoute(text) {
  const t = String(text).replace(/^\uFEFF/, "").trim();
  try { return JSON.parse(t); } catch { /* try the object inside */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object");
  return JSON.parse(t.slice(a, b + 1));
}

function readCapped(file, max) {
  const buf = fs.readFileSync(file);
  return buf.subarray(0, max).toString("utf8");
}

/**
 * Where a request is: {state: 'none'} (never asked), 'running' (with `route` once route.json is written),
 * 'routed' (route.json, no answer expected or the session ended), 'done' (route and answer), or 'failed' with
 * `error`. `route` is the parsed JSON as written; Dispatch checks it against the schema before showing it.
 */
export function hubResult({ id }, { root = hubRoot(), config } = {}) {
  needHub(config);
  const dir = folderFor(id, root);
  const sid = runs.get(id);
  const out = sid ? { session: sid } : {};
  let route = null, routeError = null, answer = null;
  const rf = path.join(dir, "route.json"), af = path.join(dir, "answer.md");
  if (fs.existsSync(rf)) {
    try { route = parseRoute(readCapped(rf, MAX_ROUTE_BYTES)); } catch { routeError = "route.json is not valid JSON."; }
  }
  if (fs.existsSync(af)) answer = readCapped(af, MAX_ANSWER_BYTES);
  if (busy(sid)) return { state: "running", ...out, ...(route ? { route } : {}) };
  // What the session last said, for when the files do not tell the whole story (Dispatch shows it as text).
  const s = sid ? sessions.get(sid) : null;
  const said = s && typeof s.text === "string" && s.text.trim() ? { said: s.text.slice(0, MAX_SAID) } : {};
  if (routeError) return { state: "failed", ...out, error: `The hub could not read its route: ${routeError}`, ...(answer != null ? { answer } : {}), ...said };
  if (route && answer != null) return { state: "done", ...out, route, answer };
  if (route) return { state: "routed", ...out, route, ...said };
  if (!sid) return { state: "none" };
  if (answer != null) return { state: "failed", ...out, error: "The hub wrote an answer but no route.json.", answer, ...said };
  return { state: "failed", ...out, error: (s && s.error) || "The hub ended without writing route.json.", ...said };
}

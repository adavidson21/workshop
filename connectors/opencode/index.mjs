// opencode connector: the eng-agents live dashboard server as a Workshop connector. It reads .work with
// the eng-agents parser, follows opencode (1.x and 2.x), and runs pipeline commands. See README.md.
//
// The modules in lib/ are copied from eng-agents core/scripts/dashboard/server/ (README.md, Source).
// The live server's HTTP routes are the actions below; its event stream is connector events.
import fs from "node:fs";
import path from "node:path";
import { VERSION, configure, current, findPs, httpError, opt, shutdown, workRoot } from "./lib/context.mjs";
import { modelError, refresh, resetModel, watchWork } from "./lib/model.mjs";
import { loadLinks } from "./lib/links.mjs";
import { oc, resetState } from "./lib/opencode-state.mjs";
import { connectOpencode, disconnectOpencode } from "./lib/opencode-connect.mjs";
import { abort, answerPermission, answerQuestion, openTerminal, pushBranch, removeItem, reply, resetActions, runCommand, shellData, startItem } from "./lib/actions.mjs";
import { autopilotAction, loadAuto } from "./lib/autopilot.mjs";
import { pageData, resetLive } from "./lib/live.mjs";

export const configSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspace"],
  properties: {
    workspace: {
      type: "string",
      title: "Workspace folder",
      description: "The folder that holds .work and your repos, where you run opencode. ~ is your home folder.",
      minLength: 1,
      "x-workshop-hosted": true,
    },
    opencode: {
      type: "object",
      title: "opencode",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          title: "Server URL",
          format: "uri",
          description: "Leave empty to find it: opencode 2.x's background service, else opencode 1.x on http://127.0.0.1:4096. Must be on this computer.",
        },
        command: {
          type: "string",
          title: "Command that runs opencode",
          default: "opencode",
          pattern: "^[^\"&|<>^%\\r\\n]+$",
        },
        startServer: {
          type: "boolean",
          title: "Start opencode if it is not running",
          description: "2.x: opencode service start. 1.x: opencode serve, stopped again when this connector stops.",
          default: true,
          "x-workshop-hosted": true,
        },
        passwordEnv: {
          type: "string",
          title: "2.x service password environment variable",
          description: "Only needed if the password is not in opencode's service.json.",
          "x-workshop-env": true,
          default: "OPENCODE_SERVER_PASSWORD",
        },
        usernameEnv: {
          type: "string",
          title: "2.x service user name environment variable",
          description: "Not set means opencode.",
          "x-workshop-env": true,
          default: "OPENCODE_SERVER_USERNAME",
        },
      },
    },
    powershell: {
      type: "string",
      title: "PowerShell command",
      description: "Runs the .work parser. Leave empty to use pwsh, else powershell.",
      pattern: "^[^\"&|<>^%\\r\\n]*$",
    },
    engAgentsConfig: {
      type: "string",
      title: "Tandem config.json",
      description: "Used only to build work item links. Leave empty for ~/.config/eng-agents/config.json (Tandem's default).",
    },
    pollSeconds: {
      type: "integer",
      title: "Re-read git state every (seconds)",
      minimum: 5,
      maximum: 3600,
      default: 20,
      "x-workshop-hosted": true,
    },
  },
};

// ------------------------------------------------------------------ lifecycle

let phase = "stopped"; // stopped | starting | ready | error
let problem = null;
let ctxRef = null;

function setPhase(p, msg = null) {
  phase = p;
  problem = msg;
  try { ctxRef && ctxRef.statusChanged(); } catch {}
}

function resetAll() {
  shutdown();
  disconnectOpencode();
  resetModel();
  resetLive();
  resetState();
  resetActions();
}

async function init() {
  const alive = current(() => true);
  const ps = await findPs();
  if (!alive()) return;
  if (ps) return setPhase("error", ps);
  await refresh();
  if (!alive()) return;
  watchWork();
  setPhase("ready");
  connectOpencode().catch((e) => ctxRef && ctxRef.log.error(`opencode: ${e.message}`));
}

// ------------------------------------------------------------------ actions

// Status messages are at most 500 characters (docs/schemas/common.schema.json).
const clip = (m) => (m && m.length > 500 ? m.slice(0, 497) + "..." : m);

function needReady() {
  if (phase !== "ready") throw httpError(503, problem || "The opencode connector is not ready yet.");
}

// .work/<folder>/<file>.md only, read-only (the live server's /files/ route).
function readWorkFile({ folder, file }) {
  const parts = [folder, file];
  if (!/\.md$/i.test(file) || parts.some((p) => !p || p.startsWith(".") || /[\\/]/.test(p) || p.includes("\0"))) throw httpError(404, "Not found.");
  const full = path.join(workRoot, folder, file);
  if (!full.startsWith(workRoot + path.sep)) throw httpError(404, "Not found.");
  try {
    return { folder, file, text: fs.readFileSync(full, "utf8") };
  } catch {
    throw httpError(404, `.work/${folder}/${file} not found.`);
  }
}

const str = (title, extra = {}) => ({ type: "string", title, maxLength: 4000, ...extra });
const obj = (required, properties) => ({ type: "object", additionalProperties: false, ...(required.length ? { required } : {}), properties });
const folder = str("Item folder", { minLength: 1, maxLength: 200 });
const session = str("opencode session id", { minLength: 1, maxLength: 200 });

const actions = {
  status: {
    title: "Work items and agent state",
    write: false,
    async run() {
      needReady();
      return shellData();
    },
  },
  state: {
    title: "Everything the dashboard shows",
    write: false,
    async run() {
      needReady();
      return pageData();
    },
  },
  refresh: {
    title: "Read .work again",
    write: false,
    async run() {
      needReady();
      await refresh();
      return { ok: true, error: modelError };
    },
  },
  "file.read": {
    title: "Read a .work file",
    write: false,
    argsSchema: obj(["folder", "file"], { folder, file: str("File", { minLength: 1, maxLength: 200 }) }),
    async run(args) {
      needReady();
      return readWorkFile(args);
    },
  },
  run: {
    title: "Run a pipeline command",
    write: true,
    argsSchema: obj(["folder", "command"], { folder, command: str("Command", { minLength: 2 }) }),
    async run(args) {
      needReady();
      return runCommand({ folder: args.folder, command: args.command });
    },
  },
  start: {
    title: "Start a work item",
    write: true,
    argsSchema: obj(["id", "lane"], { id: str("Work item id", { pattern: "^[0-9]{1,10}$" }), lane: { type: "string", title: "Lane", enum: ["feature", "bug"] } }),
    async run(args) {
      needReady();
      return startItem(args);
    },
  },
  reply: {
    title: "Reply to the agent",
    write: true,
    argsSchema: obj(["session", "text"], { session, text: str("Reply", { maxLength: 100000 }) }),
    async run(args) {
      needReady();
      return reply(args);
    },
  },
  answer: {
    title: "Answer a permission prompt or question",
    write: true,
    argsSchema: obj(["kind", "id"], {
      kind: { type: "string", title: "Kind", enum: ["permission", "question"] },
      id: str("Prompt id", { minLength: 1, maxLength: 200 }),
      reply: { type: "string", title: "Permission answer", enum: ["once", "always", "reject"] },
      answers: { type: "array", title: "Answers, one list per question", maxItems: 50, items: { type: "array", maxItems: 50, items: str("Answer") } },
      reject: { type: "boolean", title: "Dismiss the question" },
    }),
    async run(args) {
      needReady();
      if (args.kind === "permission") return answerPermission({ id: args.id, reply: args.reply });
      return answerQuestion({ id: args.id, answers: args.answers, reject: args.reject === true });
    },
  },
  abort: {
    title: "Stop the agent",
    write: true,
    argsSchema: obj(["session"], { session }),
    async run(args) {
      needReady();
      return abort(args);
    },
  },
  remove: {
    title: "Remove a work item folder",
    write: true,
    argsSchema: obj(["folder", "confirm"], { folder, confirm: str("Type the item id to confirm", { maxLength: 200 }) }),
    async run(args) {
      needReady();
      return removeItem(args);
    },
  },
  push: {
    title: "Push branches",
    write: true,
    argsSchema: obj(["folder", "repo"], { folder, repo: str("Repo folder", { minLength: 1, maxLength: 260 }) }),
    async run(args) {
      needReady();
      return pushBranch(args);
    },
  },
  autopilot: {
    title: "Start, resume or stop autopilot",
    write: true,
    argsSchema: obj(["folder", "action"], { folder, action: { type: "string", title: "Action", enum: ["start", "approve-start", "resume", "stop", "dismiss"] } }),
    async run(args) {
      needReady();
      return autopilotAction(args);
    },
  },
  terminal: {
    title: "Open the opencode TUI in a terminal",
    write: false,
    argsSchema: obj([], { session }),
    async run(args) {
      needReady();
      return openTerminal({ session: args.session || null });
    },
  },
};

export default {
  api: 1,
  id: "opencode",
  name: "opencode",
  version: VERSION,
  configSchema,
  actions,
  async start(ctx) {
    resetAll();
    ctxRef = ctx;
    const bad = configure(ctx);
    if (bad) {
      shutdown();
      phase = "error";
      problem = bad;
      return;
    }
    loadLinks();
    loadAuto();
    phase = "starting";
    problem = null;
    init().catch((e) => {
      ctx.log.error(`Could not start: ${e.message}`);
      setPhase("error", `Could not start: ${e.message}`);
    });
  },
  async stop() {
    resetAll();
    ctxRef = null;
    phase = "stopped";
    problem = null;
  },
  status() {
    const details = {
      workspace: opt ? opt.workspace : null,
      opencode: { connected: oc.connected, kind: oc.kind, version: oc.version, error: oc.error },
      parserError: modelError,
    };
    if (phase === "starting") return { state: "starting", message: "Reading .work.", details };
    if (phase !== "ready") return { state: phase, message: clip(problem), details };
    let message = null;
    if (modelError) message = `Could not read .work: ${modelError}`;
    else if (!oc.connected) message = oc.error || "Connecting to opencode.";
    return { state: "ready", message: clip(message), details };
  },
};

// opencode connector: the eng-agents live dashboard server as a Workshop connector. It reads .work with
// the eng-agents parser, follows opencode (1.x and 2.x), and runs pipeline commands. See README.md.
//
// The modules in lib/ are copied from eng-agents core/scripts/dashboard/server/ (README.md, Source).
// The live server's HTTP routes are the actions below; its event stream is connector events.
import fs from "node:fs";
import path from "node:path";
import { REPO_FOLDER_MAX, VERSION, configure, current, httpError, opt, shutdown, workRoot } from "./lib/context.mjs";
import { model, modelError, parserGone, refresh, resetModel, watchWork } from "./lib/model.mjs";
import { currentSession, loadLinks } from "./lib/links.mjs";
import { oc, resetState, sessions } from "./lib/opencode-state.mjs";
import { connectOpencode, disconnectOpencode } from "./lib/opencode-connect.mjs";
import { abort, answerPermission, answerQuestion, openTerminal, pushBranch, removeItem, reply, resetActions, runCommand, shellData, startItem } from "./lib/actions.mjs";
import { autopilot, autopilotAction, loadAuto } from "./lib/autopilot.mjs";
import { pageData, resetLive } from "./lib/live.mjs";
import { addRepo, dismissLoose, onboardRepo, resetWorkspace, startLocal, startDocs, startReview, startSpike, startTsd } from "./lib/workspace.mjs";
import { loadProviders } from "./lib/opencode-connect.mjs";
import { clearQueue, loadPrQueue, prReviews, resetPrQueue, reviewAll, saveInbox, stopQueue } from "./lib/pr-queue.mjs";
import { COLORS, INBOX, assignRun, createProject, deleteProject, loadProjects, resetProjects, updateProject } from "./lib/projects.mjs";
import { findItem } from "./lib/actions.mjs";
import { emitProjects } from "./lib/live.mjs";
import { loadReview, needReview, resetReview } from "./lib/review.mjs";
import { DAY, MAX_NOTES_BYTES, MAX_PACKET_BYTES, draftOneOnOne, oneOnOneResult, resetOneOnOnes, tidyOneOnOne, tidyResult } from "./lib/one-on-one.mjs";
import { HUB_ID, MAX_MESSAGE, hubResult, resetHub, runHub } from "./lib/hub.mjs";
import { MAX_PROMPT as VOICE_MAX, KINDS as VOICE_KINDS, resetVoice, runVoice, voiceResult } from "./lib/voice.mjs";
import { MAX_TEXT as CHAT_MAX, chatMessages, listChats, removeChat, renameChat, resetChats, sendChat, startChat } from "./lib/chat.mjs";
import { MAX_FILE, PM_FOLDER, approveFolder, startHandoff, startRefine, startScope, startShape, startSlice, startTriage, writePmFile } from "./lib/slate.mjs";
import { listDocs, writeWorkFile } from "./lib/docs.mjs";

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
      description: "No longer used: the connector reads .work itself since 1.6.0. Kept so saved settings stay valid.",
      pattern: "^[^\"&|<>^%\\r\\n]*$",
    },
    hiddenRepos: {
      type: "array",
      title: "Hidden folders",
      description: "Workspace folders Dispatch and Settings leave out, like a folder of tools you are building. \"Tools\" hides that folder and everything in it; \"Tools/workshop\" hides one repo. Up to 4 folders deep.",
      "x-workshop-page": "repos",
      "x-workshop-hosted": true,
      maxItems: 200,
      items: { type: "string", pattern: "^[^/\\\\]{1,150}([/\\\\][^/\\\\]{1,150}){0,3}$" },
      uniqueItems: true,
      default: [],
    },
    engAgentsConfig: {
      type: "string",
      title: "Tandem config.json",
      description: "Used only to build work item links. Leave empty for ~/.config/eng-agents/config.json (Tandem's default).",
    },
    prReviews: {
      type: "object",
      title: "AI first-pass reviews",
      "x-workshop-page": "pull-requests",
      additionalProperties: false,
      properties: {
        nightlyAt: {
          type: "string",
          title: "Nightly review time (like 2:00 AM)",
          description: "Each day at this time, first-pass reviews of the PRs that were waiting on you the last time Dispatch checked. If the computer was asleep, it runs when Workshop next starts that day. Default 7:00 PM. Empty: off.",
          pattern: "^(([01][0-9]|2[0-3]):[0-5][0-9]|(1[0-2]|0?[1-9]):[0-5][0-9] ?[AaPp]\\.?[Mm]?\\.?)?$",
          default: "7:00 PM",
          "x-workshop-hosted": true,
        },
        onSync: {
          type: "boolean",
          title: "Review new PRs as soon as they are found",
          description: "Each time Docket or Dispatch checks Azure DevOps, new PRs waiting on you (and PRs with a new commit) get a first-pass review right away, blocking ones first. Docket then shows them already reviewed. Drafts only, nothing is posted. Off: only Review all and the nightly run.",
          default: true,
          "x-workshop-hosted": true,
        },
      },
    },
    hub: {
      type: "boolean",
      title: "Hub",
      description: "Let the hub on Dispatch's page send your messages to Tandem's /hub (eng-agents Core 2.9.0), with your people, Docket list and team area names. Answers come from your AI provider. Off: Home's quick capture still works, with no AI.",
      default: false,
    },
    pollSeconds: {
      type: "integer",
      title: "Re-read git state every (seconds)",
      minimum: 5,
      maximum: 3600,
      default: 20,
      "x-workshop-hosted": true,
    },
    approvedProviders: {
      type: "array",
      title: "Approved AI providers",
      description: "The opencode provider ids your company allows (as in opencode's model names, provider/model). workshop doctor warns if opencode can use any other. Empty skips the check.",
      items: { type: "string", pattern: "^[A-Za-z0-9._-]{1,100}$" },
      maxItems: 20,
      uniqueItems: true,
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
  resetWorkspace();
  disconnectOpencode();
  resetModel();
  resetLive();
  resetState();
  resetActions();
  resetProjects();
  resetReview();
  resetPrQueue();
  resetOneOnOnes();
  resetHub();
  resetChats();
  resetVoice();
}

async function init() {
  const alive = current(() => true);
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

// Why Tandem's .work folder must not be edited right now, or null: its session is working or autopilot runs it.
function busyFor(folder) {
  const a = autopilot[folder];
  if (a && a.status === "running") return "Autopilot is running this item";
  const sid = currentSession(folder);
  const s = sid ? sessions.get(sid) : null;
  if (s && s.status && s.status !== "idle" && s.status !== "error") return "Tandem is working on this item";
  return null;
}

const str = (title, extra = {}) => ({ type: "string", title, maxLength: 4000, ...extra });
const obj = (required, properties) => ({ type: "object", additionalProperties: false, ...(required.length ? { required } : {}), properties });
const folder = str("Item folder", { minLength: 1, maxLength: 200 });
const workItemId = str("Work item id (a number, or L and a number for local work)", { pattern: "^([0-9]{1,10}|L[0-9]{1,10})$" });
const reviewRepo = str("Repo folder (from pr.md)", { minLength: 1, maxLength: 255 });
const sha = str("Commit sha", { pattern: "^[0-9a-f]{40}([0-9a-f]{24})?$" });
const line = { type: "integer", minimum: 1 };
const prItem = obj(["url"], {
  url: str("Pull request link", { minLength: 10, maxLength: 500 }),
  title: str("Title", { maxLength: 500 }),
  commit: str("Source commit", { maxLength: 40 }),
  waiting: { type: "boolean", title: "You voted Waiting for author" },
  id: { type: ["integer", "string"], title: "PR number (taken from the link)" },
  tier: { type: "string", title: "How much it waits on you", enum: ["blocking", "asked", "pool"] },
});
const reviewComment = obj(["id", "path", "side", "startLine", "endLine", "quotedCode", "type", "body"], {
  id: str("Comment id", { minLength: 1, maxLength: 128 }),
  path: str("File path", { minLength: 1 }),
  side: { type: "string", title: "Side", enum: ["old", "new"] },
  startLine: line,
  endLine: line,
  quotedCode: str("Quoted code", { maxLength: 100000 }),
  type: { type: "string", title: "Type", enum: ["must_fix", "suggestion", "question"] },
  body: str("Comment", { maxLength: 100000 }),
  suggestedCode: str("Proposed replacement", { maxLength: 100000 }),
});
const reviewFeedback = obj(["workItemId", "repo", "revision", "headSha", "verdict", "comments"], {
  workItemId,
  repo: reviewRepo,
  revision: line,
  headSha: sha,
  verdict: { type: "string", title: "Verdict", enum: ["approve", "request_changes"] },
  summary: str("Summary", { maxLength: 100000 }),
  comments: { type: "array", title: "Comments", maxItems: 500, items: reviewComment },
  submittedAt: str("Set by the server", { maxLength: 64 }),
});
const session = str("opencode session id", { minLength: 1, maxLength: 200 });
const oneOnOne = {
  personId: str("1:1s person id", { minLength: 1, maxLength: 60, pattern: "^[a-z0-9][a-z0-9_-]{0,59}$" }),
  date: str("Day of the 1:1 (YYYY-MM-DD)", { pattern: DAY.source }),
};
const projectId = str("Project id (Inbox when left out)", { minLength: 1, maxLength: 80 });
const projectFields = {
  name: str("Name", { minLength: 1, maxLength: 80 }),
  color: { type: "string", title: "Color", enum: COLORS },
  repo: str("Repo folder in the workspace", { maxLength: 100 }),
  baseBranch: str("Default base branch", { maxLength: 200 }),
  instructions: str("Instructions for the agent", { maxLength: 20000 }),
  model: str("opencode model override", { maxLength: 200 }),
  agent: str("opencode agent override", { maxLength: 200 }),
  tracker: str("Tracker link", { maxLength: 500 }),
};

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
      await loadProviders(); // "Check again" after connecting an AI provider
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
    argsSchema: obj(["id", "lane"], { id: str("Work item id", { pattern: "^[0-9]{1,10}$" }), lane: { type: "string", title: "Lane", enum: ["feature", "bug"] }, project: projectId }),
    async run(args) {
      needReady();
      const r = await startItem(args);
      if (args.project && args.project !== INBOX) emitProjects("run");
      return r;
    },
  },
  "start.local": {
    title: "Start work with no tracker item (describe it)",
    write: true,
    argsSchema: obj(["title", "lane"], {
      title: str("Title", { minLength: 1, maxLength: 200 }),
      description: str("Description", { maxLength: 20000 }),
      repro: str("Steps to reproduce (bugs)", { maxLength: 20000 }),
      lane: { type: "string", title: "Lane", enum: ["feature", "bug"] },
      project: projectId,
    }),
    async run(args) {
      needReady();
      const r = await startLocal(args);
      if (r.project !== INBOX) emitProjects("run");
      return r;
    },
  },
  spike: {
    title: "Start a spike (investigate, no code changes)",
    write: true,
    argsSchema: obj(["topic"], { topic: str("What to investigate", { minLength: 1, maxLength: 500 }) }),
    async run(args) {
      needReady();
      return startSpike(args);
    },
  },
  // Dispatch's Write docs and Technical spec flows. Each runs one Tandem command in a new session, like a spike.
  "docs.start": {
    title: "Draft or update documentation from the code (/docs, then fact-check with /check-docs)",
    write: true,
    argsSchema: obj(["target"], { target: str("What to document", { minLength: 1, maxLength: 500 }) }),
    async run(args) {
      needReady();
      return startDocs(args);
    },
  },
  "tsd.start": {
    title: "Draft a technical spec with diagrams for a product or repos (/tsd)",
    write: true,
    argsSchema: obj(["target"], { target: str("A product name from the repo map, or repo folders separated by spaces", { minLength: 1, maxLength: 300 }) }),
    async run(args) {
      needReady();
      return startTsd(args);
    },
  },
  // Slate's PM steps (lib/slate.mjs). Each runs a Tandem command in a new session, like a spike.
  "triage.start": {
    title: "Triage a request (/triage, writes triage.md, never posts)",
    write: true,
    argsSchema: obj([], { id: str("ADO work item id", { pattern: "^[0-9]{1,10}$" }), text: str("The request in words (when there is no ADO item), or a note to go with the ADO id (Core 2.18.0 keeps it in note.md)", { maxLength: 2000 }), folder: str("A triage-<name> folder to triage again", { maxLength: 100 }) }),
    async run(args) {
      needReady();
      return startTriage(args);
    },
  },
  "shape.start": {
    title: "Shape an idea with you, a round of questions at a time (/shape, writes questions.md and brief.md)",
    write: true,
    argsSchema: obj([], {
      idea: str("The idea", { maxLength: 4000 }),
      from: str("A triage-<name> folder to start from", { maxLength: 100 }),
      folder: str("A shape-<name> folder: run the next round", { maxLength: 100 }),
      mode: { type: "string", title: "With a folder: brief (write the brief now) or more (ask another round)", enum: ["brief", "more"] },
    }),
    async run(args) {
      needReady();
      return startShape(args);
    },
  },
  "scope.start": {
    title: "Scope an idea into an epic, features and stories (/scope)",
    write: true,
    argsSchema: obj([], { idea: str("The idea", { maxLength: 4000 }), from: str("A shape-<name> folder whose brief to scope", { maxLength: 100 }), folder: str("A scope-<name> folder to revise", { maxLength: 100 }) }),
    async run(args) {
      needReady();
      return startScope(args);
    },
  },
  "slice.start": {
    title: "Slice approved stories into build-ordered milestones (/slice)",
    write: true,
    argsSchema: obj(["folder"], { folder: str("The scope-<name> folder", { minLength: 1, maxLength: 100 }) }),
    async run(args) {
      needReady();
      return startSlice(args);
    },
  },
  "refine.start": {
    title: "Define one story or bug (/refine, writes refine.md)",
    write: true,
    argsSchema: obj([], {
      title: str("Title", { maxLength: 200 }),
      description: str("What is known so far", { maxLength: 4000 }),
      parent: str("Parent work item id", { pattern: "^[0-9]{1,10}$" }),
      from: str("A shape-<name> folder whose brief to refine", { maxLength: 100 }),
      folder: str("A refine-<name> folder to revise", { maxLength: 100 }),
    }),
    async run(args) {
      needReady();
      return startRefine(args);
    },
  },
  "handoff.start": {
    title: "Write a brief for the person work is delegated to (/handoff, posts nothing)",
    write: true,
    argsSchema: obj(["id", "assignee"], { id: workItemId, assignee: str("Who it goes to", { minLength: 1, maxLength: 200 }) }),
    async run(args) {
      needReady();
      return startHandoff(args);
    },
  },
  approve: {
    title: "Approve a scope's stories or milestones, or a refined story (/approve)",
    write: true,
    argsSchema: obj(["folder"], { folder: str("A scope-<name> or refine-<name> folder", { minLength: 1, maxLength: 100 }), what: { type: "string", title: "For a scope: which file", enum: ["stories", "milestones"] } }),
    async run(args) {
      needReady();
      return approveFolder(args);
    },
  },
  "file.write": {
    title: "Write a Markdown file at the top of a .work folder",
    write: true,
    argsSchema: obj(["folder", "file", "text"], {
      folder: str("A .work folder", { minLength: 1, maxLength: 200 }),
      file: str("File (.md, at the top of the folder)", { minLength: 4, maxLength: 85 }),
      text: str("The new text", { maxLength: MAX_FILE }),
      expected: str("The text you read (omit to create the file)", { maxLength: MAX_FILE }),
    }),
    async run(args) {
      needReady();
      // Slate's PM folders keep their own rules; any other folder is Notebook's and Dispatch's editor (lib/docs.mjs).
      if (PM_FOLDER.test(String(args.folder || ""))) return writePmFile(args);
      return writeWorkFile(args, { root: workRoot, busyFor });
    },
  },
  "docs.list": {
    title: "List Tandem's .work documents",
    write: false,
    async run() {
      needReady();
      return listDocs(model, busyFor, workRoot);
    },
  },
  "pr.review": {
    title: "Review a teammate's pull request (first pass, drafts only)",
    write: true,
    argsSchema: obj(["url"], { url: str("Pull request link", { minLength: 10, maxLength: 500 }), again: { type: "boolean", title: "Review again even if this commit was reviewed" } }),
    async run(args) {
      needReady();
      return startReview({ url: args.url, again: args.again === true });
    },
  },
  "pr.reviewAll": {
    title: "Review pull requests one at a time (first pass, drafts only)",
    write: true,
    argsSchema: obj([], {
      prs: {
        type: "array",
        title: "Pull requests (empty resumes a paused or stopped queue)",
        maxItems: 25,
        items: prItem,
      },
    }),
    async run(args) {
      needReady();
      return reviewAll({ prs: args.prs || [] });
    },
  },
  "pr.queue.stop": {
    title: "Stop the PR review queue after the review that is running",
    write: false,
    argsSchema: obj([], {}),
    async run() {
      needReady();
      return stopQueue();
    },
  },
  "pr.queue.clear": {
    title: "Forget the last PR review queue's results",
    write: false,
    argsSchema: obj([], {}),
    async run() {
      needReady();
      return clearQueue();
    },
  },
  "pr.reviews": {
    title: "Where each PR's first-pass review stands",
    write: false,
    argsSchema: obj(["ids"], { ids: { type: "array", maxItems: 200, items: { type: ["integer", "string"], title: "PR number" } } }),
    async run(args) {
      needReady();
      return prReviews(args);
    },
  },
  "pr.inbox.save": {
    title: "Remember the PRs waiting on you (nightly review, and reviews as soon as they are found)",
    write: false,
    argsSchema: obj(["prs"], { prs: { type: "array", maxItems: 200, items: prItem } }),
    async run(args) {
      needReady();
      return saveInbox(args);
    },
  },
  "oneonone.draft": {
    title: "Draft 1:1 talking points from a packet (/one-on-one, drafts only)",
    write: true,
    argsSchema: obj(["personId", "date", "packet"], { ...oneOnOne, packet: str("The prep packet (Markdown)", { minLength: 1, maxLength: MAX_PACKET_BYTES }) }),
    async run(args) {
      needReady();
      return draftOneOnOne(args);
    },
  },
  "oneonone.result": {
    title: "The 1:1 talking points draft, if it is ready",
    write: false,
    argsSchema: obj(["personId", "date"], oneOnOne),
    async run(args) {
      needReady();
      return oneOnOneResult(args);
    },
  },
  "oneonone.tidy": {
    title: "Tidy a 1:1 note's rough lines into follow-ups and wins (people-prep, drafts only)",
    write: true,
    argsSchema: obj(["personId", "date", "notes"], { ...oneOnOne, notes: str("The note's rough lines (Markdown)", { minLength: 1, maxLength: MAX_NOTES_BYTES }) }),
    async run(args) {
      needReady();
      return tidyOneOnOne(args);
    },
  },
  "oneonone.tidyResult": {
    title: "The tidied 1:1 note, if it is ready",
    write: false,
    argsSchema: obj(["personId", "date"], oneOnOne),
    async run(args) {
      needReady();
      return tidyResult(args);
    },
  },
  "hub.run": {
    title: "Send a hub message to Tandem (/hub, read only)",
    write: true,
    argsSchema: obj(["id", "text"], {
      id: str("Hub request id", { pattern: HUB_ID.source }),
      text: str("The message", { minLength: 1, maxLength: MAX_MESSAGE }),
      context: {
        type: "object",
        title: "Names Tandem may use",
        additionalProperties: false,
        properties: {
          people: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: {
            id: str("Person or group id", { minLength: 1, maxLength: 110 }), name: str("Name", { minLength: 1, maxLength: 200 }),
            handle: str("Handle", { maxLength: 40 }), kind: { type: "string", title: "Kind", enum: ["person", "group"] },
            relation: { type: "string", title: "Relation", enum: ["self", "report", "manager", "peer", "contact"] }, team: { type: "boolean", title: "On my team" },
            members: { type: "array", title: "Group members", maxItems: 200, items: str("Person id", { maxLength: 110 }) } } } },
          lists: { type: "array", maxItems: 200, items: str("Docket list", { maxLength: 120 }) },
          areas: { type: "array", maxItems: 200, items: str("Team area path", { maxLength: 300 }) },
        },
      },
    }),
    async run(args) {
      needReady();
      return runHub(args, { config: ctxRef && ctxRef.config });
    },
  },
  "hub.result": {
    title: "What Tandem made of a hub message, if it is ready",
    write: false,
    argsSchema: obj(["id"], { id: str("Hub request id", { pattern: HUB_ID.source }) }),
    async run(args) {
      needReady();
      return hubResult(args, { config: ctxRef && ctxRef.config });
    },
  },
  "voice.run": {
    title: "Writing: run one voice step (style guide, rewrite or learn) with the read-only plan agent",
    write: true,
    argsSchema: obj(["kind", "prompt"], {
      kind: { type: "string", title: "Step", enum: VOICE_KINDS },
      prompt: str("The whole prompt, built by Settings", { minLength: 1, maxLength: VOICE_MAX }),
    }),
    async run(args) {
      needReady();
      return runVoice(args, { config: ctxRef && ctxRef.config });
    },
  },
  "voice.result": {
    title: "Writing: the reply of a voice step, if it is ready",
    write: false,
    argsSchema: obj(["session"], { session }),
    async run(args) {
      needReady();
      return voiceResult(args, { config: ctxRef && ctxRef.config });
    },
  },
  "chat.start": {
    title: "Start a chat with Tandem (read-only chat agent)",
    write: true,
    argsSchema: obj(["text"], { text: str("The first message", { minLength: 1, maxLength: CHAT_MAX }) }),
    async run(args) {
      needReady();
      return startChat(args, { config: ctxRef && ctxRef.config });
    },
  },
  "chat.send": {
    title: "Send the next message in a hub thread or chat (read-only chat agent)",
    write: true,
    argsSchema: obj(["session", "text"], { session, text: str("The message", { minLength: 1, maxLength: CHAT_MAX }) }),
    async run(args) {
      needReady();
      return sendChat(args, { config: ctxRef && ctxRef.config });
    },
  },
  "chat.messages": {
    title: "The turns of a hub thread or chat",
    write: false,
    argsSchema: obj(["session"], { session }),
    async run(args) {
      needReady();
      return chatMessages(args, { config: ctxRef && ctxRef.config });
    },
  },
  "chat.list": {
    title: "Chats: everything from the hub that is not a capture or go, and chats you started",
    write: false,
    argsSchema: obj([], { hubs: { type: "boolean", title: "Recent hub threads instead" } }),
    async run(args) {
      needReady();
      return listChats({ config: ctxRef && ctxRef.config, hubs: !!(args && args.hubs) });
    },
  },
  "chat.remove": {
    title: "Stop listing a chat (the opencode session is kept)",
    write: false,
    argsSchema: obj(["session"], { session }),
    async run(args) {
      needReady();
      return removeChat(args, { config: ctxRef && ctxRef.config });
    },
  },
  "chat.rename": {
    title: "Rename a chat in Dispatch's list (the opencode session keeps its title)",
    write: false,
    argsSchema: obj(["session", "title"], { session, title: str("New name", { minLength: 1, maxLength: 80 }) }),
    async run(args) {
      needReady();
      return renameChat(args, { config: ctxRef && ctxRef.config });
    },
  },
  "repo.add": {
    title: "Clone a repo into the workspace",
    write: true,
    argsSchema: obj(["url"], { url: str("Git clone URL", { minLength: 4, maxLength: 500 }), about: str("What it is, in one line", { maxLength: 200 }), category: str("Category folder to clone into, such as Platform or Platform/Lighthouse (empty: the top of the workspace)", { maxLength: REPO_FOLDER_MAX }) }),
    async run(args) {
      needReady();
      return addRepo(args);
    },
  },
  "repo.guide": {
    title: "Draft a repo's guide (/onboard-repo)",
    write: true,
    argsSchema: obj(["repo"], { repo: str("Repo folder (repo, or Category/repo up to 4 folders deep)", { minLength: 1, maxLength: REPO_FOLDER_MAX }) }),
    async run(args) {
      needReady();
      return onboardRepo(args);
    },
  },
  "session.dismiss": {
    title: "Stop showing a spike or repo guide session",
    write: false,
    argsSchema: obj(["session"], { session }),
    async run(args) {
      needReady();
      return dismissLoose(args);
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
  "project.create": {
    title: "Add a Dispatch project",
    write: true,
    argsSchema: obj(["name"], projectFields),
    async run(args) {
      needReady();
      const r = createProject(args);
      emitProjects("create");
      return r;
    },
  },
  "project.update": {
    title: "Change a Dispatch project",
    write: true,
    argsSchema: obj(["id"], { id: projectId, ...projectFields }),
    async run(args) {
      needReady();
      const r = updateProject(args);
      emitProjects("update");
      return r;
    },
  },
  "project.delete": {
    title: "Remove a Dispatch project (its runs move to Inbox)",
    write: true,
    argsSchema: obj(["id"], { id: projectId }),
    async run(args) {
      needReady();
      const r = deleteProject(args);
      emitProjects("delete");
      return r;
    },
  },
  "run.assign": {
    title: "Move a run to a project",
    write: true,
    argsSchema: obj(["folder", "project"], { folder, project: projectId }),
    async run(args) {
      needReady();
      const r = assignRun(args, (f) => !!findItem(f));
      emitProjects("run");
      return r;
    },
  },
  "review.session": {
    title: "Code review: the diff to review for one repo of a work item",
    write: false,
    argsSchema: obj(["id", "repo"], { id: workItemId, repo: reviewRepo }),
    async run(args) {
      needReady();
      return needReview().getSession(args.id, args.repo);
    },
  },
  "review.file": {
    title: "Code review: one file's text at the base, head, or last reviewed commit",
    write: false,
    argsSchema: obj(["id", "repo", "path", "side"], {
      id: workItemId,
      repo: reviewRepo,
      path: str("File path", { minLength: 1 }),
      side: { type: "string", title: "Side", enum: ["old", "new", "prev"] },
    }),
    async run(args) {
      needReady();
      return needReview().getFile(args.id, args.repo, args.path, args.side);
    },
  },
  "review.submit": {
    title: "Code review: approve, or request changes from the agent",
    write: true,
    argsSchema: obj(["id", "repo", "feedback"], { id: workItemId, repo: reviewRepo, feedback: reviewFeedback }),
    async run(args) {
      needReady();
      return needReview().submit(args.id, args.repo, args.feedback);
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
    loadProjects();
    loadReview();
    loadPrQueue();
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
    await parserGone(); // a parser still running holds the workspace folder open on Windows
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

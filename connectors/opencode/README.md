# opencode connector

The eng-agents live dashboard server, moved into Workshop as a connector. It reads `.work` with the eng-agents parser, follows opencode (1.x and 2.x), and runs pipeline commands for the Agents app (WS6) and Prioritizer.

Node standard library only. It calls only opencode on this computer (`127.0.0.1`, `localhost` or `[::1]`) and runs `git`, PowerShell and the `opencode` command locally.

## Source

Copied from [adavidson21/eng-agents](https://github.com/adavidson21/eng-agents) `main` at `e2d202abf5223e74d3af942fcd8ff56bd12cf811` (Core 2.1.0, Dashboard 1.6.1). Later Dashboard releases are synced as listed in PARITY.md.

| eng-agents | Here |
| --- | --- |
| `core/scripts/dashboard/server/*.mjs` (all but `updates.mjs`) | `lib/` |
| `core/scripts/dashboard/New-Dashboard.ps1` | `parser/New-Dashboard.ps1`, unchanged. Synced again from eng-agents Dashboard 1.9.0 (Core 2.6.0): scope folders and PR reviews. |
| `core/scripts/dashboard/live-server.mjs` routes | actions and events in `index.mjs` |

The first commit on the WS3 branch is the verbatim copy, so `git diff` against it shows every change. Each file in `lib/` says what changed at the top.

## Requirements

- PowerShell: `pwsh` (PowerShell 7) or Windows PowerShell. The connector runs `New-Dashboard.ps1 -AsJson` to read `.work`, as the live server did. On a Mac this means installing `pwsh` until the parser is ported to JavaScript (roadmap F10).
- opencode 1.x or 2.x, and eng-agents installed in it (the `/start`, `/do-task` and other commands).
- `git`, for Push.

## Settings

`connectors.opencode.config` in `~/.workshop/config.json`, edited in the Settings app (the form comes from `configSchema` in `index.mjs`).

| Setting | Default | Live server option | Meaning |
| --- | --- | --- | --- |
| `workspace` | required | `--workspace` | The folder that holds `.work` and your repos. `~` is your home folder. |
| `opencode.url` | found | `--opencode` | Empty: opencode 2.x's background service (`opencode service start`), else 1.x on `http://127.0.0.1:4096`. Must be on this computer. |
| `opencode.command` | `opencode` | `--opencode-cmd` | |
| `opencode.startServer` | `true` | `--no-start-opencode` | 2.x: `opencode service start`. 1.x: `opencode serve`, stopped again when the connector stops. |
| `opencode.passwordEnv` | `OPENCODE_SERVER_PASSWORD` | the same variable | 2.x only, and only if the password is not in opencode's `service.json`. |
| `opencode.usernameEnv` | `OPENCODE_SERVER_USERNAME` | the same variable | 2.x only. Not set means `opencode`. |
| `powershell` | `pwsh`, else `powershell` | `--ps` | |
| `engAgentsConfig` | `~/.config/eng-agents/config.json` (the parser's default) | `--config` | Read by the parser only, for work item links. |
| `pollSeconds` | `20` | `--poll` | How often to read `.work` again (git state changes do not trigger the file watcher). |
| `approvedProviders` | `[]` | | The opencode provider ids your company allows. `workshop doctor` checks opencode against them (below). Changed only from Workshop on this computer. |
| `prReviews.nightlyAt` | `7:00 PM` | (new) | Local time, like `2:00 AM` (`02:00` works too). Each day at this time the PR review queue reviews the PRs that were waiting on you the last time Dispatch checked (see PR review queue below). Empty turns it off. Hosted pages may change it. |
| `prReviews.onSync` | `true` | (new) | Each time an app saves the PRs waiting on you (`pr.inbox.save`, after Docket or Dispatch checks Azure DevOps), new PRs and PRs with a new commit are queued for `/pr-review` at once, blocking tier first. A PR is queued once per commit, so a failed review is not retried on every check. Docket shows the result on its PR tasks (`pr.reviews`). Off: only Review all and the nightly run. Hosted pages may change it. |
| `hub` | `false` | (new) | Lets the hub on Dispatch's page send messages to Tandem's `/hub` (see The hub). Changed only from Workshop on this computer. |

The password is read through `ctx.env` and only sent to opencode. It is never logged, returned or emitted.

A bad setting (no `.work` in the workspace, a URL on another computer, no PowerShell) shows in the connector's status with what to fix. It never stops the agent.

## Approved AI providers

Dispatch sends work to whatever AI provider opencode uses, so at work that should be only the provider your company approved. With `approvedProviders` set, `workshop doctor` (`connectors/opencode/lib/providers.mjs`) reads opencode's config the way opencode merges it (global `~/.config/opencode/opencode.json[c]`, `OPENCODE_CONFIG`, the workspace's `opencode.json[c]` and `.opencode/opencode.json[c]`, `OPENCODE_CONFIG_CONTENT`, and the managed folder) and its saved logins (`~/.local/share/opencode/auth.json`), and fails when:

- `enabled_providers` is not set. Without it opencode loads any provider it finds, including one with an API key in an environment variable. Doctor says what to add.
- `enabled_providers` lists a provider that is not approved, or `model`, `small_model` or an agent's `model` uses one.
- A saved login or provider setting for an unapproved provider is not blocked by `enabled_providers` (when it is blocked, doctor only notes it).

Doctor prints provider ids only, never keys, URLs or other values from those files. The check reads files; it cannot see providers a running opencode was started with by other means, so keep `enabled_providers` in the global config.

## Actions

Call with `POST /api/connectors/opencode/<action>` and `{"args": {...}}` (write actions also need `"confirm": true`), or `connectors.call('opencode', action, args)` from the SDK.

| Action | Write | Args | Live server route | Result |
| --- | --- | --- | --- | --- |
| `status` | no | | `GET /api/shell/status` | The shell API 1 shape, unchanged: `{app: "eng-agents-dashboard", api: 1, version, workspace, opencode, error, items[]}`. Each item has `stage`, `next` (with `text`), `busy`, `waiting`, `autopilot`. `version` is the connector's. |
| `state` | no | | the page data | Everything the dashboard page got: the parser's model (items, repos, activity, `stepWords`, PR text), `projects` (see Projects), plus `liveMode.live` (sessions, prompts, questions, autopilot, `canOpenTerminal`, `others`, and `opencode.ai`: `{known, providers}`, the AI providers opencode can use, or `known: false` when this opencode does not say) and `tandem.ado` (whether Tandem has ADO connections set up). |
| `refresh` | no | | `POST /api/refresh` | Reads `.work` again and asks opencode for its AI providers again. `{ok, error}`. |
| `file.read` | no | `folder`, `file` | `GET /files/<folder>/<file>` | `{folder, file, text}`. Only `.work/<folder>/<name>.md`. |
| `run` | yes | `folder`, `command` | `POST /api/run` | Runs a pipeline command (`/plan 41207`) in the item's session; `/do-task` and `/check-docs` get a new one. `{session}`. |
| `start` | yes | `id`, `lane` (`feature` or `bug`), optional `project` | `POST /api/shell/start` | Runs `/start <id> <lane>` in a new session. With `project`, the run joins it once its `.work` folder exists. |
| `start.local` | yes | `title`, `lane`, optional `description`, `repro`, `project` | (new) | Work with no tracker item: writes `.work/L<n>-<name>/workitem.md` (same shape as eng-agents `New-LocalWorkItem.ps1`; numbers are never reused, see `.work/.local-ids`), then runs `/start L<n> <lane>` in a new session. With `project`, the project's instructions, repo and base branch go under "Extra context from the engineer" and the run joins the project. `{id, folder, session, project}`. |
| `spike` | yes | `topic` | (new) | Runs `/spike <topic>` in a new session. Until its `spike-*` folder exists, the session is listed in `liveMode.live.others`. `{session}`. |
| `triage.start` | yes | `id` (an ADO work item), `text` (the request in words), or `folder` (a `triage-<name>` to triage again after the requester answered) | (new) | Slate. Runs `/triage` (eng-agents Core 2.12.0) in a new session, linked to its `.work/triage-*` folder once it exists. Writes `triage.md`; never posts. `{session, folder}`; `folder` is null for words until the agent names it: follow the session in `state` (`liveMode.live.items`). |
| `scope.start` | yes | `idea`, or `folder` (a `scope-<name>` to revise) | (new) | Slate. Runs `/scope` in a new session, linked to the new `scope-*` folder. `{session, folder}` (`folder` is null for a new idea until it exists: follow the session in `state`). |
| `slice.start` | yes | `folder` (`scope-<name>`) | (new) | Slate. Runs `/slice <folder>` in a new session. `{session, folder}`. |
| `refine.start` | yes | `title`, optional `description`, `parent` (ADO id); or `folder` (a `refine-<name>` to revise) | (new) | Slate. Runs `/refine` (Core 2.12.0) in a new session, linked to the new `refine-*` folder once the agent makes it. `{session, folder}` (`folder` is null for a new story until then). |
| `handoff.start` | yes | `id`, `assignee` | (new) | Slate. Runs `/handoff <id> <assignee>` (Core 2.12.0) in a new session, linked to `.work/handoff-<id>/`. Posts nothing. `{session, folder}`. |
| `approve` | yes | `folder` (`scope-*` or `refine-*`), optional `what` (`stories` or `milestones`, for a scope) | (new) | Slate. Runs `/approve <folder> [what]` in a new session, so the PM steps need no typed commands. The command may ask about open questions first. `{session, folder}`. |
| `file.write` | yes | `folder`, `file`, `text`, optional `expected` | (new) | Slate's panel edits and a triage's `answers.md`. Writes one `.md` file at the top of a `triage-`, `scope-`, `refine-` or `handoff-` folder, up to 200 KB. `expected` is the text you read; without it the file must not exist. If the file is not what you read, 409 and nothing is written. `{folder, file, size}`. |
| `pr.review` | yes | `url` (an ADO pull request link), optional `again` | (new) | Runs `/pr-review <link>` (eng-agents Core 2.6.0) in a new session: a first-pass review of a teammate's PR that writes draft comments to `.work/pr-<id>/review.md` and never posts. Listed in `liveMode.live.others` until its `pr-<id>` folder exists, so a failure before that (repo not cloned, ADO not set up) still shows. Refused while a review of the same PR is running. `again` reviews a commit that was already reviewed. `{session}`. The parser reads `pr-<id>` folders as `kind: "pr"` with `items[].prReview` (recommendation, risk, counts, comments, questions). |
| `pr.reviewAll` | yes | `prs`: up to 25 of `{url, title?, commit?, waiting?}` | (new) | Queues the PRs for `/pr-review`, run one at a time, each in a new session (see PR review queue). Skips PRs you voted Waiting for author on, ones already queued, and ones whose review in `.work` is at `commit`. Adds to the end of a running queue. Empty `prs` resumes a paused or stopped queue. `{added: [ids], skipped: [{id, reason}]}`. |
| `pr.reviews` | no | `ids`: up to 200 PR numbers | (new) | Where each PR's first-pass review stands: `{onSync, ready, prs: [{id, state, message, session, reviewedCommit, recommendation, risk, counts: {blocking, shouldFix, optional}}]}`. `state`: `queued`, `running`, `done`, `asking`, `failed`, `skipped` or `none` (never queued and no review in `.work`). The review fields are set only when `done`. |
| `pr.queue.stop` | no | | (new) | Stops the queue after the review that is running; the rest are skipped. |
| `pr.queue.clear` | no | | (new) | Forgets the last run's results. Refused (`conflict`) while the queue runs. |
| `pr.inbox.save` | no | `prs`: up to 200, same shape plus optional `tier` (`blocking`, `asked`, `pool`) | (new) | Remembers the PRs waiting on you for the nightly review, and with `prReviews.onSync` queues new PRs and new commits right away. Dispatch and Docket call it after each ADO sync. `{ok, count, queued: [ids]}`. |
| `oneonone.draft` | yes | `personId`, `date` (`YYYY-MM-DD`), `packet` (Markdown, up to 50 KB) | (new) | The 1:1s app's optional draft step (see 1:1 drafts). Saves `packet` as `packet.md` in this connector's own folder, removes an earlier `draft.md`, and runs `/one-on-one <path to packet.md>` (eng-agents Core 2.8.0) in a new session, listed in `liveMode.live.others`. Refused (`conflict`) while a draft for the same person and day runs. `{session, folder}`. |
| `oneonone.result` | no | `personId`, `date` | (new) | `{state}`: `none` (never asked), `running`, `done` with `text` (the `draft.md` the agent wrote), or `failed` with `error`. |
| `hub.run` | yes | `id` (`hub_...`), `text` (up to 4000 characters), optional `context` (`people` `[{id, name, relation?, team?}]`, `lists`, `areas`: names only) | (new) | The hub on Dispatch's page (see The hub). Refused unless the `hub` setting is on. Saves `request.md` in this connector's own folder, removes an earlier `route.json` and `answer.md`, and runs `/hub <path to request.md>` (eng-agents Core 2.9.0) in a new session. Refused (`conflict`) while the same id runs. Keeps the newest 200 request folders. `{session, id}`. |
| `hub.result` | no | `id` | (new) | `{state}`: `none`, `running` (with `route` once written), `routed` (`route`, no answer), `done` (`route` and `answer`), or `failed` with `error`. `route` is `route.json` as written; Dispatch checks it against `docs/schemas/hub-route.schema.json`. |
| `repo.add` | yes | `url`, optional `about` | (new) | `git clone` into the workspace (no terminal prompts; credential helpers still work), then adds a row to the repo map (`AGENTS.md` in the workspace, created if missing). `{folder, repoMap: "created" | "added" | "listed"}`. |
| `repo.guide` | yes | `repo` (a folder in the workspace) | (new) | Runs `/onboard-repo <repo>` in a new session, listed in `liveMode.live.others`. `{session}`. |
| `session.dismiss` | no | `session` | (new) | Stops listing a spike or repo guide session in `others`. The opencode session is kept. |
| `reply` | yes | `session`, `text` | `POST /api/reply` | Sends text to the session; a `/command` runs in the item's pipeline. |
| `answer` | yes | `kind` (`permission` or `question`), `id`, then `reply` (`once`, `always`, `reject`) or `answers` / `reject` | `POST /api/permission`, `POST /api/question` | |
| `abort` | yes | `session` | `POST /api/abort` | |
| `remove` | yes | `folder`, `confirm` (the item id typed, or the folder name for spikes, docs and TSDs) | `POST /api/remove` | Deletes the item's `.work` folder, session links and autopilot state. Repos, branches and opencode sessions are left alone. `{ok, removed}`. Refused while the agent or autopilot is working on it. |
| `push` | yes | `folder`, `repo` | `POST /api/push` | `git -C <repo> push -u origin <branch>` for the branch in `pr.md`. Never `main`, `master`, `develop`, `dev` or the PR's target branch, never `--force`, only repo folders inside the workspace. |
| `autopilot` | yes | `folder`, `action` (`start`, `approve-start`, `resume`, `stop`, `dismiss`) | `POST /api/autopilot` | |
| `project.create` | yes | `name`, optional `color`, `repo`, `baseBranch`, `instructions`, `model`, `agent`, `tracker` | (new) | Adds a Dispatch project. `repo` must be a folder in the workspace. `{project}`. |
| `project.update` | yes | `id`, then any field above (an empty string clears it, except `name`) | (new) | `{project}`. Inbox cannot be changed. |
| `project.delete` | yes | `id` | (new) | Removes the project; its runs move to Inbox. `.work` folders are not touched. `{ok, movedToInbox}`. |
| `run.assign` | yes | `folder`, `project` (`inbox` for none) | (new) | Moves a run to a project. `{folder, project}`. |
| `review.session` | no | `id`, `repo` | (new) | The `ReviewSession` for one repo of a work item. See [Code review](#code-review). |
| `review.file` | no | `id`, `repo`, `path`, `side` (`old`, `new` or `prev`) | (new) | `FileContent` for one file. |
| `review.submit` | yes | `id`, `repo`, `feedback` (a `ReviewFeedback`) | (new) | Approve (records the verdict only, nothing is pushed) or request changes (the agent revises). `{ok, status, revision, submittedAt}`. |
| `terminal` | no | `session` (optional) | `POST /api/terminal` | Opens the opencode TUI in a terminal window (Windows and macOS). Not marked write: it changes nothing outside this computer. |

Errors are plain words with a code: `bad_request`, `not_found`, `conflict` (for example, autopilot is running the item), `unavailable` (opencode is not connected, or the connector is not ready). The live server's `501` becomes `bad_request` and its `502` becomes `unavailable`, since the agent API has no codes for those.

## Events

The live server pushed the whole page model on its own event stream. Connector events must stay small (`docs/connector.md`), so they say what changed and the app calls `state` or `status` for the data.

| Event | Payload | When |
| --- | --- | --- |
| `model` | `{generated, items, error}` | `.work` was read again. |
| `live` | `{connected, error, busy, waiting, autopilot}` | opencode state changed (batched every 200 ms, as before). |
| `agent.waiting` | `{folder, session, kind, question}` | A new permission prompt or question. |
| `agent.done` | `{folder, session, error}` | A session tied to a work item finished a turn. |
| `autopilot` | `{folder, status, message}` | Autopilot started, resumed, waits for you, finished or stopped. |
| `projects` | `{change}` (`create`, `update`, `delete`, `run`) | A project or a run's project changed. Call `state` for the data. |
| `review` | `{id, folder, repo, status, revision}` | A code review got a verdict, or its revision run started, failed or finished. Call `review.session` for the data. |
| `prQueue` | `{status, counts}` | The PR review queue changed. Call `state` for `liveMode.live.prQueue`. |

## Projects

Dispatch groups runs (the `.work` items) into projects. They are kept in `.work/_dashboard/projects.json`, next to `sessions.json`, so they never leave this computer (`lib/projects.mjs`). Folders and pins in Dispatch's sidebar are view state and stay in the browser.

`state.projects`: `{inbox: "inbox", colors: [...], projects: [{id, name, color, repo, baseBranch, instructions, model, agent, tracker, created, builtIn}], runs: {"<folder>": "<project id>"}}`. Inbox is always first; any run not in `runs` is in Inbox. One repo per project for now.

Project instructions reach the agent through `workitem.md` for runs started with `start.local`. Runs started from an ADO item (`start`) join the project, but `/start` writes their `workitem.md` itself, so the instructions are not added there yet. `model` and `agent` are stored for later; runs do not use them yet.

Status `details`: `{workspace, opencode: {connected, kind, version, error}, parserError}`.

## 1:1 drafts

Rapport's 1:1s (`js/oneonones/` in [adavidson21/receipts](https://github.com/adavidson21/receipts); 1:1s was its own app until Rapport 2.0.0) can ask your opencode agents for draft talking points. `lib/one-on-one.mjs` keeps this away from your code: the packet holds people data, so it is saved in `<Workshop home>/data/_connectors/opencode/oneonones/<personId>-<date>/packet.md` (the same folder as this connector's `ctx.storage`), never in the workspace or `.work`. Tandem's `/one-on-one` (agent **people-prep**) reads it and writes `draft.md` next to it, and may edit nothing else. The app leaves out the person's name, and concerns from receipts unless the person asks for them on that run. The session shows in Dispatch with the others, so a permission prompt can be answered there.

## Slate

Slate (`apps/slate/`) takes a request from intake to a decision: delegate it or build it yourself. Its PM steps are the actions `triage.start`, `scope.start`, `slice.start`, `refine.start`, `handoff.start`, `approve` and `file.write` (`lib/slate.mjs`, not part of the copy from eng-agents). Each runs one Tandem command in a new session, like a spike, and links the session to its `.work/triage-*`, `scope-*`, `refine-*` or `handoff-*` folder once that folder exists, so it shows in `state` (`liveMode.live.items`, `sessions`, `questions`) and its files can be read with `file.read`. A question or permission prompt from one of these sessions is answered in Dispatch, as for a spike. `file.write` writes only a `.md` file at the top of one of those four kinds of folder, and only over the text you read. None of them talks to Azure DevOps or git: Slate creates and changes work items through the ADO connector, with a confirm.

## The hub

Dispatch's hub (`apps/agents/js/hub.js`, Workshop `docs/hub.md`) sends each message to Tandem's `/hub` (agent **hub**). `lib/hub.mjs` keeps it away from your code: the message and the names it may use (people directory, Docket lists, team area paths) are saved as `<Workshop home>/data/_connectors/opencode/hub/<id>/request.md`, never in the workspace or `.work`. The hub agent writes `route.json` and, for a question, `answer.md` next to it, and may edit nothing else; it runs only read-only commands and cannot fetch web pages.

The **Hub** setting (`hub`, off by default) turns this on. It is not marked `x-workshop-hosted`, so only Workshop on this computer can turn it on; a paired site cannot. While it is off, both actions answer `unavailable` and Dispatch's hub captures with simple rules instead, like Home's quick capture. Hub sessions are listed in Dispatch only while they wait for you (a permission or a question).
## PR review queue

*Review all* in Dispatch and the optional nightly review run Tandem's `/pr-review` (eng-agents Core 2.6.0) on several pull requests, one at a time, so they never compete for opencode or your git clones. The queue lives in the connector (`lib/review-queue.mjs`, wired by `lib/pr-queue.mjs`) and is saved in `.work/_dashboard/pr-queue.json`, so it keeps going with Dispatch closed. Like `pr.review`, it only drafts comments: nothing is posted to Azure DevOps.

- A review is done when its session goes idle and `review.md` covers the commit `Get-PullRequest.ps1` fetched. It "needs you" when the reviewer stopped to ask something (for example which repo a PR is in), and failed when its session ended with an error or it could not start. None of these stop the queue.
- opencode not connected: the queue pauses and *Resume* carries on. Workshop restarted mid-run: the queue pauses rather than start a review that may still be running in opencode; *Resume* counts a review that finished meanwhile and goes on.
- As soon as they are found (`prReviews.onSync`, on by default): each `pr.inbox.save` queues the new PRs and new commits right away, blocking first, then asked, then team only (from `tier`). A run started this way keeps the earlier run's results in the list, so `pr.reviews` can still say how they ended. Docket uses this to show PRs already reviewed and to hold lower-priority PRs until their review is done.
- Nightly: connectors do not call each other, so the opencode connector cannot ask Azure DevOps what is waiting on you. Dispatch saves the ADO connector's `sync.prs` list here each time it checks (`pr.inbox.save`), and at `prReviews.nightlyAt` the queue reviews that list. It runs once a day: if the computer was asleep at that time, it runs when Workshop next starts that day. A newly set time that has already passed today starts tomorrow. A list more than a week old is skipped with a message. PRs opened after Dispatch last checked wait until the next check.

`liveMode.live.prQueue`: `{status, source, message, started, finished, counts: {queued, running, done, asking, failed, skipped}, items: [{id, url, title, state, message, session, startedAt, endedAt}], nightly: {at, last}, inbox: {at, count}}`. `status`: `idle`, `running`, `paused`, `stopped` or `done`. `source`: `manual` or `nightly`.

## Code review

The review screen in Dispatch: the reviewer reads a branch's diff, comments on lines, and approves or sends the comments to the agent as one revision. One review per work item and repo, matching `push`. `repo` is the repo folder from the item's `pr.md`.

Copied from eng-agents branch `dev/feature/review-api` at `2626601` (the live server's `/api/shell/code-review/*` routes): `lib/review-git.mjs`, `lib/code-review.mjs`, `lib/revision-runner.mjs`. `lib/review.mjs` wires them to this connector. Errors are plain words with the usual codes; on any `conflict` from `review.submit`, reload the review.

### Types

```ts
type ReviewSession = {
  workItemId: string;
  repo: string;
  revision: number;                     // 1, 2, 3...
  branch: string;
  baseBranch: string;                   // origin/<pr.md target> if the clone has it, else <target>
  baseSha: string;                      // merge-base of baseBranch and the branch head
  headSha: string;
  status: 'awaiting_review' | 'revising' | 'approved';
  files: ChangedFile[];
  previousFeedback?: ReviewFeedback;    // revision 2 and later
  previousResponses?: ReviewResponse[]; // the agent's answers to previousFeedback
  sinceLastReview?: ChangedFile[];      // files changed from previousFeedback.headSha to headSha
  revisionRun?: { status: 'running' | 'failed' | 'done'; message: string | null; session: string | null; revision: number };
};
type ChangedFile = { path: string; oldPath?: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number; binary: boolean };
type ReviewComment = {
  id: string; path: string; side: 'old' | 'new'; startLine: number; endLine: number;
  quotedCode: string;                   // the lines at baseSha (old) or headSha (new)
  type: 'must_fix' | 'suggestion' | 'question'; body: string; suggestedCode?: string;
};
type ReviewFeedback = {
  workItemId: string; repo: string; revision: number; headSha: string;
  verdict: 'approve' | 'request_changes'; summary?: string; comments: ReviewComment[];
  submittedAt: string;                  // set by the connector when it saves
};
type ReviewResponse = { commentId: string; status: 'fixed' | 'declined' | 'answered'; note: string };
type FileContent = { kind: 'text' | 'binary' | 'too_large' | 'absent'; text?: string; size?: number };
```

### Rules

- `review.session` and `review.file` answer once the item is at the `ship` stage (pr.md is written and Push is next), and from then on whatever stage it shows. Before that: `conflict`, with the stage in the message.
- `review.file`: `old` is the file at `baseSha`, `new` at `headSha`, `prev` at the last reviewed head (revision 2 and later). Pass `oldPath` with `old` for a renamed file. `absent` is the missing side of an added or deleted file. Binary files and files over 1 MB come back without `text`.
- `review.submit` is refused with `conflict` if the branch head moved since the review loaded, the revision number is wrong, or the review is not awaiting a verdict. Nothing is saved. Request changes needs a comment or a summary, and is refused with `unavailable` while opencode is not connected.
- Comments made in the "changes since last review" view go on the `new` side.

### Revision runner

Request changes saves the feedback, sets the review to `revising`, and sends one revision prompt (the spec's template, plus the repo folder) through the same launcher as `reply`: in the item's current session if it is idle, else a new one linked to the item. When that turn ends, the runner checks that the agent wrote a valid `rev-<n>-response.json` and that the branch still contains the reviewed commit. Then the review becomes revision `n+1`, `awaiting_review`. If a check fails, it stays `revising` and `revisionRun` says why; replying to the agent in that session runs the checks again when its turn ends. Unfinished runs are followed again after a restart.

`state.reviews`: `{"<folder>": {"<repo>": {status, revision, started, run}}}` for every repo in an item's `pr.md`. `started: false` means nobody has reviewed it yet; `run` is the latest revision run or `null`. Dispatch shows it on the PR card.

### Storage

`.work/<folder>/code-review/<repo>/`: `state.json` (`{revision, status, lastReviewedHeadSha}`; missing means revision 1, awaiting review), `rev-<n>.json` (the feedback), `rev-<n>-response.json` (the agent's answers), `run.json` (the latest revision run).

## Not carried over

| Live server | Why | Where it goes |
| --- | --- | --- |
| The page (`dashboard.template.html`) and `/` | Connectors have no UI. | WS6 (Agents app) |
| Session token, `shellOrigins`, CORS, `frame-ancestors`, `Host` check | The agent does this for every connector. | WS1 (done) |
| `/api/update`, `/api/update-check`, `/api/restart` (`updates.mjs`) | Connectors make no update checks. eng-agents updates stay in eng-agents. | WS8 |
| Writing `.work/dashboard.html` | Its template is the eng-agents page. The static page still works from eng-agents' `/dashboard static`. | WS6, WS8 |
| `/api/ping`, `Start-LiveDashboard.ps1` | The agent starts and stops the connector; use `GET /api/connectors/opencode` for its status. | |
| Port 4300 | Served by the agent. | |

## Known quirks kept for parity

- The parser reads a published TSD's `Status:` line's gate value as `UNKNOWN` (`docs/work-format.md`, Known quirks), but since eng-agents Dashboard 1.7.1 the TSD's state is Published. `parser/New-Dashboard.ps1` carries the same fix; `test/parser.test.mjs` checks it.
- `/do-task` and `/check-docs` always run in a new session.
- `parser/New-Dashboard.ps1` lists `brief.md` right after `workitem.md`, as eng-agents Dashboard 1.10.1 does (PARITY.md).

## Tests

```
node --test "connectors/opencode/test/*.test.mjs"
```

- `test/fake-opencode.mjs`: fake opencode 1.x and 2.x servers on `127.0.0.1` with their event streams, built from what the adapters call. `test/harness.mjs` adds a fake `opencode` CLI (for finding the 2.x service) and copies `docs/examples/work/` into a temporary workspace. No work data.
- `review-git.test.mjs`, `code-review.test.mjs`, `revision-runner.test.mjs`: the code review modules against throwaway git repos and a fake launcher. They need only git.
- `connector.test.mjs`: every action and event against both versions, through a `ctx` like the agent's. Each test names the [PARITY.md](PARITY.md) item it covers.
- `slate.test.mjs`: Slate's PM folders and `file.write` (which folders and files, creating, the conflict check). Needs neither PowerShell nor opencode.
- `one-on-one.test.mjs`: the 1:1 draft step (`lib/one-on-one.mjs`): where the packet goes, a stale draft cleared, running, done and failed, and the action args. Needs neither PowerShell nor opencode.
- `agent.test.mjs`: the module against the connector contract, and the connector through the real agent (confirm, events, restarts on a config change, the password never in responses, events or logs).

Tests that need PowerShell or git skip with a message when they are missing. GitHub's Windows, macOS and Linux runners have both.

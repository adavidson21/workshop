# opencode connector

The eng-agents live dashboard server, moved into Workshop as a connector. eng-agents retired its own server in Core 2.11.0 (eng-agents #41), so this is the only copy; Dispatch is the one live UI (D2). It reads `.work` with the eng-agents parser, follows opencode (1.x and 2.x), and runs pipeline commands for the Agents app (WS6) and Prioritizer.

Node standard library only. It calls only opencode on this computer (`127.0.0.1`, `localhost` or `[::1]`) and runs `git` and the `opencode` command locally (and `powershell.exe` for **Open terminal** on Windows).

## Source

Copied from [adavidson21/eng-agents](https://github.com/adavidson21/eng-agents) `main` at `e2d202abf5223e74d3af942fcd8ff56bd12cf811` (Core 2.1.0, Dashboard 1.6.1). Later Dashboard releases were synced as listed in PARITY.md. eng-agents deleted `server/*.mjs` and `live-server.mjs` in Core 2.11.0, so `lib/` and `index.mjs` change here only. Only the parser still has a twin in eng-agents.

| eng-agents | Here |
| --- | --- |
| `core/scripts/dashboard/server/*.mjs` (all but `updates.mjs`), deleted in Core 2.11.0 | `lib/`, now the only copy |
| `core/scripts/dashboard/New-Dashboard.ps1`, deleted in Core 4.20.0 | `lib/workparser.mjs`, a JavaScript port (connector 1.6.0) of `parser/New-Dashboard.ps1`, which is kept for the parity test. The copy finds repos in category folders up to 4 deep (`repoCategories`, such as `Platform/Lighthouse`) and leaves out the static page's `coreVersion` and `dispatchUrl`. eng-agents deleted its copy with the static page in Core 4.20.0, so these two are the only copies: a parsing or next-step change goes into both, and `test/workparser.test.mjs` checks they agree. The next-step rules still follow eng-agents' `commands/status.md`. |
| `core/scripts/dashboard/live-server.mjs` routes, deleted in Core 2.11.0 | actions and events in `index.mjs` |

The first commit on the WS3 branch is the verbatim copy, so `git diff` against it shows every change. Each file in `lib/` says what changed at the top.

## Requirements

- No PowerShell: since 1.6.0 the connector reads `.work` itself with `lib/workparser.mjs`, a JavaScript port of `New-Dashboard.ps1 -AsJson` (it ran that script before). Tandem's own commands still use PowerShell inside opencode. `parser/New-Dashboard.ps1` stays only for `test/workparser.test.mjs`, which runs both on the same folders and fails on any difference.
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
| `powershell` | (unused) | `--ps` | No longer used since 1.6.0; kept so saved settings stay valid. |
| `hiddenRepos` | `[]` | | Workspace folders left out of `state` (`repos` and `repoCategories`), so Dispatch and Settings do not list them. A folder is hidden with everything under it: `"Tools"` or `"Platform/Lighthouse"` (a category), `"Tools/workshop"` or `"gh-repo"` (one repo), up to 4 folders deep. Case is ignored. Nothing is deleted, and items whose `repos.md` names a hidden repo still read it. Edited on Settings, Repos (Hide on a row, and Hidden folders); hosted pages may change it. Since 1.7.0. |
| `engAgentsConfig` | `~/.config/eng-agents/config.json` (the parser's default) | `--config` | Read by the parser only, for work item links. |
| `pollSeconds` | `20` | `--poll` | How often to read `.work` again (git state changes do not trigger the file watcher). |
| `approvedProviders` | `[]` | | The opencode provider ids your company allows. `workshop doctor` checks opencode against them (below). Changed only from Workshop on this computer. |
| `prReviews.nightlyAt` | `7:00 PM` | (new) | Local time, like `2:00 AM` (`02:00` works too). Each day at this time the PR review queue reviews the PRs that were waiting on you the last time Dispatch checked (see PR review queue below). Empty turns it off. Hosted pages may change it. |
| `prReviews.onSync` | `true` | (new) | Each time an app saves the PRs waiting on you (`pr.inbox.save`, after Docket or Dispatch checks Azure DevOps), new PRs and PRs with a new commit are queued for `/pr-review` at once, blocking tier first. A PR is queued once per commit, so a failed review is not retried on every check. Docket shows the result on its PR tasks (`pr.reviews`). Off: only Review all and the nightly run. Hosted pages may change it. |
| `autopilot.maxRuns` | `2` | (new) | 1.20.0: how many items autopilot builds at once, 1 to 5 (the cap was 3 until 1.21.0). More queue. Hosted pages may change it. Edited on Settings, Factory. |
| `autopilot.fairSlots` | `true` | (new) | 1.21.0: when a slot frees up, a queued build from a project with nothing running starts first, then by project order (`project.move`), then oldest. Off: oldest first. |
| `factory.*` | see Software factory | (new) | 1.21.0: `taskFileCap` (6), `quickTasks` (3), `retries` (3), `autoFix` (`should-fix` or `blockers`), `reviewRounds` (2), `uiChecks` (true), `regression` (true, 1.26.0), `worktrees` (`always` or `busy`). Written to `.work/factory.json` on every start; Tandem (eng-agents Core 4.9.0) reads it. Edited on Settings, Factory. |
| `autopilot.stallMinutes` | `30` | (new) | 1.34.0: minutes with no word from opencode before a build step counts as stalled, 5 to 240. Hosted pages may change it. Edited on Settings, Factory. |
| `autopilot.quickHandsOff` | `true` | (new) | 1.20.0: hands-off Quick changes (review by exception, above). Off: you approve every quick plan. Hosted pages may change it. |
| `hub` | | (new) | No longer used since 1.17.0: Chat, the hub and Writing use AI whenever this connector is on. Kept so saved settings stay valid; Settings hides it. |

The password is read through `ctx.env` and only sent to opencode. It is never logged, returned or emitted.

A bad setting (no `.work` in the workspace, a URL on another computer) shows in the connector's status with what to fix. It never stops the agent.

## Software factory

Since 1.21.0 (eng-agents Core 4.9.0; Workshop project doc `claude/software-factory-v1-plan.md`). You touch a build twice: approve the plan (Loom's **Approve** starts the build) and publish the PR. Between them autopilot runs on its own:

- `factory.json`: the factory settings, written to `.work/factory.json` on every start. Tandem reads them (task size cap, retries, which review findings become fix tasks, review rounds, UI checks, worktrees).
- Review rounds come from `factory.reviewRounds`. A step that ends without moving the item forward gets one more try in a fresh session before it waits.
- A restart keeps running and queued builds queued; they start again once opencode is connected.
- Knowledge gaps: `state.gaps` is `{open: [{id, n, date, kind, product, source, question, assumed, status, sent}], answered}` from `.work/gaps.md` (written only by Tandem). A build whose step stopped on a gap with no safe assumption (`assumed: null`, `source` its id) waits on it (`autopilot.gap`); `gap.answer` resumes it once `/teach` closes the line. What Workshop sent is kept in `_dashboard/gaps.json`.
- Publish: `state.publish` is `{<folder>: {ready, questions, ui, published, pushed}}` for items that are ready or were published (`_dashboard/published.json`). `ui` is each `ui/results-*.json` (`before` from `/start`, `after` from `/review`). Since 1.26.0 `tests` is each `tests/results-*.json` (the regression suite, eng-agents Core 4.14.0); Publish all ready skips items whose UI checks or tests failed.
- Code review at Publish (1.28.0, eng-agents Core 4.15.0; Workshop project doc `claude/publish-review-v1-plan.md`): Approve publishes, Send back runs `/revise <id> auto` first through autopilot (see [Code review](#code-review)). `state.publish[<folder>]` also has `revising` (a Send back Tandem has not finished) and `openMustFix` (must fix comments Tandem declined); Publish all ready skips both, and Loom also skips items with draft comments (`publish.all` with `skip`). A `revise.md` with `Status: HOLD` stops autopilot for you.
- Self-checks (1.28.0; `claude/build-self-check-v1-plan.md`): `factory.uiCheckPerTask` (default on) and `factory.modelSeesImages` (default off) go to `factory.json`. `state.previews` is `{<folder>: {status: starting|running|failed, url, message}}` for Try it (`preview.open`, `preview.stop`): opencode runs Tandem's `Start-UiApp.ps1` in a session of its own, so Workshop's agent starts no program. An app idle for 30 minutes is stopped.
- After Publish (1.28.0; `claude/after-publish-v1-plan.md`): Workshop's agent calls `published.watch` every 5 minutes, asks the ADO or GitHub connector's `pr.status` for each repo and hands the answer to `published.record`, which keeps it in `published.json` (`repos[].watch`: `{found, pr, ci, checks, review, comments, conflict, merged, fix, checkedAt}`). Failed CI (that passes on the target branch) writes `ci/failure-<n>.md` and starts `/pr-fix <id> ci auto`; a conflict, `ci/conflict-<n>.md` and `/pr-fix <id> conflict auto`; at most 2 rounds per PR. Tandem commits, never pushes: Loom shows Push fix (`push`). Merged removes the worktrees (the work folder stays) and runs `/retro <id> auto`; abandoned forgets the publish record. Teammates' comments go to the code review screen.
- Merge without a PR (1.29.0, `lib/merge.mjs`): `factory.publish` `"merge"` (and `factory.mergeOnly`, repo folders) makes Publish merge each branch into its target in memory (`git merge-tree`, git 2.38 or later) and push the target, never forced, with no PR. Every repo is planned before any is pushed; a conflict writes `ci/conflict-<n>.md` and starts `/pr-fix <id> conflict auto`, shown as `state.publish[<folder>].mergeFix` (`{repo, target, state: working | ready | not-fixed | needs-you, text}`, kept in memory). `state.publish[<folder>].mode` is `"pr"` or `"merge"`; a merge records `published` with `mode: "merge"` and `merged`, then removes the worktrees and runs `/retro`.
- Chat 4.1.0 (1.29.0): `chat.archive`, `chat.search`, `chat.changes`, `chat.suggest` and `chat.attach` ([docs/chat.md](../../docs/chat.md)); `suggestPrompts` (default on) turns the suggested prompt off.
- Chat 4.2.0 (1.30.0): `chat.review` and `chat.review.state`, Review code on a chat's changes (`lib/chat-review.mjs`, [docs/chat.md](../../docs/chat.md), Changes); `chat.changes` adds `key`; `chat.options` `can.review`.
- Model for agent runs (1.32.0, Settings 7.11.0): `runModel` (`provider/model`, blank for the agent's or opencode's default) goes with every command and prompt Workshop starts for Tandem (runs, `/start`, autopilot, replies, loose runs, Writing). Chat sends its own pick and never uses it. Settings draws it as a select of opencode's models (`x-workshop-models`, [docs/connector.md](../../docs/connector.md)).
- Local model (1.33.0, `lib/local-model.mjs`, [docs/local-models.md](../../docs/local-models.md)): `localModel` (`auto`, `on` or `off`; automatic means Model for agent runs is an Ollama, LM Studio, llama.cpp or vLLM model). While on, autopilot runs 1 build at once and `chat.suggest` answers `{off: true}`. For every model, `runCommand` and `/start` check the command's size from eng-agents' `evals/commands.json` against the model's window from opencode's provider list: a command that cannot fit is refused (409), a tight one is logged. `workshop doctor` lists local models and their `limit.context`.
- Hardening (1.34.0, `lib/autopilot.mjs`, [docs/factory.md](../../docs/factory.md#when-the-model-fails)): a step that fails on a model or connection error runs again on its own, up to 2 times (1 then 5 minutes later; `autopilot[folder].message` says when) before it waits. `autoWatch`, every 30 seconds: a step with no word from opencode for `autopilot.stallMinutes` (default 30, 5 to 240; never while a permission prompt or question waits) is aborted and handled like a model error; a session that went idle while the event stream was down moves the build on; a session that is gone waits with why. A step cut off by Workshop stopping is not a failure: the build resumes on restart, and a step still running in opencode is waited for. Resume after a failed approve approves again. Commands are posted to opencode through `node:http` with no time limit (`httpJson` with `timeout: 0`): Node's fetch gave up after 5 minutes without response headers, so every step over 5 minutes used to stop autopilot with "fetch failed". `workshop doctor` probes each local model server (`probeLocalServers` in `lib/local-model.mjs`).
- Clean up (1.35.0, Folio 4.13.0): `voice.run` takes `kind: "cleanup"` for Folio's **Clean up this document**: one prompt Folio builds (`apps/notes/js/cleanup.js`), sent to the read-only agent like the Writing steps, with no tools to call. `voice.result` returns the reply; Folio parses and saves it.
- Board runs (1.36.0, eng-agents Core 4.18.0): the runs that are not autopilot steps (triage, shape, scope, slice, refine, handoff, spikes, docs, TSDs, PR reviews, the hub, 1:1 drafts, Tidy notes; `runLoose` and `promptLoose` in `lib/workspace.mjs`) get autopilot's protections. A Tandem command is checked against the model's context window first (`guardFit`). A model or connection error runs it again once, a minute later, in the same session; `looseWatch`, every 30 seconds, stops a run with no word from the model for `autopilot.stallMinutes` and handles it the same way (never one waiting on your answer). A new triage, shape, scope, refine, spike or docs run from words gets its folder name from Workshop (`lib/names.mjs`, sent as `--name <short name>`), and links to that folder, else to the first new one for an older Tandem.
- Approve in code (1.36.0): `approve` (a scope's stories or milestones, a refined story) no longer runs `/approve` in a session. It answers `{approved: false, open: [lines]}` when the draft has open questions not marked accepted risk (nothing changes); with `acceptRisk: true` it marks them. Then `Status: APPROVED`, the draft hash check (`gate`, the same as `Test-DraftHash.ps1`) and a `progress.md` entry with `- Stats: gate=<word> file=<file>`.
- Hub (1.36.0): `hub.run` takes `intent: "ask"` for a line already known to be a question (Capture's `?`): Workshop writes `route.json` itself and `request.md` says `Routed: ask`, so `/hub` only answers.
- Local model defaults (1.36.0): with Local model on, `prReviews.onSync` is off unless saved on, a PR review waits while autopilot builds (`wait` in `review-queue.mjs`), and a merged item gets no `/retro auto` (run `/retro <id>` yourself).
- `/spec <id> plan|tasks` (1.40.0, eng-agents Core 4.20.0): eng-agents folded `/plan` and `/tasks` into `/spec`. The next step for a feature item with no plan is `/spec <id> plan`, with no tasks `/spec <id> tasks` (`/bug <id>` and `/quick <id>` in those lanes), and autopilot runs `/spec <id> tasks auto` only when `tasks.md` is missing. eng-agents also retired the static dashboard (`/dashboard static`), so `parser/New-Dashboard.ps1` here is the only PowerShell copy of the parser.
- opencode parity (1.39.0, Chat 4.6.0, [docs/chat.md](../../docs/chat.md)): `chat.fork` (opencode's fork, whole or up to a message), `chat.undo` with `message`, `variant` (reasoning effort) on `chat.start` and `chat.send` with each model's `variants` in `chat.options`, `chat.status` and `chat.mcp` (opencode's `/mcp`, `/lsp`, `/formatter`), and `chat.rename` sets the opencode session's title too.
- Live answers and Quick answers (1.38.0, Chat 4.5.0, [docs/chat.md](../../docs/chat.md)): `lib/chat-live.mjs` passes opencode's stream on as `chat.text` and `chat.changed` events for chats a page is reading, and text parts in `chat.messages` carry their `id`. `chat.quick` (`lib/quick.mjs`) looks up the notes for a question in code and asks once with no tools, with Tandem's `quick` agent when installed (Core 4.19.0), else `plan` with tools off.
- Open in terminal on Windows (1.37.0, `lib/console-window.mjs`): the `terminal` action (Chat's `/tui`, Loom's Open in terminal) and Bench's runs open the window through `cmd.exe /c start`, which always gives PowerShell a new console. Before, `powershell.exe` was spawned with Node's `detached: true`, which on Windows means no console at all, so nothing opened. A command with `"` or `%` (which cmd would read) is refused with Copy the command. Linux opens the first terminal on PATH (x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, kitty, alacritty, xterm). CI checks a real window on a Windows runner (`tests/console-window.win.mjs`).
- Overlaps: `state.overlaps` is `{<folder>: [{with, files}]}` for active items whose `tasks.md` files overlap. Loom offers **Approve, build after it** (`autopilot` with `after`).

## Work items as the source

Since 1.22.0 (Workshop project doc `claude/work-items-source-v1-plan.md`). Tandem's work items are the source of truth; ADO is an optional link per item, one line in `workitem.md` (`- ADO item: <n>` linked, `- ADO item: unlinked` or `unlinked (was <n>)` local; no line: a numbered item is linked, an `L<n>` item local). `state.adoLinks` is `{<folder>: {linked, ado, was}}`. On the first start of 1.22.0 every numbered item with no such line is unlinked once (recorded in `_dashboard/ado-links.json`); `state.adoNotice` (`{count, at}`) tells Loom to say so until `ado.notice.seen`. Items started from ADO afterwards are linked as before. Nothing here talks to ADO: Loom's Create in ADO calls the ADO connector's `workitem.create`, then `item.link`.

## Epics and onboarding (1.23.0)

eng-agents Core 4.10.0; Workshop project doc `claude/loom-floor-v1-plan.md`. `lib/epics.mjs`.

- **`epic.build`** `{folder: scope-<name>}`: approving the breakdown is enough. Runs Tandem's `/backlog <scope> local` unless the stories exist, and remembers that you asked (`_dashboard/epics.json`). Each story item (`workitem.md`: `- Epic:`, `- Story:`, `- Depends on:`, `- Repos:`, `- Areas:`, `- Breakdown: approved`; the model's `story`) then gets autopilot as soon as it exists, after the story it depends on. Autopilot runs `/start <id> feature auto`, `/spec <id> auto` and `/approve <id> spec auto`, which approves the plan unless it drifts from the breakdown; a drifting plan waits for you. Every PR still waits for Publish.
- **`product.onboard`** `{product}`: runs `/onboard-product <product>`. Tandem writes `.work/_onboarding/<product>.md` (the model's `onboarding`) and makes a trial run (`- Trial: <product>`, the model's `trial`), which gets hands-off autopilot in the quick lane. The product is live once the trial run reaches Ready to publish. **`onboarding.dismiss`** hides a product's steps.
- **`tests.cover`** `{product, area?}` (1.26.0, Core 4.14.0): runs `/cover <product> [-- <area>]`, which makes one local Quick change per UI repo with `- Coverage: <product>` (the model's `coverage`). Each gets hands-off autopilot like a trial run. Every item that has run its regression suite gets `tests` (the newest run after the change, `docs/work-format.md`).
- `state` adds `epics` (each epic, its stories, where they are, how many are ready) and `onboarding` (each product's five steps: add, scan, gaps, trial, live).

## Where a build is (1.24.0)

eng-agents Core 4.12.0 writes `step.md` in a work folder (`- Step: <build|test|ui|review|fix> | <ISO time>`, `Set-Step.ps1`). The model's item gets `step` (`{name, at}`) only when the file is there. Loom places the build at that station.

## Start over (1.25.0)

`work.reset` `{confirm: "remove every work item"}` removes every work item at once, for Settings' Start over (`docs/agent-api.md`, Reset), which zips `.work` into the backup first and calls this with the phrase. `lib/reset.mjs`: clears autopilot, stops agents still working on an item (`abort`), then for each item folder in `.work` removes its worktrees the way `remove` does (never forced; ones with uncommitted changes are kept and listed) and the folder. Then the item state in `_dashboard` (`sessions`, `autopilot`, `observations`, `gaps`, `published`, `epics`, `pr-queue`) and `_onboarding/`, and reads the state back. Kept: `factory.json`, `projects.json` (run assignments to removed items go), `ado-links.json`, repos, branches and opencode's sessions. `{removed, kept, failed, stopped}`.

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
| `status` | no | | `GET /api/shell/status` | The shell API 1 shape (documented here; eng-agents' `docs/shell-api.md` is gone), unchanged: `{app: "eng-agents-dashboard", api: 1, version, workspace, opencode, error, items[]}`. Each item has `stage`, `next` (with `text`), `busy`, `waiting`, `autopilot`. `version` is the connector's. |
| `state` | no | | the page data | Everything the dashboard page got: the parser's model (items, repos, activity, `stepWords`, PR text), `projects` (see Projects), plus `liveMode.live` (sessions, prompts, questions, autopilot, `canOpenTerminal`, `others`, and `opencode.ai`: `{known, providers}`, the AI providers opencode can use, or `known: false` when this opencode does not say) and `tandem.ado` (whether Tandem has ADO connections set up). Since 1.20.0 also `observations` (`{open: [{id, n, date, kind, repo, source, text}], handled}`, newest first, up to 500) and `autopilotOptions` (`{maxRuns, quickHandsOff}`). |
| `refresh` | no | | `POST /api/refresh` | Reads `.work` again and asks opencode for its AI providers again. `{ok, error}`. |
| `file.read` | no | `folder`, `file` | `GET /files/<folder>/<file>` | `{folder, file, text}`. Only `.work/<folder>/<name>.md`. |
| `run` | yes | `folder`, `command` | `POST /api/run` | Runs a pipeline command (`/plan 41207`) in the item's session; `/do-task` and `/check-docs` get a new one. `{session}`. |
| `tandem.health` | no | optional `since` (`YYYY-MM-DD`) | (new) | Loom's Health > Tandem, since 1.12.0 ([docs/tandem-health.md](../../docs/tandem-health.md)): `{version, pipeline, findings, evals, setup}`. `pipeline` and `findings` read `.work` as eng-agents' `Get-PipelineStats.ps1` and `Get-ReviewFindings.ps1` do (`lib/tandem-health.mjs`); `evals` reads the newest two files in `<eng-agents clone>/evals/results/` (tandem arm only), found through `~/.config/opencode/eng-agents/manifest.json`; `setup` lists the install, the workspace and repo guides. Reads only. |
| `evals.cases` | no | | (new) | Bench, since 1.13.0 ([docs/bench.md](../../docs/bench.md)): `{source, cases}`, each case `{name, description, command, steps, lift, needs}` from `<eng-agents clone>/evals/cases/`. |
| `evals.results` | no | | (new) | Bench: `{source, results}`, every results file in `<eng-agents clone>/evals/results/` summed up (arms, per-arm pass rates, `passAll`, `meanSeconds`, `lift`), newest first. |
| `evals.result` | no | `file` | (new) | Bench: one results file with every run (`pass`, `seconds`, failed checks, steps, log path). |
| `evals.command` | no | `cases`, optional `arm`, `runs`, `model`, `autoApprove` | (new) | Bench: `{command, folder}`, the `Invoke-Evals.ps1` line to copy. Same checks as `evals.run`. |
| `evals.run` | yes | as `evals.command` | (new) | Bench: opens a terminal window you can see (Windows, macOS) in the eng-agents folder running `evals/Invoke-Evals.ps1` with checked arguments: `preset`, case names that must be existing case files, `arm`, `runs` 1 to 10, `model` or `models` (`provider/model`, up to 4), `judge`, `maxRuns`, `experiment` (1.14.0). `{ok, command}`; 501 elsewhere (copy the command). The connector itself runs no model and no git. |
| `evals.commands` | no | | (new) | Bench 2, since 1.14.0: `{source, commands, guards}` from `evals/commands.json` and `evals/guards/expected.json`. |
| `evals.experiments` | no | | (new) | Bench 2: improve-loop experiments from `evals/experiments/*/experiment.json`, newest first. |
| `evals.script.command` | no | as `evals.script` | (new) | Bench 2: `{command, folder}` to copy. |
| `evals.script` | yes | `script` (`suggest`, `trim`, `keep`) and its arguments | (new) | Bench 2: opens a terminal running `Suggest-Fix.ps1`, `Suggest-Trim.ps1` or `Keep-Experiment.ps1` with checked arguments ([docs/bench.md](../../docs/bench.md)). |
| `start` | yes | `id`, `lane` (`feature`, `bug` or `quick`), optional `project` | `POST /api/shell/start` | Runs `/start <id> <lane>` in a new session. With `project`, the run joins it once its `.work` folder exists. |
| `start.local` | yes | `title`, `lane`, optional `description`, `repro`, `project` | (new) | Work with no tracker item: writes `.work/L<n>-<name>/workitem.md` (same shape as eng-agents `New-LocalWorkItem.ps1`; numbers are never reused, see `.work/.local-ids`), then runs `/start L<n> <lane>` in a new session. With `project`, the project's instructions, repo and base branch go under "Extra context from the engineer" and the run joins the project. `{id, folder, session, project}`. |
| `spike` | yes | `topic`, optional `timebox` (`1h`, `2h`, `4h`, `1d`); or `log` (up to 100k characters) and optional `where` | (new) | Runs `/spike <topic>` (with `--timebox <t>`, eng-agents Core 4.2.0) in a new session. With `log` (1.17.0): makes `.work/spike-log-<name>/`, writes `log.md` with what looks like a secret or an email address masked, and runs `/spike spike-log-<name> --log` (Core 4.3.0); answers with `folder` too. Until its `spike-*` folder exists, the session is listed in `liveMode.live.others`. `{session}`. |
| `docs.start` | yes | `target` (what to document, one line) | (new) | Dispatch's Write docs flow, since 1.8.0. Runs `/docs <target>` in a new session, listed in `liveMode.live.others` until its `docs-*` folder exists, then linked to it. `{session}`. |
| `tsd.start` | yes | `target` (a product name from the repo map, or repo folders separated by spaces) | (new) | Dispatch's Technical spec flow, since 1.8.0. Runs `/tsd <target>` in a new session, linked to the new `tsd-*` folder once it exists. `{session}`. |
| `triage.start` | yes | `id` (an ADO work item, optionally with `text`: a note that goes after the id, kept in `note.md` by Core 2.18.0), `text` (the request in words), or `folder` (a `triage-<name>` to triage again after the requester answered) | (new) | Slate. Runs `/triage` (eng-agents Core 2.12.0) in a new session, linked to its `.work/triage-*` folder once it exists. Writes `triage.md`; never posts. `{session, folder}`; `folder` is null for words until the agent names it: follow the session in `state` (`liveMode.live.items`). |
| `shape.start` | yes | `idea`; `from` (a `triage-<name>` to start from); or `folder` (a `shape-<name>`: the next round) with optional `mode` (`brief`: write the brief now; `more`: ask another round) | (new) | Slate's Shape lane. Runs `/shape` (Core 2.16.0) in a new session: one round of questions with you in `questions.md`, a running `understanding.md`, and `brief.md` once the idea is understood. Linked to its `.work/shape-*` folder (from a triage: `shape-<the triage's name>`). Never posts. `{session, folder}` (`folder` is null for a new idea until the agent names it). |
| `scope.start` | yes | `idea`; `from` (a `shape-<name>` whose brief to scope, Core 2.16.0); or `folder` (a `scope-<name>` to revise) | (new) | Slate. Runs `/scope` in a new session, linked to the new `scope-*` folder (from a shape: `scope-<the shape's name>`). `{session, folder}` (`folder` is null for a new idea until it exists: follow the session in `state`). |
| `slice.start` | yes | `folder` (`scope-<name>`) | (new) | Slate. Runs `/slice <folder>` in a new session. `{session, folder}`. |
| `refine.start` | yes | `title`, optional `description`, `parent` (ADO id); `from` (a `shape-<name>` whose brief to refine, Core 2.16.0); or `folder` (a `refine-<name>` to revise) | (new) | Slate. Runs `/refine` (Core 2.12.0) in a new session, linked to the new `refine-*` folder once the agent makes it. `{session, folder}` (`folder` is null for a new story until then). |
| `handoff.start` | yes | `id`, `assignee` | (new) | Slate. Runs `/handoff <id> <assignee>` (Core 2.12.0) in a new session, linked to `.work/handoff-<id>/`. Posts nothing. `{session, folder}`. |
| `approve` | yes | `folder` (`scope-*` or `refine-*`), optional `what` (`stories` or `milestones`, for a scope) | (new) | Slate. Runs `/approve <folder> [what]` in a new session, so the PM steps need no typed commands. The command may ask about open questions first. `{session, folder}`. |
| `file.write` | yes | `folder`, `file`, `text`, optional `expected` | (new) | Writes one `.md` file at the top of a `.work` folder, up to 200 KB: Slate's panel edits and a triage's or a shape's `answers.md`, and Notebook's and Dispatch's editor for any other folder (`plan.md`, `spec.md`, `findings.md`). `expected` is the text you read; without it the file must not exist. If the file is not what you read, 409 and nothing is written. Outside Slate's folders it is also refused (409) while Tandem works on that folder: its session is busy or autopilot is running it. `{folder, file, size}`. |
| `docs.doc` | no | `folder` (a `docs-<name>` folder) | (new) | Since 1.16.0. The doc a Write docs folder is about: the `Doc: <path>` line of its `sources.md` (Core 4.2.0), relative to the workspace. Markdown or text, inside the workspace, at most 1 MB. `{folder, path, text}`. Loom's Save to Folio copies it to the folder's `doc.md`. |
| `docs.list` | no | | (new) | Notebook's Tandem section (see Documents). `{items: [{folder, kind, id, title, stage, lane, busy, review, files: [{file, size, mtime}]}]}`, newest change first, up to 500 folders. `busy` is why it can't be edited now, or null; `review` is the file a gated step waits on you to read (`spec.md`, `plan.md`, `bug.md` or `review.md`), or null. Markdown files only. |
| `pr.review` | yes | `url` (an ADO pull request link), optional `again` | (new) | Runs `/pr-review <link>` (eng-agents Core 2.6.0) in a new session: a first-pass review of a teammate's PR that writes draft comments to `.work/pr-<id>/review.md` and never posts. Listed in `liveMode.live.others` until its `pr-<id>` folder exists, so a failure before that (repo not cloned, ADO not set up) still shows. Refused while a review of the same PR is running. `again` reviews a commit that was already reviewed. `{session}`. The parser reads `pr-<id>` folders as `kind: "pr"` with `items[].prReview` (recommendation, risk, counts, comments, questions). |
| `pr.reviewAll` | yes | `prs`: up to 25 of `{url, title?, commit?, waiting?}` | (new) | Queues the PRs for `/pr-review`, run one at a time, each in a new session (see PR review queue). Skips PRs you voted Waiting for author on, ones already queued, and ones whose review in `.work` is at `commit`. Adds to the end of a running queue. Empty `prs` resumes a paused or stopped queue. `{added: [ids], skipped: [{id, reason}]}`. |
| `pr.reviews` | no | `ids`: up to 200 PR numbers | (new) | Where each PR's first-pass review stands: `{onSync, ready, prs: [{id, state, message, session, reviewedCommit, recommendation, risk, counts: {blocking, shouldFix, optional}}]}`. `state`: `queued`, `running`, `done`, `asking`, `failed`, `skipped` or `none` (never queued and no review in `.work`). The review fields are set only when `done`. |
| `pr.queue.stop` | no | | (new) | Stops the queue after the review that is running; the rest are skipped. |
| `pr.queue.clear` | no | | (new) | Forgets the last run's results. Refused (`conflict`) while the queue runs. |
| `pr.inbox.save` | no | `prs`: up to 200, same shape plus optional `tier` (`blocking`, `asked`, `pool`) | (new) | Remembers the PRs waiting on you for the nightly review, and with `prReviews.onSync` queues new PRs and new commits right away. Dispatch and Docket call it after each ADO sync. `{ok, count, queued: [ids]}`. |
| `oneonone.draft` | yes | `personId`, `date` (`YYYY-MM-DD`), `packet` (Markdown, up to 50 KB) | (new) | The 1:1s app's optional draft step (see 1:1 drafts). Saves `packet` as `packet.md` in this connector's own folder, removes an earlier `draft.md`, and runs `/one-on-one <path to packet.md>` (eng-agents Core 2.8.0) in a new session, listed in `liveMode.live.others`. Refused (`conflict`) while a draft for the same person and day runs. `{session, folder}`. |
| `oneonone.result` | no | `personId`, `date` | (new) | `{state}`: `none` (never asked), `running`, `done` with `text` (the `draft.md` the agent wrote), or `failed` with `error`. |
| `oneonone.tidy` | yes | `personId`, `date`, `notes` (Markdown, up to 20 KB) | (new) | Rapport's Tidy notes (see 1:1 drafts). Saves `notes` as `notes.md` in `<personId>-<date>-tidy/` in this connector's own folder, removes an earlier `draft.md` there, and sends Tandem's **people-prep** agent a plain message (no command) asking for `draft.md` with a `## Follow-ups` section (`- [ ] (me) ...` or `- [ ] (them) ...`) and a `## Wins` section. A new session, listed in `liveMode.live.others`. Refused (`conflict`) while a tidy for the same person and day runs. `{session, folder}`. |
| `oneonone.tidyResult` | no | `personId`, `date` | (new) | Like `oneonone.result`, for the tidy folder. |
| `hub.run` | yes | `id` (`hub_...`), `text` (up to 4000 characters), optional `context` (`people` `[{id, name, relation?, team?}]`, `lists`, `areas`: names only) | (new) | The hub on Dispatch's page (see The hub). Saves `request.md` in this connector's own folder, removes an earlier `route.json` and `answer.md`, and runs `/hub <path to request.md>` (eng-agents Core 2.9.0) in a new session. Refused (`conflict`) while the same id runs. Keeps the newest 200 request folders. `{session, id}`. |
| `hub.result` | no | `id` | (new) | `{state}`: `none`, `running` (with `route` once written), `routed` (`route`, no answer), `done` (`route` and `answer`), or `failed` with `error` (and `answer` when `answer.md` exists). `routed` and `failed` add `said`, the session's last text, when it has one. `route` is `route.json` as written (a code fence or a line around it is tolerated); Dispatch checks it against `docs/schemas/hub-route.schema.json`. |
| `voice.run` | yes | `kind` (`style`, `rewrite`, `learn` or `cleanup`), `prompt` | (new) | Settings, Writing (`docs/writing.md`), since 1.10.0; Folio's Clean up (`cleanup`), since 1.35.0. Sends the prompt Settings built to a new session with opencode's read-only `plan` agent (else Tandem's `chat`). `{session}`. |
| `voice.result` | no | `session` | (new) | `{state: running}`, `{state: done, text}` (the last reply) or `{state: failed, error}`. |
| `chat.start`, `chat.send` | yes | `text` / `session`, `text`; optional `agent`, `model`, `files` | (new) | A chat or the next message in one, to the agent and model you pick (since 1.15.0; none named: opencode's default; a hub thread: Tandem's read-only `chat` agent). Any session in the workspace. See `docs/chat.md`. |
| `chat.command`, `chat.shell`, `chat.undo`, `chat.redo`, `chat.compact` | yes | see `docs/chat.md` | (new) | Since 1.15.0: a slash command, a `!` shell command, undo and redo (revert), and compact (summarize), in a chat or a new one. |
| `chat.options`, `chat.files`, `chat.messages`, `chat.list`, `chat.remove`, `chat.rename` | no | see `docs/chat.md` | (new) | opencode's agents, models and commands; files for `@`; a chat's turns with their parts (tool calls, diffs, thinking, to-dos) and prompts (since 1.15.0); Chat's list (with `all`, every session in the workspace), hiding one, renaming one. |
| `chat.side` | yes | `session`, `text`; optional `side`, `agent`, `model`, `images` | (new) | Since 1.27.0: a question in the chat's side chat, a copy of it so far (opencode's fork), so nothing lands in the chat. See `docs/chat.md`, Side chats. |
| `chat.image` | no | `session`, `message`, `part` | (new) | Since 1.27.0: one pasted picture of a turn. `chat.start`, `chat.send` and `chat.side` take `images` (up to 4, base64, checked against their type). |
| `term.open` | yes | optional `title`, `rows`, `cols` | (new) | Since 1.27.0: a shell in the workspace for Chat's Terminal, run by opencode (`/pty`). `lib/pty.mjs` holds its WebSocket and sends `term.out`, `term.exit` and `term.gone` events. |
| `term.list`, `term.read`, `term.input`, `term.resize`, `term.close` | no | see `docs/chat.md` | (new) | Since 1.27.0: the terminals Chat opened (attached again after a restart), what one printed, keys, size, and closing one. None is marked for agents. |
| `files.write` | yes | `path`, `content`; optional `mtime`, `create`, `force` | (new) | Since 1.27.0: Chat's Files saves a workspace file, only over the version it opened (`lib/workfiles.mjs`). Never `.git`, never outside the workspace (links followed). |
| `files.tree`, `files.read`, `files.stat` | no | see `docs/chat.md` | (new) | Since 1.27.0: a workspace folder, a file's text, and when open files changed. |
| `repo.add` | yes | `url`, optional `about` | (new) | `git clone` into the workspace (no terminal prompts; credential helpers still work), then adds a row to the repo map (`AGENTS.md` in the workspace, created if missing). `{folder, repoMap: "created" | "added" | "listed"}`. |
| `repo.guide` | yes | `repo` (a folder in the workspace) | (new) | Runs `/onboard-repo <repo>` in a new session, listed in `liveMode.live.others`. `{session}`. |
| `session.dismiss` | no | `session` | (new) | Stops listing a spike or repo guide session in `others`. The opencode session is kept. |
| `reply` | yes | `session`, `text` | `POST /api/reply` | Sends text to the session; a `/command` runs in the item's pipeline. |
| `answer` | yes | `kind` (`permission` or `question`), `id`, then `reply` (`once`, `always`, `reject`) or `answers` / `reject` | `POST /api/permission`, `POST /api/question` | |
| `abort` | yes | `session` | `POST /api/abort` | |
| `work.reset` | yes | `confirm` (exactly `remove every work item`) | none | Removes every item folder, its worktrees (never forced) and the item state. See Start over above. `{removed, kept, failed, stopped}`. |
| `remove` | yes | `folder`, `confirm` (the item id typed, or the folder name for spikes, docs and TSDs) | `POST /api/remove` | Deletes the item's `.work` folder, session links and autopilot state, and since 1.20.0 its git worktrees (repos.md `Path` under `.worktrees/<folder>/`, `git worktree remove`, never forced: one with uncommitted changes is kept and listed in `kept`). Repos, branches and opencode sessions are left alone. `{ok, removed, kept?}`. Refused while the agent or autopilot is working on it. |
| `push` | yes | `folder`, `repo` | `POST /api/push` | `git -C <repo> push -u origin <branch>` for the branch in `pr.md`. Never `main`, `master`, `develop`, `dev` or the PR's target branch, never `--force`, only repo folders inside the workspace. |
| `autopilot` | yes | `folder`, `action` (`start`, `approve-start`, `resume`, `stop`, `dismiss`), optional `after` (1.21.0: another item folder; the build stays queued until that item's PR text is ready) | `POST /api/autopilot` | Since 1.20.0: past `autopilot.maxRuns` running builds, `start` and `resume` queue the item (`{ok, queued: true}`, status `queued`) and the oldest queued one starts when a slot frees; `stop` takes it out of the queue. With `autopilot.quickHandsOff`, `start` also works on a quick-lane item before `quick.md` is approved: autopilot runs `/quick <id> auto` and `/approve <id> quick auto` (eng-agents Core 4.8.0, review by exception), which approves only a clean plan; a held plan waits for you. |
| `observation.dismiss` | yes | `id` (`O<n>`) | (new) | 1.20.0: hides one of Tandem's observations (`.work/observations.md`). Kept in `.work/_dashboard/observations.json`; the file is never written. `{ok, id, status}`. |
| `observation.sent` | yes | `id` | (new) | 1.20.0: marks one as sent to Docket (Loom sends the task offer itself). |
| `gap.answer` | yes | `id` (`G<n>`), `answer` (one line, up to 500 characters) | (new) | 1.21.0: runs `/teach <id> <answer>` (eng-agents Core 4.9.0), which writes the answer where it belongs and closes the gap. 409 when the gap is answered or an answer is on its way. Builds waiting on the gap resume when `/teach` closes it. |
| `publish` | yes | `folder` | (new) | 1.21.0, Gate 2: for an item whose next step is ship, pushes every branch in `pr.md` (the `push` rules: never the target or default branch, never force) and records it. Returns `{ok, folder, repos: [{repo, branch, target, pr, message}]}` with each repo's create PR link. 409 when the item is not ready. 1.29.0, with Merge, no PR: merges into each target instead, `{ok, folder, mode: "merge", merged: true, repos: [{repo, branch, target, merged (commit), pr: null, message}]}`; 409 on a conflict (nothing pushed, Tandem's fix started). |
| `publish.all` | yes | optional `project`, `skip` (folders to leave out, 1.28.0) | (new) | 1.21.0: publishes every ready item with no review questions, no failed UI check or test, and (1.28.0) no Send back waiting on Tandem or must fix comment it declined. Returns `{ok, published, failed: [{folder, message}]}`. |
| `item.link` | yes | `folder`, `ado` (a number, `#` or `AB#` allowed) | (new) | 1.22.0: links a work item to an ADO work item: writes `- ADO item: <n>` in its `workitem.md`. |
| `item.unlink` | yes | `folder` | (new) | 1.22.0: makes it local: `- ADO item: unlinked (was <n>)`. Workshop and Tandem never update ADO for it again. |
| `ado.notice.seen` | no | | (new) | 1.22.0: hides the one-time notice (`state.adoNotice`). |
| `ui.image` | no | `folder`, `file` (`<name>/<page>.png` under the item's `ui/`) | (new) | 1.21.0: a UI check screenshot as `{file, dataUrl}` (PNG, at most 5 MB). |
| `project.move` | yes | `id`, `dir` (-1 or 1) | (new) | 1.21.0: moves a project up or down; autopilot's fair slots go by this order. |
| `observation.start` | yes | `id`, optional `project` | (new) | 1.20.0: starts one as a local Quick change (`start.local`, lane `quick`, the text as title, where it came from in the description) and marks it started. Returns what `start.local` returns. |
| `project.create` | yes | `name`, optional `color`, `repo`, `baseBranch`, `instructions`, `model`, `agent`, `tracker` | (new) | Adds a Dispatch project. `repo` must be a folder in the workspace. `{project}`. |
| `project.update` | yes | `id`, then any field above (an empty string clears it, except `name`) | (new) | `{project}`. Inbox cannot be changed. |
| `project.delete` | yes | `id` | (new) | Removes the project; its runs move to Inbox. `.work` folders are not touched. `{ok, movedToInbox}`. |
| `run.assign` | yes | `folder`, `project` (`inbox` for none) | (new) | Moves a run to a project. `{folder, project}`. |
| `review.session` | no | `id`, `repo` | (new) | The `ReviewSession` for one repo of a work item. See [Code review](#code-review). |
| `review.file` | no | `id`, `repo`, `path`, `side` (`old`, `new` or `prev`) | (new) | `FileContent` for one file. |
| `review.submit` | yes | `id`, `repo`, `feedback` (a `ReviewFeedback`) | (new) | Approve (records the verdict; Loom then calls `publish`) or request changes (Send back: autopilot runs `/revise <id> auto` first). `{ok, status, revision, submittedAt}`. |
| `review.revise` | yes | `id` | (new) | 1.28.0: starts `/revise` again on comments already sent back (after it could not start or stopped). 409 when nothing is waiting. |
| `preview.open` | yes | `folder`, optional `repo` | (new) | 1.28.0, Try it: starts the build's app through opencode (or reuses the one Tandem keeps for its UI checks) and answers once its address does. `{status, url}`. |
| `preview.stop` | yes | `folder` | (new) | 1.28.0: stops it through opencode. |
| `published.watch` | no | none | (new) | 1.28.0, for the agent's PR watcher: the published, unmerged repos to check, each with `remote`, `branch`, `target` and `host` (`ado` or `github`). |
| `published.record` | yes | `folder`, `repo`, `status` (`pr.status`'s answer) or `error` | (new) | 1.28.0: saves where the PR stands and starts Tandem's fix on failed CI or a conflict, or the retro on a merge. `{ok, started?, merged?, abandoned?}`. |
| `terminal` | no | `session` (optional) | `POST /api/terminal` | Opens the opencode TUI in a terminal window (Windows and macOS). On Windows it starts `powershell.exe -NoExit` directly in its own console (no encoded command, which endpoint security often blocks). Not marked write: it changes nothing outside this computer. |

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
| `review` | `{id, folder, repo, status, revision}` | A code review got a verdict, or a Send back started or finished. Call `review.session` for the data. |
| `published` | `{folder, repo, event}` (`ci-failed`, `conflict`, `fix-ready`, `merged`) | 1.28.0: something changed on a published PR. Loom notifies on `fix-ready` and `merged`. |
| `prQueue` | `{status, counts}` | The PR review queue changed. Call `state` for `liveMode.live.prQueue`. |

## Projects

Dispatch groups runs (the `.work` items) into projects. They are kept in `.work/_dashboard/projects.json`, next to `sessions.json`, so they never leave this computer (`lib/projects.mjs`). Dispatch's project filter is view state and stays in the browser.

`state.projects`: `{inbox: "inbox", colors: [...], projects: [{id, name, color, repo, baseBranch, instructions, model, agent, tracker, created, builtIn}], runs: {"<folder>": "<project id>"}}`. Inbox is always first; any run not in `runs` is in Inbox. One repo per project for now.

Project instructions reach the agent through `workitem.md` for runs started with `start.local`. Runs started from an ADO item (`start`) join the project, but `/start` writes their `workitem.md` itself, so the instructions are not added there yet. `model` and `agent` are stored for later; runs do not use them yet.

Status `details`: `{workspace, opencode: {connected, kind, version, error}, parserError}`.

## 1:1 drafts

Rapport's 1:1s (`js/oneonones/` in [adavidson21/receipts](https://github.com/adavidson21/receipts); 1:1s was its own app until Rapport 2.0.0) can ask your opencode agents for draft talking points. `lib/one-on-one.mjs` keeps this away from your code: the packet holds people data, so it is saved in this connector's working folder, `<dataDir>/.scratch/opencode/oneonones/<personId>-<date>/packet.md` (`ctx.scratch`, removed 7 days after it last changed; `<Workshop home>/data/_connectors/opencode/oneonones/` with an agent older than 1.18.0), never in the workspace or `.work`. Tandem's `/one-on-one` (agent **people-prep**) reads it and writes `draft.md` next to it, and may edit nothing else. The app leaves out the person's name, and concerns from receipts unless the person asks for them on that run. The session shows in Dispatch with the others, so a permission prompt can be answered there.

**Tidy notes** (`oneonone.tidy`, Rapport 4.1.0) uses the same agent and the same kind of folder (`<personId>-<date>-tidy/`, beside the draft's, so the two never overwrite each other). Rapport sends the note's lines with the person's name, first name and `@handle` replaced by "them", and writes nothing into the note until you accept lines in Rapport. It needs no new Tandem command: people-prep may already write any `draft.md` under `oneonones/`.

## Slate

Slate (`apps/slate/`) takes a request from intake to a decision: delegate it or build it yourself. Its Shape and PM steps are the actions `triage.start`, `shape.start`, `scope.start`, `slice.start`, `refine.start`, `handoff.start`, `approve` and `file.write` (`lib/slate.mjs`, not part of the copy from eng-agents). Each runs one Tandem command in a new session, like a spike, and links the session to its `.work/triage-*`, `shape-*`, `scope-*`, `refine-*` or `handoff-*` folder once that folder exists, so it shows in `state` (`liveMode.live.items`, `sessions`, `questions`) and its files can be read with `file.read`. A question or permission prompt from one of these sessions can be answered in Slate's item panel (`answer`, and `reply` for a plain-text question) or in Dispatch, as for a spike. `file.write` writes only a `.md` file at the top of one of those five kinds of folder, and only over the text you read. None of them talks to Azure DevOps or git: Slate creates and changes work items through the ADO connector, with a confirm.

## Documents

Tandem's `.work` Markdown (plans, specs, bug write-ups, reviews, briefs, findings) shows in Notebook (the Notes app) as its Tandem section, and Dispatch's file sheet edits it, both live from `.work` through `docs.list`, `file.read` and `file.write` (`lib/docs.mjs`). Nothing is copied into the Workshop folder, so the agent and you always see the same file. Edits keep `file.write`'s conflict check and wait while Tandem works on that item. Approving is unchanged: it is still the `/approve` step, not an edit.

## The hub

Dispatch's hub (`apps/agents/js/hub.js`, Workshop `docs/hub.md`) sends each message to Tandem's `/hub` (agent **hub**). `lib/hub.mjs` keeps it away from your code: the message and the names it may use (people directory, Docket lists, team area paths) are saved as `<dataDir>/.scratch/opencode/hub/<id>/request.md` (`ctx.scratch`, removed 7 days after it last changed; `<Workshop home>/data/_connectors/opencode/hub/` with an agent older than 1.18.0), never in the workspace or `.work`. The hub agent writes `route.json` and, for a question, `answer.md` next to it, and may edit nothing else; it runs only read-only commands and cannot fetch web pages.

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

Copied from eng-agents branch `dev/feature/review-api` at `2626601` (the live server's `/api/shell/code-review/*` routes): `lib/review-git.mjs`, `lib/code-review.mjs`. `lib/review.mjs` wires them to this connector; `lib/review-notes.mjs` (1.28.0) adds Tandem's review findings at their lines and the reading order to `review.session` (`extras: {files, notes, threads}`). Errors are plain words with the usual codes; on any `conflict` from `review.submit`, reload the review.

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

### Send back (1.28.0)

Request changes saves the feedback, sets the review to `revising`, and starts autopilot with `/revise <id> auto` as its first command (Tandem Core 4.15.0). `/revise` turns each comment into a fix task, an answer or a declined note (`rev-<n>-response.json`), saves comments marked as rules in the repo guide, and moves `pr.md` to `history/`. Autopilot then runs the usual steps: the fix tasks, `/review`, the UI checks and `/pr`. When autopilot finishes, every repo still `revising` becomes revision `n+1`, `awaiting_review`, with Tandem's answers. The ad hoc revision runner (one prompt with none of Tandem's checks) is gone.

`state.reviews`: `{"<folder>": {"<repo>": {status, revision, started, run, sentBack, openMustFix}}}` for every repo in an item's `pr.md` or with a review. `started: false` means nobody has reviewed it yet; `run` is `{status: running|failed, message}` while a Send back is `revising`, else `null`.

### Storage

`.work/<folder>/code-review/<repo>/`: `state.json` (`{revision, status, lastReviewedHeadSha}`; missing means revision 1, awaiting review), `rev-<n>.json` (the feedback), `rev-<n>-response.json` (Tandem's answers, written by `/revise`).

## Not carried over

| Live server | Why | Where it goes |
| --- | --- | --- |
| The page (`dashboard.template.html`) and `/` | Connectors have no UI. | WS6 (Agents app) |
| Session token, `shellOrigins`, CORS, `frame-ancestors`, `Host` check | The agent does this for every connector. | WS1 (done) |
| `/api/update`, `/api/update-check`, `/api/restart` (`updates.mjs`) | Connectors make no update checks. `workshop update` updates Tandem (workshop #154). | Done |
| Writing `.work/dashboard.html` | eng-agents retired the static page and `/dashboard static` in Core 4.20.0. | Retired |
| `/api/ping`, `Start-LiveDashboard.ps1` | The agent starts and stops the connector; use `GET /api/connectors/opencode` for its status. eng-agents deleted the script in Core 2.11.0; `/dashboard` opens Dispatch. | Done |
| Port 4300 | Served by the agent. | |

## Known quirks kept for parity

- The parser reads a published TSD's `Status:` line's gate value as `UNKNOWN` (`docs/work-format.md`, Known quirks), but since eng-agents Dashboard 1.7.1 the TSD's state is Published. `lib/workparser.mjs` and `parser/New-Dashboard.ps1` carry the same fix; `test/parser.test.mjs` and `test/workparser.test.mjs` check it.
- `/do-task` and `/check-docs` always run in a new session.
- `parser/New-Dashboard.ps1` lists `brief.md` right after `workitem.md`, as eng-agents Dashboard 1.10.1 does (PARITY.md).

## Tests

```
node --test "connectors/opencode/test/*.test.mjs"
```

- `test/fake-opencode.mjs`: fake opencode 1.x and 2.x servers on `127.0.0.1` with their event streams, built from what the adapters call. `test/harness.mjs` adds a fake `opencode` CLI (for finding the 2.x service) and copies `docs/examples/work/` into a temporary workspace. No work data.
- `review-git.test.mjs`, `code-review.test.mjs`, `revision-runner.test.mjs`: the code review modules against throwaway git repos and a fake launcher. They need only git.
- `connector.test.mjs`: every action and event against both versions, through a `ctx` like the agent's. Each test names the [PARITY.md](PARITY.md) item it covers.
- `slate.test.mjs`: Slate's PM folders and `file.write` (which folders and files, creating, the conflict check), and the arguments `shape.start` and scope or refine from a shape refuse. Needs neither PowerShell nor opencode.
- `one-on-one.test.mjs`: the 1:1 draft step (`lib/one-on-one.mjs`): where the packet goes, a stale draft cleared, running, done and failed, and the action args. Needs neither PowerShell nor opencode.
- `agent.test.mjs`: the module against the connector contract, and the connector through the real agent (confirm, events, restarts on a config change, the password never in responses, events or logs).

Tests that need PowerShell (the parity tests and `parser.test.mjs`) or git skip with a message when they are missing. GitHub's Windows, macOS and Linux runners have both.

## Knowledge base

Settings' Knowledge pages (Workshop `docs/knowledge.md`) use four actions in `lib/knowledge.mjs`. `knowledge.repos` and `knowledge.map.read` only read: each workspace repo with its guide's `Stack:` line, first purpose sentence and `## Remembered` lines, and the repo map `<workspace>/AGENTS.md` with whether Workshop wrote it. `knowledge.map.write` (confirm) writes the map Settings built; it refuses text without Workshop's marker, writes atomically, and keeps a hand-written map once as `AGENTS.md.hand-written.md` (never overwritten). `knowledge.draft` (confirm) runs Tandem's `/product-notes draft <product>` in a new session, listed with the other sessions, so Tandem proposes note lines for you to review in Folio.

# Parity checklist: eng-agents Dashboard 1.2.0 to 1.6.1

WS3 acceptance: the opencode connector does everything the live dashboard server did in eng-agents [CHANGELOG](https://github.com/adavidson21/eng-agents/blob/e2d202abf5223e74d3af942fcd8ff56bd12cf811/CHANGELOG.md) Dashboard 1.2.0 to 1.6.1, plus the brief's own checks.

Each server-side item has an ID. Tests in `test/` name the ID they cover (search for `[P-run]`). Items that are only about the page are marked **WS6**: the connector supplies the data, the Agents app draws it, and WS6 runs this list again in the UI. Items with no place in a connector are marked **Not carried over** with the reason.

## From the brief

| ID | Check | Covered by |
| --- | --- | --- |
| P-connect | opencode 1.x and 2.x both connect: an explicit URL for each, 2.x found through `opencode service start` with the password from `service.json`, a service on another computer refused, `.work` still readable without opencode. | `connector.test.mjs` |
| P-push | Push keeps its branch protections: only the `pr.md` branch, `-u origin`; never `main`, `master`, `develop`, `dev` or the target branch; odd branch names and repo folders outside the workspace refused; never `--force` (a diverged remote fails with git's message). | `connector.test.mjs` (real git, local bare remote) |
| P-status | `status` keeps the shell API 1 shape (`/api/shell/status`), field for field. | `connector.test.mjs`, `agent.test.mjs` |
| P-secret | The 2.x password never appears in results, events, status or logs. | `connector.test.mjs`, `agent.test.mjs` |

## Dashboard 1.2.0

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| P-remove | Abandon or remove an item: type the item id to confirm; its `.work` folder, sessions and autopilot state are deleted; repos and branches are left alone. | `remove` | `connector.test.mjs` |
| | The remove dialog lists work still in the repos and the commands to delete branches. | `state` has the repos and branches | **WS6** |
| P-state | Ready to ship items show the PR text from `pr.md` per repo. | `state` (`items[].pr`) | `connector.test.mjs` |
| | Copy buttons, Create PR in ADO, the push command when a branch is not pushed. | `state` | **WS6** |
| P-state | Recent activity is one line per item per day. | `state` (`activity`, from the parser) | `connector.test.mjs` (present); content is the parser's, unchanged |
| | Clearer track: checked, current and faint stages. | `status` (`stage`) | **WS6** |

## Dashboard 1.2.1

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| | Pick up here is not repeated in its group; it has its own Abandon button. | `remove` | **WS6** |

## Dashboard 1.3.0

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| P-push | Push on PR cards: `git -C <repo> push -u origin <branch>` for the `pr.md` branch; the click is the approval; protections above; git errors shown. | `push` (`write: true`, so the agent needs `confirm: true`) | `connector.test.mjs`; `agent.test.mjs` checks every write action, `push` included, is marked `write: true` |

## Dashboard 1.4.0

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| P-status | The Next line says the step in plain words. | `status` (`next.text`), `state` (`stepWords`) | `connector.test.mjs` |
| P-autopilot | **Approve and build** (approve first, then autopilot) and **Build with autopilot**. | `autopilot` (`approve-start`, `start`) | `connector.test.mjs` |
| P-run | **Run**, **Approve**, **Resume**: one pipeline command in the item's session; `/do-task` in a new one; unknown items and commands opencode lacks are refused; refused while autopilot runs the item. | `run` | `connector.test.mjs`, `agent.test.mjs` |
| | One main button per step, command in the tooltip, autopilot box only while running or waiting, no terminal hints, simpler header, count chips over 8 items. | | **WS6** |
| P-refresh | More menu: Refresh. | `refresh`, plus the `.work` watcher and poll | `connector.test.mjs` |
| P-events | More menu: alerts (a prompt or question needs you, an agent finished). | `agent.waiting`, `agent.done`, `live`, `model`, `autopilot` events | `connector.test.mjs`, `agent.test.mjs` |
| P-terminal | More menu: open the TUI, the terminal command. | `terminal`; `state` (`liveMode.live.opencode.attach`, `canOpenTerminal`) | `connector.test.mjs` (refusals, the command). Opening a window on Windows and macOS: by hand, see below. |
| | More menu: Check for updates; Update available. | | **Not carried over**: connectors make no update checks. eng-agents updates stay in eng-agents. |

## Dashboard 1.5.0

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| | `Start-LiveDashboard.ps1 -Detach`. | | **Not carried over**: the agent starts and stops the connector. |
| | The live dashboard keeps `.work/dashboard.html` current. | | **Not carried over**: its template is the eng-agents page. eng-agents' `/dashboard static` still writes it. Revisit in WS6 and WS8. |
| | The static page shows whether the live dashboard is running. | | eng-agents, unchanged. **WS8** points it at Workshop. |

## Core 2.1.0

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| | `/dashboard` opens the live dashboard, starting it if needed. | | **WS8** |

## Dashboard 1.5.1

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| P-status | Shell status sends each item's `next.text` and `autopilot` (running or needs you). | `status` | `connector.test.mjs` (`P-status`, `P-autopilot`) |

## Dashboard 1.6.0

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| | The server split into modules. | `lib/`, copied | README.md, Source |
| P-state | Step wording defined once in `New-Dashboard.ps1`; each next step carries `text`; page data carries `stepWords`. | parser copied unchanged | `connector.test.mjs` |
| P-status | The shell API reports `api: 1`. | `status` | `connector.test.mjs` |
| | Themes from the hub's `themes.css`. | | **WS6** |

## Dashboard 1.6.1

| ID | Changelog item | Connector | Covered by |
| --- | --- | --- | --- |
| | Renamed to Workshop; `sync-themes.mjs` reads from there. | | **WS6** deletes `sync-themes.mjs`. |

## Also from 1.1.0, still in use

| ID | Item | Connector | Covered by |
| --- | --- | --- | --- |
| P-start | `/api/shell/start`: start a work item (`/start <id> <lane>`) in a new session; reported as starting until its folder appears. | `start` | `connector.test.mjs` |
| P-reply | Reply to the agent; a `/command` reply runs in the item's pipeline. (A reply also resumes waiting autopilot; that code is copied unchanged and not tested here.) | `reply` | `connector.test.mjs` |
| P-answer | Permission prompts and questions shown with their item and answered (once, always, reject; by label; dismissed). | `answer` | `connector.test.mjs` |
| P-abort | Stop the agent. | `abort` | `connector.test.mjs` |
| | Shell origins, frame ancestors, the session token. | | **Not carried over**: the agent checks host, origin and token for every connector (WS1). |

## By hand

Run once on Windows and once on macOS, with opencode and eng-agents installed, before WS6 starts:

1. Enable the connector in `~/.workshop/config.json` with your workspace, start the agent (`node agent/start.mjs`), and check `GET /api/connectors/opencode` reports `ready` with opencode connected.
2. `POST /api/connectors/opencode/terminal` with `{"args": {}}`: a terminal window opens with the opencode TUI in the workspace.
3. Start a real item with `start` (`confirm: true`), answer its first prompt with `answer`, and push its branch with `push` once `pr.md` exists.

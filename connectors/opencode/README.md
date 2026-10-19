# opencode connector

The eng-agents live dashboard server, moved into Workshop as a connector. It reads `.work` with the eng-agents parser, follows opencode (1.x and 2.x), and runs pipeline commands for the Agents app (WS6) and Prioritizer.

Node standard library only. It calls only opencode on this computer (`127.0.0.1`, `localhost` or `[::1]`) and runs `git`, PowerShell and the `opencode` command locally.

## Source

Copied from [adavidson21/eng-agents](https://github.com/adavidson21/eng-agents) `main` at `e2d202abf5223e74d3af942fcd8ff56bd12cf811` (Core 2.1.0, Dashboard 1.6.1). eng-agents is frozen until WS8 and was not changed.

| eng-agents | Here |
| --- | --- |
| `core/scripts/dashboard/server/*.mjs` (all but `updates.mjs`) | `lib/` |
| `core/scripts/dashboard/New-Dashboard.ps1` | `parser/New-Dashboard.ps1`, unchanged |
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

The password is read through `ctx.env` and only sent to opencode. It is never logged, returned or emitted.

A bad setting (no `.work` in the workspace, a URL on another computer, no PowerShell) shows in the connector's status with what to fix. It never stops the agent.

## Actions

Call with `POST /api/connectors/opencode/<action>` and `{"args": {...}}` (write actions also need `"confirm": true`), or `connectors.call('opencode', action, args)` from the SDK.

| Action | Write | Args | Live server route | Result |
| --- | --- | --- | --- | --- |
| `status` | no | | `GET /api/shell/status` | The shell API 1 shape, unchanged: `{app: "eng-agents-dashboard", api: 1, version, workspace, opencode, error, items[]}`. Each item has `stage`, `next` (with `text`), `busy`, `waiting`, `autopilot`. `version` is the connector's. |
| `state` | no | | the page data | Everything the dashboard page got: the parser's model (items, repos, activity, `stepWords`, PR text) plus `liveMode.live` (sessions, prompts, questions, autopilot, `canOpenTerminal`). |
| `refresh` | no | | `POST /api/refresh` | Reads `.work` again. `{ok, error}`. |
| `file.read` | no | `folder`, `file` | `GET /files/<folder>/<file>` | `{folder, file, text}`. Only `.work/<folder>/<name>.md`. |
| `run` | yes | `folder`, `command` | `POST /api/run` | Runs a pipeline command (`/plan 41207`) in the item's session; `/do-task` and `/check-docs` get a new one. `{session}`. |
| `start` | yes | `id`, `lane` (`feature` or `bug`) | `POST /api/shell/start` | Runs `/start <id> <lane>` in a new session. |
| `reply` | yes | `session`, `text` | `POST /api/reply` | Sends text to the session; a `/command` runs in the item's pipeline. |
| `answer` | yes | `kind` (`permission` or `question`), `id`, then `reply` (`once`, `always`, `reject`) or `answers` / `reject` | `POST /api/permission`, `POST /api/question` | |
| `abort` | yes | `session` | `POST /api/abort` | |
| `remove` | yes | `folder`, `confirm` (the item id typed, or the folder name for spikes, docs and TSDs) | `POST /api/remove` | Deletes the item's `.work` folder, session links and autopilot state. Repos, branches and opencode sessions are left alone. `{ok, removed}`. Refused while the agent or autopilot is working on it. |
| `push` | yes | `folder`, `repo` | `POST /api/push` | `git -C <repo> push -u origin <branch>` for the branch in `pr.md`. Never `main`, `master`, `develop`, `dev` or the PR's target branch, never `--force`, only repo folders inside the workspace. |
| `autopilot` | yes | `folder`, `action` (`start`, `approve-start`, `resume`, `stop`, `dismiss`) | `POST /api/autopilot` | |
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

Status `details`: `{workspace, opencode: {connected, kind, version, error}, parserError}`.

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

- The parser reads a published TSD's `Status:` line as `UNKNOWN` (`docs/work-format.md`, Known quirks). Fixed in eng-agents in WS8.
- `/do-task` and `/check-docs` always run in a new session.

## Tests

```
node --test "connectors/opencode/test/*.test.mjs"
```

- `test/fake-opencode.mjs`: fake opencode 1.x and 2.x servers on `127.0.0.1` with their event streams, built from what the adapters call. `test/harness.mjs` adds a fake `opencode` CLI (for finding the 2.x service) and copies `docs/examples/work/` into a temporary workspace. No work data.
- `connector.test.mjs`: every action and event against both versions, through a `ctx` like the agent's. Each test names the [PARITY.md](PARITY.md) item it covers.
- `agent.test.mjs`: the module against the connector contract, and the connector through the real agent (confirm, events, restarts on a config change, the password never in responses, events or logs).

Tests that need PowerShell or git skip with a message when they are missing. GitHub's Windows, macOS and Linux runners have both.

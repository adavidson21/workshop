# Workshop agent

The one local process: it serves the Workshop UI at `http://127.0.0.1:<port>/`, reads and writes app data in your data folder, and hosts connectors. It implements [docs/agent-api.md](../docs/agent-api.md). Node 22 or later, standard library only, no npm install.

## Run it

```
node agent/start.mjs
```

It prints an address with a one-time token. Open it in Chrome or Edge on the same computer; the agent swaps the token for a cookie and drops it from the address. Stop it with `Ctrl+C`.

| Option | Meaning |
| --- | --- |
| `--port <n>` | Listen on this port for this run only. `config.json` is not changed. |
| `--quiet` | Do not print log lines to the console. They still go to the log file. |

It writes in two places. See [docs/config.md](../docs/config.md) and [docs/data-format.md](../docs/data-format.md), Data folder.

**The Workshop home**, `~/.workshop/` (`%USERPROFILE%\.workshop` on Windows), or `WORKSHOP_HOME` if set: what belongs to this computer.

| Path | What |
| --- | --- |
| `config.json` | Settings. Created on first run with everything off. Edit by hand while the agent is stopped, or through Settings. |
| `token` | The per-install token. Readable by you only. |
| `data/_connectors/<id>/` | Each connector's private storage. |
| `data/<app>/...` | App data from before the data folder. Copied into the data folder once (then `data/moved.json` is written) and kept as a backup. Never deleted. |
| `logs/agent.log` | The log. Moves to `agent.1.log` past 5 MB. Never holds the token, PATs or data contents. |

**The data folder**, `dataDir` in `config.json`, default `~/Workshop` (`%USERPROFILE%\Workshop`): your app data, a folder you own. It may not be inside the Workshop home. A change applies on the next start; the agent never copies data between data folders. On start the agent creates it if missing and stops with a message if it cannot read and write it.

| Path | What |
| --- | --- |
| `<app>/<collection>.json` | One collection, written atomically. Nested names are subfolders (`receipts/entries/kim/2026.json`). |
| `<app>/<path>.md`, `<app>/<path>.json` | Plain files written through the files API. |
| `.trash/<app>/...` | Files deleted through the files API. Never emptied by Workshop. |
| `.backups/<yyyy-mm-dd>/<app>/...` | Copies kept before a version upgrade. Never removed by Workshop. |

The agent watches the data folder and sends a "re-read" event when another program changes a collection or file. Names it ignores (dot files and folders such as `.git`, names that break the rules, other extensions) are never changed or deleted.

The `workshop` command wraps this: `node workshop.mjs start` is the same as the above, and `scripts/install.sh` / `scripts/install.ps1` set up the home folder and start at login. See the top-level README and [docs/security.md](../docs/security.md).

## What it does and does not do

- Binds `127.0.0.1` only, and refuses requests with a foreign `Host` or `Origin`.
- Makes no outbound request itself. Only connectors do, to hosts from their own config.
- Serves `shell/`, `shared/`, `icons/`, `apps/`, `index.html`, `manifest.webmanifest` and `sw.js`. Never the home folder, the data folder, `agent/`, `connectors/`, `tests/`, `docs/` or dot files.
- Reaches the data folder only through `/api/data` and `/api/files`. Paths are checked as sent, before normalization, and a path that leads outside the data folder through a link is refused.
- Loads connectors from `connectors/<id>/index.mjs` and starts the ones enabled in `config.json`. A broken connector is listed with an error and never stops the agent.
- Lists apps from `apps/<id>/app.json`.

## Layout

```
start.mjs          command line entry
server.mjs         createAgent(): HTTP routes, security checks, wiring
test-target.mjs    runs the contract suite against this agent
version.mjs        the agent's version
lib/
  home.mjs         home folder, config.json, token
  datadir.mjs      the data folder on start: checks, cleanup, the one-time copy from ~/.workshop/data
  datapath.mjs     name rules, path checks, links, walking the data folder
  store.mjs        collections (the data API)
  files.mjs        plain files (the files API), trash
  watch.mjs        changes made outside Workshop
  connectors.mjs   connector host and ctx
  events.mjs       the event stream
  static.mjs       static files
  log.mjs          log file with redaction
  http.mjs         errors, JSON and HTML responses, body reading
  fsutil.mjs       atomic writes, per-key locks
  schema.mjs       copy of tests/lib/schema.mjs
  connector-check.mjs  copy of tests/lib/connector-check.mjs
test/              the agent's own tests (disk, data folder, logs, static files, lifecycle, source rules)
```

`lib/schema.mjs` and `lib/connector-check.mjs` are copies, so the agent never loads code from `tests/` at run time. `test/source.test.mjs` fails if they drift. Change `tests/lib/` first (a C0-owned folder), then copy.

## Tests

```
node --test "agent/test/*.test.mjs"
WORKSHOP_TARGET=agent/test-target.mjs node --test "tests/contract/*.test.mjs"
```

On Windows PowerShell, set the variable first: `$env:WORKSHOP_TARGET = "agent/test-target.mjs"`. CI runs both on Windows, macOS and Linux.

Tests always pass a temp data folder (`createAgent({ dataDir })`, or `dataDir` in a temp `config.json`), so they never touch the real `~/Workshop` or `~/.workshop`. CI fails if either exists after the agent tests.

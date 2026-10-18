# Workshop agent

The one local process: it serves the Workshop UI at `http://127.0.0.1:<port>/`, keeps app data on disk, and hosts connectors. It implements [docs/agent-api.md](../docs/agent-api.md). Node 22 or later, standard library only, no npm install.

## Run it

```
node agent/start.mjs
```

It prints an address with a one-time token. Open it in Chrome or Edge on the same computer; the agent swaps the token for a cookie and drops it from the address. Stop it with `Ctrl+C`.

| Option | Meaning |
| --- | --- |
| `--port <n>` | Listen on this port for this run only. `config.json` is not changed. |
| `--quiet` | Do not print log lines to the console. They still go to the log file. |

Everything it writes is in `~/.workshop/` (`%USERPROFILE%\.workshop` on Windows), or in `WORKSHOP_HOME` if set. See [docs/config.md](../docs/config.md).

| Path | What |
| --- | --- |
| `config.json` | Settings. Created on first run with everything off. Edit by hand while the agent is stopped, or through Settings. |
| `token` | The per-install token. Readable by you only. |
| `data/<app>/<collection>.json` | App data. One file per collection, written atomically. |
| `data/_connectors/<id>/` | Each connector's private storage. |
| `logs/agent.log` | The log. Moves to `agent.1.log` past 5 MB. Never holds the token, PATs or data contents. |

Installers and start at login are WS7. Until then, start it by hand.

## What it does and does not do

- Binds `127.0.0.1` only, and refuses requests with a foreign `Host` or `Origin`.
- Makes no outbound request itself. Only connectors do, to hosts from their own config.
- Serves `shell/`, `shared/`, `icons/`, `apps/`, `index.html`, `manifest.webmanifest` and `sw.js`. Never the home folder, `agent/`, `connectors/`, `tests/`, `docs/` or dot files.
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
  store.mjs        app data on disk
  connectors.mjs   connector host and ctx
  events.mjs       the event stream
  static.mjs       static files
  log.mjs          log file with redaction
  http.mjs         errors, JSON and HTML responses, body reading
  fsutil.mjs       atomic writes, per-key locks
  schema.mjs       copy of tests/lib/schema.mjs
  connector-check.mjs  copy of tests/lib/connector-check.mjs
test/              the agent's own tests (disk, logs, static files, lifecycle, source rules)
```

`lib/schema.mjs` and `lib/connector-check.mjs` are copies, so the agent never loads code from `tests/` at run time. `test/source.test.mjs` fails if they drift. Change `tests/lib/` first (a C0-owned folder), then copy.

## Tests

```
node --test "agent/test/*.test.mjs"
WORKSHOP_TARGET=agent/test-target.mjs node --test "tests/contract/*.test.mjs"
```

On Windows PowerShell, set the variable first: `$env:WORKSHOP_TARGET = "agent/test-target.mjs"`. CI runs both on Windows, macOS and Linux.

# Config file

Version: `configVersion: 1`. Schema: [schemas/config.schema.json](schemas/config.schema.json).

## Location

Workshop keeps two folders apart:

- **The Workshop home, `~/.workshop/`**, holds what belongs to this computer and this install. Set `WORKSHOP_HOME` to use another folder.
- **The data folder, `dataDir`** (default `~/Workshop`), holds app data. The user owns it, can open, copy or back it up like any folder, and it stays when Workshop is removed. See [data-format.md](data-format.md), Data folder. `WORKSHOP_HOME` does not move it.

| Path | What |
| --- | --- |
| `~/.workshop/config.json` | This file. |
| `~/.workshop/token` | The per-install token. User-only permissions. Never shown in the UI or logs. |
| `~/.workshop/data/_connectors/<id>/<key>.json` | A connector's private storage, see [connector.md](connector.md). |
| `~/.workshop/data/<app>/...` | App data from before the data folder. Copied to `dataDir` once and kept, never deleted (see [data-format.md](data-format.md), Moving from `~/.workshop/data`). |
| `~/.workshop/logs/` | Agent logs. Never contain tokens, PATs or data contents. |
| `<dataDir>/<app>/...` | App data. |

## Shape

```json
{
  "configVersion": 1,
  "port": 4380,
  "dataDir": "/Users/alex/Workshop",
  "allowedOrigins": [],
  "features": {
    "startAtLogin": false,
    "hostedMode": false
  },
  "connectors": {
    "ado": {
      "enabled": false,
      "config": {}
    }
  }
}
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `configVersion` | `1` | `1` | Format version of this file. |
| `port` | integer, 1024 to 65535 | `4380` | The agent listens on `127.0.0.1:<port>`. Change takes effect after a restart. |
| `dataDir` | absolute path | `~/Workshop` (`%USERPROFILE%\Workshop` on Windows) | The data folder. See Data folder below. Change takes effect after a restart. |
| `allowedOrigins` | array of origins | `[]` | Origins other than the agent's own that may call the agent. Used only when `features.hostedMode` is on. Each is `https://<host>[:<port>]`, or `http://127.0.0.1:<port>` / `http://localhost:<port>` for testing. Lowercase, no path, no trailing slash, no wildcards. |
| `features.startAtLogin` | boolean | `false` | Start the agent when the user logs in (Startup folder shortcut on Windows, LaunchAgent on macOS). Per user, no admin. |
| `features.hostedMode` | boolean | `false` | Allow pages from `allowedOrigins` to pair with and call the agent. See [run-modes.md](run-modes.md). |
| `connectors.<id>.enabled` | boolean | `false` | Load and start this connector. |
| `connectors.<id>.config` | object | the connector's `configSchema` defaults | The connector's settings. Validated against its `configSchema`. Never holds secrets, only the names of environment variables that hold them. |

Everything that a company's security tooling might block (start at login, hosted mode, each connector) is off until the user turns it on. Turning one on never needs admin rights.

## Rules

- **Feature toggles are listed in the schema.** Adding a toggle is a docs change. Unknown keys under `features` are rejected.
- **Unknown top-level keys are kept.** The agent preserves keys it does not know when it rewrites the file, so an older agent does not erase a newer one's settings.
- **Secrets never go in this file.** PATs and tokens stay in environment variables. A connector's config holds the variable's name (for example `"patEnv": "ADO_PAT"`), never its value.
- **Writes are atomic.** The agent writes `config.json.tmp`, then renames it over `config.json`.
- **Edits by hand are fine.** The agent rereads the file on start. Changes made through the API apply right away, except `port` and `dataDir`.
- **Who can change it through the API:** only pages on the agent's own origin. Hosted origins get `403` with code `local_only`. See `PUT /api/config` in [agent-api.md](agent-api.md).

## Data folder

`dataDir` is where every app reads and writes its data, in every run mode that has the agent. Layout and file rules: [data-format.md](data-format.md), Data folder.

- **Default.** When `dataDir` is missing, the agent uses the `Workshop` folder in the user's home folder (`os.homedir()`): `~/Workshop` on macOS and Linux, `%USERPROFILE%\Workshop` on Windows. It is not under Documents, which a company may redirect to OneDrive. The agent does not write the default into `config.json`; `GET /api/config` returns the default when nothing is saved.
- **Absolute only.** An absolute POSIX path (`/...`), a Windows drive path (`C:\...` or `C:/...`) or a UNC path (`\\server\share\...`). No `~`, no relative paths, no environment variables. The schema checks the form; the agent checks the rest.
- **Not inside the Workshop home.** `dataDir` may not be `~/.workshop` (or `WORKSHOP_HOME`) or any folder inside it. Refused with `400 invalid_config` through the API, and stops the agent on start if set by hand.
- **Takes effect on the next start**, like `port`. `PUT /api/config` saves it and answers `restartRequired: true` if it differs from the folder in use. Until the restart, the agent keeps reading and writing the old folder, and `GET /api/config` shows the saved value. The agent never copies data between data folders; to move, copy the folder by hand (or let the user choose a folder that already holds it).
- **On start** the agent creates the folder (and parents) if it is missing. If it cannot create, read or write it, the agent prints what is wrong and stops. It never falls back to another folder, so data is never split without the user knowing.
- **Who can change it:** own origin only, like every config change. Hosted origins can read the path in `GET /api/config` but can never change it.
- **Workshop never syncs it.** Work and personal computers keep separate folders unless the user points them at the same one.

## Public view

`GET /api/config` returns the file minus connector configs, with `dataDir` always filled in (the saved value, or the default) and `home` (the Workshop home folder), so the Settings app can show them. Schema: [schemas/config-public.schema.json](schemas/config-public.schema.json). Example: [examples/config-public.default.json](examples/config-public.default.json).

Connector configs are read and written per connector through `GET` and `PUT /api/connectors/<id>/config`.

## Examples

- [examples/config.default.json](examples/config.default.json): a fresh install.
- [examples/config.hosted.json](examples/config.hosted.json): hosted mode on, one origin, ADO enabled.
- [examples/config.data-dir.json](examples/config.data-dir.json): a data folder on another drive.
- [examples/invalid/config.wildcard-origin.json](examples/invalid/config.wildcard-origin.json), [examples/invalid/config.unknown-feature.json](examples/invalid/config.unknown-feature.json), [examples/invalid/config.relative-data-dir.json](examples/invalid/config.relative-data-dir.json), [examples/invalid/config.tilde-data-dir.json](examples/invalid/config.tilde-data-dir.json): rejected.

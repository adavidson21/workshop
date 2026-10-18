# Config file

Version: `configVersion: 1`. Schema: [schemas/config.schema.json](schemas/config.schema.json).

## Location

`~/.workshop/` holds everything Workshop writes. Set `WORKSHOP_HOME` to use another folder.

| Path | What |
| --- | --- |
| `config.json` | This file. |
| `token` | The per-install token. User-only permissions. Never shown in the UI or logs. |
| `data/<app>/<collection>.json` | App data, see [data-format.md](data-format.md). |
| `data/_connectors/<id>/<key>.json` | A connector's private storage, see [connector.md](connector.md). |
| `logs/` | Agent logs. Never contain tokens, PATs or data contents. |

## Shape

```json
{
  "configVersion": 1,
  "port": 4380,
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
- **Edits by hand are fine.** The agent rereads the file on start. Changes made through the API apply right away, except `port`.
- **Who can change it through the API:** only pages on the agent's own origin. Hosted origins get `403` with code `local_only`. See `PUT /api/config` in [agent-api.md](agent-api.md).

## Public view

`GET /api/config` returns the file minus connector configs, plus the data folder path, so the Settings app can show it. Schema: [schemas/config-public.schema.json](schemas/config-public.schema.json). Example: [examples/config-public.default.json](examples/config-public.default.json).

Connector configs are read and written per connector through `GET` and `PUT /api/connectors/<id>/config`.

## Examples

- [examples/config.default.json](examples/config.default.json): a fresh install.
- [examples/config.hosted.json](examples/config.hosted.json): hosted mode on, one origin, ADO enabled.
- [examples/invalid/config.wildcard-origin.json](examples/invalid/config.wildcard-origin.json), [examples/invalid/config.unknown-feature.json](examples/invalid/config.unknown-feature.json): rejected.

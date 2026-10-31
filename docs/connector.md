# Connector module

Version: **`api: 1`**. A connector is the only code in Workshop that talks to an outside system (ADO, opencode, later GitHub or Jira). Apps never call outside systems; they call a connector through the agent.

## Where it lives

`connectors/<id>/index.mjs`, a plain ES module with no build step. The folder name is the connector's `id`. The agent loads only connectors enabled in `config.json` (`connectors.<id>.enabled`), but lists every connector it finds so the Settings app can offer to enable it.

The test fixture [tests/fixtures/connectors/echo/index.mjs](../tests/fixtures/connectors/echo/index.mjs) is a complete, minimal example. `tests/check-contracts.mjs` checks every `connectors/*/index.mjs` in the repo against this document.

## Exports

The module's default export is one object:

```js
export default {
  api: 1,
  id: 'ado',
  name: 'Azure DevOps',
  version: '1.0.0',
  configSchema: { /* see below */ },
  test: { action: 'workitem.get', arg: 'id', label: 'Work item ID' },
  actions: {
    'workitem.get': {
      title: 'Get a work item',
      write: false,
      argsSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      async run(args, ctx) { /* returns JSON-serializable data */ }
    }
  },
  async start(ctx) {},
  async stop() {},
  status() { return { state: 'ready', message: null }; }
};
```

| Export | Required | Meaning |
| --- | --- | --- |
| `api` | yes | `1`. The agent refuses a connector with another value and logs why. |
| `id` | yes | Matches `^[a-z][a-z0-9-]{0,39}$` and the folder name. |
| `name` | yes | Shown in Settings. |
| `version` | yes | The connector's own version, `major.minor.patch`. |
| `configSchema` | yes | JSON Schema for `connectors.<id>.config`, limited to the form subset below. `{type: 'object', properties: {}}` if there is nothing to set. |
| `actions` | yes | Map of action name to action. Names match `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`. |
| `start(ctx)` | yes | Called when the connector is enabled, at agent start, and after a config change. May be async. Must not throw for a bad config: report it in `status()` instead. |
| `stop()` | yes | Stop timers, close sockets, abort requests. Called before a restart, on disable, and at agent shutdown. Must finish within 5 seconds. |
| `status()` | yes | Returns `{state, message, details?}` synchronously. `state` is `starting`, `ready`, `stopped` or `error`. `message` is plain words or `null`. `details` is an optional small JSON object. The agent adds `since` and reports `disabled` itself when the connector is off. |
| `test` | no | `{action, arg, label}`: the Settings app shows a Test field labeled `label`. On submit it calls `action` with `{[arg]: <value>}` and shows the result. For ADO, enter a work item ID and see its title and project. `action` must be a read action. |

### Actions

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Plain words, shown in logs and Settings. |
| `write` | yes | `true` if the action changes anything outside Workshop (push, comment, state change). The agent then requires `confirm: true` from the caller. |
| `argsSchema` | no | JSON Schema (subset in [README.md](README.md)) for `args`. The agent validates before calling `run`. |
| `run(args, ctx)` | yes | Async. Returns JSON-serializable data, which becomes `result`. |

Errors: throw an `Error`. To pick the HTTP status and code, set `err.status` (400 to 599) and `err.code` (one of the codes in [agent-api.md](agent-api.md)). The message is shown to the user, so write it in plain words and never include secrets, tokens or full URLs with credentials.

## `ctx`

The agent creates one `ctx` per start and passes the same object to `start` and every `run` until the next `stop`.

| Member | Meaning |
| --- | --- |
| `ctx.config` | The connector's config, validated, defaults filled in, frozen. |
| `ctx.env(name)` | Returns the value of environment variable `name`, or `undefined`. Only names that appear in `ctx.config` under a field marked `x-workshop-env` are readable; any other name throws. This is how a connector gets a PAT. Never log, store, emit or return the value. |
| `ctx.log.info(msg, data?)`, `.warn`, `.error` | Writes to `~/.workshop/logs/` tagged with the connector id. The agent redacts the token and every `ctx.env` value it has handed out, but connectors must not pass them in the first place. |
| `ctx.storage.get(key)` | Async. The JSON value stored under `key`, or `undefined`. |
| `ctx.storage.put(key, value)` | Async. Stores a JSON value, atomically, in `~/.workshop/data/_connectors/<id>/<key>.json` (in the Workshop home, never the data folder). Keys match `^[a-z0-9][a-z0-9._-]{0,63}$`. Private to this connector. |
| `ctx.emit(event, payload)` | Sends a `connector` event on `/api/events` with `{id, event, payload}`. `event` matches `^[a-z][a-zA-Z0-9.-]{0,63}$`. Payload is JSON, under 64 KB, no secrets. |
| `ctx.statusChanged()` | Tells the agent to call `status()` again and send `connector-status`. |
| `ctx.signal` | An `AbortSignal` aborted when `stop()` is called. Pass it to `fetch`. |
| `ctx.home` | The Workshop home folder (read-only use, for example to find a workspace path from config). |

## Rules

- **Outbound calls only to configured hosts.** A connector calls only hosts that come from its config (an ADO server URL, `127.0.0.1` for opencode). No telemetry, no update checks, no third-party CDNs.
- **Read-only by default.** Anything that changes an outside system is an action with `write: true`.
- **No secrets in config.** A secret is always an environment variable named by a field marked `x-workshop-env`.
- **No shared state.** Connectors do not import each other or the agent's internals. They get everything through `ctx`.
- **Node standard library only,** unless the workstream brief allows a dependency.
- **Company specifics live in config.** No collection URLs, projects, teams or origins in code.

## Config schema and the settings form

The Settings app (WS4) builds each connector's form from `configSchema` alone, so the schema must stay inside a subset that maps to form controls. [schemas/config-form.schema.json](schemas/config-form.schema.json) is the meta-schema; `tests/check-contracts.mjs` checks every connector's `configSchema` against it.

| Schema | Form control |
| --- | --- |
| `type: "string"` | Text field. `format: "uri"` makes it a URL field. `x-workshop-multiline: true` makes it a text area. |
| `type: "string"` with `enum` | Select. `x-workshop-labels` (same length as `enum`) gives the option labels. |
| `x-workshop-hosted: true` on any field | A paired hosted page may change this field (`PUT /api/connectors/<id>/config`). Unmarked fields change only from the agent's own origin. Never mark a field that names a server, a command, a file to read, or an environment variable. |
| `type: "string"` with `x-workshop-env: true` | Environment variable name field. The form shows the name and whether it is set (from `env` in `GET /api/connectors/<id>/config`). There is no field for the value. |
| `type: "integer"` or `"number"` | Number field, with `minimum` and `maximum`. |
| `type: "boolean"` | Checkbox or switch. |
| `type: "array"` of strings | List of text fields with add and remove. |
| `type: "array"` of objects | Repeating group (a table or a list of cards) with add and remove. |
| `type: "object"` | Fieldset. Nesting is limited to 3 levels. |

Every property has a `title`. `description` becomes help text. `default` fills new forms. Properties appear in the order written. `required` marks required fields. Every object sets `additionalProperties: false`.

Example (ADO, abbreviated; full example in [examples/config-form.ado.json](examples/config-form.ado.json)):

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "connections": {
      "type": "array",
      "title": "Connections",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "serverUrl", "collection", "patEnv"],
        "properties": {
          "name": {"type": "string", "title": "Name"},
          "serverUrl": {"type": "string", "format": "uri", "title": "Server URL"},
          "collection": {"type": "string", "title": "Collection"},
          "project": {"type": "string", "title": "Project"},
          "patEnv": {"type": "string", "title": "PAT environment variable", "x-workshop-env": true, "default": "ADO_PAT"}
        }
      }
    }
  }
}
```

## Lifecycle

1. Agent start: load every `connectors/*/index.mjs`, check exports. A broken module is listed with `state: "error"` and a message; it never stops the agent.
2. For each enabled connector: validate its config (fill defaults), build `ctx`, call `start(ctx)`.
3. Config change (`PUT /api/connectors/<id>/config`): `stop()`, abort `ctx.signal`, new `ctx`, `start(ctx)`.
4. Disable (`PUT /api/config`): `stop()`. Status becomes `disabled`.
5. Agent shutdown: `stop()` on every running connector.

Every status change sends `connector-status` on the event stream.

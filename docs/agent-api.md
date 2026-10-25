# Agent HTTP API

Version: **`api: 1`**. Implemented by the Workshop agent (WS1) and by `tests/mock-agent.mjs`. Both must pass `tests/contract/`.

## Basics

- Base URL: `http://127.0.0.1:<port>` (default port `4380`, from [config.md](config.md)). The agent binds `127.0.0.1` only.
- Bodies are JSON (`application/json; charset=utf-8`), except the event stream and static files.
- Every `/api/*` response sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Body limits: `10 MB` for `PUT /api/data/...`, `64 MB` for `PUT /api/files/...` (whose decoded `content` may be at most 10 MB, see Files), `1 MB` for every other body. Larger bodies get `413`.
- Clients ignore response fields they do not know.

### Errors

Every error is a 4xx or 5xx status with this body ([schemas/error.schema.json](schemas/error.schema.json)):

```json
{"error": "That collection changed since you loaded it. Reload and try again.", "code": "conflict"}
```

`error` is plain words a person can read. `code` is one of:

| Code | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | Malformed JSON, bad name, or a body that fails its schema. |
| `invalid_config` | 400 | A config change fails the config schema or the connector's `configSchema`. |
| `confirm_required` | 400 | A write action was called without `confirm: true`. |
| `downgrade` | 400 | A data put tried to lower the collection's `version`. |
| `unauthorized` | 401 | Missing or wrong token, or a write without the token header. |
| `forbidden` | 403 | Foreign `Host` or `Origin`, or hosted mode is off. |
| `local_only` | 403 | Only the agent's own origin may do this. |
| `not_found` | 404 | No such collection, connector, action or route. |
| `method_not_allowed` | 405 | Wrong method for the route. |
| `conflict` | 409 | The data `rev` or file `mtime` is stale, or a file to create already exists. The body also has `current`. |
| `too_large` | 413 | The body is over the limit. |
| `disabled` | 503 | The connector is not enabled. |
| `unavailable` | 503 | The connector is enabled but not ready (starting, or in error). |
| `internal` | 500 | Anything else. The message never includes secrets or stack traces. |

## Security

### Host and Origin

- **Host.** The agent answers only when `Host` is `127.0.0.1:<port>` or `localhost:<port>`. Anything else gets `403 forbidden`. This blocks DNS rebinding.
- **Origin.** A request with an `Origin` header is refused with `403 forbidden` unless the origin is the agent's own (`http://127.0.0.1:<port>` or `http://localhost:<port>`), or `features.hostedMode` is on and the origin is in `allowedOrigins`.
- **CORS** is sent only for an allowed hosted origin: `Access-Control-Allow-Origin: <that origin>` (never `*`), `Vary: Origin`. Preflight (`OPTIONS`) answers `204` with `Access-Control-Allow-Methods: GET, PUT, POST, DELETE`, `Access-Control-Allow-Headers: Content-Type, X-Workshop-Token, X-Workshop-Client`, `Access-Control-Allow-Private-Network: true`, `Access-Control-Max-Age: 600`. No credentials are allowed cross-origin; hosted pages use the header token.

### Token

One random token per install, in `~/.workshop/token`. It never appears in logs or in any response except `GET /api/session` and the pair page.

| How a request carries it | Accepted on |
| --- | --- |
| Cookie `workshop_token` (HttpOnly, SameSite=Strict, Path=/) | `GET` requests from the agent's own origin, or with no `Origin` header |
| Header `X-Workshop-Token: <token>` | Every request. **Required on every `PUT`, `POST` and `DELETE`.** |
| Query `?token=<token>` | `GET /api/events` only, for `EventSource` from a hosted page, which cannot set headers |

Everything under `/api/` needs the token except `GET /api/health`.

**Getting the cookie.** The agent's launcher opens `http://127.0.0.1:<port>/?token=<token>`. On any non-API `GET` with a correct `token` query, the agent sets the cookie (`Max-Age` one year) and answers `303` to the same URL without `token`. A wrong token gets no cookie and no error page detail.

**Getting the header token.** A page on the agent's own origin calls `GET /api/session` (the cookie authenticates it) and sends the returned token as `X-Workshop-Token`. Hosted pages get it by pairing ([run-modes.md](run-modes.md)).

### Client id

Writers may send `X-Workshop-Client: <id>` (letters, digits, `_` and `-`, up to 64). The agent copies it into the `data` and `file` events, so a window can ignore events caused by its own writes.

## Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | Is this the agent, and which API version |
| `GET /api/session` | cookie (own origin) | The token for the header |
| `GET /pair?origin=<origin>` | cookie | Hosted pairing page (HTML) |
| `GET /api/apps` | token | Installed apps |
| `GET /api/data/<app>` | token | Collections of one app |
| `GET /api/data/<app>/<collection>` | token | Read a collection |
| `PUT /api/data/<app>/<collection>` | header token | Write a collection |
| `GET /api/files/<app>` | token | List an app's files |
| `GET /api/files/<app>/<folder>` | token | List the files under a folder |
| `GET /api/files/<app>/<path>` | token | Read a file |
| `PUT /api/files/<app>/<path>` | header token | Create or replace a file |
| `DELETE /api/files/<app>/<path>` | header token | Move a file to the trash |
| `GET /api/connectors` | token | All known connectors |
| `GET /api/connectors/<id>` | token | One connector |
| `POST /api/connectors/<id>/<action>` | header token | Run an action |
| `GET /api/connectors/<id>/config` | token | A connector's config, form schema, env status |
| `PUT /api/connectors/<id>/config` | header token, own origin only | Change a connector's config |
| `GET /api/config` | token | Public view of `config.json` |
| `PUT /api/config` | header token, own origin only | Change features, origins, connector on/off, port |
| `GET /api/events` | token (cookie, header or query) | Server-sent event stream |

Names in paths: `<app>` and connector `<id>` match `^[a-z][a-z0-9-]{0,39}$`. Action names match `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$` (for example `sync`, `workitem.get`). Anything else gets `400 bad_request`, except an unknown well-formed name, which gets `404 not_found`.

Nested names ([data-format.md](data-format.md), Names) are sent as path segments, with a plain `/` between them:

- `<collection>` is 1 to 4 segments: `/api/data/receipts/entries/jordan-lee/y2026`.
- `<path>` is 1 to 4 segments, the last ending in `.md` or `.json`: `/api/files/receipts/summaries/jordan-lee/h2-2026.md`.
- `<folder>` is 1 to 3 segments with no extension: `/api/files/receipts/summaries/jordan-lee`.

The agent checks the path as the client sent it, before any normalization, one segment at a time, each segment percent-decoded on its own. A segment that is empty (`//`, a trailing `/`), `.` or `..` (raw or encoded as `%2e`), contains `/` or `\` once decoded (`%2F`, `%5C`), or otherwise breaks the name rules gets `400 bad_request`. So does a path with more than 4 segments after the app, a drive letter or any absolute form. A path that, after following symbolic links and junctions, leads outside the data folder also gets `400 bad_request`, whether or not the file exists.

### `GET /api/health`

No token. Schema [health](schemas/health.schema.json), example [health.ok.json](examples/health.ok.json).

```json
{"app": "workshop-agent", "api": 1, "version": "0.1.0"}
```

Check `app` before trusting anything else at that address.

### `GET /api/session`

Cookie only, from the agent's own origin (or no `Origin`). From any other origin: `403 forbidden`. Schema [session](schemas/session.schema.json), example [session.ok.json](examples/session.ok.json).

```json
{"api": 1, "token": "3f9c...", "agentOrigin": "http://127.0.0.1:4380"}
```

### `GET /pair?origin=<origin>`

HTML, not JSON. See [run-modes.md](run-modes.md), Pairing.

| Situation | Status |
| --- | --- |
| No agent cookie | `401`, page says to open Workshop on this computer first |
| `features.hostedMode` off, or origin not in `allowedOrigins`, or `origin` missing or malformed | `403`, page says which |
| Allowed | `200`, page with the origin, an Allow button and the pairing script |

Every pair response sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.

### `GET /api/apps`

Apps found in `apps/*/app.json`, ordered by `order` then `name`. Schema [apps-response](schemas/apps-response.schema.json), example [apps-response.two-apps.json](examples/apps-response.two-apps.json).

```json
{"apps": [{"base": "/apps/prioritizer/", "manifest": {"manifestVersion": 1, "id": "prioritizer", "name": "Prioritizer", "version": "3.0.0", "icon": "icon.svg", "entry": "index.html"}}]}
```

`base` is where the agent serves that app's folder. A folder whose `app.json` fails [schemas/app.schema.json](schemas/app.schema.json), or whose `id` does not match the folder name, is skipped and logged.

For hosted and browser modes, the static site carries `apps/registry.json` with the same shape, written when the site is published (WS7). The agent never reads it.

### `GET /api/data/<app>`

Lists every collection of the app, nested ones included, sorted by name. Only collection files are listed ([data-format.md](data-format.md), What is a collection); other files, damaged files and names that break the rules are left out (damaged files are logged). Schema [data-list](schemas/data-list.schema.json), example [data-list.prioritizer.json](examples/data-list.prioritizer.json).

```json
{"app": "prioritizer", "collections": [{"collection": "tasks", "schema": "prioritizer.tasks", "version": 2, "rev": 14, "updatedAt": "2026-10-18T13:02:11.000Z", "items": 42}]}
```

An app with no data returns an empty list, not `404`.

### `GET /api/data/<app>/<collection>`

Returns the envelope ([data-format.md](data-format.md), schema [data-envelope](schemas/data-envelope.schema.json)). A collection that was never written gets `404 not_found`.

### `PUT /api/data/<app>/<collection>`

Body: the full envelope. `rev` in the body is the revision the writer started from (`0` to create).

The agent:

1. Checks the body against [data-envelope](schemas/data-envelope.schema.json), that `schema` is `<app>.<collection>` (the full nested name), and that item `id`s are unique. Failure: `400 bad_request`. A file at that path that is not a collection (a damaged collection, or a plain `.json` file written through the files API) is never written over: `500 internal` for a file that cannot be read as a collection.
2. Compares `rev` with the stored revision (`0` if none). Different: `409 conflict` with the stored envelope as `current` ([data-conflict](schemas/data-conflict.schema.json)), or, if nothing is stored, an empty envelope with `rev: 0`. No partial writes.
3. Refuses a lower `version` than the stored one: `400 downgrade`. On a higher `version`, keeps a copy of the stored file at `<dataDir>/.backups/<yyyy-mm-dd>/<app>/<collection>.v<old version>.json` before writing ([data-format.md](data-format.md), Migrations).
4. Sets `rev` to the stored revision plus 1 and `updatedAt` to now (ISO 8601, UTC), whatever the body said. Never changes `items`, `deleted` or `meta`.
5. Writes `<dataDir>/<app>/<collection>.json` atomically (temp file, then rename), creating subfolders for nested names, then sends a `data` event.

Response `200` ([data-put-response](schemas/data-put-response.schema.json)):

```json
{"rev": 15, "updatedAt": "2026-10-18T13:05:00.000Z"}
```

Apps write only their own collections. Any app may read another app's collections (for example the People app reading Prioritizer tasks). The agent cannot tell apps apart, so this is a rule for app code, enforced in review and by the SDK (`data.put` has no `app` option).

## Files

For app files that are not envelopes, such as Markdown summaries or a JSON file another tool reads. Files live in the data folder next to the app's collections: `<dataDir>/<app>/<path>`. Rules shared with collections are in [data-format.md](data-format.md), Data folder.

- **Extensions:** `.md` and `.json` only. Anything else gets `400 bad_request`.
- **Text:** content is UTF-8 text. A `.json` file's content must parse as JSON (`400 bad_request` otherwise). A `.md` file's content is not checked.
- **Size:** at most 10 MB (10,485,760 bytes of UTF-8) per file. A larger `content` gets `413 too_large`; reading a file that grew past that outside Workshop also gets `413 too_large` (it is still listed).
- **Modified time:** `mtime` is the file's modified time in whole milliseconds since 1970 (UTC), as the file system reports it, rounded down. Every response that describes a file carries it. After every write the agent makes sure the new `mtime` differs from the one before (if the clock or the file system would give the same value, it sets the time 1 ms later), so an `mtime` you read always names one version of the file.
- **Not collections:** the files API never reads, writes, lists or trashes a collection file, and refuses `.json` content that is an envelope for its own path. Both get `400 bad_request`. Use the data API for those.
- **Who:** the same as `/api/data`. Any page with the token, including a paired hosted origin, may list and read any app's files and write and trash files. As with data, apps write only their own app's files; the SDK enforces that.

### `GET /api/files/<app>` and `GET /api/files/<app>/<folder>`

Lists the app's files, or the files under one folder, at every depth, sorted by `path`. Paths are relative to the app folder and use `/`. A missing app or folder gives an empty list, not `404`. Schema [file-list](schemas/file-list.schema.json), example [file-list.summaries.json](examples/file-list.summaries.json).

```json
{"app": "receipts", "files": [{"path": "summaries/jordan-lee/h2-2026.md", "mtime": 1792937100000, "size": 61}]}
```

### `GET /api/files/<app>/<path>`

Schema [file](schemas/file.schema.json), example [file.summary.json](examples/file.summary.json). A missing file gets `404 not_found`.

```json
{"app": "receipts", "path": "summaries/jordan-lee/h2-2026.md", "mtime": 1792937100000, "size": 61, "content": "# Jordan Lee, 2026 H2\n"}
```

### `PUT /api/files/<app>/<path>`

Body ([file-put](schemas/file-put.schema.json)): `content` and exactly one of:

- `"mtime": <the mtime you read>` to replace a file. If the file's `mtime` is different, or the file is gone, the agent answers `409 conflict` with `current`: the file as it is now ([file](schemas/file.schema.json)), or `null` if it does not exist.
- `"create": true` to create a file that must not exist yet. If it exists, `409 conflict` with `current` set to it.

```json
{"content": "# Jordan Lee, 2026 H2\n", "create": true}
```

Conflict body: [file-conflict](schemas/file-conflict.schema.json), examples [file-conflict.changed.json](examples/file-conflict.changed.json), [file-conflict.exists.json](examples/file-conflict.exists.json), [file-conflict.gone.json](examples/file-conflict.gone.json). No partial writes.

On success the agent writes atomically (temp file, then rename), creating folders as needed, sends a `file` event, and answers `200` ([file-put-response](schemas/file-put-response.schema.json)):

```json
{"app": "receipts", "path": "summaries/jordan-lee/h2-2026.md", "mtime": 1792937160000, "size": 61}
```

### `DELETE /api/files/<app>/<path>`

Moves the file to the trash, `<dataDir>/.trash/<app>/<path without extension>.<stamp>.<ext>` ([data-format.md](data-format.md), Trash). Never removes it. Optional query `?mtime=<the mtime you read>`: if the file's `mtime` is different, `409 conflict` with `current` and nothing moves. A missing file gets `404 not_found`. Sends a `file` event with `mtime: null`. Response `200` ([file-delete-response](schemas/file-delete-response.schema.json)):

```json
{"app": "receipts", "path": "summaries/jordan-lee/h2-2026.md", "trash": ".trash/receipts/summaries/jordan-lee/h2-2026.20261025T140500123Z.md"}
```

### `GET /api/connectors` and `GET /api/connectors/<id>`

Every connector in `connectors/*/index.mjs`, enabled or not. Schemas [connectors-response](schemas/connectors-response.schema.json), [connector-info](schemas/connector-info.schema.json). Example [connectors-response.mixed.json](examples/connectors-response.mixed.json).

```json
{"connectors": [{"id": "ado", "name": "Azure DevOps", "version": "1.0.0", "enabled": true,
  "status": {"state": "ready", "message": null, "since": "2026-10-18T13:00:00.000Z"},
  "actions": [{"name": "workitem.get", "title": "Get a work item", "write": false}],
  "test": {"action": "workitem.get", "arg": "id", "label": "Work item ID"}}]}
```

`status.state` is one of `disabled`, `stopped`, `starting`, `ready`, `error`. A connector that is not enabled always reports `disabled`.

### `POST /api/connectors/<id>/<action>`

Body ([connector-call-request](schemas/connector-call-request.schema.json)):

```json
{"args": {"id": 41207}, "confirm": false}
```

- `args` defaults to `{}`. If the action has an `argsSchema`, the agent validates `args` first (`400 bad_request`).
- An action with `write: true` changes something outside Workshop. It needs `"confirm": true`, which the app sends only after the user clicked something that says what will happen. Without it: `400 confirm_required`.
- Not enabled: `503 disabled`. Enabled but not `ready`: `503 unavailable`.
- An error thrown by the action becomes `{error, code}`, with the status and code from the error if it has them (see [connector.md](connector.md)), else `500 internal`.

Response `200` ([connector-call-response](schemas/connector-call-response.schema.json)):

```json
{"result": {"id": 41207, "title": "Fix login timeout", "type": "Bug", "project": "Web", "connection": "work"}}
```

### `GET /api/connectors/<id>/config`

Schema [connector-config](schemas/connector-config.schema.json), example [connector-config.ado.json](examples/connector-config.ado.json).

```json
{"id": "ado", "schema": {"type": "object", "properties": {}}, "config": {}, "env": {"ADO_PAT": {"set": true}}}
```

- `schema` is the connector's `configSchema`, enough to build its settings form ([connector.md](connector.md)).
- `config` is the stored config with schema defaults filled in.
- `env` has one entry per environment variable *named* in `config` (every value of a field marked `x-workshop-env`). It says only whether the variable is set and not empty. **The value is never returned, logged, or written anywhere.**
- Works whether or not the connector is enabled.

### `PUT /api/connectors/<id>/config`

Body ([connector-config-put](schemas/connector-config-put.schema.json)):

```json
{"config": {"connections": [{"name": "work", "serverUrl": "https://ado.example.com", "collection": "Main", "project": "Web", "patEnv": "ADO_PAT"}]}}
```

Own origin only: from a hosted origin, `403 local_only`. A connector config names servers and environment variables, so a script on a hosted origin that could change it could point a connector at another server and send it any environment variable.

The agent validates `config` against the connector's `configSchema` (unknown keys are rejected: `400 invalid_config`), saves it to `config.json`, and if the connector is enabled, calls `stop()` then `start(ctx)` with the new config. Response: the same shape as `GET`.

### `GET /api/config`

The public view of `config.json` ([config.md](config.md), schema [config-public](schemas/config-public.schema.json)). Never includes the token or connector configs.

### `PUT /api/config`

Own origin only: from a hosted origin, `403 local_only`. Body ([config-patch](schemas/config-patch.schema.json)), every field optional:

```json
{"features": {"hostedMode": true}, "allowedOrigins": ["https://work.example.org"], "connectors": {"ado": {"enabled": true}}}
```

`dataDir` may also be sent ([examples/config-patch.data-dir.json](examples/config-patch.data-dir.json)).

- `features` and `connectors` merge into what is there. `allowedOrigins` replaces the list.
- Enabling a connector starts it; disabling stops it. Each change sends a `connector-status` event.
- A `port` or `dataDir` change is saved and takes effect on restart; `restartRequired` is `true` if the new value differs from what the agent is using. `dataDir` must be an absolute path outside the Workshop home ([config.md](config.md), Data folder), else `400 invalid_config`.

Response ([config-put-response](schemas/config-put-response.schema.json)):

```json
{"config": {"configVersion": 1, "port": 4380, "dataDir": "/Users/alex/Workshop", "allowedOrigins": [], "features": {"startAtLogin": false, "hostedMode": false}, "connectors": {}, "home": "/Users/alex/.workshop"}, "restartRequired": false}
```

### `GET /api/events`

Server-sent events (`Content-Type: text/event-stream`, `Cache-Control: no-store`). One stream carries everything. Every event's `data` is one line of JSON. Schema [event](schemas/event.schema.json) (each example is `{"event": <name>, "data": <payload>}`).

| Event | Payload | When |
| --- | --- | --- |
| `hello` | `{"api": 1, "version": "0.1.0"}` | First, on every connection |
| `data` | `{"app", "collection", "rev", "updatedAt", "client"}` | After every successful data put. `client` is the writer's `X-Workshop-Client`, or `null`. Also when a collection file changes outside Workshop, with `rev`, `updatedAt` and `client` all `null` (see below). |
| `file` | `{"app", "path", "mtime", "client"}` | After every successful file put (`mtime` is the new one) and delete (`mtime` is `null`). `client` as for `data`. Also when a file changes outside Workshop, with `client: null`. |
| `connector` | `{"id", "event", "payload"}` | A connector called `ctx.emit(event, payload)` |
| `connector-status` | `{"id", "status"}` | A connector's status changed (enabled, disabled, started, stopped, error, `ctx.statusChanged()`) |
| `config` | `{"changed": ["features", "allowedOrigins", "connectors", "port", "dataDir"]}` | After `PUT /api/config` or a connector config change (`"connector:<id>"`) |

Wire format:

```
event: data
data: {"app":"prioritizer","collection":"tasks","rev":15,"updatedAt":"2026-10-18T13:05:00.000Z","client":"w-7f3a"}

```

- A comment line (`: ping`) every 15 seconds keeps proxies from closing the stream.
- No replay. After a reconnect, clients refetch what they show.
- Event payloads never contain collection or file contents, or secrets. Clients fetch data with `GET`.

### Changes made outside Workshop

The agent watches the data folder while it runs. When a collection or file is changed, added or removed by anything other than the agent itself (an editor, a script, a sync tool), it sends:

- a `data` event for a collection file: `{"app", "collection", "rev": null, "updatedAt": null, "client": null}` ([example](examples/event.data-external.json));
- a `file` event for any other `.md` or `.json` file: `{"app", "path", "mtime", "client": null}`, with the new `mtime`, or `null` if it was removed ([example](examples/event.file-external.json)).

A removed `.json` file is reported as whichever it was last known to be. Rules:

- **It means "re-read".** The event never carries contents. A client that shows that collection or file reads it again and merges, as for any other write. `rev` is `null` because a hand edit may not have changed it.
- **Debounce.** The agent waits until a path has had no change for 300 ms, then sends one event for it. A burst of saves (an editor writing a temp file and renaming it) gives one event. Expect the event within about a second of the last change.
- **Not for its own writes.** Changes the agent made itself (puts, trash moves, backups, the copy from `~/.workshop/data`) do not cause a `client: null` event; they already sent their own.
- **Only what Workshop sees.** Paths it ignores ([data-format.md](data-format.md), What Workshop ignores), including `.trash/`, `.backups/` and `*.tmp`, send nothing.
- **Best effort.** If the operating system drops watch notifications (for example on some network drives), events can be missed. Clients still refetch after a reconnect, and the folder backend's 5-second check covers browser mode.

## Static files

The agent serves `shell/`, `apps/`, `shared/`, and the repo root's `index.html`, `manifest.webmanifest`, `sw.js` and `icons/`. It never serves `~/.workshop/`, the data folder, `connectors/`, `agent/`, `tests/` or dot files. Data and files are reachable only through `/api/data` and `/api/files`. Requests that try to leave those folders (`..`, encoded or not) get `404`.

Static responses use the same Host and Origin checks. Security headers for pages (CSP and others) are defined by WS7 in `docs/security.md`.

## Service worker

The service worker never caches `/api/*` or `/pair`, and never handles the event stream. See [run-modes.md](run-modes.md), Service worker rules.

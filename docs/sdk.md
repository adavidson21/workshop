# Workshop SDK

Version: **`sdk: 1`**. Implemented in `shared/workshop-sdk.js` (WS4). Apps use the SDK for everything that leaves the app: navigation, toasts, badges, notifications, commands, theme, data, files and connectors. Apps never touch the data folder directly. No ad hoc `postMessage`, no direct `fetch` to the agent.

## Connecting

```js
import { connect } from '../../shared/workshop-sdk.js';

const ws = await connect({ app: 'prioritizer' });
ws.mode;     // 'local' | 'hosted' | 'browser'
ws.backend;  // 'agent' | 'browser'
ws.storage;  // 'agent' | 'folder' | 'indexeddb'
ws.online;   // false while the agent (or, with the folder store, the folder) is unreachable
ws.embedded; // true inside the shell, false when the app page is opened on its own
```

`connect` picks the backend as described in [run-modes.md](run-modes.md), gets the token if needed, and sends the shell a `ready` request. It resolves once both are done. `app` must match the app's `app.json` `id`.

## API

All methods that talk to the shell or the agent return promises. Failures reject with a `WorkshopError` that has `code` (from [agent-api.md](agent-api.md), Errors), `message` (plain words) and, for HTTP failures, `status`.

### Shell

| Method | Meaning |
| --- | --- |
| `ws.open(target)` | Go to another app or a route. `target` is `{app, path?}`, for example `{app: 'agents', path: '41207'}`. Same as `#/agents/41207`. |
| `ws.toast(text, {kind?, action?})` | Short message at the bottom of the shell. `kind`: `info` (default), `success`, `warn`, `error`. `action: {label, command}` adds a button that sends the app a `command` event. |
| `ws.badge(count)` | Count on the app's rail icon. Integer 0 to 999, or `null` to clear. `0` also clears. |
| `ws.notify({title, body?, route?})` | System notification if the user allowed them, else a toast. Clicking it opens `route` in this app. |
| `ws.commands.register({id, title, shortcut?})` | Adds a command to the shell palette (`Ctrl+K`). Returns an unregister function. `id` is unique within the app; the shell scopes it to the app. Running it sends the app a `command` event. |
| `ws.theme.current()` | `{key, scheme}`. `key` is a theme from `shared/themes.css` (`light`, `dark`, or `system`); `scheme` is `light` or `dark`. |
| `ws.on(event, handler)` | Subscribe to `theme`, `route`, `command`, `visible` or `online`. Returns an unsubscribe function. |

Events:

| Event | Payload | When |
| --- | --- | --- |
| `theme` | `{key, scheme}` | The user changed the theme. Apps that use `shared/themes.css` and `data-theme` get it applied automatically; the event is for canvas and charts. |
| `route` | `{path}` | The part of the hash after `#/<app>/` changed, including on first show. |
| `command` | `{id}` | A palette command, shortcut, manifest command or toast action for this app ran. |
| `visible` | `{visible}` | The app was shown or hidden in the shell. |
| `online` | `{online}` | The agent became reachable or unreachable. |

### Data

| Method | Meaning |
| --- | --- |
| `ws.data.get(collection, {app?})` | `collection` may be nested: `'entries/person-one/2026'` ([data-format.md](data-format.md), Names); the SDK sends each segment as a path segment. The envelope ([data-format.md](data-format.md)), or `null` if it was never written. `app` defaults to this app; another app's collections are read-only. |
| `ws.data.put(collection, envelope)` | Writes this app's collection. `envelope.rev` is the revision you read (`0` to create). Resolves `{rev, updatedAt}`. On a stale `rev` rejects with code `conflict` and `err.current` set to the stored envelope: merge (below) and put again with `current.rev`. |
| `ws.data.subscribe(collection, handler, {app?})` | Calls `handler({app, collection, rev, updatedAt, client})` after every write by anyone else, and after a change made outside Workshop (then `rev`, `updatedAt` and `client` are `null`: re-read). Writes made through this `ws` are filtered out using the client id. Returns an unsubscribe function. |
| `ws.data.merge(local, remote)` | Merges two envelopes of the same `schema` and `version` with the change-stamp rules in [data-format.md](data-format.md). Returns a new envelope with `remote.rev`. Pure. |
| `ws.data.stamp(before, after)` | Sets `updatedAt` on items that changed between two envelopes and adds tombstones for removed items. The same rules as Prioritizer's `stampChanges`. Returns `after`. |
| `ws.data.export({apps?})` | A bundle of every collection (or those of the listed apps). |
| `ws.data.import(bundle)` | Merges a bundle in. Collections that do not exist are created; existing ones are merged and put. Resolves `{created, merged}` (counts). |

Bad names reject with `bad_request` before any request is made. The SDK sends `X-Workshop-Client` on every write and the token header on every agent request.

### Files

For app files that are not envelopes, such as Markdown summaries. Same folder, rules and limits as [agent-api.md](agent-api.md), Files: `.md` and `.json` only, up to 4 segments, 10 MB, never a collection. `path` is relative to the app folder, for example `'summaries/person-one/2026-h2.md'`. A file is `{app, path, mtime, size, content}`; `mtime` is the version token, like `rev` for collections.

| Method | Meaning |
| --- | --- |
| `ws.files.list(folder?, {app?})` | `[{path, mtime, size}]` for every file of the app, or under `folder` (`'summaries/person-one'`), at every depth, sorted by path. `[]` if there are none. |
| `ws.files.read(path, {app?})` | The file, or `null` if it does not exist. `app` defaults to this app; another app's files are read-only. |
| `ws.files.write(path, content, {mtime} \| {create: true})` | Writes this app's file. Pass the `mtime` you read to replace it, or `create: true` to create one that must not exist. Resolves `{app, path, mtime, size}`. If the file changed, is gone, or (with `create`) already exists, rejects with code `conflict` and `err.current` set to the file as it is now, or `null` if it does not exist: read the change, decide, and write again with `current.mtime` (or `create: true` if `current` is `null`). |
| `ws.files.trash(path, {mtime?})` | Moves this app's file to the trash; never removes it. With `mtime`, rejects with `conflict` (and `err.current`) if the file changed. Resolves `{app, path, trash}`. |
| `ws.files.subscribe(pathOrFolder, handler, {app?})` | Calls `handler({app, path, mtime, client})` after a write or trash by anyone else, or a change made outside Workshop (`client: null`), to that file or any file under that folder. `mtime` is `null` when the file is gone. Writes made through this `ws` are filtered out. Returns an unsubscribe function. |

Write loop for a file:

```
read   -> {content, mtime: m}
write  -> write(path, edited, {mtime: m}) -> ok {mtime: m2}             done
       -> conflict: err.current is the newer file (or null): show or merge, write again with its mtime
```

### Folder

For the shell and the Settings app, with the browser backend's folder store ([run-modes.md](run-modes.md), Browser backend). Other apps never call these.

| Method | Meaning |
| --- | --- |
| `ws.folder.status()` | `{storage, name, permission, moved, missing}`. `storage` is `ws.storage`. `name` is the folder's name (browsers do not reveal its full path), or `null`. `permission` is `'granted'`, `'prompt'` or `'denied'` for the folder store, else `null`. `moved` is `true` if the IndexedDB store was copied into a folder. `missing` is `true` if the saved folder is gone (moved, renamed, deleted, or its drive is missing), else `false`. With the agent, `name` is the agent's `dataDir` from `ws.config.get()`, `moved` and `missing` are `false`. |
| `ws.folder.choose()` | Call only from a click. Opens Chrome's folder picker, asks for read and write access, copies the IndexedDB store in (old copy kept, marked moved), saves the handle and reloads the page. Rejects with `unavailable` with the agent (change `dataDir` in settings instead) or in a browser without the File System Access API, and with `bad_request` if the user cancels. |
| `ws.folder.allow()` | Call only from a click. Asks Chrome again for access to the saved folder. Resolves the new `status()`. On `'granted'`, `ws.online` turns `true` and an `online` event fires. |
| `ws.folder.lastMove()` | What the last `choose()` copied, read once on the page that loads after its reload, then cleared; `null` otherwise. Kept in `sessionStorage`, so only the tab that chose sees it. `{folder, alreadyMoved, collections: {created, merged, skipped}, files: {created, same, renamed}}`: `created`, `merged` and `same` list `<app>/<name>`; `skipped` is `[{name, reason}]` (a collection whose `version` differs from the folder's copy); `renamed` is `[{from, to}]` (a browser file written beside a different one, as `-from-browser`). `alreadyMoved` is `true` when the IndexedDB store was marked moved before, so nothing was copied. Settings shows it as the summary of the move. |

`ws.on('online', ...)` fires when folder access is lost or regained, as it does for the agent.

The shell shows the access bar ([run-modes.md](run-modes.md), Access) without connecting as an app, so the SDK also exports two functions for it. Apps use `ws.folder` instead.

```js
import { folderState, allowFolder } from '../shared/workshop-sdk.js';
```

| Function | Meaning |
| --- | --- |
| `folderState()` | `{storage, name, permission, missing}` for this browser, read from the saved handle: `storage` is `'folder'` or `'indexeddb'`; the rest as in `ws.folder.status()`. Call it only with the browser backend (the shell checks `detectBackend()` first). Never prompts. |
| `allowFolder()` | Call only from a click. The same as `ws.folder.allow()`, for the shell's Allow button. Resolves the new `folderState()`. When access is granted, every app on this origin hears it and its `ws.online` turns `true`. Rejects with `unavailable` if no folder is saved. |

### Connectors

| Method | Meaning |
| --- | --- |
| `ws.connectors.list()` | Connector info from `GET /api/connectors`. `[]` in browser mode. |
| `ws.connectors.call(id, action, args?, {confirm?})` | Runs an action. Resolves the action's `result`. For `write` actions pass `confirm: true`, and only from a user click that says what will happen. In browser mode rejects with `unavailable`. |
| `ws.connectors.on(id, event, handler)` | Listens to `connector` events from that connector. `event` `*` matches all. Returns an unsubscribe function. |
| `ws.connectors.onStatus(id, handler)` | Listens to `connector-status` for that connector. |
| `ws.connectors.getConfig(id)` | That connector's settings, form schema and environment variable status, from `GET /api/connectors/<id>/config`. Works whether or not the connector is on. In browser mode rejects with `unavailable`. |
| `ws.connectors.putConfig(id, config)` | Saves that connector's settings (`PUT /api/connectors/<id>/config`). Resolves the same shape as `getConfig`. From a hosted page it rejects with `local_only` if it changes a field the connector does not mark `x-workshop-hosted`; a config that fails the connector's `configSchema` rejects with `invalid_config`. |

### Settings

For the Settings app. Other apps keep their own settings in their own data.

| Method | Meaning |
| --- | --- |
| `ws.config.get()` | The public view of `config.json` ([config.md](config.md)), from `GET /api/config`. In browser mode rejects with `unavailable`. |
| `ws.config.put(patch)` | Changes features, allowed origins, connectors on and off, the port or the data folder (`PUT /api/config`). Resolves `{config, restartRequired}`. From a hosted page rejects with `local_only`. |

## Shell messages

`ws.open`, `toast`, `badge`, `notify`, `commands` and the events travel between the app frame and the shell by `postMessage`. Apps never send these by hand; this section is for the shell and SDK implementers. Data and connector calls do not use messages: the SDK calls the agent (or the browser backend) directly, so an app also works when opened on its own.

Every message is an object with `workshop: 1`. Schema [sdk-message](schemas/sdk-message.schema.json).

```json
{"workshop": 1, "kind": "request", "id": "r7", "method": "toast", "params": {"text": "Saved", "kind": "success"}}
{"workshop": 1, "kind": "response", "id": "r7", "ok": true, "result": null}
{"workshop": 1, "kind": "event", "event": "theme", "payload": {"key": "dark", "scheme": "dark"}}
```

| `kind` | Direction | Fields |
| --- | --- | --- |
| `request` | app to shell | `id` (unique per app page), `method`, `params` |
| `response` | shell to app | `id` of the request, `ok`, then `result` or `error: {code, message}` |
| `event` | shell to app | `event`, `payload` |

Request methods: `ready` (`{app, sdk: 1}`; the shell replies with `{theme, route, visible}`), `open`, `toast`, `badge`, `notify`, `commands.register`, `commands.unregister`. `params` match the SDK method arguments.

Rules:

- Both sides post with `targetOrigin` set to their own origin (shell and apps share one origin in every mode) and drop messages from any other origin.
- The shell accepts messages only from its app frames and knows which app each frame is, so an app cannot act as another.
- A request the shell does not know gets `ok: false` with code `not_found`.

## Standalone pages

When an app page is opened outside the shell (`ws.embedded === false`), shell methods still work: `open` changes `location` to the shell URL with that hash, `toast` shows a small in-page message, `badge` prefixes `document.title` with `(n)`, `notify` uses the Notification API if allowed, and `commands.register` binds its shortcut on the page. Data and connectors work as usual.

## Examples

- [examples/sdk-message.request-toast.json](examples/sdk-message.request-toast.json)
- [examples/sdk-message.request-ready.json](examples/sdk-message.request-ready.json)
- [examples/sdk-message.response-ready.json](examples/sdk-message.response-ready.json)
- [examples/sdk-message.response-error.json](examples/sdk-message.response-error.json)
- [examples/sdk-message.event-theme.json](examples/sdk-message.event-theme.json)
- [examples/sdk-message.event-command.json](examples/sdk-message.event-command.json)

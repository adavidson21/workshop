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
| `ws.route.set(path, {replace?})` | Tells the shell where this app is now, so the address bar, Back and Forward, refresh and bookmarks follow it (see Routes below). `path` is what comes after `#/<app>/`, empty for the app itself. Default adds a history entry; `replace: true` changes the current one. The shell sends no `route` event back for it. Standalone it writes `#/<path>` on the page itself. |
| `ws.toast(text, {kind?, action?, hold?, breakThrough?})` | Short message at the bottom of the shell. `kind`: `info` (default), `success`, `warn`, `error`. `action: {label, command}` adds a button that sends the app a `command` event. `hold: true` marks an interruption (a pickup, new items from a sync) that the shell drops during a focus or lunch span; the app counts it in its `held` card ([focus.md](focus.md)). `breakThrough: true` with `hold` shows it during focus anyway (blocking pull requests only), never during lunch. |
| `ws.badge(count, {breakThrough?})` | Count on the app's rail icon. Integer 0 to 999, or `null` to clear. `0` also clears. During a focus or lunch span the shell hides it and restores it after ([focus.md](focus.md)); during focus it shows `breakThrough` instead (the part of `count` that comes only from blocking pull requests), if that is above 0. |
| `ws.notify({title, body?, route?})` | System notification if the user allowed them, else a toast. Clicking it opens `route` in this app. |
| `ws.status.set({text, detail?, since?, route?, actions?})` | One line in the shell's top bar about what this app is doing right now, shown on every app (see Status below). Calling it again replaces it. Standalone it rejects with `not_found`, so the app shows its own. |
| `ws.status.clear()` | Removes this app's status. |
| `ws.commands.register({id, title, shortcut?})` | Adds a command to the shell palette (`Ctrl+K`). Returns an unregister function. `id` is unique within the app; the shell scopes it to the app. Running it sends the app a `command` event. |
| `ws.theme.current()` | `{key, scheme}`. `key` is a theme from `shared/themes.css` (`light`, `dark`, or `system`); `scheme` is `light` or `dark`. |
| `ws.on(event, handler)` | Subscribe to `theme`, `route`, `command`, `visible` or `online`. Returns an unsubscribe function. |

Events:

| Event | Payload | When |
| --- | --- | --- |
| `theme` | `{key, scheme}` | The user changed the theme. Apps that use `shared/themes.css` and `data-theme` get it applied automatically; the event is for canvas and charts. |
| `route` | `{path}` | The part of the hash after `#/<app>/` changed, including on first show, and on Back or Forward to an entry the app set with `ws.route.set`. Standalone, the page's own `#/<path>` on load and when it changes. |
| `command` | `{id, text?}` | A palette command, shortcut, manifest command, toast action or status action for this app ran. `text` is what the user typed into a status action's prompt. |
| `visible` | `{visible}` | The app was shown or hidden in the shell. |
| `online` | `{online}` | The agent became reachable or unreachable. |

### Routes

An app that calls `ws.route.set` owns its address: the shell keeps `#/<app>/<path>` as the app last set it, instead of tidying it to `#/<app>`.

- Call it whenever the place changes: a view, an open item, a date. Use the default (a new history entry) for a new place, and `replace: true` for small changes in the same place (an item opened in a side panel, a date stepped by one, a lens) and when answering a `route` event, so Back and Forward keep working.
- A path that only does something once (wrap up, a command) should be answered with `ws.route.set(<where the app is now>, {replace: true})`, so a reload does not repeat it.
- Apps that never call it keep today's behaviour: the shell delivers the path and tidies the address to `#/<app>`.
- The shell also accepts an app's name and its manifest `aliases` (strings only) in the address, so `#/docket/today` opens Docket like `#/prioritizer/today` ([app-manifest.md](app-manifest.md), Addresses).

### Apps

| Method | Meaning |
| --- | --- |
| `ws.apps.list()` | The apps on this Workshop site: `[{id, name, version, order, handoffs, capture, aliases, privateFiles, settings}]` from their manifests ([app-manifest.md](app-manifest.md)), sorted by `order`. Read once per page from the site's `apps/registry.json`. Resolves `[]` when the app is not running inside Workshop's site (Docket on its own site, for example); the app then uses its built-in fallback. |

Apps use it to find each other instead of naming app ids in code: handoff senders, capture targets, places for `> <name>`.

### Data

| Method | Meaning |
| --- | --- |
| `ws.data.get(collection, {app?})` | `collection` may be nested: `'entries/person-one/2026'` ([data-format.md](data-format.md), Names); the SDK sends each segment as a path segment. The envelope ([data-format.md](data-format.md)), or `null` if it was never written. `app` defaults to this app. Another app's data is read-only, and readable only through the contracts: any app's `summary` and `handoffs`, and Settings' `people`, `teams`, `products`, `focus` and `app-settings` ([shared.md](shared.md), B5). Anything else rejects with `forbidden`. |
| `ws.data.put(collection, envelope)` | Writes this app's collection. `envelope.rev` is the revision you read (`0` to create). Resolves `{rev, updatedAt}`. On a stale `rev` rejects with code `conflict` and `err.current` set to the stored envelope: merge (below) and put again with `current.rev`. |
| `ws.data.subscribe(collection, handler, {app?})` | Another app's collections follow the same contract rule as `get` (throws `forbidden`). Calls `handler({app, collection, rev, updatedAt, client})` after every write by anyone else, and after a change made outside Workshop (then `rev`, `updatedAt` and `client` are `null`: re-read). Writes made through this `ws` are filtered out using the client id. Returns an unsubscribe function. |
| `ws.data.merge(local, remote)` | Merges two envelopes of the same `schema` and `version` with the change-stamp rules in [data-format.md](data-format.md). Returns a new envelope with `remote.rev`. Pure. |
| `ws.data.stamp(before, after)` | Sets `updatedAt` on items that changed between two envelopes and adds tombstones for removed items. The same rules as Prioritizer's `stampChanges`. Returns `after`. |
| `ws.data.export({apps?})` | A bundle of every collection (or those of the listed apps). |
| `ws.data.import(bundle)` | Merges a bundle in. Collections that do not exist are created; existing ones are merged and put. Resolves `{created, merged}` (counts). |

The people directory is read and changed with `ws.people` (below), never `ws.data`. Team area paths are Settings' `teams` collection ([teams.md](teams.md)). What another app publishes for others to show is its `summary` collection ([summaries.md](summaries.md)); read that, not the app's own collections.

Bad names reject with `bad_request` before any request is made. The SDK sends `X-Workshop-Client` on every write and the token header on every agent request.

### People

The people directory ([people.md](people.md)): people and groups, kept in Settings' `people` collection and changed by any app through these calls. Directory objects come from `shared/people.js`, which also has the query helpers (`find`, `label`, `mention`, `reach`, `involves`, `expand`, `membersOf`, `groupsOf`, `self`, `manager`, `withRelation`, `team`, `active`); import it from the bundle.

| Method | Meaning |
| --- | --- |
| `ws.people.get()` | The directory: `{items, people, groups, byId, unreadable}`. Empty when it was never written; empty with `unreadable: true` when another version wrote it. |
| `ws.people.subscribe(handler)` | Calls `handler(directory)` after every change, from this page or anywhere else. Returns an unsubscribe function. |
| `ws.people.add(input)` | Adds a person (`{name, relation?, handle?, team?, adoIdentity?, role?}`; relation defaults to `contact`) or a group (`{kind: 'group', name, handle?, members?}`). Fills in the id and a free handle. Resolves the new item. |
| `ws.people.update(id, fields)` | Changes fields of one item; `id` and `kind` never change. Resolves the item. |
| `ws.people.setMembers(groupId, ids)` | Replaces a group's members. |
| `ws.people.archive(id)`, `ws.people.restore(id)` | Archives or restores one item. Nothing is ever deleted. |
| `ws.people.adopt(list)` | Adds people that the app's own data already points to, keeping their `p_` ids: a one-time move from a list the app kept itself (Rapport 2.x's reports). Skips ids already in the directory or deleted from it; a second you or manager becomes a contact. Resolves the added items (none: nothing is written). Bundle 2.1.0. |
| `ws.people.saveMany(list)` | Many adds and edits in one save, in order: an entry with `id` edits that item (like `update`), one without adds it (like `add`). Later entries are checked against earlier ones. Resolves the saved items in the same order. If any entry has a problem nothing is saved, and the error has `index`, the entry's position. For importing a list (People's spreadsheet import). Bundle 2.3.0. |

Every change is checked by the rules in [people.md](people.md) and rejects with code `bad_request` and a message to show (a handle in use, a second manager, a member who is not in the directory). A directory of another version rejects changes with `unsupported`. Concurrent changes merge item by item, as for any collection.

### Teams

Your team's Azure DevOps area paths ([teams.md](teams.md)), kept in Settings' `teams` collection. Settings' Team area paths page edits them here; other apps read the collection with `ws.data.get('teams', {app: 'settings'})`. Bundle 2.3.0.

| Method | Meaning |
| --- | --- |
| `ws.teams.get()` | Your team: `{name, areas, connection, areaConnections}`, with empty `areas` when not set up. `areaConnections` holds only entries for paths in `areas` (bundle 2.12.0). Rejects with `unsupported` when another version wrote it. |
| `ws.teams.subscribe(handler)` | Calls `handler(team)` after every change, from this page or anywhere else. Returns an unsubscribe function. |
| `ws.teams.setMine({areas, connection, areaConnections})` | Saves your team's area paths (an array, or text with one per line; trimmed, no repeats, up to 20), connection name and, optionally, a connection per area path (left out: the saved ones are kept for paths still listed). Resolves your team as saved. |

### App settings

The on/off switches an app declares in its manifest (`settings`, [app-settings.md](app-settings.md)), kept in Settings' `app-settings` collection and shown under the app on Settings' Apps tab. Bundle 2.7.0.

| Method | Meaning |
| --- | --- |
| `ws.appSettings.get(opts?)` | This app's values as `{<id>: true or false}`: each declared default, then what is saved. `{app}` reads another app's. Without a registry (an app's own site) only saved values. Rejects with `unsupported` when another version wrote it. |
| `ws.appSettings.declared(opts?)` | The settings the manifest declares, cleaned: `[{id, type, title, description, default}]`. `[]` without a registry. |
| `ws.appSettings.set(values, opts?)` | Saves some of this app's values (`{sprints: false}`; anything that is not a boolean is ignored). Resolves the values as saved. Only Settings may pass `{app}` for another app; others reject with `forbidden`. |
| `ws.appSettings.subscribe(handler, opts?)` | Calls `handler(values)` after every change to this app's values (or `{app}`'s), from this page or anywhere else. Returns an unsubscribe function. |

### Files

For app files that are not envelopes, such as Markdown summaries or images. Same folder, rules and limits as [agent-api.md](agent-api.md), Files: `.md` and `.json` (text) and `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp` (images), up to 4 segments, 10 MB, never a collection. `path` is relative to the app folder, for example `'summaries/person-one/2026-h2.md'`. A file is `{app, path, mtime, size, content}`; `mtime` is the version token, like `rev` for collections.

For a text file `content` is a string. For an image it is a `Blob` whose `type` is the image's media type (`image/png`, `image/jpeg`, `image/gif` or `image/webp`), on every backend; `write` takes a `Blob`, `ArrayBuffer` or `Uint8Array` for an image, and rejects a string with `bad_request` (and anything but a string for a text file). The SDK checks the first bytes as the agent does. To show an image, make a `blob:` URL with `URL.createObjectURL(file.content)` and revoke it when done; never point `<img>` at the agent. `err.current` on a conflict follows the same rule. `ws.files.isImage(path)` is `true` for an image path.

| Method | Meaning |
| --- | --- |
| `ws.files.list(folder?, {app?})` | `[{path, mtime, size}]` for every file of the app, or under `folder` (`'summaries/person-one'`), at every depth, sorted by path. `[]` if there are none. Another app's private files are left out; listing an app or folder that is wholly private rejects with `forbidden`. |
| `ws.files.read(path, {app?})` | The file, or `null` if it does not exist. `app` defaults to this app; another app's files are read-only, and its private files ([app-manifest.md](app-manifest.md), Private files) reject with `forbidden`. |
| `ws.files.write(path, content, {mtime} \| {create: true})` | Writes this app's file. Pass the `mtime` you read to replace it, or `create: true` to create one that must not exist. Resolves `{app, path, mtime, size}`. If the file changed, is gone, or (with `create`) already exists, rejects with code `conflict` and `err.current` set to the file as it is now, or `null` if it does not exist: read the change, decide, and write again with `current.mtime` (or `create: true` if `current` is `null`). |
| `ws.files.trash(path, {mtime?})` | Moves this app's file to the trash; never removes it. With `mtime`, rejects with `conflict` (and `err.current`) if the file changed. Resolves `{app, path, trash}`. |
| `ws.files.isImage(path)` | `true` if the path ends in an image extension. Needs no backend. |
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
| `ws.folder.choose()` | Call only from a click. Opens Chrome's folder picker, asks for read and write access, copies the IndexedDB store in (old copy kept, marked moved), saves the handle and reloads the page. Rejects with `unavailable` with the agent (change `dataDir` in settings instead), or in a browser without the File System Access API, and with `bad_request` if the user cancels. |
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

### Status

A status is for something ongoing the user should see and act on from any app, like Docket's running task. The shell shows one at a time in the top bar (the most recently started), and puts it in the tab title.

| Field | Meaning |
| --- | --- |
| `text` | The line itself, up to 200 characters. Clicking it opens this app at `route`. |
| `detail` | A second, quieter line (Docket: the last breadcrumb). Hidden on narrow windows. |
| `since` | ISO time. The shell shows the time since then (`12m`, `1h 05m`) and keeps it ticking. |
| `route` | Where clicking the text goes in this app. Empty opens the app. |
| `actions` | Up to four buttons: `{label, command, icon?, primary?, prompt?}`. A click sends this app a `command` event with that id. `icon`: `pause`, `play`, `done`, `note` or `bolt`; an icon button shows only the icon (label in its tooltip), except `pause`, which also shows its label. `primary` is the filled one. `prompt: {title, placeholder?, maxLength?, skip?}` asks for one line first, under the top bar, and sends it as `text`; with `skip` (the default) Esc or Skip still sends the command without text. |

A manifest with `background: true` loads the app hidden when Workshop opens, so its status is there before the first visit.

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

Request methods: `ready` (`{app, sdk: 1}`; the shell replies with `{theme, route, visible}`), `open`, `route.set`, `toast`, `badge`, `notify`, `status.set`, `status.clear`, `commands.register`, `commands.unregister`. `params` match the SDK method arguments.

Rules:

- Both sides post with `targetOrigin` set to their own origin (shell and apps share one origin in every mode) and drop messages from any other origin.
- The shell accepts messages only from its app frames and knows which app each frame is, so an app cannot act as another.
- A request the shell does not know gets `ok: false` with code `not_found`.

## Standalone pages

When an app page is opened outside the shell (`ws.embedded === false`), shell methods still work: `open` changes `location` to the shell URL with that hash, `route.set` writes `#/<path>` on the page (and the page's own hash is sent as `route` events, on load and when it changes), `toast` shows a small in-page message, `badge` prefixes `document.title` with `(n)`, `notify` uses the Notification API if allowed, `status.set` and `status.clear` reject with `not_found` (there is no top bar, so the app shows its own), and `commands.register` binds its shortcut on the page. Data and connectors work as usual.

## Examples

- [examples/sdk-message.request-toast.json](examples/sdk-message.request-toast.json)
- [examples/sdk-message.request-ready.json](examples/sdk-message.request-ready.json)
- [examples/sdk-message.response-ready.json](examples/sdk-message.response-ready.json)
- [examples/sdk-message.response-error.json](examples/sdk-message.response-error.json)
- [examples/sdk-message.event-theme.json](examples/sdk-message.event-theme.json)
- [examples/sdk-message.event-command.json](examples/sdk-message.event-command.json)

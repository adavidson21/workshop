# Workshop SDK

Version: **`sdk: 1`**. Implemented in `shared/workshop-sdk.js` (WS4). Apps use the SDK for everything that leaves the app: navigation, toasts, badges, notifications, commands, theme, data and connectors. No ad hoc `postMessage`, no direct `fetch` to the agent.

## Connecting

```js
import { connect } from '../../shared/workshop-sdk.js';

const ws = await connect({ app: 'prioritizer' });
ws.mode;     // 'local' | 'hosted' | 'browser'
ws.backend;  // 'agent' | 'browser'
ws.online;   // false while the agent is unreachable
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
| `ws.theme.current()` | `{key, scheme}`. `key` is a theme from `shared/themes.css` (for example `slate`, `nord`, or `system`); `scheme` is `light` or `dark`. |
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
| `ws.data.get(collection, {app?})` | The envelope ([data-format.md](data-format.md)), or `null` if it was never written. `app` defaults to this app; another app's collections are read-only. |
| `ws.data.put(collection, envelope)` | Writes this app's collection. `envelope.rev` is the revision you read (`0` to create). Resolves `{rev, updatedAt}`. On a stale `rev` rejects with code `conflict` and `err.current` set to the stored envelope: merge (below) and put again with `current.rev`. |
| `ws.data.subscribe(collection, handler, {app?})` | Calls `handler({app, collection, rev, updatedAt, client})` after every write by anyone else. Writes made through this `ws` are filtered out using the client id. Returns an unsubscribe function. |
| `ws.data.merge(local, remote)` | Merges two envelopes of the same `schema` and `version` with the change-stamp rules in [data-format.md](data-format.md). Returns a new envelope with `remote.rev`. Pure. |
| `ws.data.stamp(before, after)` | Sets `updatedAt` on items that changed between two envelopes and adds tombstones for removed items. The same rules as Prioritizer's `stampChanges`. Returns `after`. |
| `ws.data.export({apps?})` | A bundle of every collection (or those of the listed apps). |
| `ws.data.import(bundle)` | Merges a bundle in. Collections that do not exist are created; existing ones are merged and put. Resolves `{created, merged}` (counts). |

The SDK sends `X-Workshop-Client` on every write and the token header on every agent request.

### Connectors

| Method | Meaning |
| --- | --- |
| `ws.connectors.list()` | Connector info from `GET /api/connectors`. `[]` in browser mode. |
| `ws.connectors.call(id, action, args?, {confirm?})` | Runs an action. Resolves the action's `result`. For `write` actions pass `confirm: true`, and only from a user click that says what will happen. In browser mode rejects with `unavailable`. |
| `ws.connectors.on(id, event, handler)` | Listens to `connector` events from that connector. `event` `*` matches all. Returns an unsubscribe function. |
| `ws.connectors.onStatus(id, handler)` | Listens to `connector-status` for that connector. |
| `ws.connectors.getConfig(id)` | That connector's settings, form schema and environment variable status, from `GET /api/connectors/<id>/config`. Works whether or not the connector is on. In browser mode rejects with `unavailable`. |
| `ws.connectors.putConfig(id, config)` | Saves that connector's settings (`PUT /api/connectors/<id>/config`). Resolves the same shape as `getConfig`. From a hosted page rejects with `local_only`; a config that fails the connector's `configSchema` rejects with `invalid_config`. |

### Settings

For the Settings app. Other apps keep their own settings in their own data.

| Method | Meaning |
| --- | --- |
| `ws.config.get()` | The public view of `config.json` ([config.md](config.md)), from `GET /api/config`. In browser mode rejects with `unavailable`. |
| `ws.config.put(patch)` | Changes features, allowed origins, connectors on and off, or the port (`PUT /api/config`). Resolves `{config, restartRequired}`. From a hosted page rejects with `local_only`. |

## Shell messages

`ws.open`, `toast`, `badge`, `notify`, `commands` and the events travel between the app frame and the shell by `postMessage`. Apps never send these by hand; this section is for the shell and SDK implementers. Data and connector calls do not use messages: the SDK calls the agent (or the browser backend) directly, so an app also works when opened on its own.

Every message is an object with `workshop: 1`. Schema [sdk-message](schemas/sdk-message.schema.json).

```json
{"workshop": 1, "kind": "request", "id": "r7", "method": "toast", "params": {"text": "Saved", "kind": "success"}}
{"workshop": 1, "kind": "response", "id": "r7", "ok": true, "result": null}
{"workshop": 1, "kind": "event", "event": "theme", "payload": {"key": "nord", "scheme": "dark"}}
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

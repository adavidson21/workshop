# Run modes and data backends

Version 1. Data stays on the user's computer in every mode. No mode sends data to a server. App data lives in one folder the user owns, the data folder ([data-format.md](data-format.md), Data folder), in every mode that can reach a folder.

## Modes

| Mode | Where the UI comes from | Data backend | Connectors | Default |
| --- | --- | --- | --- | --- |
| `local` | The agent, at `http://127.0.0.1:<port>/` | `agent` (files in the agent's `dataDir`) | Available | Yes |
| `hosted` | Static files on the user's own domain (for example `https://<name>.alexisdavidson.org`) | `agent` when paired and reachable, else `browser` | Available only with the agent | No, off until `features.hostedMode` is on |
| `browser` | The same static files, with no agent | `browser`: files in a folder the user picked in Chrome, or IndexedDB until one is picked | Unavailable | Used when no agent is reachable |

`browser` mode exists for machines where a local server is blocked. Prioritizer works there with file export and import (see [data-format.md](data-format.md), Bundles).

No origin, domain or port is hardcoded in code. The agent's port comes from `config.json` (`port`, default `4380`). Allowed origins come from `config.json` (`allowedOrigins`, empty by default). See [config.md](config.md).

## How the SDK picks a backend

Apps never choose. They call the SDK ([sdk.md](sdk.md)), and the SDK picks once, when the page loads:

1. **Served by the agent?** If the page's origin is `http://127.0.0.1:<port>` or `http://localhost:<port>` and `GET /api/health` on the same origin returns `{"app": "workshop-agent", "api": 1}`, the mode is `local` and the backend is `agent`.
2. **Paired with an agent?** Otherwise, read `workshop.agent` from `localStorage` (`{"url": "http://127.0.0.1:4380", "token": "..."}`, written by pairing, below). If it exists, call `GET <url>/api/health` with `targetAddressSpace: "loopback"` and a 1.5 second timeout, then `GET <url>/api/apps` with the token. If both succeed, the mode is `hosted` and the backend is `agent`.
3. **Otherwise** the mode is `browser` and the backend is `browser`.

`ws.mode` and `ws.backend` report the result. With the `browser` backend, `ws.storage` says which store it uses: `folder` when a folder handle is saved (see Browser backend), else `indexeddb`. With the agent, `ws.storage` is `agent`.

Rules:

- **No silent switching.** If the agent stops answering after the page loaded, the SDK does not move to browser storage. It reports `ws.online === false`, fires `online` events when it changes, and retries every 5 seconds. Switching backends takes a reload. When the browser's folder is the agent's data folder, both backends read and write the same files, so a reload loses nothing; but the SDK cannot tell from the browser whether a picked folder is the same one, and IndexedDB is always a separate store, so it never switches on its own.
- **Moving data between backends** is an explicit export and import of a bundle ([data-format.md](data-format.md)).
- **Data and files APIs are identical.** `data.*` and `files.*`, revisions, modified times, conflicts, trash, backups and errors behave the same on every backend. The contract suite tests the agent; the browser backend must follow the same rules.

## Browser backend

Used when no agent is reachable. In a browser it has two stores (the folder store needs Chrome's File System Access API) and uses exactly one at a time. In the Android app it uses the device store instead.

### Folder store (`ws.storage === 'folder'`)

The browser reads and writes a folder the user picked, with the same layout and rules as the agent's data folder ([data-format.md](data-format.md), Data folder and Disk rules): `<folder>/<app>/<collection>.json`, files, `.trash/` and `.backups/`. Usually the user picks the same folder as the agent's `dataDir` (default `~/Workshop`), so data written with or without the agent is the same data.

- **Only the handle is stored.** The `FileSystemDirectoryHandle` is kept in IndexedDB (database `workshop`, object store `handles`, key `folder`). No app data goes into IndexedDB while a folder is in use.
- **Picking a folder** happens only from a click, in the Settings app (`ws.folder.choose()`, [sdk.md](sdk.md)): Chrome's folder picker, then a request for read and write access. Then the IndexedDB store is copied in (below) and the page reloads, so every open tab switches together.
- **Access.** On load, the SDK asks Chrome whether it may still use the folder (`queryPermission({mode: 'readwrite'})`). If Chrome says it must ask again (`prompt`), the SDK does not prompt by itself, because Chrome only shows the prompt after a click. Instead:
  - `ws.online` is `false`, `ws.folder.status()` reports `permission: 'prompt'`, and data and file calls reject with code `unavailable`, as when the agent is unreachable. Apps keep unsaved edits on screen and retry, as they already do.
  - The shell shows one bar with a button, "Allow Workshop to use the folder <name>". Clicking it calls `ws.folder.allow()`, which calls `requestPermission({mode: 'readwrite'})`. On success `ws.online` turns `true` and an `online` event fires in every app.
  - If the user refuses (`denied`), or the folder is gone (moved, renamed, deleted, or the drive is missing), the bar says so and links to Settings to pick a folder again. The SDK never falls back to IndexedDB on its own.
- **Writes** follow the agent's write rules for collections (`rev` check, `version` downgrade refused, version copy to `.backups/`) and files (modified-time check, `create`, trash, never remove). Before every write the backend reads the file (its `rev` for a collection, and its `lastModified` in both cases) and checks it, and just before writing it reads `lastModified` again; if that changed in between, it starts over with the new file, so a write made meanwhile by the agent, another program or a tab on another origin turns into a normal `conflict` instead of being lost. `mtime` in the files API is the file's `lastModified`.
- **Change events.** Writes in one tab reach other tabs of the same origin through a `BroadcastChannel` named `workshop-data`, which carries the same payloads as the agent's `data` and `file` events. Changes made outside this origin (the agent, an editor, a tab on another origin) are found by checking the `lastModified` of the collections and files the page subscribed to, every 5 seconds while the page is visible and whenever it becomes visible. They fire the same handlers with `client: null` ("re-read"), exactly as the agent's watcher does.
- **Paths never leave the folder.** The same name rules apply, and Chrome's handles cannot reach outside the folder, so there is no traversal to check.

### IndexedDB store (`ws.storage === 'indexeddb'`)

Used until a folder is picked, and for browsers that already have data from before the data folder.

- Database `workshop`, object store `data`, key `<app>/<collection>` (nested names keep their `/`), value: the envelope from [data-format.md](data-format.md). Object store `files`, key `<app>/<path>`, value `{content, mtime}`. `rev`, `updatedAt` and `mtime` are set by the backend exactly as the agent sets them (`mtime` is the write time in milliseconds, always greater than the file's previous `mtime`). A stale `rev` or `mtime` fails with code `conflict`. Deleting a file moves it to object store `trash` with the same key plus `.<stamp>`; nothing is removed.
- Change events: the same `BroadcastChannel` as above.

### Moving the IndexedDB store into the folder

When the user picks a folder and IndexedDB holds data, `ws.folder.choose()` copies it in before the reload:

1. Each collection is created in the folder if missing, or merged with the folder's copy and put (the same steps as `data.import`, [data-format.md](data-format.md), Bundles). Each file is created if missing; if the folder already has a different file at that path, the folder's copy is kept and the IndexedDB copy is written next to it as `<name>-from-browser.<ext>` (or `-from-browser-2` and so on).
2. The IndexedDB data is kept, never deleted, and marked moved: object store `data`, key `_moved`, value `{movedTo: <folder name>, movedAt: <ISO time>}`.
3. A store marked moved is never copied again, and the SDK uses it only if the folder handle is cleared, in which case Settings says that the browser data is older than the folder.

### Device store (`ws.storage === 'device'`)

Used in the Android app ([mobile/README.md](../mobile/README.md)), where there is no agent and no folder picker. The SDK chooses it before anything else when the page runs in that app (Capacitor's native bridge is there with its Filesystem plugin; `shared/device-fs.js`, `deviceAvailable()`).

- **It is the folder store** on a different folder: the app's private data folder on the phone, under `workshop/` (`workshop/<app>/<collection>.json` and so on). `shared/device-fs.js` gives the folder store a directory handle backed by Capacitor's Filesystem plugin, so the layout and every rule above apply unchanged: `rev` checks, `version` downgrade refused, backups, trash, the `lastModified` check before every write, change events and the outside-change check.
- **No permission, nothing to choose.** `ws.folder.status()` is `{storage: 'device', name: null, permission: null, moved: false, missing: false}`; `ws.folder.choose()` rejects with `unavailable`. IndexedDB is never used for app data.
- **Atomic writes.** A file is written to a hidden temporary file beside it (`.<name>.workshop-tmp`), which then replaces it. If renaming over an existing file fails, the old file is removed and the rename tried again. A read that finds no file but a temporary file older than 10 seconds puts the temporary file in place (the app stopped mid-write). Lists never show temporary files.
- **Never leaves the phone.** The app is left out of Google's cloud backup. Files go elsewhere only when the user shares them (`shared/save-file.js` hands backups and exports to Android's share sheet).
- `ws.online` is `false` only if the folder cannot be reached at all; data calls then reject with `unavailable`.

### Connectors

`connectors.list()` returns `[]`; `connectors.call()` rejects with code `unavailable`. Export and import (`data.export()`, `data.import(bundle)`) work on every backend.

### Known limit

The agent and a browser-backend tab on another origin (for example the hosted site in browser mode while the agent is also running) could write the same file at the same moment. The SDK uses the agent whenever it is reachable, and the folder backend re-checks `rev` and `lastModified` right before every write, so the window is a few milliseconds and needs the same user acting in two places at once. The loser of such a race overwrites the winner without a conflict. A hand edit that keeps `rev` has the same limit as with the agent ([data-format.md](data-format.md), Changes made outside Workshop).

## Hosted mode

Hosted mode is off by default. To use it, the user turns on `features.hostedMode` and adds the hosted origin to `allowedOrigins`, in `config.json` or the Settings app (only from the agent's own origin).

### Pairing

A hosted page cannot read the agent's cookie, so it gets the token by pairing, once per browser:

1. The hosted shell opens a popup: `http://127.0.0.1:<port>/pair?origin=<hosted origin, URL-encoded>`.
2. The agent answers only if the browser already has the agent cookie (the user opened Workshop locally at least once), `features.hostedMode` is on, and the origin is in `allowedOrigins`. Otherwise it shows a page that says what is missing. The cookie is `SameSite=Strict`, so the popup's first, cross-site request arrives without it: the page then reloads itself once (`&again=1`), a same-site navigation that carries it.
3. The page shows the origin and a button: "Allow <origin> to use Workshop on this computer". Nothing is sent until the user clicks it.
4. On click, the page calls `window.opener.postMessage({type: "workshop-pair", api: 1, url, token}, <origin>)` and closes. `url` is the agent's own origin.
5. The hosted shell stores `{url, token}` as `workshop.agent` in its `localStorage`.

The pair page sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, so it cannot be framed and clicked by another site.

### Browser prompts

Chrome and Edge ask the user to allow a public site to reach `127.0.0.1` (Local Network Access). Expect that prompt once per hosted origin. Requests to the agent from a hosted page pass `targetAddressSpace: "loopback"` to `fetch`, and the agent answers preflights with `Access-Control-Allow-Private-Network: true`.

### Trade-off

The hosted page holds the token in its own `localStorage`. Anyone who can run script on that origin can use the agent. That is why hosted mode is off by default, origins must be listed one by one, and config changes (`PUT /api/config` and `PUT /api/connectors/<id>/config`) are refused from hosted origins. In hosted mode the Settings app shows settings read-only and says to open Workshop on this computer to change them.

## Service worker rules

These apply to any service worker Workshop ships, in every mode:

- Never cache, and never call `respondWith` for, a request whose path starts with `/api/` or is `/pair`, on the agent's origin.
- Never cache any request to the agent's origin made from a hosted page.
- Never touch `/api/events` (the event stream). Let the browser handle it.

The check is in `tests/contract/service-worker.test.mjs`. It is marked to-do until WS4 replaces `sw.js`; WS4 removes the to-do mark.

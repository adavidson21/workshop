# App manifest

Version: **`manifestVersion: 1`**. Schema: [schemas/app.schema.json](schemas/app.schema.json).

Adding an app to Workshop means adding a folder, `apps/<id>/`, with an `app.json` in it. The shell builds the rail, routes, keyboard shortcuts and command palette from the manifests ([agent-api.md](agent-api.md), `GET /api/apps`). No shell or service worker edits.

## Example

```json
{
  "manifestVersion": 1,
  "id": "prioritizer",
  "name": "Docket",
  "version": "3.0.0",
  "description": "Decide what to work on next.",
  "icon": "icon.svg",
  "entry": "index.html",
  "order": 10,
  "modes": ["local", "hosted", "browser"],
  "routes": [
    {"path": "task/:id", "title": "Open a task"}
  ],
  "connectors": [
    {"id": "ado", "required": false},
    {"id": "opencode", "required": false}
  ],
  "data": ["tasks", "lists"],
  "commands": [
    {"id": "add-task", "title": "Add a task", "route": ""},
    {"id": "sync-ado", "title": "Sync ADO"}
  ],
  "shortcuts": [
    {"keys": "Ctrl+Shift+A", "command": "add-task", "scope": "global"}
  ],
  "files": ["app.css", "js/main.js", "js/state.js"],
  "handoffs": {"sends": ["receipts"]},
  "capture": ["task", "waiting"],
  "aliases": ["docket", "tasks", {"name": "today", "path": "today"}]
}
```

More: [examples/app.prioritizer.json](examples/app.prioritizer.json), [examples/app.minimal.json](examples/app.minimal.json).

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `manifestVersion` | yes | `1`. |
| `id` | yes | `^[a-z][a-z0-9-]{0,39}$`. Must equal the folder name. Also the route (`#/<id>`) and the data namespace (`/api/data/<id>/...`). |
| `name` | yes | Rail label and window title. Up to 40 characters. |
| `version` | yes | The app's version, `major.minor.patch`. |
| `description` | no | One line, shown in tooltips and Settings. |
| `icon` | yes | Path to an SVG file in the app folder. 20 by 20 view box, stroke icons using `currentColor`, like today's rail icons. |
| `entry` | yes | Path to the app's HTML page in the app folder. The shell loads it in a same-origin frame. |
| `order` | no | Number. Rail position, low first. Ties and missing values sort by `name`. |
| `home` | no | `true` makes this app the home page. The Workshop logo at the top of the rail and the plain address (no `#`) open it, and it gets no rail button or `Alt+<n>`. If several apps set it, the first by `order` wins. Without a home app, the logo and the plain address open the first app on the rail. |
| `background` | no | `true` loads the app, hidden, when Workshop opens instead of on its first visit, so a status it keeps in the top bar (`ws.status`, [sdk.md](sdk.md) Status) shows from the start. Docket uses it for the running task. Use it only for that: every background app costs a page load at start. |
| `modes` | no | Run modes the app works in: any of `local`, `hosted`, `browser` ([run-modes.md](run-modes.md)). Default: all three. The shell hides an app in a mode it does not list. |
| `routes` | no | Deep links the app handles, as patterns after `#/<id>/`. Segments starting with `:` are parameters. The shell passes the rest of the hash to the app (SDK `route` event); patterns document what is valid and power `open()` from other apps. |
| `connectors` | no | Connectors the app uses: `{id, required}`. If a required connector is unavailable (browser mode, disabled, not ready), the shell shows the app with a notice instead of loading it. |
| `data` | no | Collection names the app owns. Informational: Settings lists them, and export includes them. |
| `commands` | no | Commands shown in the palette before the app has loaded: `{id, title, route?}`. Choosing one opens the app (at `route` if given) and then sends it the SDK `command` event. Apps can add more at runtime with `commands.register`. |
| `shortcuts` | no | `{keys, command, scope}`. `keys` is like `Ctrl+Shift+A` or `Alt+N`: modifiers `Ctrl`, `Alt`, `Shift`, `Meta` (in that order), then one key name. `scope: "app"` works only while the app is shown; `"global"` works anywhere in the shell. `Alt+1` to `Alt+9` and `Ctrl+K` are reserved for the shell. |
| `handoffs` | no | `{sends}`. `sends`: app ids this app writes handoff offers to ([handoffs.md](handoffs.md)). A receiver finds its senders from this (`ws.apps.list()`, [sdk.md](sdk.md)) instead of a list of app ids in its code. |
| `capture` | no | Capture kinds this app takes from quick capture and the Dispatch hub: any of `task`, `waiting`, `receipt`, `note`, `idea` ([hub.md](hub.md), Captures). Each kind goes to the first app by `order` that lists it. The app must accept that kind as a handoff ([handoffs.md](handoffs.md), Receivers). |
| `aliases` | no | Other words for this app in `> <place>` (quick capture and the hub). Up to 20, each a lowercase word (`"tasks"`) or `{name, path}` to open a part of the app (`{"name": "1:1s", "path": "1on1s"}`). The app's `id` and `name` always work. |
| `hosts` | no | Other apps shown inside this one: up to 5 of `{app, path}`. While both are on, the hosted app has no rail button, its commands leave the palette, and `#/<app>/<rest>` (and `ws.open` to it) opens this app at `<path>/<rest>`. See Hosted apps below. |
| `privateFiles` | no | Files other apps may not see: `true` for every file of this app, or a list of top folders (`["oneonones", "goals"]`). See Private files below. |
| `files` | no | Extra files to precache for offline use, relative to the app folder. The entry page and icon are always included. |


## Hosted apps

An app can show another app inside itself with `hosts`. Slate does it for Runway: `"hosts": [{"app": "runway", "path": "roadmaps"}]`. Its Roadmaps tab frames Runway's own page and stands in for the shell for it (Slate's `js/host.js`): it answers `ready`, keeps Runway's routes inside the tab, and passes `toast`, `notify` and `open` to other apps on to the shell.

While the host and the hosted app are both on:

- The hosted app has no rail button and no Alt+<n> of its own, and its manifest commands are left out of the palette (the host has its own).
- `#/<hosted>/<rest>` opens `#/<host>/<path>/<rest>`, so old links, `ws.open` from other apps and quick capture's `> <alias>` all land in the host.
- Everything else about the hosted app is unchanged: its data, handoffs, captures and summary, and its own site.

Turning the host off brings the hosted app back to the rail. The rule lives in the shell (`shell/shell.js`); the SDK and the agent do not need to know.

## Private files

Any app can read another app's files ([sdk.md](sdk.md), Files), which suits files meant to be shared, such as Markdown summaries. Files that hold something personal, like Rapport's 1:1 notes and goals, should not show up in another app by accident. `privateFiles` marks them:

- Another app's `ws.files.read` of a private file rejects with code `forbidden`, as does `ws.files.list` of the whole app (`true`) or of a private folder. A listing of the app leaves private files out. `ws.files.subscribe` does not deliver their change events.
- The owner's own reads are unchanged, and so is Settings' full backup and import.
- The SDK reads the rule from the site's registry, or from the agent's app list on an app's own site. When neither has the owner's manifest, a built-in fallback applies (Rapport is private).
- This prevents accidents, not a hostile app: every page with the agent token can still call the agent's files API directly ([security.md](security.md)).

Rapport sets `"privateFiles": true`.

## Apps from another site

An app can live in its own repo and site and still appear here: list it in `apps/remote.json` instead of adding a folder. Its `app.json` follows this document as usual, with paths relative to the root of its site. The Worker serves that site under `/apps/<id>/`, so the shell's frame stays same-origin, and `apps/registry.json` lists it from the snapshot in `remote.json` (the Worker swaps in the live `app.json`). Docket (`id` `prioritizer`, https://docket.alexisdavidson.org) is the first. See "Apps from another site" in the [README](../README.md#apps-from-another-site).

The agent's own app list (`GET /api/apps`) lists app folders only. The shell never reads it: it always comes from the hosted site and reads `apps/registry.json`.

## Rules

- An app folder holds everything the app needs except what is in `shared/`. Apps do not import from other app folders.
- Apps talk to the shell, data and connectors only through the SDK ([sdk.md](sdk.md)). No ad hoc `postMessage`, no direct `fetch` to `/api/`.
- An `app.json` that fails the schema, or whose `id` does not match its folder, is skipped and logged; the agent keeps running.
- No shared code names an app id to find it. Apps and shared code find each other through manifests (`ws.apps.list()`): handoff senders by `handoffs.sends`, capture targets by `capture`, places by `aliases`. Built-in lists are only a fallback for an app that runs outside Workshop's site.
- `tests/check-contracts.mjs` validates every `apps/*/app.json` in the repo.

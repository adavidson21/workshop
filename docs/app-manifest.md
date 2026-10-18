# App manifest

Version: **`manifestVersion: 1`**. Schema: [schemas/app.schema.json](schemas/app.schema.json).

Adding an app to Workshop means adding a folder, `apps/<id>/`, with an `app.json` in it. The shell builds the rail, routes, keyboard shortcuts and command palette from the manifests ([agent-api.md](agent-api.md), `GET /api/apps`). No shell or service worker edits.

## Example

```json
{
  "manifestVersion": 1,
  "id": "prioritizer",
  "name": "Prioritizer",
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
  "files": ["app.css", "js/main.js", "js/state.js"]
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
| `modes` | no | Run modes the app works in: any of `local`, `hosted`, `browser` ([run-modes.md](run-modes.md)). Default: all three. The shell hides an app in a mode it does not list. |
| `routes` | no | Deep links the app handles, as patterns after `#/<id>/`. Segments starting with `:` are parameters. The shell passes the rest of the hash to the app (SDK `route` event); patterns document what is valid and power `open()` from other apps. |
| `connectors` | no | Connectors the app uses: `{id, required}`. If a required connector is unavailable (browser mode, disabled, not ready), the shell shows the app with a notice instead of loading it. |
| `data` | no | Collection names the app owns. Informational: Settings lists them, and export includes them. |
| `commands` | no | Commands shown in the palette before the app has loaded: `{id, title, route?}`. Choosing one opens the app (at `route` if given) and then sends it the SDK `command` event. Apps can add more at runtime with `commands.register`. |
| `shortcuts` | no | `{keys, command, scope}`. `keys` is like `Ctrl+Shift+A` or `Alt+N`: modifiers `Ctrl`, `Alt`, `Shift`, `Meta` (in that order), then one key name. `scope: "app"` works only while the app is shown; `"global"` works anywhere in the shell. `Alt+1` to `Alt+9` and `Ctrl+K` are reserved for the shell. |
| `files` | no | Extra files to precache for offline use, relative to the app folder. The entry page and icon are always included. |

## Rules

- An app folder holds everything the app needs except what is in `shared/`. Apps do not import from other app folders.
- Apps talk to the shell, data and connectors only through the SDK ([sdk.md](sdk.md)). No ad hoc `postMessage`, no direct `fetch` to `/api/`.
- An `app.json` that fails the schema, or whose `id` does not match its folder, is skipped and logged; the agent keeps running.
- `tests/check-contracts.mjs` validates every `apps/*/app.json` in the repo.

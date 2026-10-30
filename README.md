# Workshop

An engineering manager's hub: one page with a rail of apps, sharing one theme. Workshop brings together Docket, Dispatch, and Tandem, the agent scaffolding Dispatch runs on.

- **Home** (the Workshop logo at the top of the rail) is your day at a glance: what's on Today, what to triage, what's overdue or due this week, your top 3 tasks, your people, and agents waiting on you. Guide: [apps/home/README.md](apps/home/README.md).
- **Docket** (formerly Prioritizer; code and URLs still say `prioritizer`) decides what to work on next, and has team-wide ADO **Reports** for capacity conversations. User guide: [apps/prioritizer/README.md](apps/prioritizer/README.md).
- **Dispatch** (formerly Agents; code and URLs still say `agents`) is the front end for [Tandem](https://github.com/adavidson21/eng-agents) (the eng-agents repo), the agent scaffolding that drives opencode. It shows your work items and the opencode agents working on them, and runs the next step. It needs Workshop running on this computer with the opencode connector on.
- **Settings** turns Workshop's features and connectors on and off, edits each connector's settings (for example which ADO collection and project a repo maps to), and downloads or imports a copy of your data.

Docket and Dispatch also open on their own pages (`apps/prioritizer/` and `apps/agents/`), with the same top bar as the other tools: breadcrumbs and the light/dark toggle.

Switch apps from the rail, or with `Alt+1`, `Alt+2` and so on. `Ctrl+K` (`Cmd+K` on a Mac) opens the command palette: every app's commands, from anywhere. Each app keeps its state while you're in another one. The first app is the plain address; the others are `#/<app>`, and `#/<app>/<path>` opens an app at a place, for example `#/agents/<work item id>` or `#/prioritizer/task/<task id>`.

Everything stays on your device. There are no accounts and no server: data is saved in your browser, or in files on this computer when Workshop runs there, and nothing talks to anything but `127.0.0.1` and the systems you set up in Settings.

Workshop runs three ways (see [docs/run-modes.md](docs/run-modes.md)): from the Workshop agent on this computer (`node agent/start.mjs`, then open the address it prints), as static files with no agent (browser storage only, like the github.io site), or as static files on your own domain paired with the agent (**Connect** on the rail, after you turn on hosted mode in Settings).

## Agents

Agents is the eng-agents live dashboard as a Workshop app. It reads `.work` and follows opencode through the opencode connector ([connectors/opencode/README.md](connectors/opencode/README.md)), so it needs the Workshop agent on this computer. There is nothing to start in eng-agents and no `shellOrigins` to set.

**Once:**

1. Start Workshop on this computer (`node workshop.mjs start`) and open it.
2. In **Settings**, turn on the opencode connector and set **Workspace folder** to the folder that holds `.work` and your repos. The connector needs PowerShell (`pwsh` on a Mac) and opencode 1.x or 2.x with eng-agents installed.
3. Open **Agents**. If the connector can't start, the page says why.

Prioritizer shows each ADO task's eng-agents stage and can start a work item, through the same connector. Clicking a stage opens that item in Agents (`#/agents/<work item id>`).

eng-agents' own static page (`/dashboard static`) is unchanged.

## Install it as a desktop app

In Chrome or Edge, open Workshop and click **Install** on the rail (or the install icon in the address bar). Like Google Drive's desktop app, it then opens in its own window with a dock or taskbar icon, works offline, and opening it again brings back the window you already have. Right-click the icon for **Prioritizer** and **Agents** shortcuts.

It installs per user from the browser, with no admin rights or executable. If Install never appears on a work laptop, your company's browser policy may block web app installs. On a phone, use "Add to Home Screen".

The install dialog shows `shared/screenshots/wide.png` and `shared/screenshots/narrow.png` (sample data). Regenerate them when the look changes a lot.

## Install and run the agent

The agent is one local process: it serves the Workshop UI at `http://127.0.0.1:<port>`, keeps your data on disk, and hosts connectors. Node 22 or later, no admin rights, no npm install.

1. Get the code: `git clone https://github.com/adavidson21/workshop` (or download the zip).
2. Install, per user:
   - macOS or Linux: `bash scripts/install.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`
   This checks Node and creates `~/.workshop`. Start at login stays off; pass `--login` (or `-Login` on Windows) to turn it on, or turn it on later in Settings.
3. Start it now: `node workshop.mjs start`, then open the address it prints in Chrome or Edge on this computer.

Other commands:

- `node workshop.mjs doctor` checks Node, `config.json`, the port, start at login and hosted mode. `node workshop.mjs doctor ado` checks the ADO connector.
- `node workshop.mjs publish --out dist` builds the static site for hosted or browser mode, with `apps/registry.json`.
- `node workshop.mjs update` updates this checkout. `node workshop.mjs uninstall` turns off start at login (your data stays in `~/.workshop`).

Start at login and hosted mode are off until you turn them on, and never need admin rights. See [docs/security.md](docs/security.md) for what Workshop stores, where, and the checks that keep it on your computer.

## Layout

```
index.html              the shell page: rail + one pane per app
shell/                  shell.js (rail, routing, palette, light/dark toggle, toast, pairing, the SDK's shell side),
                        shell.css, registry.mjs (writes apps/registry.json)
shared/                 used by the shell and every app
  workshop-sdk.js       the SDK: apps reach the shell, data and connectors only through it (docs/sdk.md)
  themes.css            the themes: the styling source of truth for the shell and every app
  theme.js              applies and remembers the theme across pages
  ui.css                buttons, menus, toast, tooltip
  sw-register.js        registers sw.js
  fonts/                self-hosted Inter and JetBrains Mono (OFL), fonts.css
  vendor/               third-party code served from this site (SheetJS); see vendor/README.md
  screenshots/          images for the install dialog
  test/                 SDK tests
apps/                   one folder per app, each with an app.json (docs/app-manifest.md)
  registry.json         the app list for static sites (node shell/registry.mjs writes it)
  prioritizer/          Prioritizer (also runs on its own at /apps/prioritizer/)
    ado-helper/         the local ADO helper (Python), for when Workshop's ADO connector is not running
  agents/               Agents (the eng-agents live dashboard, on the opencode connector)
  settings/             Settings
agent/                  the Workshop agent: serves the UI on 127.0.0.1, stores data, runs connectors
connectors/             one folder per connector (ADO, opencode)
docs/                   the contracts every part is written against
sw.js                   offline cache for the whole site
tests/                  checks (see below)
```

### Adding an app

An app is a folder. No shell or service worker edits.

1. Make `apps/<id>/` with an `app.json` ([docs/app-manifest.md](docs/app-manifest.md)), an `icon.svg` (20 by 20, stroke, `currentColor`) and its page. Load `shared/theme.js`, `shared/fonts/fonts.css`, `shared/themes.css` and `shared/ui.css` so it matches, and copy the Content-Security-Policy meta tag from `index.html`. List the app's other files in `app.json` `files` so it works offline (`node tests/check-offline.mjs` says what is missing).
2. Talk to the shell, data and connectors through the SDK only ([docs/sdk.md](docs/sdk.md)): `import { connect } from '../../shared/workshop-sdk.js'; const ws = await connect({app: '<id>'});`. Then `ws.open`, `ws.toast`, `ws.badge`, `ws.commands.register`, `ws.data.get` and `put`, `ws.connectors.call`, and events with `ws.on`. No `postMessage` and no `fetch` to `/api/`.
3. Run `node shell/registry.mjs` so static sites list it too. The agent finds it on its own.

The rail, routes, `Alt+<n>`, shortcuts and the palette come from `app.json`. See `apps/settings/` for a small app.

### No third-party requests

Pages load files from this site only, plus the local helpers on `http://127.0.0.1`. Fonts are in `shared/fonts/` and libraries in `shared/vendor/`; nothing comes from a CDN. A Content-Security-Policy meta tag on each page enforces this, and `tests/e2e.py` fails if any request goes anywhere else.

### Themes

Edit `shared/themes.css` only, then update `THEMES` and `SWATCH` in `shared/theme.js` (`node tests/check-themes.mjs` fails until they match). Every app, Agents included, loads `themes.css` directly. Until WS8, eng-agents' static page still copies it with `sync-themes.mjs`.

## Running it locally

With the agent (local mode, connectors and data on disk):

```
node agent/start.mjs
```

Then open the address it prints. Without it (browser mode), any static web server works, for example `python -m http.server 8000`, then `http://localhost:8000/`.

## Checks

```
node tests/check-themes.mjs              theme.js matches themes.css
node tests/check-offline.mjs             every file the pages and app modules load is cached by sw.js
node shell/registry.mjs --check          apps/registry.json lists every app folder
node --test "shared/test/*.test.mjs"     the SDK, against the docs' cases and the mock agent
node --test "apps/*/test/*.test.mjs"     apps' own tests (Prioritizer storage)
python tests/e2e.py                      Workshop in headless Chromium: browser, local and hosted modes, Prioritizer storage
```

`e2e.py` needs `pip install playwright` and `python -m playwright install chromium`. These, the contract suite and the agent and connector tests run on every push (`.github/workflows/checks.yml`).

## Shipping

GitHub Pages serves the repo root. When you ship a change, bump `VERSION` in `sw.js` so open windows offer a "New version" reload, and run `node shell/registry.mjs` if an app's `app.json` changed.

Workshop lives at https://adavidson21.github.io/workshop/ (Prioritizer on its own: `/workshop/apps/prioritizer/`; the old `/workshop/prioritizer/` address forwards there). Same github.io site as before, so tasks saved in the browser carry over. If the site moves to another host, update `shellOrigins` (above) and `allowed_origins` in `apps/prioritizer/ado-helper/ado_helper.py` (or your `ado-helper.json`); browser storage does not move between hosts, so export from the old one and import on the new one.

## License

MIT, see `LICENSE`. Bundled fonts and libraries keep their own licenses: `shared/fonts/OFL-*.txt` and `shared/vendor/LICENSE-SheetJS.txt`.

# Workshop

An engineering manager's hub: one page with a rail of apps, sharing one theme. Workshop brings together Docket, Dispatch, Receipts, and Tandem, the agent scaffolding Dispatch runs on.

- **Home** (the Workshop logo at the top of the rail) is your day at a glance: what's on Today, what to triage, what's overdue or due this week, your top 3 tasks, your people, and agents waiting on you. Guide: [apps/home/README.md](apps/home/README.md).
- **Docket** (formerly Prioritizer; code and URLs still say `prioritizer`) decides what to work on next, and has team-wide ADO **Reports** for capacity conversations. Its code lives in its own repo, [adavidson21/docket](https://github.com/adavidson21/docket), and its own site, https://docket.alexisdavidson.org; Workshop shows it inside the shell by serving that site under `apps/prioritizer/` (see Apps from another site below). User guide: [Docket's README](https://github.com/adavidson21/docket#readme).
- **Dispatch** (formerly Agents; code and URLs still say `agents`) is the front end for [Tandem](https://github.com/adavidson21/eng-agents) (the eng-agents repo), the agent scaffolding that drives opencode. It shows your work items and the opencode agents working on them, and runs the next step. It needs Workshop running on this computer with the opencode connector on.
- **Receipts** keeps the receipts for performance reviews: your own (the main use), each direct report's, and optional upward notes, then builds a review draft grouped by your review form's sections. Its home is its own repo, [adavidson21/receipts](https://github.com/adavidson21/receipts), and its own site, https://receipts.alexisdavidson.org; `apps/receipts/` here is a copy of that repo's `apps/receipts/` (copy it again after changing the app there, then run `node shell/registry.mjs`). Guide: [apps/receipts/README.md](apps/receipts/README.md).
- **Settings** turns Workshop's features and connectors on and off, edits each connector's settings (for example which ADO collection and project a repo maps to), and downloads or imports a copy of your data.

Docket and Dispatch also open on their own pages (https://docket.alexisdavidson.org and `apps/agents/`), with the same top bar as the other tools: breadcrumbs and the light/dark toggle. Opening `apps/prioritizer/` on its own here goes to Docket's site. Dispatch has its own address, https://dispatch.alexisdavidson.org: the Workshop Worker (`wrangler.jsonc`, `worker/index.js`) serves `apps/agents/` there; both domains are listed in `wrangler.jsonc`, and the old standalone address forwards to it. Until it can reach Workshop on your computer, Dispatch shows a two-step setup guide: paste one install command (see One-line install below), then connect. Once connected, the opencode connector's settings (workspace folder and so on) are under opencode settings in Dispatch's menu.

Switch apps from the rail, or with `Alt+1`, `Alt+2` and so on. `Ctrl+K` (`Cmd+K` on a Mac) opens the command palette: every app's commands, from anywhere. Each app keeps its state while you're in another one. The first app is the plain address; the others are `#/<app>`, and `#/<app>/<path>` opens an app at a place, for example `#/agents/<work item id>` or `#/prioritizer/task/<task id>`.

Everything stays on your device. There are no accounts and no server: data is saved in your browser, or in files on this computer when Workshop runs there, and nothing talks to anything but `127.0.0.1` and the systems you set up in Settings.

Workshop always opens from its site, https://workshop.alexisdavidson.org (see [docs/run-modes.md](docs/run-modes.md)). With the Workshop agent running on your computer and the site paired (**Connect** on the rail), data is files on your computer and connectors work. Without it, data is saved in your browser or a folder you pick. The agent serves only **Workshop on this computer** at the address it prints: it signs your browser in, approves pairing, and holds the settings a public site must never change by itself (connectors on or off, ADO servers, the data folder, allowed sites, start at login). `workshop open` opens it.

## Agents

Agents is the eng-agents live dashboard as a Workshop app. It reads `.work` and follows opencode through the opencode connector ([connectors/opencode/README.md](connectors/opencode/README.md)), so it needs the Workshop agent on this computer. There is nothing to start in eng-agents and no `shellOrigins` to set.

**Once:**

1. Start Workshop on this computer (`node workshop.mjs start`) and open it.
2. In **Settings**, turn on the opencode connector and set **Workspace folder** to the folder that holds `.work` and your repos. The connector needs PowerShell (`pwsh` on a Mac) and opencode 1.x or 2.x with eng-agents installed.
3. Open **Agents**. If the connector can't start, the page says why.

Prioritizer shows each ADO task's eng-agents stage and can start a work item, through the same connector. Clicking a stage opens that item in Agents (`#/agents/<work item id>`).

eng-agents' own static page (`/dashboard static`) is unchanged.

## Install it as a desktop app

In Chrome or Edge, open Workshop and click **Install** on the rail (or the install icon in the address bar). Like Google Drive's desktop app, it then opens in its own window with a dock or taskbar icon, works offline, and opening it again brings back the window you already have. Right-click the icon for **Docket**, **Dispatch** and **Receipts** shortcuts.

It installs per user from the browser, with no admin rights or executable. If Install never appears on a work laptop, your company's browser policy may block web app installs. On a phone, use "Add to Home Screen".

## Docket on Android

Docket is also an Android app, with its board saved in the app's own storage on the phone (never on a server, and not cleared like browser storage). Android visitors to Docket's page get a "Get the app" banner linking to the latest build. It is built in Docket's repo: see [mobile/README.md](https://github.com/adavidson21/docket/blob/main/mobile/README.md) there.

The install dialog shows `shared/screenshots/wide.png` and `shared/screenshots/narrow.png` (sample data). Regenerate them when the look changes a lot.

## Install and run the agent

The agent is one local process: it serves the Workshop UI at `http://127.0.0.1:<port>`, keeps your data on disk, and hosts connectors. Node 22 or later, no admin rights, no npm install.

### One-line install (Workshop and Tandem)

This is what Dispatch's setup guide shows. It installs per user with no admin rights: Node, opencode and git if they are missing (git as MinGit on Windows; on a Mac it asks macOS to install its command line tools; plus PowerShell 7 on a Mac or Linux), Workshop and Tandem (eng-agents) from GitHub with no git needed, then installs Tandem into opencode. If opencode has no AI provider yet, the Windows installer asks to connect one (`opencode auth login`); on macOS and Linux the last lines say to run `opencode auth login` in a new terminal, because its menu does not get the keyboard inside `curl | bash`. It then turns on hosted mode for the site it came from and the opencode connector with workspace `~/work`, starts Workshop and opens it once to sign the browser in. Running it again updates everything and keeps your settings.

Start at login stays off (run Workshop by hand for a few days first; turn it on later in Workshop on this computer), unless you set `WORKSHOP_LOGIN=1` before running the installer; a setting you turned on earlier is kept. opencode and Tandem are only needed for Dispatch: if a company network blocks installing them (for example npm behind an HTTPS-inspecting proxy), the installer says so and carries on, so Workshop, Docket, Receipts and Home still work. npm runs with Node's `--use-system-ca` so it trusts the certificates your computer trusts. Run the installer again later to add them.

- Windows (PowerShell): `irm https://dispatch.alexisdavidson.org/install.ps1 | iex`
- macOS or Linux: `curl -fsSL https://dispatch.alexisdavidson.org/install.sh | bash`

The scripts are `scripts/bootstrap.ps1` and `scripts/bootstrap.sh`; the Worker (`worker/index.js`) serves them at `/install.ps1` and `/install.sh` on either domain, with the site filled in. They install into `%LOCALAPPDATA%\Workshop` or `~/.local/share/workshop` (set `WORKSHOP_INSTALL_DIR` to change it; `WORKSHOP_WORKSPACE` changes the workspace folder) and put a `workshop` command on PATH. `workshop open` opens Workshop signed in; `workshop open --print` prints the address for another browser.

### By hand

1. Get the code: `git clone https://github.com/adavidson21/workshop` (or download the zip).
2. Install, per user:
   - macOS or Linux: `bash scripts/install.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`
   This checks Node and creates `~/.workshop`. Start at login stays off; pass `--login` (or `-Login` on Windows) to turn it on, or turn it on later in Settings.
3. Start it now: `node workshop.mjs start`, then open the address it prints in Chrome or Edge on this computer. That signs the browser in to Workshop on this computer.
4. Open https://workshop.alexisdavidson.org in the same browser and click **Connect** on the rail.

Other commands:

- `node workshop.mjs install --allow <site> --workspace <folder>` turns on hosted mode for a site and the opencode connector. It only adds, so settings changed later in Settings are kept.
- `node workshop.mjs open` opens Workshop in your default browser, signed in.
- `node workshop.mjs doctor` checks Node, `config.json`, the port, the data folder, start at login, hosted mode, work mode's pinned copy and opencode's AI providers. `node workshop.mjs doctor ado` checks the ADO connector.
- `node workshop.mjs publish --out dist` builds the static site for hosted or browser mode, with `apps/registry.json`.
- `node workshop.mjs pin` builds work mode's pinned copy (see Work mode below).
- `node workshop.mjs update` lists the release tags; `update --tag <tag>` moves this checkout to one (`--pull` is the old git pull). `node workshop.mjs uninstall` turns off start at login; your data folder (`~/Workshop` by default) and `~/.workshop` stay where they are.

Start at login and hosted mode are off until you turn them on, and never need admin rights. See [docs/security.md](docs/security.md) for what Workshop stores, where, and the checks that keep it on your computer.

## Work mode

For a work laptop: Workshop runs from a pinned copy on your computer instead of its site, so the code that can read your work data changes only when you update it, and no site can pair with Workshop. Details: [docs/run-modes.md](docs/run-modes.md), Work mode; [docs/security.md](docs/security.md), Work mode.

**Set it up (by hand, recommended at work):**

1. Clone Workshop and Docket at release tags, side by side:
   `git clone --branch <workshop tag> https://github.com/adavidson21/workshop` and `git clone --branch <docket tag> https://github.com/adavidson21/docket`
2. Install: `powershell -ExecutionPolicy Bypass -File workshop\scripts\install.ps1` (or `bash workshop/scripts/install.sh`).
3. `node workshop/workshop.mjs install --work-mode`, then `node workshop/workshop.mjs pin` (it finds the `docket` folder next to Workshop; or pass `--docket <folder>`).
4. `node workshop/workshop.mjs start` and open the address it prints. Workshop opens there, from the pinned copy.
5. In Settings, set the opencode connector's **Approved AI providers** to your company's provider, then run `workshop doctor`: it checks the pinned copy and that opencode can use no other provider.

**With the one-line installer:** set `WORKSHOP_WORK_MODE=1` and the tags first, for example in PowerShell `$env:WORKSHOP_WORK_MODE='1'; $env:WORKSHOP_TAG='v1.0.0'; $env:TANDEM_TAG='v1.8.1'; $env:DOCKET_TAG='v4.7.0'`, then run the install command. Without tags it installs the newest code and says so.

**Updating:** `workshop update` lists the tags; `workshop update --tag <tag> [--docket-tag <tag>]` moves to them and rebuilds the pinned copy. Restart Workshop afterwards. Building again keeps the last copy in `~/.workshop/ui.previous/`.

Turn work mode off in Settings (Workshop on this computer) to go back to the hosted site; your allowed sites are kept.

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
  device-fs.js          the Android app's storage on the phone, for the SDK's device store
  save-file.js          downloads in a browser, Android's share sheet in the app
  fonts/                self-hosted Inter and JetBrains Mono (OFL), fonts.css
  vendor/               third-party code served from this site (SheetJS); see vendor/README.md
  screenshots/          images for the install dialog
  test/                 SDK tests
apps/                   one folder per app, each with an app.json (docs/app-manifest.md)
  registry.json         the app list for static sites (node shell/registry.mjs writes it)
  remote.json           apps from another site, served under /apps/<id>/ by the Worker (Docket)
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

### Apps from another site

An app can live in its own repo and deploy to its own site, and still open inside Workshop. Docket works this way. The shell only frames pages from its own origin, so the Worker (`worker/index.js`) serves the app's site under `/apps/<id>/`:

- `apps/remote.json` lists each one: its `id`, `site`, `repo`, the name of a service `binding` in `wrangler.jsonc` (optional; without it the Worker fetches the site over the internet), and a snapshot of its `app.json`.
- `/apps/<id>/<path>` comes from `<site>/<path>`. A deploy of the app's site shows up in Workshop right away.
- `/apps/registry.json` gets the app's live `app.json` from its site, so a new file or command needs no Workshop change. The snapshot is the fallback if the site is down; `node shell/registry.mjs --refresh-remote` updates it.
- Opening `/apps/<id>/` on its own (not in the shell) goes to the app's site, its standalone address.
- The app keeps exact copies of the `shared/` files it uses, so it also runs on its own. After changing one of those here, update the copies in the app's repo (Docket: `node scripts/sync-workshop.mjs --update`).
- CI checks out each app's repo into `.remote/<id>/` (gitignored), so `check-offline`, `check-remote` and `e2e.py` run against it. To run them locally: `git clone https://github.com/adavidson21/docket .remote/prioritizer`.
- Deploy the app's Worker before the first Workshop deploy that binds to it: Cloudflare refuses a binding to a Worker that does not exist.

### No third-party requests

Pages load files from this site only, plus the local helpers on `http://127.0.0.1`. Fonts are in `shared/fonts/` and libraries in `shared/vendor/`; nothing comes from a CDN. A Content-Security-Policy meta tag on each page enforces this, and `tests/e2e.py` fails if any request goes anywhere else.

### Themes

Edit `shared/themes.css` only, then update `THEMES` and `SWATCH` in `shared/theme.js` (`node tests/check-themes.mjs` fails until they match). Every app, Agents included, loads `themes.css` directly. Until WS8, eng-agents' static page still copies it with `sync-themes.mjs`.

## Running it locally

Serve the site with any static web server, for example `python -m http.server 8000`, then open `http://localhost:8000/` (browser mode). Docket comes from `.remote/prioritizer/` in CI and `tests/e2e.py`; a plain static server shows it only if you serve that checkout under `/apps/prioritizer/`.

To use the agent with it:

```
node agent/start.mjs
```

Open the address it prints once (Workshop on this computer, which signs this browser in). Add `http://localhost:8000` under Allowed sites there, then click **Connect** on the local site.

## Checks

```
node tests/check-themes.mjs              theme.js matches themes.css
node tests/check-offline.mjs             every file the pages and app modules load is cached by sw.js
node tests/check-remote.mjs              apps from another site: Home still reads Docket's tasks (needs .remote/)
node shell/registry.mjs --check          apps/registry.json lists every app folder and remote app
node --test "shared/test/*.test.mjs"     the SDK, against the docs' cases and the mock agent
node --test "apps/*/test/*.test.mjs"     apps' own tests
node --test "worker/test/*.test.mjs"     the Worker: Dispatch's domain, installers, apps from another site
node tests/check-vendor.mjs              vendored libraries match their pinned SHA256SUMS (--write after updating one)
python tests/e2e.py                      Workshop in headless Chromium: browser, local and hosted modes, Docket storage (needs .remote/prioritizer)
python tests/workmode-e2e.py             work mode in headless Chromium: the pinned copy, Docket inside it, no hosted access
```

`e2e.py` needs `pip install playwright` and `python -m playwright install chromium`. These, the contract suite and the agent and connector tests run on every push (`.github/workflows/checks.yml`).

## Shipping

A Cloudflare Worker serves the repo root (`wrangler.jsonc`; Cloudflare's Git integration runs `npx wrangler deploy` on every push to `main`). Files that are not part of the site are listed in `.assetsignore`. When you ship a change, bump `VERSION` in `sw.js` so open windows offer a "New version" reload, and run `node shell/registry.mjs` if an app's `app.json` changed.

Workshop lives at https://workshop.alexisdavidson.org. Docket deploys from its own repo to https://docket.alexisdavidson.org, and the `DOCKET` service binding in `wrangler.jsonc` connects the two (see Apps from another site). If the site moves to another host, update `shellOrigins` (above) and `allowed_origins` in Docket's `ado-helper/ado_helper.py` (or your `ado-helper.json`); browser storage does not move between hosts, so export from the old one and import on the new one.

## License

MIT, see `LICENSE`. Bundled fonts and libraries keep their own licenses: `shared/fonts/OFL-*.txt` and `shared/vendor/LICENSE-SheetJS.txt`.

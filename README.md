# Workshop

An engineering manager's hub: one page with a rail of apps, sharing one theme. Workshop brings together Docket, Dispatch, Rapport, Notes, Runway, and Tandem, the agent scaffolding Dispatch runs on.

- **Home** (the Workshop logo at the top of the rail) is your day at a glance: what's on Today, what to triage, what's overdue or due this week, your top 3 tasks, your people, and agents waiting on you. Guide: [apps/home/README.md](apps/home/README.md).
- **Docket** (formerly Prioritizer; code and URLs still say `prioritizer`) decides what to work on next (work items assigned to you and pull requests waiting on your review become tasks when the ADO connector is on), Its code lives in its own repo, [adavidson21/docket](https://github.com/adavidson21/docket), and its own site, https://docket.alexisdavidson.org; Workshop shows it inside the shell by serving that site under `apps/prioritizer/` (see Apps from another site below). User guide: [Docket's README](https://github.com/adavidson21/docket#readme).
- **Dispatch** (formerly Agents; code and URLs still say `agents`) is the front end for [Tandem](https://github.com/adavidson21/eng-agents) (the eng-agents repo), the agent scaffolding that drives opencode. It shows your work items and the opencode agents working on them, and runs the next step. It needs Workshop running on this computer with the opencode connector on.
- **Rapport** (formerly Receipts, with 1:1s inside since 2.0.0) keeps receipts and 1:1s for you, your reports and your manager: your own receipts for a self review (the main use), each direct report's page with your 1:1 prep and note above their receipts, a 1:1s tab with everyone you meet with by who is due, a Goals tab with the team's and each report's OKRs as a tree (one plain `.md` file per owner per quarter, key results updated in place), optional upward notes, and review drafts grouped by your review form's sections. 1:1 prep gathers what Docket and Rapport know since your last 1:1; notes are plain `.md` files in your Workshop folder; after the meeting, follow-ups are copied as Docket quick-add lines and wins become receipts. Drafting talking points with your opencode agents is optional. Its code lives in its own repo, [adavidson21/receipts](https://github.com/adavidson21/receipts), with its own site, https://receipts.alexisdavidson.org; Workshop serves it under `/apps/receipts/` like Docket and Runway (apps/remote.json). Guide: that repo's README.
- **Runway** is team and project roadmaps: type an outline or drag a timeline, export an image or Markdown. Ad hoc roadmaps need nothing else; with the ADO connector on it can also import Epics and Features to edit, or show a live ADO view. Its code lives in [adavidson21/runway](https://github.com/adavidson21/runway) and is served here under `/apps/runway/`.
- **Notes** is Markdown notes in your Workshop folder, like a small Obsidian: a folder tree, links with backlinks, tags, search, and images you paste in. Files are plain `.md` with standard links, so they work in any Markdown tool. Copy or download a note as Markdown; nothing is published. Guide: [apps/notes/README.md](apps/notes/README.md).
- **People** is everyone you assign work to (you, your manager, reports, peers, contacts) and groups of them (`@leadership`), shared by every app. Add people one at a time, or download the spreadsheet template, fill it in, and import it; you see every add and update before anything is saved. It also holds your team's Azure DevOps area paths.
- **Settings** turns Workshop's features and connectors on and off, edits each connector's settings, has one **Repos** tab for adding a repo and choosing its ADO project and whether Docket shows its pull requests, and downloads or imports a copy of your data.

Docket and Dispatch also open on their own pages (https://docket.alexisdavidson.org and `apps/agents/`), with the same top bar as the other tools: breadcrumbs and the light/dark toggle. Opening `apps/prioritizer/` on its own here goes to Docket's site. Dispatch has its own address, https://dispatch.alexisdavidson.org: the Workshop Worker (`wrangler.jsonc`, `worker/index.js`) serves `apps/agents/` there; both domains are listed in `wrangler.jsonc`, and the old standalone address forwards to it. Until it can reach Workshop on your computer, Dispatch shows a two-step setup guide: paste one install command (see One-line install below), then connect. Once connected, the opencode connector's settings (workspace folder and so on) are under opencode settings in Dispatch's menu.

Switch apps from the rail, or with `Alt+1`, `Alt+2` and so on. `Ctrl+K` (`Cmd+K` on a Mac) opens the command palette: every app's commands, from anywhere. Each app keeps its state while you're in another one. The first app is the plain address; the others are `#/<app>`, and `#/<app>/<path>` opens an app at a place, for example `#/agents/<work item id>` or `#/prioritizer/task/<task id>`.

## At work: start here

On a work computer, use work mode. Workshop runs only from a copy on your computer, no website can reach it, and your data goes in your company OneDrive so it is backed up.

1. **Install.** In PowerShell, as yourself (not admin): `irm https://workshop.alexisdavidson.org/install-work.ps1 | iex` (macOS: `curl -fsSL https://workshop.alexisdavidson.org/install-work.sh | bash`). It needs no admin rights and leaves Dispatch out. If your company blocks piping a script, use the by-hand steps in Work mode below.
2. **Open it.** The installer opens Workshop when it finishes. After that, open it from the Start menu: **Workshop** starts it if needed and opens it (`workshop up` does the same). **Restart Workshop** and **Stop Workshop** are next to it. On a Mac, `workshop up` and `workshop restart`.
3. **Follow Get started on Home.** It ticks itself off as you go: your name, backup, Azure DevOps (`workshop pat` saves your token; Settings imports your `ado-helper.json`), your team (in People), a Docket task and a receipt. Docket starts syncing ADO by itself once the connector is ready.
4. **Every day:** Home's quick capture for anything that comes up, Docket for what to do next, Rapport for 1:1s and receipts.

Commands you may need: `workshop doctor` (checks everything), `workshop data-folder` (where your data is; `--onedrive` moves it there), `workshop restart`, `workshop update` (see Work mode), `workshop apps` (turn apps on and off; also in Settings, Apps).

Testing Workshop with a team at work? Work mode and the other items in [docs/team-testing.md](docs/team-testing.md) are prerequisites.

Your data stays on your device. There are no accounts and no server holds your data: it is saved in your browser, or in files on this computer when Workshop runs there. The page talks only to its own site, `127.0.0.1` and the systems you set up in Settings. The exception is Dispatch, whose coding agents send work to the AI provider you connect to opencode. What Workshop stores, where it sends data and what to tell your security team: [docs/security.md](docs/security.md) and [docs/for-security-teams.md](docs/for-security-teams.md).

Workshop always opens from its site, https://workshop.alexisdavidson.org (see [docs/run-modes.md](docs/run-modes.md)). With the Workshop agent running on your computer and the site paired (**Connect** on the rail), data is files on your computer and connectors work. Without it, data is saved in your browser or a folder you pick. The agent serves only **Workshop on this computer** at the address it prints: it signs your browser in, approves pairing, and holds the settings a public site must never change by itself (connectors on or off, ADO servers, the data folder, allowed sites, start at login). `workshop open` opens it.

## Dispatch

Dispatch is where Tandem's coding agents run, as a Workshop app (it replaced the eng-agents live dashboard). It reads `.work` and follows opencode through the opencode connector ([connectors/opencode/README.md](connectors/opencode/README.md)), so it needs the Workshop agent on this computer. There is nothing to start in eng-agents and no `shellOrigins` to set.

**Once:**

1. Start Workshop on this computer (`node workshop.mjs start`) and open it.
2. In **Settings**, turn on the opencode connector and set **Workspace folder** to the folder that holds `.work` and your repos. The connector needs PowerShell (`pwsh` on a Mac) and opencode 1.x or 2.x with eng-agents installed.
3. Open **Dispatch**. If the connector can't start, the page says why.

Docket shows each ADO task's Tandem stage and can start a work item, through the same connector. Clicking a stage opens that item in Dispatch (`#/agents/<work item id>`).

eng-agents' own static page (`/dashboard static`) is unchanged.

## Install it as a desktop app

In Chrome or Edge, open Workshop and click **Install** on the rail (or the install icon in the address bar). Like Google Drive's desktop app, it then opens in its own window with a dock or taskbar icon, works offline, and opening it again brings back the window you already have. Right-click the icon for **Docket**, **Dispatch** and **Rapport** shortcuts.

It installs per user from the browser, with no admin rights or executable. If Install never appears on a work laptop, your company's browser policy may block web app installs. On a phone, use "Add to Home Screen".

## Docket on Android

Docket is also an Android app, with its board saved in the app's own storage on the phone (never on a server, and not cleared like browser storage). Android visitors to Docket's page get a "Get the app" banner linking to the latest build. It is built in Docket's repo: see [mobile/README.md](https://github.com/adavidson21/docket/blob/main/mobile/README.md) there.

The install dialog shows `shared/screenshots/wide.png` and `shared/screenshots/narrow.png` (sample data). Regenerate them when the look changes a lot.

## Install and run the agent

The agent is one local process: it serves the Workshop UI at `http://127.0.0.1:<port>`, keeps your data on disk, and hosts connectors. Node 22 or later, no admin rights, no npm install.

### One-line install (Workshop and Tandem)

This is what Dispatch's setup guide shows. It installs per user with no admin rights: Node, opencode and git if they are missing (git as MinGit on Windows; on a Mac it asks macOS to install its command line tools; plus PowerShell 7 on a Mac or Linux), Workshop and Tandem (eng-agents) from GitHub with no git needed, then installs Tandem into opencode. If opencode has no AI provider yet, the Windows installer asks to connect one (`opencode auth login`); on macOS and Linux the last lines say to run `opencode auth login` in a new terminal, because its menu does not get the keyboard inside `curl | bash`. It then turns on hosted mode for the site it came from and the opencode connector with workspace `~/work`, starts Workshop and opens it once to sign the browser in. Running it again updates everything and keeps your settings.

Start at login stays off (run Workshop by hand for a few days first; turn it on later in Workshop on this computer), unless you set `WORKSHOP_LOGIN=1` before running the installer; a setting you turned on earlier is kept. opencode and Tandem are only needed for Dispatch: if a company network blocks installing them (for example npm behind an HTTPS-inspecting proxy), the installer says so and carries on, so Workshop, Docket, Rapport and Home still work. npm runs with Node's `--use-system-ca` so it trusts the certificates your computer trusts. Run the installer again later to add them.

- Windows (PowerShell): `irm https://dispatch.alexisdavidson.org/install.ps1 | iex`
- macOS or Linux: `curl -fsSL https://dispatch.alexisdavidson.org/install.sh | bash`

Dispatch's parts (opencode, Tandem, git or PowerShell, the AI model) are skipped with `WORKSHOP_DISPATCH=0`, and are skipped by default in work mode (`WORKSHOP_DISPATCH=1` adds them). `OPENCODE_VERSION=<version>` installs that opencode version instead of the newest. On a work laptop, piping a downloaded script into PowerShell or bash is often flagged by endpoint security; use the by-hand install in Work mode below instead.

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
- `node workshop.mjs stop` stops Workshop; `node workshop.mjs restart` stops it and starts it again in the background (no window).
- `node workshop.mjs pat ADO_PAT` saves your Azure DevOps PAT without showing it or leaving it in shell history. On Windows, Workshop picks it up within seconds with no restart. See [connectors/ado/README.md](connectors/ado/README.md), Setting up and renewing a PAT.
- `node workshop.mjs doctor` checks Node, `config.json`, the port, the data folder, start at login, hosted mode, work mode's pinned copy and opencode's AI providers. `node workshop.mjs doctor ado` checks the ADO connector.
- `node workshop.mjs publish --out dist` builds the static site for hosted or browser mode, with `apps/registry.json`.
- `node workshop.mjs pin` builds work mode's pinned copy (see Work mode below).
- `node workshop.mjs update` moves Workshop, Docket, Runway and Rapport to their newest release tags; `update --check` lists the tags and changes nothing, `update --tag <tag>` moves this checkout to one (`--pull` is the old git pull). `node workshop.mjs uninstall` turns off start at login; your data folder (`~/Workshop` by default) and `~/.workshop` stay where they are.

Start at login and hosted mode are off until you turn them on, and never need admin rights. See [docs/security.md](docs/security.md) for what Workshop stores, where, and the checks that keep it on your computer.

## Work mode

For a work laptop: Workshop runs from a pinned copy on your computer instead of its site, so the code that can read your work data changes only when you update it, and no site can pair with Workshop. Details: [docs/run-modes.md](docs/run-modes.md), Work mode; [docs/security.md](docs/security.md), Work mode.

**Testing with a team:** work mode is a prerequisite. Before anyone tests with real work data, go through [docs/team-testing.md](docs/team-testing.md).

**Release tags.** Work mode installs and updates only by tag. Tags are `v<version>` in Workshop, Docket, Runway and Rapport (receipts) (for example `v1.0.0` and `v4.13.1`) and `core-v<version>` in eng-agents (for example `core-v2.8.1`). Use the newest of each, listed on each repo's Releases page.

**Set it up (by hand, recommended at work):**

1. Check `node -v` says 22 or later (22.15 or later on Windows, so Node uses the system certificate store). Get it from https://nodejs.org or your company's software portal.
2. Clone Workshop, Docket, Runway and Rapport at their release tags, side by side in one folder:
   `git clone --branch <workshop tag> https://github.com/adavidson21/workshop`, then the same for `docket`, `runway` and `receipts`
3. Install in work mode and build the pinned copy: `powershell -ExecutionPolicy Bypass -File workshop\scripts\install.ps1 -WorkMode` (on a Mac or Linux: `bash workshop/scripts/install.sh --work-mode`). It turns on work mode, builds the copy from the `docket`, `runway` and `receipts` folders next to Workshop, and adds a `workshop` command for new terminal windows. Open a new terminal before using `workshop`; until then use `node workshop/workshop.mjs` the same way.
4. `workshop start`, then `workshop open`. Workshop opens at the `http://127.0.0.1:...` address from the pinned copy. Settings says "Work mode is on" and shows the tags. There is no **Connect** step in work mode.
5. Add your ADO connection in Settings and save your token with `workshop pat ADO_PAT` (the Home page's **Get started** walks you through it).
6. Run `workshop doctor` and continue when it ends with `Result: all good.`

**Dispatch in work mode (only if your company allows a coding agent):**

1. Install opencode, then run `workshop apps on dispatch`. It clones Tandem (eng-agents) next to Workshop at its newest `core-v` release and installs it into opencode (`~/.config/opencode`). If you already have an eng-agents clone, move it next to Workshop first so Workshop keeps it updated.
2. In Settings, turn on the opencode connector and set its **Workspace folder** first (the folder with your repos and `.work`). Then set **Approved AI providers** to your company's provider.
3. Add `"enabled_providers": ["<that provider>"]` to `~/.config/opencode/opencode.json`, so opencode cannot use any other provider.
4. Run `workshop doctor` again. It checks that opencode can use only the approved provider.
5. `workshop update` keeps Tandem at its newest release tag along with everything else, and `workshop doctor` says when opencode's copy is behind the checkout. Restart Workshop after a Tandem update so opencode loads the new agents.

**Adding or removing an app in work mode:** run `workshop apps on runway` (or `docket`, `rapport`). It downloads the app next to Workshop at its newest release if it is not there yet, then rebuilds the pinned copy; reload Workshop. `workshop apps off <app>` takes one out. Settings, Apps has the same switches, and shows the command when an app still needs downloading. See [docs/apps.md](docs/apps.md).

**With the one-line installer:** `/install-work.ps1` and `/install-work.sh` are the same installers with work mode on (At work, above). On a new install, work mode puts the data folder in your company OneDrive when there is one (`OneDriveCommercial` on Windows, `~/Library/CloudStorage/OneDrive-<Company>` on a Mac; never a personal OneDrive); set `WORKSHOP_DATA_DIR` to choose another folder. An existing data folder is never moved by the installer: `workshop data-folder <folder>` or `--onedrive` copies it and switches. To pin releases, set `WORKSHOP_WORK_MODE=1` and the tags first, for example in PowerShell `$env:WORKSHOP_WORK_MODE='1'; $env:WORKSHOP_TAG='v1.0.0'; $env:TANDEM_TAG='core-v2.8.1'; $env:DOCKET_TAG='v4.13.1'` (and `RUNWAY_TAG`, `RECEIPTS_TAG`), then run the install command. Without tags it installs the newest code and says so. In work mode the installer leaves Dispatch out (no opencode, Tandem, git or PowerShell download, no AI question); add `$env:WORKSHOP_DISPATCH='1'` when your company allows a coding agent and an AI provider.

**Updating:** `workshop update` moves Workshop, Docket, Runway and Rapport each to its newest release tag (skipping any already there), rebuilds the pinned copy (always, so an app added since the last build shows up), and moves Tandem (eng-agents, when it is next to Workshop) to its newest `core-v` tag and reinstalls it in opencode when opencode's copy is behind (with its own `update.ps1 -Tag <tag> -Yes`, which keeps your Personal and Company layers). `workshop update --check` only lists the release tags; `workshop update --tag <tag> [--docket-tag <tag>] [--runway-tag <tag>] [--receipts-tag <tag>] [--eng-agents-tag <tag>]` moves to specific ones. Restart Workshop afterwards if Workshop itself moved; otherwise reloading is enough. Building again keeps the last copy in `~/.workshop/ui.previous/`.

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
  remote.json           apps from another site, served under /apps/<id>/ by the Worker (Docket, Runway, Rapport)
  agents/               Dispatch (Tandem's runs, on the opencode connector)
  people/               People (the people directory and your team's area paths)
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
- CI checks out each app's repo into `.remote/<id>/` (gitignored), so `check-offline`, `check-remote` and `e2e.py` run against it. To run them locally: `git clone https://github.com/adavidson21/docket .remote/prioritizer` `git clone https://github.com/adavidson21/runway .remote/runway` and `git clone https://github.com/adavidson21/receipts .remote/receipts`.
- Deploy the app's Worker before the first Workshop deploy that binds to it: Cloudflare refuses a binding to a Worker that does not exist.

### No third-party requests

Pages load files from this site only, plus the local helpers on `http://127.0.0.1`. Fonts are in `shared/fonts/` and libraries in `shared/vendor/`; nothing comes from a CDN. A Content-Security-Policy meta tag on each page enforces this, and `tests/e2e.py` fails if any request goes anywhere else.

### Themes

Edit `shared/themes.css` only, then update `THEMES` and `SWATCH` in `shared/theme.js` (`node tests/check-themes.mjs` fails until they match). Every app, Dispatch included, loads `themes.css` directly.

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
python tests/workmode-e2e.py             work mode in headless Chromium: the pinned copy, Docket, Runway and Rapport inside it, no hosted access
```

`e2e.py` needs `pip install playwright` and `python -m playwright install chromium`. These, the contract suite and the agent and connector tests run on every push (`.github/workflows/checks.yml`).

## Shipping

A Cloudflare Worker serves the repo root (`wrangler.jsonc`; Cloudflare's Git integration runs `npx wrangler deploy` on every push to `main`). Files that are not part of the site are listed in `.assetsignore`. When you ship a change, bump `VERSION` in `sw.js` so open windows offer a "New version" reload, and run `node shell/registry.mjs` if an app's `app.json` changed.

Workshop lives at https://workshop.alexisdavidson.org. Docket deploys from its own repo to https://docket.alexisdavidson.org, and the `DOCKET` service binding in `wrangler.jsonc` connects the two (see Apps from another site). If the site moves to another host, update `shared/site.js` (every site address lives there; `tests/check-site.mjs` finds any other); browser storage does not move between hosts, so export from the old one and import on the new one.

## License

[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0), see `LICENSE`. Free to use, change and share, including at work; not for building a product that competes with it. Versions up to November 5, 2026 were MIT and stay MIT. Bundled fonts and libraries keep their own licenses: `shared/fonts/OFL-*.txt` and `shared/vendor/LICENSE-SheetJS.txt`.

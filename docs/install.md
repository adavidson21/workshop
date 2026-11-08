# Installing Workshop: the full reference

The [README](../README.md) has the short version: pick personal or work, run one command, follow **Get started**. This page has every option, setting and command behind it.

## How Workshop runs

Workshop always opens from its site, https://workshop.alexisdavidson.org (see [run-modes.md](run-modes.md)). With the Workshop agent running on your computer and the site paired (**Connect** on the rail), data is files on your computer and connectors work. Without it, data is saved in your browser or a folder you pick. The agent serves only **Workshop on this computer** at the address it prints: it signs your browser in, approves pairing, and holds the settings a public site must never change by itself (connectors on or off, ADO servers, the data folder, allowed sites, start at login). `workshop open` opens it.

There are three ways to run it ([run-modes.md](run-modes.md) has the details):

- **Browser only:** open the site, nothing installed. Data is saved in your browser or a folder you pick. No Azure DevOps sync, no Dispatch.
- **Personal (hosted):** the Workshop agent runs on your computer and the site pairs with it (**Connect** on the rail). Data is files on your computer and connectors work.
- **Work mode:** Workshop runs from a pinned copy on your computer, no website can reach it, and your data goes in your company OneDrive.

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
- `node workshop.mjs pat ADO_PAT` saves your Azure DevOps PAT without showing it or leaving it in shell history. On Windows, Workshop picks it up within seconds with no restart. See [connectors/ado/README.md](../connectors/ado/README.md), Setting up and renewing a PAT.
- `node workshop.mjs doctor` checks Node, `config.json`, the port, the data folder, start at login, hosted mode, work mode's pinned copy and opencode's AI providers. `node workshop.mjs doctor ado` checks the ADO connector.
- `node workshop.mjs publish --out dist` builds the static site for hosted or browser mode, with `apps/registry.json`.
- `node workshop.mjs pin` builds work mode's pinned copy (see Work mode below).
- `node workshop.mjs update` moves Workshop, Docket, Runway and Rapport to their newest release tags; `update --check` lists the tags and changes nothing, `update --tag <tag>` moves this checkout to one (`--pull` is the old git pull). `node workshop.mjs uninstall` turns off start at login; your data folder (`~/Workshop` by default) and `~/.workshop` stay where they are.

Start at login and hosted mode are off until you turn them on, and never need admin rights. See [security.md](security.md) for what Workshop stores, where, and the checks that keep it on your computer.

## Work mode

For a work laptop: Workshop runs from a pinned copy on your computer instead of its site, so the code that can read your work data changes only when you update it, and no site can pair with Workshop. Details: [run-modes.md](run-modes.md), Work mode; [security.md](security.md), Work mode.

**Testing with a team:** work mode is a prerequisite. Before anyone tests with real work data, go through [team-testing.md](team-testing.md).

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

1. Install opencode, then run `workshop apps on dispatch`. It clones Tandem (eng-agents) next to Workshop at its newest `core-v` release and installs it into opencode (`~/.config/opencode`). If you already have an eng-agents clone somewhere else, Workshop finds it from opencode's install and keeps it updated (or name it with `workshop update --eng-agents <folder>`).
2. In Settings, turn on the opencode connector and set its **Workspace folder** first (the folder with your repos and `.work`). Then set **Approved AI providers** to your company's provider.
3. Add `"enabled_providers": ["<that provider>"]` to `~/.config/opencode/opencode.json`, so opencode cannot use any other provider.
4. Run `workshop doctor` again. It checks that opencode can use only the approved provider.
5. `workshop update` keeps Tandem at its newest release tag along with everything else, and `workshop doctor` says when opencode's copy is behind the checkout. Restart Workshop after a Tandem update so opencode loads the new agents.

**Adding or removing an app in work mode:** run `workshop apps on runway` (or `docket`, `rapport`). It downloads the app next to Workshop at its newest release if it is not there yet, then rebuilds the pinned copy; reload Workshop. `workshop apps off <app>` takes one out. Settings, Apps has the same switches, and shows the command when an app still needs downloading. See [apps.md](apps.md).

**With the one-line installer:** `/install-work.ps1` and `/install-work.sh` are the same installers with work mode on (see the README). On a new install, work mode puts the data folder in your company OneDrive when there is one (`OneDriveCommercial` on Windows, `~/Library/CloudStorage/OneDrive-<Company>` on a Mac; never a personal OneDrive); set `WORKSHOP_DATA_DIR` to choose another folder. An existing data folder is never moved by the installer: `workshop data-folder <folder>` or `--onedrive` copies it and switches. To pin releases, set `WORKSHOP_WORK_MODE=1` and the tags first, for example in PowerShell `$env:WORKSHOP_WORK_MODE='1'; $env:WORKSHOP_TAG='v1.0.0'; $env:TANDEM_TAG='core-v2.8.1'; $env:DOCKET_TAG='v4.13.1'` (and `RUNWAY_TAG`, `RECEIPTS_TAG`), then run the install command. Without tags it installs the newest code and says so. In work mode the installer leaves Dispatch out (no opencode, Tandem, git or PowerShell download, no AI question); add `$env:WORKSHOP_DISPATCH='1'` when your company allows a coding agent and an AI provider.

**Updating:** `workshop update` moves Workshop, Docket, Runway and Rapport each to its newest release tag (skipping any already there), rebuilds the pinned copy (always, so an app added since the last build shows up), and moves Tandem (eng-agents: the clone next to Workshop, else the one opencode installed from, or `--eng-agents <folder>`) to its newest `core-v` tag and reinstalls it in opencode when opencode's copy is behind (with its own `update.ps1 -Tag <tag> -Yes`, which keeps your Personal and Company layers). `workshop update --check` only lists the release tags; `workshop update --tag <tag> [--docket-tag <tag>] [--runway-tag <tag>] [--receipts-tag <tag>] [--eng-agents-tag <tag>]` moves to specific ones. Restart Workshop afterwards if Workshop itself moved; otherwise reloading is enough. Building again keeps the last copy in `~/.workshop/ui.previous/`.

Turn work mode off in Settings (Workshop on this computer) to go back to the hosted site; your allowed sites are kept.

## Dispatch (personal computer)

Dispatch is where Tandem's coding agents run, as a Workshop app (it replaced the eng-agents live dashboard). It reads `.work` and follows opencode through the opencode connector ([connectors/opencode/README.md](../connectors/opencode/README.md)), so it needs the Workshop agent on this computer. There is nothing to start in eng-agents and no `shellOrigins` to set.

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

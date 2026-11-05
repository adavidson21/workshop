# Security and data flow

What Workshop stores, where it sends data (almost nowhere), and the checks that keep it on your computer. This is the doc the agent API points to for page security headers (see [agent-api.md](agent-api.md), Static files), and it is written to match what `tests/e2e.py` observes on the network.

## The short version

- Everything you create stays on your computer. There is no Workshop account, and no server holds your data.
- Where the code comes from: outside work mode, the hub and its apps load from Workshop's site (https://workshop.alexisdavidson.org, a Cloudflare Worker deployed from this repo's `main`; Docket from https://docket.alexisdavidson.org), and a paired site can use the agent. In work mode they load from a pinned copy on your disk and no site can use the agent. See Hosted mode and Work mode below.
- The agent binds `127.0.0.1` only and answers no one else on the network.
- The agent makes no outbound request of its own. Only a connector you turned on talks to the one system it is for (for example your Azure DevOps server), from your computer, using a token you keep in an environment variable.
- Dispatch is the one part that sends your work somewhere else: its coding agents (opencode) send prompts and the files they read to the AI provider opencode is set up with. It is optional, and the installer leaves it out in work mode unless you ask for it. See Outbound hosts.
- There is no telemetry, no analytics, no crash reporting, no update ping. Nothing phones home.
- On a computer where the code must not change by itself (a work laptop), work mode runs Workshop from a pinned copy on your disk, checked file by file, and no site can use the agent. See Work mode below.

## Data flow

In hosted mode (the default) the page itself comes from Workshop's site and talks to the agent the same way after pairing; in work mode it comes from the agent. Either way, data moves only between the page and the agent:

```
   your browser  --------- http://127.0.0.1:<port> --------->  Workshop agent
   (Workshop UI)  <-------- UI, app data, events -----------   (one local process)
                                                                   |
                                        reads and writes           |
                                                  +----------------+----------------+
                                                  v                                 v
                                     ~/Workshop/  (your data folder)      ~/.workshop/  (this computer)
                                       one folder per app                   config.json, token,
                                                                            logs/, connector storage

   a connector you turned on, inside the agent, is the only part that reaches out:

   Workshop agent  --- HTTPS, your PAT from an env var --->  the connector's own server
                                                              (for example your ADO server)
```

In browser-only mode there is no agent: the UI is static files, and Chrome reads and writes a folder you picked (usually the same data folder), or that browser's IndexedDB until you pick one. Nothing leaves the browser except loading the page's own files from wherever it is hosted.

## What is stored, and where

| What | Where | Notes |
| --- | --- | --- |
| Settings | `~/.workshop/config.json` | No secrets. Holds the names of environment variables that hold secrets, never the values. |
| The per-install token | `~/.workshop/token` | Readable by your user only (`0600`). Never shown in the UI or written to a log. |
| App data | Your data folder, `~/Workshop` by default (`dataDir` in settings): `<app>/...` | Your tasks, notes and so on. A folder you own: Workshop is a view over it, and deleting Workshop leaves it. Workshop never syncs or uploads it. |
| Trash and backups | `.trash/` and `.backups/` in your data folder | Files you deleted in Workshop, and copies kept before a format upgrade. Workshop never empties them. |
| App data from before the data folder | `~/.workshop/data/<app>/` | Copied into the data folder once, then left as a backup. Never deleted by Workshop. |
| A connector's private storage | `~/.workshop/data/_connectors/<id>/` | For example a connector's cache. Stays on this computer, never in the data folder. |
| Logs | `~/.workshop/logs/` | Never contain the token, PATs or the contents of your data. |
| Browser data (browser and hosted modes) | that browser's IndexedDB and `localStorage` | The handle to the folder you picked (IndexedDB), or app data until you pick one (IndexedDB, kept and marked moved after you do), your theme, and in hosted mode the paired agent address and token (`localStorage`, key `workshop.agent`). |

Set `WORKSHOP_HOME` to keep the `~/.workshop` items somewhere else. The data folder is set separately (`dataDir`) and may not be inside the Workshop home.

Secrets (Azure DevOps PATs and the like) live in environment variables, never in `config.json`. A connector's config names the variable (for example `"patEnv": "ADO_PAT"`); the agent reads the value from the environment and never stores, logs or returns it.

- **Saving a PAT.** `workshop pat ADO_PAT` asks for the token without showing it and, on Windows, saves it as a user environment variable (as the Windows settings dialog does), passing it to PowerShell on stdin. It never appears on a command line, in shell history (`setx ADO_PAT "<token>"` leaves it in PowerShell's history file), in `config.json` or in a log. On macOS and Linux it only explains where to put the variable.
- **No restart for a new PAT on Windows.** When a connector asks for a variable, the agent looks it up in the user's saved variables (`reg query HKCU\Environment /v <name>`, cached for a few seconds) before its own environment. This is the agent's only use of `child_process`; it runs no other program, and `agent/test/source.test.mjs` checks that.

## Outbound hosts

- The agent itself: none. It never makes an outbound request, and the only program it runs is `reg query` on Windows to read a saved variable (above). Turning an app on in Settings never downloads it: that is `workshop apps on <app>`, run by you, which clones the app's repo from GitHub ([apps.md](apps.md)). Its source is checked for this (`agent/test/source.test.mjs`).
- A connector you turned on: the servers in that connector's own config, and no others. The ADO connector reaches the Azure DevOps server URLs you set, over HTTPS, with your PAT.
- The opencode connector (Dispatch), when on: it reaches only the opencode server on this computer, but opencode itself sends prompts and the contents of files its agents read to the AI provider it is set up with, and agents run git against your repos' remotes (clone, fetch, push). Set **Approved AI providers** so `workshop doctor` checks opencode can use no other provider (connectors/opencode/README.md, Approved AI providers). Agents read pull requests and work items written by other people; treat that text as untrusted input to an agent that can run commands in your workspace.
- The browser: this site's own files only, plus the local agent on `127.0.0.1`. Fonts and libraries are served from the site (`shared/fonts/`, `shared/vendor/`), not a CDN. `tests/e2e.py` fails if any request goes anywhere else.

- The installer (only while it runs): GitHub for Workshop, Tandem and Docket (a release tag when you set one, otherwise the newest code on `main`), nodejs.org for a private Node when yours is older than 22.15, and, only for Dispatch, the npm registry for opencode (the newest version unless `OPENCODE_VERSION` is set) and GitHub releases for MinGit on Windows or PowerShell 7 on macOS and Linux (the newest release). Downloads are over HTTPS. Node, MinGit and PowerShell are checked against their published SHA-256 (nodejs.org's `SHASUMS256.txt`, GitHub's release file digest) and not used if they differ; when no hash is published the installer says so and carries on. npm checks opencode's package integrity itself. The Workshop, Tandem and Docket zips have no published hash, so at work prefer release tags and work mode (whose pinned copy records every file's SHA-256), or the by-hand install (README.md, Work mode).

No telemetry. Workshop sends no usage data, no analytics and no error reports anywhere, and checks for updates only when you run `workshop update` yourself.

## Network checks (the agent)

- **Binds `127.0.0.1` only.** It is not reachable from other machines.
- **Host check.** It answers only when `Host` is `127.0.0.1:<port>` or `localhost:<port>`. Anything else gets `403`. This blocks DNS rebinding.
- **Origin check.** A request carrying an `Origin` is refused unless the origin is the agent's own, or hosted mode is on and the origin is in your allowed list.
- **Token.** Every `/api/*` call except `GET /api/health` needs the per-install token, as a cookie (reads from the agent's own origin), the `X-Workshop-Token` header (required on every write), or a query token (for the event stream only). See [agent-api.md](agent-api.md), Token.

## Data folder access

The agent reads and writes only inside the data folder, and only through `/api/data` and `/api/files`. It never serves the data folder as static files.

- **Names, not paths.** Clients send app ids, collection names and file paths made of lowercase name segments (letters, digits and `-`) (`receipts/summaries/person-one/2026-h2.md`), at most 4 below the app. The agent checks each segment as sent, before any URL normalization: empty segments, `.` and `..` (raw or percent-encoded), encoded `/` or `\`, drive letters and absolute paths are refused with `400`. See [agent-api.md](agent-api.md), Endpoints.
- **No way out through links.** After following symbolic links and junctions, the file must still be inside the data folder (compared with where the data folder really is). Otherwise `400`, even for a read, and nothing is created.
- **Two file types.** The files API handles `.md` and `.json` only, at most 10 MB each. Nothing it writes can be run by the browser or the agent.
- **Nothing is removed.** Deleting a file moves it to `.trash/` in the data folder. Workshop never empties the trash, never removes backups, and never deletes the old `~/.workshop/data/` files.
- **Who can write.** A page on the agent's own origin, or a paired hosted origin (when hosted mode is on and that origin is allowed), can read and write app data and files, exactly as with `/api/data`. Neither can see or reach anything outside the data folder.
- **Hosted pages change only safe connector settings.** A paired hosted page can save connector fields marked `x-workshop-hosted` (for the opencode connector: the workspace folder, whether to start opencode, and the polling interval; for the ADO connector: which of your existing connections and projects a folder uses, and where to look for pull requests). Fields that name a server, a command, a file or an environment variable change only from the agent's own origin, as do all of `PUT /api/config` (hosted mode, allowed sites, connectors on and off).
- **Hosted pages cannot move the folder.** `dataDir` can be changed only from the agent's own origin (`PUT /api/config` answers `403 local_only` to hosted origins), by hand in `config.json`, and only takes effect after a restart. A hosted page can read the folder's path in `GET /api/config`, as it can read `home`, but can never point the agent at another folder, at the Workshop home or at the token.
- **Not inside the Workshop home.** `dataDir` may not be `~/.workshop` or a folder inside it, so the files API can never reach `config.json`, the token, logs or connector storage.
- **Changes outside Workshop** are only announced, never sent: the watcher's events say which collection or file changed, not what is in it.

In browser-only mode Chrome enforces the same boundary: the page can reach only the one folder you picked, and only after you allowed it with a click.

## Page security headers

The agent sends these headers with every page it serves. The policy matches the `Content-Security-Policy` meta tag the pages also carry, so a page behaves the same whether the agent serves it or a static host does.

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; frame-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` | Code, fonts and images come from this origin only; the page may talk to the local agent; no other site may frame it. |
| `X-Content-Type-Options` | `nosniff` | The browser does not second-guess a file's type. |
| `X-Frame-Options` | `SAMEORIGIN` | Older browsers' version of `frame-ancestors 'self'`. |
| `Referrer-Policy` | `no-referrer` | No referrer is sent anywhere. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | The page cannot use the camera, microphone or location. |

The pairing page (`/pair`) is stricter: it sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, so no site can frame it and trick you into clicking Allow.

## An invalid config stops the agent

If `config.json` is not valid JSON or does not match the config schema, the agent prints what is wrong and stops. It never overwrites a config it could not read, so a typo cannot cost you your settings. Fix the file, or move it away to start fresh, then start the agent again. `workshop doctor` reports the same problem without starting the agent.

## Hosted mode

Hosted mode lets a page on an allowed site use the local agent. A new install turns it on for the sites in `shared/site.js` (workshop., dispatch., docket., runway. and receipts.alexisdavidson.org), and each browser still pairs only after you click Allow; work mode turns it off for every site. The trade-off: a hosted page keeps the agent's token in that origin's `localStorage`, so any script that runs on that origin can use the agent: read and write app data, and call connector actions, including Dispatch's (start coding agents with instructions, run pipeline commands, clone repos into the workspace, change the workspace folder). `confirm: true` on write actions proves a click only in honest code; a hostile script can send it too. So anyone who could change what those sites serve (their repos, or the accounts that deploy them) could act on your computer through a paired agent. That is why work mode exists, why origins are allowed one by one, and why settings changes (`PUT /api/config`, including the data folder, and connector config) are refused from a hosted origin: change those from Workshop running on this computer. Pairing is confirmed by you, once per browser, on a page the agent serves that no other site can frame. See [run-modes.md](run-modes.md), Hosted mode.

## Work mode

Hosted mode trusts the site: the code that can read your data is whatever the site serves today, and it changes whenever the site deploys. Work mode (`features.workMode`, [run-modes.md](run-modes.md), Work mode) removes that:

- **The UI is a pinned copy on this computer** (`~/.workshop/ui/`, built by `workshop pin` from this install and a Docket checkout). Its `build.json` records the release tags and commits it came from and the SHA-256 of every file.
- **The agent serves only that copy**, and checks every file's bytes against `build.json` before sending it. A file that is not listed is `404`; a file that changed is refused and logged. `workshop doctor` checks the whole copy.
- **No site can pair or call the agent**, even one in `allowedOrigins`. Only pages from `127.0.0.1` can use it, and those pages make no request anywhere else (the same Content-Security-Policy as every page, checked by `tests/workmode-e2e.py`).
- **Updates are deliberate**: `workshop update` moves to the newest release tags and `workshop update --tag <tag>` to one you chose, and either rebuilds the copy. A tag that was moved on the remote after you fetched it is not taken (git refuses to replace it, and Workshop does not force it).

What work mode does not cover: the agent and connectors run from this install's files, so they are as trustworthy as the release you installed; and coding agents in Dispatch send work to the AI provider opencode is set up with. Set the opencode connector's approved providers so `workshop doctor` checks that (connectors/opencode/README.md, Approved AI providers).

## Vendored code

Third-party libraries served from the site (`shared/vendor/`, `apps/agents/vendor/`) have their SHA-256 pinned in `SHA256SUMS` in each folder, checked in CI by `node tests/check-vendor.mjs`, so a change to third-party code cannot land without its hash changing in review (shared/vendor/README.md, Hashes).

## Start at login

Start at login is off until you turn it on, and never needs admin rights. When on, Workshop writes one small launcher in your own account that starts the agent at your next login:

| Platform | Launcher |
| --- | --- |
| Windows | `Workshop.cmd` in your Startup folder |
| macOS | `~/Library/LaunchAgents/org.workshop.agent.plist` (runs at load) |
| Linux | `~/.config/autostart/workshop.desktop` |

Each one runs this computer's Node on `agent/start.mjs` quietly. Turning it off (in Settings, or `workshop uninstall`) removes the launcher. Nothing is installed system wide, and no service runs as another user.

## Updating and uninstalling

- **Update:** `workshop update` moves Workshop, Docket, Runway and Rapport to their newest release tags and, in work mode, rebuilds the pinned copy. When Tandem (eng-agents) is next to Workshop, it also runs Tandem's own `update.ps1 -Tag <newest core-v tag> -Yes` (PowerShell, `-ExecutionPolicy Bypass` for that file only) if opencode's copy is behind; that copies agents and commands into `~/.config/opencode`. `workshop apps on dispatch` in work mode clones Tandem next to Workshop and runs its `install.ps1` the same way. Neither runs from the agent or a page: only from your terminal. `workshop update --check` lists the release tags and changes nothing. `workshop update --tag <tag>` moves a git checkout to that release (it refuses local changes and unknown tags) and, in work mode, rebuilds the pinned copy; `--docket-tag` does the same for the Docket checkout. `workshop update --pull` is the newest code on the current branch, not a release. An install that is not a git checkout says to download a release, or to run the installer again with `WORKSHOP_TAG`. Check the version with `workshop version`. Open windows notice a new version and offer a reload once you ship it (the service worker's `CACHE`).
- **Uninstall:** `workshop uninstall` turns off start at login and removes the launcher. It leaves your data folder (`~/Workshop` by default) and `~/.workshop` in place; delete them yourself if you want them gone. There is nothing else to remove: no system service, no registry entries, no admin install.

## Checking your setup

`workshop doctor` checks your Node version, reads `config.json` and reports any problem with it, says whether the agent is running on its port, whether start at login agrees with the launcher, whether hosted mode has origins, whether work mode's pinned copy matches its `build.json`, and (when the opencode connector has approved providers) whether opencode can use any other AI provider. `workshop doctor ado` checks the ADO connector. Neither changes anything (and `workshop doctor ado --import --write` refuses to run while the agent is running, so it cannot clash with it).

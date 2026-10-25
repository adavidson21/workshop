# Security and data flow

What Workshop stores, where it sends data (almost nowhere), and the checks that keep it on your computer. This is the doc the agent API points to for page security headers (see [agent-api.md](agent-api.md), Static files), and it is written to match what `tests/e2e.py` observes on the network.

## The short version

- Everything you create stays on your computer. There is no Workshop account and no Workshop server.
- The agent binds `127.0.0.1` only and answers no one else on the network.
- The agent makes no outbound request of its own. Only a connector you turned on talks to the one system it is for (for example your Azure DevOps server), from your computer, using a token you keep in an environment variable.
- There is no telemetry, no analytics, no crash reporting, no update ping. Nothing phones home.

## Data flow

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

## Outbound hosts

- The agent itself: none. It never makes an outbound request. Its source is checked for this (`agent/test/source.test.mjs`).
- A connector you turned on: the servers in that connector's own config, and no others. The ADO connector reaches the Azure DevOps server URLs you set, over HTTPS, with your PAT.
- The browser: this site's own files only, plus the local agent on `127.0.0.1`. Fonts and libraries are served from the site (`shared/fonts/`, `shared/vendor/`), not a CDN. `tests/e2e.py` fails if any request goes anywhere else.

No telemetry. Workshop sends no usage data, no analytics and no error reports anywhere, and checks for updates only when you run `workshop update` yourself.

## Network checks (the agent)

- **Binds `127.0.0.1` only.** It is not reachable from other machines.
- **Host check.** It answers only when `Host` is `127.0.0.1:<port>` or `localhost:<port>`. Anything else gets `403`. This blocks DNS rebinding.
- **Origin check.** A request carrying an `Origin` is refused unless the origin is the agent's own, or hosted mode is on and the origin is in your allowed list.
- **Token.** Every `/api/*` call except `GET /api/health` needs the per-install token, as a cookie (reads from the agent's own origin), the `X-Workshop-Token` header (required on every write), or a query token (for the event stream only). See [agent-api.md](agent-api.md), Token.

## Data folder access

The agent reads and writes only inside the data folder, and only through `/api/data` and `/api/files`. It never serves the data folder as static files.

- **Names, not paths.** Clients send app ids, collection names and file paths made of lowercase name segments (`receipts/summaries/jordan-lee/h2-2026.md`), at most 4 below the app. The agent checks each segment as sent, before any URL normalization: empty segments, `.` and `..` (raw or percent-encoded), encoded `/` or `\`, drive letters and absolute paths are refused with `400`. See [agent-api.md](agent-api.md), Endpoints.
- **No way out through links.** After following symbolic links and junctions, the file must still be inside the data folder (compared with where the data folder really is). Otherwise `400`, even for a read, and nothing is created.
- **Two file types.** The files API handles `.md` and `.json` only, at most 10 MB each. Nothing it writes can be run by the browser or the agent.
- **Nothing is removed.** Deleting a file moves it to `.trash/` in the data folder. Workshop never empties the trash, never removes backups, and never deletes the old `~/.workshop/data/` files.
- **Who can write.** A page on the agent's own origin, or a paired hosted origin (when hosted mode is on and that origin is allowed), can read and write app data and files, exactly as with `/api/data`. Neither can see or reach anything outside the data folder.
- **Hosted pages cannot move the folder.** `dataDir` can be changed only from the agent's own origin (`PUT /api/config` answers `403 local_only` to hosted origins), by hand in `config.json`, and only takes effect after a restart. A hosted page can read the folder's path in `GET /api/config`, as it can read `home`, but can never point the agent at another folder, at the Workshop home or at the token.
- **Not inside the Workshop home.** `dataDir` may not be `~/.workshop` or a folder inside it, so the files API can never reach `config.json`, the token, logs or connector storage.
- **Changes outside Workshop** are only announced, never sent: the watcher's events say which collection or file changed, not what is in it.

In browser-only mode Chrome enforces the same boundary: the page can reach only the one folder you picked, and only after you allowed it with a click.

## Page security headers

The agent sends these headers with every page it serves. The policy matches the `Content-Security-Policy` meta tag the pages also carry, so a page behaves the same whether the agent serves it or a static host does.

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; frame-src 'self' http://127.0.0.1:*; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` | Code, fonts and images come from this origin only; the page may talk to the local agent; no other site may frame it. |
| `X-Content-Type-Options` | `nosniff` | The browser does not second-guess a file's type. |
| `X-Frame-Options` | `SAMEORIGIN` | Older browsers' version of `frame-ancestors 'self'`. |
| `Referrer-Policy` | `no-referrer` | No referrer is sent anywhere. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | The page cannot use the camera, microphone or location. |

The pairing page (`/pair`) is stricter: it sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, so no site can frame it and trick you into clicking Allow.

## An invalid config stops the agent

If `config.json` is not valid JSON or does not match the config schema, the agent prints what is wrong and stops. It never overwrites a config it could not read, so a typo cannot cost you your settings. Fix the file, or move it away to start fresh, then start the agent again. `workshop doctor` reports the same problem without starting the agent.

## Hosted mode

Hosted mode lets a page on your own domain use the local agent. It is off by default. The trade-off: a hosted page keeps the agent's token in that origin's `localStorage`, so any script that runs on that origin can use the agent. That is why hosted mode is off until you turn it on, why origins are allowed one by one, and why settings changes (`PUT /api/config`, including the data folder, and connector config) are refused from a hosted origin: change those from Workshop running on this computer. Pairing is confirmed by you, once per browser, on a page the agent serves that no other site can frame. See [run-modes.md](run-modes.md), Hosted mode.

## Start at login

Start at login is off until you turn it on, and never needs admin rights. When on, Workshop writes one small launcher in your own account that starts the agent at your next login:

| Platform | Launcher |
| --- | --- |
| Windows | `Workshop.cmd` in your Startup folder |
| macOS | `~/Library/LaunchAgents/org.workshop.agent.plist` (runs at load) |
| Linux | `~/.config/autostart/workshop.desktop` |

Each one runs this computer's Node on `agent/start.mjs` quietly. Turning it off (in Settings, or `workshop uninstall`) removes the launcher. Nothing is installed system wide, and no service runs as another user.

## Updating and uninstalling

- **Update:** `workshop update` runs `git pull` in a git checkout, or tells you to download the latest zip. Check the version with `workshop version`. Open windows notice a new version and offer a reload once you ship it (the service worker's `CACHE`).
- **Uninstall:** `workshop uninstall` turns off start at login and removes the launcher. It leaves your data folder (`~/Workshop` by default) and `~/.workshop` in place; delete them yourself if you want them gone. There is nothing else to remove: no system service, no registry entries, no admin install.

## Checking your setup

`workshop doctor` checks your Node version, reads `config.json` and reports any problem with it, says whether the agent is running on its port, whether start at login agrees with the launcher, and whether hosted mode has origins. `workshop doctor ado` checks the ADO connector. Neither changes anything (and `workshop doctor ado --import --write` refuses to run while the agent is running, so it cannot clash with it).

# Security and data flow

What Workshop stores, where it sends data (almost nowhere), and the checks that keep it on your computer. This is the doc the agent API points to for page security headers (see [agent-api.md](agent-api.md), Static files), and it is written to match what `tests/e2e.py` observes on the network.

## The short version

- Everything you create stays on your computer. There is no Workshop account, and no server holds your data.
- Where the code comes from: outside work mode, the hub and its apps load from Workshop's site (https://workshop.alexisdavidson.org, a Cloudflare Worker deployed from this repo's `main`; Docket from https://docket.alexisdavidson.org), and a paired site can use the agent. In work mode they load from a pinned copy on your disk and no site can use the agent. See Hosted mode and Work mode below.
- The agent binds `127.0.0.1` only and answers no one else on the network.
- The agent makes no outbound request of its own. Only a connector you turned on talks to the one system it is for (for example your Azure DevOps server), from your computer, using a token you keep in an environment variable or in this computer's own secret store (Keychain, Credential Manager). See Secrets.
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
| Settings | `~/.workshop/config.json` | No secrets. Holds the names of environment variables and stored secrets, never the values. A token pasted into a name field is moved into the secret store when Settings saves, and at start (agent 1.17.0). |
| The per-install token | `~/.workshop/token` | Readable by your user only (`0600`). Never shown in the UI or written to a log. |
| The agent token | `~/.workshop/agent-token` | Readable by your user only (`0600`). For Tandem's scripts to call read actions marked for agents (`/api/tools`), and nothing else. Never logged. See Tools for agents. |
| The list of saved secrets | `~/.workshop/secrets.json` | Names, which store, when saved and expiry dates. Never values: those are in this computer's secret store. See Secrets. |
| App data | Your data folder, `~/Workshop` by default (`dataDir` in settings): `<app>/...` | Your tasks, notes and so on. A folder you own: Workshop is a view over it, and deleting Workshop leaves it. Workshop never syncs or uploads it. |
| Trash and backups | `.trash/` and `.backups/` in your data folder | Files you deleted in Workshop, and copies kept before a format upgrade. Workshop never empties them. |
| App data from before the data folder | `~/.workshop/data/<app>/` | Copied into the data folder once, then left as a backup. Never deleted by Workshop. |
| A connector's private state | `~/.workshop/data/_connectors/<id>/` | Settings it saved and sync cursors. Stays on this computer. Never content you wrote. |
| A connector's working files | `<dataDir>/.scratch/<id>/` | Files handed to another program for one run (a hub request, a 1:1 packet). Removed 7 days after they last changed. |
| Logs | `~/.workshop/logs/` | Never contain the token, PATs or the contents of your data. |
| Browser data (browser and hosted modes) | that browser's IndexedDB and `localStorage` | The handle to the folder you picked (IndexedDB), or app data until you pick one (IndexedDB, kept and marked moved after you do), your theme, and in hosted mode the paired agent address and token (`localStorage`, key `workshop.agent`). |

Set `WORKSHOP_HOME` to keep the `~/.workshop` items somewhere else. The data folder is set separately (`dataDir`) and may not be inside the Workshop home.

Secrets (Azure DevOps PATs and the like) live in environment variables, never in `config.json`. A connector's config names the variable (for example `"patEnv": "ADO_PAT"`); the agent reads the value from the environment and never stores, logs or returns it.

- **Saving a PAT.** `workshop pat ADO_PAT` asks for the token without showing it and, on Windows, saves it as a user environment variable (as the Windows settings dialog does), passing it to PowerShell on stdin. It never appears on a command line, in shell history (`setx ADO_PAT "<token>"` leaves it in PowerShell's history file), in `config.json` or in a log. On macOS and Linux it only explains where to put the variable.
- **Tokens in the secret store instead.** A connector field marked `x-workshop-secret` names a secret in this computer's own store instead of a variable. See Secrets below. The Cloudflare and Google Play connectors use only this.
- **No restart for a new PAT on Windows.** When a connector asks for a variable, the agent looks it up in the user's saved variables (`reg query HKCU\Environment /v <name>`, cached for a few seconds) before its own environment. The agent's only other uses of `child_process` are reading a secret from this computer's store for a connector (`agent/lib/secrets.mjs`), saving or removing one from Settings (`agent/lib/secret-write.mjs`, Secrets below), and Settings' Update button (`agent/lib/terminal.mjs`): it opens a terminal window you can see (PowerShell on Windows, Terminal on macOS) running the fixed command `workshop update --restart`. It runs no other program, and `agent/test/source.test.mjs` checks all four.

## Secrets

Environment variables are easy but leaky: every program you start inherits them (Tandem's agents included), and on macOS and Linux they usually sit in plain text in a shell profile. So a connector can name a secret in this computer's own secret store instead (`x-workshop-secret`, [connector.md](connector.md), `ctx.secret`):

| Computer | Store | Saved by `workshop secret set <name>` | Read by the agent |
| --- | --- | --- | --- |
| macOS | the login Keychain, service `workshop`, account `<name>` | `security -i` with the add command on stdin, the value hex-encoded | `security find-generic-password -s workshop -a <name> -w` |
| Windows | Credential Manager, generic credential `workshop:<name>`, this computer only | `powershell.exe` with `CredWrite`, the value on stdin | `powershell.exe` with `CredRead`, the target in an environment variable |
| Linux | the Secret Service (GNOME Keyring, KWallet) | `secret-tool store`, the value on stdin | `secret-tool lookup service workshop account <name>` |

- **Saving is from Settings, or a terminal.** Settings, Manager, **Tokens & sign-ins** (agent 1.17.0) lists every token, key and password Workshop uses, with **Add**, **Replace** and **Remove**; the connector pages have the same **Add token** button beside each field. The value is typed or pasted into a dialog that sends it once to `POST /api/secrets` and is cleared. The agent saves it with `agent/lib/secret-write.mjs`: one fixed program per computer (`security -i` with the value hex-encoded on stdin, PowerShell CredWrite with the value on stdin, `secret-tool store` with the value on stdin), never through a shell, its output ignored, then reads it back to check it matches and records the name in `secrets.json`. Saving and removing are local only (Workshop on this computer, never a hosted page) and writes (the token header). The value is added to the log's redaction list and never returned, logged or written anywhere else. `workshop secret set <name> [--expires YYYY-MM-DD]` still works for people who prefer a terminal; `workshop secret list`, `check` and `remove` too.
- **Variables' tokens too.** A field marked `x-workshop-env` (Azure DevOps' `ADO_PAT`, GitHub's `GITHUB_PAT`) has **Add token** as well: it saves the token in the secret store as `env-<name>` (`env-ado-pat`), and connectors asking for that variable get it (`agent/lib/stored-env.mjs`, read ahead at start, after each change and once a minute). A token saved this way wins over the variable. Nothing has to go in a shell profile or `setx`.
- **Reading** is `agent/lib/secrets.mjs`: one fixed program per computer, the name as its own argument and never through a shell. A connector reads only names its own config holds in `x-workshop-secret` fields; the value is cached for a minute and added to the log's redaction list. Both files are checked by `agent/test/source.test.mjs`.
- **What changed in 1.17.0, and why.** Until then the agent only read the store, and saving was the terminal's job. That kept a page from ever writing a secret, but it meant pasting a token into Settings did nothing useful (and one pasted into a name field sat in `config.json`). Now a page can save or remove a secret, only from Workshop on this computer with the per-install token. It still cannot read one back: no route returns a value. The worst a hostile page with that token could do is replace or remove a token, which it could already break by changing the connector's settings.
- **Keys and passwords.** `workshop secret set play --from-file <key.json>` saves a Google service account key (Google Play) from the JSON file Google Cloud downloads: it keeps only the account's email and private key, in one line, and says to delete the file. It does not fit Windows Credential Manager, so on Windows it saves nothing and says so. `workshop secret set <name> --password` saves a password you type twice, like an Android keystore's; only `workshop play build`, run by you, reads it, to sign a bundle (connectors/play/README.md).
- **Expiry.** Give each secret its token's expiry date. Settings shows "expires in N days" from 14 days out, and `workshop secret list` marks it.
- **What it does not protect against.** Any program running as you can ask your Keychain or Credential Manager for a secret the same way Workshop does. The store keeps secrets off disk in plain text, out of backups and sync, and out of every program's environment; it does not stop code running as you that sets out to read it. Keep tokens narrow (one service, the fewest permissions, specific zones or repos), give them an end date, and where the service offers it, restrict them to your IP address. Tandem's guard rules ask before any shell command that reads a secret store or Workshop's tokens.

## Tools for agents

Tandem's agents never get a connector's token. When they need an outside system, they call Workshop: `/api/tools` (for scripts) and `/api/mcp` (as an MCP server, for opencode) run read actions a connector marks `agent: true` ([agent-api.md](agent-api.md), Tools for agents), with the agent token in `~/.workshop/agent-token`. That token opens nothing else: no data folder, no settings, no `confirm`, and no write that skips Approvals. A request from a web page (any `Origin`) is refused. The connector sees the call as from an agent and can say no (Cloudflare's **Let Tandem read and propose changes**).

The same goes for **MCP servers** you add (the MCP servers connector): their tokens live in the secret store, Workshop makes the calls, and Tandem sees each server's tools as `<server>__<tool>`. A server that only offers OAuth sign-in (connector 1.1.0) is signed in with **Sign in** in Settings, Tokens & sign-ins (connector 1.2.0, agent 1.17.0) or `workshop mcp login <id>` in a terminal. Settings opens the server's sign-in page in a new tab; it sends the browser back to `http://127.0.0.1:<port>/oauth/callback`, which accepts only a sign-in Settings started (a one-time state, 10 minutes). Workshop saves a random key in the secret store, and the tokens go in the connector's storage encrypted with that key (AES-256-GCM, `<home>/data/_connectors/mcp/oauth-<id>.json`, mode 0600). Neither the key nor the file alone gives the tokens. **Sign out** (or `workshop mcp logout <id>`) deletes both. Tools a server marks read-only run at once (turn **Run tools the server marks read-only without asking** off to be asked for every one); every other tool call is a change, below.

**Merge without a PR** (opencode connector 1.29.0, Settings, Factory) pushes a build's target branch (main) after your Publish click and the git confirm, never forced; it is off unless you turn it on, for your own repos. Chat's **suggested next prompt** sends the last exchange of a chat (your message and the answer, cut short) to the chat's own model through opencode after each answer; turn it off in Settings, opencode connector.

## Approvals

A change outside this computer that an agent wants (a write marked `agent: "ask"`, such as Cloudflare's change sets, Google Play's release sets or an MCP tool call) is never run on the agent's word. It becomes a request in **Settings, Manager, Approvals** (Needs you shows how many):

- **What you read is worked out from the request**, by the connector, each time you look (the steps of a Cloudflare change set, an MCP tool and its arguments), never from text the agent wrote. Approve sends back a digest of exactly those arguments; if anything edited the request after you read it, nothing runs.
- **Approve** runs it as yours, confirmed by that click, and records the result. **Reject** runs nothing (and tells the connector, so a Cloudflare set is marked rejected). The agent checks back (`workshop__approval_status`, or `GET /api/tools/approvals/<id>`) and gets the status, the result once approved, or your note.
- **Always allow.** When you approve, you can tick "Always allow" to add a rule for that connector, action and scope (the zones a Cloudflare set touches, or one MCP tool). A later request the rule covers runs at once, recorded as by "rule". Rules live in `config.json` (`approvals.rules`), which only Workshop on this computer writes, and are added or removed only from Workshop on this computer, never from a hosted page.
- Requests are files in `<data folder>/connections/approvals/`, never removed by Workshop.

## Activity

Every change made outside this computer through a connector, every call an agent, a rule or a routine made, and every approval decision is a line in `<data folder>/connections/activity/<YYYY-MM>.jsonl`: when, who (you, Tandem, a rule, a routine), which connector and action, whether it worked, how long it took, and the approval it came from. Never arguments or results. Settings, Manager, Activity shows the newest; All connections shows when each connection was last used.

## Routines

Routines (Settings, Routines; [config.md](config.md)) start a Tandem command or prompt on a schedule through the opencode connector, as a new chat, recorded in Activity as by "routine". A routine's agent works under the same rules as any agent: reads through Workshop, changes through Approvals.

## Outbound hosts

- The agent itself: none. It never makes an outbound request, and the only programs it runs are `reg query` on Windows to read a saved variable, the secret store's own reader when a connector asks for a secret, the store's own save and remove programs when you add or remove a token in Settings (Secrets, above), and a visible terminal for Settings' Update button (above). The update in that window is `workshop update`, the same as typing it. Turning an app on in Settings never downloads it: that is `workshop apps on <app>`, run by you, which clones the app's repo from GitHub ([apps.md](apps.md)). Its source is checked for this (`agent/test/source.test.mjs`).
- A connector you turned on: the servers in that connector's own config, and no others. The ADO connector reaches the Azure DevOps server URLs you set, over HTTPS, with your PAT. The Cloudflare connector reaches `https://api.cloudflare.com/client/v4` (its **API address**) with the token from your secret store, and is off in work mode. The Google Play connector reaches `https://oauth2.googleapis.com/token` with a request signed by the service account key from your secret store (the key never leaves the computer), `https://androidpublisher.googleapis.com` with the one-hour access token it gets back, and your app's own site (its **Site** setting, no token) to read `/.well-known/assetlinks.json`; it is off in work mode. `workshop play build`, run by you, runs Bubblewrap (through npx, which downloads it from the npm registry the first time) or your project's Gradle wrapper, which download what they need.
- The opencode connector (Dispatch), when on: it reaches only the opencode server on this computer, but opencode itself sends prompts and the contents of files its agents read to the AI provider it is set up with, and agents run git against your repos' remotes (clone, fetch, push). Set **Approved AI providers** so `workshop doctor` checks opencode can use no other provider (connectors/opencode/README.md, Approved AI providers). Agents read pull requests and work items written by other people; treat that text as untrusted input to an agent that can run commands in your workspace. Chat's Terminal (Chat 4.0.0) is a shell opencode runs in the workspace, as its own desktop app does; the connector only relays it over a WebSocket to that same local opencode, so the agent still runs no program. Opening a terminal and saving a file from Chat's Files are logged in Activity; keys typed in a terminal are not. None of these actions is open to agents. Files keeps to the workspace (links followed) and never touches `.git`.
- The browser: this site's own files only, plus the local agent on `127.0.0.1`. Fonts and libraries are served from the site (`shared/fonts/`, `shared/vendor/`), not a CDN. `tests/e2e.py` fails if any request goes anywhere else.

- The installer (only while it runs): GitHub for Workshop, Tandem and Docket (a release tag when you set one, otherwise the newest code on `main`), nodejs.org for a private Node when yours is older than 22.15, and, only for Dispatch, the npm registry for opencode (the newest version unless `OPENCODE_VERSION` is set) and GitHub releases for MinGit on Windows or PowerShell 7 on macOS and Linux (the newest release). Downloads are over HTTPS. Node, MinGit and PowerShell are checked against their published SHA-256 (nodejs.org's `SHASUMS256.txt`, GitHub's release file digest) and not used if they differ; when no hash is published the installer says so and carries on. npm checks opencode's package integrity itself. The Workshop, Tandem and Docket zips have no published hash, so at work prefer release tags and work mode (whose pinned copy records every file's SHA-256), or the by-hand install (docs/install.md, Work mode).

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
- **Nothing is removed by code.** Deleting a file moves it to `.trash/` in the data folder. Workshop never empties the trash, never removes backups, and never deletes the old `~/.workshop/data/` files on its own. Only you delete, from this computer: an old copy in Settings, Data, or **Start over** (`POST /api/reset`, `workshop reset`), which needs the apps picked, a typed phrase that names them, a 10-second wait checked by the agent, and a zip of everything that goes, written and read back before anything is deleted. Hosted pages and agents (`/api/tools`) cannot start it.
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
- **Updates are deliberate**: `workshop update` moves to the newest release tags (never back to an older version) and `workshop update --tag <tag>` to one you chose, and either rebuilds the copy. A tag that was moved on the remote after you fetched it is not taken (git refuses to replace it, and Workshop does not force it).

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

- **Update:** `workshop update` moves Workshop, Docket, Runway and Rapport to their newest release tags and, in work mode, rebuilds the pinned copy. When it finds Tandem's eng-agents clone (next to Workshop, else the folder opencode's copy was installed from, or `--eng-agents <folder>`), it also runs Tandem's own `update.ps1 -Tag <newest core-v tag> -Yes` (PowerShell, `-ExecutionPolicy Bypass` for that file only) if opencode's copy is behind; that copies agents and commands into `~/.config/opencode`. After installing it restarts opencode 2.x's background service (`opencode service stop`, then `start`) so the new agents load. `workshop apps on dispatch` in work mode clones Tandem next to Workshop and runs its `install.ps1` the same way. Neither runs inside the agent or a page: only in a terminal, either yours or the visible one Settings' **Update** button opens (`workshop update --restart`, which also restarts Workshop when it moved). By default it prints a short summary (what moved, what you need to do); `--verbose` shows each step's full output. `workshop update --check` lists the release tags and changes nothing. `workshop update --tag <tag>` moves a git checkout to that release (it refuses local changes and unknown tags) and, in work mode, rebuilds the pinned copy; `--docket-tag` does the same for the Docket checkout. Updates only ever move to release tags; there is no option to pull the newest code. `workshop update --help` lists every option. An install that is not a git checkout says to download a release, or to run the installer again with `WORKSHOP_TAG`. Check the version with `workshop version`. Open windows notice a new version and offer a reload once you ship it (the service worker's `CACHE`).
- **Uninstall:** `workshop uninstall` turns off start at login and removes the launcher. It leaves your data folder (`~/Workshop` by default) and `~/.workshop` in place; delete them yourself if you want them gone. There is nothing else to remove: no system service, no registry entries, no admin install.

## Checking your setup

`workshop doctor` checks your Node version, reads `config.json` and reports any problem with it, says whether the agent is running on its port, whether start at login agrees with the launcher, whether hosted mode has origins, whether work mode's pinned copy matches its `build.json`, and (when the opencode connector has approved providers) whether opencode can use any other AI provider. `workshop doctor ado` checks the ADO connector. Neither changes anything (and `workshop doctor ado --import --write` refuses to run while the agent is running, so it cannot clash with it).

## Where data can go

Nothing leaves the computer unless the person turned it on, and Settings, Data lists every way out with its state:

- **The data folder** stays on this computer. If the person puts it in a folder a sync tool uploads (OneDrive, Dropbox, iCloud Drive, Google Drive), that tool uploads it; Workshop says so and never uploads it itself. Installers keep it in `~/Workshop` unless told otherwise (`WORKSHOP_DATA_DIR`, or `WORKSHOP_ONEDRIVE=1` for the company OneDrive).
- **Connectors** (Azure DevOps, GitHub, opencode, Cloudflare, Google Play) are off until turned on, call only hosts from their config, and change outside systems only from a button with `confirm: true`. Agents can run only read actions marked for them (`/api/tools`), never a write.
- **AI**: with the opencode connector on, what the person sends in Chat and Loom goes to the AI provider opencode is set up with (its approved providers are listed).
- **Pages** can reach only their own site and `127.0.0.1` (CSP `connect-src`, checked by `shared/test/page-csp.test.mjs`), and the agent itself makes no outbound requests (`agent/test/source.test.mjs`).

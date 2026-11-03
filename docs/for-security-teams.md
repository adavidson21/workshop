# Workshop: a brief for your security team

For an engineer who wants to use Workshop on a work computer and needs to tell IT or security what it is. Hand them this page. Details and the checks behind each claim are in [security.md](security.md).

Workshop does not make any tool "approved" by itself. Your company's policy decides that. This page is meant to make the review short.

## What it is

A personal productivity hub (task priorities, review notes, a work-item view, optional coding agents) that runs as one Node.js process under the user's own account. Open source, MIT licensed: https://github.com/adavidson21/workshop.

## Recommended setup at work

| Setting | Recommended | Why |
| --- | --- | --- |
| Install method | By hand from a release tag (README.md, Work mode), not the one-line installer | No `irm \| iex` or `curl \| bash`, and a fixed, reviewable version |
| Work mode | On (`workshop install --work-mode`, then `workshop pin`) | The UI runs from a pinned copy on disk, checked file by file against SHA-256 hashes on every request. No website can use the agent. Code changes only when the user runs `workshop update --tag <tag>` |
| Dispatch (coding agents) | Off, unless your company approves a coding agent and an AI provider | It is the only part that sends work content to a third party (the AI provider) |
| Approved AI providers | Set to your approved provider if Dispatch is on | `workshop doctor` then fails if opencode can use any other provider |
| Start at login | Off (the default) | Nothing runs until the user starts it |
| Data folder | Default `~/Workshop`, outside folders your company syncs | Workshop never syncs or uploads it |

## What it installs and changes

- **No admin rights, no services, no drivers, no registry entries, no browser extension.** Everything is in the user's profile.
- **Files:** the code folder (where the user put it), `~/.workshop/` (settings, a random per-install token readable by the user only, logs, the pinned UI copy), and the data folder (`~/Workshop`).
- **Start at login, only if the user turns it on:** one launcher in the user's Startup folder (Windows), `~/Library/LaunchAgents` (macOS) or `~/.config/autostart` (Linux).
- **Uninstall:** `workshop uninstall` removes the launcher. Deleting the code folder, `~/.workshop` and the data folder removes everything.

## Network

- **Inbound:** none from the network. The agent listens on `127.0.0.1:4380` only, answers only `Host: 127.0.0.1` or `localhost` (blocks DNS rebinding), and requires the per-install token on every API call.
- **Outbound from the agent:** none of its own. Each connector the user turns on talks only to the server in its own settings: for example the company's Azure DevOps server, over HTTPS, with a personal access token read from an environment variable (never stored in Workshop's files, logs or UI).
- **Outbound from the browser page:** only its own origin (`127.0.0.1` in work mode) and the local agent, enforced by Content-Security-Policy. Fonts and libraries are bundled; no CDN, no analytics.
- **Telemetry:** none. No usage data, crash reports or update checks.
- **If Dispatch is on:** opencode sends prompts and the contents of files its agents read to the configured AI provider, and agents run git against your repositories' remotes.

## Data

- All data is plain JSON and Markdown files in the data folder. Nothing is encrypted by Workshop beyond what the disk provides; use the company's disk encryption.
- **Receipts** holds performance notes about the user, their direct reports and their manager. Treat that folder as HR-sensitive: keep it out of shared or synced locations, and follow your company's rules on where manager notes may live. The review form sections a company uses are typed in on the device and never committed to the repo.
- Nothing from the user's work computer goes into the Workshop repos.

## What endpoint security may notice

- `node.exe` (or `node`) listening on `127.0.0.1:4380`.
- Chrome asking to let a site reach a local address (Local Network Access), only outside work mode.
- The one-line installer: a script piped from the web into PowerShell or bash, downloads into `%LOCALAPPDATA%\Workshop` or `~/.local/share/workshop`, and (only for Dispatch) `npm install` of opencode and `powershell -ExecutionPolicy Bypass` to install Tandem. The by-hand install with Dispatch off avoids all of these.

## Known limits

- Outside work mode, the UI is whatever Workshop's site serves today, and a paired site can use the agent, including Dispatch actions. Work mode removes that.
- The installer checks Node, MinGit and PowerShell against their published SHA-256, but the Workshop, Tandem and Docket zips have no published hash. Release tags plus work mode (whose pinned copy records every file's SHA-256) are the integrity control for those.
- Dispatch agents read text written by other people (pull requests, work items). Like any coding agent, they can be steered by that text; keep Dispatch off where that risk is not accepted.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).

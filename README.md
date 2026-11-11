# Workshop

One page for an engineering manager's whole day: what to work on next, new requests, roadmaps, 1:1s, notes and your coding agents, side by side in one window with one look.

**Your data stays on your device.** There are no accounts and no Workshop server. Everything is saved in your browser or in plain files on your computer.

## What's inside

| App | What it's for | Needs |
| --- | --- | --- |
| **Needs you** | A panel from the top bar on every app: what waits on you across apps, what's coming up, Weekly status and the **Get started** checklist | Nothing |
| **Docket** | Decide what to work on next; plan your day | Nothing (Azure DevOps adds your work items and PRs) |
| **Slate** | Take a request from idea to delegated or built | Nothing (Azure DevOps or Dispatch make it more useful) |
| **Runway** | Team and project roadmaps | Nothing (Azure DevOps can import Epics and Features) |
| **Rapport** | 1:1 prep, notes, goals and "receipts" for reviews | Nothing |
| **Folio** | Your notebook of Markdown files | Nothing |
| **Dispatch** | Run Tandem coding agents on your work items | opencode and an AI provider |
| **Settings** | People, teams, Azure DevOps, repos, apps on or off | Nothing |

Every app can be turned on or off, so you only see what you use. More on each app: [docs/guide.md](docs/guide.md).

## Get started

### Step 1: Pick your setup

| | Try it | Personal computer | Work computer |
| --- | --- | --- | --- |
| **Best for** | A quick look | Your own laptop | A company laptop |
| **Install** | Nothing | One command | One command |
| **Admin rights** | No | No | No |
| **Where data lives** | Your browser | Files on your computer | Your company OneDrive |
| **Azure DevOps sync** | No | Yes | Yes |
| **Dispatch (AI agents)** | No | Included | Off unless you add it |

Not sure? Use **Personal** at home and **Work** on a company laptop. You can start with **Try it** and install later.

#### Try it (no install)

Open https://workshop.alexisdavidson.org in Chrome or Edge. That's it. Your data is saved in this browser, so export it (Settings, Data & backups) before clearing browser data.

#### Personal computer

1. **Run the installer** as yourself (not as admin):
   - **Windows**, in PowerShell:
     ```
     irm https://workshop.alexisdavidson.org/install.ps1 | iex
     ```
   - **Mac or Linux**, in Terminal:
     ```
     curl -fsSL https://workshop.alexisdavidson.org/install.sh | bash
     ```
   It installs anything missing (Node, opencode, git), Workshop and Tandem, then starts Workshop and opens it once to sign your browser in. It takes a few minutes.
2. **Connect an AI provider** (only for Dispatch). On Windows the installer asks. On a Mac or Linux, open a new Terminal and run `opencode auth login`.
3. **Open https://workshop.alexisdavidson.org** in the same browser and click **Connect** on the left rail.

Don't want Dispatch? Run `$env:WORKSHOP_DISPATCH='0'` (PowerShell) or `export WORKSHOP_DISPATCH=0` (Terminal) before the installer.

#### Work computer

Work mode runs Workshop from a copy on your computer that changes only when you update it. No website can reach it, and your data goes in your company OneDrive so it's backed up.

> **Before you start:** if you're unsure your company allows it, share [docs/for-security-teams.md](docs/for-security-teams.md) with your security team. It explains what Workshop stores and where it sends data.

1. **Run the installer** as yourself (not as admin):
   - **Windows**, in PowerShell:
     ```
     irm https://workshop.alexisdavidson.org/install-work.ps1 | iex
     ```
   - **Mac**, in Terminal:
     ```
     curl -fsSL https://workshop.alexisdavidson.org/install-work.sh | bash
     ```
   It needs no admin rights and leaves Dispatch out. Workshop opens when it finishes.
2. **Open it any time** from the Start menu: **Workshop** (starts it if needed and opens it). **Restart Workshop** and **Stop Workshop** are next to it. On a Mac, run `workshop up`.

If your company blocks piping a script into PowerShell, use the by-hand steps in [docs/install.md, Work mode](docs/install.md#work-mode). To add Dispatch at work (only if your company allows a coding agent), see [Dispatch in work mode](docs/install.md#work-mode).

### Step 2: Follow Get started

The first time, the **Needs you** panel opens with a **Get started** checklist (it opens from the top bar any time after). Each step ticks itself off when it's done, tells you exactly what to do, and can be skipped:

1. **Connect Workshop:** pick Work computer or Personal computer.
2. **Add yourself** in Settings, People.
3. **Back up your data:** company OneDrive at work, or any folder your computer backs up.
4. **Connect Azure DevOps** (optional): create a personal access token with **Work Items (Read & write)** and **Code (Read)**, then run `workshop pat` to save it safely.
5. **Pick your apps:** turn off what you won't use.
6. **Add your team** and its area paths (skipped without Azure DevOps).
7. **Add your first task** in Docket and **log your first receipt** in Rapport.

When the checklist is done, you're set up. **Hide** puts it away; **Get started** in the panel's More menu brings it back.

## Your day in Workshop

- **Morning:** Workshop opens on **Docket's Today**. **Needs you** in the top bar (its count is on the button) lists everything waiting on you in the other apps.
- **Any time:** press `Ctrl+.` (`Cmd+.` on a Mac) to capture from anywhere: `t` task, `w` waiting on someone, `r` receipt, `n` note, `p` roadmap idea, `?` ask Tandem.
- **New requests:** **Slate**.
- **Building:** **Dispatch**.
- **1:1s:** **Rapport** preps you with what changed since last time.
- **End of day:** **Wrap up** on Docket's Today. On Fridays, **Weekly status** in Needs you drafts your update.

Shortcuts: `Alt+1`, `Alt+2` and so on switch apps. `Ctrl+K` (`Cmd+K`) opens the command palette.

**Want it in its own window?** In Chrome or Edge, click **Install** on the rail. Workshop then opens like a desktop app, with a taskbar or dock icon, and works offline.

## Everyday commands

Run these in a terminal. Start with `workshop doctor` whenever something seems off.

| Command | What it does |
| --- | --- |
| `workshop up` | Start Workshop if needed and open it |
| `workshop restart` | Restart Workshop (`--opencode` also restarts opencode) |
| `workshop stop` | Stop Workshop |
| `workshop doctor` | Check everything and say what to fix |
| `workshop pat` | Save or renew your Azure DevOps token |
| `workshop apps` | Turn apps on or off (also in Settings, Apps) |
| `workshop data-folder` | Show where your data is (`--onedrive` moves it there) |
| `workshop update` | Work mode: update everything to the newest release |

**Updating a personal install:** run the install command again. It updates everything and keeps your settings.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Something isn't working | Run `workshop doctor` and follow what it says |
| Dispatch says "Agent not found" | `workshop restart --opencode` |
| `workshop` isn't recognized | Open a new terminal window, or use `node workshop/workshop.mjs` |
| The installer is blocked at work | Use the [by-hand steps](docs/install.md#work-mode) |
| opencode or Tandem failed to install | Workshop still works without them; run the installer again later |
| No **Install** button in the browser | Your company's browser policy may block web app installs |
| No **Connect** button in work mode | Expected: work mode doesn't need it |

## Privacy and security

Workshop talks only to its own site, `127.0.0.1` on your computer, and the systems you set up in Settings (like Azure DevOps). The one exception is Dispatch, whose coding agents send work to the AI provider you connect. Start at login is off until you turn it on, and nothing needs admin rights.

- What Workshop stores and sends: [docs/security.md](docs/security.md)
- For your security team: [docs/for-security-teams.md](docs/for-security-teams.md)
- Testing with your team at work: [docs/team-testing.md](docs/team-testing.md)

## More docs

- [Using Workshop](docs/guide.md): every app in detail
- [Installing Workshop](docs/install.md): every install option, setting and command
- [Run modes](docs/run-modes.md): browser, personal and work mode
- [Developing Workshop](docs/development.md): code layout, adding an app, tests, shipping
- [Contracts](docs/README.md): the interfaces between Workshop's parts

## License

[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0), see `LICENSE`. Free to use, change and share, including at work; not for building a product that competes with it. Versions up to November 5, 2026 were MIT and stay MIT. Bundled fonts and libraries keep their own licenses: `shared/fonts/OFL-*.txt` and `shared/vendor/LICENSE-SheetJS.txt`.

# Workshop

An engineering manager's hub: one page with a rail of apps, sharing one theme.

- **Prioritizer** decides what to work on next, and has team-wide ADO **Reports** for capacity conversations. User guide: [prioritizer/README.md](prioritizer/README.md).
- **Dashboard** shows your [eng-agents](https://github.com/adavidson21/eng-agents) live dashboard, which runs on your own computer.

Switch apps from the rail, or with `Alt+1` and `Alt+2`. Each app keeps its state while you're in another one. Prioritizer is the plain address; the Dashboard is `#/dashboard`, and `#/dashboard/<work item id>` opens it at an item.

Everything stays on your device. There are no accounts and no server: Prioritizer saves in your browser, and the Dashboard talks to `127.0.0.1` only.

## eng-agents dashboard

The Dashboard page needs the live dashboard running on this computer, and allowed to answer this site.

**Once, on the work PC:**

1. In `~/.config/eng-agents/config.json` (`%USERPROFILE%\.config\eng-agents\config.json` on Windows), add:
   ```json
   "dashboard": { "shellOrigins": ["https://adavidson21.github.io"] }
   ```
2. Run `/dashboard` in opencode in your workspace. If it was already running, close its minimized window first so it reads the new setting.
3. Open **Dashboard** in the hub and click Connect. If the browser asks to allow access to apps on this device, choose Allow.

**Every day, including after a restart:** run `/dashboard` in opencode, then open the hub. Once connected, the hub checks every 30 seconds and reconnects on its own. Prioritizer shows each ADO task's eng-agents stage and can start a work item. **Connection** on the Dashboard page has Disconnect.

The hub uses the dashboard's shell API (`/api/shell/*`) and a few frame messages. The contract is documented in eng-agents: [docs/shell-api.md](https://github.com/adavidson21/eng-agents/blob/main/docs/shell-api.md).

## Install it as a desktop app

In Chrome or Edge, open Workshop and click **Install** on the rail (or the install icon in the address bar). Like Google Drive's desktop app, it then opens in its own window with a dock or taskbar icon, works offline, and opening it again brings back the window you already have. Right-click the icon for **Prioritizer** and **Dashboard** shortcuts.

It installs per user from the browser, with no admin rights or executable. If Install never appears on a work laptop, your company's browser policy may block web app installs. On a phone, use "Add to Home Screen".

The install dialog shows `screenshots/wide.png` and `screenshots/narrow.png` (sample data). Regenerate them when the look changes a lot.

## Layout

```
index.html              the hub page: rail + one pane per app
shell/                  shell.js (rail, routing, theme menu, toast), dashboard.js (Dashboard page), shell.css
shared/                 used by the hub and every app
  themes.css            the themes: styling source of truth, also for the eng-agents dashboard
  theme.js              applies and remembers the theme across pages
  ui.css                buttons, menus, toast, tooltip
  eng-client.js         eng-agents shell API client and connection settings
  sw-register.js        registers sw.js
  fonts/                self-hosted Inter and JetBrains Mono (OFL), fonts.css
  vendor/               third-party code served from this site (SheetJS); see vendor/README.md
prioritizer/            the Prioritizer app (also runs on its own at /prioritizer/)
  ado-helper/           the local ADO helper (Python)
sw.js                   offline cache for the whole site
tests/                  checks (see below)
```

### Adding an app

1. Build it as a page in its own folder (like `prioritizer/`) or as a script that renders into a pane (like `shell/dashboard.js`). Load `shared/theme.js`, `shared/fonts/fonts.css`, `shared/themes.css` and `shared/ui.css` so it matches, and copy the Content-Security-Policy meta tag from `index.html`.
2. Add an entry to `APPS` in `shell/shell.js` (id, label, icon, mount, show). The rail, routing and `Alt+<n>` come with it.
3. Add its files to `SHELL` in `sw.js`.

An app in a frame can ask the hub to switch apps with `parent.postMessage({type: 'em-open', app: 'dashboard', focus: id}, location.origin)`.

### No third-party requests

Pages load files from this site only, plus the local helpers on `http://127.0.0.1`. Fonts are in `shared/fonts/` and libraries in `shared/vendor/`; nothing comes from a CDN. A Content-Security-Policy meta tag on each page enforces this, and `tests/e2e.py` fails if any request goes anywhere else.

### Themes

Edit `shared/themes.css` only, then update `THEMES` and `SWATCH` in `shared/theme.js` (`node tests/check-themes.mjs` fails until they match). In eng-agents, run `node core/scripts/dashboard/sync-themes.mjs` to copy the change into the dashboard.

## Running it locally

No build step, but it needs a web server (the pages load several files):

```
python -m http.server 8000
```

Then open `http://localhost:8000/`. For the Dashboard page, add `"http://localhost:8000"` to `shellOrigins` too.

## Checks

```
node tests/check-themes.mjs      theme.js matches themes.css
node tests/check-offline.mjs     every file the pages load is in sw.js
python tests/e2e.py              the hub in headless Chromium against a mock dashboard
```

`e2e.py` needs `pip install playwright` and `python -m playwright install chromium`. All three run on every push (`.github/workflows/checks.yml`).

## Shipping

GitHub Pages serves the repo root. When you ship a change, bump `CACHE` in `sw.js` so open windows offer a "New version" reload.

Workshop lives at https://adavidson21.github.io/workshop/ (Prioritizer on its own: `/workshop/prioritizer/`). Same github.io site as before, so tasks saved in the browser carry over. If the site moves to another host, update `shellOrigins` (above) and `allowed_origins` in `prioritizer/ado-helper/ado_helper.py` (or your `ado-helper.json`); browser storage does not move between hosts, so export from the old one and import on the new one.

## License

MIT, see `LICENSE`. Bundled fonts and libraries keep their own licenses: `shared/fonts/OFL-*.txt` and `shared/vendor/LICENSE-SheetJS.txt`.

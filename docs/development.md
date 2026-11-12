# Developing Workshop

How the code is laid out, how to add an app, and how to test and ship. For using Workshop, see the [README](../README.md).

## Addresses

Any app opens in its own window with Pop out (`?solo=<app id>`). An app's start page opened on its own goes there too. Dispatch has no site of its own anymore: its old address, https://dispatch.alexisdavidson.org, redirects to Dispatch in a pop-out window like the other retired app domains ([site.md](site.md)). Until it can reach Workshop on your computer, Dispatch shows a two-step setup guide: paste one install command (see One-line install below), then connect. Once connected, the opencode connector's settings (workspace folder and so on) are under opencode settings in Dispatch's menu.

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
  save-file.js          downloads a file the person keeps
  fonts/                self-hosted Schibsted Grotesk, Atkinson Hyperlegible Next and DM Mono (OFL), fonts.css
  vendor/               third-party code served from this site (SheetJS); see vendor/README.md
  screenshots/          images for the install dialog
  test/                 SDK tests
apps/                   one folder per app, each with an app.json (docs/app-manifest.md)
  registry.json         the app list for static sites (node shell/registry.mjs writes it)
  prioritizer/          Docket
  runway/               Runway
  receipts/             Rapport
  notes/                Folio
  slate/                Slate
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

1. Make `apps/<id>/` with an `app.json` ([app-manifest.md](app-manifest.md)), an `icon.svg` (20 by 20, stroke, `currentColor`) and its page. Load `shared/theme.js`, `shared/fonts/fonts.css`, `shared/themes.css` and `shared/ui.css` so it matches, and copy the Content-Security-Policy meta tag from `index.html`. List the app's other files in `app.json` `files` so it works offline (`node tests/check-offline.mjs` says what is missing).
2. Talk to the shell, data and connectors through the SDK only ([sdk.md](sdk.md)): `import { connect } from '../../shared/workshop-sdk.js'; const ws = await connect({app: '<id>'});`. Then `ws.open`, `ws.toast`, `ws.badge`, `ws.commands.register`, `ws.data.get` and `put`, `ws.connectors.call`, and events with `ws.on`. No `postMessage` and no `fetch` to `/api/`.
3. Run `node shell/registry.mjs` so static sites list it too. The agent finds it on its own.

The rail, routes, `Alt+<n>`, shortcuts and the palette come from `app.json`. See `apps/settings/` for a small app.

### Boundaries

Everything is in this repo, so the boundaries between the apps, the shell, the shared files, the agent and the connectors are written down in [shared.md](shared.md) and checked by CI: `node tests/check-boundaries.mjs` (who may use whose files), `node tests/check-extract.mjs` (each app's tests pass with only its own folder and the shared folders), `python tests/switches-e2e.py` (Workshop works with any one app off), and the SDK refuses data reads outside the contracts. Read shared.md before adding a shared file or reading another app's data.

### No third-party requests

Pages load files from this site only, plus the local helpers on `http://127.0.0.1`. Fonts are in `shared/fonts/` and libraries in `shared/vendor/`; nothing comes from a CDN. A Content-Security-Policy meta tag on each page enforces this, and `tests/e2e.py` fails if any request goes anywhere else.

### Themes

Edit `shared/themes.css` only, then update `THEMES` and `SWATCH` in `shared/theme.js` (`node tests/check-themes.mjs` fails until they match). Every app, Dispatch included, loads `themes.css` directly.

## Running it locally

Serve the site with any static web server, for example `python -m http.server 8000`, then open `http://localhost:8000/` (browser mode). Every app is in `apps/`.

To use the agent with it:

```
node agent/start.mjs
```

Open the address it prints once (Workshop on this computer, which signs this browser in). Add `http://localhost:8000` under Allowed sites there, then click **Connect** on the local site.

## Checks

```
node tests/check-themes.mjs              theme.js matches themes.css
node tests/check-offline.mjs             every file the pages and app modules load is cached by sw.js
node tests/check-boundaries.mjs          who may use whose files (docs/shared.md)
node tests/check-extract.mjs             each app's tests pass with only its folder and the shared folders
node shell/registry.mjs --check          apps/registry.json lists every app folder
node --test "shared/test/*.test.mjs"     the SDK, against the docs' cases and the mock agent
node --test "apps/*/test/*.test.mjs"     apps' own tests
node --test "worker/test/*.test.mjs"     the Worker: Dispatch's domain, installers, retired app domains
node tests/check-vendor.mjs              vendored libraries match their pinned SHA256SUMS (--write after updating one)
python tests/e2e.py                      Workshop in headless Chromium: browser, local and hosted modes, Docket storage
python tests/workmode-e2e.py             work mode in headless Chromium: the pinned copy with every app, no hosted access
python tests/switches-e2e.py             Workshop with each app switched off
python apps/<id>/test/e2e.py             an app on its own page (Docket, Runway, Folio)
```

`e2e.py` needs `pip install playwright` and `python -m playwright install chromium`. These, the contract suite and the agent and connector tests run on every push (`.github/workflows/checks.yml`).

## Shipping

A Cloudflare Worker serves the repo root (`wrangler.jsonc`; Cloudflare's Git integration runs `npx wrangler deploy` on every push to `main`). Files that are not part of the site are listed in `.assetsignore`. When you ship a change, bump `VERSION` in `sw.js` so open windows offer a "New version" reload, and run `node shell/registry.mjs` if an app's `app.json` changed.

Workshop lives at https://workshop.alexisdavidson.org, every app included. If the site moves to another host, update `shared/site.js` (every site address lives there; `tests/check-site.mjs` finds any other); browser storage does not move between hosts, so export from the old one and import on the new one.

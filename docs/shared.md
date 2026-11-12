# Shared files and boundaries

Workshop is one repo: the agent, the connectors, the shell, the shared files and every app. One repo makes it easy to reach into another part's code, so the boundaries between the parts are written here and checked by CI. A pull request that crosses one fails instead of relying on review.

## Boundaries

| # | Boundary | Rule | Checked by |
| --- | --- | --- | --- |
| B1 | App to app (code) | An app (`apps/<id>/`) uses only its own files and the public shared files below. Never another app's files. | `tests/check-boundaries.mjs` |
| B2 | App to platform (code) | Apps and `shared/` never use `shell/`, `agent/`, `connectors/` or `worker/`; they reach them through the SDK. The shell frames apps and never imports their code. | `tests/check-boundaries.mjs` |
| B3 | Runtime to browser (code) | `agent/` and each `connectors/<id>/` use only their own files and `shared/site.js`. | `tests/check-boundaries.mjs`, `tests/check-site.mjs` |
| B4 | Shared's public surface | Apps use only the files listed under Public. Every file in `shared/` is listed here, as Public or Internal, so adding one is a choice. | `tests/check-boundaries.mjs` |
| B5 | App to app (data) | An app writes only its own data. It reads another app's data only through the contracts: any app's `summary` ([summaries.md](summaries.md)) and `handoffs` ([handoffs.md](handoffs.md)), and Settings' `people`, `teams`, `products`, `focus` and `app-settings` ([people.md](people.md), [teams.md](teams.md), [products.md](products.md), [focus.md](focus.md), [app-settings.md](app-settings.md)). Files follow `privateFiles` ([app-manifest.md](app-manifest.md)). | The SDK refuses other reads with `forbidden` ([sdk.md](sdk.md), Data). Tests: `shared/test/sdk-contract-reads.test.mjs`. |
| B6 | Contracts change on purpose | Contract collections have versioned schemas in `docs/schemas/`. A schema change comes with its docs change. | `tests/check-contracts.mjs` |
| B7 | Every app can be switched off | Workshop works with any one app switched off in Settings: no page errors, the other apps still open. | `tests/switches-e2e.py` |
| B8 | Every app can be pulled out | An app's unit tests pass with only `apps/<id>/`, `shared/`, `icons/`, `tests/lib/`, `docs/` and `manifest.webmanifest` present. | `tests/check-extract.mjs` |
| B9 | Workshop to eng-agents | They meet only at the `.work` format ([work-format.md](work-format.md)) and the Tandem command list. | Shared `.work` fixtures in `tests/fixtures/work/` |

Tests (any `test/` folder, and `tests/`) may also use `tests/lib/` and `docs/`. They still never use another app's files. Settings' tests read each connector's `configSchema` as a fixture, because Settings builds its forms from them.

Habits that go with the rules:

- One app per pull request where possible. A pull request that changes more than one `apps/<id>/` says why; the usual reason is a contract change, which also changes `docs/`.
- Each app keeps its own `README.md`, `app.json` version and tests, as if it were its own repo.
- When two apps need the same code, it goes into `shared/` with a line below, or one app offers it through a contract. Never an import from one app into another.

## Public

Apps may use these. Each module's header comment says what it exports and how to use it.

| File | What it is |
| --- | --- |
| `shared/workshop-sdk.js` | The SDK: everything that leaves an app goes through it ([sdk.md](sdk.md)). |
| `shared/theme.js` | Applies and remembers the theme. Load it in `<head>`. |
| `shared/themes.css` | The themes: colors and type for the shell and every app. |
| `shared/ui.css` | Buttons, menus, toast, tooltip and other shared pieces. |
| `shared/fonts/` | Self-hosted fonts and `fonts.css`. |
| `shared/brand/` | The brand theme (opt-in) and its fonts. |
| `shared/summary.js` | Writing and reading summaries ([summaries.md](summaries.md)). |
| `shared/handoffs.js` | Who sends an app handoff offers ([handoffs.md](handoffs.md)). |
| `shared/people.js` | The people directory and groups ([people.md](people.md)). |
| `shared/teams.js` | Team area paths ([teams.md](teams.md)). |
| `shared/products.js` | Products ([products.md](products.md)). |
| `shared/focus.js` | Focus hours and lunch ([focus.md](focus.md)). |
| `shared/outside.js` | The look for actions that change something outside this computer. |
| `shared/capture.js` | Quick capture rules ([hub.md](hub.md)). |
| `shared/capture-box.js` | The capture box (Home's quick capture and the Dispatch hub). |
| `shared/capture.css` | The capture box's styles. |
| `shared/save-file.js` | Give the person a file to keep (a download). |
| `shared/site.js` | Where Workshop lives on the web ([site.md](site.md)). |
| `shared/vendor/` | Third-party code served from this site (SheetJS); see `vendor/README.md`. |
| `shared/sw-register.js` | Registers a site's service worker. Only for apps that still have a site of their own; goes with them. |
| `shared/standalone-bar.js` | The top bar for an app opened on its own page. Goes when apps no longer have sites of their own. |
| `shared/pair.js` | Pairing a site with the agent. The shell uses it; apps with a site of their own too, until those sites go. |
| `shared/app-sw.js` | The service worker for apps with a site of their own. Goes with those sites. |

## Internal

The shell and the SDK use these. Apps do not.

| File | What it is |
| --- | --- |
| `shared/app-settings.js` | App settings rules; apps use `ws.appSettings` ([app-settings.md](app-settings.md)). |
| `shared/device-fs.js` | Storage for Docket's Android app. Goes with it. |
| `shared/screenshots/` | Images for the install dialog. |

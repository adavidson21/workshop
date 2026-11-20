# Shared files and boundaries

Workshop is one repo: the agent, the connectors, the shell, the shared files and every app. One repo makes it easy to reach into another part's code, so the boundaries between the parts are written here and checked by CI. A pull request that crosses one fails instead of relying on review.

## Boundaries

| # | Boundary | Rule | Checked by |
| --- | --- | --- | --- |
| B1 | App to app (code) | An app (`apps/<id>/`) uses only its own files and the public shared files below. Never another app's files. | `tests/check-boundaries.mjs` |
| B2 | App to platform (code) | Apps and `shared/` never use `shell/`, `agent/`, `connectors/` or `worker/`; they reach them through the SDK. The shell frames apps and never imports their code. | `tests/check-boundaries.mjs` |
| B3 | Runtime to browser (code) | `agent/` and each `connectors/<id>/` use only their own files, `shared/site.js` and `shared/app-folders.js` (plain data). | `tests/check-boundaries.mjs`, `tests/check-site.mjs` |
| B4 | Shared's public surface | Apps use only the files listed under Public. Every file in `shared/` is listed here, as Public or Internal, so adding one is a choice. | `tests/check-boundaries.mjs` |
| B5 | App to app (data) | An app writes only its own data. It reads another app's data only through the contracts: any app's `summary` ([summaries.md](summaries.md)) and `handoffs` ([handoffs.md](handoffs.md)), and Settings' `people`, `teams`, `products`, `glossary`, `focus`, `app-settings` and `writing` ([people.md](people.md), [teams.md](teams.md), [products.md](products.md), [glossary.md](glossary.md), [focus.md](focus.md), [app-settings.md](app-settings.md), [writing.md](writing.md)). One pair read: Settings reads Chat's `writing-feedback` (and no other app does), to learn from your answers in Rewrite a draft. Files follow `privateFiles` ([app-manifest.md](app-manifest.md)). One exception, for a retired app: Rapport (`receipts`) may read the old 1:1s app's (`oneonones`) `people` and `settings`, which it copies in on first open. | The SDK refuses other reads with `forbidden` ([sdk.md](sdk.md), Data). Tests: `shared/test/sdk-contract-reads.test.mjs`. |
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
| `shared/themes.css` | The themes: Workshop's names for the brand tokens, app colors (`data-app-color`) and layout sizes, for the shell and every app. |
| `shared/brand/` | A copy of the brand library (tools.alexisdavidson.org/brand/v2): `tokens.css` (colors, fonts, scales, jewel accents, imported by `themes.css`), its fonts, and `AGENTS.md`, `tokens.json` and `components.json` for agents. Update it with `node ../personal-tools/brand/scripts/sync.mjs shared/brand`; never edit it here. |
| `shared/ui.css` | Buttons, menus, toast, tooltip and other shared pieces. |
| `shared/fonts/` | `fonts.css`, kept so existing links work. The fonts themselves are in `shared/brand/fonts/`. |
| `shared/summary.js` | Writing and reading summaries ([summaries.md](summaries.md)). |
| `shared/handoffs.js` | Who sends an app handoff offers ([handoffs.md](handoffs.md)). |
| `shared/people.js` | The people directory and groups ([people.md](people.md)). |
| `shared/teams.js` | Team area paths ([teams.md](teams.md)). |
| `shared/products.js` | Products ([products.md](products.md)), and the product filter (`belongsTo`, `picked`, `filterOptions`). |
| `shared/glossary.js` | The glossary ([glossary.md](glossary.md)). |
| `shared/knowledge.js` | The knowledge base, the pure parts: the generated repo map, reading a hand-written one, and the checks ([knowledge.md](knowledge.md)). |
| `shared/voice.js` | Writing voice, the pure parts: prompts, the check, samples, rules and the feedback Chat sends ([writing.md](writing.md)). |
| `shared/focus.js` | Focus hours and lunch ([focus.md](focus.md)). |
| `shared/outside.js` | The look for actions that change something outside this computer. |
| `shared/ado.js` | Azure DevOps on or off: `watchAdo`, `adoIsOn`, `noAdo`, and the `data-ado-only` / `data-no-ado` marks. |
| `shared/capture.js` | Quick capture rules ([hub.md](hub.md)). |
| `shared/capture-box.js` | The capture box (Home's quick capture and the Dispatch hub). |
| `shared/capture.css` | The capture box's styles. |
| `shared/save-file.js` | Give the person a file to keep (a download). |
| `shared/site.js` | Where Workshop lives on the web ([site.md](site.md)). |
| `shared/app-folders.js` | The folder each app keeps its data in, inside the data folder ([data-format.md](data-format.md), App folders). |
| `shared/monaco.js` | The Monaco code editor (`loadMonaco`, `applyMonacoTheme`, `languageOf`), for Loom's code review and Chat's Files. |
| `shared/vendor/` | Third-party code served from this site (SheetJS, and Monaco for `shared/monaco.js`); see `vendor/README.md`. |
| `shared/sw-register.js` | Registers a site's service worker. Only for apps that still have a site of their own; goes with them. |
| `shared/standalone-bar.js` | The top bar for an app opened on its own page. Goes when apps no longer have sites of their own. |
| `shared/pair.js` | Pairing a site with the agent. The shell uses it; apps with a site of their own too, until those sites go. |
| `shared/app-sw.js` | The service worker for apps with a site of their own. Goes with those sites. |

## With no Azure DevOps

Azure DevOps is optional, and while it is off (switched off in Settings, not installed, or browser mode) Workshop names it nowhere: no ADO buttons, chips, hints, steps or sentences in any app. The one place it stays is its row on Settings, All connections, whose Settings button opens its switch, so it can be turned back on. Everything comes back as soon as it is on, without a reload.

- `shared/ado.js` decides: `watchAdo(ws, onChange)` once at start (it follows the connector's status after that), then `adoIsOn()` where a string or control depends on it. `noAdo(text)` drops the sentences that name ADO from mixed text, such as an app's description.
- In markup, `data-ado-only` hides while ADO is off and `data-no-ado` while it is on (`shared/ui.css`).
- Items that came from ADO keep their data; while it is off they read as local ones (Loom's board, Docket's rows, Runway's roadmaps). GitHub items are unchanged.
- Exported files keep their columns (Docket's Excel export, Settings' people template), so a file still imports the same either way.
- `tests/no-ado-e2e.py` opens every app and tab with ADO off and with it not installed, and in browser mode, and fails on any visible mention. It also checks the way back on from All connections.

## Internal

The shell and the SDK use these. Apps do not.

| File | What it is |
| --- | --- |
| `shared/app-settings.js` | App settings rules; apps use `ws.appSettings` ([app-settings.md](app-settings.md)). |
| `shared/screenshots/` | Images for the install dialog. |

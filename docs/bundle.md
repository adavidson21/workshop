# Platform bundle

The shared files every Workshop app runs on: the SDK, pairing, themes, fonts, icons, the site config, and the schemas and validator their tests check against. Apps in their own repos (Docket, Runway, Rapport) keep exact copies so they run on their own sites; the bundle pins which copies.

Version: `bundle: 1` (the format). Each release of the files has its own `version`.

## bundle.json

`bundle.json` at the root of the workshop repo, written by `node scripts/bundle.mjs` and checked in CI (`--check` fails when it is stale).

```json
{
  "bundle": 1,
  "version": "1.0.0",
  "files": {
    "shared/workshop-sdk.js": "9f2c...",
    "shared/site.js": "41ab..."
  }
}
```

| Field | Meaning |
| --- | --- |
| `bundle` | `1`, the format. |
| `version` | `major.minor.patch`. `scripts/bundle.mjs` raises the patch when any file changed; raise the minor or major by hand for a new file or a breaking change. |
| `files` | Every file in the bundle, by its path in workshop, with its SHA-256 (hex). |

What is in it: `shared/` (except `shared/test/` and `shared/screenshots/`), `icons/`, `docs/schemas/`, `tests/lib/schema.mjs` and `scripts/sync-workshop.mjs` (the sync script itself, so `--update` keeps it current; add it to `files` once).

Shared helpers apps use instead of their own copies:

- `shared/app-sw.js`: the service worker. An app's `sw.js` is two lines: `importScripts('./shared/app-sw.js'); appServiceWorker({ name: '<app>', version: '<x.y.z>' });`. It precaches the app's page, manifest, `app.json`, `icon.svg` and the files listed in `app.json`, plus any `core` paths passed in.
- `shared/handoffs.js`: `sendersFrom(apps, self, fallback)` and `useSenders(senders, apps, self)`, the apps that may send this app handoffs.

## In an app's repo

The app's `workshop-files.json` maps its copy to the path in workshop and pins a bundle:

```json
{
  "repo": "adavidson21/workshop",
  "commit": "856591a...",
  "bundle": "1.0.0",
  "files": {"shared/workshop-sdk.js": "shared/workshop-sdk.js"},
  "sha256": {"shared/workshop-sdk.js": "9f2c..."}
}
```

- `node scripts/sync-workshop.mjs --update [ref]` copies the files at `ref` (default `main`), records the commit, the bundle `version` and each file's hash from that commit's `bundle.json`.
- `--update` also copies any bundle file a copied module imports that the app does not list yet (for example a new `shared/` module the SDK starts to import), adds it to `workshop-files.json` and to `app.json`'s `files`, and says so.
- `--check` (CI) fails when a copy's hash differs from `sha256`, or `sha256` differs from `bundle.json` at the pinned commit. The first check needs no network.
- Workshop's `tests/check-remote.mjs` warns when an app pins an older bundle than this branch.

## Rules

1. Never edit a copy in an app's repo: change it in workshop, then `--update`.
2. A file an app needs that is not in the bundle is added to the bundle first.

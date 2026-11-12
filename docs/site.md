# Site config

Where Workshop and its apps live on the web: the sites, the installer and repo addresses, and the breadcrumbs back to the owner's own site. One file holds them, so a fork or a new domain changes one place.

Version: `site: 1`.

## The file

`shared/site.js`, a plain ES module with no imports, so the agent (Node), the shell, every app and the tests can all import it.

```js
export const SITE = {
  site: 1,
  name: 'Workshop',
  workshop: 'https://workshop.example.org',
  apps: { prioritizer: 'https://docket.example.org', agents: 'https://dispatch.example.org' },
  allowedSites: ['https://workshop.example.org'],
  crumbs: { domain: 'example.org', links: [{ title: 'Home', href: 'https://example.org/' }] },
  repos: { workshop: 'owner/workshop' }
};
```

| Field | Meaning |
| --- | --- |
| `name` | The product name people see. |
| `workshop` | Workshop's own site (the shell). |
| `apps` | The retired site of each app that had one of its own, by app id. The Worker redirects them to Pop out (below). |
| `allowedSites` | Sites a new install allows ([config.md](config.md), `hosted.origins`). Each still needs a click in the pairing window. |
| `crumbs` | Breadcrumbs back to the owner's site: shown on pages whose host is `domain` or a subdomain of it. |
| `repos` | GitHub `owner/repo` of each repo the installer or a page links to, by short name. |

## Rules

1. **No site address anywhere else** in code that runs: the agent, shell, shared files, apps, Worker and installers read this file. Comments, docs and tests may name sites.
2. **Exceptions, checked:** `wrangler.jsonc` (Cloudflare reads it directly) and the installer scripts (`scripts/bootstrap.*`, which run before anything is downloaded, and `scripts/install.*`, plain shell). `tests/check-site.mjs` fails when an address there is not one in this file, or when any other runtime file names one.

## Retired sites

Apps no longer have sites of their own (decided Nov 11, 2026): **Pop out** opens any app in its own window on Workshop's site, with the same data. The addresses in `apps` stay in this file for now, because:

- **Old domains redirect.** When an app's domain is attached to Workshop's Worker, every address on it goes to `<workshop>/?solo=<id>#/<id>` (a 302, `worker/index.js`, `retiredRedirect`), so bookmarks keep working. Until then, the domain still serves the app's old site.
- **Dispatch's old domain** is in `apps` as `agents` (retired Nov 12, 2026). It is already attached to Workshop's Worker, so it redirects now. Its installer addresses (`/install.ps1` and the others) go to the same installer on Workshop's site, so old one-line install commands keep working.
- **An app's start page opened on its own** (`/apps/<id>/` or `/apps/<id>/index.html` as a top-level page, not in the shell's frame) goes to the same pop-out address (`topLevelApp`). The app's other pages are left alone.

`apps` and the app entries in `allowedSites` go once the redirects end (after Feb 1, 2027).


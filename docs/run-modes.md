# Run modes and data backends

Version 1. Data stays on the user's computer in every mode. No mode sends data to a server.

## Modes

| Mode | Where the UI comes from | Data backend | Connectors | Default |
| --- | --- | --- | --- | --- |
| `local` | The agent, at `http://127.0.0.1:<port>/` | `agent` (files in `~/.workshop/data/`) | Available | Yes |
| `hosted` | Static files on the user's own domain (for example `https://<name>.alexisdavidson.org`) | `agent` when paired and reachable, else `browser` | Available only with the agent | No, off until `features.hostedMode` is on |
| `browser` | The same static files, with no agent | `browser` (IndexedDB in that browser) | Unavailable | Used when no agent is reachable |

`browser` mode exists for machines where a local server is blocked. Prioritizer works there with file export and import (see [data-format.md](data-format.md), Bundles).

No origin, domain or port is hardcoded in code. The agent's port comes from `config.json` (`port`, default `4380`). Allowed origins come from `config.json` (`allowedOrigins`, empty by default). See [config.md](config.md).

## How the SDK picks a backend

Apps never choose. They call the SDK ([sdk.md](sdk.md)), and the SDK picks once, when the page loads:

1. **Served by the agent?** If the page's origin is `http://127.0.0.1:<port>` or `http://localhost:<port>` and `GET /api/health` on the same origin returns `{"app": "workshop-agent", "api": 1}`, the mode is `local` and the backend is `agent`.
2. **Paired with an agent?** Otherwise, read `workshop.agent` from `localStorage` (`{"url": "http://127.0.0.1:4380", "token": "..."}`, written by pairing, below). If it exists, call `GET <url>/api/health` with `targetAddressSpace: "loopback"` and a 1.5 second timeout, then `GET <url>/api/apps` with the token. If both succeed, the mode is `hosted` and the backend is `agent`.
3. **Otherwise** the mode is `browser` and the backend is `browser`.

`ws.mode` and `ws.backend` report the result.

Rules:

- **No silent switching.** If the agent stops answering after the page loaded, the SDK does not move to browser storage. It reports `ws.online === false`, fires `online` events when it changes, and retries every 5 seconds. Switching backends takes a reload. Two backends are two separate stores, and mixing them silently would split the user's data.
- **Moving data between backends** is an explicit export and import of a bundle ([data-format.md](data-format.md)).
- **Data API is identical.** `data.get`, `data.put`, `data.subscribe`, revisions, conflicts and errors behave the same on both backends. The contract suite tests the agent; the browser backend (WS4) must follow the same rules.

## Browser backend

- Storage: IndexedDB database `workshop`, object store `data`, key `<app>/<collection>`, value: the envelope from [data-format.md](data-format.md). `rev` and `updatedAt` are set by the backend exactly as the agent sets them. A put with a stale `rev` fails with code `conflict`.
- Change events: a `BroadcastChannel` named `workshop-data` carries the same payload as the agent's `data` event, so other tabs update.
- Connectors: `connectors.list()` returns `[]`; `connectors.call()` rejects with code `unavailable`.
- Export and import: `data.export()` and `data.import(bundle)` work on both backends.

## Hosted mode

Hosted mode is off by default. To use it, the user turns on `features.hostedMode` and adds the hosted origin to `allowedOrigins`, in `config.json` or the Settings app (only from the agent's own origin).

### Pairing

A hosted page cannot read the agent's cookie, so it gets the token by pairing, once per browser:

1. The hosted shell opens a popup: `http://127.0.0.1:<port>/pair?origin=<hosted origin, URL-encoded>`.
2. The agent answers only if the browser already has the agent cookie (the user opened Workshop locally at least once), `features.hostedMode` is on, and the origin is in `allowedOrigins`. Otherwise it shows a page that says what is missing.
3. The page shows the origin and a button: "Allow <origin> to use Workshop on this computer". Nothing is sent until the user clicks it.
4. On click, the page calls `window.opener.postMessage({type: "workshop-pair", api: 1, url, token}, <origin>)` and closes. `url` is the agent's own origin.
5. The hosted shell stores `{url, token}` as `workshop.agent` in its `localStorage`.

The pair page sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, so it cannot be framed and clicked by another site.

### Browser prompts

Chrome and Edge ask the user to allow a public site to reach `127.0.0.1` (Local Network Access). Expect that prompt once per hosted origin. Requests to the agent from a hosted page pass `targetAddressSpace: "loopback"` to `fetch`, and the agent answers preflights with `Access-Control-Allow-Private-Network: true`.

### Trade-off

The hosted page holds the token in its own `localStorage`. Anyone who can run script on that origin can use the agent. That is why hosted mode is off by default, origins must be listed one by one, and config changes (`PUT /api/config` and `PUT /api/connectors/<id>/config`) are refused from hosted origins. In hosted mode the Settings app shows settings read-only and says to open Workshop on this computer to change them.

## Service worker rules

These apply to any service worker Workshop ships, in every mode:

- Never cache, and never call `respondWith` for, a request whose path starts with `/api/` or is `/pair`, on the agent's origin.
- Never cache any request to the agent's origin made from a hosted page.
- Never touch `/api/events` (the event stream). Let the browser handle it.

The check is in `tests/contract/service-worker.test.mjs`. It is marked to-do until WS4 replaces `sw.js`; WS4 removes the to-do mark.

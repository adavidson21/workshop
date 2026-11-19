# Cloudflare connector

Your Cloudflare account in Workshop, for your own computer: zones and DNS, Workers (versions, deployments, custom domains, Workers Builds and their logs) and Pages (projects, deployments, build logs, variables). Tandem can read all of it and **propose** changes; nothing changes on Cloudflare until **you** approve them in Workshop's Approvals (or an always-allow rule you made covers them). Off in work mode. Node standard library only. It calls only the API address in its settings (`https://api.cloudflare.com/client/v4`).

## How it keeps the token safe

- The token lives in this computer's own secret store: macOS Keychain, Windows Credential Manager, or the Secret Service on Linux. You save it with `workshop secret set cloudflare`, which asks for it without showing it and hands it to the store on stdin (never a command line, a file Workshop writes, an environment variable or a log). See [docs/security.md](../../docs/security.md), Secrets.
- Only this connector, inside the Workshop agent, reads it (`ctx.secret`), and only to put it in the `Authorization` header of a call to the API address above.
- Tandem never gets the token. Its agents call this connector's read actions through `/api/tools` with a separate agent token that can only read and propose ([docs/agent-api.md](../../docs/agent-api.md), Tools for agents).
- Every change is a change set you review and approve. Changes are checked against **Zones Workshop may change** when they are proposed and again when you apply them. The steps you read are worked out from the changes themselves, and Approve sends back a fingerprint of them: if the file was edited after you read it, nothing is applied. There is no way to delete a zone, a Worker or a Pages project, and no change can carry a secret value.
- What was done is in `cloudflare/log.md` in your data folder, in plain words.

What this does not protect against: a program running as you that sets out to read your Keychain or Credential Manager. Keep the token narrow (below), give it an expiry date, and, if your home address does not change often, add **Client IP Address Filtering** to it.

## Setup

1. **Make a token.** Cloudflare dashboard, **My Profile**, **API Tokens**, **Create Token**, **Create Custom Token**. Give it a name like `Workshop on <this computer>` and:

   | Scope | Permission | For |
   | --- | --- | --- |
   | Account | Workers Scripts: Edit | Workers, versions, rollbacks, custom domains |
   | Account | Workers Builds Configuration: Edit (the API calls it Workers CI) | Builds, build logs, retrying a build. Read is enough if you never want retries. |
   | Account | Cloudflare Pages: Edit | Pages projects, deployments, logs, variables, domains |
   | Zone | Zone: Read | Listing your zones |
   | Zone | DNS: Edit | DNS records |

   Under **Zone Resources** pick **Specific zone** and only the domains you want Workshop to touch. Set a **TTL** end date (90 days is a good rhythm). If attaching a Worker to a custom domain fails with HTTP 403, add Zone, **Workers Routes: Edit**.
2. **Save it.** In a terminal on this computer: `workshop secret set cloudflare --expires <the TTL date>`. Paste the token when asked. Check it with `workshop secret check cloudflare`.
3. **Turn it on.** Settings, Cloudflare: switch it on, paste your **Account ID** (Account home, the menu next to the account name, Copy account ID), and list **Zones Workshop may change** (for example `example.org`). Leave **Let Tandem read and propose changes** on to use it from Tandem.
4. Use the Test field (a zone name, or leave it empty) to see your zones.

When the token nears its date, Settings and `workshop secret list` say so; make a new token with the same permissions and run `workshop secret set cloudflare --expires <new date>` again. No restart is needed: Workshop reads it again within a minute.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `accountId` | required | Your Cloudflare account ID (32 hex characters). |
| `tokenSecret` | `cloudflare` | The secret name the token was saved under with `workshop secret set`. Settings shows whether it is saved and when it expires; there is no field for the token itself. |
| `zones` | `[]` | Zones Workshop may change. DNS records and custom domains outside these are refused, even in a set you apply. Empty means no DNS or domain changes at all. |
| `agents` | `true` | Tandem may read and propose through `/api/tools`. Off: those calls are refused; you can still use everything from Workshop. |
| `apiUrl` | `https://api.cloudflare.com/client/v4` | The one address the connector calls (Advanced). |

## Actions

Read actions marked **agent** can be run by Tandem through `/api/tools` and `/api/mcp`. Apply is a write Tandem can only ask for: it runs when you approve it in Approvals.

| Action | Agent | Args | Result |
| --- | --- | --- | --- |
| `token.verify` | yes | none | `{status, expiresOn, notBefore, kind}` (`user` or `account` token) |
| `zones.list` | yes | `name` (optional) | `[{name, id, status, plan, mayChange}]` |
| `dns.list` | yes | `zone`, `type`, `name` | `{zone, records: [{id, type, name, content, proxied, ttl, comment}]}` |
| `workers.list` | yes | none | `[{name, tag, modified, hasAssets}]` |
| `workers.domains` | yes | `service` | `[{hostname, service, zone, enabled}]` |
| `workers.versions` | yes | `script` | `[{id, number, created, source, message}]`, newest first, at most 50 |
| `workers.deployments` | yes | `script` | `[{id, created, source, message, versions: [{versionId, percentage}]}]` |
| `workers.builds` | yes | `script`, `limit` | `[{buildId, status, outcome, branch, commit, message, created, stopped}]` (Workers Builds) |
| `workers.buildLog` | yes | `buildId`, `tail` (default 400 lines) | `{lines, truncated}` |
| `pages.projects` | yes | none | `[{name, subdomain, domains, productionBranch, repo, latest}]` |
| `pages.project` | yes | `project` | build settings and variables; encrypted values never leave Cloudflare |
| `pages.deployments` | yes | `project`, `environment` | `[{id, environment, url, branch, commit, message, stage, status, created}]` |
| `pages.deploymentLog` | yes | `project`, `deployment`, `tail` | `{lines, truncated, total}` |
| `changes.check` | yes | `changes` | `{ok, steps: [{summary, problem?, now?}]}`: every problem at once; changes nothing |
| `changes.propose` | yes | `title`, `why`, `item`, `changes` | Saves a set and asks you to approve it in Approvals: `{id, status: "waiting", steps, approval}`. When an always-allow rule covers its zones, it is applied at once: `{id, status: "applied", rule, results}`. Refused (with every problem) if any change fails its check. |
| `changes.list` | yes | `status` | `[{id, title, status, item, from, created, decided, steps}]`, newest first |
| `changes.get` | yes | `id` | The whole set, with `results` once applied. While it waits, its steps are worked out again from its changes (never read from the file), with what each update or removal replaces read from Cloudflare now, plus `ok` and `digest`. |
| `changes.apply` | asks (write) | `id`, `digest` (from `changes.get` or `changes.propose`) | What Approvals runs when you approve a set. Refuses if the set changed since that read. Checks it again, then makes each change in order and stops at the first failure: `{status: applied\|failed, results}`. Approvals shows the steps worked out from the set now; rejecting the request marks the set rejected. Always-allow rules cover the set's scopes: its zones, `worker:<name>` and `pages:<project>`. |

## Change sets

A change set is a list of up to 20 changes:

| `op` | Fields | Does |
| --- | --- | --- |
| `dns.create` | `zone`, `type` (A, AAAA, CNAME, TXT, MX), `name` (`@`, `app`, or a full name in the zone), `content`, `proxied`, `ttl` (1 = auto, or 60 to 86400), `comment`, `priority` (MX) | Adds a record |
| `dns.update` | `zone`, `id` (from `dns.list`), any of `name`, `content`, `proxied`, `ttl`, `comment` | Changes a record; review shows what it is now |
| `dns.delete` | `zone`, `id` | Removes a record; review shows what it is now |
| `workers.domain.attach` | `hostname`, `service` | Serves a Worker on a custom domain (Cloudflare adds the DNS record and certificate) |
| `workers.domain.detach` | `hostname` | Stops serving it |
| `workers.rollback` | `script`, `versionId` (from `workers.versions`), `message` | Sends all traffic to that version |
| `workers.build.retry` | `script`, `buildId` | Runs a Workers Build again |
| `pages.create` | `name`, `productionBranch` (default `main`), `repo: {owner, name}` (GitHub, already connected to Cloudflare), `buildCommand`, `outputDir`, `rootDir` | Creates a Pages project |
| `pages.domain.add` | `project`, `domain` | Adds a custom domain |
| `pages.env.set` | `project`, `environment` (production or preview), `vars: {NAME: "value" or null}` | Plain text variables only; null removes one. Names that look like secrets (TOKEN, SECRET, PASSWORD, KEY and the like) are refused: set those yourself in the dashboard as encrypted variables. |
| `pages.rollback`, `pages.retry` | `project`, `deployment` | Rolls back to, or reruns, a deployment |

Not possible, on purpose: deleting zones, Workers or Pages projects, changing account settings, tokens or members, and anything that needs a secret value.

**Where you approve them.** Settings, Manager, **Approvals**, the one place for every change Tandem asks for: each set's steps in words, **Approve** (with "Always allow" for its zones, if you want) and **Reject**. Needs you shows "N changes to approve" and opens it. Settings, Cloudflare lists the sets and what happened to them.

## Data

| Where | What |
| --- | --- |
| `<data folder>/cloudflare/changes/<id>.json` | One change set: what was asked and why, by whom, its steps, and what happened. Never removed by Workshop. |
| `<data folder>/cloudflare/log.md` | Every set applied or rejected, newest last, one line per change. |

## Tests

```
node --test "connectors/cloudflare/test/*.test.mjs"
```

They run against a fake Cloudflare (`test/fake-cloudflare.mjs`); nothing reaches the real API.

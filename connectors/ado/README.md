# ADO connector

One Azure DevOps integration for every Workshop app, and the only one: Docket's Python helper (`ado_helper.py`) was retired in Docket 5.4.0, so Docket on its own site syncs through this connector too, once paired. It also gives eng-agents `/start` a way to fetch work items through the agent (WS9). Settings still imports an old `ado-helper.json`, and `doctor ado --compare --helper <path>` still compares against a helper you have.

Mostly read-only. The two actions that change ADO, `workitem.update` (Runway's and Slate's Publish) and `workitem.create` (Slate's Publish), have `write: true`, so the agent runs them only with `confirm: true` from a person's click; they need a PAT with **Work Items (Read & Write)**. Everything else needs only read scopes. Node standard library only. It calls only the server URLs in its settings.

## Settings

`connectors.ado.config` in `~/.workshop/config.json`, edited in the Settings app (the form comes from `configSchema` in `index.mjs`). Each field names its Settings page with `x-workshop-page`: connections on **Connections** (one row each), work item types, states and team reports on **Work items**, `prSources` and `prTeams` on **Pull requests**, and `paths` on **Repos**, one row per workspace repo. A paired site may change `paths` and `prSources` (`x-workshop-hosted`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `connections[]` | required | One per server and collection: `name`, `serverUrl` (the part before the collection), `collection`, `project`, `patEnv`, `patExpires` (optional `YYYY-MM-DD`), `apiVersion` (`6.0`), `useSystemCa` (`true`), `verifyTls` (`true`). |
| `defaultConnection` | first one | Used when nothing else decides. |
| `syncConnection` | default | The connection for "my work items" (the helper's `base_url`). |
| `paths[]` | `[]` | `{path, connection, project}`: which connection a repo or folder uses. `*` matches any characters, `~` is your home folder, the longest match wins. |
| `types`, `closedStates`, `removedStates` | `Issue, Bug, User Story`; `Resolved, Closed, Done`; `Removed` | Same as the helper's `types`, `closed_states`, `removed_states`. |
| `prSources[]` | `[]` | `{connection, project, repos[]}`. Empty skips PRs. |
| `prTeams` | `[]` | Team names that count as yours. Empty means every team you are on. |
| `reports` | helper defaults | `workloadTypes`, `bugTypes`, `highPriorities` (strings, for example `"1"`), `escalationPriority`, `effortFields`, `maxItems`. |

**PATs** live only in environment variables. A connection names the variable (`patEnv`); the connector reads it through `ctx.env` and puts it only in the `Authorization` header. It never logs, returns or emits it, and error messages never include it.

### Setting up and renewing a PAT

1. In ADO, make a PAT with **Work Items (Read & write)** (Slate's Publish, Post questions, Mark resolved and Close as released, assigning on Delegate, and Runway's Publish write; **Work Items (Read)** is enough for Docket alone). Add **Code (Read)** for pull requests and **Project and Team (Read)** for team PRs. Note its expiry date.
2. Run `workshop pat ADO_PAT` (or the variable name the connection uses) and paste the token. It is not shown and does not land in shell history. On Windows it is saved for your account and Workshop picks it up within seconds, with no restart. On macOS and Linux the command explains how to add it to your shell profile; then run `workshop restart`.
3. In Settings, ADO connector: add the connection (or **Import settings from a file** with your `ado-helper.json` or eng-agents `config.json`; nothing is saved until you click Save), set **PAT expires** to the date ADO showed, and try the Test field.

To renew, make a new PAT, run step 2 again, update **PAT expires**, and click **Check again** on the ADO card.

The connector's status says when:

- a PAT variable is not set (state `error`; calls wait until it is set, which Settings shows without a restart);
- ADO answered 401 to a PAT (state stays `ready`, so a new PAT works at once; the message stays until the variable holds a different value or a call succeeds). A 403 is a missing scope on one call, not a bad PAT, and is only in that call's error;
- a PAT is within 14 days of its **PAT expires** date, or past it.

`status().details` carries `patsMissing`, `patsExpiring` (`{patEnv, connection, expires, days}`) and `patsRejected` (`{patEnv, at}`), never a value.

**Company certificates.** With `useSystemCa` on (default), the connector trusts the certificates your operating system trusts, as Python did. This needs Node 22.15 or later (`tls.getCACertificates`). On an older Node, set `NODE_EXTRA_CA_CERTS` to your company's CA file instead.

**Proxies.** The connector does not use a proxy. `ado_helper.py` honored the system proxy settings. On-premises ADO servers are normally reached directly; if yours needs a proxy, say so in an issue.

## Actions

Call with `POST /api/connectors/ado/<action>` and `{"args": {...}}`, or `connectors.call('ado', action, args)` from the SDK.

| Action | Args | Result |
| --- | --- | --- |
| `sync` | `known` (work item IDs on the board), `knownPrs` (PR keys), `prs` (default `true`) | Same JSON as the helper's `POST /sync`: `{items, gone, syncedAt, prs?, prError?}`. |
| `sync.prs` | `knownPrs` | The helper's `prs` object: `{items, gone, notes}`. Each item also has `commit`, the PR's latest source commit (null if ADO did not send one), which Dispatch's Review all uses to skip PRs already reviewed at that commit. |
| `dataset` | `areas`, `people`, `days`, and `connection` (name) or `base` (collection URL, as the helper took it) | Same JSON as the helper's `POST /dataset`, plus `connection`. |
| `workitem.get` | `id`, optional `connection`, `path` (repo or folder), `details`, `html`, `pullRequests`, `comments`, `history`, `extras`, `pointsFields`, `fields` | `{id, title, type, state, project, connection, reason, url}`. With `details: true` also `area`, `iteration`, `tags`, `description`, `acceptanceCriteria`, `reproSteps` (plain text) and `related`; add `html: true` for `html.{description, acceptanceCriteria, reproSteps}` (ADO's raw HTML, untrusted) and `pullRequests: true` for linked `[{id, repositoryId}]`. `comments: true` adds `comments` (oldest first, `{id, html, text, by, date, edited}`); `history: true` adds `history` (newest first, at most 50, `{rev, by, date, changes: [{field, from, to}]}` for state, assignee, priority, iteration, area, tags and title). `extras: true` adds `assignee`, `priority`, `severity`, `storyPoints` (first set of `pointsFields`, default Story Points then Effort), `systemInfo` (plain text), `commentCount`, `links` (`{items: [{id, name, title, type, state, url}], hyperlinks: [{url, comment}], attachments: [{name, url}], pullRequests}`, at most 50 of each; hyperlinks are http(s) only) and `custom` (the `fields` asked for by reference name, at most 20, as plain text) for Slate's panel. Without these flags the result is exactly as before. `reason` says why that connection was picked, so callers can confirm before acting. |
| `workitem.prs` | `id`, optional `connection`, `children` (default true) | The pull requests linked to the item and, with `children`, to its child items (up to 100 children, 60 PRs): `{id, type, state, rev, connection, children: [{id, title, type, state}], prs: [{id, workItemId, status, title, repository, targetBranch, url, closed}], status, truncated}`. `status` per PR is ADO's (`active`, `completed`, `abandoned`), or `missing` when the PR cannot be read (deleted, or no Code (Read) on the PAT). Overall `status`: `none`, `open` (any active), `merged` (none active, at least one completed) or `abandoned`. Read only; needs Code (Read) on the PAT. Slate's Merged column. |
| `roadmap` | `areas` (required, area paths, matched with UNDER), `includeClosed`, `stories`, `connection` | `{connection, items, total, truncated, childrenTruncated, fetchedAt}`. `items` are Epics and Features: `{id, rev, type, title, state, area, iteration, parentId, assignee, targetDate, startDate, changed, url}`, newest change first, at most 2000. Dates are `yyyy-mm-dd` or `null`. `assignee` is Assigned To as `{name, email}` (email lower case, empty when ADO gives none), or `null`. Each Feature also has `storiesTotal` (its User Story and Issue children, wherever their area is, not counting won't-do states) and `storiesDone` (those in a state that counts as done). At most 5000 children are counted (`childrenTruncated` says if there were more). With `stories: true`, those User Story and Issue children are also in `items` (same fields, `parentId` is their Feature; open ones only unless `includeClosed`). For Runway. |
| `backlog` | `areas` (required, area paths, matched with UNDER), optional `types` (any of `Epic`, `Feature`, `User Story`, `Product Backlog Item`, `Bug`, `Issue`; default all), `connection` | `{connection, items, total, truncated, fetchedAt}`. For Slate: open work items under the areas, any type and whatever their parent, in `roadmap`'s item shape (`id, rev, type, title, state, area, iteration, parentId, assignee, targetDate, startDate, changed, url`), newest change first, at most 500, plus `tags` (a list), `priority`, `storyPoints` (first set of the optional `pointsFields`, default Story Points then Effort) and `commentCount`; optional `fields` (reference names, at most 20) adds `custom` with those fields as plain text. Closed and removed states (`closedStates`, `removedStates`) are left out. |
| `iterations.list` | `project`, `connection` | `{connection, project, iterations: [{path, name, start, finish, current}]}`; `path` is the form work items use (`Project\Sprint 12`). |
| `workitem.update` (write) | `id`, `rev` (the revision you read), `changes: {title?, state?, assignedTo?, priority?, iteration?, area?, startDate?, targetDate?, description?, acceptance?, tagsAdd?, tagsRemove?, comment?, related?}`, `connection` | The item as ADO now has it: `{id, rev, type, title, state, reason, assignee: {name, email} \| null, priority, iteration, area, project, tags[], created, changed, stateChanged, connection, url}`. For Runway's and Slate's Publish. `description` and `acceptance` (Acceptance Criteria) are plain text or Markdown, sent as escaped HTML with line breaks kept. `assignedTo: ""` unassigns; `startDate: ""` or `targetDate: ""` clears the date (dates are `YYYY-MM-DD`). The connector reads the item first and sends one JSON Patch with a `test` on `/rev`; if the item changed since `rev`, it answers `409 conflict` and changes nothing. `comment` (plain text or Markdown) is added to the item's Discussion through `System.History`. `related` is up to 20 work item ids to add Related links to; ids already linked (by any link type) and the item itself are skipped, and a call where nothing is left answers `Those items are already linked.` (Slate: Post questions, and linking the source item on Publish.) |
| `workitem.create` (write) | `type` (`Epic`, `Feature`, `User Story`, `Product Backlog Item`, `Bug`, `Task` or `Issue`), `title`, optional `project`, `connection`, `parent` (work item id), `fields: {description?, acceptance?, area?, iteration?, assignedTo?, priority?, tags?}` | The new item, in the same shape as `workitem.update`. For Slate's Publish. The project is `project`, else the parent's, else the connection's; with none it refuses before calling ADO. `parent` adds a parent link. ADO checks the whole request first, so nothing is created when a field is refused. |
| `connection.resolve` | `connection` or `path` | Which connection and project would be used, and whether its PAT variable is set. Calls nothing. Setup action: runs while the connector reports an error. |
| `config.import` | `helper` (parsed ado-helper.json), `engAgents` (parsed eng-agents config.json), or `file` (either one; the kind is guessed) | `{config, notes}`: settings merged with the current ones. Saves nothing; the Settings app shows them and saves with `PUT /api/connectors/ado/config`. Setup action, so it works before any connection exists. Never reads a PAT from the file. |
| `config.fromUrl` | `url`: any link copied out of ADO (work item, board, repo, PR or project page; server or cloud) | `{config, notes}`: the current settings with the link's server, collection and project filled in (a new connection, or the project on the matching one), the default connection and a PR source for that project when there are none. Saves nothing, like `config.import`. Setup action. |

The connection is picked in eng-agents order: `connection` by name, then a `paths` match for `path`, then `defaultConnection`, then the only connection. eng-agents also matched a repo's git remote; the connector does not run git, so map such repos in `paths`.

`roadmap`, `iterations.list` and `workitem.update` use `connection` by name, else the connection for my work items (`syncConnection`).

Errors are plain words with a code: `bad_request` (settings or arguments), `not_found` (no such work item), `unavailable` (ADO rejected the PAT, could not be reached, or answered with a sign-in page), `conflict` (a write's `rev` is stale; reload the item and try again). The agent does not pass extra error fields on, so callers re-read the item after a conflict.

**Comments API.** Work item comments (`workitem.get` with `comments: true`) are a preview API on ADO Server 2020. The connector calls it as `<apiVersion>-preview.3` (`6.0-preview.3` by default). Check it once on your server with `--write-check` below.

## Doctor

`workshop doctor ado` runs these checks. The same script also runs on its own:

```
node connectors/ado/doctor.mjs                 # check each connection and its PAT expiry, list what a sync finds (the helper's --test)
node connectors/ado/doctor.mjs --import        # print settings built from ado-helper.json and eng-agents config.json
node connectors/ado/doctor.mjs --import --write  # save them into ~/.workshop/config.json (does not turn the connector on)
node connectors/ado/doctor.mjs --compare --areas "Project\Team" --people "a@example.com"
node connectors/ado/doctor.mjs --write-check 12345   # pick a test work item
```

`--write-check <id>` adds the tag `workshop-write-check` to that work item and removes it again. On the way it sends one write with an old revision straight to ADO, to see ADO refuse it, and asks the comments API for one comment. It prints plain-word results only, never titles or names.

`--compare` runs `ado_helper.py` (with its own `ado-helper.json`) and the connector (with settings imported from that same file) against your ADO, then prints match and mismatch counts per section, with the names of fields that differ. It prints no titles, names, URLs or messages, and writes no files (Python runs with bytecode writing off). Use it at work to check parity before WS8 removes the helper. Options: `--helper <ado_helper.py>`, `--python <command>`, `--known <ids>`, `--days <n>`. Run `--help` for all.

## Tests

```
node --test "connectors/ado/test/*.test.mjs"
node connectors/ado/test/make-goldens.mjs      # after changing fixtures or the helper
```

- `test/fixtures/team.mjs`: synthetic data shaped like the public Azure DevOps REST API reference. No work data.
- `test/fake-ado.mjs`: a fake ADO server on 127.0.0.1 that serves the fixtures and records every request.
- `test/goldens/`: what `ado_helper.py` returns for each case, and the ADO calls it made. `golden.test.mjs` checks the connector returns the same JSON and makes the same calls, and (when Python 3 is installed) that the goldens still match the helper.
- `test/fixtures/roadmap.mjs` and `roadmap.test.mjs`: the `roadmap` action, story counts included.
- `prs.test.mjs`: `workitem.prs` on its own synthetic scenario (a Feature with stories, PRs in two states, a missing PR).
- `test/fixtures/items.mjs` and `items.test.mjs`: `workitem.get` details, `iterations.list` and `workitem.update`. The fake server applies writes in memory, refuses a stale `test` on `/rev` with `TF26071`, and answers 403 to every write on a read-only collection.
- `connector.test.mjs` runs the connector through the mock agent, including that a PAT never shows up in responses, logs or errors. `doctor.test.mjs` covers the doctor, including that `--compare` writes nothing and prints no data.

## Differences from the helper

- Several connections, each with its own PAT variable, instead of one URL and one PAT.
- `dataset` takes a connection name; `base` still works for any configured connection.
- Error messages point to Settings instead of `--setup`.
- `commit` on PR items is the connector's own addition (the helper does not return it), so the goldens compare PRs without it; `connector.test.mjs` checks it.
- Two PR "gone" entries can come back in a different order (the helper walked a Python set). The goldens compare them sorted.

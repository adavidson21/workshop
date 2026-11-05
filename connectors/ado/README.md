# ADO connector

One Azure DevOps integration for every Workshop app. It replaces `apps/prioritizer/ado-helper/ado_helper.py` (removed in WS8) and gives eng-agents `/start` a way to fetch work items through the agent (WS9).

Mostly read-only. The three actions that change ADO (`workitem.update`, `workitem.comment`, `workitem.create`; built for the Queue app, which was removed, and kept for Runway) have `write: true`, so the agent runs them only with `confirm: true` from a person's click; they need a PAT with **Work Items (Read & Write)**. Everything else needs only read scopes. Node standard library only. It calls only the server URLs in its settings.

## Settings

`connectors.ado.config` in `~/.workshop/config.json`, edited in the Settings app (the form comes from `configSchema` in `index.mjs`).

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

1. In ADO, make a PAT with **Work Items (Read)** (add **Code (Read)** for pull requests and **Project and Team (Read)** for team PRs). Note its expiry date.
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
| `workitem.get` | `id`, optional `connection`, `path` (repo or folder), `details`, `html`, `pullRequests`, `comments`, `history` | `{id, title, type, state, project, connection, reason, url}`. With `details: true` also `area`, `iteration`, `tags`, `description`, `acceptanceCriteria`, `reproSteps` (plain text) and `related`; add `html: true` for `html.{description, acceptanceCriteria, reproSteps}` (ADO's raw HTML, untrusted) and `pullRequests: true` for linked `[{id, repositoryId}]`. `comments: true` adds `comments` (oldest first, `{id, html, text, by, date, edited}`); `history: true` adds `history` (newest first, at most 50, `{rev, by, date, changes: [{field, from, to}]}` for state, assignee, priority, iteration, area, tags and title). Without these flags the result is exactly as before. `reason` says why that connection was picked, so callers can confirm before acting. |
| `queue.list` | `areas` (required, area paths, matched with UNDER), `types` (default: Work item types), `includeClosed`, `changedSince` (`yyyy-mm-dd`), `connection` | `{connection, me, items, total, truncated, fetchedAt}`. `items` are `{id, rev, type, title, state, reason, assignee: {name, email} \| null, priority, iteration, area, project, tags[], created, changed, stateChanged, connection, url}`, newest change first, at most 2000 (`truncated` says if there were more). `me` is `{name, email}` from connectionData, or `null`. Area paths come from the app, not these settings. |
| `roadmap` | `areas` (required, area paths, matched with UNDER), `includeClosed`, `stories`, `connection` | `{connection, items, total, truncated, childrenTruncated, fetchedAt}`. `items` are Epics and Features: `{id, rev, type, title, state, area, iteration, parentId, assignee, targetDate, startDate, changed, url}`, newest change first, at most 2000. Dates are `yyyy-mm-dd` or `null`. `assignee` is Assigned To as `{name, email}` (email lower case, empty when ADO gives none), or `null`. Each Feature also has `storiesTotal` (its User Story and Issue children, wherever their area is, not counting won't-do states) and `storiesDone` (those in a state that counts as done). At most 5000 children are counted (`childrenTruncated` says if there were more). With `stories: true`, those User Story and Issue children are also in `items` (same fields, `parentId` is their Feature; open ones only unless `includeClosed`). For Runway. |
| `workitem.states` | `type`, `project` (default: the connection's), `connection` | `{connection, project, type, states: [{name, category, color}]}`. |
| `iterations.list` | `project`, `connection` | `{connection, project, iterations: [{path, name, start, finish, current}]}`; `path` is the form work items use (`Project\Sprint 12`). |
| `workitem.update` (write) | `id`, `rev` (the revision you read), `changes: {state?, assignedTo?, priority?, iteration?, tagsAdd?, tagsRemove?}`, `connection` | The item as ADO now has it, in the `queue.list` shape. `assignedTo: ""` unassigns. The connector reads the item first and sends one JSON Patch with a `test` on `/rev`; if the item changed since `rev`, it answers `409 conflict` and changes nothing. |
| `workitem.comment` (write) | `id`, `text` (plain text), `connection` | `{id, comment: {id, text, date}, connection}`. The text is escaped and line breaks become `<br>`. |
| `workitem.create` (write) | `type`, `title`, `project`, `description` (plain text; a Bug's goes in Repro Steps), `area`, `iteration`, `priority`, `assignedTo`, `connection` | The new item in the `queue.list` shape. |
| `connection.resolve` | `connection` or `path` | Which connection and project would be used, and whether its PAT variable is set. Calls nothing. Setup action: runs while the connector reports an error. |
| `config.import` | `helper` (parsed ado-helper.json), `engAgents` (parsed eng-agents config.json), or `file` (either one; the kind is guessed) | `{config, notes}`: settings merged with the current ones. Saves nothing; the Settings app shows them and saves with `PUT /api/connectors/ado/config`. Setup action, so it works before any connection exists. Never reads a PAT from the file. |
| `config.fromUrl` | `url`: any link copied out of ADO (work item, board, repo, PR or project page; server or cloud) | `{config, notes}`: the current settings with the link's server, collection and project filled in (a new connection, or the project on the matching one), the default connection and a PR source for that project when there are none. Saves nothing, like `config.import`. Setup action. |

The connection is picked in eng-agents order: `connection` by name, then a `paths` match for `path`, then `defaultConnection`, then the only connection. eng-agents also matched a repo's git remote; the connector does not run git, so map such repos in `paths`.

Queue and roadmap actions use `connection` by name, else the connection for my work items (`syncConnection`).

Errors are plain words with a code: `bad_request` (settings or arguments), `not_found` (no such work item), `unavailable` (ADO rejected the PAT, could not be reached, or answered with a sign-in page), `conflict` (a write's `rev` is stale; reload the item and try again). The agent does not pass extra error fields on, so callers re-read the item after a conflict.

**Comments API.** Work item comments are a preview API on ADO Server 2020. The connector calls it as `<apiVersion>-preview.3` (`6.0-preview.3` by default). Check it once on your server with `--write-check` below.

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
- `test/fixtures/queue.mjs` and `queue.test.mjs`: the Queue actions, writes included. The fake server applies writes in memory, refuses a stale `test` on `/rev` with `TF26071`, and answers 403 to every write on a read-only collection.
- `connector.test.mjs` runs the connector through the mock agent, including that a PAT never shows up in responses, logs or errors. `doctor.test.mjs` covers the doctor, including that `--compare` writes nothing and prints no data.

## Differences from the helper

- Several connections, each with its own PAT variable, instead of one URL and one PAT.
- `dataset` takes a connection name; `base` still works for any configured connection.
- Error messages point to Settings instead of `--setup`.
- `commit` on PR items is the connector's own addition (the helper does not return it), so the goldens compare PRs without it; `connector.test.mjs` checks it.
- Two PR "gone" entries can come back in a different order (the helper walked a Python set). The goldens compare them sorted.

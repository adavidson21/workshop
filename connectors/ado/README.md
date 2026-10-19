# ADO connector

One Azure DevOps integration for every Workshop app. It replaces `apps/prioritizer/ado-helper/ado_helper.py` (removed in WS8) and gives eng-agents `/start` a way to fetch work items through the agent (WS9).

Read-only: every action has `write: false`. Node standard library only. It calls only the server URLs in its settings.

## Settings

`connectors.ado.config` in `~/.workshop/config.json`, edited in the Settings app (the form comes from `configSchema` in `index.mjs`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `connections[]` | required | One per server and collection: `name`, `serverUrl` (the part before the collection), `collection`, `project`, `patEnv`, `apiVersion` (`6.0`), `useSystemCa` (`true`), `verifyTls` (`true`). |
| `defaultConnection` | first one | Used when nothing else decides. |
| `syncConnection` | default | The connection for "my work items" (the helper's `base_url`). |
| `paths[]` | `[]` | `{path, connection, project}`: which connection a repo or folder uses. `*` matches any characters, `~` is your home folder, the longest match wins. |
| `types`, `closedStates`, `removedStates` | `Issue, Bug, User Story`; `Resolved, Closed, Done`; `Removed` | Same as the helper's `types`, `closed_states`, `removed_states`. |
| `prSources[]` | `[]` | `{connection, project, repos[]}`. Empty skips PRs. |
| `prTeams` | `[]` | Team names that count as yours. Empty means every team you are on. |
| `reports` | helper defaults | `workloadTypes`, `bugTypes`, `highPriorities` (strings, for example `"1"`), `escalationPriority`, `effortFields`, `maxItems`. |

**PATs** live only in environment variables. A connection names the variable (`patEnv`); the connector reads it through `ctx.env` and puts it only in the `Authorization` header. It never logs, returns or emits it, and error messages never include it.

**Company certificates.** With `useSystemCa` on (default), the connector trusts the certificates your operating system trusts, as Python did. This needs Node 22.15 or later (`tls.getCACertificates`). On an older Node, set `NODE_EXTRA_CA_CERTS` to your company's CA file instead.

**Proxies.** The connector does not use a proxy. `ado_helper.py` honored the system proxy settings. On-premises ADO servers are normally reached directly; if yours needs a proxy, say so in an issue.

## Actions

Call with `POST /api/connectors/ado/<action>` and `{"args": {...}}`, or `connectors.call('ado', action, args)` from the SDK.

| Action | Args | Result |
| --- | --- | --- |
| `sync` | `known` (work item IDs on the board), `knownPrs` (PR keys), `prs` (default `true`) | Same JSON as the helper's `POST /sync`: `{items, gone, syncedAt, prs?, prError?}`. |
| `sync.prs` | `knownPrs` | The helper's `prs` object: `{items, gone, notes}`. |
| `dataset` | `areas`, `people`, `days`, and `connection` (name) or `base` (collection URL, as the helper took it) | Same JSON as the helper's `POST /dataset`, plus `connection`. |
| `workitem.get` | `id`, optional `connection`, `path` (repo or folder), `details` | `{id, title, type, state, project, connection, reason, url}`. With `details: true` also `area`, `iteration`, `tags`, `description`, `acceptanceCriteria`, `reproSteps` (plain text) and `related`. `reason` says why that connection was picked, so callers can confirm before acting. |
| `connection.resolve` | `connection` or `path` | Which connection and project would be used, and whether its PAT variable is set. Calls nothing. |
| `config.import` | `helper` (parsed ado-helper.json), `engAgents` (parsed eng-agents config.json) | `{config, notes}`: settings merged with the current ones. Saves nothing; the Settings app shows them and saves with `PUT /api/connectors/ado/config`. |

The connection is picked in eng-agents order: `connection` by name, then a `paths` match for `path`, then `defaultConnection`, then the only connection. eng-agents also matched a repo's git remote; the connector does not run git, so map such repos in `paths`.

Errors are plain words with a code: `bad_request` (settings or arguments), `not_found` (no such work item), `unavailable` (ADO rejected the PAT, could not be reached, or answered with a sign-in page).

## Doctor

`workshop doctor ado` once WS7 adds the `workshop` command. Until then:

```
node connectors/ado/doctor.mjs                 # check each connection, list what a sync finds (the helper's --test)
node connectors/ado/doctor.mjs --import        # print settings built from ado-helper.json and eng-agents config.json
node connectors/ado/doctor.mjs --import --write  # save them into ~/.workshop/config.json (does not turn the connector on)
node connectors/ado/doctor.mjs --compare --areas "Project\Team" --people "a@example.com"
```

`--compare` runs `ado_helper.py` (with its own `ado-helper.json`) and the connector (with settings imported from that same file) against your ADO, then prints match and mismatch counts per section, with the names of fields that differ. It prints no titles, names, URLs or messages, and writes no files (Python runs with bytecode writing off). Use it at work to check parity before WS8 removes the helper. Options: `--helper <ado_helper.py>`, `--python <command>`, `--known <ids>`, `--days <n>`. Run `--help` for all.

## Tests

```
node --test "connectors/ado/test/*.test.mjs"
node connectors/ado/test/make-goldens.mjs      # after changing fixtures or the helper
```

- `test/fixtures/team.mjs`: synthetic data shaped like the public Azure DevOps REST API reference. No work data.
- `test/fake-ado.mjs`: a fake ADO server on 127.0.0.1 that serves the fixtures and records every request.
- `test/goldens/`: what `ado_helper.py` returns for each case, and the ADO calls it made. `golden.test.mjs` checks the connector returns the same JSON and makes the same calls, and (when Python 3 is installed) that the goldens still match the helper.
- `connector.test.mjs` runs the connector through the mock agent, including that a PAT never shows up in responses, logs or errors. `doctor.test.mjs` covers the doctor, including that `--compare` writes nothing and prints no data.

## Differences from the helper

- Several connections, each with its own PAT variable, instead of one URL and one PAT.
- `dataset` takes a connection name; `base` still works for any configured connection.
- Error messages point to Settings instead of `--setup`.
- Two PR "gone" entries can come back in a different order (the helper walked a Python set). The goldens compare them sorted.

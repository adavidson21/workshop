# Contract suite

These tests check an agent against [docs/agent-api.md](../../docs/agent-api.md) and the other contracts in `docs/`. They run against the mock agent in CI today. Once WS1 lands, CI also runs them against the real agent, and a red test blocks merge.

```
node --test "tests/contract/*.test.mjs"
```

Node 22, no dependencies.

## Running against another agent

Set `WORKSHOP_TARGET` to a module path (relative to the repo root) that exports:

```js
/**
 * Start one agent for a test file, listening on 127.0.0.1 on any free port.
 * @param {object} o
 * @param {string} o.home           an empty temp folder to use as WORKSHOP_HOME
 * @param {string} o.appsDir        load apps from here instead of apps/
 * @param {string} o.connectorsDir  load connectors from here instead of connectors/
 * @param {object} o.env            environment variables the connectors may read (instead of process.env)
 * @param {object} o.config         the starting config.json (docs/config.md)
 * @returns {Promise<{url: string, port: number, token: string, stop: () => Promise<void>}>}
 */
export async function start(o) {}
```

For example, WS1 adds `agent/test-target.mjs` and CI runs:

```
WORKSHOP_TARGET=agent/test-target.mjs node --test "tests/contract/*.test.mjs"
```

`tests/contract/targets/mock.mjs` is the target for the mock.

`startAgent` in `helpers.mjs` gives every agent a fresh temp folder with `home/` (passed as `home`) and `Workshop/` (passed as `config.dataDir`), so no test ever touches the real `~/Workshop`. A target must pass `config.dataDir` through to the agent. Tests read and write files in that data folder directly to check the layout and to make changes "outside Workshop".

## Contracts the real agent does not implement yet

A test of a contract that has merged in `docs/` but not yet in the agent passes `{ todo: pendingOnAgent('<workstream>') }`. It runs against every target; against the mock it must pass, and against any other target a failure is reported as to-do instead of failing CI. The workstream that implements the contract removes the marks.

No test is marked today.

## What is where

| File | Contract |
| --- | --- |
| `security.test.mjs` | Host and Origin checks, token, cookie, session, CORS, pairing, static paths |
| `apps.test.mjs` | `GET /api/apps`, app manifests, app files |
| `data.test.mjs` | Data endpoints, envelope checks, revisions, conflicts, limits |
| `folder.test.mjs` | The data folder: layout on disk, nested collection names, backups, damaged and ignored files, links that leave the folder, the one-time copy from `~/.workshop/data` |
| `files.test.mjs` | The files API: list, read, create, replace, conflicts, trash, extensions, size, path rules, collections kept out, hosted access |
| `events.test.mjs` | The event stream, including `file` events and changes made outside Workshop |
| `connectors.test.mjs` | Connector endpoints and the connector module contract, using `tests/fixtures/connectors/echo` |
| `config.test.mjs` | `GET` and `PUT /api/config`, including `dataDir` |
| `merge.test.mjs` | Change-stamp merge and stamp rules (`tests/lib/data-merge.mjs`) |
| `work-format.test.mjs` | `.work` regexes and next-step rules from `docs/work-format.md` |
| `service-worker.test.mjs` | Service worker rules. To-do until WS4 replaces `sw.js`. |

`tests/check-contracts.mjs` runs the static checks (schemas, examples, docs links, connectors and apps in the repo, no em dashes).

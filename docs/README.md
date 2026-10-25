# Workshop contracts

These documents define every interface between the parts of Workshop. Code is written against them, not the other way around. Each contract has a version, examples, and a test.

| Contract | Doc | Version | Schemas | Tested by |
| --- | --- | --- | --- | --- |
| Run modes and backends | [run-modes.md](run-modes.md) | 1 | none | `tests/contract/security.test.mjs` |
| Config file | [config.md](config.md) | `configVersion: 1` | `config`, `config-public`, `config-patch`, `config-put-response` | `tests/contract/config.test.mjs` |
| Agent HTTP API | [agent-api.md](agent-api.md) | `api: 1` | `health`, `session`, `error`, `apps-response`, `data-*`, `file-*`, `connector-*`, `event` | `tests/contract/*.test.mjs` |
| Connector module | [connector.md](connector.md) | `api: 1` | `config-form` | `tests/contract/connectors.test.mjs`, `tests/check-contracts.mjs` |
| App manifest | [app-manifest.md](app-manifest.md) | `manifestVersion: 1` | `app` | `tests/contract/apps.test.mjs`, `tests/check-contracts.mjs` |
| SDK | [sdk.md](sdk.md) | `sdk: 1` | `sdk-message` | `tests/check-contracts.mjs` (examples) |
| Data folder and data files | [data-format.md](data-format.md) | envelope `api: 1`, items per collection | `data-envelope`, `data-bundle`, `data-moved` | `tests/contract/data.test.mjs`, `tests/contract/folder.test.mjs`, `tests/contract/merge.test.mjs` |
| `.work` files | [work-format.md](work-format.md) | `work: 1` | none (regexes) | `tests/contract/work-format.test.mjs` |

## Layout

- `docs/*.md`: the contracts.
- `docs/schemas/<name>.schema.json`: JSON Schemas (draft 2020-12 subset, see below).
- `docs/examples/<name>.<case>.json`: valid examples. Each one must validate against `schemas/<name>.schema.json`.
- `docs/examples/invalid/<name>.<case>.json`: examples that must fail validation. They prove the schema constrains what the doc says it does.
- `docs/examples/work/`: a synthetic `.work` folder for [work-format.md](work-format.md).
- `tests/mock-agent.mjs`: a small agent that implements [agent-api.md](agent-api.md), keeping data in a data folder (a temporary one unless given `dataDir`).
- `tests/contract/`: the contract suite. It runs against the mock in CI, and against the real agent once WS1 lands.

## Schema subset

Schemas use these JSON Schema keywords only, so the validator in `tests/lib/schema.mjs` (no dependencies) can check them and WS1 can copy it: `$ref`, `$defs`, `type`, `properties`, `required`, `additionalProperties`, `patternProperties`, `propertyNames`, `items`, `enum`, `const`, `pattern`, `format` (`date-time`, `uri`), `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems`, `oneOf`, `anyOf`, `allOf`, `not`, `title`, `description`, `default`, `examples`, and keys starting with `x-workshop-`. Any other keyword makes the check fail.

Response schemas set `additionalProperties: false`, so an implementation cannot add a field without a docs change. Clients must still ignore fields they do not know, so a later minor change does not break them.

## Changing a contract

1. Open a separate PR that changes only `docs/` (and the mock and contract tests to match). Say why.
2. A change that breaks existing clients bumps that contract's version.
3. Workstream PRs never change `docs/`. A red contract test blocks merge.

## Run the checks

```
node tests/check-contracts.mjs
node --test "tests/contract/*.test.mjs"
```

To run the suite against another implementation, see [tests/contract/README.md](../tests/contract/README.md).

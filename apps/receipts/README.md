# Receipts

Performance evidence for you, your direct reports and your manager, turned into review-ready material. Log what happened as it happens; at review time, generate a summary grouped by rubric section, edit it, and export the entries. Starts from TaskLedger's ideas (entry fields, role categories, CSV rules, scores); none of its code.

V1 is manual entries and template summaries. No AI, no connectors and no network calls. V1.1 adds goals, metric collectors and entry suggestions; V2 adds AI summaries through a connector, off by default. Both plug into interfaces defined here, so neither needs an architecture change.

## Views

1. **Log** (default): person, kind, date (today), what happened. Rubric sections (up to 3, the first is primary) and the person's role categories are one-click chips; the other fields fold away under **More details**. **Save receipt** (or `Ctrl+Enter`) writes at once. `Ctrl+K`, **Log a receipt** opens it; `#/receipts/log/<person-id>` opens it for one person.
2. **Person**: a person's entries in a cycle, newest first, filtered by kind and rubric section, under a coverage strip that calls out empty sections.
3. **Needs review**: entries missing a rubric section or a review bullet, or marked for review, for everyone. Edit them in place.
4. **Team**: one row per active person for a cycle: entries, last entry, wins and concerns, rubric gaps, and a flag when nothing was logged for `nudgeDays` (14). Metric columns appear once collectors (V1.1) have written metrics.
5. **Review packet**: a person and a cycle. Generate or regenerate the template summary, edit it, preview it, copy it as text or Markdown, and export the cycle's entries as CSV or Excel. For your manager it works as upward-feedback prep.

The gear opens Receipts' settings: people, cycles, the nudge, the rubric (names and descriptions; ids stay) and the export columns. The eye blurs names, notes and summaries for screen sharing (this window only, until you turn it off).

All three run modes work. While the browser's folder store waits for Chrome to allow the Workshop folder again, Receipts shows no data, turns off adding and editing, points to the **Allow** bar, and loads once access is back (the same rule as Prioritizer).

Entry text is always escaped. Links are clickable only when they start with `http://` or `https://`; anything else is refused when you save it and shown as plain text if it reaches a file another way.

## Storage

Receipts reads and writes only through the SDK: `ws.data` for JSON collections and `ws.files` for Markdown summaries. It has no folder code of its own; merging, conflicts, trash, backups and the folder wait come from the platform ([docs/data-format.md](../../docs/data-format.md)).

```
<Workshop folder>/receipts/
  config.json                             people, rubric, roles, categories, cycles, settings
  entries/<person-id>/<yyyy>.json         one collection per person per year
  metrics/<person-id>/<yyyy-mm>.json      empty until V1.1
  goals/<person-id>/<yyyy>.json           V1.1
  summaries/<person-id>/<cycle-id>.md     the summary you read and edit (ws.files)
  summaries/<person-id>/<cycle-id>.json   its sidecar collection (ws.data)
  summaries/<person-id>/<cycle-id>-v2.md  and -v2.json, written beside an edited version 1
```

| Kind | Format | Written by | Overwritten? |
| --- | --- | --- | --- |
| Config | collection `config` | You, in Receipts' settings | Merged, never clobbered |
| Entries | collection per person per year | You. From V1.1, importers too, but only entries you accept. | Never by automation |
| Metrics | collection per person per month | Collectors (V1.1) | Yes, a refresh replaces the month |
| Summaries | Markdown file plus sidecar collection | The summarizer, then you | Never after you edit it; a new version is written beside it |
| Exports | CSV, Excel | Export buttons | Saved where your browser saves downloads |

Person ids are stable slugs made from the name when the person is added (`jordan-lee`); the display name lives in `config`, so renaming someone moves no files. You are always `me`. Cycle ids (`2026-h2`) name summary files.

Which entry years are loaded: every year a cycle touches, plus this year. An entry dated in a year no cycle covers is saved, and shows once a cycle covers it.

Saving follows the write loop in [docs/data-format.md](../../docs/data-format.md): each edit is stamped and put at once with the `rev` read; a conflict is merged item by item and put again. A failed write keeps the edit on screen, says **Not saved yet**, and retries every 5 seconds. Another window's save, or a change made outside Workshop, is read again and merged with edits not saved yet. A collection saved at a newer version is shown read only and never written. A damaged file is reported and never written over.

## Schemas (version 1)

JSON Schema files are in [schemas/](schemas/), checked against synthetic fixtures in `test/fixtures/`. Every collection is a Workshop data envelope; unknown fields on items and in `meta` are kept and written back.

### `receipts.config`

Items are people:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | name segment | Stable id, also the folder name. `me` for you. |
| `name` | string, 1 to 80 | Display name. |
| `relation` | `self`, `report`, `manager` | Exactly one `self`. |
| `role` | role id | From `meta.roles`; decides the categories offered. |
| `level` | string | Free text. |
| `active` | boolean | Inactive people are hidden from Log and Team. |

`meta`: `rubric` `[{id, name, description}]` (the default is Workshop's own, below), `roles` `[{id, name}]`, `categories` `{roleId: [name]}`, `cycles` `[{id, name, start, end, due}]` (dates `yyyy-mm-dd`), `nudgeDays` (14), `csvColumns` (export columns, in the standard order).

### `receipts.entries/<person>/<yyyy>`

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `r_...` |
| `date` | `yyyy-mm-dd` | When it happened. The year matches the collection. |
| `kind` | `win`, `growth`, `concern`, `feedback`, `note` | |
| `note` | string, to 4000 | What happened, in your words. |
| `rubric` | rubric ids, 0 to 3 | The first is primary. |
| `category` | string | One of the person's role categories (or an older one). |
| `bullet` | string, to 600 | A sentence you could paste into a review. |
| `impact` | 1 to 5, or null | |
| `effort` | `S`, `M`, `L`, or null | |
| `strategic` | boolean | Tied to a team or company goal. |
| `riskReduced` | 0 to 5, or null | |
| `visibility` | `Self`, `Team`, `Org`, `Company`, `Customer`, or null | |
| `collaborators` | strings | |
| `artifact` | string | PR, RFC, Design doc and so on. |
| `links` | http(s) URLs | |
| `metric`, `metricSource` | strings | Only numbers you know; nothing is estimated. |
| `tags` | strings | Lowercase. |
| `review` | boolean | Marked for review. |
| `source` | `manual` in V1 | Later `ado`, `prioritizer`, `agents`. |
| `sourceRef` | string | Lets importers skip what is already logged. |

### `receipts.metrics/<person>/<yyyy-mm>`

`meta` `{updatedAt, personId, month, collectedAt}`; items `{id: "<source>.<metric>", source, value, unit, detail[], collectedAt}`. Defined and tested in V1 though nothing writes it, so the summarizer and Team already read it: values are summed over a cycle's months and compared with the cycle before.

### `receipts.summaries/<person>/<cycle>` (summary sidecar)

One item, id `summary`: `{cycleId, generator, generatedAt, inputHash, outputHash, edited, file}`. `generator` is `template@1` (V2: `ai:<model>@<n>`). `outputHash` is the SHA-256 of the Markdown as generated; when the file no longer matches it, it was edited (in Receipts or anywhere else) and is never overwritten. `inputHash` tells the packet whether the entries changed since.

### Migrations

`js/model.js` has one pure step per version (`MIGRATIONS`, none yet: everything is version 1), run in order on read; the migrated envelope is written with the next normal put. A newer version than Receipts knows is read only.

## Interfaces

| Interface | V1 | Later |
| --- | --- | --- |
| **Summarizer** `summarize({person, cycle, entries, metrics, goals, previous, rubric, roles}) -> {markdown, generator}` | `js/summarize/template.js`: counts by kind, rubric coverage and gaps, metric trends when metrics exist, bullets grouped by primary section in rubric order. Same input, same Markdown. | V2: AI, same input and output, through a connector so no keys live in the page. Redaction runs on the input. |
| **Collector** `collect({person, month, config}) -> metrics envelope` | `js/collect/index.js`: the interface, `validMetrics`, `emptyMetrics`; `COLLECTORS` is empty. | V1.1: ADO, Prioritizer and Agents collectors, run while Receipts is open. |
| **Importer** `suggest({person, range}) -> entry drafts` | `js/import/index.js`: the interface and `newDrafts` (skips drafts already logged); `IMPORTERS` is empty. | V1.1: notable metric details become drafts you accept or dismiss. Never writes entries on its own. |

`rubric` and `roles` were added to the summarizer input so the template can name sections and roles without reading config itself.

## Default rubric

Workshop's own, generic, from no company's review form: **Results**, **Craft**, **Ownership**, **Collaboration**, **Communication**, **Leadership**, **Growth**. Roles: Engineer IC, Engineering Manager, Product IC, Product Manager, each with ten generic work categories. A test fails if TaskLedger's company rubric sections come back into the defaults (the test names them only by hash).

## Export

CSV follows TaskLedger's rules: UTF-8 with a BOM, CRLF line endings, RFC 4180 quoting. A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe so a spreadsheet does not run it as a formula (plain numbers are left alone). Excel uses the vendored SheetJS, with every cell as text. The two scores are opt-in columns: **LeverageScore** (impact times visibility weight) and **ReviewScore** (impact times 2, plus 2 if strategic, plus risk reduced, plus effort weight).

## Files

| File | What |
| --- | --- |
| `js/model.js` | Constants, default config, names, cycles, coverage, scores, entry cleanup, migrations. No DOM. |
| `js/store.js` | Reading and saving collections through `ws.data` with the write loop. No DOM. |
| `js/summary.js` | Summary files and sidecars: generate, versions, edits. |
| `js/summarize/template.js` | The template summarizer. |
| `js/collect/`, `js/import/` | Interfaces only. |
| `js/export.js` | CSV and Excel. |
| `js/view.js` | The page as HTML strings. No DOM. |
| `js/main.js` | SDK connection, loading, painting, clicks. |

## Tests

```
node --test "apps/receipts/test/*.test.mjs"
python tests/e2e.py
```

Node tests run against the SDK's real folder store on an in-memory folder, with synthetic fixtures only. The e2e part adds a person, logs three entries, generates, edits and regenerates a summary, exports CSV and finds the files in the data folder (with the agent), then checks the folder wait in browser mode.

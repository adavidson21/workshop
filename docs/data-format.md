# Data format

App data is stored as one JSON file per collection: `~/.workshop/data/<app>/<collection>.json` with the agent backend, or one IndexedDB record per collection with the browser backend ([run-modes.md](run-modes.md)). The same envelope is used on disk, over the API, in the browser, and in export bundles.

Envelope version: tied to the agent API (`api: 1`). Item shapes are versioned per collection with `version`.

## Envelope

Schema: [schemas/data-envelope.schema.json](schemas/data-envelope.schema.json). Example: [examples/data-envelope.tasks.json](examples/data-envelope.tasks.json).

```json
{
  "schema": "prioritizer.tasks",
  "version": 3,
  "rev": 14,
  "updatedAt": "2026-10-18T13:02:11.000Z",
  "items": [
    {"id": "t_k2f9", "updatedAt": 1792328400000, "title": "Draft Q4 plan", "value": 3, "effort": "M", "done": false},
    {"id": "t_p81a", "updatedAt": 1792242000000, "title": "Review onboarding doc", "value": 2, "effort": "S", "done": true}
  ],
  "deleted": {"t_old1": 1792155600000},
  "meta": {"updatedAt": 1792328400000, "capacity": 20}
}
```

| Field | Owner | Meaning |
| --- | --- | --- |
| `schema` | app | `<app>.<collection>`. Must match the path it is stored under. |
| `version` | app | Integer, 1 or more. The version of the item shape in this collection. See Migrations. |
| `rev` | backend | Integer revision. `0` means "not written yet". The backend adds 1 on every write. A writer sends the `rev` it read; a different stored `rev` is a conflict. |
| `updatedAt` | backend | ISO 8601 UTC time of the last write. Always present in what the backend returns; ignored on put. |
| `items` | app | Array of objects. Each has a unique string `id` (1 to 200 characters) and `updatedAt` (milliseconds since 1970, the change stamp). Everything else is the app's. |
| `deleted` | app | Optional. Tombstones: item `id` to the millisecond time it was deleted. |
| `meta` | app | Optional. Collection-level settings that are not items (for example Prioritizer's capacity). Has its own `updatedAt` stamp in milliseconds. |

No other top-level fields. Apps that need more state put it in `meta` or in another collection.

Size limit: 10 MB per collection. Collections that grow past that should be split (for example by year).

## Change stamps

Change stamps let two windows, or two copies of the data, merge instead of overwriting each other. They reuse the rules of Prioritizer's `stampChanges` (`prioritizer/js/state.js`).

### Stamping (before a write)

Given the envelope as last read (`before`) and the one about to be written (`after`), at time `now` in milliseconds:

1. An item in `after` that is new, or differs from its copy in `before` in any field other than `updatedAt`, gets `updatedAt = now`, and its tombstone (if any) is removed.
2. An item in `before` that is missing from `after` gets a tombstone: `deleted[id] = now`.
3. If `meta` differs (ignoring `updatedAt`), `meta.updatedAt = now`.
4. Tombstones older than 60 days are dropped.

"Differs" is deep equality with object keys compared regardless of order.

### Merging (after a conflict, or on import)

Given `local` and `remote` envelopes with the same `schema` and `version`:

1. Tombstones: for each id, keep the larger time from either side.
2. Items: for each id on either side, take the copy with the larger `updatedAt`. On a tie, take `remote`.
3. Drop the item if its tombstone time is greater than or equal to its `updatedAt`. If the item is newer than the tombstone, keep the item and remove the tombstone.
4. `meta`: the copy with the larger `meta.updatedAt`, `remote`'s on a tie. If only one side has `meta`, use that one.
5. Order: `remote`'s items in `remote`'s order, then items only in `local`, in `local`'s order. Apps sort for display themselves.
6. `schema`, `version`, `rev` and `updatedAt` come from `remote`, so the merged envelope can be put straight back.

Merge never prunes tombstones. Merging envelopes with different `schema` or `version` is an error: migrate first.

The reference implementation is `tests/lib/data-merge.mjs`, tested against the `examples/data-merge-case.*.json` and `examples/data-stamp-case.*.json` files. The SDK's `data.merge` and `data.stamp` must give the same results.

### Write loop

```
read  -> envelope (rev n)
edit  -> stamp(read, edited)
put   -> ok (rev n+1)                                  done
      -> conflict: merge(edited, err.current), put again with current.rev
```

## Migrations

`version` belongs to the app that owns the collection. Rules:

1. **When to bump.** Bump `version` by 1 for any change an older reader would misread: renaming or removing a field, changing a field's type or meaning. Adding an optional field that older readers can ignore does not need a bump.
2. **Keep what you do not know.** Every reader keeps fields it does not recognize, on items and in `meta`, and writes them back unchanged. This is what makes rule 1's "optional field" case safe.
3. **Migrations live in the app.** One pure, idempotent function per step, `v1 -> v2`, `v2 -> v3`, run in order on read. The migrated envelope is written back with the next normal put (same `rev` check, so it is safe with other windows open).
4. **Newer than you know: read only.** An app that reads a `version` higher than it supports must not write that collection. It shows the data if it can and tells the user to update Workshop.
5. **The backend never changes items.** It only checks the envelope. It refuses a put that lowers `version` (`400 downgrade`). Before the first write at a higher `version`, the agent copies the old file to `<collection>.v<old version>.json` and keeps it, so a bad migration can be undone by hand.
6. **Other readers check too.** An app reading another app's collection checks `schema` and `version` and treats an unknown version as unreadable, not as empty.
7. **Imports migrate first.** Bundles are migrated to the current version before merging.
8. **Every step has a test** in the owning app: a fixture at the old version and the expected result at the new one.
9. **Envelope changes** (new top-level fields, changed meaning) bump the agent `api` version. The agent then upgrades files on start, keeping a copy of each original in `data/_backup/<date>/`.

## Bundles

Export and import, including moving data between the browser and agent backends and the one-time import from the github.io site (WS5). Schema: [schemas/data-bundle.schema.json](schemas/data-bundle.schema.json). Example: [examples/data-bundle.export.json](examples/data-bundle.export.json).

```json
{
  "schema": "workshop.bundle",
  "version": 1,
  "exportedAt": "2026-10-18T14:00:00.000Z",
  "source": {"mode": "browser", "backend": "browser"},
  "collections": [
    {"app": "prioritizer", "collection": "tasks", "envelope": {"schema": "prioritizer.tasks", "version": 3, "rev": 14, "updatedAt": "2026-10-18T13:02:11.000Z", "items": []}}
  ]
}
```

Import: for each collection, migrate if needed, then create it (if missing) or merge it with what is stored and put. Bundle files are named `workshop-<yyyy-mm-dd>.json`.

## Disk rules (agent backend)

- One file per collection: `data/<app>/<collection>.json`, UTF-8, pretty-printed with 2 spaces.
- Atomic writes: write `<collection>.json.tmp` in the same folder, flush, then rename over the old file. A failed write never loses the previous file.
- On start, a leftover `.tmp` file is deleted and the main file is used.
- Files the agent cannot parse are left untouched and reported (in the log and as `500 internal` on read); the agent never overwrites them.

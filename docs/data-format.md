# Data format

App data lives in one folder the user owns, the data folder (`dataDir` in [config.md](config.md), default `~/Workshop`). Each collection is one JSON file, `<dataDir>/<app>/<collection>.json`, written by the agent or, without the agent, by the browser's folder backend ([run-modes.md](run-modes.md)). Until a browser has been given a folder, its collections are IndexedDB records instead. The same envelope is used on disk, over the API, in the browser, and in export bundles.

Apps can also keep plain files that are not envelopes (for example a Markdown summary) in the same folder, through the files API ([agent-api.md](agent-api.md), Files). See Data folder below.

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
| `schema` | app | `<app>.<collection>`, with the full collection name, nested segments included (for example `receipts.entries/jordan-lee/y2026`). Must match the path it is stored under. |
| `version` | app | Integer, 1 or more. The version of the item shape in this collection. See Migrations. |
| `rev` | backend | Integer revision. `0` means "not written yet". The backend adds 1 on every write. A writer sends the `rev` it read; a different stored `rev` is a conflict. |
| `updatedAt` | backend | ISO 8601 UTC time of the last write. Always present in what the backend returns; ignored on put. |
| `items` | app | Array of objects. Each has a unique string `id` (1 to 200 characters) and `updatedAt` (milliseconds since 1970, the change stamp). Everything else is the app's. |
| `deleted` | app | Optional. Tombstones: item `id` to the millisecond time it was deleted. |
| `meta` | app | Optional. Collection-level settings that are not items (for example Prioritizer's capacity). Has its own `updatedAt` stamp in milliseconds. |

No other top-level fields. Apps that need more state put it in `meta` or in another collection.

Size limit: 10 MB per collection. Collections that grow past that should be split (for example by year, with a nested name like `entries/jordan-lee/y2026`).

## Names

- An app id is a name: `^[a-z][a-z0-9-]{0,39}$`.
- A collection name is 1 to 4 segments separated by `/`, each a name (`^[a-z][a-z0-9-]{0,39}$`). Each `/` is a subfolder: `entries/jordan-lee/y2026` is stored at `<dataDir>/<app>/entries/jordan-lee/y2026.json`. Segments start with a letter, so a year is written `y2026`, not `2026`.
- A file path (files API) follows the same rules, and its last segment ends in `.md` or `.json`: `summaries/jordan-lee/h2-2026.md`.
- Names are lowercase, so the same name means the same file on case-insensitive disks (Windows, macOS).
- A collection named `a/b` and a folder `a/b/` holding more collections can exist side by side (`a/b.json` and `a/b/c.json`).

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
5. **The backend never changes items.** It only checks the envelope. It refuses a put that lowers `version` (`400 downgrade`). Before the first write at a higher `version`, the backend copies the old file to `<dataDir>/.backups/<yyyy-mm-dd>/<app>/<collection>.v<old version>.json` (UTC date of the write; nested names keep their subfolders) and keeps it, so a bad migration can be undone by hand. If that copy already exists, it is not overwritten. Copies are never put next to the collection, so they never show up as collections or files.
6. **Other readers check too.** An app reading another app's collection checks `schema` and `version` and treats an unknown version as unreadable, not as empty.
7. **Imports migrate first.** Bundles are migrated to the current version before merging.
8. **Every step has a test** in the owning app: a fixture at the old version and the expected result at the new one.
9. **Envelope changes** (new top-level fields, changed meaning) bump the agent `api` version. The agent then upgrades files on start, keeping a copy of each original at `<dataDir>/.backups/<yyyy-mm-dd>/<app>/<collection>.json`.

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

Bundles carry collections only. Files written through the files API are not in bundles; with a data folder, copy the folder instead.

## Data folder

### Layout

```
<dataDir>/
  <app>/<collection>.json                  one collection (nested names are subfolders)
  <app>/<path>.md, <app>/<path>.json       plain files written through the files API
  .trash/<app>/<path>.<stamp>.<ext>        files moved to the trash
  .backups/<yyyy-mm-dd>/<app>/...          copies kept before a version or envelope upgrade
```

For example:

```
~/Workshop/
  prioritizer/tasks.json
  receipts/config.json
  receipts/entries/jordan-lee/y2026.json
  receipts/summaries/jordan-lee/h2-2026.md
  receipts/summaries/jordan-lee/h2-2026.json
  .trash/receipts/summaries/jordan-lee/h1-2026.20261025T140500123Z.md
  .backups/2026-10-25/prioritizer/tasks.v2.json
```

### What is a collection, what is a file

- A `.json` file is a **collection** when it parses as a JSON object whose `schema` field is `<app>.<collection>` for its own path. Collections are read and written only through the data API (`/api/data`, `ws.data`), which checks `rev`. A collection file that fails the envelope schema is a damaged collection (below), still not a file.
- Every other `.md` or `.json` file is a **file**, read and written only through the files API (`/api/files`, `ws.files`), which checks the modified time. The files API never reads, writes, lists or trashes a collection, and refuses to write `.json` content that would make one (an envelope for its own path).
- So a collection and a file can never be the same file, even though both end in `.json`. Receipts' summary `h2-2026.md` (a file) and its sidecar `h2-2026.json` (a collection) sit side by side.

### What Workshop ignores

Workshop only sees paths that follow the name rules above, under an app folder. It ignores, and never changes or deletes:

- any file or folder whose name starts with `.` (other than its own `.trash` and `.backups`, which only it writes to), for example `.git`, `.obsidian`, `.DS_Store`;
- names that break the rules (`Notes.md`, `my notes.md`, `2026.json`), files with other extensions, and anything deeper than 4 segments;
- files at the top of the data folder (`<dataDir>/readme.md`);
- leftover `*.tmp` files (see Disk rules).

### Trash

Deleting a file through the files API moves it to `<dataDir>/.trash/<app>/<path without extension>.<stamp>.<ext>`, where `<stamp>` is the UTC time of the delete as `yyyymmddThhmmssSSSZ` (for example `20261025T140500123Z`). If that name is taken, `-1`, `-2` and so on are added after the stamp. Workshop never empties the trash and never removes a file. The user deletes trash by hand.

### Backups

`<dataDir>/.backups/<yyyy-mm-dd>/` holds copies the backend makes before it changes a file's format: the old version of a collection before its first write at a higher `version` (Migrations, rule 5), and the original of each file before an envelope upgrade (rule 9). Workshop never removes backups. This replaces `~/.workshop/data/_backup/` and the `<collection>.v<n>.json` copies that used to sit next to the collection.

### Changes made outside Workshop

The data folder is the user's, so other programs may change it: an editor, a script, a sync tool, a restore from backup.

- **The disk is the truth.** The backend reads the file for every request. It never answers from a copy older than the file.
- **The agent watches the folder** and sends `data` events (for collections) and `file` events (for files) with `client: null` when something outside Workshop changes, adds or removes one. The event means "re-read": it does not carry the new contents, and for collections `rev` and `updatedAt` are `null`. See [agent-api.md](agent-api.md), `GET /api/events`. Apps re-read and merge exactly as they do for another window's write.
- **Hand edits keep `rev`.** A program that changes a collection file without raising `rev` is not caught by the `rev` check: a writer that read the old file can still put over it. The change event above narrows that window (open windows re-read and merge as soon as the change is seen), and merge keeps every item the hand edit changed unless the writer changed the same item. To be safe, edit collection files by hand only while Workshop is closed, or raise `rev` by 1 when you save.
- **Damaged files are never written over.** At a collection's path, a file that does not parse, whose `schema` does not match its path, or that fails the envelope schema is left untouched and reported (in the log, and as `500 internal` on read and on put through the data API). It is not listed as a collection. A `.json` file that does not parse, or whose `schema` names something else, is a plain file to the files API; one with the right `schema` stays a collection to it, damaged or not.

### Moving from `~/.workshop/data`

Before the data folder, the agent kept app data in `~/.workshop/data/<app>/<collection>.json`. On start, the agent copies it in once:

1. It copies only if all of these hold: `~/.workshop/data/moved.json` does not exist; `~/.workshop/data/` holds at least one collection file `<app>/<collection>.json` (app folders only; `_connectors`, `_backup` and other names starting with `_` or `.` are skipped); and the data folder holds no app data (no `.json` or `.md` file under any app folder).
2. It copies each collection file byte for byte to `<dataDir>/<app>/<collection>.json`, with the same `rev`. Version copies (`<collection>.v<n>.json`) and `_backup/` are not copied; they stay where they are.
3. It writes `~/.workshop/data/moved.json` ([schemas/data-moved.schema.json](schemas/data-moved.schema.json), example [examples/data-moved.ok.json](examples/data-moved.ok.json)) and logs one line saying how many collections it copied, from where and to where.
4. It never deletes or changes the old files. They stay as a backup.

Because of `moved.json`, the copy runs once per Workshop home. Pointing `dataDir` at a new, empty folder later does not bring back the old data.

## Disk rules

These apply to every backend that writes the data folder (the agent, and the browser's folder backend, see [run-modes.md](run-modes.md)).

- One file per collection: `<dataDir>/<app>/<collection>.json`, UTF-8, pretty-printed with 2 spaces and a final newline. Folders for nested names are created as needed. Empty folders are left alone.
- Atomic writes: write `<name>.tmp` in the same folder, flush, then rename over the old file. A failed write never loses the previous file. (The folder backend gets the same effect from the File System Access API, which writes to a temporary file and moves it into place on `close()`.)
- On start, the agent deletes leftover `.tmp` files it finds next to collections and files, and uses the main file.
- Files the backend cannot parse are left untouched and reported (in the log and as `500 internal` on read); the backend never overwrites them.
- Paths never leave the data folder. A request whose path, after following symbolic links and junctions, is outside the data folder is refused with `400 bad_request`. The data folder itself may be a link (for example to another drive); paths are checked against where it really is.

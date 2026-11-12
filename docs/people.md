# People directory

Everyone you assign work to, wait on or meet with, kept once and used by every app: you, your direct reports, your manager, peers, contacts outside your team (another team's lead, a vendor), and groups of them (`@leadership`). Apps keep references to people and groups as ids and never copy names, so renaming someone, or changing who is in a group, shows up everywhere at once.

Version: the `settings.people` collection is version 2.

## The collection

Settings' collection `people`, schema `settings.people`, stored at `<dataDir>/settings/people.json` in the usual envelope ([data-format.md](data-format.md)). Items are people and groups.

Apps never read or write this collection with `ws.data`. They use `ws.people` ([sdk.md](sdk.md), People), which parses it with `shared/people.js`, checks every change against the rules below and writes it. Every app uses that one module, so every app matches handles and expands groups the same way.

### People

Schema: [schemas/person.schema.json](schemas/person.schema.json). Example: [examples/person.report.json](examples/person.report.json).

```json
{
  "id": "p_lq3k9a1b2c",
  "kind": "person",
  "updatedAt": 1793736000000,
  "name": "Person One",
  "handle": "person",
  "relation": "report",
  "team": true,
  "adoIdentity": "person.one@example.com",
  "role": "Senior Engineer",
  "archived": false
}
```

| Field | Meaning |
| --- | --- |
| `id` | `p_` and then letters, digits, `_` or `-`. Stable forever. |
| `kind` | `person`. |
| `name` | Display name. |
| `handle` | What you type after `@`: lower-case letters, digits, `.`, `_` or `-`, up to 40, starting with a letter or digit. Unique among active people and groups. A new person gets their first name, else their full name joined by `-`, else that with a number. |
| `relation` | `self`, `report`, `manager`, `peer` or `contact`. At most one active `self` and one active `manager`. `contact` is anyone who is not a working relationship: someone on another team, a vendor, someone you wait on. |
| `team` | Optional. On your team, for team views. Missing means `true` for `self` and `report`, `false` otherwise. |
| `adoIdentity` | Optional. Email or exact Azure DevOps display name, compared without case. |
| `role` | Optional. Job title. |
| `owns` | Optional. What they own: products, repos or area paths, as written (up to 30, each up to 200 characters, no repeats). Slate matches it against what a request touches to suggest who to delegate to; Settings' Products page and Folio's product notes list a product's owners from it ([products.md](products.md)). Facts only: never a rating. |
| `since` | Optional, no longer edited. `YYYY-MM-DD`; older directories may have it. Apps keep it as they keep any field and do not show it. |
| `archived` | Optional. Left. Kept so old records still show a name; hidden from pickers, team views and `@` matching. Its handle is free again. |

### Groups

Schema: [schemas/person-group.schema.json](schemas/person-group.schema.json). Example: [examples/person-group.leadership.json](examples/person-group.leadership.json).

```json
{
  "id": "g_lq3k9a1b2d",
  "kind": "group",
  "updatedAt": 1793736000000,
  "name": "Leadership",
  "handle": "leadership",
  "members": ["p_lq3k9a1b2c", "p_lq3k9a1b2e"],
  "archived": false
}
```

| Field | Meaning |
| --- | --- |
| `id` | `g_` and then letters, digits, `_` or `-`. Stable forever. |
| `kind` | `group`. |
| `name`, `handle`, `archived` | As for people. |
| `members` | Person ids, up to 200, no duplicates. Groups do not contain groups. A group may be empty (another team whose people you do not track). |

`meta` is not used.

## Rules

1. **Change it only through `ws.people`.** Any app may add, edit, archive and restore people and groups (Docket adds a contact when you type a new `@name`; Settings' People & teams pages are the full editor and import spreadsheets). The SDK applies the same checks for every app and merges concurrent changes item by item.
2. **Reference by id.** Apps store `p_` and `g_` ids, never names or handles. They show names with `label()` and mentions with `mention()` from the directory object, at render time.
3. **Archive, never delete.** No app deletes an item. A tombstone (from a hand edit or an old copy) means it is gone: records pointing to it show "Unknown", never an error.
4. **Someone is involved through their groups.** When an app asks "what involves John", it matches John's id and the ids of the active groups he is in (`reach()` and `involves()`). An archived group, or an archived member, does not count.
5. **`@` matching.** `find()` takes a handle (with or without `@`), then an exact name without case, then a first name only one active person has. Anything else matches nothing; apps then offer to add a contact.
6. **Same data folder only.** The directory is whatever the app's backend holds at `settings/people`: shared by every app in Workshop and every site using the same folder. An app on its own site with browser storage has its own directory in that store, which it can add to with `ws.people` like anywhere else.
7. **Version 1 is upgraded; any other unknown version is read only.** Version 1 (people only, no handles, written by Settings before groups and before People was its own app) reads as version 2 with `upgrade()`: every item becomes a person and gets a handle no active person before it has. The first `ws.people` read saves it as version 2, so older readers read it too. A directory of any other version reads as empty with `unreadable: true`, and `ws.people` refuses to change it (code `unsupported`). Apps say so instead of acting as if no one is there.
8. **Escape names.** Names and handles are user text; apps escape them before putting them on a page.

## Who uses it

| App | Uses |
| --- | --- |
| `settings` (Settings, People & teams) | Edits everyone: people, groups and their members. Downloads a spreadsheet template (or the current list) and imports a filled-in one with `ws.people.saveMany`, after a preview. Also edits your team's area paths ([teams.md](teams.md)). |
| `prioritizer` (Docket) | Tasks reference people and groups (`who`). `@handle` in Quick add; a new name becomes a contact. The People view and filters count group membership. Reports' team profile reads `team`. |
| `receipts` (Rapport) | Reports are `report` people; Upward is the `manager`. Entries' `about` is `me`, `up` or a person id. 1:1s are keyed by person id. |
| `slate` (Slate) | Delegate picks a person; owners (`owns`) of what the item touches come first. Requesters are matched to people by name. What is delegated to each person is in Slate's summary (`delegated`), for Rapport's 1:1 prep. |
| `runway` (Runway) | Roadmap items' owners (`who`), set in the panel or with `who: @handle` in the outline; a new name becomes a contact. The owner filter counts group membership. |
| Home, the Dispatch hub | Names for capture and routing (`find()`); Docket's `people` summary for counts. |

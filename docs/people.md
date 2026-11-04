# People directory

One list of the real people you work with: you, your direct reports, your manager and peers. Settings owns it and edits it; every other app reads it, so adding someone to your team is done once.

Version: the `settings.people` collection is version 1.

Not in the directory: contacts that are not working relationships, such as another team, a vendor or someone you are waiting on once. Apps keep those in their own data (Docket's people, for example) and may link one to a directory person by id.

## The collection

Settings keeps one collection named `people`, so its schema is `settings.people`, stored at `<dataDir>/settings/people.json` in the usual envelope ([data-format.md](data-format.md)). Each item is one person. Schema: [schemas/person.schema.json](schemas/person.schema.json). Example: [examples/person.report.json](examples/person.report.json).

```json
{
  "id": "p_lq3k9a1b2c",
  "updatedAt": 1793736000000,
  "name": "Person One",
  "relation": "report",
  "team": true,
  "adoIdentity": "person.one@example.com",
  "role": "Senior Engineer",
  "since": "2025-03-01",
  "archived": false
}
```

| Field | Meaning |
| --- | --- |
| `id` | `p_` and then letters, digits, `_` or `-`. Stable forever: renaming a person never changes it, so apps key their own data by it. |
| `name` | Display name. |
| `relation` | `self`, `report`, `manager` or `peer`. Settings allows at most one active `self` and one active `manager`. |
| `team` | Optional. On your team, for team views (Queue's Team view, Docket's Reports). When missing, readers treat it as `true` for `self` and `report` and `false` otherwise. |
| `adoIdentity` | Optional. Email or exact Azure DevOps display name, compared without case. |
| `role` | Optional. Job title. |
| `since` | Optional. `YYYY-MM-DD`, when they joined the team or started reporting to you. Empty string means unknown. |
| `archived` | Optional. Left the team. The item is kept so old records still show a name; readers hide archived people from pickers and team views. |

`meta` is not used in version 1.

## Rules

1. **Only Settings writes it.** Other apps read with `ws.data.get('people', {app: 'settings'})` and `ws.data.subscribe('people', handler, {app: 'settings'})` ([sdk.md](sdk.md), Data).
2. **People are archived, not deleted.** Settings' UI only archives. A tombstone (from a hand edit or an old copy) means the person is gone: readers show records that point to that id as an unknown person, never as an error.
3. **Read like any other app's data.** Check `schema` and `version`; an unknown version is unreadable, not empty ([data-format.md](data-format.md), Migrations). Ignore fields you do not know.
4. **Missing means not set up.** When the collection does not exist (`null`), an app may fall back to its own list, as it worked before the directory. Once the collection exists, even with no items, the directory is the list: apps stop reading their own and never delete it.
5. **Same data folder only.** Like [handoffs](handoffs.md), the directory is visible wherever an app shares Settings' backend, such as inside Workshop or a site using the same folder. An app on its own site with browser storage sees no directory and uses its fallback.
6. **Escape names.** Names are user text; apps escape them before putting them on a page.

## Readers

| App | Uses | Fallback while missing |
| --- | --- | --- |
| `receipts` | `report` people for Reports, the `manager` for Upward. Receipts entries keep `about: 'me'` and `about: 'up'`; other `about` values are directory ids. | Its own `people` collection |
| `queue` | People with `team` and an `adoIdentity` for the Team view and assign pickers. | `queue.settings` `meta.people` |
| `oneonones` (1:1s) | People you have 1:1s with: name and the Docket, Receipts and Queue links. | Its own `people` collection |
| `prioritizer` (Docket) | Names as suggestions for its own people; a Docket person may store `personId`. Reports can fill its team profile from people with `team`. | None needed |

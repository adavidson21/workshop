# Handoffs

A handoff is one app offering an item to another app, which the person then accepts or dismisses there. Example: Docket's Wrap up offers today's finished tasks to Rapport (app id `receipts`, formerly Receipts) as possible receipts.

A handoff can also carry something the person already accepted where they typed it (an **accepted** offer). Example: a capture from Home's quick capture or the Dispatch hub ([hub.md](hub.md)). The receiver adds it the next time it loads, without asking again.

Apps can read each other's collections but never write them ([sdk.md](sdk.md), Data). Handoffs keep that rule: the sender writes to its own collection, and the receiver reads it and keeps its own record of what it handled.

Version: `handoffs` collections are version 1.

## The collection

The sender keeps one collection named `handoffs`, so its schema is `<sender app id>.handoffs` (for example `prioritizer.handoffs`), in the usual envelope ([data-format.md](data-format.md)). Each item is one offer. Schema: [schemas/handoff-item.schema.json](schemas/handoff-item.schema.json). Example: [examples/handoff-item.receipt.json](examples/handoff-item.receipt.json).

```json
{
  "id": "h_t_k2f9_2026-11-03",
  "updatedAt": 1793736000000,
  "to": "receipts",
  "date": "2026-11-03",
  "createdAt": "2026-11-03T21:40:00.000Z",
  "text": "Shipped the onboarding guide for the new pipeline",
  "payload": {"kind": "win", "impact": 2},
  "source": {"app": "prioritizer", "id": "t_k2f9"}
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique in the collection. A sender that offers the same thing again reuses the id, so the receiver never sees it twice. |
| `to` | The receiving app's id. Receivers ignore items addressed to other apps. |
| `date` | The day the item is about (`YYYY-MM-DD`). |
| `createdAt` | When it was offered (ISO time). |
| `text` | What the person would see and edit, up to 2000 characters. |
| `payload` | Optional. Extra fields in a shape the receiver documents (see Receivers below). Receivers ignore fields they do not know. |
| `source` | Where it came from: the sender's app id and, optionally, the id of its own record. |
| `accepted` | Optional. `true` when the person already accepted this item in the sender's own screen, by a click or Enter on that item (rule 4). Missing or `false` means an ordinary offer. |

## Rules

1. **The sender owns the offer.** It may change `text` or `payload` until the receiver handles it, and may delete old offers (a tombstone, as usual). Senders keep at most 60 days of offers.
2. **The receiver owns the decision.** It records each handled id (accepted or dismissed) in its own data, and never writes the sender's collection.
3. **Read like any other app's data.** Check `schema` and `version`; an unknown version is unreadable, not empty ([data-format.md](data-format.md), Migrations). A missing collection means no offers.
4. **Nothing happens without the person.** A receiver shows offers and waits for a click. It never accepts them on its own. The one exception is an offer with `accepted: true`: the person accepted it in the sender, so a receiver that lists the offer's `payload.kind` as accepted-ready (Receivers below) adds it when it next loads and records it as handled, like an accept. A sender sets `accepted` only from the person's own click or Enter on that item, never on its own. A receiver that does not handle accepted offers for that kind shows it as an ordinary offer.
5. **Same data folder only.** Handoffs work where both apps share a backend, such as inside Workshop. An app on its own site with browser storage simply sees no offers.
6. **Undo before pickup only.** Until the receiver handles an accepted offer, the sender may withdraw it (a tombstone, rule 1). After that the record belongs to the receiver; the person changes or removes it there.

## Receivers

| Receiver | Accepts from | `payload` |
| --- | --- | --- |
| `receipts` (Rapport) | any app; accepted-ready for every kind | `kind`: `win`, `feedback`, `growth`, `concern` or `note` (default `win`); `impact`: 0 to 3 (default 0); `about`: `me` (default), `up` or a person id from the people directory ([people.md](people.md)); an id that is not a report or the manager is treated as `me`. The receipt's date is the offer's `date`, its text the offer's `text`. |
| `prioritizer` (Docket) | any app; accepted-ready for `task` | `kind`: `task`. Adds a task like Docket's Quick add: `title` (1 to 300 characters; the offer's `text` is the fallback), optional `list` (a list name, matched without case; otherwise Docket's default list), `who` (people and group ids from the directory, up to 10; ids the directory does not have are dropped), `waiting` (`true` for "waiting on"), `due` (`YYYY-MM-DD`), `urgent` (`true`), `value` (1 to 4), `effort` (`XS` to `XL`), `notes`. Text is never parsed as Quick add syntax. |
| `prioritizer` (Docket) | any app | `kind`: `every-sprint`. `title` (1 to 300 characters; the offer's `text` is the fallback), `dueDay` (1 to 60) or `last: true`, optional `planKind` (a Day view block kind), `value` (1 to 4), `effort` (`XS` to `XL`), `notes`. Accepting adds an every-sprint task in the Day view's settings. An offer whose `source.id` matches one already accepted updates that item instead of adding another. `date` is the day it was offered. |
| `notes` | any app; accepted-ready for `note` | `kind`: `note`. From `home`: adds the offer's `text` as a bullet in the pinned Quick Notes note (`quick-notes.md`), newest first under a `## YYYY-MM-DD` heading for the offer's `date`. From any other app: adds a note in Notes' `inbox/` folder, `title` (1 to 120 characters; the first line of the offer's `text` is the fallback) and the offer's `text` as its body. With `folder` (one of the folders in Notes' `targets` card), from any sender: a new note in that folder instead; a folder that is gone by then falls back as above. With `daily` (`YYYY-MM-DD`), from any sender: goes into that day's note (`daily/<day>.md`, made from the daily template if needed) instead. Then `section` (a heading, up to 60 characters) with `lines` (up to 20 strings) writes a `## <section>` of bullets, which a later offer with the same `section` replaces only while it is unchanged (otherwise Notes adds `## <section> (2)`); without them, the offer's `text` goes under the note's `## Notes` heading. |
| `runway` (Runway) | `home`, `agents`, `slate`; accepted-ready for `idea` | `kind`: `idea`. A feature, bug or other thought for a roadmap; the offer's `text` is the idea (first line its title, the rest its description). Optional `map`: a roadmap id from Runway's `index` (and `mapTitle`, its name, for display); the idea becomes an unscheduled item in that roadmap. Without one, or with a roadmap Runway does not have, it waits on Runway's Pending assignment list until it is assigned. |
| `slate` (Slate) | `agents`; accepted-ready for `work` | `kind`: `work`. A run the person started in Dispatch (Start work, or Start work from this in Research), so Slate's board tracks it from start to resolved. `title` (1 to 300 characters; the offer's `text` is the fallback), `lane` (`feature` or `bug`), `folder` (the run's `.work` folder, for local work) and/or `ado` (the ADO work item id, for an ADO start, whose folder does not exist yet), optional `id` (the run's local id, like `L3`), `description`, `project` (a Dispatch project id) and `from` (the Research folder it started from). Slate links it to the card with the same `folder` or `ado`, moving that card to Building, or adds a card in Building. An offer with neither `folder` nor `ado` is ignored. Slate records handled offers by sender and id in its items' `meta.handled`. |
| `slate` (Slate) | `home`, `agents`; accepted-ready for `request` | `kind`: `request`. A request captured with `s <text>`, `s #<id> <note>` or a line starting with `#<id>` ([hub.md](hub.md), Captures). Optional `ado` (an ADO work item id, 1 to 10 digits) and `note` (up to 4000 characters; the offer's `text` is the fallback for a request with no `ado`). With `ado`: the card with that ADO item gets the note (added to its description) and a history line; with no such card, a card in New linked to the item, its title filled from ADO when Slate next reads it. Without `ado`: a request card in New, titled from the first line of the text. Slate records handled offers in `meta.handled`, as for `work`. |
| `slate` (Slate) | `runway`, read when Runway opens Slate at `runway/<map>/<item>` | `kind`: `roadmap-item`. A roadmap item the person sent with Runway's **Work item** button (Runway 1.14.0). `map` and `item` (the roadmap and item ids), `title` (1 to 300 characters; the offer's `text` is the fallback), `notes` (up to 4000 characters), `level` (`epic`, `feature` or `story`, from the item's nesting), optional `ado` (`{id, rev, type, url, connection, state}`, the item's ADO link). Runway then opens Slate at `runway/<map>/<item>`; Slate opens the card it already has for that roadmap item, or makes one from the offer. Slate never reads Runway's roadmaps, and does not pick these offers up on its own. |

## Senders

A receiver finds its senders from the manifests: every app whose `handoffs.sends` lists the receiver's id ([app-manifest.md](app-manifest.md), `ws.apps.list()` in [sdk.md](sdk.md)). A receiver may add retired senders it still reads (Rapport reads `oneonones`). Outside Workshop's site there is no app list and no shared data folder, so there are no offers (rule 5).

| Sender | Offers |
| --- | --- |
| `prioritizer` (Docket) | Receipts from Wrap up, and the day's wrap-up to Notes: an accepted `note` with `daily`, `section: 'Wrap-up'` and `lines` (done, left off, tomorrow, the day's counts), id `w_<day>_<time>`, `source.id` `wrap`. A later wrap-up the same day replaces the offer. |
| `oneonones` (1:1s, retired) | Wins to Receipts. 1:1s is part of Rapport since 2.0.0 and writes no offers; Rapport still reads offers left in `oneonones.handoffs` until they are handled. |
| `home` | Accepted captures from quick capture ([hub.md](hub.md)) to Docket, Receipts, Notes, Runway and Slate (`request`). |
| `agents` (Dispatch) | Accepted captures from the hub ([hub.md](hub.md)) to Docket, Receipts, Notes, Runway and Slate (`request`). Accepted `work` to Slate from the Start click (Start work's Describe it and ADO work item, not Investigate), id `h_work_<folder>` or `h_work_ado-<id>`, `source.id` the folder or `ado-<id>`. |
| `notes` (Notes) | From a note's side panel, one click per line: an open `- [ ]` action item as an accepted `task` to Docket (`who`: the line's `@people`), a line tagged `#win`, `#feedback`, `#growth` or `#concern` as an ordinary offer of that kind to Rapport, one per direct report the line names (`about`: their id), or one with no `about` when it names none. `text` has each `@handle` replaced by the person's name. Ids are `n-<kind>-<hash of the note path, text and person>`, so a line is never offered twice; `source.id` is the note's path. |
| `runway` (Runway) | An accepted `roadmap-item` to Slate from the Work item button in a roadmap item's panel, id `h_<map>_<item>_slate` (sending again replaces it), Runway 1.14.0. |

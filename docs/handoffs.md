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
| `receipts` (Rapport) | any app; accepted-ready for every kind | `kind`: `win`, `feedback`, `growth`, `concern` or `note` (default `win`); `impact`: 0 to 3 (default 0); `about`: `me` (default) or the id of a report in Receipts' own people list (`p_...`); an id Receipts does not know is treated as `me`. The receipt's date is the offer's `date`, its text the offer's `text`. |
| `prioritizer` (Docket) | any app; accepted-ready for `task` | `kind`: `task`. Adds a task like Docket's Quick add: `title` (1 to 300 characters; the offer's `text` is the fallback), optional `list` (a list name, matched without case; otherwise Docket's default list), `people` (names, up to 10), `waiting` (`true` for "waiting on"), `due` (`YYYY-MM-DD`), `urgent` (`true`), `value` (1 to 4), `effort` (`XS` to `XL`), `notes`. Text is never parsed as Quick add syntax. |
| `prioritizer` (Docket) | any app | `kind`: `every-sprint`. `title` (1 to 300 characters; the offer's `text` is the fallback), `dueDay` (1 to 60) or `last: true`, optional `planKind` (a Day view block kind), `value` (1 to 4), `effort` (`XS` to `XL`), `notes`. Accepting adds an every-sprint task in the Day view's settings. An offer whose `source.id` matches one already accepted updates that item instead of adding another. `date` is the day it was offered. |
| `notes` | any app; accepted-ready for `note` | `kind`: `note`. From `home`: adds the offer's `text` as a bullet in the pinned Quick Notes note (`quick-notes.md`), newest first under a `## YYYY-MM-DD` heading for the offer's `date`. From any other app: adds a note in Notes' `inbox/` folder, `title` (1 to 120 characters; the first line of the offer's `text` is the fallback) and the offer's `text` as its body. |

## Senders

| Sender | Offers |
| --- | --- |
| `prioritizer` (Docket) | Receipts from Wrap up. |
| `oneonones` (1:1s, retired) | Wins to Receipts. 1:1s is part of Rapport since 2.0.0 and writes no offers; Rapport still reads offers left in `oneonones.handoffs` until they are handled. |
| `home` | Accepted captures from quick capture ([hub.md](hub.md)) to Docket, Receipts and Notes. |
| `agents` (Dispatch) | Accepted captures from the hub ([hub.md](hub.md)) to Docket, Receipts and Notes. |

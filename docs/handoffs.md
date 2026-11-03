# Handoffs

A handoff is one app offering an item to another app, which the person then accepts or dismisses there. Example: Docket's Wrap up offers today's finished tasks to Receipts as possible receipts.

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

## Rules

1. **The sender owns the offer.** It may change `text` or `payload` until the receiver handles it, and may delete old offers (a tombstone, as usual). Senders keep at most 60 days of offers.
2. **The receiver owns the decision.** It records each handled id (accepted or dismissed) in its own data, and never writes the sender's collection.
3. **Read like any other app's data.** Check `schema` and `version`; an unknown version is unreadable, not empty ([data-format.md](data-format.md), Migrations). A missing collection means no offers.
4. **Nothing happens without the person.** A receiver shows offers and waits for a click. It never accepts them on its own.
5. **Same data folder only.** Handoffs work where both apps share a backend, such as inside Workshop. An app on its own site with browser storage simply sees no offers.

## Receivers

| Receiver | Accepts from | `payload` |
| --- | --- | --- |
| `receipts` | any app | `kind`: `win`, `feedback`, `growth`, `concern` or `note` (default `win`); `impact`: 0 to 3 (default 0); `about`: `me` only. The receipt's date is the offer's `date`, its text the offer's `text`. |

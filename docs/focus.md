# Focus hours and lunch

Protected focus time and a protected lunch that every app respects. During a focus or lunch block, interruptions (attention-grabbing UI: badges, pickup toasts, new-item toasts, the parts of Needs you that can wait) are held and released together when the block ends. Nothing in the data is held: every app keeps syncing and saving. Lunch is also watched: working through it shows a quiet offer to take it now, and a missed lunch is offered again until 15:00.

Version: the `settings.focus` collection is version 1. The shared code is `shared/focus.js` in the platform bundle ([bundle.md](bundle.md)).

With focus hours off (the default until the Settings page is saved), every app behaves exactly as without this feature.

## The collection

Settings keeps one collection named `focus`, so its schema is `settings.focus`, stored at `<dataDir>/settings/focus.json` in the usual envelope ([data-format.md](data-format.md)).

### `meta`: the hours

Schema: [schemas/focus-settings.schema.json](schemas/focus-settings.schema.json). Example: [examples/focus-settings.default.json](examples/focus-settings.default.json).

```json
{
  "enabled": true,
  "dayplanOverride": true,
  "week": {
    "mon": [{"start": "09:00", "end": "12:00"}],
    "tue": [], "wed": [], "thu": [], "fri": [], "sat": [], "sun": []
  },
  "lunch": {"enabled": true, "start": "12:00", "minutes": 60, "days": ["mon", "tue", "wed", "thu", "fri"]}
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Off: no focus, no lunch, nothing held anywhere. |
| `dayplanOverride` | On: Docket's Day plan blocks for today (below) replace the weekly hours and lunch that day. |
| `week` | Per weekday, up to 8 focus blocks `{start, end}`, local wall-clock `HH:MM`. `end` is after `start`; blocks in a day do not overlap; a block never crosses midnight. |
| `lunch` | `enabled`, `start` (`HH:MM`), `minutes` (5 to 240) and the weekdays it applies to. |

Only Settings writes `meta`. A missing collection or `meta` means focus hours are off.

### Items: one per day

Schema: [schemas/focus-day.schema.json](schemas/focus-day.schema.json). Example: [examples/focus-day.busy.json](examples/focus-day.busy.json).

```json
{
  "id": "2026-11-09",
  "updatedAt": 1794243600000,
  "skip": false,
  "manual": [{"start": "14:00", "end": "14:50"}],
  "endedEarly": ["09:00"],
  "lunch": {"pushedTo": "12:30", "skipped": false, "late": [{"start": "14:10", "end": "15:10"}], "endedAt": null, "status": "late"},
  "log": {"focus": [{"start": "09:00", "end": "12:00", "outcome": "endedEarly", "minutes": 150}], "lunch": "late", "released": 7}
}
```

| Field | Meaning |
| --- | --- |
| `skip` | Skip today: focus is off for the rest of the day. Lunch still applies. |
| `manual` | Start focus now blocks. |
| `endedEarly` | Start times of focus blocks that were ended early (the start of the block as resolved, see below). |
| `lunch.pushedTo` | Push lunch: the new start; the length stays. |
| `lunch.skipped` | Skip lunch today. |
| `lunch.late` | Late lunch blocks (Take lunch now, Take 30 or 60 min). |
| `lunch.endedAt` | End lunch: the time the planned lunch ended early. A late lunch ended early has its `end` changed instead. |
| `lunch.notToday` | Not today on the missed lunch offer. |
| `lunch.status` | `taken`, `late` (a late lunch was taken), `partial` (10 to 29 active minutes: neither taken nor missed), `missed`, `skipped`, or `null` (not decided yet). |
| `log` | The day's history: focus blocks with outcome (`kept`, `endedEarly` with the minutes kept, `skipped`), the lunch outcome, and how many held items were released. |

The shell's bar control writes day items as app `settings` (the shell connects to the SDK with `connect({app: 'settings'})`; no SDK change). Two tabs writing the same day item merge per field, the later edit winning, like any other item ([data-format.md](data-format.md), Merge).

**Cleanup.** Overrides (`skip`, `manual`, `endedEarly`, `lunch`) older than 14 days are dropped from the item; the item, with its `log`, is tombstoned after 90 days. Settings and the shell run the cleanup when they write. Active-minute counts are never stored, only the resulting lunch status.

**Private.** The log is read only by Settings (Focus hours, History). It never goes into a summary. The data export includes it like other Settings data.

## Day plan blocks

Docket's `day` summary card ([summaries.md](summaries.md)) adds to each day:

```json
{"focus": [{"start": "09:00", "end": "12:00"}], "lunch": {"start": "12:00", "end": "13:00"}}
```

From the day's Day plan sections whose `kind` is `focus` or `lunch` (case-insensitive, trimmed), using `around` and `around + minutes`. Sections without both, and sections lost that day, are skipped. Both fields are omitted on a day with no Day plan. An empty `focus` array means focus is off that day. With more than one `lunch` section, the first counts. A Day plan with focus sections and no lunch section keeps the Settings lunch.

## What is focused now

`resolveFocus({settings, day, dayplan, now})` in `shared/focus.js` returns `{state, until, source, nextStart, lunchStatus, span, blocks, lunchBlocks}`. `state` is one of:

- `off`: no block now.
- `focus`: inside a focus block. `source` is `schedule`, `dayplan` or `manual`.
- `lunch`: inside a lunch block. `source` is `schedule`, `dayplan` or `late`.
- `skipped`: Skip today is on (and it is not lunch).

In this order:

1. **Lunch** wins over focus whenever both cover the same minute. A focus block that would run into lunch ends when lunch starts.
2. **Skip today**: focus is off for the rest of today.
3. **End early** for a block: off until the next block starts.
4. **Start focus now**: focus, source `manual`. If it overlaps a scheduled block, the merged block ends at the later end. It never runs into lunch.
5. **Day plan blocks** for today, when `dayplanOverride` is on: they replace the weekly hours that day.
6. **Weekly hours** for today's weekday.
7. Otherwise off.

Times are local wall-clock in the browser's time zone. A block that would start in a DST gap starts at the first valid minute (the clock jumps past the start, so the block is already running).

`span` is the held span the moment belongs to: `{key, start, end}`, where focus and lunch blocks that touch are one span (focus ending at 12:00 straight into lunch at 12:00). `key` is `YYYY-MM-DDTHH:MM`, the date and the span's start. Held items are counted per span, and the release happens once, when the span ends.

`isBreakThrough(item, focus)` is true only for blocking pull requests (below), and only during `focus`, never during `lunch`.

## What is held

During a span (focus or lunch):

| Where | While held | When the span ends |
| --- | --- | --- |
| Shell rail badges (every app) | Hidden. During focus a badge with a `breakThrough` count shows that count instead ([sdk.md](sdk.md)). | Restored |
| Home Needs you | Focus: only blocking pull requests; the rest folds to "N held until 12:00". Lunch: folds entirely. | Restored |
| Docket Needs you strip | Same as Home | Restored |
| Docket ADO "new items" toast | Not shown; items still sync and land in Inbox | Counted in the release toast |
| Docket Inbox column | Folds to a rail with a count; captures and drops still work | Unfolds |
| Handoff and pickup toasts (every app) | Not shown; items still picked up and saved | Counted in the release toast |
| Dispatch Inbox badge and toasts | Held, except reviews of blocking pull requests during focus | Restored |
| Quick capture | Works as always | n/a |

**Blocking pull requests** are the ones Docket calls "PRs blocked on you": open tasks for a pull request where you are a required reviewer and the pull request is not waiting on its author. Docket publishes them as its `blocking` summary card ([summaries.md](summaries.md)); Dispatch marks reviews of them with `breakThrough`.

### Holding a toast

An app that holds its own interruptions uses `createHolder` from `shared/focus.js`: `holder.toast(text, opts)` shows the toast at once outside a span and counts it inside one. The toast also carries `hold: true` (and `breakThrough: true` for a blocking pull request), so the shell drops a held toast that slips through while a span is on ([sdk.md](sdk.md), Shell).

### The held card

Each app that holds something reports it in its own summary as a card of kind `held` ([summaries.md](summaries.md)):

```json
{"id": "held", "updatedAt": 1794243600000, "kind": "held", "block": "2026-11-09T09:00", "count": 3, "label": "3 new ADO items", "route": "today"}
```

`block` is the span key; `count` and `label` say what was held; `route` opens the place in the writer's app. The card stays after the span ends, so readers can still count it; a new span starts it again from 0. Readers (the shell's Peek and release toast, Dispatch's digest) count only cards whose `block` is the span they are about. Apps never read each other's own collections for this.

### Release

When a span ends (by time, End early or End lunch), the shell shows one toast: "Focus done. 7 held: 3 new ADO items, 2 captures picked up, 2 Dispatch runs waiting." Each part opens its place. Once per span per browser: the tabs agree over a `BroadcastChannel` named `workshop-focus` and a Web Lock, so only one tab shows it. No sound, no system notification. When focus ends straight into lunch there is no toast: the span goes on, and it is released once when lunch ends. The shell adds the released count to the day's `log`.

## Lunch detection

Workshop sees only activity in its own tabs: no system idle detection, no Idle Detection API, no calendar.

- **Active minute:** a tab counts a minute as active if it is visible and had a key press, pointer down or scroll in it. Tabs share active minutes over the `workshop-focus` channel; a minute active in two tabs counts once. Only counts, never what was typed or clicked, and only in memory.
- **Working through lunch:** 10 or more active minutes inside the lunch block (the cover is up at first, so these come after a "Just a minute") show a quiet bar once per lunch: Take lunch now (a fresh 60-minute late lunch), Push 30 min, Skip lunch today.
- **Missed:** a lunch block that ends with 30 or more active minutes, or a lunch pushed to 14:30 or later and not taken by then, is `missed`. Until 15:00 the shell bar offers a late lunch: Take 30 min, Take 60 min, Not today.
- **Taken:** a lunch or late lunch with fewer than 10 active minutes. A taken late lunch clears `missed` (status `late`).
- The thresholds (10, 30, 14:30, 15:00) are constants in `shared/focus.js` for version 1.

## Controls

The shell bar item (every app): Start focus now (25, 50 or 90 minutes, or until the next block ends), End early, Skip today and Undo skip, Peek at held items, End lunch, Push lunch (15, 30 or 60 minutes), Skip lunch today, Take lunch now. The same in the palette (Ctrl+K). Peek lists the held cards of the current span by app; opening one does not end the span.

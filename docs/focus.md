# Focus hours and lunch

Protected focus time and a protected lunch that every app respects. During a focus or lunch block, interruptions (attention-grabbing UI: badges, pickup toasts, new-item toasts, the parts of Needs you that can wait) are held and released together when the block ends. Nothing in the data is held: every app keeps syncing and saving. Lunch is also watched: working through it shows a quiet offer to take it now, and a missed lunch is offered again until 15:00.

The day has an end too: after the day's end time (from Docket's Day settings) interruptions are held like lunch until the next morning ([Day's done](#days-done)). Five minutes before a focus block ends, lunch starts or the day ends, the shell bar says so in one quiet line ([Heads-up](#heads-up)).

Version: the `settings.focus` collection is version 1. The shared code is `shared/focus.js`.

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
  "lunch": {"enabled": true, "start": "12:00", "minutes": 60, "days": ["mon", "tue", "wed", "thu", "fri"]},
  "afterEnd": true
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Off: no focus, no lunch, nothing held anywhere. |
| `dayplanOverride` | On: Docket's Day plan blocks for today (below) replace the weekly hours and lunch that day. |
| `week` | Per weekday, up to 8 focus blocks `{start, end}`, local wall-clock `HH:MM`. `end` is after `start`; blocks in a day do not overlap; a block never crosses midnight. |
| `lunch` | `enabled`, `start` (`HH:MM`), `minutes` (5 to 240) and the weekdays it applies to. |
| `afterEnd` | "After my day ends": hold after the day's end until the next morning ([Day's done](#days-done)). Optional; missing means on. |

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
| `late` | Keep working tonight: the time it was clicked (`HH:MM`). Day's done is off from then until midnight, and there is no morning hold the next day. |
| `early` | Start my day now: the time it was clicked (`HH:MM`). The morning hold ends then. |
| `log` | The day's history: focus blocks with outcome (`kept`, `endedEarly` with the minutes kept, `skipped`), the lunch outcome, how many held items were released, and `workedLate: true` after Keep working tonight. |

The shell's bar control writes day items as app `settings` (the shell connects to the SDK with `connect({app: 'settings'})`; no SDK change). Two tabs writing the same day item merge per field, the later edit winning, like any other item ([data-format.md](data-format.md), Merge).

**Cleanup.** Overrides (`skip`, `manual`, `endedEarly`, `lunch`, `late`, `early`) older than 14 days are dropped from the item; the item, with its `log`, is tombstoned after 90 days. Settings and the shell run the cleanup when they write. Active-minute counts are never stored, only the resulting lunch status.

**Private.** The log is read only by Settings (Focus hours, History). It never goes into a summary. The data export includes it like other Settings data.

## Day plan blocks

Docket's `day` summary card ([summaries.md](summaries.md)) adds to each day:

```json
{"focus": [{"start": "09:00", "end": "12:00"}], "lunch": {"start": "12:00", "end": "13:00"}, "start": "09:00", "end": "17:00"}
```

`start` and `end` are the Day view's day start and day end (Docket's Day settings), on working days only. They are used whether or not "Day plan can override" is on.

From the day's Day plan sections whose `kind` is `focus` or `lunch` (case-insensitive, trimmed), using `around` and `around + minutes`. Sections without both, and sections lost that day, are skipped. `focus` is there only when the day's plan has at least one section of kind `focus`; if none of them is usable (all lost, or no time), it is an empty array and focus is off that day. A day with no Day plan, or a plan with no `focus` section, has no `focus` field, and the weekly hours apply. `lunch` is the first usable `lunch` section; without one the Settings lunch applies.

## What is focused now

`resolveFocus({settings, day, dayplan, now})` in `shared/focus.js` returns `{state, until, source, nextStart, lunchStatus, span, blocks, lunchBlocks}`. `state` is one of:

- `off`: no block now.
- `focus`: inside a focus block. `source` is `schedule`, `dayplan` or `manual`.
- `lunch`: inside a lunch block. `source` is `schedule`, `dayplan` or `late`.
- `skipped`: Skip today is on (and it is not lunch).
- `dayDone`: after the day's end, or before the day starts the next morning ([Day's done](#days-done)). `source` is `end` (the evening) or `morning`.

The result also has `dayEnd` and `dayStart`: today's `end` and `start` from Docket's `day` card (`HH:MM`), or `null`.

In this order:

0. **Day's done** wins over everything: focus and lunch blocks inside it are dropped.
1. **Lunch** wins over focus whenever both cover the same minute. A focus block that would run into lunch ends when lunch starts.
2. **Skip today**: focus is off for the rest of today.
3. **End early** for a block: off until the next block starts.
4. **Start focus now**: focus, source `manual`. If it overlaps a scheduled block, the merged block ends at the later end. It never runs into lunch.
5. **Day plan blocks** for today, when `dayplanOverride` is on: they replace the weekly hours that day.
6. **Weekly hours** for today's weekday.
7. Otherwise off.

Times are local wall-clock in the browser's time zone. A block that would start in a DST gap starts at the first valid minute (the clock jumps past the start, so the block is already running).

`span` is the held span the moment belongs to: `{key, start, end}`, where focus and lunch blocks that touch are one span (focus ending at 12:00 straight into lunch at 12:00). `key` is `YYYY-MM-DDTHH:MM`, the date and the span's start. Held items are counted per span, and the release happens once, when the span ends.

`isBreakThrough(item, focus)` is true only for blocking pull requests (below), and only during `focus`, never during `lunch` or `dayDone`. `holdsAll(focus)` is true during `lunch` and `dayDone`: nothing breaks through, so apps fold what they would fold at lunch.

## What is held

During a span (focus, lunch or Day's done; Day's done is held like lunch):

| Where | While held | When the span ends |
| --- | --- | --- |
| Shell rail badges (every app) | Hidden. During focus a badge with a `breakThrough` count shows that count instead ([sdk.md](sdk.md)). | Restored |
| Home Needs you | Focus: only blocking pull requests; the rest folds to "N held until 12:00". Lunch: folds entirely. | Restored |
| Docket Today's Reviews group | Blocking pull requests stay pinned (Docket 7.0.0 has no Needs you strip) | n/a |
| Docket ADO "new items" toast | Not shown; items still sync and land in Inbox | Counted in the release toast |
| Docket Inbox column | Folds to a rail with a count and "held until"; captures and drops still work | Unfolds |
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

## Day's done

With focus hours on and "After my day ends" on (`afterEnd`, the default), a day with an `end` in Docket's `day` card ends there:

- **Evening.** From `end` until midnight the state is `dayDone`, source `end`. Held like lunch: badges, Needs you and held toasts; nothing breaks through, blocking pull requests included.
- **Morning.** On a day with a `start`, from midnight until the day starts the state is `dayDone`, source `morning`. The day starts at its `start` or its first focus block, whichever comes first. There is no morning hold the day after Keep working tonight, or after Start my day now.
- **One span for the night.** The evening and the next morning are one held span, keyed by the morning's date at `00:00` (`2026-11-10T00:00` for the night after 9 November). Held items are counted under that key, so the release happens once, in the morning, in one toast: "Good morning. 5 held: ...". When the next day has no `start` (a weekend), the span ends at midnight.
- **Keep working tonight** (the shell bar menu, evening only) writes `late` to today's day item and `workedLate: true` to its log. Day's done is off until midnight; what was held is released at once. Focus history shows "worked late".
- **Start my day now** (the shell bar menu, morning only) writes `early`: the morning hold ends and what was held is released.
- **The cover.** Once per evening span in each tab, a calm cover: "Day's done." with **Wrap up** (opens Docket's Wrap up, `#/prioritizer/shutdown`) when the day is not wrapped yet (`wrapped` in Docket's `day` card), and **Just a minute**, which hides it for 15 minutes before it comes back. Quick capture still works under it. The morning has no cover.
- **The bar** reads "Day's done" in the evening and "Day starts at 9:00" in the morning.
- With `afterEnd` off, or no `end` for today, there is no Day's done. A missing `start` means no morning hold.
- If no tab was open when the morning hold ended, the first tab opened later that day releases it, once per browser.

## Heads-up

Five minutes before a transition the shell bar shows one quiet line, with a dismiss button:

| Before | Line |
| --- | --- |
| A focus block ends (not straight into lunch or Day's done) | "Focus ends in 5 min" |
| Lunch starts (not a late lunch, which starts when you take it) | "Lunch in 5 min" |
| The day's `end`, when "After my day ends" is on and Keep working tonight is not | "Day ends in 5 min" |

- The line shows from 5 minutes before until the transition, or until dismissed. When two fall in the same minutes, the earliest transition shows; at the same time, lunch or day end wins over focus end.
- No toast, no sound, no system notification.
- Once per event per browser: dismissing it in one tab hides it in every tab (the `workshop-focus` channel) and it does not come back after a reload. The event key is `<kind>:<date>T<HH:MM of the transition>`.
- Off with focus hours off.

## Lunch detection

Workshop sees only activity in its own tabs: no system idle detection, no Idle Detection API, no calendar.

- **Active minute:** a tab counts a minute as active if it is visible and had a key press, pointer down or scroll in it. Tabs share active minutes over the `workshop-focus` channel; a minute active in two tabs counts once. Only counts, never what was typed or clicked, and only in memory.
- **Working through lunch:** 10 or more active minutes inside the lunch block (the cover is up at first, so these come after a "Just a minute") show a quiet bar once per lunch: Take lunch now (a fresh 60-minute late lunch), Push 30 min, Skip lunch today.
- **Missed:** a lunch block that ends with 30 or more active minutes, or a lunch pushed to 14:30 or later and not taken by then, is `missed`. Until 15:00 the shell bar offers a late lunch: Take 30 min, Take 60 min, Not today.
- **Taken:** a lunch or late lunch with fewer than 10 active minutes. A taken late lunch clears `missed` (status `late`).
- The thresholds (10, 30, 14:30, 15:00) are constants in `shared/focus.js` for version 1, as are the 5-minute heads-up (`HEADS_UP_MINUTES`) and the 15-minute Day's done pause (`DONE_PAUSE_MINUTES`).

## Controls

The shell bar item (every app): Start focus now (25, 50 or 90 minutes, or until the next block ends), End early, Skip today and Undo skip, Peek at held items, End lunch, Push lunch (15, 30 or 60 minutes), Skip lunch today, Take lunch now, Keep working tonight (Day's done, evening), Start my day now (Day's done, morning). The same in the palette (Ctrl+K). Peek lists the held cards of the current span by app; opening one does not end the span.

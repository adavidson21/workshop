# Summaries

A summary is what one app publishes about itself for other apps to show: Home's cards, Rapport's 1:1 prep, the targets in quick capture. Readers read the summary instead of the app's own collections, so the app can change its own data format without breaking anyone.

Version: `summary` collections are version 1.

Apps can read each other's collections but never write them ([sdk.md](sdk.md), Data). A summary keeps that rule: each app writes only its own.

## The collection

An app keeps one collection named `summary`, so its schema is `<app id>.summary` (for example `prioritizer.summary`), in the usual envelope ([data-format.md](data-format.md)). Each item is one **card**. Schema: [schemas/summary-card.schema.json](schemas/summary-card.schema.json). Examples: [examples/summary-card.board.json](examples/summary-card.board.json), [examples/summary-card.targets.json](examples/summary-card.targets.json).

```json
{
  "id": "targets",
  "updatedAt": 1793736000000,
  "kind": "targets",
  "title": "Lists",
  "capture": "task",
  "rows": [{"id": "l_inbox", "title": "Inbox"}, {"id": "l_team", "title": "Team"}]
}
```

Every card has `id` (unique in the collection), `updatedAt` and `kind`. The other fields depend on `kind` (below). Readers ignore cards whose `kind` they do not know, and fields they do not know.

## Kinds

| `kind` | Fields | Read by |
| --- | --- | --- |
| `count` | `title`, `count` (integer), optional `route` (a path in the writer's app). | Home (Get started). |
| `list` | `title`, `rows`: up to 50 of `{id, title, route?, due?, note?, flag?}`, optional `count` (the total, when `rows` is cut short) and `route`. `due` is `YYYY-MM-DD`; `flag` is `urgent`, `waiting` or `done`. | Home (Notes' `recent`), any app that shows a list from another app. |
| `targets` | `title`, `capture` (a capture kind, [app-manifest.md](app-manifest.md) `capture`), `rows`: up to 200 of `{id, title}`. Places a capture can name: Docket's lists for `task`, Runway's roadmaps for `idea`, Notes' folders (and `today`) for `note`. | Home quick capture, the Dispatch hub. |
| `board` | `days`: an object keyed by `YYYY-MM-DD` for today and the next 6 days, each `{total, open, focus: {total, done, tasks}, triage, overdue, dueWeek, nudges, cameBack}` (`focus.tasks`: up to 10 of `{id, title, done}`, the day's Today tasks by rank; `nudges`: open delegated tasks whose follow-up date is that day or earlier; `cameBack`: open tasks that came back from someone and are not handled yet; both from Docket 5.8.0, read as 0 when missing); `upNext`: up to 3 of `{id, title, list, listId, due, who, triaged}` (`who`: people and group ids, [people.md](people.md)); `team`: up to 50 of `{id, name, open, waiting}` (a person id and the counts of open and waiting tasks that involve them, through their groups too). | Home (the Today card's counts), Notes (`{{docket}}` in the daily template: `focus.tasks`, else `upNext`). |
| `day` | `days`: an object keyed by `YYYY-MM-DD` for today and the next 6 days, each `{blocks, wrapAt, wrapped, offered}`. `blocks`: up to 24 of `{name, at, until, tasks}`, where `at` and `until` are `HH:MM` and `tasks` up to 10 of `{id, title, done}`. `wrapAt`: `HH:MM` when Wrap up is due that day, or `null` for a day off. `wrapped`: the day is wrapped. `offered`: receipts offered that day. A day with no plan has `blocks: []`. | Home (Now and Wrap up). |
| `people` | `rows`: up to 200 of `{id, open, waiting}`, one per person or group id ([people.md](people.md)) that has open tasks; `open` and `waiting` are up to 20 of `{id, title, due, nudgeOn, via}` (`due` and `nudgeOn` are `YYYY-MM-DD` or empty; `via` is the group id the task is assigned to when it reaches a person through a group, else empty). A person's row counts tasks assigned to them and to their active groups. Readers show names from the directory, not from the summary. | Rapport (1:1 prep). |

## Two list cards every app may write

Two `list` cards have a fixed meaning, so Home can gather them from every app without knowing any of them:

| Card id | Meaning | Read by |
| --- | --- | --- |
| `needs` | What waits on the person in this app right now, one row each, most pressing first. `flag: "urgent"` for something blocking someone (an agent asking a question), `"waiting"` for upkeep that can wait (a 1:1 that is due). `note` says what to do in a few words; `route` opens it. | Home's **Needs you** inbox, with Docket's triage and overdue counts and agents waiting. |
| `done-week` | What the person finished, decided or shipped in the last 7 days, newest first. `due` is the day it happened; `note` adds context (a list, "Shipped"). Never anything about another person that the person would not put in a status update. | Home's **Weekly status** draft. |

An app that has nothing to say writes the card with no rows, or leaves it out.

## Rules

1. **Write it with the data.** An app rewrites its summary whenever the data behind it changes, and once when it loads. Cards that depend on the date cover today and the next 6 days (`board`, `day`), so a reader can still show the right day when the app has not opened since.
2. **Read like any other app's data.** Check `schema` and `version`; an unknown version is unreadable, not empty ([data-format.md](data-format.md), Migrations). A missing collection or card means the app has not written one yet.
3. **Past its days, it is stale.** A `board` or `day` card with no entry for today is stale: the reader shows nothing for it, or tells the person to open the app. Readers never fall back to the writer's own collections.
4. **A summary is for showing.** Readers never treat it as the record. To change something, open the writer's app (`ws.open`) or send a handoff ([handoffs.md](handoffs.md)).
5. **Small.** A summary is read on every Home load. Keep each card to the limits above.

## Writers

| Writer | Cards |
| --- | --- |
| `prioritizer` (Docket) | `board` (id `board`), `day` (id `day`), `targets` (id `lists`, `capture: "task"`), `people` (id `people`), `list` (id `done-week`: tasks finished, Docket 5.6.0), `list` (id `tasks`: the 50 highest ranked open tasks, `route` `task/<id>`; Notes' `[[` picker, Docket 5.7.0). |
| `receipts` (Rapport) | `count` (id `entries`: receipts logged), `list` (id `needs`: 1:1s due, names and days only), `list` (id `done-week`: your own wins; never receipts about anyone else). Rapport 3.3.0. |
| `slate` (Slate) | `list` (id `needs`: items to decide, approve, publish or answer, and stale ones), `people` (id `delegated`: open items delegated to each person, for Rapport's 1:1 prep), `list` (id `done-week`: decisions made), `list` (id `ado`: ADO ids Slate knows, each row's `id` the ADO id and `route` the Slate item, for Dispatch's From Slate link). |
| `agents` (Dispatch) | `list` (id `needs`: agents asking a question, pull requests waiting for your review), `list` (id `done-week`: runs that reached PR or shipped). |
| `runway` (Runway) | `targets` (id `roadmaps`, `capture: "idea"`). |
| `notes` (Notes) | `targets` (id `folders`, `capture: "note"`: a `today` row, then up to 199 folders, most recently used first; quick capture's `n <folder>: ...`), `count` (id `notes`), `list` (id `recent`: the 10 notes changed last), `list` (id `mentions`: notes that link to another app's record with a `ws:` link; each record's newest 3 notes first, then the rest newest first, up to 50; each row's `note` is the record, `<app>/<route>`, which Docket reads for a task's "Notes" line). Titles and paths only. Home shows `recent`. |

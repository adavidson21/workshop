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
| `board` | `days`: an object keyed by `YYYY-MM-DD` for today and the next 6 days, each `{total, open, focus: {total, done, tasks}, triage, overdue, dueWeek, nudges, cameBack}` (`focus.tasks`: up to 10 of `{id, title, done}`, the day's Today tasks by rank; `nudges`: open delegated tasks whose follow-up date is that day or earlier; `cameBack`: open tasks that came back from someone and are not handled yet; both from Docket 5.8.0, read as 0 when missing; from Docket 7.0.0 a task is on a day's `focus` when it is on that day's Today list or in one of that day's Day plan blocks, and `triage` leaves out stale tasks, which no longer go back to the Inbox); `upNext`: up to 3 of `{id, title, list, listId, due, who, triaged}` (`who`: people and group ids, [people.md](people.md)); `team`: up to 50 of `{id, name, open, waiting}` (a person id and the counts of open and waiting tasks that involve them, through their groups too). | Home (the Your day card: Today's tasks and the footer counts), Notes (`{{docket}}` in the daily template: `focus.tasks`, else `upNext`). |
| `day` | `days`: an object keyed by `YYYY-MM-DD` for today and the next 6 days, each `{blocks, wrapAt, wrapped, offered}`. `blocks`: up to 24 of `{name, at, until, tasks}`, where `at` and `until` are `HH:MM` and `tasks` up to 10 of `{id, title, done}`. `wrapAt`: `HH:MM` when Wrap up is due that day, or `null` for a day off. `wrapped`: the day is wrapped. `offered`: receipts offered that day. A day with no plan has `blocks: []`. Optional `focus`: `[{start, end}]` and `lunch`: `{start, end}`, the day's Day plan sections of kind `focus` and `lunch` (`HH:MM`; `focus` only on a day whose plan has a `focus` section, where an empty array means focus is off that day; `lunch` only when it has a usable `lunch` section; [focus.md](focus.md), Day plan blocks). | Home (the Your day card's blocks and Wrap up), focus hours (`shared/focus.js`). |
| `people` | `rows`: up to 200 of `{id, open, waiting}`, one per person or group id ([people.md](people.md)) that has open tasks; `open` and `waiting` are up to 20 of `{id, title, due, nudgeOn, via}` (`due` and `nudgeOn` are `YYYY-MM-DD` or empty; `via` is the group id the task is assigned to when it reaches a person through a group, else empty). A person's row counts tasks assigned to them and to their active groups. Readers show names from the directory, not from the summary. | Rapport (1:1 prep). |
| `held` | `block` (the held span, `YYYY-MM-DDTHH:MM`), `count` (integer), `label` (what was held, in a few words: "3 new ADO items"), optional `route`. One card, id `held`, per app; kept after the span ends and started again from 0 by the next one ([focus.md](focus.md), The held card). | The shell (Peek, the release toast), Dispatch (the afternoon digest). |

## List cards every app may write

These `list` cards have a fixed meaning, so Home can gather them from every app without knowing any of them:

| Card id | Meaning | Read by |
| --- | --- | --- |
| `needs` | What waits on the person in this app right now, one row each, most pressing first. `flag: "urgent"` for something blocking someone (an agent asking a question), `"waiting"` for upkeep that can wait (a 1:1 that is due). `note` says what to do in a few words; `route` opens it. | Home's **Needs you** inbox, with agents waiting. |
| `done-week` | What the person finished, decided or shipped in the last 7 days, newest first. `due` is the day it happened; `note` adds context (a list, "Shipped"). Never anything about another person that the person would not put in a status update. | Home's **Weekly status** draft. |
| `upcoming` | Dated things coming up in the next 14 days (and overdue ones, at most 7 days late), soonest first, up to 20 rows. Every row has `due` (`YYYY-MM-DD`); `note` says what it is in a few words ("1:1", "Milestone", "Review due"); `route` opens it. Things the person plans or meets about, never another person's private details. From desktop layout v1. | Home's **Coming up** card. |

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
| `prioritizer` (Docket) | `board` (id `board`), `day` (id `day`, with `focus` and `lunch` from Docket 6.4.0), `list` (id `blocking`: PRs blocked on you, `route` `task/<id>`, `flag: "urgent"`; focus hours show only these while focused, Docket 6.4.0), `list` (id `needs`: one row per kind, most pressing first: PRs blocked on you (`urgent`), follow-ups due and work that came back (`waiting`), new ADO items to review, overdue tasks; each `title` carries the count, `route` opens Docket's Today, Docket 7.0.0), `held` (id `held`), `targets` (id `lists`, `capture: "task"`), `people` (id `people`), `list` (id `done-week`: tasks finished, Docket 5.6.0), `list` (id `tasks`: the 50 highest ranked open tasks, `route` `task/<id>`; Notes' `[[` picker, Docket 5.7.0). |
| `receipts` (Rapport) | `count` (id `entries`: receipts logged), `list` (id `needs`: 1:1s due, names and days only), `list` (id `done-week`: your own wins; never receipts about anyone else). Rapport 3.3.0. `list` (id `upcoming`: 1:1s due in the next 14 days by cadence, `note` "1:1", and the review cycle's self review and reviews due dates, Rapport 3.6.0). `held` (id `held`: receipts picked up during focus or lunch, Rapport 3.5.0). |
| `slate` (Slate) | `list` (id `needs`: items to decide, approve, publish or answer, interview questions waiting and briefs ready, and stale ones), `list` (id `shaping`: Runway pending ideas Slate has taken, each row's `id` the Runway idea id and `route` the Slate item, Slate 1.6.0), `people` (id `delegated`: open items delegated to each person, for Rapport's 1:1 prep), `list` (id `done-week`: decisions made), `list` (id `ado`: ADO ids Slate knows, each row's `id` the ADO id and `route` the Slate item, for Dispatch's From Slate link; kept for one release after `runs`), `list` (id `runs`: up to 50 runs Slate tracks in Building to Resolved, each row's `id` the ADO id, or the run folder when there is none, an extra `folder` field when the run has a local folder, `route` the Slate item, `note` Building, Merged or Resolved, and `flag: "done"` once every linked pull request merged or the item is resolved; Dispatch's From Slate link and Ship's Merged group, Slate 1.7.0), `list` (id `tracked`: up to 200 ADO items on Slate's board, every column from Inbox to Resolved, each row's `id` the ADO id, `title`, `route` the Slate item and `note` the board column (`Inbox`, `Shape`, `Define`, `Who builds it?`, `In flight`, `Resolved`); an item Publish linked as the work's source (an Issue a feature was scoped from) is a row too, its `note` `Source of #<id>`. Closed items are not rows. Docket's In Slate chip, Slate 2.2.0), `held` (id `held`). |
| `agents` (Dispatch) | `list` (id `needs`: agents asking a question, pull requests waiting for your review), `list` (id `done-week`: runs that reached PR or shipped), `held` (id `held`: agent and review notices held during focus). |
| `runway` (Runway) | `targets` (id `roadmaps`, `capture: "idea"`), `list` (id `pending`: the Pending assignment ideas, newest 50, `due` the day each came in, `note` its description, and an extra `from` field, the sending app's id, when Runway knows it (Runway 1.15.0; ideas taken earlier have none); Slate's Inbox shows them and leaves out its own, Runway 1.12.0)), `list` (id `upcoming`: milestones and goal dates in the next 14 days across roadmaps, `note` the roadmap name, `route` the roadmap, Runway 1.16.0). |
| `notes` (Notes) | `targets` (id `folders`, `capture: "note"`: a `today` row, then up to 199 folders, most recently used first; quick capture's `n <folder>: ...`), `count` (id `notes`), `list` (id `recent`: the 10 notes changed last), `list` (id `mentions`: notes that link to another app's record with a `ws:` link; each record's newest 3 notes first, then the rest newest first, up to 50; each row's `note` is the record, `<app>/<route>`, which Docket reads for a task's "Notes" line). `held` (id `held`: notes picked up during focus or lunch, Folio 3.5.0). Titles and paths only. Home shows `recent`. |

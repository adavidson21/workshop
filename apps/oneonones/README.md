# 1:1s

Prep 1:1s with your direct reports. For one person and the time since your last 1:1, it gathers what Docket, Receipts and Queue already know, keeps the 1:1 note, and after the meeting hands follow-ups to Docket and wins to Receipts. No AI is needed; drafting talking points with your opencode agents is an optional extra.

- **People:** the people you meet with, each with a cadence (default every 7 days). The list puts whoever is due first: no note yet, or the last note is as old as their cadence.
- **Links (settings, gear icon):** match each person to their name in Docket, their report in Receipts and their entry in Queue settings. The pickers list what those apps already have. A person with no links still gets notes.
- **Prep:** since the last 1:1 note (or *cadence* days ago when there is none):
  - Docket: open tasks tagged with them, tasks waiting on them, and nudges due.
  - Receipts: wins, feedback, growth, concerns and notes about them in that period.
  - Queue: their open items from the last refresh: in progress, stale, and changed since.
  - Last 1:1: the open follow-ups (`- [ ]` lines) from the previous note.
- **Note:** *Start today's note* writes one from a template: the date, what changed, talking points, wins, follow-ups (open ones carry over) and notes. Edit or Preview (`Ctrl+E`); it saves a moment after you stop typing (`Ctrl+S` saves now). Earlier notes are in the picker.
- **Log follow-ups:** after the meeting, tick which follow-ups become Docket tasks and which wins go to Receipts.
  - Docket: copied as quick-add lines (`Follow up: <text> @<name>`). Paste them into Docket's command bar. Docket does not take tasks from other apps, so nothing is written there.
  - Receipts: offered in this app's `handoffs` collection. They wait on that report's page in Receipts (and in Me) to accept or dismiss. Needs the person linked to a Receipts report.
- **Draft talking points (optional):** shown only when the opencode connector is on and the setting allows it. See Draft step below.
- Keyboard: `j`/`k` move, `Enter` opens, `Esc` goes back. Palette: Prep a 1:1.

## Files

```
<Workshop folder>/oneonones/
  people.json, settings.json, handoffs.json
  notes/p-mh3k9x2a/2026-11-03.md
```

Notes are plain `.md` files, one per person per day, written through `ws.files`. Any Markdown editor opens them. The Notes app lists them under *Other apps* (read only, since other apps' files are read only); editing them inside Notes could come later. The person's folder is their id with `_` written as `-`, because file names may only hold lowercase letters, digits and `-`.

## Draft step

*Draft talking points* sends this prep to your opencode agents through Workshop on this computer:

- What is sent: the packet as Markdown, without the person's name. Receipts concerns are left out unless you tick **Include concerns** for that run.
- Where it goes: the opencode connector's action `oneonone.draft` saves it as `packet.md` in the connector's own folder (`~/.workshop/data/_connectors/opencode/oneonones/`), never your code workspace, and runs Tandem's `/one-on-one` in a new opencode session. It writes `draft.md` next to it, which the app reads back with `oneonone.result`.
- What it writes: wins to recognize, follow-ups from last time, blockers, growth topics and 3 questions to ask. It drafts only: it never rates, ranks or judges, and it uses only what is in the packet.
- **Add to the note** appends the draft under "Draft talking points". Nothing else changes.
- Turn it off in settings: the button never shows and nothing is sent.

Needs Tandem (eng-agents) Core 2.8.0 or later for `/one-on-one`.

## Data

App id `oneonones`. All collections are version 1 and follow `docs/data-format.md`.

| Collection | Holds |
| --- | --- |
| `oneonones.people` | `{id: 'p_...', name, links: {docket?, receipts?, queue?}, cadenceDays, archived}`. `docket` is the name as Docket stores it, `receipts` a Receipts person id, `queue` the email (or name) in Queue settings. |
| `oneonones.settings` | No items. `meta.aiDraft`: `false` turns the draft step off. |
| `oneonones.handoffs` | Offers to Receipts ([docs/handoffs.md](../../docs/handoffs.md)): `to: 'receipts'`, `payload: {kind: 'win', about: <Receipts person id>}`. Kept 60 days. |

Read only, with their schema and version checked (an unknown version shows as unreadable, never as empty): `prioritizer.tasks` v3 and `prioritizer.people` v1, `receipts.entries` v1 and `receipts.people` v1, `queue.settings` v1 and `queue.snapshot` v1. Queue's rules for in progress and stale are mirrored in `js/model.js`, not imported. A collection with a newer `version` of our own is read only: the app says so and changes nothing.

## Security

- Every string from another app or from a note is escaped. The preview uses `js/markdown.js`, which escapes every character; raw HTML shows as text, only `http(s)` links are clickable, and images are never loaded.
- The page CSP allows only this site and Workshop on `127.0.0.1`.

## Files

- `js/model.js`: the packet, since date, follow-ups and wins, the note template, the draft packet, quick-add lines and offers. Pure.
- `js/markdown.js`: Markdown to safe HTML. Pure.
- `js/view.js`: the HTML. Pure.
- `js/data.js`: loading, saving, notes and connector calls through the SDK. No DOM.
- `js/main.js`: the page.

## Tests

```
node --test "apps/oneonones/test/*.test.mjs"
```

`test/fake.mjs` is a fake SDK (collections with revisions and conflicts, files with mtimes, a scripted opencode connector) and synthetic envelopes from the other apps. The connector side is tested in `connectors/opencode/test/one-on-one.test.mjs`.

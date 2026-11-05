# Rapport

Receipts, 1:1s and goals for you, your reports and your manager. Rapport was called Receipts until 2.0.0, when it took in the 1:1s app; its app id is still `receipts`, so its data, folder and links did not move. Full guide and source of truth: [adavidson21/receipts](https://github.com/adavidson21/receipts). This folder is a copy of that repo's `apps/receipts/`.

- **Me**: your own receipts for a self review. Star the ones that should lead your review.
- **Reports**: one page per direct report. At the top, your 1:1 with them: prep from what Docket and Rapport know since your last 1:1, and today's note. Below, their receipts (wins, feedback given, growth areas, concerns). Anyone with nothing noted in 30 days is flagged.
- **1:1s**: everyone you meet with, sorted by who is due: reports, your manager, peers, skip-levels. Reports open on their page in Reports; anyone else gets a 1:1 page of their own. **People and links** sets each person's cadence and links (their report, their Docket name).
- **Goals**: the team's and each report's OKRs for a quarter as a tree: team objectives, each report objective under the one its `Supports:` line names, and a Not aligned group. Click a key result's progress to update that line in place. Each doc is a plain Markdown file (Edit, Preview, Split); renaming a team objective here offers to update the reports that support it. Format: the repo README's Goals format.
- **Upward**: optional, turned on in Settings. Support received, asks, and feedback for your manager, with a link to your 1:1s with them when a 1:1s person has their name.
- **From Docket**: finished tasks ticked in Docket's Wrap up wait at the top of Me to accept or dismiss.
- **After a 1:1**: **Log follow-ups** copies open follow-ups as Docket quick-add lines and turns the wins you tick into receipts about that report (evidence "From a 1:1"). Logging the same win twice adds it once.
- **People**: inside Workshop, reports and your manager come from People in Workshop's Settings (`settings.people`, workshop `docs/people.md`). Rapport's own `people` is used only where that directory does not exist.
- **Review**: coverage per review section, gaps called out, and a plain-text draft to copy, plus CSV.

`N` focuses the new-receipt box, `Ctrl+Enter` saves. On the 1:1s tab `j`/`k` move, `Enter` opens, `Esc` goes back; with a note or goals doc open `Ctrl+S` saves and `Ctrl+E` switches Edit and Preview. In the goals tree, arrow keys move, open and close, `Enter` opens. Palette commands: Add a receipt, Prep a 1:1, Build a review, Open goals.

Data, all under the `receipts` app through the SDK like every other app:

| Collection or file | Holds |
| --- | --- |
| `entries`, `people`, `config` | Receipts, your own list of reports (used only without the directory), settings. |
| `oneonones/people` | People you have 1:1s with: `{id, name, links: {docket?, receipts?}, cadenceDays, archived}`. |
| `oneonones/settings` | No items. `meta.aiDraft` (`false` turns the draft step off), `meta.moved` (the copy from the old 1:1s app). |
| `oneonones/notes/<person>/<yyyy-mm-dd>.md` | 1:1 notes, plain Markdown files (`ws.files`). |
| `goals/team/<yyyy-qN>.md`, `goals/<person>/<yyyy-qN>.md` | Goals for the team and each report, one plain Markdown file per quarter (`ws.files`). `<person>` is the person id as a folder (`p_mh3k9x2a` is `p-mh3k9x2a`). |

Reads (never writes) Workshop's `settings.people` directory, Docket's summary (`prioritizer.summary`, its `people` card; workshop `docs/summaries.md`) for 1:1 prep, falling back to Docket's `tasks` and `people` for a Docket that writes no summary yet, and the `handoffs` offers of every app whose manifest lists `receipts` in `handoffs.sends` (`ws.apps.list()`), plus Docket, Home and Dispatch and, until they are handled, the old 1:1s app (`oneonones.handoffs`) (workshop `docs/handoffs.md`). Writes its own summary (`receipts.summary`: the receipts count) for Home's Get started. Offers with `accepted: true` (captures from Home and the Dispatch hub) are added with no click, as an entry with id `h-<app>-<offer id>`, so each is added once. An offer's `payload.about` may name one of your reports (`p_...`); otherwise it is about you.

**Moving from 1:1s.** On first open, Rapport copies the old 1:1s app's people and settings (only if Rapport has none yet) and its notes (any not already here) into the paths above, and says so once. The old files in `<Workshop folder>/oneonones/` are never changed or removed. For 30 days after that first copy, notes still in the old folder and missing here are copied on each open; after that a note removed by hand stays removed.

**Draft talking points** (optional): with the opencode connector on and allowed in People and links, sends the prep (without the name, and without concerns unless ticked for that run) to Tandem's `/one-on-one` through the connector's `oneonone.draft` and `oneonone.result` actions. It drafts only; **Add to the note** appends it. Needs Tandem Core 2.8.0 or later. Nothing else uses the network.

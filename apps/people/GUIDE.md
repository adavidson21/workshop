# People

Receipts, 1:1s and goals for you, your reports and your manager. People was called Rapport until November 2026, and Receipts before 2.0.0, when it took in the 1:1s app; its app id is still `people`, so its data, folder and links did not move. Full guide: [README.md](README.md).

- **People** (home): My team, you, your reports, your manager and the peers you meet with, whoever is due for a 1:1 first.
- **The Log box** on every page adds a receipt: about the open page's person, the About you pick, or `@handle` at the start.
- **A person's page**: 1:1 (Bring up, today's note, Wrap up, Copy for Lattice), Log, Goals (reports) and Review, as that person has them. You: Log and Review. Peers: 1:1.
- **My team**: the team's goals as a tree, with Import from Lattice.
- **Wrap up** sends ticked follow-ups to Tasks as tasks (yours, or handed to the person and waiting on them) and ticked wins to a report's Log (evidence "From a 1:1"). Each line goes once. With Tandem on, it can ask Tandem to read the note first.
- **Copy for Lattice**: talking points, a receipt, a goal, a review section, or the whole review. Concerns are never copied.
- **Settings**: Workshop's Settings, Apps, People (review cycle, review sections, flag a report after, Tandem in 1:1s), stored as People's app settings (`docs/app-settings.md`). Until 5.0.0 they were in `config.meta` (copied once; `meta.settingsMovedAt`, `meta.tandemMovedAt`). People: Settings, Directory.

`N` focuses the Log box, Enter saves. With a note or goals doc open `Ctrl+S` saves and `Ctrl+E` switches Edit and Preview. Palette commands: Log a receipt, Prep a 1:1, Build my review, Open team goals.

Routes (after `#/people/`): `people` (or nothing), `me`, `me/review`, `p/<person id>[/1on1|log|goals|review]`, `p/<id>/goals/<yyyy-qN>`, `o/<1:1s id>` (someone not in People), `up` (your manager), `team[/<yyyy-qN>[/team]]`. People 4 addresses (`team/<id>`, `1on1s[/<id>]`, `goals[/...]`, `review`, `settings`) open the same places.

Data, all under the `people` app through the SDK like every other app:

| Collection or file | Holds |
| --- | --- |
| `entries`, `config` | Receipts and settings. Reports are in the people directory, not here. |
| `oneonones/people` | People you have 1:1s with: `{id, personId, name, cadenceDays, archived}`. `personId` is the person in the people directory; `id` names their notes folder. |
| `oneonones/settings` | No items. `meta.aiDraft` (read once, into the Tandem setting, since 5.0.0), `meta.moved` (the copy from the old 1:1s app). |
| `oneonones/notes/<person>/<yyyy-mm-dd>.md` | 1:1 notes, plain Markdown files (`ws.files`). |
| `goals/team/<yyyy-qN>.md`, `goals/<person>/<yyyy-qN>.md` | Goals for the team and each report, one plain Markdown file per quarter (`ws.files`). `<person>` is the person id as a folder (`p_mh3k9x2a` is `p-mh3k9x2a`). |

Reads and changes Workshop's people directory through `ws.people` (workshop `docs/people.md`): your reports are its `report` people (People adds and edits them there) and Upward is its manager. Each 1:1s person is a directory person (`personId`). Reads Tasks' summary (`tasks.summary`, its `people` card by person id, including tasks on groups they are in; workshop `docs/summaries.md`) for 1:1 prep (never Tasks' own collections), and the `handoffs` offers of every app whose manifest lists `people` in `handoffs.sends` (`ws.apps.list()`), plus Tasks, Home and Dispatch and, until they are handled, the old 1:1s app (`oneonones.handoffs`) (workshop `docs/handoffs.md`). Writes its own summary (`people.summary`: the receipts count) for Home's Get started. Offers with `accepted: true` (captures from Home and the Dispatch hub) are added with no click, as an entry with id `h-<app>-<offer id>`, so each is added once. An offer's `payload.about` may name one of your reports (`p_...`); otherwise it is about you.

**Moving from 1:1s.** On first open, People copies the old 1:1s app's people and settings (only if People has none yet) and its notes (any not already here) into the paths above, and says so once. The old files in `<Workshop folder>/oneonones/` are never changed or removed. For 30 days after that first copy, notes still in the old folder and missing here are copied on each open; after that a note removed by hand stays removed.

**Draft talking points with Tandem** and Wrap up's **Ask Tandem** (optional): with the opencode connector on and Tandem in 1:1s on in Settings, Apps, People. Drafting sends the prep (without the name, and without concerns unless ticked for that run) to Tandem's `/one-on-one` through the connector's `oneonone.draft` and `oneonone.result` actions. It drafts only; **Add to the note** appends it. Ask Tandem sends the note's lines (the name left out) through `oneonone.tidy`. Needs Tandem Core 2.8.0 or later. Nothing else uses the network.

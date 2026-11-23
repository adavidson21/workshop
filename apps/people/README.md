# People

Your private notebook about the people you work with, next to Lattice. Lattice is the shared record: goals, 1:1 agendas, reviews, feedback. People is where you write things down as they happen, prep and take your 1:1s, draft goals and reviews, and then hand the finished words to Lattice with one button.

**5.1.0.** Wrap up's default is Just my lines; Ask Tandem is one click away. When you ask Tandem to read the note and open another person, it keeps reading: a toast says when it is done, and Wrap up on that note uses what it found. It waits up to 30 minutes (15 before), for a local model.

**5.0.0 (People redesign).** One way to do each thing:

- **People** is the home page: My team's goals, you, your reports, your manager, and the peers you meet with, whoever is due for a 1:1 on top. Each row says when your next 1:1 is, what is new since the last one, and when you last logged something. **Review season** swaps the middle column for how many review sections each person has receipts in.
- **One Log box** at the top of every page adds a receipt. It is about whoever's page is open, or pick in About, or start the line with `@handle`. Sections show once you type; Enter saves.
- **One page per person**, the same for everyone, with the tabs they have:
  - **1:1** (reports, your manager, peers): Bring up (open follow-ups from last time, what is waiting on them in Tasks and Builds, new receipts) beside today's note. **Wrap up** sends follow-ups to Tasks and wins to their Log. **Copy for Lattice** puts talking points on your clipboard for Lattice's shared agenda. How often you meet is in the page header.
  - **Log** (you, reports, your manager): their receipts, filtered by kind with counts. Click a line to edit it. Tasks' offers wait on top to Keep or Dismiss.
  - **Goals** (reports): their OKRs for a quarter, one Markdown file. Click a progress value to update that line.
  - **Review** (you, reports, your manager): a draft per review section, editable, with Copy per section and Copy all for Lattice.
- **My team** holds the team's goals as a tree, each report's objectives under the team objective they support, with **Import from Lattice**.
- **Copy for Lattice** is the one way out, in four places: talking points, a receipt, a goal, a review section. **Concerns never leave People**: they are left out of every copy.
- **Settings** for People (review cycle, review sections, flag a report after, Tandem in 1:1s) are in Workshop's Settings, Apps, People. People are added and changed only in Settings, Directory. Backups are in Settings, Data & backups.

Gone in 5.0.0: the Me, Reports, 1:1s, Goals, Upward, Review and Settings tabs, the Upward switch (your manager is a person like anyone else), adding or editing reports in People, People and links, Add on each report, Build review, Copy as quick-add lines, and Tidy notes as its own step (Wrap up asks Tandem when Tandem is on). Old addresses (`team/<id>`, `1on1s`, `goals`, `review`, `up`, `settings`) still open the right place.

People was called People until 2.0.0, when it took in Workshop's 1:1s app. The app id stays `people`, so nothing you saved moved. An app in Workshop (`apps/people/`). Open it from the rail, or in its own window with **Pop out**.

**Its look:** Workshop's look (`shared/themes.css`) with People's own color.

Successor to [TaskLedger](https://github.com/adavidson21/TaskLedger), the Android brag-book app. Nothing leaves your device; the optional Tandem steps go only to your own opencode agents through Workshop's connector.

## What it does

- **Receipts** for you (wins, feedback you received, things you learned, blockers), each report (wins, feedback given, growth areas, concerns) and your manager (support received, feedback to share, asks). Star the ones that should lead a review. Every receipt can carry review sections, impact, a metric, evidence and who was involved.
- **1:1s.** Reports are in 1:1s without adding them. Anyone else in People (your manager, a peer, a contact) gets 1:1s with **Start 1:1s** on their page. Notes are plain Markdown files. **Wrap up** reads the note's open follow-ups (`- [ ]` lines) and its Wins: each ticked follow-up goes to Tasks as a task, yours or handed to the person and waiting on them (owner guessed from `@me`, "I will", your name, or theirs), sent once however often you wrap up; each ticked win becomes a receipt in a report's Log. Where Tasks does not share People's data, the follow-ups are copied as Tasks quick-add lines instead.
- **Tandem in 1:1s** (optional; Settings, Apps, People, and the opencode connector): **Draft talking points with Tandem** from the prep (no name, concerns only when ticked), and at Wrap up, **Ask Tandem** to read the note for follow-ups and wins you did not mark. Its lines are marked in the dialog and go into the note when you send them.
- **Goals**: the team's and each report's OKRs per quarter as plain Markdown (format below), shown as a tree on My team. Renaming a team objective offers to update the reports that support it. Start a doc from the template or copy last quarter's.
- **Import from Lattice** (My team): paste a goals export (CSV, or rows copied from a spreadsheet, with a header row such as Goal, Owner, Progress, Status, Parent goal) or pick the file. Goals are matched to your reports by name (yours and "Team" go to the team doc); a goal whose parent has the same owner becomes a key result of it, and any other parent becomes a `Supports:` line. The review step shows New, Changes or No change per objective and asks for a person when an owner is not found. Only the lines that change are written; nothing is deleted. The exact columns of a Lattice export are not confirmed yet, so the importer reads headers by name.
- **Review**: pick a period (your review cycle, this or last quarter, this year, last 12 months). Each review section shows its receipts as a draft you can edit and copy; receipts with no section are listed under No section. CSV of the period too.
- **From other apps** (inside Workshop): finished tasks you ticked in Tasks' Wrap up wait on top of your Log to Keep or Dismiss. A receipt captured in the top bar's Capture (`r ...`) or Chat is added straight away. People reads other apps' offers but never changes their data.
- **Focus hours**: receipts picked up during focus or lunch are added without a toast and counted for Workshop's release toast.

Shortcuts: `N` jumps to the Log box, Enter saves (Shift+Enter for a new line). With a note or goals doc open, `Ctrl+S` saves and `Ctrl+E` switches Edit and Preview. In the goals tree, arrow keys move, open and close, `Enter` opens, `*` opens every sibling. Palette commands: Log a receipt, Prep a 1:1, Build my review, Open team goals.

### Goals format

Plain Markdown with one small convention, readable anywhere:

```markdown
# Platform team, Q4 2026

## Make releases boring

Why: deploys are the top source of after-hours pages.

- Cut median deploy time from 22 to 15 min: 18 min [on track]
  - Measured from the deploy dashboard, weekly median.
- Roll back any service in under 5 min: 40% [at risk]
- Zero Sev-1s caused by a deploy: done
```

- `# ` is the doc title (optional). Each `## ` heading is an objective.
- Top-level bullets in an objective are its key results; indented bullets under one are its notes.
- Progress is what follows the last `: `: a percent (`40%`), a number with an optional unit (`18 min`, `3`) or `done`. Say where a number is going (`from 22 to 15 min`, `to 15`, `above 90`) and the bar fills; `under 300 ms` with no start shows the number only.
- A status at the very end: `[on track]`, `[at risk]`, `[off track]`, `[done]`.
- In a report's doc, `Supports: <team objective>` on its own line places that objective under the team objective with the same title.
- Everything else is ordinary Markdown, tables included.

## Privacy: nothing leaves the device

- No accounts, no server, no analytics, no AI, no third-party requests. Fonts are self-hosted.
- The page's Content Security Policy only allows requests to this site itself, plus Workshop on `127.0.0.1` if you pair it. The Worker sends the same CSP as a header.
- Receipts and 1:1 notes are saved in this browser (IndexedDB) by default. In Chrome or Edge you can **Save to a folder** in Settings to keep them as JSON files on your computer instead, which you can back up however your company allows.
- **Back up** downloads a JSON file; **Restore** merges one back in and never deletes anything.
- Inside Workshop, People uses Workshop's storage (browser, folder, or the Workshop agent on your computer).
- **Copy for Lattice copies only what you click**, to your clipboard. People never talks to Lattice.
- **1:1 notes and goals are private to People.** What People tells other apps is its summary: how many receipts are logged, which 1:1s are due (names and days, for Home's Needs you) and your own wins this week (for Home's weekly status). People about anyone else never leave People. Its manifest sets `privateFiles: true` ([Workshop docs/app-manifest.md](https://github.com/adavidson21/workshop/blob/main/docs/app-manifest.md), Private files), so other Workshop apps (Notes included) can't list, read or watch People's files. People's summary cards for Home and 1:1 prep carry counts and names, never note text.

Browser storage is per site: anything saved on the old receipts.alexisdavidson.org site in browser storage is not visible in Workshop unless both used the same folder. Back it up there and restore it in Workshop.

## How it is built

Plain HTML, CSS and JavaScript modules. No build step, no dependencies.

```
app.json, index.html,   the app (a Workshop app, apps/people/)
  app.css, icon.svg
js/state.js             pure logic: periods, filters, review builder, CSV, offers from other apps
js/lattice.js           pure logic: Copy for Lattice text, reading and applying a Lattice goals export
js/main.js              the page: People, the Log box, a person's page, routes, input, data through the SDK
js/markdown.js          the escaping Markdown renderer for 1:1 notes and goals
js/oneonones/           the 1:1 tab: model.js and view.js (pure), data.js (SDK, no DOM), page.js
js/goals/               goals: model.js and view.js (pure), page.js (the tree, a doc, Import from Lattice)
test/                   node tests for state.js, the 1:1s and Goals modules
GUIDE.md                data reference (collections, files, moving from 1:1s)
```

Data uses Workshop's envelope format (collections `entries`, `people`, `config`, `oneonones/people`, `oneonones/settings` and `handoffs` (follow-ups sent to Tasks, read by Tasks, kept 60 days), plus Workshop's people directory `settings.people`, read only; `config.meta.handled` lists offers already accepted or dismissed) with change stamps, so two open windows merge instead of overwriting each other. 1:1 notes are Markdown files under `oneonones/notes/`, and goals under `goals/team/<yyyy-qN>.md` and `goals/<person>/<yyyy-qN>.md`. Details in [GUIDE.md](GUIDE.md).

People uses Workshop's public shared files (`../../shared/`, listed in Workshop's `docs/shared.md`) and nothing from other apps; `tests/check-boundaries.mjs` checks it.

### Tests

From Workshop's root: `node --test "apps/people/test/*.test.mjs"`. Workshop's `tests/e2e.py` drives People in the shell.

### Releases

A merge to Workshop's `main` deploys it. Bump `version` in `app.json` when shipping a change.

## License

[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0), see `LICENSE`. Free to use, change and share, including at work; not for building a product that competes with it. Versions up to November 5, 2026 were MIT and stay MIT. Bundled fonts keep their own licenses: Workshop's `shared/fonts/OFL-*.txt`.

# Rapport

Receipts, 1:1s and goals for you, your reports and your manager. Write down what you and your people did as it happens, tag it with your review form's sections, prep every 1:1 from what you already know, keep the team's OKRs as a tree, and when review season comes, Rapport turns it into a draft grouped by section, with the gaps called out.

Rapport was called Receipts until 2.0.0, when it took in Workshop's 1:1s app. The app id stays `receipts`, so nothing you saved moved.

An app in Workshop (`apps/receipts/`, moved from adavidson21/receipts on Nov 11, 2026). Open it from the rail, or in its own window with **Pop out**.

**Its look** (Rapport 4.0.0): Workshop's look (`shared/themes.css`) with Rapport's own pine green. Figures and titles in Schibsted Grotesk, labels and dates in the text face, filled sentence-case chips, and the composer, receipts, stats and the review draft on raised white sheets. Plan: Workshop project `claude/workshop-redesign-v1-plan.md`.

Successor to [TaskLedger](https://github.com/adavidson21/TaskLedger), the Android brag-book app. Rapport drops the AI and email steps so nothing ever leaves your device (the 1:1 draft step below is optional and off unless you run Workshop's opencode connector).

## What it does

- **Me** (the main area): your own receipts for a self review. Wins, feedback you received, things you learned, blockers, notes. Star the ones you want at the top of your review.
- **Reports**: one page per direct report. At the top, your 1:1 with them: since your last 1:1, what Docket and Rapport know (open and waiting tasks, nudges, receipts, last time's open follow-ups), next to today's note, a plain Markdown file. Below, their wins, feedback you gave, growth areas, and concerns. The list flags anyone you haven't noted anything about in 30 days (configurable).
- **Focus hours** (inside Workshop, Settings, Focus hours; [Workshop docs/focus.md](https://github.com/adavidson21/workshop/blob/main/docs/focus.md)): receipts captured in Home or the Dispatch hub during focus or lunch are still added, without a toast, and counted (a number only) in Rapport's `held` summary card for Workshop's release toast.
- **Delegated in Slate** (inside Workshop with Slate on): a report's 1:1 prep lists what Slate delegated to them and where it stands, from Slate's summary. Click one to open it in Slate.
- **1:1s**: everyone you meet with, sorted by who is due (no note yet, or the last note is as old as their cadence): reports, your manager, peers, skip-levels. **People and links** sets each person's cadence and links. After a 1:1, **Log follow-ups** copies open follow-ups as Docket quick-add lines and turns the wins you tick into receipts about that report. **Draft talking points** (optional, needs Workshop on your computer with the opencode connector and Tandem) drafts from the prep without the person's name.
- **Goals**: the team's and each report's OKRs for a quarter, as a tree: team objectives at the top, each report objective nested under the team objective it supports, and a **Not aligned** group for the rest. Each objective shows its progress (the mean of its measured key results) and the worst status among them. Click a key result's progress to update it in place (only that line of the file changes). Each doc is a plain Markdown file with Edit, Preview and Split; **Supports** can be changed from Preview, and renaming a team objective in Rapport offers to update the reports' docs that support it. Start a doc from the template or copy last quarter's (progress reset to 0%). Format in [Goals format](#goals-format).
- **Upward** (optional, off until you turn it on): support you got from your manager, asks, and feedback to share, for upward reviews and skip-levels.
- **Review**: pick who and a period (your review cycle, this quarter, last quarter, this year, last 12 months). Shows coverage per section, flags sections with no receipts, and builds a plain-text draft you can copy or download. CSV export too.
- **From Docket** (inside Workshop): finished tasks you ticked in Docket's Wrap up wait at the top of Me. Edit the line or kind, then **Accept** (it becomes a receipt dated that day, evidence "From Docket") or **Dismiss**. Rapport reads Docket's offers but never changes Docket's data, and remembers what you handled in its own settings (Workshop's [handoffs contract](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)).
- **From Home and Dispatch** (inside Workshop): a receipt you capture in Home's quick capture (`r ...`) or the Dispatch hub is added straight away, since you already accepted it where you typed it (evidence "From Home" or "From Dispatch"). Each capture is added once; deleting the receipt does not bring it back.
- **Moving from 1:1s** (inside Workshop): the first time Rapport 2.0.0 opens, it copies the old 1:1s app's people, settings and notes in and says so once. The old files are kept. Wins the old app offered and you never handled still wait in Me.
- **People from Workshop**: when Workshop's people directory exists (Workshop's People app), Reports lists your direct reports from it and Upward uses your manager's name. You edit people there, once, for every Workshop app. Rapport keeps its own list and goes back to it only where there is no directory (for example on this site with browser storage). Old receipts keep pointing at the right person: the directory keeps the same person ids.
- **Settings**: your review cycle dates, your company's review sections (one per line), backups.

Shortcuts: `N` jumps to the box for a new receipt, `Ctrl+Enter` saves it. On the 1:1s tab `j`/`k` move and `Enter` opens; in a note or a goals doc `Ctrl+S` saves and `Ctrl+E` switches Edit and Preview. In the goals tree, arrow keys move, open and close, `Enter` opens an objective's doc, `*` opens every sibling.

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
- Inside Workshop, Rapport uses Workshop's storage (browser, folder, or the Workshop agent on your computer).
- **1:1 notes and goals are private to Rapport.** What Rapport tells other apps is its summary: how many receipts are logged, which 1:1s are due (names and days, for Home's Needs you) and your own wins this week (for Home's weekly status). Receipts about anyone else never leave Rapport. Its manifest sets `privateFiles: true` ([Workshop docs/app-manifest.md](https://github.com/adavidson21/workshop/blob/main/docs/app-manifest.md), Private files), so other Workshop apps (Notes included) can't list, read or watch Rapport's files. Rapport's summary cards for Home and 1:1 prep carry counts and names, never note text.

Browser storage is per site: anything saved on the old receipts.alexisdavidson.org site in browser storage is not visible in Workshop unless both used the same folder. Back it up there and restore it in Workshop.

## How it is built

Plain HTML, CSS and JavaScript modules. No build step, no dependencies.

```
app.json, index.html,   the app (a Workshop app, apps/receipts/)
  app.css, icon.svg
js/state.js             pure logic: periods, filters, review builder, CSV, offers from other apps
js/main.js              the page: rendering, input, data through the SDK
js/markdown.js          the escaping Markdown renderer for 1:1 notes and goals
js/oneonones/           the 1:1s parts: model.js and view.js (pure), data.js (SDK, no DOM),
                        page.js (the 1:1s tab and the section on a report's page)
js/goals/               the Goals tab: model.js and view.js (pure), page.js (the tree and a doc)
test/                   node tests for state.js, the 1:1s and Goals modules
GUIDE.md                data reference (collections, files, moving from 1:1s)
```

Data uses Workshop's envelope format (collections `entries`, `people`, `config`, `oneonones/people` and `oneonones/settings`, plus Workshop's people directory `settings.people`, read only; `config.meta.handled` lists offers already accepted or dismissed) with change stamps, so two open windows merge instead of overwriting each other. 1:1 notes are Markdown files under `oneonones/notes/`, and goals under `goals/team/<yyyy-qN>.md` and `goals/<person>/<yyyy-qN>.md`. Details in [GUIDE.md](GUIDE.md).

Rapport uses Workshop's public shared files (`../../shared/`, listed in Workshop's `docs/shared.md`) and nothing from other apps; `tests/check-boundaries.mjs` checks it.

### Tests

From Workshop's root: `node --test "apps/receipts/test/*.test.mjs"`. Workshop's `tests/e2e.py` drives Rapport in the shell.

### Releases

A merge to Workshop's `main` deploys it. Bump `version` in `app.json` when shipping a change.

## License

[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0), see `LICENSE`. Free to use, change and share, including at work; not for building a product that competes with it. Versions up to November 5, 2026 were MIT and stay MIT. Bundled fonts keep their own licenses: Workshop's `shared/fonts/OFL-*.txt`.

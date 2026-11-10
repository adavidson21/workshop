# Home

Everything at a glance, read only (Home 3.0.0): what needs you in any app, your day in one card, what is coming up and what you finished. Work happens in each app; Docket's Today is where the day's tasks are sorted, picked and done. The Workshop logo at the top of the rail opens it, and so does the plain address. It has no rail button of its own (`"home": true` in `app.json`, see [docs/app-manifest.md](../../docs/app-manifest.md)).

The **Capture** button in the top bar (or Ctrl+. on any app) is the quick way in from anywhere: type a task, a note, a receipt, a request for Slate (`s <text>`, or `#1234` for an ADO item) or a question for the agents, and send it where it belongs.

What it shows:

- **Greeting** with your name and role, and one **More** menu: **Weekly status**, **Edit profile** (or **Add your name**), and **Get started** once the checklist is hidden.
- **Needs you:** one list of everything waiting on you, from every app's summary (`needs` cards, docs/summaries.md): agents asking a question, Slate items to decide or approve, 1:1s due, and from Docket (its `needs` card, Docket 7.0.0) PRs blocked on you, follow-ups due, work that came back, new ADO items and overdue tasks. Urgent first. When Dispatch also has "pull requests waiting for your review", it is one row: Docket's blocked count, with Dispatch's count as its note. Each row opens the place to act. With focus hours on (Settings, Focus hours; docs/focus.md), during focus only pull requests blocked on you show (Docket's `blocking` summary card) and the rest folds to "N items held until 1:00"; during lunch the whole list folds.
- **Weekly status** (in More, and a labeled button on Friday afternoons) drafts your status update from every app's `done-week` card (tasks finished in Docket, decisions in Slate, runs shipped with Dispatch, your wins in Rapport), with Next week and Risks headings to fill in. Edit, then Copy.
- **Your day:** Docket's day in one card, from its summary's `board` and `day` cards. One line for the block you are in and the next ("Focus until 2:30 PM, then Admin and inbox"), or **Plan the day** when there is no plan. Today's tasks, grouped under their blocks, then Not scheduled (at most 8, then "and N more"). One footer line: to sort, overdue, due this week. One button: **Pick today's tasks** when Today is empty, **Wrap up** from an hour before your day ends (Docket's Day view settings; 15:00 if no sprint is set; working days only; **Day wrapped** after, with receipts offered to Rapport in its tooltip), otherwise **Open Docket**. Everything opens Docket's Today.
- **Get started:** a checklist for someone new, under the greeting. It opens expanded until every core step is done or skipped (fold it to one line and it stays folded). Each step ticks itself off when Workshop sees it done, and the open step says exactly what to do next, with commands to copy and buttons to the right app:
  1. Connect Workshop on this computer: **Work computer** (the default: the work mode installer) or **Personal computer** (the usual one, then Connect). The choice is saved.
  2. Add yourself: opens Settings, People with a person set to **You** (your name filled in from Home's profile if you set one). Home greets you by that name.
  3. Keep your data backed up: company OneDrive in work mode, otherwise any folder your computer backs up.
  4. Connect Azure DevOps: a PAT with Work Items (Read & write) and Code (Read), `workshop pat`, then Settings on this computer.
  5. Pick your apps: one line per app, with Slate and Dispatch suggested off when neither Azure DevOps nor Dispatch is set up. **These look right** ticks it off; Settings, Apps has the switches.
  6. Add your team, and set your team's area paths (needs Azure DevOps; skipped with it).
  7. Add your first task in Docket, and log your first receipt.
  Later: Dispatch, and start at login. Any step can be skipped. **Hide** puts it away, and **Get started** in the More menu brings it back. **Check again** re-reads everything at once; otherwise it follows the apps and connectors as they change.
- **Agents:** prompts waiting for you and agents working, from the opencode connector. Needs Workshop running on this computer with the connector on.

## Data

Home reads Docket only through its summary ([docs/summaries.md](../../docs/summaries.md)): today's entry of the `board` card and of the `day` card (Your day and Wrap up), and its `needs` card (Needs you), and updates when it changes. No summary yet reads as an empty board; one with no entry for today says to open Docket; a newer version says to update Workshop.

It never calls ADO itself.

Its own data is two collections, each with no items:

- `profile` (`home.profile` v1): `meta: {name, role}`.
- `setup` (`home.setup` v1): `meta: {hidden, skipped: [step ids], updatedAt}`. The checklist reads everything else live and read-only: Receipts' `entries`, and with Workshop on this computer the ADO and opencode connectors' status, the ADO connector's settings (never a PAT) and `features` from the config.

In browser mode, when Chrome must be asked again for the Workshop folder, Home shows a message pointing to the **Allow** bar instead of an empty page, offers no profile editing and saves nothing. Once access is back (`online` turns true) it loads the profile, board and agents again.

## Code

`js/view.js` has the numbers and the HTML as pure functions (tested in `test/`, `node --test "apps/home/test/*.test.mjs"`). `js/data.js` loads and saves through the SDK, including the wait for folder access (tested with a fake SDK). `js/setup.js` is the Get started checklist: facts read through the SDK, which steps are done (pure), its HTML (pure), and saving hide and skip (all tested in `test/setup.test.mjs`). `js/main.js` connects, paints, and handles clicks. Home does not import Docket's code and repeats none of its rules: every number comes from Docket's summary.

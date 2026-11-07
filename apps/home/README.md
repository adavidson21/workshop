# Home

Your day at a glance. The Workshop logo at the top of the rail opens it, and so does the plain address. It has no rail button of its own (`"home": true` in `app.json`, see [docs/app-manifest.md](../../docs/app-manifest.md)).

The **Capture** button in the top bar (or Ctrl+. on any app) is the quick way in from anywhere: type a task, a note, a receipt, a request for Slate (`s <text>`, or `#1234` for an ADO item) or a question for the agents, and send it where it belongs.

What it shows:

- **Greeting** with your name and role. Use **Add your name** (or **Edit profile**) to set them.
- **Needs you:** one list of everything waiting on you, from every app's summary (`needs` cards, docs/summaries.md): agents asking a question, Slate items to decide or approve, pull requests to review, 1:1s due. Urgent first. Docket's own counts are on the Today card instead. Each row opens the place to act.
- **Weekly status:** the document button by your name drafts your status update from every app's `done-week` card (tasks finished in Docket, decisions in Slate, runs shipped with Dispatch, your wins in Rapport), with Next week and Risks headings to fill in. Edit, then Copy. It is the highlighted button on Friday afternoons.
- **Your day:** buttons for Triage (with the count), Plan today (or Pick today's tasks when Today is empty) and Wrap up the day. The one that needs doing is highlighted. Wrap up the day is highlighted from an hour before your day ends (Docket's Day view settings; 15:00 if no sprint is set), on working days only. After Docket's Wrap up it reads **Day wrapped**. Its tooltip counts receipts offered to Receipts today. Reads Docket's `focus/days/<yyyy>` and `handoffs` at version 1 only.
- **Get started:** a checklist for someone new, under the greeting. It opens expanded until every core step is done or skipped (fold it to one line and it stays folded). Each step ticks itself off when Workshop sees it done, and the open step says exactly what to do next, with commands to copy and buttons to the right app:
  1. Connect Workshop on this computer: **Work computer** (the default: the work mode installer) or **Personal computer** (the usual one, then Connect). The choice is saved.
  2. Add yourself: opens Settings, People with a person set to **You** (your name filled in from Home's profile if you set one). Home greets you by that name.
  3. Keep your data backed up: company OneDrive in work mode, otherwise any folder your computer backs up.
  4. Connect Azure DevOps: a PAT with Work Items (Read & write) and Code (Read), `workshop pat`, then Settings on this computer.
  5. Pick your apps: one line per app, with Slate and Dispatch suggested off when neither Azure DevOps nor Dispatch is set up. **These look right** ticks it off; Settings, Apps has the switches.
  6. Add your team, and set your team's area paths (needs Azure DevOps; skipped with it).
  7. Add your first task in Docket, and log your first receipt.
  Later: Dispatch, and start at login. Any step can be skipped. **Hide** puts it away, and **Get started** next to the greeting brings it back. **Check again** re-reads everything at once; otherwise it follows the apps and connectors as they change.
- **Today:** Docket's day in counts, from its summary's `board` card: tasks on Today (done out of total, and open tasks), to triage, follow-ups due on work you handed over (and how many came back), and overdue (and due this week). **Open Today** and each count open Docket's Today, which is where the day happens: its Needs you strip handles each of these in place. Up next, the block on now and people live there, not on Home.
- **Agents:** prompts waiting for you and agents working, from the opencode connector. Needs Workshop running on this computer with the connector on.

## Data

Home reads Docket only through its summary ([docs/summaries.md](../../docs/summaries.md)): today's entry of the `board` card (the Today card) and of the `day` card (Wrap up), and updates when it changes. No summary yet reads as an empty board; one with no entry for today says to open Docket; a newer version says to update Workshop.

It never calls ADO itself.

Its own data is two collections, each with no items:

- `profile` (`home.profile` v1): `meta: {name, role}`.
- `setup` (`home.setup` v1): `meta: {hidden, skipped: [step ids], updatedAt}`. The checklist reads everything else live and read-only: Receipts' `entries`, and with Workshop on this computer the ADO and opencode connectors' status, the ADO connector's settings (never a PAT) and `features` from the config.

In browser mode, when Chrome must be asked again for the Workshop folder, Home shows a message pointing to the **Allow** bar instead of an empty page, offers no profile editing and saves nothing. Once access is back (`online` turns true) it loads the profile, board and agents again.

## Code

`js/view.js` has the numbers and the HTML as pure functions (tested in `test/`, `node --test "apps/home/test/*.test.mjs"`). `js/data.js` loads and saves through the SDK, including the wait for folder access (tested with a fake SDK). `js/setup.js` is the Get started checklist: facts read through the SDK, which steps are done (pure), its HTML (pure), and saving hide and skip (all tested in `test/setup.test.mjs`). `js/main.js` connects, paints, and handles clicks. Home does not import Prioritizer's code; the two rules it needs (triaged and stale) are repeated in `view.js`.

# Home

Your day at a glance. The Workshop logo at the top of the rail opens it, and so does the plain address. It has no rail button of its own (`"home": true` in `app.json`, see [docs/app-manifest.md](../../docs/app-manifest.md)).

What it shows:

- **Greeting** with your name and role. Use **Add your name** (or **Edit profile**) to set them.
- **Your day:** buttons for Triage (with the count), Plan today (or Pick today's tasks when Today is empty) and Wrap up the day. The one that needs doing is highlighted. Wrap up the day is highlighted from an hour before your day ends (Docket's Day view settings; 15:00 if no sprint is set), on working days only. After Docket's Wrap up it reads **Day wrapped**. Its tooltip counts receipts offered to Receipts today. Reads Docket's `focus/days/<yyyy>` and `handoffs` at version 1 only.
- **Get started:** a checklist for someone new, under the greeting. Each step ticks itself off when Workshop sees it done, and the open step says exactly what to do next, with commands to copy and buttons to the right app:
  1. Connect Workshop on this computer (the installer command for your system, then Connect).
  2. Add your name.
  3. Connect Azure DevOps: the PAT scopes, `workshop pat`, then Settings on this computer (or Import settings from a file). It names the PAT variable when only the token is missing.
  4. Add your first task in Docket (Docket's own tour takes over there).
  5. Log your first receipt.
  Later: Dispatch, and start at login. Any step can be skipped. **Hide** puts it away, and **Get started** next to the greeting brings it back. **Check again** re-reads everything at once; otherwise it follows the apps and connectors as they change.
- **Today at a glance:** tasks on Today (done out of total), tasks to triage, overdue tasks, and tasks due in the next 7 days. Each opens the matching Docket view.
- **Up next:** your top 3 open tasks in rank order, leaving out ones you're waiting on. Click one to open it in Prioritizer.
- **Now:** the Day view's block on now (until when), the tasks planned in it, and the next block. Before the first block it shows the next one. Hidden with no sprint set, on a day off, and after the last block. Reads Docket's `dayplan/settings`, `dayplan/templates` and this year's `dayplan/days`, only at version 1.
- **People:** open tasks and waiting tasks for each person on your board.
- **Agents:** prompts waiting for you and agents working, from the opencode connector. Needs Workshop running on this computer with the connector on.

## Data

Home reads Prioritizer's `tasks`, `lists` and `people` collections read-only, and updates when they change. It reads `prioritizer.tasks` version 3 only and says so if the board is newer.

It never calls ADO itself.

Its own data is two collections, each with no items:

- `profile` (`home.profile` v1): `meta: {name, role}`.
- `setup` (`home.setup` v1): `meta: {hidden, skipped: [step ids], updatedAt}`. The checklist reads everything else live and read-only: Receipts' `entries`, and with Workshop on this computer the ADO and opencode connectors' status, the ADO connector's settings (never a PAT) and `features` from the config.

In browser mode, when Chrome must be asked again for the Workshop folder, Home shows a message pointing to the **Allow** bar instead of an empty page, offers no profile editing and saves nothing. Once access is back (`online` turns true) it loads the profile, board and agents again.

## Code

`js/view.js` has the numbers and the HTML as pure functions (tested in `test/`, `node --test "apps/home/test/*.test.mjs"`). `js/data.js` loads and saves through the SDK, including the wait for folder access (tested with a fake SDK). `js/setup.js` is the Get started checklist: facts read through the SDK, which steps are done (pure), its HTML (pure), and saving hide and skip (all tested in `test/setup.test.mjs`). `js/main.js` connects, paints, and handles clicks. Home does not import Prioritizer's code; the two rules it needs (triaged and stale) are repeated in `view.js`.

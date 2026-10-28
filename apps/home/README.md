# Home

Your day at a glance. The Workshop logo at the top of the rail opens it, and so does the plain address. It has no rail button of its own (`"home": true` in `app.json`, see [docs/app-manifest.md](../../docs/app-manifest.md)).

What it shows:

- **Greeting** with your name and role. Use **Add your name** (or **Edit profile**) to set them.
- **Today at a glance:** tasks on Today (done out of total), tasks to triage, overdue tasks, and tasks due in the next 7 days. Click any of them to open Prioritizer.
- **Up next:** your top 3 open tasks in rank order, leaving out ones you're waiting on. Click one to open it in Prioritizer.
- **People:** open tasks and waiting tasks for each person on your board.
- **Agents:** prompts waiting for you and agents working, from the opencode connector. Needs Workshop running on this computer with the connector on.

## Data

Home reads Prioritizer's `tasks`, `lists` and `people` collections read-only, and updates when they change. It reads `prioritizer.tasks` version 3 only and says so if the board is newer.

Its own data is one collection, `profile` (`home.profile` v1): no items, and `meta: {name, role}`.

In browser mode, when Chrome must be asked again for the Workshop folder, Home shows a message pointing to the **Allow** bar instead of an empty page, offers no profile editing and saves nothing. Once access is back (`online` turns true) it loads the profile, board and agents again.

## Code

`js/view.js` has the numbers and the HTML as pure functions (tested in `test/`, `node --test "apps/home/test/*.test.mjs"`). `js/data.js` loads and saves through the SDK, including the wait for folder access (tested with a fake SDK). `js/main.js` connects, paints, and handles clicks. Home does not import Prioritizer's code; the two rules it needs (triaged and stale) are repeated in `view.js`.

# Needs you (app id `home`)

A panel over the app you are in (Home 4.0.0, `"panel": true` in `app.json`, see [docs/app-manifest.md](../../docs/app-manifest.md)), opened from the **Needs you** button in the top bar on every app, from `#/home`, or from `ws.open({app: 'home'})`. Its count is on the button. `Esc`, the button again or a click on the page behind closes it. Until 4.0.0 it was the Home page; Workshop now opens on the first app on the rail (Docket's Today, where the day happens), so nothing here repeats Docket.

It shows and links; work happens in each app. The **Capture** button in the top bar (or Ctrl+. on any app) is the one place to capture or ask.

What it shows:

- **Needs you:** one list of everything waiting on you, from every app's summary (`needs` cards, docs/summaries.md): agents asking a question, Slate items to decide or approve, 1:1s due, and from Docket (its `needs` card) PRs blocked on you, follow-ups due, work that came back, new ADO items and overdue tasks. Urgent first. When Dispatch also has "pull requests waiting for your review", it is one row: Docket's blocked count, with Dispatch's count as its note. Each row opens the place to act (and closes the panel). With focus hours on (Settings, Focus hours; docs/focus.md), during focus only pull requests blocked on you show (Docket's `blocking` summary card) and the rest folds to "N items held until 1:00"; during lunch the whole list folds. The button's count follows the same rule (the shell shows only the blocking part during focus).
- **Coming up:** dated things in the next two weeks from every app's `upcoming` card (1:1s due, milestones).
- **This week** and **Weekly status** (in More, and a labeled button on Friday afternoons): a draft of your status update from every app's `done-week` card (tasks finished in Docket, decisions in Slate, runs shipped with Dispatch, your wins in Rapport), with Next week and Risks headings to fill in. Edit, then Copy.
- **Get started:** a checklist for someone new. The panel opens by itself once per browser while it is unfinished. It stays expanded until every core step is done or skipped (fold it to one line and it stays folded). Each step ticks itself off when Workshop sees it done, and the open step says exactly what to do next, with commands to copy and buttons to the right app:
  1. Connect Workshop on this computer: **Work computer** (the default: the work mode installer) or **Personal computer** (the usual one, then Connect). The choice is saved.
  2. Add yourself: opens Settings, People with a person set to **You**.
  3. Keep your data backed up: company OneDrive in work mode, otherwise any folder your computer backs up.
  4. Connect Azure DevOps: a PAT with Work Items (Read & write) and Code (Read), `workshop pat`, then Settings on this computer.
  5. Pick your apps: one line per app, with Slate and Dispatch suggested off when neither Azure DevOps nor Dispatch is set up. **These look right** ticks it off; Settings, Apps has the switches.
  6. Add your team, and set your team's area paths (needs Azure DevOps; skipped with it).
  7. Add your first task in Docket, and log your first receipt.
  Later: Dispatch, and start at login. Any step can be skipped. **Hide** puts it away, and **Get started** in the More menu brings it back. **Check again** re-reads everything at once; otherwise it follows the apps and connectors as they change.

## Data

It reads other apps only through their summaries ([docs/summaries.md](../../docs/summaries.md)): every app's `needs`, `upcoming` and `done-week` cards, Docket's `blocking` card during focus, and the task count from Docket's `board` card (Get started), and updates when they change.

It never calls ADO itself.

Its own data is three collections, each with no items. The top bar's Capture writes `handoffs` as this app (`home.handoffs`, [docs/handoffs.md](../../docs/handoffs.md)).

- `profile` (`home.profile` v1): `meta: {name, role}`. Read only since 4.0.0 (a fallback name for Get started); People in Settings has your name.
- `setup` (`home.setup` v1): `meta: {hidden, skipped: [step ids], updatedAt}`. The checklist reads everything else live and read-only: Receipts' `entries`, and with Workshop on this computer the ADO and opencode connectors' status, the ADO connector's settings (never a PAT) and `features` from the config.

In browser mode, when Chrome must be asked again for the Workshop folder, the panel shows a message pointing to the **Allow** bar instead of an empty list and saves nothing. Once access is back (`online` turns true) it loads everything again.

## Code

`js/view.js` has the numbers and the HTML as pure functions (tested in `test/`, `node --test "apps/home/test/*.test.mjs"`). `js/data.js` loads and saves through the SDK, including the wait for folder access (tested with a fake SDK). `js/setup.js` is the Get started checklist: facts read through the SDK, which steps are done (pure), its HTML (pure), and saving hide and skip (all tested in `test/setup.test.mjs`). `js/main.js` connects, paints, sets the button's count and handles clicks. It does not import any other app's code and repeats none of their rules.

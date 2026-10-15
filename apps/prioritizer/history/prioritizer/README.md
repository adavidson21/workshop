# Prioritizer

Part of the [EM Hub](../README.md). It also runs on its own at `/prioritizer/`.


A calm, keyboard-first task app for deciding what to work on. Add a task once and it shows up everywhere.

## How it decides

Each task gets three inputs, usually set in Triage in a few seconds:

- **Value:** Trivial, Low, Medium, High (1 to 4).
- **Effort:** XS, S, M, L, XL, worth 1, 2, 3, 5 and 8 points.
- **Due date:** optional. Without one, a task gets an implied due date from its age: 2 days for High value, 4 for Medium, 7 for Low, 14 for Trivial.

Everything else is derived, so the views can't disagree:

- **Eisenhower:** important means Medium or High value; urgent means due within 3 days, overdue, or flagged urgent.
- **Value / Effort:** high value means Medium or High; low effort means XS or S.
- **Score:** (value + urgency) / effort points, shown next to each task. The bar on the left of a row is its priority tier.

Your manual rank always has the final say. **Suggest order** previews a score-based order before you accept it.

## Views

- **Today:** your short list for the day (3 to 5 works best), plus Up next by score and everything you're waiting on, with follow-up nudges.
- **Triage:** one unsorted or stale task at a time. A task is stale at twice its implied window (4, 8, 14 or 28 days).
- **Prioritize:** List (stack rank with a weekly capacity line), Eisenhower, and Value / Effort. Dragging into a quadrant sets the fields it needs.
- **People:** one card per person, split into "Waiting on them" and "To discuss or do". Handy as a 1:1 agenda.
- **Archive:** a weekly recap you can copy into a status update, with how your work split across quadrants, plus finished and won't-do tasks.
- **Reports:** team-wide ADO reports (priority churn, other teams' work, sprint carryover and scope churn, load, aging) with an Excel export. See below.

The **Scope** in the sidebar (All lists, a list, or a section) filters every view.

## Adding tasks

Press `N` or `Ctrl+K` (`Cmd+K` on a Mac) anywhere. Optional inline tags:

| Tag | Sets | Example |
| --- | --- | --- |
| `@name` | Person | `@Brandon` |
| `!1` to `!4` | Value | `!4` |
| `!!` | Urgent | `!!` |
| `~xs` to `~xl` | Effort | `~m` |
| `^date` | Due: `today`, `tomorrow`, a weekday, `+3d`, or `YYYY-MM-DD` | `^fri` |
| `#name` | List or section (prefix match) | `#eng` |

Example: `Review promo doc @Brandon !3 ~s ^fri #eng`

## Keyboard

`1` to `6` switch views, `J`/`K` move through tasks, `Enter` opens details, `X` completes, `T` toggles Today, `Alt+Up`/`Alt+Down` reorder, `Esc` closes. In Triage: `1` to `4` value, `Q W E R T` effort, `D` due, `U` urgent, `Space` Today, `Enter` save and next, `S` skip, `0` won't do. Press `?` for the full list.

## Themes

Slate (light) and Graphite (dark) follow your system setting by default. Also available: Ivory (warm light), Rosé, Solarized Light, Nord and Dracula, all tuned so text meets WCAG AA contrast. Inside the hub, pick one from the theme button on the hub's rail; on its own, Prioritizer has the button at the bottom of its sidebar. The choice is saved per device and shared by every page of the hub.

Themes live in `shared/themes.css` at the repo root. See the [hub README](../README.md#themes) to change them.

## Saving

- Everything saves automatically in your browser, so it works offline. Nothing leaves your device: there are no accounts and no server.
- The folder icon can keep `prioritizer.xlsx` in a folder you choose (Chrome or Edge), and has Download a copy and Import a file. The Excel file has one sheet per list. Files from the previous version still import.

## Azure DevOps work items

Your ADO Issues, Bugs and User Stories assigned to you, and pull requests waiting on your review, show up as tasks in an **ADO** list, and in All lists next to everything else. Read-only for now.

**How it connects:** a small helper (`prioritizer/ado-helper/ado_helper.py`, Python standard library only) runs on your computer. It reads your PAT from an environment variable and calls your ADO server. The app talks only to the helper at `127.0.0.1`, so the PAT never touches the page or leaves your computer. The helper only answers this site and only on this computer.

**Setup on the work PC:**

1. Download `ado_helper.py` from the ADO button in the sidebar (or from `prioritizer/ado-helper/` in this repo) into a folder you keep.
2. Run `py ado_helper.py`. The first run asks for your collection URL (for example `https://tfs.yourcompany.com/DefaultCollection`) and the name of your PAT environment variable. Settings save to `ado-helper.json` next to the script.
3. Optional: `py ado_helper.py --test` checks the connection and lists what it finds. `py ado_helper.py --startup` starts it hidden at login (`--no-startup` undoes it).
4. In the app, click the ADO button (sync arrows, bottom of the sidebar) and Connect. If the browser asks to allow access to apps on this device, choose Allow.

**What syncing does** (every 10 minutes while the app is open, when you switch back to it, or with Sync now):

- **New work items wait for you to pick them.** The sync button shows a count, and a toast offers Review. In the review list, check what you want and choose **Add**, or **Skip unchecked** to also dismiss the rest for good. **Later** keeps them waiting. Items closed or reassigned before you pick them drop off on their own. To skip this step, choose **Add them automatically** in ADO Settings. PRs are always added automatically.
- Added items become tasks in the ADO list. ADO Priority 1 to 4 sets a starting value (High to Trivial); effort is left for you in Triage. ADO's due or target date fills Due.
- Title, state and due date follow ADO. Your notes, value, effort, rank, Today and people stay yours.
- Resolved, Closed or Done in ADO: completed here. If it gets reactivated, it reopens. Removed in ADO: marked won't do.
- Reassigned to someone else: marked won't do with a note saying who and when, so it's in the Archive. If it comes back to you, it reopens.
- Deleting an ADO task here keeps it from coming back.

Work item types and which states count as closed are in `ado-helper.json` (`types`, `closed_states`, `removed_states`). A PAT with Work Items (Read) is enough for work items.

### Pull requests to review

Active PRs where you or one of your teams is a reviewer become tasks in **ADO > Pull requests**, titled `Review: <PR title>`. Each gets a tier based on how much it's waiting on you:

| Tier | When | Starting value | Urgent |
| --- | --- | --- | --- |
| Blocking | You're a named, required reviewer | High | Yes |
| Asked | You're a named, optional reviewer | Medium | No |
| Team | Only your team was added, so any teammate can take it | Low | No |

A Blocking PR where every other required reviewer has already approved shows **Last approval**. Effort starts at S. Age counts from when the PR was opened, so old PRs rise in Triage.

- **Your vote decides when it's done.** Approve, Approve with suggestions or Reject completes the task. Waiting for author moves it to Waiting with the author attached, so it shows on their People card. If your vote resets after a new push, it comes back to you.
- **Team PRs** complete when a teammate votes for the team.
- **Completed or abandoned** in ADO completes the task. Removed as a reviewer, back to draft, or not found marks it won't do.
- If a PR moves between tiers (for example, someone adds you as required), value and urgent follow unless you've changed them.
- Drafts and your own PRs are skipped. Deleting a PR task keeps it from coming back.

**Setup:** run `py ado_helper.py --add-pr-source` and enter each collection URL and project to watch, optionally limited to some repos. This can be a different collection than your work items, and you can add more than one. Your PAT also needs **Code (Read)**, plus **Project and Team (Read)** for team PRs. `py ado_helper.py --test` lists the PRs it finds by tier and says which scope is missing if one is. In `ado-helper.json`, `pr_teams` limits which of your teams count (empty means all of them).

## Reports

Team-wide, read-only reports from ADO for capacity conversations. Open **Reports** in the sidebar (shortcut `6`).

**Team profile (once):** area paths your team owns (everything under each counts) and your people (email or exact ADO display name). Use both to see work your people do for other teams. It saves on this device. Change it with the dots button.

**Reports:**

| Report | What it shows |
| --- | --- |
| Priority churn | Every Priority change in the window, per week, who made them, and escalations (raised to P1 from lower) with how long the item sat first |
| Other teams' work | Items assigned to your people that live outside your area paths, by owning area, flagged when escalated |
| Sprint carryover | Items moved between sprints, how many times, their path, and open items still sitting in a finished sprint |
| Sprint scope churn | Items added, created or removed after a sprint started (the first day counts as planning), plus items pulled onto or off your team |
| Load by person | Open items per person by priority, hours left and oldest item; profile people with nothing open still show |
| Aging and throughput | Open P1/P2 work by age, and items closed per week against new high-priority work per week |

Pick a window (14 to 180 days) and **Refresh**. The last pull is cached, so Reports opens instantly next time.

**Export** saves `team-reports-<date>.xlsx`: the Workload tracker with every report pre-filled from ADO, a Summary tab of formulas, and blank columns for what ADO can't see (capacity, fire drill and rework hours, why other-team work happened, Teams evidence, risk flags).

**How it works:** the ADO helper (1.2.0 or later) has one read-only endpoint, `POST /dataset`, that returns the team's work items, their priority, sprint, assignment and state changes in the window, and sprint dates. Every report is computed in the app from that pull, so adding a report doesn't need a helper change. Only collections already in `ado-helper.json` can be queried. Work Items (Read) is enough.

Settings in `ado-helper.json`: `high_priorities` (default 1 and 2), `escalation_priority` (default 1), `bug_types`, `workload_types` (empty means the same as `types`), `effort_fields` (hours count Remaining Work only), and `workload_max_items` (how many changed items get their history read, default 1500).

## eng-agents stages

When the hub's **Dashboard** page is connected to your [eng-agents](https://github.com/adavidson21/eng-agents) live dashboard (see the [hub README](../README.md#eng-agents-dashboard)), ADO tasks here show their eng-agents stage next to the ADO chip (Spec, Plan, Build 2/5, Review, and so on). Amber means it needs you, including when autopilot stops for you; a pulsing dot means an agent or autopilot is working. Hover for the next step in plain words, or click to jump to that item on the Dashboard page.

An ADO task not started yet gets **Start as feature** or **Start as bug** in its details. That runs `/start` in opencode for you.

Stages refresh every 30 seconds while the page is open, and right away when you switch back to it. On a device without the dashboard (your phone, say) nothing changes.

## Install it as a desktop app

Install the hub, not Prioritizer on its own: see the [hub README](../README.md#install-it-as-a-desktop-app).

## Code

No build step. `index.html` is the page; `app.css` is Prioritizer's own styles (shared buttons, menus and themes come from `../shared/`). The code is in `js/`, one file per concern, loaded in order by `index.html`:

| File | What's in it |
| --- | --- |
| `constants.js`, `util.js` | Scales, quadrant names, icons; DOM and date helpers |
| `model.js` | Implied due, urgency, score, tiers, quadrants (pure functions) |
| `state.js` | Board shape, migration, sanitize, save with change stamps, per-device UI state |
| `quick-add.js`, `actions.js` | Quick add syntax; task actions |
| `render.js`, `views.js` | Frame, sidebar, header, rows; each view |
| `drawer.js`, `overlays.js`, `command-bar.js` | Task details; modal, menus, toast; the command bar |
| `excel.js`, `folder-sync.js` | Excel export and import; autosave to a folder |
| `drag-drop.js`, `people.js`, `events.js` | Drag and drop; people; global handlers and tooltips |
| `ado.js`, `reports.js`, `eng.js` | ADO sync; team reports; eng-agents stages |
| `main.js` | Startup (loaded last) |

They are classic scripts sharing one scope: a function in one file can call a function in any other, but code that runs at load may only use what earlier files define. When you add a file, add it to `index.html` and to `SHELL` in `../sw.js` (`node tests/check-offline.mjs` catches a miss).

`window.__prioritizer` exposes the model and sync functions for automated checks (see `../tests/e2e.py`).

### Upgrading from the previous version

Boards migrate automatically on first load: High/Low value becomes High (4) or Low (2), Important becomes Medium or Low when no value was set, High/Low effort becomes L or S, and Urgent becomes the urgent flag. Existing tasks keep their created dates, so expect a one-time batch of stale tasks in Triage. Reload each device once after deploying, before editing.

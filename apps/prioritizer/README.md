# Prioritizer

Part of the [Workshop](../../README.md). It also runs on its own at `/workshop/apps/prioritizer/`.


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

Press `N` or `/` anywhere. On its own, `Ctrl+K` (`Cmd+K` on a Mac) works too; inside Workshop, `Ctrl+K` is Workshop's command palette, where **Add a task** is one of the commands. Optional inline tags:

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

Themes live in `shared/themes.css` at the repo root. See the [Workshop README](../../README.md#themes) to change them.

## Saving

- Everything saves automatically. With Workshop running on your computer, the board is a set of files in `~/.workshop/data/prioritizer/` (`lists.json`, `tasks.json`, `people.json`, `settings.json`), so other apps can read it. Without Workshop (browser mode, like the github.io site) it is saved in that browser. Nothing leaves your device: there are no accounts and no server.
- **Two windows stay in sync.** A change in one shows up in the other within a moment, and changes made in both at once are merged task by task: where both changed the same task, the later change wins. Nothing is overwritten wholesale.
- **If a save fails** (for example the disk is full, or Workshop stopped), the folder icon turns red and says "Not saved yet". Your changes stay on screen and are saved as soon as it works again. The file on disk is never left half written: the previous version stays until the new one is complete.
- **The folder icon** is the file menu: it says where the board is saved, and has **Download an Excel copy**, **Download a backup (.json)** and **Import a file** (an Excel file, or a backup). The Excel file has one sheet per list; files from earlier versions still import. A backup is a Workshop bundle (`workshop-<date>.json`) with everything, including ADO settings and deletions, and merges into a board instead of replacing it. The **Settings** app can also export and import every app's data.
- Folder sync (keeping `prioritizer.xlsx` in a folder) is gone: the board is already a file on disk when Workshop runs.

### Moving your board into Workshop

- **Same site, nothing to do.** The first time this version opens, a board saved by an earlier version in the same browser and site moves in by itself, once. The old copy is left in place as a backup.
- **From the github.io site to Workshop on your computer.** A browser can't read another site's storage, so move it with a file: on the github.io site, open the folder icon and choose **Download an Excel copy** (or **Download a backup (.json)** once that site runs this version). Then in Workshop, folder icon, **Import a file**. Into an empty board it comes in as it was; into a board with tasks, Excel asks whether to add or replace, and a backup merges.

## Azure DevOps work items

Your ADO Issues, Bugs and User Stories assigned to you, and pull requests waiting on your review, show up as tasks in an **ADO** list, and in All lists next to everything else. Read-only for now.

**How it connects:** when Workshop runs on your computer (`node agent/start.mjs`) and its ADO connector is on in **Settings**, Prioritizer syncs through the connector, which keeps its connections (server, collection, project, which repo maps to which) in Workshop's settings. Otherwise a small helper (`apps/prioritizer/ado-helper/ado_helper.py`, Python standard library only) runs on your computer instead. Either way your PAT stays in an environment variable on your computer and never touches the page. The helper only answers this site and only on this computer.

**Prioritizer's own ADO settings** are in ADO Settings (the ADO button), saved with your board: how often to sync, whether new work items wait for you, and the starting value and urgent flag for each PR tier. They are not connector settings, so they stay the same whichever way Prioritizer connects.

With the connector, skip the helper steps below: turn the ADO connector on in Settings, add a connection, then click Connect in ADO Settings.

**Setup on the work PC:**

1. Download `ado_helper.py` from the ADO button in the sidebar (or from `apps/prioritizer/ado-helper/` in this repo) into a folder you keep.
2. Run `py ado_helper.py`. The first run asks for your collection URL (for example `https://tfs.yourcompany.com/DefaultCollection`) and the name of your PAT environment variable. Settings save to `ado-helper.json` next to the script.
3. Optional: `py ado_helper.py --test` checks the connection and lists what it finds. `py ado_helper.py --startup` starts it hidden at login (`--no-startup` undoes it).
4. In the app, click the ADO button (sync arrows, bottom of the sidebar) and Connect. If the browser asks to allow access to apps on this device, choose Allow.

**What syncing does** (every 10 minutes by default while the app is open, when you switch back to it, or with Sync now):

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

The starting value and urgent flag are defaults; change them per tier in ADO Settings.

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

When the hub's **Dashboard** page is connected to your [eng-agents](https://github.com/adavidson21/eng-agents) live dashboard (see the [Workshop README](../../README.md#eng-agents-dashboard)), ADO tasks here show their eng-agents stage next to the ADO chip (Spec, Plan, Build 2/5, Review, and so on). Amber means it needs you, including when autopilot stops for you; a pulsing dot means an agent or autopilot is working. Hover for the next step in plain words, or click to jump to that item on the Dashboard page.

An ADO task not started yet gets **Start as feature** or **Start as bug** in its details. That runs `/start` in opencode for you.

Stages refresh every 30 seconds while the page is open, and right away when you switch back to it. On a device without the dashboard (your phone, say) nothing changes.

## Install it as a desktop app

Install Workshop, not Prioritizer on its own: see the [Workshop README](../../README.md#install-it-as-a-desktop-app).

## Code

No build step. `index.html` is the page; `app.json` describes the app to Workshop ([docs/app-manifest.md](../../docs/app-manifest.md)); `app.css` is Prioritizer's own styles (shared buttons, menus and themes come from `../../shared/`). The code is in `js/`, one ES module per concern:

| File | What's in it |
| --- | --- |
| `constants.js`, `util.js` | Scales, quadrant names, icons; DOM and date helpers |
| `model.js` | Implied due, urgency, score, tiers, quadrants (pure functions) |
| `state.js` | Board shape, migration, sanitize, per-window UI state (view, lens, scope) |
| `storage.js`, `store.js`, `store-format.js` | Saving through the SDK and keeping windows in step; the file menu; the board as four collections (pure, tested in `test/`) |
| `quick-add.js`, `actions.js` | Quick add syntax; task actions |
| `render.js`, `views.js` | Frame, sidebar, header, rows; each view |
| `drawer.js`, `overlays.js`, `command-bar.js` | Task details; modal, menus, toast; the command bar |
| `excel.js`, `kv.js` | Excel export and import; a small browser cache for Reports |
| `drag-drop.js`, `people.js`, `events.js` | Drag and drop; people; global handlers and tooltips |
| `ado.js`, `reports.js`, `eng.js` | ADO sync; team reports; eng-agents stages |
| `ws.js` | The connection to Workshop through the SDK (`../../shared/workshop-sdk.js`): shell, data, connectors |
| `main.js` | Startup: the one module `index.html` loads; it imports the rest |

Each module imports what it uses. Modules import each other in a cycle, so code that runs at load must not use another module's state: put that in an init function `main.js` calls (like `adoInit`). Imported bindings are read-only; change another module's variable through its setter (like `setSel`). When you add a file, add it to `files` in `app.json` (`node tests/check-offline.mjs` catches a miss). Talk to the shell, data and connectors only through `ws.js`.

`window.__prioritizer` is the only global: it exposes the model and sync functions for automated checks (see `../../tests/e2e.py`). `node --test "apps/prioritizer/test/*.test.mjs"` tests the storage format and the save engine in Node. `test/fixtures/` holds a synthetic board exported by version 4.0.0 (Excel and its localStorage copy) for the round-trip and move checks.

### Storage format

The board is four collections in the Workshop data format ([docs/data-format.md](../../docs/data-format.md)): `prioritizer.lists` v1, `prioritizer.tasks` v3 (capacity in `meta`), `prioritizer.people` v1 (id is the lower-case name), and `prioritizer.settings` v1 (no items; Prioritizer's own ADO behavior in `meta.ado`). Tasks start at v3 because v1 and v2 were the localStorage board shapes. Which view, lens and scope a window shows is per window, kept with the sidebar state in `localStorage` (`prioritizer.ui`), not in the data. Other apps reading these files should check `schema` and `version` and treat an unknown version as unreadable.

### Upgrading from the previous version

Boards migrate automatically on first load: High/Low value becomes High (4) or Low (2), Important becomes Medium or Low when no value was set, High/Low effort becomes L or S, and Urgent becomes the urgent flag. Existing tasks keep their created dates, so expect a one-time batch of stale tasks in Triage. Reload each device once after deploying, before editing.

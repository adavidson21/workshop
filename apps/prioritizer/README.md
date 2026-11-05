# Docket

Docket (formerly Prioritizer; code, data and URLs inside still say `prioritizer`) runs in three places, all from this repo:

- **On its own** at https://docket.alexisdavidson.org, with nothing else installed. The board is saved in your browser. With Workshop installed on your computer, the folder icon has **Use Workshop on this computer**: it pairs this site with Workshop (the same Connect as in Workshop), and the board becomes files in Workshop's data folder, shared with Workshop's Home. To bring a browser board along, download a backup before connecting and import it after.
- **Inside [Workshop](https://github.com/adavidson21/workshop)** at https://workshop.alexisdavidson.org, as one of its apps. Workshop's Worker proxies `/apps/prioritizer/*` to this site, so every deploy here shows up in Workshop too. With Workshop's agent running, the board is files on your computer that Workshop's Home also reads.
- **On Android** as an app built from `mobile/` (see [mobile/README.md](mobile/README.md)). The board stays on the phone.

A calm, keyboard-first task app for deciding what to work on. Add a task once and it shows up everywhere.

## First run

A brand new board (no tasks) opens a short tour: where your board is saved, adding your first tasks (with the tags, or **Load sample tasks** into a "Samples" list you can delete in one go), how Docket decides, and two optional steps: your sprint and example Day templates, then every-sprint tasks like Sprint planning, Backlog refinement and Release. Every step can be skipped, and closing it counts as skipping. It shows once per board (the date is saved as `meta.onboarded` in `prioritizer.settings`), never on a board that already has tasks, and any time from the keyboard help (`?`, **Show the tour**) or the empty-board buttons.

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
- **Triage:** one unsorted or stale task at a time. Title, notes and list can be edited in place. A task is stale at twice its implied window (4, 8, 14 or 28 days).
- **Prioritize:** List (stack rank with a weekly capacity line), Eisenhower, and Value / Effort. Dragging into a quadrant sets the fields it needs.
- **People:** one card per person or group with something open, plus your team, split into "Waiting on them" and "To discuss or do". Handy as a 1:1 agenda. People and groups come from Workshop's people directory (the People app), so a name is typed once everywhere. A person's card also lists what is assigned to a group they are in, under "Through @leadership", so what is waiting on John includes what is waiting on @leadership. A new `@name` becomes a contact (another team, a vendor). Everyone else in the directory is one click away under the cards.
- **Done** (a tab in Prioritize, next to List, Eisenhower and Value / Effort): a weekly recap you can copy into a status update, with how your work split across quadrants, plus finished and won't-do tasks.
- **Day:** time blocks for today (or any day), built from your sprint. Slot tasks into blocks, and rearrange when the day goes sideways. See below.

The **Lists** in the sidebar (All lists, a list, or a section) filter every view. All lists shows once you have more than one. The same choice is in the menu under each view's title, which also has the **Pull requests** filter once PR reviews sync (see [Pull requests to review](#pull-requests-to-review)).

## Day: time blocks by sprint day

Plan a day as a list of blocks (Deep focus, Meetings, Admin, and so on) and slot real tasks into them. Open **Day** in the sidebar (shortcut `2`).

**Sprint (once):** the first time, Day asks for the start date of any sprint, past or future, and the length (2 weeks by default). Sprints repeat from that date, so "every other Wednesday" is a start date on a Wednesday. The gear button has the rest: workdays (Monday to Friday by default), holidays, and a rough day start and end.

- **Sprint day N** is the Nth working day of the sprint. Weekends and holidays show as off and take no number, so a sprint with a holiday has 9 days. Dates before the start date work too.
- **Sprint id** is `<year>-<n>`: the nth sprint that starts in that calendar year, counted from the start date. The header says, for example, "Sprint 2026-22, day 3 of 10".

**Templates:** a template is an ordered list of blocks for some sprint days (`2-8`, or `1, 3, 5`), or for **Last day**, which always matches the final working day of a sprint, even when a holiday shortens it. A Last day template wins over a numbered one on that day, so "days 2 to 10" and "Last day" never collide. Two numbered templates on the same day, or two Last day templates, show an error in settings and can't be saved. A day no template covers starts empty. Each block has a name, a kind (free text like focus or meetings), a color, and optionally a rough start time, a length in minutes, and a capacity in effort points (the same points as tasks: XS 1 to XL 8). Times are labels, never a grid, and show on a 12-hour clock (9:30 AM). Type them however you like: `9:30a`, `930`, `9pm` or `21:00`; without AM or PM, 1 to 6 means afternoon (`1:30` is 1:30 PM). Starting a sprint can add three example templates (Planning day, Sprint day, Last day) to edit.

**Planning a day:**

- Each date starts as a copy of its template. Changes are for that date only; the template never changes from the Day view. **Reset to template** (in **This day**, or under the blocks) drops the date's changes, after a confirm.
- **Not planned** lists your open tasks in rank order, filtered by the list or section you picked (the scope above the title), with a **Today list** filter for your short list.
- Slot a task by dragging it into a block, by selecting it and pressing `P` then the block's number, with its arrow button (on touch), or from its details: **Plan for** a date and block. Drag it back to Not planned, or use **Back to the tray**, to unplan it.
- In a block, tasks keep their rank order until you move one (`Alt+Up`/`Alt+Down`, or its menu); that order is saved for the day.
- A block over its capacity shows a warning. It doesn't stop you.
- Done tasks stay in their block, crossed out. Deleted tasks drop out.
- The block on now (by its rough time) is highlighted on today, with the next one marked when nothing is on.

**Rearranging, for chaotic days:**

- Reorder blocks by dragging their headers, or `Alt+Up`/`Alt+Down` on a header. Add, edit (rename, recolor, kind, time, capacity) or remove a block for this day only from its menu or **This day**.
- **Lost this block** marks a block gone for today. Its unfinished tasks go to the next open block today (the default), or to the next working day's first block of the same kind (its first block if none matches). With nowhere to go, they go back to Not planned. **Restore** brings the block back.
- **Shift the rest of the day** moves the rough times of the remaining blocks by 15, 30 or 60 minutes, back 15, or any amount. From a block's menu it shifts that block and the ones after it.
- **Undo and redo** (`Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y`, or the arrows in the header) cover every change to a day, per window, up to 50 steps. Completing a task is not part of it; click the check again to reopen.
- **Carry over:** opening a working day shows unfinished tasks planned on the previous working day (skipping weekends and holidays). **Same blocks today** puts each in today's block with the same name, then the same kind, then the first open block. **Put in the tray** lists them first under Not planned.

**Repeating tasks (every day or week):** for things like checking logs every morning, open a task and set **Repeat** to Every workday, Every day or every week on that weekday, with an optional time (shown on the task, like 9:15 AM). Each matching day, a fresh copy is added that morning, due that day and on your Today list, so you check it off daily; the task you set it on counts as today's. Every workday uses your sprint's workdays and skips holidays; no sprint is needed. A copy you didn't finish is closed as won't do when the next one is added, so they don't pile up. With a time and the Day view set up, the copy goes into the block on at that time. **More** (or the gear's settings, under **Repeating tasks**) edits them alongside the every-sprint ones: the **Repeats** menu has every day, every week and every sprint. **Doesn't repeat** stops new copies and keeps the task.

**Every sprint:** for things you do once a sprint (refinement, a release, a focus group), add them under **Every sprint** in the gear's settings: a title, the sprint day it's due on (shown with its weekday, like "Day 4 (Mon wk 2)", or Last day), a value (Low by default), effort and list. Each sprint, a new task is added on its first working day (or as soon as Docket opens after that), due on that day, at the bottom of your rank, so it's visible without taking over and rises as the due date gets close. Finishing one doesn't touch the next sprint's. A sprint whose due day has already passed is skipped. Deleting this sprint's task keeps it gone until the next sprint, and **Pause** stops new ones. With **Plan into** set to a block kind (like meetings), the task is also put in the first open block of that kind on its due day (that day's first open block if none matches). That happens once, when the task is made, so moving or unplanning it sticks. These tasks show an **Every sprint** chip.

**Offered by other apps:** inside Workshop, another app can offer every-sprint tasks to Docket (Workshop's [handoffs contract](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)). Docket reads every app whose manifest lists `prioritizer` in `handoffs.sends` (`ws.apps.list()`; `SENDERS` in `js/offers-model.js`, Home and Dispatch, is the fallback), so a new sender needs no change here. Offers show at the top of **Every sprint** in the gear's settings as "Offered by" the sending app, with the day, block kind, value and effort, and a dot on the gear while any wait. **Accept** adds the every-sprint task (marked **From** that app); **Dismiss** hides the offer. Nothing is added until you click. When the sender changes an offer you already accepted, it shows again with **Update**, which changes that same task (title, day, block kind, value, effort, notes) and keeps its list, pause and the sprints it already made. An offer sent again unchanged does not show again. Docket never writes the other app's data. On its own site Docket shares no data with other apps, so it shows no offers.

**Captures from Home and Dispatch:** inside Workshop, a task captured in Home's quick capture or the Dispatch hub ([docs/hub.md](https://github.com/adavidson21/workshop/blob/main/docs/hub.md)) arrives as an offer with `payload.kind: 'task'` and `accepted: true`: you already accepted it where you typed it, so Docket adds it the next time it loads, with no second click, and says so in a toast. It gets the title, people, waiting on, due date, urgent, value, effort, notes and list (by name; otherwise your first list). The title is never read as Quick add syntax. The task keeps `from: {app, id}`, so the same capture is never added twice.

`[` and `]` step to the previous and next working day; the date box jumps anywhere. Inside Workshop, `#/prioritizer/day/today` (or a date) opens the Day view.

## Focus: start, breadcrumbs, wrap up

- **Start a task** with the play button on a Today row or in Today's header (the top task), **Start** in its details, or `S` on the selected task. One task is active at a time. While it runs, a focus band at the top of the page shows it on every view: the task, how long it has been running, its last breadcrumb, and breadcrumb, interrupted, **Pause** and done buttons. The timer turns amber after 90 minutes, and on its own site the browser tab's title shows the task too. Come back after 20 minutes or more away from the page and Docket asks whether you are still on it, with a Pause button. Inside Workshop, the running task moves to Workshop's top bar instead, so it shows (with the same buttons) on every app; Pause there asks for the breadcrumb right under the bar. Docket loads in the background when Workshop opens, so a task started earlier shows before you open Docket. The active task never carries over to the next day.
- **Breadcrumbs:** when you pause, or switch to another task while one is unfinished, Docket asks "Where did you leave off?" in one line. `Enter` saves, `Esc` skips. The last one shows under the task on Today and in the bar when you start it again, and its details list the newest three. **Add a breadcrumb** in its details, or the pencil in the focus band, leaves one any time.
- **Switch counter:** starting a task while another unfinished one is active counts as a switch. Finishing first and then starting is not one. **Interrupted** (or `I`) logs something that pulled you away without changing the task. Today's counts show in the bar once there is something to count. Nothing watches other apps or your computer: only what you start and log here counts.
- **Wrap up** (on Today, or **Wrap up the day** in Workshop's command palette) goes through what you finished, asks for a breadcrumb on each unfinished task you started today, and picks tomorrow's top 3. Picks get the next working day's Today (by the Day view's sprint workdays and holidays). Today's leftovers you don't pick go back to their lists, so tomorrow opens on only what you chose. Inside Workshop, it also offers each finished task to **Receipts**: tick the ones worth keeping, adjust the line, pick Win, Learned or Note, and they wait in Receipts for you to accept (Workshop's [handoffs contract](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)). It can remind you 30 minutes before the Day view's day end, on that device. Inside Workshop, `#/prioritizer/shutdown` opens it.

## Symbols

Rows and headers use small line icons instead of words; hover (or long-press) any of them for what it means, and `?` lists them all. Color shows up only when something needs you:

- On a row: a red circle for a PR blocked on you or a task that's been urgent too long, amber for due soon (red when overdue), blue for time to nudge or asked to review. Quiet gray for stale, waiting, every sprint, and ADO or PR links (with their number).
- People are initials; the list is a colored dot (each list keeps its color, in the sidebar too). The score shows on hover; the bar on the left is the tier.
- Header buttons are round icons: start the next task, plan the day, wrap up, suggest order, weekly capacity, and the solid + to add a task.
- The bar under the header shows only while a task is running, with interrupted, pause and done, and today's switch and interruption counts.

### Row fields

The sliders button at the bottom of the sidebar picks which optional fields rows show: ADO item and PR numbers, AI review, agent status, due date, repeat, waiting, untouched a while, people, list color, where you left off, score, and the Start and Today buttons. A preview row shows the result as you go; changes apply on **Save**, and **Reset to defaults** shows everything again. It is one setting for every view, the Day view included, saved with the board so every window and Workshop follow it. It only hides: a view that already leaves a field out still does. Alerts that need you show either way (overdue, a blocking or asked PR, a nudge that is due, still urgent, and Pause on the task you are working on), and a task's details always show everything.

## Adding tasks

Press `N` or `/` anywhere. On its own, `Ctrl+K` (`Cmd+K` on a Mac) works too; inside Workshop, `Ctrl+K` is Workshop's command palette, where **Add a task** is one of the commands. Optional inline tags:

| Tag | Sets | Example |
| --- | --- | --- |
| `@name` | Person or group, by handle or name; a new name adds a contact | `@teammate`, `@leadership` |
| `!1` to `!4` | Value | `!4` |
| `!!` | Urgent | `!!` |
| `~xs` to `~xl` | Effort | `~m` |
| `^date` | Due: `today`, `tomorrow`, a weekday, `+3d`, or `YYYY-MM-DD` | `^fri` |
| `#name` | List or section (prefix match) | `#eng` |

Example: `Review design doc @Teammate !3 ~s ^fri #eng`

**Pasting from ADO:** paste a work item from ADO's **Copy to clipboard** (`Issue 12345: Title`) or its URL into the add box, a person's add box, or a task's title, and the task keeps the link: its row gets an ADO chip that opens the item, and its details say **Open Issue #12345 in ADO**. A bare URL starts the title as `ADO 12345: ` for you to finish. Pasted into notes, the URL is kept in the text. If ADO sync later finds the item assigned to you, it takes the task over (no duplicate); until then sync leaves it alone, so an item assigned to someone else is never closed as reassigned. Pasting an item already open on your board offers to open that task instead.

## Keyboard

`1` to `5` switch views in sidebar order (Today, Day, Triage, Prioritize, People), `J`/`K` move through tasks, `Enter` opens details, `X` completes, `T` toggles Today, `S` starts or pauses the selected task, `I` logs an interruption, `Alt+Up`/`Alt+Down` reorder, `Esc` closes. In Triage: `1` to `4` value, `Q W E R T` effort, `D` due, `U` urgent, `Space` Today, `Enter` save and next (also from the title, or `Ctrl+Enter` from notes), `S` skip, `0` won't do. Press `?` for the full list.

## Themes

Light and Dark, in the same editorial style as tools.alexisdavidson.org, follow your system setting by default and meet WCAG AA contrast. Inside the hub, flip between them with the round toggle in the top right corner; on its own, Docket has a theme button at the bottom of its sidebar. The choice is saved per device and shared by every page of the hub. Themes from earlier versions (Slate, Nord, Dracula and the rest) carry over as the closer of Light or Dark.

Themes live in `shared/themes.css`, copied from Workshop (see Files from Workshop below). Change them in Workshop: see the [Workshop README](https://github.com/adavidson21/workshop#themes).

## Saving

- Everything saves automatically. The board is a set of files in the `prioritizer` folder of your Workshop folder (`~/Workshop/prioritizer/` unless you changed it in Settings): `lists.json`, `tasks.json`, `settings.json`. People live in Workshop's people directory (`settings/people.json`). Other apps can read them, and they stay if you remove Workshop. Nothing leaves your device: there are no accounts and no server.
- **Without Workshop running** (browser mode, like Docket's own site before you pair it) Chrome can use the same kind of folder: in **Settings**, **Choose folder**, and pick your Workshop folder. Until you choose one, the board is saved in that browser; choosing a folder copies it in and keeps the browser copy. After Chrome restarts it may ask again: click **Allow** in the bar at the top of Workshop. Until then your changes stay on screen and are saved once you allow it.
- **Two windows stay in sync.** A change in one shows up in the other within a moment, and changes made in both at once are merged task by task: where both changed the same task, the later change wins. Nothing is overwritten wholesale.
- **If a save fails** (for example the disk is full, Workshop stopped, or Chrome is waiting for you to allow the folder), the folder icon turns red and says "Not saved yet". Your changes stay on screen and are saved as soon as it works again. The file on disk is never left half written: the previous version stays until the new one is complete.
- **The folder icon** is the file menu: it says where the board is saved, and has **Download an Excel copy**, **Download a backup (.json)** and **Import a file** (an Excel file, or a backup). The Excel file has one sheet per list; files from earlier versions still import. A backup is a Workshop bundle (`workshop-<date>.json`) with everything, including ADO settings and deletions, and merges into a board instead of replacing it. The **Settings** app can also export and import every app's data.
- Folder sync (keeping `prioritizer.xlsx` in a folder) is gone: the board is already a file on disk when Workshop runs.

### Moving your board into Workshop

- **Same site, nothing to do.** The first time this version opens, a board saved by an earlier version in the same browser and site moves in by itself, once. The old copy is left in place as a backup.
- **From a board saved in a browser to Workshop on your computer.** Pairing Docket's own site with Workshop does not bring a board saved in that browser along, and a browser can't read another site's storage, so move it with a file: before pairing, open the folder icon and choose **Download a backup (.json)** (or **Download an Excel copy**). Then in Workshop, folder icon, **Import a file**. Into an empty board it comes in as it was; into a board with tasks, Excel asks whether to add or replace, and a backup merges.

## Azure DevOps work items

Your ADO Issues, Bugs and User Stories assigned to you, and pull requests waiting on your review, show up as tasks in an **ADO** list, and in All lists next to everything else. Read-only for now.

**How it connects:** only through Workshop's ADO connector, on the same computer. That works inside Workshop, and on Docket's own site (https://docket.alexisdavidson.org) once the site is paired with Workshop (folder icon, **Use Workshop on this computer**). The connector keeps its connections (server, collection, project, which repos to watch for PRs) in Workshop's settings, and your PAT stays in an environment variable on your computer: it never touches the page. In the Android app, and on Docket's own site without Workshop, there is no ADO sync.

**Setup:**

1. Install Workshop on this computer, or start it if it is installed (`workshop open`). See [Workshop](https://github.com/adavidson21/workshop).
2. Make a PAT with **Work Items (Read)** (add **Code (Read)** for pull requests and **Project and Team (Read)** for team PRs), then run `workshop pat ADO_PAT` and paste it.
3. In Workshop **Settings**, turn on the **Azure DevOps** connector and add your connection, or **Import settings from a file** with the `ado-helper.json` you used before. Set **PAT expires**.
4. On Docket's own site, pair it once: folder icon, **Use Workshop on this computer**, then allow the site in the window that opens. Inside Workshop there is nothing to pair.

Docket starts syncing by itself the first time it sees the connector ready (no Connect click here); **Disconnect** in ADO Settings turns that off for this device until you click Connect again.

**When ADO can't be reached,** the ADO button (sync arrows, bottom of the sidebar) turns red, its tip and its Settings say what to do, and nothing syncs until it is fixed:

- Workshop is not installed or not running, or this site is not paired: install or start Workshop on this computer and pair this site.
- The site was paired but Workshop does not answer: start Workshop (`workshop open`) and reload the page.
- Workshop stopped while Docket was open: start it again; Docket picks it up by itself.
- The ADO connector is off or not set up: turn it on in Workshop **Settings**.

The ADO button also shows the connector's own messages: a missing or rejected PAT turns it red and skips the sync (the tip says what to run, usually `workshop pat`), and a PAT that expires within two weeks turns it amber while sync keeps working.

**Docket's own ADO settings** are in ADO Settings (the ADO button), saved with your board: how often to sync, whether new work items wait for you, and the starting value and urgent flag for each PR tier. They are not connector settings.

**Coming from `ado_helper.py`:** the Python helper was retired in Docket 5.4.0. A board it synced keeps working through the connector: work items are matched by their ADO id and PRs by collection, project and PR id, so nothing is added twice, and your notes, values and ranks stay. Stop the helper (and remove it from startup, `py ado_helper.py --no-startup`) once the connector syncs. If ADO Settings still shows the helper's Connect steps, reload the page to get this version.

**What syncing does** (every 10 minutes by default while the app is open, when you switch back to it, or with Sync now):

- **New work items wait for you to pick them.** The sync button shows a count, and a toast offers Review. In the review list, check what you want and choose **Add**, or **Skip unchecked** to also dismiss the rest for good. **Later** keeps them waiting. Items closed or reassigned before you pick them drop off on their own. To skip this step, choose **Add them automatically** in ADO Settings. PRs are always added automatically.
- Added items become tasks in the ADO list. ADO Priority 1 to 4 sets a starting value (High to Trivial); effort is left for you in Triage. ADO's due or target date fills Due.
- Title, state and due date follow ADO. Your notes, value, effort, rank, Today and people stay yours.
- Resolved, Closed or Done in ADO: completed here. If it gets reactivated, it reopens. Removed in ADO: marked won't do.
- Reassigned to someone else: marked won't do with a note saying who and when, so it's under Done. If it comes back to you, it reopens.
- Deleting an ADO task here keeps it from coming back.

Work item types and which states count as closed are connector settings in Workshop **Settings** (`types`, `closedStates`, `removedStates`). A PAT with Work Items (Read) is enough for work items.

### Pull requests to review

Active PRs where you or one of your teams is a reviewer become tasks in **ADO > Pull requests**, titled `Review: <PR title>` (rows show just the PR title next to the PR chip). Each gets a tier based on how much it's waiting on you:

| Tier | When | Starting value | Urgent |
| --- | --- | --- | --- |
| Blocking | You're a named, required reviewer | High | Yes |
| Asked | You're a named, optional reviewer | Medium | No |
| Team | Only your team was added, so any teammate can take it | Low | No |

The starting value and urgent flag are defaults; change them per tier in ADO Settings.

A Blocking PR where every other required reviewer has already approved shows **Last approval**. Effort starts at S. Age counts from when the PR was opened, so old PRs rise in the list. PRs never go stale or back to Triage: what they need is a review.

- **Your vote decides when it's done.** Approve, Approve with suggestions or Reject completes the task. Waiting for author moves it to Waiting with the author attached, so it shows on their People card. If your vote resets after a new push, it comes back to you.
- **Team PRs** complete when a teammate votes for the team.
- **Completed or abandoned** in ADO completes the task. Removed as a reviewer, back to draft, or not found marks it won't do.
- If a PR moves between tiers (for example, someone adds you as required), value and urgent follow unless you've changed them.
- Drafts and your own PRs are skipped. Deleting a PR task keeps it from coming back.

### Tandem reviews PRs first

With Workshop's opencode connector on and its **Review new PRs as soon as they are found** setting on (Workshop Settings, opencode, PR reviews; on by default), every sync hands the PRs waiting on you to Tandem, which runs a first-pass `/pr-review` on the new ones and on PRs with a new commit. Drafts only: nothing is posted, voted or changed in ADO.

- **Blocking** PRs become tasks right away with an **AI reviewing** chip (the row is dimmed a little).
- **Asked** and **Team** PRs wait until their review ends, then show up already reviewed. They also show up when Tandem stops to ask something, when the review fails, or after the hold limit (60 minutes by default, set in ADO Settings).
- The chip then shows the recommendation (**AI: Approve**, **AI: Changes**, **AI: Questions**), in the warning look for high risk or blocking comments. Hover for the risk and draft comment counts; click it, or **Open in Dispatch** in the drawer, to read the drafts. A failed or late review has **Review again**.
- A new push starts the review over on the same task.
- Connector off or not ready, opencode not connected, or the setting off: PRs land as they always did, and held ones land at once.

**Filtering PRs:** the menu under each view's title (the scope, like "All lists") has a **Pull requests** filter: **All**, **Only ones that need me** (hides Team PRs, the ones any teammate can take) or **None**. It applies to every view and to the sidebar counts, and the title line says how many it hides (for example "4 team PRs hidden"). It is per window, like the scope, so a second window can still show everything. Picking the Pull requests list itself always shows its PRs, even with None. Home and other apps still see every PR.

**Setup:** in Workshop **Settings**, add a PR source for each collection and project to watch (on the **Repos** tab), optionally limited to some repos. This can be a different collection than your work items, and you can add more than one. Your PAT also needs **Code (Read)**, plus **Project and Team (Read)** for team PRs. The connector's `prTeams` setting limits which of your teams count (empty means all of them).

## Reports

Team reports moved to **Runway** in Docket 4.18.0 (Runway's roadmap list, **Team reports**). They read your team's ADO history through Workshop's ADO connector. Inside Workshop, the ADO menu's **Team reports in Runway** and an old `reports` link open them there. Runway takes your team profile from Docket the first time it opens in the same browser.

## eng-agents stages

When Workshop runs on this computer with the opencode connector on (see [Agents](https://github.com/adavidson21/workshop#agents) in the Workshop README), ADO tasks here show their [eng-agents](https://github.com/adavidson21/eng-agents) stage next to the ADO chip (Spec, Plan, Build 2/5, Review, and so on). Amber means it needs you, including when autopilot stops for you; a pulsing dot means an agent or autopilot is working. Hover for the next step in plain words, or click to open that item in Agents.

An ADO task not started yet gets **Start as feature** or **Start as bug** in its details. That runs `/start` in opencode for you.

Stages update when the connector reports a change, and when you switch back to the page. Without the connector (browser mode, or the connector off) nothing changes.

## Install it as a desktop app

Open https://docket.alexisdavidson.org in Chrome or Edge and choose Install in the address bar. Docket installs as its own app and opens offline. To use it with the rest of your tools, install Workshop instead: see the [Workshop README](https://github.com/adavidson21/workshop#install-it-as-a-desktop-app).

## Code

No build step. `index.html` is the page; `app.json` describes the app to Workshop ([docs/app-manifest.md](https://github.com/adavidson21/workshop/blob/main/docs/app-manifest.md)) and lists the files to keep for offline use; `app.css` is Docket's own styles (shared buttons, menus and themes come from `shared/`). `sw.js` and `manifest.webmanifest` make the standalone site installable and offline-ready. The code is in `js/`, one ES module per concern:

| File | What's in it |
| --- | --- |
| `constants.js`, `util.js` | Scales, quadrant names, icons; DOM and date helpers |
| `model.js` | Implied due, urgency, score, tiers, quadrants (pure functions) |
| `state.js` | Board shape, migration, sanitize, per-window UI state (view, lens, scope) |
| `storage.js`, `store.js`, `store-format.js` | Saving through the SDK and keeping windows in step; the file menu; the board as four collections (pure, tested in `test/`) |
| `quick-add.js`, `actions.js` | Quick add syntax; task actions |
| `render.js`, `views.js` | Frame, sidebar, header, rows; each view |
| `row-fields-model.js`, `display.js` | Which optional row fields show (pure, tested in Node); the Row fields sheet behind the sidebar sliders button |
| `drawer.js`, `overlays.js`, `command-bar.js` | Task details; modal, menus, toast; the command bar |
| `excel.js` | Excel export and import |
| `drag-drop.js`, `people.js`, `events.js` | Drag and drop; people; global handlers and tooltips |
| `ado.js`, `eng.js` | ADO sync; eng-agents stages |
| `pr-ai.js`, `pr-ai-model.js` | Tandem's first-pass PR reviews: held PRs, chips, drawer (the model is pure functions) |
| `dayplan-model.js`, `dayplan-format.js` | The Day view's model: sprint math, templates, every change to a day, undo; and how it is stored (pure, tested in `test/dayplan.test.mjs`) |
| `onboarding.js` | The first-run tour |
| `focus-model.js`, `focus-format.js` | Focus: the active task, the day's activity log, breadcrumbs and switch counts; and how the log is stored (pure, tested in `test/focus.test.mjs`) |
| `focus.js` | The focus log's state and saving, the focus band, breadcrumb prompts and the Wrap up ritual |
| `dayplan.js`, `day-view.js` | The day plan's state and saving (the same write loop as the board); the Day view, its settings and the drawer's Plan for field |
| `offers-model.js`, `offers.js` | Every-sprint offers and accepted task captures from other apps: which to show or add, accepting and dismissing (pure, tested in `test/offers.test.mjs`); reading the senders' collections inside Workshop |
| `ws.js` | The connection to Workshop through the SDK (`shared/workshop-sdk.js`): shell, data, connectors |
| `main.js` | Startup: the one module `index.html` loads; it imports the rest |

Each module imports what it uses. Modules import each other in a cycle, so code that runs at load must not use another module's state: put that in an init function `main.js` calls (like `adoInit`). Imported bindings are read-only; change another module's variable through its setter (like `setSel`). When you add a file, add it to `files` in `app.json` (`test/app-files.test.mjs` catches a miss). Talk to the shell, data and connectors only through `ws.js`.

`window.__prioritizer` is the only global: it exposes the model and sync functions for automated checks (`test/e2e.py` here, and Workshop's `tests/e2e.py`, which runs against this repo). `node --test "test/*.test.mjs"` tests the storage format, the day plan, the save engine and the file list in Node; `python test/e2e.py` runs Docket on its own in headless Chrome. `test/fixtures/` holds a synthetic board exported by version 4.0.0 (Excel and its localStorage copy) for the round-trip and move checks.

### Files from Workshop

These are exact copies of Workshop files, listed in `workshop-files.json` with the Workshop commit they came from: `shared/` (the SDK, themes, fonts, file saving, the top bar, SheetJS), `icons/`, and the data contract schemas in `test/workshop/`. Docket keeps them so it runs on its own, and so Docket inside Workshop reads and writes data exactly as Workshop's other apps do.

- **Never edit them here.** Change the file in Workshop, then run `node scripts/sync-workshop.mjs --update` to copy the latest and pin that commit.
- CI runs `node scripts/sync-workshop.mjs --check`, which fails if any copy differs from the pinned commit.
- Add `--from <path to a workshop checkout>` to either to read from disk instead of GitHub.

### Deploying

`npx wrangler deploy` publishes this repo to the `docket` Cloudflare Worker at https://docket.alexisdavidson.org (`wrangler.jsonc`; `.assetsignore` keeps tests, scripts and `mobile/` off the site). Workshop reaches it through a service binding to that Worker, so keep the Worker's name. Docket's data id stays `prioritizer`: saved boards, Workshop's Home and the ADO connector all use it.

### Storage format

The board is three collections in the Workshop data format ([docs/data-format.md](https://github.com/adavidson21/workshop/blob/main/docs/data-format.md)): `prioritizer.lists` v1, `prioritizer.tasks` v4 (capacity in `meta`; a task's `who` is people and group ids from Workshop's people directory, [docs/people.md](https://github.com/adavidson21/workshop/blob/main/docs/people.md), read and added to with `ws.people`), and `prioritizer.settings` v1 (no items; Docket's own ADO behavior in `meta.ado`, `meta.onboarded`, the date the first-run tour was shown, and `meta.rowFields`, `{hidden: [keys]}`, the optional row fields that are hidden, absent when none are; keys this version doesn't know are kept). Tasks v3 kept names in `people`; a v3 board or backup is read, and its names become contacts and ids once the directory has loaded. An old `prioritizer.people` file is left alone and not read. Which view, lens, scope and PR filter (`prs`) a window shows is per window, kept with the sidebar state in `localStorage` (`prioritizer.ui`), not in the data. Other apps reading these files should check `schema` and `version` and treat an unknown version as unreadable.

The Day view adds these collections, all version 1, in the same format (change stamps, tombstones, unknown fields kept, read only when the version is not newer):

| Collection | Holds | Schema |
| --- | --- | --- |
| `dayplan/settings` | No items. The sprint in `meta.sprint`: `anchor` (a sprint's start date), `lengthWeeks`, `workdays` (0 is Sunday), `holidays`, `dayStart`, `dayEnd`. `meta.handled`: offers from other apps already accepted or dismissed, as `<app>:<offer id>:<fingerprint of its text and payload>`, newest 200 (written once there is one) | `schemas/dayplan-settings.schema.json` |
| `dayplan/templates` | Items are templates: `{id, name, days, last, sections}` | `schemas/dayplan-template.schema.json` |
| `dayplan/recurring` | Items are every-sprint tasks: `{id, title, dueDay, last, planKind, value, effort, listId, notes, paused, made}` (`made`: start dates of sprints that already got their task), plus `from: {app, id}` on a task accepted from another app's offer (an optional field older readers keep as is) | `schemas/dayplan-recurring.schema.json` |
| `dayplan/days/<yyyy>` | Items are days keyed by date: `{id: date, template, sections, slots: [{taskId, sectionId, order}], shift, carry}` | `schemas/dayplan-day.schema.json` |

The focus log adds one more kind of collection, version 1, in the same format:

| Collection | Holds | Schema |
| --- | --- | --- |
| `handoffs` | Items are offers to other apps (`prioritizer.handoffs` v1, Workshop's [docs/handoffs.md](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)). Wrap up offers finished tasks to Receipts with id `h_<task id>_<date>`; offers older than 60 days are removed | Workshop's `handoff-item` schema |
| `summary` | Docket's summary for other apps (`prioritizer.summary` v1, Workshop's [docs/summaries.md](https://github.com/adavidson21/workshop/blob/main/docs/summaries.md)): cards `board`, `day`, `lists` (capture targets) and `people`, rewritten after every save (`js/summary.js`). Home, Rapport and the Dispatch hub read it instead of the collections above | Workshop's `summary-card` schema |
| `focus/days/<yyyy>` | Items are days keyed by date: `{id: date, events: [...]}`. An event is `{at, type: 'start', taskId, switch}`, `{at, type: 'stop', taskId, why}` (`why`: pause, done or shutdown), `{at, type: 'interrupt'}` or `{at, type: 'shutdown'}`; `at` is an ISO time | `schemas/focus-day.schema.json` |

Docket also reads, never writes, the `handoffs` collection of each app listed in `SENDERS` (`js/offers-model.js`; `home` and `agents`), as `<app id>.handoffs` at version 1 only: items addressed `to: 'prioritizer'` with `payload.kind: 'every-sprint'` (`title`, `dueDay` or `last: true`, `planKind`, `value`, `effort`, `notes`), or `payload.kind: 'task'` with `accepted: true` (`title`, `list`, `who` (directory ids), `waiting`, `due`, `urgent`, `value`, `effort`, `notes`). Handled task captures are kept in `meta.handled` as `<app>:<offer id>:task`, and the task itself keeps `from: {app, id}`. Any other version reads as nothing offered.

The active task is worked out from today's events, so two windows agree on it and it never carries over. Merging is per day, later change wins. A window loads this year and last year. Breadcrumbs are saved on the task as `crumbs: [{at, text}]` (newest ten, oldest first), an extra field older readers keep as is, so `prioritizer.tasks` stays at v3. Backups include the focus log, and importing one merges it.

A section (block) is `{id, name, kind, color, around, minutes, capacity}`, plus `lost: true` on a day (`schemas/dayplan-section.schema.json`). Slots live on the day, not on tasks, so `prioritizer.tasks` stays at v3. A task made by an every-sprint item has id `r_<item id>_<sprint start>` (so two windows make the same one) and `recur: {id, sprint}`, an extra field older readers keep as is. A date with no record shows its template; a record is written on its first change, with the template's blocks copied in. Merging is per item: per template, or per day, later change wins, like tasks. A window loads last year, this year and next year, and any other year when you open a date in it. Backups include the day plan, and importing one merges it.

### Upgrading from the previous version

Boards migrate automatically on first load: High/Low value becomes High (4) or Low (2), Important becomes Medium or Low when no value was set, High/Low effort becomes L or S, and Urgent becomes the urgent flag. Existing tasks keep their created dates, so expect a one-time batch of stale tasks in Triage. Reload each device once after deploying, before editing.

## License

[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0), see `LICENSE`. Free to use, change and share, including at work; not for building a product that competes with it. Versions up to November 5, 2026 were MIT and stay MIT. Bundled fonts and libraries keep their own licenses: `shared/fonts/OFL-*.txt` and `shared/vendor/LICENSE-SheetJS.txt`.

# Agents (Dispatch)

The eng-agents live dashboard as a Workshop app: your `.work` items, where each stands, the opencode agents working on them, and a button for the next step. It replaces the Dashboard pane, which framed the eng-agents page from `127.0.0.1:4300`.

## How it works

- **Data:** the opencode connector's `state` action ([connectors/opencode/README.md](../../connectors/opencode/README.md)). The app fetches it again after the connector's events (`model`, `live`, `autopilot`, `agent.waiting`, `agent.done`) and when the connector's status changes. No polling.
- **Buttons:** the connector's actions. Write actions (`run`, `start`, `start.local`, `spike`, `repo.add`, `repo.guide`, `reply`, `answer`, `abort`, `remove`, `push`, `autopilot`, `file.write`) send `confirm: true`, only from the click that says what will happen.
- **Documents:** `.work` files (plan.md, spec.md, review.md...) open in a sheet with **Preview** and **Edit** (`js/doc.js`). Save (or `Ctrl+S`) writes through `file.write` with the text the sheet read, so a change Tandem made meanwhile is never overwritten: the sheet says so and offers *Load the new version* or *Copy my text*. Edit is off while Tandem or autopilot works on the item. Closing with unsaved changes asks first. **Open in Notebook** opens the same file in the Notes app's Tandem section (`#/notes/tandem/<folder>/<file>`), the full editor. Approving is still the step's button, not an edit.
- **Shell:** `#/agents/<id>` opens that item (a work item id or any `.work` folder opens its page; `pr-<id>` opens Reviews at that review). `#/agents/<tab>` opens a tab, `#/agents/work/<id>` a run's page (Dispatch 2.x's `runs/`, `ship/` and `research/<folder>` still work), `#/agents/chat/<session>` a conversation. The rail badge counts what is in the Inbox. A notification, if allowed, when an agent waits for you or finishes while the app is out of sight. **Refresh work items** is in the `Ctrl+K` palette.
- **Theme:** the page loads `shared/themes.css`, Workshop's look (Schibsted Grotesk headings, Atkinson Hyperlegible Next text; Dispatch's own teal from `data-app="agents"` since Workshop 6.46.0), and `shared/theme.js`; the SDK applies theme changes. Inside the shell, the shell owns the theme and the name; opened on its own (`/apps/agents/`), the page has both.

**Flows** (Dispatch 3.0, `js/flows.js`; plan: `claude/dispatch-flows-v1-plan.md` in the Workshop project). A flow is a named recipe that follows eng-agents' suggested flows (README, Daily use): its steps, which ones stop for you, the file each writes, and whether Tandem can run the middle hands-off. `flows.js` is the one place that defines them; Start work, the run page, the Inbox and Work all read it. A run's flow is not stored: it follows from the `.work` folder (a work item's lane, or the folder's kind).

| Flow | Steps (you = stops for you) | Starts with |
| --- | --- | --- |
| Build a feature | Set up, Spec (you), Plan (you), Tasks, Build, Review, PR text, Ship (you) | `start` (ADO item) or `start.local` |
| Fix a bug | Set up, Root cause (you), Fix, Review, PR text, Ship (you) | `start` or `start.local` |
| Quick change | Feature or bug steps, no ADO item | `start.local` |
| Investigate | Investigate, Read the findings (you) | `spike` |
| Plan an epic | Scope, Approve stories (you), Slice, Approve milestones (you), Backlog | `scope.start` |
| Write docs | Draft (you), Fact-check, Fix (you) | `docs.start` |
| Technical spec | Draft (you), Fact-check, Revise (you), Publish (you) | `tsd.start` |

Shape, Triage, Refine and Handoff stay in Slate; Work leaves their folders out.

**Tabs** (`js/pages.js`). Four tabs, one job each, full width. The header has the tabs, the Live pill, **Start work**, and the menu (Refresh, alerts, the opencode TUI, Projects, Repos, opencode settings). Since 4.0.0 the tab names are the page's headline (each page keeps its heading for screen readers only), lists are rows inside one white surface, what needs you is a raised card, and state is a dot and words rather than a colored bar. Plan: `claude/dispatch-redesign-v1-plan.md` in the Workshop project.

- **Inbox** (the default): everything waiting on you, and only here. **Agents asking you**: every permission and question from any session, answered in place, each with where it came from and **Open**. **Ready for your review**: runs at a gate (a spec, plan or bug write-up to approve, autopilot waiting, an epic's stories or milestones, a TSD to revise or publish), each a card with whose turn it is, the flow so far, the file you are approving (the first part; **Read all** for the rest), its buttons (**Approve and build**, **Approve only**, **Approve**, **Publish**), **Send back** and **Open**. **Code reviews to do** (with **Review**), **Stopped or blocked**, and one line for teammates' PRs with no review yet. **Go through them** shows one row at a time, full width, with keys: `A` the main button, `S` send back, `N` skip, `P` previous, `O` open, `Esc` stop; a row you act on leaves the list. With nothing waiting it says so and shows **Pick up here**. The getting-set-up checklist shows here until done.
- **Chat:** see [Conversations](#conversations) below.
- **Work:** everything else in flight, every flow, as rows (status dot, flow, title, the step it is at, whose turn, its main button). A line at the top says how many things wait in the Inbox. Filters: by flow, and by project. Groups: **Starting** (a spike, epic, doc or TSD session before its folder exists, and repo guides, with the agent's questions and a reply box until dismissed), **Tandem working**, **Up next**, **Shipping** (runs at Ship whose code review is done or with the agent; Slate's merged runs first, with Remove), **Paused**, **Done** (findings to read, published specs, backlogs made).
- **Reviews:** teammates' PRs (see To review below).

**A run's page** is driven by its flow. The step track is the navigation: done steps are checked, the step it is at is filled, later ones are faint, and a ring marks the steps that stop for you. Every step is a button. The step in view (the current one by default) shows what it does, then: at the current step, autopilot, the next step and its buttons, **Send back with a note** at a gate, the PR box at Ship, the tasks at Build, the file to read (rendered, with **Open** and **Edit**), the agent session with its reply box, and where it left off; at a done step, what it wrote (the brief, spec, plan, bug write-up, review, findings), read through `file.read`; at a later step, whether it stops for you. **Repos, files and activity** are folded at the bottom. A spike's page has **Start work from this** and **Save as note**; a doc at its fact-check takes the doc's path when `/docs` did not say it; a TSD at Revise has **Edit tsd.md** and **Publish**.

**Send back with a note** (a spec, plan or bug write-up, an epic's stories or milestones): your note goes under the file's **Open questions** (written over the text just read, so nothing Tandem wrote is lost), then the step runs again (`/spec`, `/plan`, `/bug`, `/scope` or `/slice`): docs/pipeline.md, Gates. The click is the approval for both writes.

**Projects** come from the connector (`state.projects`; `project.create`, `project.update`, `project.delete`, `run.assign`). Once you have one, Work shows a filter (All projects, then each project with its count) and each run a chip that moves it. Runs with no project are in the built-in project, shown as **No project**. The filter is kept in this browser (`localStorage` key `dispatch.view`, `js/local.js`); Dispatch 1.x's `dispatch.sidebar` key (folders and pins) is removed on load. **Projects** in the menu lists them with Edit and New project. Start work starts in the project filtered to. With an older connector that has no projects, the project controls are hidden.

**Slate tracks every run.** Starting work (Build a feature, Fix a bug, Quick change, or **Start work from this** on a spike's page) sends Slate an accepted `work` handoff (`js/slate-handoff.js`, Workshop docs/handoffs.md), so the run has a card on Slate's board from Building to Resolved. Investigate, Plan an epic, Write docs and Technical spec do not. Each run shows **From Slate** when Slate knows it, by ADO id or run folder. Starting a spike from Chat or the hub, or an action the hub suggests, needs only its button: the click is the approval (no second confirm).

**Using Dispatch on its own** (no Docket, no terminal):

- **Getting set up:** after Workshop connects, a checklist shows until three things are done: an AI model connected to opencode (from `opencode.ai`; it shows the `opencode auth login` command and how to use Claude with an Anthropic API key), a repo in the workspace, and a first piece of work. If the AI step cannot be checked (an opencode that does not say), it is not counted as missing.
- **Start work:** pick a flow, then fill it in. Build a feature and Fix a bug take an ADO work item by number when Tandem has ADO connections (*ADO work item*), or a description (*Describe it*, the `start.local` action, no tracker); Quick change is always described. The others take one line: what to investigate, the idea, what to document, or the product or repos.
- **Repos** (menu): inside Workshop, Settings > Repos. On its own page, a sheet: repos with work in progress, *Add a repo* (clones by URL into the workspace and lists it in the repo map, `repo.add`, then offers *Draft its guide*, `repo.guide`, `/onboard-repo`) and *Draft guide* for every repo.
- Spikes, epics, docs, TSDs and repo guides started here show on Work under **Starting**, with the agent's questions and a reply box, until their folder exists or you dismiss them.

**Pull requests** (`js/pr-reviews.js`): **Reviews** (the tab) is teammates' PRs; your own runs' PRs are on each run's Ship step, with their code reviews in the Inbox.

**To review (the Reviews tab):** first-pass reviews of your team's pull requests by Tandem's pr-reviewer agent (eng-agents `/pr-review`, Core 2.6.0). One column, no side panels.

- **Review a link:** the button in the page header (and the palette's **Review a pull request**) shows a box for any ADO PR link; the opencode connector's `pr.review` action runs `/pr-review <link>`. The repo must be cloned in the workspace. The agent reads the PR through git without checking it out.
- **Waiting on you:** the ADO connector's `sync.prs` (read-only), checked when Dispatch connects, when the page opens (if older than five minutes) and from *Check again*. One entry per PR: its review card in place once a review exists (with the PR's tier), else a row with *Review*. Reviews still starting (no `pr-<id>` folder yet) are at the top. Without the ADO connector the page says how to turn it on; review by link still works.
- **Earlier reviews:** reviews of PRs no longer waiting on you, or reviewed by link. With no inbox (ADO off or failing) the list is called Reviews.
- The **Inbox** lists the reviewer agent's questions with the rest, with **Open** to the review.
- **Review all:** queues every PR waiting on you that needs a first pass (not Waiting for author, not already reviewed at its latest commit, which `sync.prs` now sends). The opencode connector runs them one at a time, even with Dispatch closed (`pr.reviewAll`). A panel above the inbox shows progress, the PR being reviewed, and which ones were reviewed, need you, or failed, with Stop, Resume and Dismiss.
- **Nightly review:** set a time under opencode settings, PR reviews. Each check of the inbox hands the list to the connector (`pr.inbox.save`), and at that time it reviews the list, so drafts are ready when you sit down. The line under the inbox says when it runs. See the connector's README for the rules.
- **Reviews:** one card per `.work/pr-<id>`: recommendation, risk, and the draft comments (file, line, severity, why) each with *Copy comment*. A review of an older commit says so and offers *Review the new commits*. **Nothing is posted**: you paste the comments you agree with into the PR yourself.
- Reviews are not runs: they are left out of Work, projects and the run counts. The Reviews tab count is PRs waiting on you with no review yet (gate colored when the reviewer is asking you something). `#/agents/pr-<id>` opens the page at that review.

**Your runs' PRs (the Ship step):** a run at Ship with a `pr.md` has its Pull requests box on its page (code review link, title and description to copy, Create PR). Where its code review stands (`mineState`): review before you push or a revision that needs you puts it in the Inbox (**Code reviews to do**); revising, approved or pushed puts it on Work under **Shipping**. **Remove** cleans up once the PR merges.

Before the connector is ready, the page says what is wrong: browser mode, the connector off (with a button to Settings), starting, or its error message. The hub's capture box sits under it, so captures work without Tandem.

## Focus hours

With focus hours on (Settings, Focus hours; docs/focus.md) the shell hides the rail badge during focus and lunch, except the number of pull requests blocked on you during focus. Agent alerts are counted instead of shown, in Dispatch's `held` summary card, except a blocking PR's review during focus. After a focus span ends, **While you were focused** sits on top of the Inbox (or the setup page with the connector off): what every app held, runs waiting on you, and PR reviews that finished during the span, blocking ones first. Rules only (`js/digest.js`). One card per day; Dismiss hides it until tomorrow.

## Conversations

The **Chat** tab ([docs/chat.md](../../docs/chat.md)), laid out like ChatGPT since 4.1.0: a sidebar of chats (New chat, search, grouped by Today, Yesterday, Previous 7 days and Older; rename and remove on hover; it collapses, and on a phone it is a drawer) and one chat in view, with the composer pinned at the bottom. **New chat** is the hub's box ([docs/hub.md](../../docs/hub.md)): a capture comes back as rows to accept right there, and anything else becomes a chat in the sidebar and opens, with Tandem's answer as the first turn. When Tandem asks something in a chat, it is answered right there (and it is in the Inbox too). Plan: `claude/chat-layout-v1-plan.md` in the Workshop project.

## Code review

`review.html` is a read-only, VS Code style review of one repo of a work item, for the step before Push. The reviewer reads the diff, comments on lines, and approves or sends every comment to the agent as one revision. Data: the opencode connector's `review.session`, `review.file` and `review.submit` actions and its `review` event ([connectors/opencode/README.md](../../connectors/opencode/README.md), Code review).

- **Open it:** `review.html?id=<work item id>&repo=<repo folder>`; with no `repo`, the first repo in `pr.md`. `review.html?mock=1` is a sample review with no agent (`js/review-api.js` `mockReviewApi`, data in `js/review-fixture.js`); it also plays the agent, so Request changes comes back as revision 2.
- **From Dispatch:** a ready-to-ship item's PR card shows **Review** where Push used to be, for each repo whose branch is not pushed, with where its review stands (`state.reviews`): not started, revision N, the agent is revising (or needs you), or approved. Dispatch has no Push button of its own while connected, so nothing is pushed before Approve, and Approve itself pushes nothing. Not connected, the card still shows the push command to copy.
- **Layout:** files on the left (status badge, +/- counts, draft comment count), the Monaco diff in the middle (side by side or inline; inline on small screens), the Review panel on the right (collapsible). The top bar has the title, branch, base, revision, file count, a repo switcher when `pr.md` has more than one repo, and Back to Dispatch.
- **Comments:** hover a line number for **+**; click it, shift-click another, or drag, to pick lines on one side of one file; `C` comments on the cursor line or selection. The box opens under the last line: type (Must fix, the default; Suggestion; Question), text, and Suggest change, which prefills the selected lines to edit. `Ctrl`/`Cmd`+`Enter` saves, `Esc` cancels. Saved comments are cards under their lines (click to open, edit or delete) with a marker in the gutter. The hash names the selection: `#file=src/x.ts&L=12-18`, plus `&side=old` for removed code. In the inline view, comments go on the new code.
- **Drafts:** kept in `localStorage` per work item, repo and revision (`dispatch.review.<id>.<repo>.r<n>`), so a refresh loses nothing. If the browser will not save them, the panel says so.
- **Submit:** Request changes needs a comment or a summary and sends one `ReviewFeedback`. `quotedCode` is read from the files at the reviewed commits when you submit, so it always matches what the agent will see. **Approve** records the verdict (no line comments; with drafts open it asks before discarding them) and pushes nothing. **Push to origin** (with the **git** mark) then asks first in the shared outside confirm (**Changes the git remote.**, the repo and branch, Cancel focused) and only its **Push** runs the connector's `push`. If the push fails, the verdict stays and **Push to origin** tries again. A `conflict` (the branch moved, or the review changed) keeps the draft and reloads.
- **Round 2 and later:** the last round's comments show dimmed in the panel with the agent's answer (Fixed, Declined, Answered) and its note, and a link to their lines. **Changes since last review** shows only what the agent committed since then.
- **Monaco:** a trimmed copy of 0.57 in `vendor/monaco/` (5.7 MB; see its README), loaded only by this page and precached with the app. `scripts/vendor-monaco.mjs` writes it and the `files` list in `app.json`. No language services: syntax colors only, so there are no error squiggles from code with no project around it.

## Files

| File | What |
| --- | --- |
| `js/flows.js` | The flows: their steps, which stop for you, where a run is, what waits on you, whose turn, sending a draft back. HTML strings, tested in Node. |
| `js/pages.js` | The tabs (Inbox and Go through them, Work, a run's page) and the tab bar. HTML strings, tested in Node. |
| `js/view.js` | The header, sheets and the pieces the tabs draw (track, next step, agent box, PR box), as HTML strings, from the state. Ported from eng-agents `core/scripts/dashboard/dashboard.template.html` at `e2d202a` (Dashboard 1.6.1, live mode). No DOM, so it is tested in Node. |
| `js/doc.js` | The `.work` file sheet: a safe Markdown renderer for Preview, the read-only reason while Tandem works, and the Notebook route. No DOM. |
| `js/main.js` | SDK connection, fetching, painting, clicks, alerts, focus. |
| `js/state.js` | The state the view reads. |
| `js/projects.js` | Projects: the filter, the project chip, run status, and the project, Projects and move sheets. HTML strings, tested in Node. |
| `js/pr-reviews.js` | Reviews (link box, Review all, Waiting on you, Earlier reviews) and where your runs' PRs stand. HTML strings, tested in Node (`test/pr-reviews.test.mjs`). |
| `js/hub.js`, `js/hub-model.js` | The hub, Chat's New chat box ([docs/hub.md](../../docs/hub.md)). A message that is not a capture or go becomes a chat ([docs/chat.md](../../docs/chat.md)). |
| `js/chat.js` | The Chat tab: the sidebar of chats, one chat in view, and New chat (the hub's element). Its own element, moved into the page by `main.js` so typing survives repaints. |
| `js/thread.js` | Turns, the last answer, the sidebar's day groups and search, and keeping focus through a repaint. Tested in Node. |
| `js/local.js` | The project filter in this browser: clean, load, save, prune. |
| `js/slate-handoff.js` | The `work` handoff to Slate for a started run: the offer (tested in Node) and the write to Dispatch's `handoffs`. |
| `agents.css` | The template's styles, minus the theme block and update checks. |
| `review.html`, `review.css` | The code review page and its styles. |
| `js/review.js` | Code review: SDK connection, Monaco, line selection, comment boxes, drafts, submit. |
| `js/review-state.js` | Code review logic with no DOM: the hash, selection, drafts, the payload, the file tree. Tested in Node. |
| `js/review-view.js` | Code review HTML strings: top bar, files, banners, comment boxes, the panel. Tested in Node. |
| `js/review-api.js`, `js/review-fixture.js` | The connector calls, and `mockReviewApi` with its three-file sample. |
| `js/review-monaco.js` | Loads `vendor/monaco` once, with a same-origin editor worker (the page's CSP refuses Monaco's `blob:` worker). |

What changed from the template: live mode only (eng-agents' `/dashboard static` keeps the static page); no update checks (connectors make none); no theme menu or brand inside the shell; files open in the app instead of a `/files/` link; links that are not `http(s)` are not links.

## Tests

```
node --test "apps/agents/test/*.test.mjs"
python tests/e2e.py
python tests/review-e2e.py
```

- `test/view.test.mjs`: the page-only items from [connectors/opencode/PARITY.md](../../connectors/opencode/PARITY.md), on `test/fixtures/state.json`, a `state` result from the connector for `docs/examples/work` (synthetic).
- `test/flows.test.mjs`: the presets against eng-agents' flows, where each kind of folder is, what waits in the Inbox, the file to read at a gate, sending back with a note, docs' fact-check, whose turn, and Go through them.
- `test/projects.test.mjs`: the project filter, chips, run status, starting in a project, the sheets, and the browser-only filter.
- `test/review.test.mjs`: the code review's logic, HTML and mock API.
- `tests/review-e2e.py`: the code review page in Chromium against the mock, under the page's real CSP: ranges, the box, markers, the panel, drafts after a refresh, the payload, revision 2, a stale head, approve, deep links, theme.
- `test/fixture.mjs`: a synthetic workspace and a fake opencode for `tests/e2e.py` part 5, which runs the app against the real agent and connector: the tabs, the Inbox with its files and Go through them, the run page, prompts in the Inbox, Push, Remove, the flow picker, deep links, theme, projects, and Prioritizer's stages and Start.

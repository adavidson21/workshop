# Agents

The eng-agents live dashboard as a Workshop app: your `.work` items, where each stands, the opencode agents working on them, and a button for the next step. It replaces the Dashboard pane, which framed the eng-agents page from `127.0.0.1:4300`.

## How it works

- **Data:** the opencode connector's `state` action ([connectors/opencode/README.md](../../connectors/opencode/README.md)). The app fetches it again after the connector's events (`model`, `live`, `autopilot`, `agent.waiting`, `agent.done`) and when the connector's status changes. No polling.
- **Buttons:** the connector's actions. Write actions (`run`, `start`, `start.local`, `spike`, `repo.add`, `repo.guide`, `reply`, `answer`, `abort`, `remove`, `push`, `autopilot`) send `confirm: true`, only from the click that says what will happen. `.work` files open in a sheet through `file.read`.
- **Shell:** `#/agents/<id>` opens that item (a work item id opens its run page; a spike, doc or TSD folder opens it in Research; `pr-<id>` opens Reviews at that review). `#/agents/<tab>` opens a tab, `#/agents/runs/<id>` a run page, `#/agents/research/<folder>` a Research folder, `#/agents/chat/<session>` a conversation. The rail badge counts what is in the Inbox. A notification, if allowed, when an agent waits for you or finishes while the app is out of sight. **Refresh work items** is in the `Ctrl+K` palette.
- **Theme:** the page loads `shared/themes.css` and `shared/theme.js`, and the SDK applies theme changes. Inside the shell, the shell owns the theme and the name; opened on its own (`/apps/agents/`), the page has both.

**Tabs** (Dispatch 2.0, `js/pages.js`; plan: `claude/dispatch-ui-v2-plan.md` in the Workshop project). One job per tab, full width, no inner sidebar. The header has the tabs, the Live pill, **Start work**, and the menu (Refresh, alerts, the opencode TUI, Projects, Repos, opencode settings).

- **Inbox** (the default): everything waiting on you. **Agents asking you**: every permission and question from any session (runs, spikes, repo guides, PR reviews, the hub, conversations), answered in place, each with where it came from and **Open**. **Runs waiting on you** (a gate to approve, autopilot waiting), **Code reviews to do** (with **Review**), **Stopped or blocked**, and one line for teammates' PRs with no review yet. With nothing waiting it says so and shows **Pick up here** (the most recently moving run). The getting-set-up checklist shows here until done.
- **Chat:** see [Conversations](#conversations) below.
- **Runs:** work items in progress as rows (status dot, title, stage, the next step and its main button, project chip), grouped Needs you, In progress, Paused. A row opens the **run page**: the track, the next step, autopilot, the agent session with its reply box, where it left off, then **Brief**, **Tasks**, **Repos** (with the terminal command), **Files** and **Activity**.
- **Ship:** runs that wrote their PR text (see My PRs below), plus runs at Ship with no `pr.md` yet. Runs Slate saw merge (its summary's `runs` card) come first, under **Merged**. **Open run** opens the run page on this tab; **Remove** cleans up once the PR merges.
- **Reviews:** teammates' PRs (see To review below).
- **Research:** spikes, docs and TSDs as rows, and spikes before their folder exists and repo guides under **Running** with their session. A folder opens a reader: its state, summary and next step, its main file (`findings.md`, or the document) rendered as escaped Markdown, **Start work from this** (Start work, Describe it, filled in from the findings) and **Save as note**.

**Projects** come from the connector (`state.projects`; `project.create`, `project.update`, `project.delete`, `run.assign`). Once you have one, Runs and Ship show a filter (All projects, then each project with its count) and each run a chip that moves it. Runs with no project are in the built-in project, shown as **No project**. The filter is kept in this browser (`localStorage` key `dispatch.view`, `js/local.js`); Dispatch 1.x's `dispatch.sidebar` key (folders and pins) is removed on load. **Projects** in the menu lists them with Edit and New project. Start work starts in the project filtered to. With an older connector that has no projects, the project controls are hidden.

**Slate tracks every run.** Starting work (Describe it, an ADO work item, or **Start work from this** in Research) sends Slate an accepted `work` handoff (`js/slate-handoff.js`, Workshop docs/handoffs.md), so the run has a card on Slate's board from Building to Resolved. Investigate does not. Each run shows **From Slate** when Slate knows it, by ADO id or run folder. Starting a spike from Chat or the hub, or an action the hub suggests, needs only its button: the click is the approval (no second confirm).

**Using Dispatch on its own** (no Docket, no terminal):

- **Getting set up:** after Workshop connects, a checklist shows until three things are done: an AI model connected to opencode (from `opencode.ai`; it shows the `opencode auth login` command and how to use Claude with an Anthropic API key), a repo in the workspace, and a first piece of work. If the AI step cannot be checked (an opencode that does not say), it is not counted as missing.
- **Start work:** *Describe it* (the default: title, description, repro steps for a bug; the `start.local` action, no tracker), *ADO work item* (by number; only shown when Tandem has ADO connections), or *Investigate* (`spike`).
- **Repos** (menu): inside Workshop, Settings > Repos. On its own page, a sheet: repos with work in progress, *Add a repo* (clones by URL into the workspace and lists it in the repo map, `repo.add`, then offers *Draft its guide*, `repo.guide`, `/onboard-repo`) and *Draft guide* for every repo.
- Spikes and repo guides started here show in Research under **Running**, with the agent's questions and a reply box, until dismissed.

**Pull requests** (`js/pr-reviews.js`): **Reviews** (the tab) is teammates' PRs; **Ship** (the tab) is the PRs of your own runs.

**To review (the Reviews tab):** first-pass reviews of your team's pull requests by Tandem's pr-reviewer agent (eng-agents `/pr-review`, Core 2.6.0). One column, no side panels.

- **Review a link:** the button in the page header (and the palette's **Review a pull request**) shows a box for any ADO PR link; the opencode connector's `pr.review` action runs `/pr-review <link>`. The repo must be cloned in the workspace. The agent reads the PR through git without checking it out.
- **Waiting on you:** the ADO connector's `sync.prs` (read-only), checked when Dispatch connects, when the page opens (if older than five minutes) and from *Check again*. One entry per PR: its review card in place once a review exists (with the PR's tier), else a row with *Review*. Reviews still starting (no `pr-<id>` folder yet) are at the top. Without the ADO connector the page says how to turn it on; review by link still works.
- **Earlier reviews:** reviews of PRs no longer waiting on you, or reviewed by link. With no inbox (ADO off or failing) the list is called Reviews.
- The **Inbox** lists the reviewer agent's questions with the rest, with **Open** to the review.
- **Review all:** queues every PR waiting on you that needs a first pass (not Waiting for author, not already reviewed at its latest commit, which `sync.prs` now sends). The opencode connector runs them one at a time, even with Dispatch closed (`pr.reviewAll`). A panel above the inbox shows progress, the PR being reviewed, and which ones were reviewed, need you, or failed, with Stop, Resume and Dismiss.
- **Nightly review:** set a time under opencode settings, PR reviews. Each check of the inbox hands the list to the connector (`pr.inbox.save`), and at that time it reviews the list, so drafts are ready when you sit down. The line under the inbox says when it runs. See the connector's README for the rules.
- **Reviews:** one card per `.work/pr-<id>`: recommendation, risk, and the draft comments (file, line, severity, why) each with *Copy comment*. A review of an older commit says so and offers *Review the new commits*. **Nothing is posted**: you paste the comments you agree with into the PR yourself.
- Reviews are not runs: they are left out of Runs, projects and the run counts. The Reviews tab count is PRs waiting on you with no review yet (gate colored when the reviewer is asking you something). `#/agents/pr-<id>` opens the page at that review.

**My PRs (the Ship tab):** every run at Ship with a `pr.md`, grouped by whose turn it is: **Your turn** (review before you push, a revision that needs you, a branch to push by hand, a repo or branch not found), **With the agent** (revising after your review) and **Ready for a PR** (approved, or pushed: create the PR). Each card is the run's Pull requests box (code review link, title and description to copy, Create PR) with **Open run**. The same box is on the run page; this tab only gathers them. The Ship tab count is runs with a code review to do.

Before the connector is ready, the page says what is wrong: browser mode, the connector off (with a button to Settings), starting, or its error message. The hub's capture box sits under it, so captures work without Tandem.

## Conversations

The **Chat** tab ([docs/chat.md](../../docs/chat.md)). Its first entry, **Ask or capture**, is the hub ([docs/hub.md](../../docs/hub.md)): one box for questions and captures, each answered as a card you can reply under. Below it, **Conversations**: hub threads you replied to, with their first question and answer, the turns since, and a reply box. When Tandem asks something in a thread or a hub card, it is answered right there (and it is in the Inbox too).

## Code review

`review.html` is a read-only, VS Code style review of one repo of a work item, for the step before Push. The reviewer reads the diff, comments on lines, and approves or sends every comment to the agent as one revision. Data: the opencode connector's `review.session`, `review.file` and `review.submit` actions and its `review` event ([connectors/opencode/README.md](../../connectors/opencode/README.md), Code review).

- **Open it:** `review.html?id=<work item id>&repo=<repo folder>`; with no `repo`, the first repo in `pr.md`. `review.html?mock=1` is a sample review with no agent (`js/review-api.js` `mockReviewApi`, data in `js/review-fixture.js`); it also plays the agent, so Request changes comes back as revision 2.
- **From Dispatch:** a ready-to-ship item's PR card shows **Review** where Push used to be, for each repo whose branch is not pushed, with where its review stands (`state.reviews`): not started, revision N, the agent is revising (or needs you), or approved. Dispatch has no Push button of its own while connected, so nothing is pushed before Approve. Not connected, the card still shows the push command to copy.
- **Layout:** files on the left (status badge, +/- counts, draft comment count), the Monaco diff in the middle (side by side or inline; inline on small screens), the Review panel on the right (collapsible). The top bar has the title, branch, base, revision, file count, a repo switcher when `pr.md` has more than one repo, and Back to Dispatch.
- **Comments:** hover a line number for **+**; click it, shift-click another, or drag, to pick lines on one side of one file; `C` comments on the cursor line or selection. The box opens under the last line: type (Must fix, the default; Suggestion; Question), text, and Suggest change, which prefills the selected lines to edit. `Ctrl`/`Cmd`+`Enter` saves, `Esc` cancels. Saved comments are cards under their lines (click to open, edit or delete) with a marker in the gutter. The hash names the selection: `#file=src/x.ts&L=12-18`, plus `&side=old` for removed code. In the inline view, comments go on the new code.
- **Drafts:** kept in `localStorage` per work item, repo and revision (`dispatch.review.<id>.<repo>.r<n>`), so a refresh loses nothing. If the browser will not save them, the panel says so.
- **Submit:** Request changes needs a comment or a summary and sends one `ReviewFeedback`. `quotedCode` is read from the files at the reviewed commits when you submit, so it always matches what the agent will see. **Approve and Push PR** records the verdict (no line comments; with drafts open it asks before discarding them), then runs the connector's `push` in the same click. If the push fails, the verdict stays and **Push PR** tries again. A `conflict` (the branch moved, or the review changed) keeps the draft and reloads.
- **Round 2 and later:** the last round's comments show dimmed in the panel with the agent's answer (Fixed, Declined, Answered) and its note, and a link to their lines. **Changes since last review** shows only what the agent committed since then.
- **Monaco:** a trimmed copy of 0.57 in `vendor/monaco/` (5.7 MB; see its README), loaded only by this page and precached with the app. `scripts/vendor-monaco.mjs` writes it and the `files` list in `app.json`. No language services: syntax colors only, so there are no error squiggles from code with no project around it.

## Files

| File | What |
| --- | --- |
| `js/pages.js` | The tabs (Inbox, Runs and the run page, Ship, Research and its reader) and the tab bar. HTML strings, tested in Node. |
| `js/view.js` | The header, sheets and the pieces the tabs draw (track, next step, agent box, PR box), as HTML strings, from the state. Ported from eng-agents `core/scripts/dashboard/dashboard.template.html` at `e2d202a` (Dashboard 1.6.1, live mode). No DOM, so it is tested in Node. |
| `js/main.js` | SDK connection, fetching, painting, clicks, alerts, focus. |
| `js/state.js` | The state the view reads. |
| `js/projects.js` | Projects: the filter, the project chip, run status, and the project, Projects and move sheets. HTML strings, tested in Node. |
| `js/pr-reviews.js` | Reviews (link box, Review all, Waiting on you, Earlier reviews) and Ship's PR groups. HTML strings, tested in Node (`test/pr-reviews.test.mjs`). |
| `js/hub.js`, `js/hub-model.js` | The hub, Chat's Ask or capture pane ([docs/hub.md](../../docs/hub.md)), with reply threads under its cards ([docs/chat.md](../../docs/chat.md)). |
| `js/chat.js` | The Chat tab: Ask or capture (the hub's element), and conversations with Tandem's read-only chat agent. Its own element, moved into the page by `main.js` so typing survives repaints. |
| `js/thread.js` | Turns, the last answer, "5 min ago", and keeping focus through a repaint. Shared by the hub and Chat. Tested in Node. |
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
- `test/projects.test.mjs`: the project filter, chips, run status, starting in a project, the sheets, and the browser-only filter.
- `test/review.test.mjs`: the code review's logic, HTML and mock API.
- `tests/review-e2e.py`: the code review page in Chromium against the mock, under the page's real CSP: ranges, the box, markers, the panel, drafts after a refresh, the payload, revision 2, a stale head, approve, deep links, theme.
- `test/fixture.mjs`: a synthetic workspace and a fake opencode for `tests/e2e.py` part 5, which runs the app against the real agent and connector: the tabs, the run page, prompts in the Inbox, Push, Remove, deep links, theme, projects, and Prioritizer's stages and Start.

# Agents

The eng-agents live dashboard as a Workshop app: your `.work` items, where each stands, the opencode agents working on them, and a button for the next step. It replaces the Dashboard pane, which framed the eng-agents page from `127.0.0.1:4300`.

## How it works

- **Data:** the opencode connector's `state` action ([connectors/opencode/README.md](../../connectors/opencode/README.md)). The app fetches it again after the connector's events (`model`, `live`, `autopilot`, `agent.waiting`, `agent.done`) and when the connector's status changes. No polling.
- **Buttons:** the connector's actions. Write actions (`run`, `start`, `start.local`, `spike`, `repo.add`, `repo.guide`, `reply`, `answer`, `abort`, `remove`, `push`, `autopilot`) send `confirm: true`, only from the click that says what will happen. `.work` files open in a sheet through `file.read`.
- **Shell:** `#/agents/<id>` scrolls to that item (a work item id, or the folder name of a spike, doc or TSD). The rail badge counts open prompts. A notification, if allowed, when an agent waits for you or finishes while the app is out of sight. **Refresh work items** is in the `Ctrl+K` palette.
- **Theme:** the page loads `shared/themes.css` and `shared/theme.js`, and the SDK applies theme changes. Inside the shell, the shell owns the theme and the name; opened on its own (`/apps/agents/`), the page has both.

**Using Dispatch on its own** (no Docket, no terminal):

- **Getting set up:** after Workshop connects, a checklist shows until three things are done: an AI model connected to opencode (from `opencode.ai`; it shows the `opencode auth login` command and how to use Claude with an Anthropic API key), a repo in the workspace, and a first piece of work. If the AI step cannot be checked (an opencode that does not say), it is not counted as missing.
- **Start work:** *Describe it* (the default: title, description, repro steps for a bug; the `start.local` action, no tracker), *ADO work item* (by number; only shown when Tandem has ADO connections), or *Investigate* (`spike`).
- **Repos:** *Add a repo* clones by URL into the workspace and lists it in the repo map (`repo.add`), then offers *Draft its guide* (`repo.guide`, `/onboard-repo`). The repos panel has both for every repo.
- Spikes and repo guides started here show under **Investigations and repo guides**, with the agent's questions and a reply box, until dismissed.

**Sidebar** (Dispatch App Experience Plan, phase 1, P2):

- **New run** opens Start work in the project in view. **All runs** is the full page; **Needs review** lists runs waiting on you across all projects, with a count.
- **Projects** come from the connector (`state.projects`; `project.create`, `project.update`, `project.delete`, `run.assign`). Each one expands to its newest runs with a status dot: running, needs review, revising, failed, ready to ship, paused, up next. Runs with no project are in the built-in **Inbox**. Picking a project filters the page to its runs; the gear edits its name, color, repo, base branch and agent instructions.
- Each run card has a chip with its project; click it to move the run.
- **Folders** (groups of projects, one level) and **Pinned** runs and projects are view state kept in this browser only (`localStorage` key `dispatch.sidebar`, `js/local.js`). If storage is blocked they last for this visit.
- With an older connector that has no projects, every run is in Inbox and the project controls are hidden.
- Under 860px wide the sidebar is a drawer opened from the menu button in the header.

Before the connector is ready, the page says what is wrong: browser mode, the connector off (with a button to Settings), starting, or its error message.

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
| `js/view.js` | The page as HTML strings, from the state. Ported from eng-agents `core/scripts/dashboard/dashboard.template.html` at `e2d202a` (Dashboard 1.6.1, live mode). No DOM, so it is tested in Node. |
| `js/main.js` | SDK connection, fetching, painting, clicks, alerts, focus. |
| `js/state.js` | The state the view reads. |
| `js/sidebar.js` | The sidebar, the scope line above the list, the project chip on run cards, and the project, folder and move sheets. HTML strings, tested in Node. |
| `js/local.js` | Folders, pins and collapsed groups in this browser: clean, load, save, prune. |
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
- `test/sidebar.test.mjs`: the sidebar, scopes, run status, starting in a project, the sheets, and browser-only folders and pins.
- `test/review.test.mjs`: the code review's logic, HTML and mock API.
- `tests/review-e2e.py`: the code review page in Chromium against the mock, under the page's real CSP: ranges, the box, markers, the panel, drafts after a refresh, the payload, revision 2, a stale head, approve, deep links, theme.
- `test/fixture.mjs`: a synthetic workspace and a fake opencode for `tests/e2e.py` part 5, which runs the app against the real agent and connector: buttons, prompts, Push, Remove, deep links, theme, and Prioritizer's stages and Start.

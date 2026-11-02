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

## Files

| File | What |
| --- | --- |
| `js/view.js` | The page as HTML strings, from the state. Ported from eng-agents `core/scripts/dashboard/dashboard.template.html` at `e2d202a` (Dashboard 1.6.1, live mode). No DOM, so it is tested in Node. |
| `js/main.js` | SDK connection, fetching, painting, clicks, alerts, focus. |
| `js/state.js` | The state the view reads. |
| `js/sidebar.js` | The sidebar, the scope line above the list, the project chip on run cards, and the project, folder and move sheets. HTML strings, tested in Node. |
| `js/local.js` | Folders, pins and collapsed groups in this browser: clean, load, save, prune. |
| `agents.css` | The template's styles, minus the theme block and update checks. |

What changed from the template: live mode only (eng-agents' `/dashboard static` keeps the static page); no update checks (connectors make none); no theme menu or brand inside the shell; files open in the app instead of a `/files/` link; links that are not `http(s)` are not links.

## Tests

```
node --test "apps/agents/test/*.test.mjs"
python tests/e2e.py
```

- `test/view.test.mjs`: the page-only items from [connectors/opencode/PARITY.md](../../connectors/opencode/PARITY.md), on `test/fixtures/state.json`, a `state` result from the connector for `docs/examples/work` (synthetic).
- `test/sidebar.test.mjs`: the sidebar, scopes, run status, starting in a project, the sheets, and browser-only folders and pins.
- `test/fixture.mjs`: a synthetic workspace and a fake opencode for `tests/e2e.py` part 5, which runs the app against the real agent and connector: buttons, prompts, Push, Remove, deep links, theme, and Prioritizer's stages and Start.

# Agents

The eng-agents live dashboard as a Workshop app: your `.work` items, where each stands, the opencode agents working on them, and a button for the next step. It replaces the Dashboard pane, which framed the eng-agents page from `127.0.0.1:4300`.

## How it works

- **Data:** the opencode connector's `state` action ([connectors/opencode/README.md](../../connectors/opencode/README.md)). The app fetches it again after the connector's events (`model`, `live`, `autopilot`, `agent.waiting`, `agent.done`) and when the connector's status changes. No polling.
- **Buttons:** the connector's actions. Write actions (`run`, `reply`, `answer`, `abort`, `remove`, `push`, `autopilot`) send `confirm: true`, only from the click that says what will happen. `.work` files open in a sheet through `file.read`.
- **Shell:** `#/agents/<id>` scrolls to that item (a work item id, or the folder name of a spike, doc or TSD). The rail badge counts open prompts. A notification, if allowed, when an agent waits for you or finishes while the app is out of sight. **Refresh work items** is in the `Ctrl+K` palette.
- **Theme:** the page loads `shared/themes.css` and `shared/theme.js`, and the SDK applies theme changes. Inside the shell, the shell owns the theme and the name; opened on its own (`/apps/agents/`), the page has both.

Before the connector is ready, the page says what is wrong: browser mode, the connector off (with a button to Settings), starting, or its error message.

## Files

| File | What |
| --- | --- |
| `js/view.js` | The page as HTML strings, from the state. Ported from eng-agents `core/scripts/dashboard/dashboard.template.html` at `e2d202a` (Dashboard 1.6.1, live mode). No DOM, so it is tested in Node. |
| `js/main.js` | SDK connection, fetching, painting, clicks, alerts, focus. |
| `js/state.js` | The state the view reads. |
| `agents.css` | The template's styles, minus the theme block and update checks. |

What changed from the template: live mode only (eng-agents' `/dashboard static` keeps the static page); no update checks (connectors make none); no theme menu or brand inside the shell; files open in the app instead of a `/files/` link; links that are not `http(s)` are not links.

## Tests

```
node --test "apps/agents/test/*.test.mjs"
python tests/e2e.py
```

- `test/view.test.mjs`: the page-only items from [connectors/opencode/PARITY.md](../../connectors/opencode/PARITY.md), on `test/fixtures/state.json`, a `state` result from the connector for `docs/examples/work` (synthetic).
- `test/fixture.mjs`: a synthetic workspace and a fake opencode for `tests/e2e.py` part 5, which runs the app against the real agent and connector: buttons, prompts, Push, Remove, deep links, theme, and Prioritizer's stages and Start.

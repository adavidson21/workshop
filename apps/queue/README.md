# Queue

Your team's Azure DevOps work items, without opening ADO. Plan: `claude/team-queue-v1-plan.md` in the Workshop project (WS13).

- **Views:** Mine, Team, Unassigned, Current sprint, All, plus views you save. Filters for type, state, assignee, priority, tag, area, stale and text; sort by last change, priority, newest or state.
- **Team view:** one row per person in your settings: open items, in progress, stale, last change. Click a name to see their items.
- **Detail pane:** description, acceptance criteria, repro steps, comments, history, related items, linked PRs, and **Open in ADO**.
- **Changes:** state, assignee (Assign to me is one click and is how an item reaches Docket: its sync picks up items assigned to you), priority, sprint, tags, comments, and new items. Every change is a click, then a confirm that names the item, project and connection and lists the change, then the ADO connector's write action with `confirm: true`.
- **Start in Dispatch** when the opencode connector is on.
- Keyboard: `j`/`k` move, `Enter` opens, `/` filters, `Esc` closes. Palette: Refresh the queue, New ADO work item.

## Needs

- Workshop running on this computer with the ADO connector on (Settings). Changing items needs a PAT with **Work Items (Read & Write)**; reading needs Work Items (Read).
- Queue settings (gear icon): your team's area paths, and the people you assign to (`Name <email>`, the email ADO shows).

Without the connector (browser mode, connector off, ADO unreachable) the queue shows the last copy it saved, with its age, and changes are off.

## Behavior

- Refreshes on open, from the Refresh button, and every *Refresh every* minutes (default 15) while the queue is on screen. Never while the tab is hidden.
- **Conflicts.** A change carries the ADO revision the queue read. If someone changed the item in ADO since, the connector answers `conflict` and nothing is saved; the queue refreshes and says what changed. A failed write (ADO unreachable, PAT scope) keeps the change on screen as "Not saved yet" with Retry; writes to ADO never retry on their own.
- **Changed since you looked.** A dot marks items whose ADO revision moved since you last opened them. On the very first refresh everything counts as seen.
- **Stale** means no change in ADO for *Stale after* days (default 7), by changed date.

## Security

ADO text is written by other people, so it is untrusted:

- Titles, names, tags and every other string are escaped.
- Descriptions, repro steps and comments go through `js/sanitize.js`, which builds new markup from an allowlist (p, br, ul, ol, li, b, strong, i, em, u, code, pre, blockquote, a). It drops every other tag (keeping its text), drops script-like elements with their content, keeps no attribute except `href`, and keeps a link only for `http(s)`. Images are never loaded (they would call the ADO server with your session).
- The page CSP allows only this site and Workshop on `127.0.0.1`. Comments you write are sent as plain text; the connector escapes them.

## Data

App id `queue`. All collections are version 1 and follow `docs/data-format.md`. ADO is the source of truth for work items; nothing here is written back to ADO except through the connector's write actions.

| Collection | Holds |
| --- | --- |
| `queue.settings` | No items. `meta`: `connection` (empty means the connector's connection for my work items), `areas[]`, `people[{name, email}]`, `types[]` (empty means Issue, Bug, User Story), `refreshMinutes` (5 to 240), `staleDays` (1 to 90), `meEmail` (override when ADO does not say who the PAT belongs to). |
| `queue.views` | Saved views: `{id, name, base, filters: {q, type, state, assignee, priority, tag, area, stale}, sort}`. `base` is one of the built-in views. |
| `queue.snapshot` | The last `queue.list` result: items in the connector's `queue.list` shape with `id` as a string. `meta`: `fetchedAt`, `connection`, `me`, `total`, `truncated`, `categories` (type to state to category), `iterations` (project to sprints), `currentIterations`. Replaced on every refresh; on a write conflict the newer copy wins outright (it is a cache). |
| `queue.seen` | `{id, rev}` per work item: the revision you last opened. Items that leave the queue are dropped. |

A collection with a newer `version` is read-only: the queue says so and changes nothing.

## Files

- `js/model.js`: views, filters, sorting, team rows, stale math, plain-word changes. Pure.
- `js/sanitize.js`: untrusted ADO HTML to safe HTML. Pure.
- `js/view.js`: the HTML. Pure.
- `js/data.js`: loading, saving and connector calls through the SDK. No DOM.
- `js/main.js`: the page.

## Tests

```
node --test "apps/queue/test/*.test.mjs"
```

`test/fake.mjs` is a fake SDK (in-memory collections with revisions and conflicts, the real merge rules, a scripted ADO connector that records every call and whether it carried `confirm`). The connector side is tested in `connectors/ado/test/queue.test.mjs` against the fake ADO server.

# Releases

Release health for your products, from Azure DevOps, and the sprint's ceremonies. App id `pm` (it was called Roadmap; the id and data stay so nothing moves). Timelines and roadmaps, ad hoc or from ADO, are in [Runway](https://github.com/adavidson21/runway): **Roadmaps in Runway** opens it.

- **Release health:** per Epic, its Features with state, progress, stale (no change in *Stale after* days, default 14) and a dot for each one whose ADO revision moved since you last looked. **Mark as seen** clears the dots for that Epic.
- **Sprint cadence:** your ceremonies, each on a sprint day (or Last day), with minutes, the Docket block kind to plan it into, and your role (generic text like Facilitator). A strip shows the current sprint, day by day, with each ceremony on its day. Weekends and holidays show as off. **Send to Docket** offers each ceremony to Docket as an every-sprint task. Accept them in Docket's Day view settings.
- **Scope new work** opens Dispatch. Use **Start work** there to scope it.
- Palette: Refresh release health, Scope new work, Sprint cadence.

## Needs

- Workshop running on this computer with the ADO connector on (Settings). Releases only reads ADO: Work Items (Read) is enough.
- Products (gear icon): one per line, a name, a colon, then its area paths, like `Product A: Project\Team A, Project\Team B`. Queue's area paths are used too unless you turn that off. Without products, each Queue area path is a product.
- For Sprint cadence: your sprint in Docket's Day view settings (start date, length, workdays, holidays). Releases only reads it. Until it is set, the cadence tab says so and links there.

Without the connector (browser mode, connector off, ADO unreachable) Release health shows the last copy it saved, with its age. Sprint cadence works without ADO.

## Behavior

- Refreshes on open, from the Refresh button, and every *Refresh every* minutes (default 30) while it is on screen. Never while the tab is hidden.
- **Placement.** Own start and target dates first. With only one of them, the other end is the sprint's start or end, or 14 days away. Then the sprint's dates (`iterations.list`). Then, for an Epic, the span of its Features. Bars placed from a sprint or from Features have a dashed edge.
- **Changed since you looked.** On the very first refresh everything counts as seen.
- **Sprint math** is a copy of Docket's rules (sprint day N is the Nth working day; Last day is the final working day, even when a holiday shortens the sprint). Keep `js/model.js` in step with Docket's `js/dayplan-model.js`.
- **The handoff to Docket** follows Workshop's [handoffs contract](../../docs/handoffs.md). Each ceremony becomes one offer in this app's `handoffs` collection: id `h_<ceremony id>`, `to: 'prioritizer'`, `source: {app: 'pm', id: <ceremony id>}`, `payload: {kind: 'every-sprint', title, dueDay | last: true, planKind?, value: 2, effort, notes?}`. Effort comes from the minutes (XS up to 15, S up to 30, M up to 60, L up to 120, else XL). Sending again keeps unchanged offers as they were, replaces changed ones, and withdraws offers for removed ceremonies. Docket updates the every-sprint task it already made from a ceremony instead of adding another. The Docket column says Not sent, Waiting in Docket, In Docket, or Changed, send again.

## Data

App id `pm`. All collections are version 1 and follow `docs/data-format.md`. ADO is the source of truth for Epics and Features; nothing is written to ADO.

| Collection | Holds |
| --- | --- |
| `pm.products` | Items: `{id, name, areas[]}`. `meta`: `connection` (empty means Queue's, else the connector's connection for my work items), `useQueueAreas` (default `true`), `staleDays` (1 to 180), `refreshMinutes` (5 to 240). |
| `pm.cadence` | Ceremonies: `{id, name, dueDay (1 to 60), last, minutes, planKind, role}`. |
| `pm.seen` | `{id, rev}` per Epic or Feature: the revision you last looked at. Items that leave the results are dropped. |
| `pm.snapshot` | The last `roadmap` result: items in the connector's `roadmap` shape with `id` as a string. `meta`: `fetchedAt`, `connection`, `total`, `truncated`, `childrenTruncated`, `iterations` (project to sprints), `areas`. Replaced on every refresh. |
| `pm.handoffs` | Offers to Docket, as above. Offers older than 60 days are made fresh or dropped. |

Read only, never written: `queue.settings` (area paths, connection), `prioritizer.dayplan/settings` (`meta.sprint`) and `prioritizer.dayplan/recurring` (to see which ceremonies Docket accepted, by their `from`). Each is read only at version 1; a newer version reads as unavailable.

A collection of its own with a newer `version` is read only: Releases says so and changes nothing.

## Files

- `js/model.js`: lanes, placement, the axis, progress, stale, the sprint strip, ceremonies and offers. Pure.
- `js/view.js`: the HTML. Pure.
- `js/data.js`: loading, saving and connector calls through the SDK. No DOM.
- `js/main.js`: the page.

## Tests

```
node --test "apps/pm/test/*.test.mjs"
```

`test/fake.mjs` is a fake SDK (in-memory collections with revisions and conflicts, the real merge rules, other apps' collections, a scripted ADO connector that records every call). The connector side is tested in `connectors/ado/test/roadmap.test.mjs` against the fake ADO server.

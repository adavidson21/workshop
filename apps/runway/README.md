# Runway

Team and project roadmaps. Type an outline, one item per line, and Runway draws the timeline. Drag bars to change dates, then export a PNG or SVG image, or Markdown.

Runs on its own at https://runway.alexisdavidson.org and inside Workshop at `/apps/runway/`, the same way Docket does. Plain JavaScript ES modules, no build step, no dependencies.

## Using it

- **Roadmaps:** the list. New roadmap, Import Markdown, or start from the example.
- **Split, Outline, Timeline:** the outline and the timeline are two views of one roadmap. Editing either updates the other.
- **Timeline:** drag a bar to move it (also between lanes), drag an edge to change its start or end, double-click a lane to add an item there. Click a lane name to fold it. Items with no dates wait in the Unscheduled tray; drag one onto the timeline.
- **Keys** (timeline focused): `N` new item, `Up`/`Down` select, `Left`/`Right` move, `Shift`+`Left`/`Right` change the end, `Alt`+`Up`/`Down` change lane, `Enter` edit, `Delete` remove, `Esc` deselect.
- **Goals:** the row under the dates has one cell per sprint (or month, quarter, week). Click one to say what that period delivers.
- **Descriptions:** an item's Description (its panel, or indented lines under it in the outline) says what it delivers. Goals and descriptions in the dates shown are listed under the timeline.
- **Dates and sprints** (calendar button): where S1 and W1 count from, and when sprints start.
- **Export:** PNG or SVG of the dates and lanes on screen (folded lanes left out), with or without the title, today line, and the goals and descriptions listed under the chart, light or dark. Markdown as a download, on the clipboard, or saved to your Workshop folder (`runway/exports/<id>.md`), optionally with a table (descriptions included).

## Azure DevOps (optional)

Runway needs no connector. Every roadmap can be ad hoc: typed, pasted or imported from Markdown. It works on its own site, inside Workshop, and in browser-only mode.

When Runway uses Workshop on this computer and the ADO connector is on, it can also read Epics and Features from ADO (read only, nothing is written to ADO):

- **From Azure DevOps** (roadmap list): pick area paths (filled in from Queue's), Epics and/or Features, lanes by area path or by Epic, and a kind:
  - **Import, then edit:** work items become ordinary, editable items with an ADO link. **Refresh** adds new work items, updates the ones you have not changed, and marks the ones you changed whose ADO values also changed ("differs from ADO"); the item's panel shows both and offers **Use ADO's** or **Keep mine**. Work items no longer found are marked, never deleted. Add your own items alongside.
  - **Live view:** rebuilt from ADO on every refresh. Items can't be edited; title, scale, dates shown and goals can. **Make editable** turns it into an ordinary roadmap.
- **Add items from Azure DevOps** (any roadmap): link an ad hoc roadmap to ADO, so imported and ad hoc items mix.
- Placement: a work item's own start and target dates, else its sprint's dates (`iterations.list`), else the Unscheduled tray.
- Roadmaps that follow ADO refresh once when opened. Without the connector they show the last copy and stay editable (live ones stay read only).
- Export: an **ADO ids** option adds `#<id>` to linked bars.

Rules, checked by `test/app-files.test.mjs`:

- `app.json` lists the ADO connector with `required: false`, and never as required.
- ADO code lives in `js/ado/` and is loaded with a dynamic `import()` only when Runway uses Workshop on this computer. No other module imports it statically or calls a connector.
- With the connector off or missing, ADO controls are hidden.

`meta.ado` (a roadmap that follows ADO): `{mode: live | linked, areas[], types[], lanes: area | epic, connection, includeClosed, fetchedAt, total, truncated}`. `item.ado`: `{id, connection, rev, type, state, url, base, remote?, missing?}`, where `base` is what the last refresh brought and `remote` is ADO's values when they differ from yours. Lanes made from ADO carry `adoKey`.

## Outline format

```
# Platform Q1 2027
scale: sprint                  week, sprint, month or quarter
start: 2027-01-04              where S1, W1 and months without a year count from
sprint: 2027-01-06, 2 weeks    the first day of any sprint, and the length
goal: S1 | Content moved, old pages redirect
goal: S4 | Search on the new index

## Wiki Edge
- Content migration | S1-S3
- Search cutover | S4 | after: Content migration
- * Launch | S5
- Alerting rework | 3 sprints | after: Search cutover | status: at risk | color: amber
  Indented lines under an item are its description.
- Later idea
```

- `#` title, `##` lane, `-` item, `- *` milestone (one date), `goal: <period> | <text>` a goal for that sprint, month, quarter or week (one per period).
- When: `2027-03-01..2027-03-20`, `2027-03`, `Jan-Mar 2027`, `Nov 2026..Feb 2027`, `Q2`, `Q1-Q2 2027`, `S3-S4` (sprints), `W1-W2` (weeks), or a length like `3 sprints`, `2 months`, `10 days`. A length starts the day after its `after:` items end, or at the first period on or after `start`.
- `after:` items it depends on, by title, comma separated. An item that starts before something it depends on ends shows `!` and a dashed red arrow. It is a warning, never a block.
- `status:` planned (default), active, done, at risk, cut. `color:` slate, teal, green, amber, red, purple, gray (default: the lane's).
- S1 is the first sprint that starts on or after `start`; W1 the first week (weeks start Monday).
- A line Runway cannot read stays where it is, as text, with a warning. Nothing is dropped.
- A `|` inside a title is written `\|`.
- Markdown exports end with `<!-- runway:table -->` and the table; import stops at that line, so an export imports back as the same roadmap.

## Data

App id `runway`. All collections are version 1 and follow Workshop's `docs/data-format.md` (change stamps, tombstones, unknown fields kept, a newer version is read only). JSON Schemas are in `schemas/`.

| Collection | Holds |
| --- | --- |
| `index` | One item per roadmap: `{id, title}` ([index-item](schemas/index-item.schema.json)). Removing a roadmap tombstones it here; its file stays in the folder. |
| `maps/<id>` | One roadmap. `meta` is its settings and goals (`goals: [{date, text}]`, date in the period) ([map-meta](schemas/map-meta.schema.json)); items are lanes ([map-lane](schemas/map-lane.schema.json)), items ([map-item](schemas/map-item.schema.json)) and outline lines that are not items ([map-text](schemas/map-text.schema.json)), told apart by `kind`. |
| `settings` | `meta.lastOpen`. |

Files (through `ws.files`): `exports/<id>.md`, written only when you click Save to Workshop folder.

Item dates are inclusive `YYYY-MM-DD` days. An item has `start` and `end`, or a `size` (`{n, unit}`) instead of dates, or neither (unscheduled). `ado` links an item to a work item (see Azure DevOps).

Saving: `js/store.js` stamps against what it read, puts with that `rev`, and on a conflict merges with what is stored and puts again. A failed write keeps the edit on screen, shows "Not saved yet" and retries every 5 seconds.

Where it saves:

- Inside Workshop, or on runway.alexisdavidson.org after **Use Workshop on this computer** (pairing, `shared/pair.js`): files in your Workshop folder, `<dataDir>/runway/`.
- On runway.alexisdavidson.org without Workshop: this browser (IndexedDB). Export Markdown to move a roadmap.

## Files from Workshop

`shared/`, `icons/` and `test/workshop/` are exact copies of files in adavidson21/workshop, pinned in `workshop-files.json`. Never edit them here: change them in Workshop, then run `node scripts/sync-workshop.mjs --update` and commit. CI fails if a copy differs (`--check`).

## Code

| File | What |
| --- | --- |
| `js/dates.js` | Dates as `YYYY-MM-DD`, scales (week, sprint, month, quarter), sizes. |
| `js/outline.js` | Parse and write the outline; apply an edited outline to a roadmap keeping ids. |
| `js/model.js` | The roadmap model: envelopes, scheduling, dependency warnings, the shown range, moves. |
| `js/timeline.js` | Layout and SVG, used on screen and for image export. Every text is escaped. |
| `js/export.js` | Markdown (with the optional table), image SVG, PNG, file names. |
| `js/store.js` | Loading and saving through the SDK. |
| `js/view.js` | HTML for the list, toolbar, panel and dialogs. |
| `js/main.js` | The page: painting, pointer and keyboard, routes, commands. |

Everything but `main.js` and `toPng` runs in Node, so it is unit tested.

## Tests

```
node scripts/sync-workshop.mjs --check
node --test "test/*.test.mjs"
pip install playwright && python -m playwright install chromium
python test/e2e.py
```

`test/e2e_ado.py` runs Runway against a mock Workshop agent with a fake ADO connector: a live roadmap, a linked one with an edit that differs, an ad hoc item mixed in, and the connector turned off.

`test/e2e.py` serves this repo the way runway.alexisdavidson.org does and drives it in headless Chrome: outline, drag, keys, tray, export PNG, SVG and Markdown, reload, escaping, phone width.

## Deploy

A Cloudflare Worker named `runway` serves this repo's files (`wrangler.jsonc`; `.assetsignore` keeps tests and scripts off the site). Deploy with `npx wrangler deploy`, or connect Workers Builds to deploy from `main`. Workshop serves Runway at `/apps/runway/` through a service binding named `RUNWAY`, so a deploy here updates both.

Bump `VERSION` in `sw.js` when shipping a change, so open windows offer to reload.

## Later

- Publish date and status changes back to ADO, only from a button, with a before and after list to tick.
- Now / Next / Later board, slides export, a Home card.

## License

MIT

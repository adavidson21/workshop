# Page layout

How every Workshop app lays out its page, so they look like one product in half a screen and full screen. The tokens live in `shared/themes.css` and the pieces in `shared/ui.css` (both in the platform bundle, [bundle.md](bundle.md)). Plan: `claude/desktop-layout-v1-plan.md` in the Workshop project.

## Sizes

Measured on the app's own frame (inside the shell, after the rail), so plain media queries work.

| Size | Width | Typical window |
| --- | --- | --- |
| Compact | under 1100px | Half of a 1920 screen, a laptop window |
| Desktop | 1100 to 1599px | A laptop full screen, 1440 |
| Wide | 1600px and up | 1920 and up (2100px only widens the tokens) |

Use these three. A component may add its own breakpoint only when it needs one (a table column that drops out).

## Tokens

| Token | Compact | Desktop | Wide | 2100+ | For |
| --- | --- | --- | --- | --- | --- |
| `--gutter` | 20px | 28px | 36px | 44px | Left and right page padding |
| `--w-page` | 100% | 72rem | 88rem | 104rem | List and form pages |
| `--w-read` | 72ch | 72ch | 72ch | 72ch | Long text: notes, descriptions, setup copy |

Boards, editors and dashboards (Home, Docket, Slate, Folio, Runway's editor) run full width with `--gutter`. List and form pages (Rapport, Settings, Runway's list, Dispatch) use `.ws-page`, which centers inside `--w-page`.

## Pieces

- `.ws-page`: the page container (`--w-page` plus gutters). `.ws-page.full` drops the cap.
- `.page-head`: one header for every app.
  ```html
  <header class="page-head">
    <div class="ph-main"><p class="eyebrow">Tuesday, November 10</p><h1>Today</h1></div>
    <div class="ph-acts"><button class="btn primary">New</button></div>
    <nav class="page-tabs">...</nav>
  </header>
  ```
  The title has one size everywhere. No subtitle: explanations go in a `.qhint` next to the title.
- `.page-tabs`: underlined section tabs. The current one has `.on`, `aria-current="page"` or `aria-selected="true"`. Views of the same data (List, Eisenhower; Edit, Split, Preview) stay segmented controls.
- `.ws-notices`: several setup notes as one line that opens (`<details class="ws-notices"><summary>2 setup notes</summary><div class="ws-note">...</div></details>`).
- `.dash`: the dashboard grid. One column compact, two desktop, three wide. `.w2` spans two columns from desktop, `.w3` the full row on wide.
- `.ws-split`: list (`.sp-list`) and detail (`.sp-detail`) side by side from desktop; set `--split-w` to change the list width. In compact the app shows one at a time by toggling `.detail-open`.

## Side panels

A side panel that opens over a board (Docket's task drawer, Slate's item panel) covers the board below 1600px and pushes it from 1600px, so the board keeps its columns in half a screen. A board that needs more room than that may cover until a wider size: Docket's Today (three columns) covers below 2100px.

## Checking

`python tests/layout-e2e.py` renders every app at 960, 1440, 1920 and 2560 and fails when the page scrolls sideways. Screenshots go to `tests/out/layout/`.

# Folio

Your notebook, as plain `.md` files, laid out like OneNote: **section tabs** along the top, the open section's **pages** on the left, and the page. Folio was called Notes, then Notebook. The app id, data folder, Worker and address stay `notes`, so existing files, links and Workshop keep working. It runs two ways, with the same files:

- **On its own** at https://notes.alexisdavidson.org. Notes are saved in your browser, or in a folder you choose (Chrome and Edge). **Use Workshop on this computer** in the sidebar's foot pairs the site with Workshop, and notes become the files in your Workshop folder. Install it as an app from the browser (desktop or phone); it works offline.
- **Inside [Workshop](https://github.com/adavidson21/workshop)** at https://workshop.alexisdavidson.org, as one of its apps. Workshop's Worker proxies `/apps/notes/*` to this site, so every deploy here shows up in Workshop too.

Nothing leaves your device: no accounts, no server, no analytics.

Plan: `claude/notes-standalone-plan.md` in the personal toools Project.

## What it does

- **Sections:** tabs along the top, each its own colour. The page you open picks its section, so links and search land in the right place.
  - **Notes:** your notes and folders as a tree, with Quick Notes pinned. Everything outside the folders below.
  - **Daily:** `daily/` by month, newest first, with today's note at the top (`T`).
  - **Products:** `products/`, the notes Tandem reads before it works on a product, each marked when Tandem changed it, with **N to review**.
  - **Templates:** every template by name, the starter set included before its files exist. **+** makes a new one.
  - **Tandem:** shows only inside Workshop on this computer with the opencode connector on. Every plan, spec, bug analysis, review, brief and finding Tandem writes in `.work`, grouped by run, with the runs waiting on your review at the top (a **Review** mark on the file to read) and a **Working** mark while Tandem works. Pages are read and saved straight to `.work` through the connector (below); nothing is copied into the notes folder. While Tandem or autopilot works on a run its pages are read-only. **Open in Dispatch** goes to the run; approving is still Dispatch's step. Dispatch's file sheet edits the same files and has **Open in Notebook** (to be renamed **Open in Folio** in Workshop).
- **Phone:** under 760px wide the pages list is a drawer (the button left of the tabs), the header is one row with the rest in `⋯`, and the view is Edit or Preview (no Split), remembered apart from the desktop's. `#/today` opens straight into today's note.

- **Folder tree:** notes and folders under `<Workshop folder>/notes/` (or the browser or folder you chose). New note (`N`, in the open note's folder, or at the top when that is `daily/` or `templates/`) opens a blank note straight away: type the title on its first line (a faint *Title* shows there; typing `# ` again keeps one `#`), and the file is named from it when you leave the note (left blank, it goes to the trash), new folder, rename or move (`F2`, the note's `⋯` menu, the folder's `⋯`, or drag onto a folder; with nothing linking to the note it is one dialog), and trash (the note header's **Trash**, the trash button on a note's row when you hover it, or `Delete` on a focused row). Trash is one click with **Undo** in the toast; it asks first only when other notes link to the note. Folders with no notes are not kept.
- **Editor:** CodeMirror, with the note's Markdown and its code blocks colored as you type. Enter continues a list, task or quote (Enter on an empty item ends it); Tab and Shift+Tab indent and outdent. `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link (the url selected to type over), `Ctrl+Shift+K` inline code, `Ctrl+Alt+T` (or **Format table** in the `⋯` menu) lines up the table the cursor is in. `Ctrl+F` finds and replaces in the note, `Ctrl+D` selects the next match (multiple cursors), `Ctrl+Z` undoes any of it. If the editor can't load, notes open in a plain text box and everything else works. Edit, Split or Preview (`Ctrl+E` cycles). Saves on its own a moment after you stop typing (`Ctrl+S` saves now). In the preview, click a task's box to tick it (that line changes and saves like any edit; tasks already sent to Docket stay as they are, since Docket owns them), and double-click anywhere to write there: Edit (Split on a wide screen) with the cursor on that line. The header keeps the view, **Copy for wiki** and **Trash**; Copy, Download, Rename, Save as template, Reset to starter and History are in its `⋯` menu (arrow keys, Escape).
- **Diagrams:** a ` ```mermaid ` block is drawn as a diagram in the preview (notes and Tandem pages alike), the same Markdown any Mermaid-aware editor renders. **Insert diagram** (the `⋯` menu, or the command) puts in a working starter: flowchart, sequence, entity relationship, state, class, architecture, C4 context, Gantt, timeline, mind map or git graph. Change the text and the preview redraws it; in Split view the diagram the cursor is in is outlined. A diagram with an error keeps its last good picture, dimmed, with Mermaid's message under it (or its source, if it never drew). Hover a diagram for **Edit**, **Copy SVG**, **SVG** and **PNG** (exports are drawn light, on white). Diagrams follow light and dark.
- **Code:** fenced code gets syntax colors in the preview (JavaScript and TypeScript, JSON, SQL, Python, C#, Java, Go, shell, YAML, CSS, HTML and XML, and diffs; other languages show plain) and a **Copy** button on hover.
- **Callouts and footnotes:** `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` (GitHub's syntax), with an optional title after the marker. `[^1]` in the text and `[^1]: ...` anywhere in the note make numbered footnotes, listed at the end with links both ways.
- **Slash menu:** type `/` at the start of a line (not in code) for headings, task, lists, quote, table, code block, the five callouts, every kind of diagram, a divider and today's date. Keep typing to narrow it (`/seq`, `/warn`), Enter puts it in.
- **Links:** standard relative Markdown links, `[Deploy](runbooks/deploy.md)`, so the files work in any Markdown tool and in the company wiki. Typing `[[` opens a note picker that inserts one; `[[note#` lists that note's headings and `[[#` this note's, and inserts a link to the heading. `[[wikilinks]]` written elsewhere are read and shown too. A link to a note that does not exist yet is marked; click it to make the note.
- **Embeds:** a paragraph that is only `![[Note]]` or `![[Note#Heading]]` (or `![label](note.md#heading)`) shows that note, or that section of it, in place: read only, its diagrams drawn, with a link to open it. So a diagram or a procedure lives in one note and shows wherever it's needed. Embeds go two deep and never loop. Embeds count as links for backlinks.
- **Map of links:** the `⋯` menu's **Map of links** draws the note, the notes it links to and the notes that link to it (and the links among them) as a diagram. Click a note to open it.
- **Backlinks:** the side panel lists every note that links to this one, with the line around the link.
- **Tags:** `#tag` in the text, or `tags: [a, b]` in frontmatter. Nested tags with `/` (`#team/platform`). Click a tag to search for it.
- **Search:** `/` or `Ctrl+Shift+F`. Words match titles, paths and text; `tag:ops`, `path:runbooks`, `lang:sql` (a code block in that language) and `has:diagram`, `has:code`, `has:task`, `has:image` or `has:link` filter (the empty results say so). Arrow keys and `Enter` open a result at its line, and the search clears so the pages come back.
- **Images:** paste or drop an image into the editor. It is saved under `notes/attachments/` and linked with `![name](attachments/...)`. PNG, JPEG, GIF and WebP. Remote images (`https://...`) are never loaded.
- **Export:** **Copy for wiki** puts the note on the clipboard twice over, with its images inside (diagrams stay ` ```mermaid ` blocks in the Markdown, and are PNG pictures in the HTML): as Markdown with each image embedded as a `data:image/...;base64` URL, and as HTML for a visual editor. Paste into the wiki's visual editor or its Markdown box. Embeds are expanded into their text (with their images), frontmatter is left out, and links to other notes, `[[wikilinks]]` and files in the folder become plain text in both forms, since they lead nowhere in the wiki; web links and links to headings in the note stay. In the HTML, code keeps its colors as inline styles and callouts become quotes with a bold title. The toast says how many images, diagrams and embedded sections went with it. **Copy** is the Markdown only, image links as they are; **Download** saves the `.md`. **Download HTML** saves the note as one self-contained web page: diagrams as SVG and images inside it, code colored, links to headings and footnotes working, links to other notes as plain text, and a CSP that lets it load nothing. **Print or save as PDF** prints the preview alone, in the light theme, with its diagrams drawn, from any view. Nothing is published or shared anywhere.
- **Quick Notes:** notes captured on Home (`n ...` in quick capture) are added to one note, `quick-notes.md`, newest first under a heading for each day. It is pinned at the top of the sidebar. Trash or rename it and the next capture makes a new one. If it has unsaved edits, captures wait until it saves. Notes captured in the Dispatch hub still become their own note in `inbox/`.
- **Focus hours** (inside Workshop, Settings, Focus hours; [Workshop docs/focus.md](https://github.com/adavidson21/workshop/blob/main/docs/focus.md)): captures picked up during focus or lunch are written as always, with no toast, and counted in Folio's `held` summary card for Workshop's release toast and Dispatch's digest.
- **Templates:** notes in `templates/` (edit them like any note), listed in the Templates section. Each shows by its name (Meeting notes, Decision record (ADR), and so on), not its `# {{title}}` heading. The starter set (meeting, incident, ADR, runbook, retro, design doc, API endpoint, architecture overview, postmortem, daily, product; the developer ones come with diagrams) is always offered, even before its files exist; a file of the same name wins, and the file is written the first time you change one. A new note offers them in a bar above it until you write below the title (hover one to see what it is for), each with a pencil to change that template in one click; the title you typed is kept, and `{{title}}`, `{{slug}}`, `{{date}}` and `{{time}}` are filled in, and `{{docket}}` in the daily template (below). An open template has **Name** and **Description** boxes (they write `template:` and `description:` in its frontmatter, which notes made from it leave out) and a chip for each placeholder that inserts it; its preview shows placeholders as labeled chips. **Save as template** (the `⋯` menu) turns any note into one: its title line becomes `# {{title}}`. **Reset to starter** puts a starter back, with what it said kept in History. There is no 1:1 template: 1:1s live in Rapport.
- **Today's note:** `T`, the calendar button, the *Open today's note* command, or the address: `notes.alexisdavidson.org/#/today` on its own (handy as a phone home screen bookmark), `#/notes/today` inside Workshop. Any note opens the same way, `#/<note path>`. It is `daily/<YYYY-MM-DD>.md`, made from `templates/daily.md` the first time. Inside Workshop, `{{docket}}` in that template becomes your Today tasks from Docket (or its top 3 when Today is empty), each a link that opens the task; without Docket it is one empty checkbox. They are links, not checkboxes, because Docket owns whether a task is done. The starter daily template uses it; if you made `templates/daily.md` before, add `{{docket}}` under `## Plan` yourself.
- **Docket's wrap-up:** when you wrap up the day in Docket with *Add a wrap-up to today's note* ticked, a `## Wrap-up` section lands in that day's note: done, where you left off, tomorrow, and the day's counts. Wrapping up again replaces it, unless you edited it: then a new `## Wrap-up (2)` goes below and your words stay. A note you're editing waits until it's saved.
- **Links to other apps:** `[Fix the login timeout](ws:prioritizer/task/t_k2f9)` links to a record in another app: `ws:<app id>/<route>`, using the routes in that app's manifest (`ws:runway`, `ws:receipts/team/p_1`). It shows as a chip with the app's name and opens that app there (inside Workshop) or Workshop's site (on Folio's own site). Only an app id and plain route characters are accepted.
- **Linking without ids:** the `[[` picker also finds other apps' records once you've typed two letters: Docket's open tasks and Runway's roadmaps, listed under *In other apps* with the app's name. Enter writes the `ws:` link. In Docket, **Copy link** (or `L`) gives you a task's link, and a task's details list the notes that link to it. `#/search/<words>` opens Folio on a search.
- **People:** inside Workshop, type `@` for people from Workshop's People directory (reports first). `@priya` shows as **Priya Raman** in the preview; a handle nobody has stays as typed.
- **Action items and receipts:** the side panel lists the open `- [ ] ...` items and the lines tagged `#win`, `#feedback`, `#growth` or `#concern`, with **Send all (N)** beside each heading for the ones not sent yet. **To Docket** adds an item as a Docket task right away (your click is the acceptance), with the line's `@people` as the task's People. **To Rapport** offers a tagged line to Rapport, one receipt per direct report it names, filed on their page (`payload.about`); a line naming no report goes as your own, and the row says why ("You · win (Jo isn't a report)"). Each row shows who and the kind before you send, then *Sent*; the same line is never sent twice. Ticking an item in the note does not close the task: Docket owns it after you send it. Shown inside Workshop, or when paired; on its own, the panel says once that pairing lets them go to Docket.
- **History:** before a save replaces a note, its previous text is kept in `history/` (at most one version per 5 minutes, newest 20 per note). The side panel's **History** shows them and restores one; what it replaces goes into history first. `history/` is left out of the tree, search and backlinks.
- **Import a folder:** in the sidebar's foot, pick a folder of Markdown (an Obsidian vault). Every file and its new name are listed before anything is written: names become Workshop-style slugs under one folder named after the vault, `[[wikilinks]]` and `![[embeds]]` become standard links to the new paths, and a note with no title keeps its old file name as its frontmatter title. Only notes and images come in; nothing already here changes.
- **Product notes:** one note per product in `products/`, the memory Tandem (eng-agents) reads before working on that product and adds to as it learns. The **Products** list in the sidebar shows them. When Tandem changes one, it gets a **Changed by Tandem** mark and a bar with **Mark reviewed**; the preview highlights what changed since your last review, and History has every earlier version. **N to review** (or search `is:review`, or `#/notes/review`) lists them all. New ones come from `templates/product.md` (in the starter set), which tags the note `product/<name>`. Tag any other note `product/<name>` to file it with that product.
- **Other apps' files are never shown.** Folio lists, reads and searches only its own folder. Rapport's 1:1 notes and goals stay in Rapport (and Rapport marks its files private, so other apps can't read them either; see `privateFiles` in Workshop's [docs/app-manifest.md](https://github.com/adavidson21/workshop/blob/main/docs/app-manifest.md)).

## For other apps

Other apps work with Folio through Workshop's contracts, never by reading its code:

- **Summary** (`notes.summary`, Workshop [docs/summaries.md](https://github.com/adavidson21/workshop/blob/main/docs/summaries.md)): `count` (id `notes`), `list` (id `recent`: the 10 notes changed last), `list` (id `mentions`: notes with a `ws:` link; each record's newest 3 notes first, then the rest newest first, up to 50; each row's `note` is the record, `<app>/<route>`, so that app can show "Notes about this"), and `count` (id `review`: product notes Tandem changed since your last review, `route` `review`). Titles and paths only, never note text. Templates are left out.
- **Handoffs out** (`notes.handoffs` v1, [docs/handoffs.md](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)): accepted `task` offers to `prioritizer` (with `who` from the line's `@people`) and ordinary `win`, `feedback`, `growth` or `concern` offers to `receipts`, with `about` for a direct report. Ids are `n-<kind>-<hash of the note path, text and person>`. `source` is `{app: 'notes', id: <note path>}`.
- **Captures in:** Home's quick capture (`n ...`) and the Dispatch hub, as before (below). `n <folder>: ...` makes a new note in that folder and `n today: ...` adds a bullet under `## Notes` in today's note (`payload.folder`, `payload.daily`). A folder that's gone by then falls back to Quick Notes or `inbox/`, with a toast saying so.
- **Capture targets:** `targets` card id `folders` (`capture: "note"`): a `today` row, then folders with notes, most recently used first, up to 199, leaving out `templates/`, `daily/`, `history/` and `attachments/`.
- **Into a day's note:** an accepted `note` offer with `payload.daily` (YYYY-MM-DD) goes into that day's note, made from the daily template if needed. With `payload.section` and `payload.lines` (Docket's wrap-up) it writes a `## <section>` of bullets that a later offer replaces only while it is unchanged; otherwise the text goes under `## Notes`. Docket (`prioritizer`) is a sender.
- **Reads:** Docket's summary (`prioritizer.summary`, card `board`, `days[<day>].focus.tasks` and `upNext`) for `{{docket}}`.
- **Routes:** `#/notes/<note path>` opens a note, `#/notes/today` today's note, `#/notes/tandem/<folder>/<file>` a Tandem document (Dispatch's **Open in Notebook**).
- **Tandem's documents** (the Tandem section): the opencode connector's `docs.list`, `file.read` and `file.write` (Workshop `connectors/opencode/README.md`, Documents). `file.write` carries the text read (`expected`), so a change Tandem made meanwhile is a conflict, never overwritten; it is refused while Tandem works on that folder. A Tandem page's path inside Folio is `tandem:<folder>/<file>`: no history, rename, trash or offers for it. The section shows only where the connector answers `docs.list`.

### Tandem and product notes

Tandem (eng-agents) is the one program outside Folio that writes notes, and only these. Its rules:

- **Where:** `<Workshop folder>/notes/products/<slug>.md` (`dataDir` in `~/.workshop/config.json`), and snapshots in `notes/history/`. Nothing else in the folder. Never deletes, renames or moves a note. Skips product notes when Folio is switched off (`notes` in `~/.workshop/apps.json`'s `off` list).
- **New notes** come from `templates/product.md` (or the copy in `js/products.js` if you deleted yours) with `{{title}}` and `{{slug}}` filled in.
- **Before every edit**, Tandem keeps the current text as a snapshot, even inside Folio's 5-minute spacing, and trims the note's snapshots to the newest 20:
  - Folder: `history/<key>/`, where `<key>` is the note path without `.md`, every run of characters outside `a-z0-9` made one `-`, `-` trimmed from both ends, cut to `39 - length(hash)` characters with trailing `-` removed, then `-<hash>`. `<hash>` is the 32-bit FNV-1a of the path's UTF-16 code units (start `0x811c9dc5`, multiply `0x01000193`), unsigned, in base 36. `products/wiki-edge.md` gives `products-wiki-edge-<hash>`. `js/history.js` `historyKey` is the reference.
  - File: the UTC time as `YYYYMMDDtHHMMSSmmmz.md` (`20261105t171230123z.md`).
- **The write:** read the note and its modified time, snapshot, write to a temp file in the same folder and rename it over the note. If the modified time changed in between, start again. Folio picks the change up; if you have unsaved edits it offers its usual conflict choices.
- **Frontmatter:** set `tandem-changed:` to the UTC time of the write (`2026-11-05T22:14:00Z`). Never touch `reviewed:`: only Mark reviewed sets it. A note needs review while `tandem-changed` is later than `reviewed` (or there is no `reviewed`).
- **Edits are small:** change or add the one line that is new, update a line instead of adding a second on the same subject, and end each line Tandem writes with its date and source (`(2026-11-05, PR 4812)`). No `- [ ]` lines: Folio would offer them to Docket.

## Files

```
<Workshop folder>/notes/
  guide.md
  runbooks/deploy.md
  daily/2026-11-05.md
  products/wiki-edge.md
  templates/meeting.md
  attachments/screen-shot-20261103-093015.png
  history/runbooks-deploy-1a2b3c/20261105t171230123z.md
```

Folio reads and writes only through `ws.files`, so it works with Workshop running on this computer and in browser mode on a folder you chose. File names follow Workshop's name rules ([docs/data-format.md](https://github.com/adavidson21/workshop/blob/main/docs/data-format.md), Names): lowercase letters, digits and `-`, at most 3 folders deep. The file name comes from the title (`Deploy Runbook` becomes `deploy-runbook.md`); the title shown is the note's first `# heading` or its frontmatter `title`. Files with other names (capitals, spaces) are ignored by Workshop, so an existing Obsidian vault needs its names lowercased before Folio sees them.

Edit the files with any editor: Folio picks up changes made outside it.

## Behavior

- **Conflicts.** A save carries the modified time the note was read at. If the file changed elsewhere since (another window, another editor), nothing is overwritten: Folio keeps your text on screen and offers **Load the new version**, **Save mine as a copy** (`<name>-conflict.md` beside it) or **Overwrite with mine**. If you have no unsaved edits, the new version just loads.
- **Failed saves** (Workshop stopped, folder access needed) keep your text, say "Not saved yet", and retry every 5 seconds.
- **Rename and move** show the notes whose links will change, each with a checkbox, before anything is written. The new file is written first, then the links, then the old file goes to the trash. Links in code are never changed. A moved note's own relative links are rewritten so they still reach what they did.
- **Trash** moves files to the folder's `.trash/`. Nothing is deleted.
- The view (Edit, Split, Preview) and the last note opened are remembered per browser.

## Security

- The Markdown renderer (`js/markdown.js`) escapes every character of the note; the only markup is what it writes. Raw HTML in a note shows as text.
- Only `http(s)` links are clickable to the web, opening in a new tab with no referrer. `javascript:`, `data:` and other schemes are plain text. Links to notes and images stay inside the folder.
- Images come from the folder through `ws.files` as `blob:` URLs.
- Diagrams are drawn by Mermaid with `securityLevel: 'strict'` and no HTML labels: labels are sanitized and click handlers are off, so a diagram is only ever an SVG picture. Mermaid is loaded from this site, never a CDN. The page's CSP allows `img-src 'self' blob:` only.

## Code

- `js/markdown.js`: Markdown to safe HTML, and a note's title, tags, links and headings. No DOM.
- `js/model.js`: paths and name rules, the index (backlinks, tags, missing links), search, the tree, and link rewriting for renames and moves. No DOM.
- `js/products.js`: product notes, the review fields, the version to compare with and the changed lines. Pure.
- `js/templates.js`, `js/template-info.js`, `js/applinks.js`, `js/offers.js`, `js/history.js`, `js/vault.js`, `js/summary-cards.js`: templates (and their names and uses) and today's note, `ws:` links, action items and wins, history, importing a folder, and Folio's summary. Pure.
- `js/diagram-kits.js`: the diagram starters, finding ` ```mermaid ` blocks in a note, and putting a block on lines of its own. Pure.
- `js/diagrams.js`: drawing diagrams with Mermaid (`vendor/mermaid.min.js`, MIT, loaded only when a note has one), and SVG and PNG exports.
- `js/highlight.js`: syntax colors for code blocks: a small scanner, escape-first. Pure.
- `js/editor.js`: the editor. CodeMirror (`vendor/codemirror.js`) behind a textarea-shaped object, so the rest of the page doesn't care which it is; the plain textarea if it can't load.
- `js/slash.js`, `js/tables.js`: the slash menu's entries and what each one inserts; lining up a pipe table. Pure.
- `js/embeds.js`, `js/map.js`: what an embed names and which part of a note it shows; the map of links as a Mermaid flowchart. Pure.
- `js/data.js`: loading, saving (with history), outside changes and images through `ws.files`.
- `js/pickup.js`: captures from Home and the Dispatch hub.
- `js/export.js`: Copy for wiki (images embedded, and HTML for visual editors), and Download HTML's page.
- `js/view.js`: HTML for the sidebar, header, side panel and dialogs.
- `js/sections.js`, `js/tandem.js`, `js/edits.js`: which section a page is in and the Daily list; the Tandem section's paths and names and its connector calls; ticking a task line, the `# #` title fix, and bold, italic, code and link. Pure, except `createTandem`.
- `js/main.js`: the page: sections and the drawer, editor, autosave, conflicts, the `[[` picker, renames, sending, history, templates, import, keys.

Tests: `node --test "test/*.test.mjs"`, and in a browser `python test/e2e.py` (needs `pip install playwright && python -m playwright install chromium`). CI runs both.

### Vendored libraries

`vendor/` holds third-party code served from this site (the CSP allows scripts from `'self'` only):

- `mermaid.min.js` (Mermaid 11, MIT, `vendor/mermaid-LICENSE`), copied from the npm package's `dist/`. To update: `npm i mermaid@11` in a scratch folder and copy `dist/mermaid.min.js` over it.
- `codemirror.js`: CodeMirror 6 and the code languages the editor colors (MIT), one ES module built from `scripts/editor/entry.js`. To change or update it: `cd scripts/editor && npm install && cd ../.. && node scripts/build-editor.mjs`, then commit `vendor/codemirror.js` and `scripts/editor/package-lock.json`.

### Files from Workshop

These are exact copies of Workshop files, listed in `workshop-files.json` with the Workshop commit they came from: `shared/` (the SDK, themes, fonts, the top bar, pairing), `icons/`, and the test helpers and data contract schemas in `test/workshop/`. Folio keeps them so it runs on its own, and so inside Workshop it reads and writes data exactly as Workshop's other apps do.

- **Never edit them here.** Change the file in Workshop, then run `node scripts/sync-workshop.mjs --update` to copy the latest and pin that commit.
- CI runs `node scripts/sync-workshop.mjs --check`, which fails if any copy differs from the pinned commit.

### Deploying

`npx wrangler deploy` publishes this repo to the `notes` Cloudflare Worker at https://notes.alexisdavidson.org (`wrangler.jsonc`; `.assetsignore` keeps tests and scripts off the site). Workshop reaches it through a service binding to that Worker, so keep the Worker's name. The data id stays `notes`: existing files keep working.

### Releasing

Actions, **Release**, Run workflow. The tag is `v<version>` from `app.json`. Bump `app.json` and `sw.js` together.

# Notes

Markdown notes as plain `.md` files, like a small Obsidian. It runs two ways, with the same files:

- **On its own** at https://notes.alexisdavidson.org. Notes are saved in your browser, or in a folder you choose (Chrome and Edge). **Use Workshop on this computer** in the sidebar's foot pairs the site with Workshop, and notes become the files in your Workshop folder. Install it as an app from the browser (desktop or phone); it works offline.
- **Inside [Workshop](https://github.com/adavidson21/workshop)** at https://workshop.alexisdavidson.org, as one of its apps. Workshop's Worker proxies `/apps/notes/*` to this site, so every deploy here shows up in Workshop too.

Nothing leaves your device: no accounts, no server, no analytics.

Plan: `claude/notes-standalone-plan.md` in the personal toools Project.

## What it does

- **Folder tree:** notes and folders under `<Workshop folder>/notes/` (or the browser or folder you chose). New note (`N`), new folder, rename or move (`F2`, the folder's `⋯`, or drag onto a folder), and trash. Folders with no notes are not kept.
- **Editor:** Edit, Split or Preview (`Ctrl+E` cycles). Saves on its own a moment after you stop typing (`Ctrl+S` saves now).
- **Links:** standard relative Markdown links, `[Deploy](runbooks/deploy.md)`, so the files work in any Markdown tool and in the company wiki. Typing `[[` opens a note picker that inserts one. `[[wikilinks]]` written elsewhere are read and shown too. A link to a note that does not exist yet is marked; click it to make the note.
- **Backlinks:** the side panel lists every note that links to this one, with the line around the link.
- **Tags:** `#tag` in the text, or `tags: [a, b]` in frontmatter. Nested tags with `/` (`#team/platform`). Click a tag to search for it.
- **Search:** `/` or `Ctrl+Shift+F`. Words match titles, paths and text; `tag:ops` and `path:runbooks` filter. Arrow keys and `Enter` open a result at its line.
- **Images:** paste or drop an image into the editor. It is saved under `notes/attachments/` and linked with `![name](attachments/...)`. PNG, JPEG, GIF and WebP. Remote images (`https://...`) are never loaded.
- **Export:** **Copy for wiki** puts the note on the clipboard twice over, with its images inside: as Markdown with each image embedded as a `data:image/...;base64` URL, and as HTML for a visual editor. Paste into the wiki's visual editor or its Markdown box. Links to other notes become plain text in the HTML (they lead nowhere outside Workshop) and stay as written in the Markdown. **Copy** is the Markdown only, image links as they are; **Download** saves the `.md`. Nothing is published or shared anywhere.
- **Quick Notes:** notes captured on Home (`n ...` in quick capture) are added to one note, `quick-notes.md`, newest first under a heading for each day. It is pinned at the top of the sidebar. Trash or rename it and the next capture makes a new one. If it has unsaved edits, captures wait until it saves. Notes captured in the Dispatch hub still become their own note in `inbox/`.
- **Templates:** notes in `templates/` (edit them like any note). **New note** offers them; `{{title}}`, `{{date}}` and `{{time}}` are filled in. With none yet, the dialog adds a starter set: meeting, incident, ADR, runbook, retro and daily. There is no 1:1 template: 1:1s live in Rapport.
- **Today's note:** `T`, the calendar button, the *Open today's note* command, or `#/notes/today`. It is `daily/<YYYY-MM-DD>.md`, made from `templates/daily.md` the first time.
- **Links to other apps:** `[Fix the login timeout](ws:prioritizer/task/t_k2f9)` links to a record in another app: `ws:<app id>/<route>`, using the routes in that app's manifest (`ws:runway`, `ws:receipts/team/p_1`). It shows as a chip with the app's name and opens that app there (inside Workshop) or Workshop's site (on Notes' own site). Only an app id and plain route characters are accepted.
- **Action items and wins:** the side panel lists the open `- [ ] ...` items and the lines tagged `#win` in the note. **To Docket** adds an item as a Docket task right away (your click is the acceptance). **To Rapport** offers a win to Rapport, where you accept it and pick who it is about. Each shows *Sent* after; the same line is never sent twice. Ticking an item in the note does not close the task: Docket owns it after you send it. Shown inside Workshop, or when paired.
- **History:** before a save replaces a note, its previous text is kept in `history/` (at most one version per 5 minutes, newest 20 per note). The side panel's **History** shows them and restores one; what it replaces goes into history first. `history/` is left out of the tree, search and backlinks.
- **Import a folder:** in the sidebar's foot, pick a folder of Markdown (an Obsidian vault). Every file and its new name are listed before anything is written: names become Workshop-style slugs under one folder named after the vault, `[[wikilinks]]` and `![[embeds]]` become standard links to the new paths, and a note with no title keeps its old file name as its frontmatter title. Only notes and images come in; nothing already here changes.
- **Other apps' files are never shown.** Notes lists, reads and searches only its own folder. Rapport's 1:1 notes and goals stay in Rapport (and Rapport marks its files private, so other apps can't read them either; see `privateFiles` in Workshop's [docs/app-manifest.md](https://github.com/adavidson21/workshop/blob/main/docs/app-manifest.md)).

## For other apps

Other apps work with Notes through Workshop's contracts, never by reading its code:

- **Summary** (`notes.summary`, Workshop [docs/summaries.md](https://github.com/adavidson21/workshop/blob/main/docs/summaries.md)): `count` (id `notes`), `list` (id `recent`: the 10 notes changed last), and `list` (id `mentions`: notes with a `ws:` link, newest 20, each row's `note` is the record, `<app>/<route>`, so that app can show "Notes about this"). Titles and paths only, never note text. Templates are left out.
- **Handoffs out** (`notes.handoffs` v1, [docs/handoffs.md](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)): accepted `task` offers to `prioritizer` and ordinary `win` offers to `receipts`. Ids are `n-<kind>-<hash of the note path and text>`. `source` is `{app: 'notes', id: <note path>}`.
- **Captures in:** Home's quick capture (`n ...`) and the Dispatch hub, as before (below).
- **Routes:** `#/notes/<note path>` opens a note, `#/notes/today` today's note.

## Files

```
<Workshop folder>/notes/
  guide.md
  runbooks/deploy.md
  daily/2026-11-05.md
  templates/meeting.md
  attachments/screen-shot-20261103-093015.png
  history/runbooks-deploy-1a2b3c/20261105t171230123z.md
```

Notes reads and writes only through `ws.files`, so it works with Workshop running on this computer and in browser mode on a folder you chose. File names follow Workshop's name rules ([docs/data-format.md](https://github.com/adavidson21/workshop/blob/main/docs/data-format.md), Names): lowercase letters, digits and `-`, at most 3 folders deep. The file name comes from the title (`Deploy Runbook` becomes `deploy-runbook.md`); the title shown is the note's first `# heading` or its frontmatter `title`. Files with other names (capitals, spaces) are ignored by Workshop, so an existing Obsidian vault needs its names lowercased before Notes sees them.

Edit the files with any editor: Notes picks up changes made outside it.

## Behavior

- **Conflicts.** A save carries the modified time the note was read at. If the file changed elsewhere since (another window, another editor), nothing is overwritten: Notes keeps your text on screen and offers **Load the new version**, **Save mine as a copy** (`<name>-conflict.md` beside it) or **Overwrite with mine**. If you have no unsaved edits, the new version just loads.
- **Failed saves** (Workshop stopped, folder access needed) keep your text, say "Not saved yet", and retry every 5 seconds.
- **Rename and move** show the notes whose links will change, each with a checkbox, before anything is written. The new file is written first, then the links, then the old file goes to the trash. Links in code are never changed. A moved note's own relative links are rewritten so they still reach what they did.
- **Trash** moves files to the folder's `.trash/`. Nothing is deleted.
- The view (Edit, Split, Preview) and the last note opened are remembered per browser.

## Security

- The Markdown renderer (`js/markdown.js`) escapes every character of the note; the only markup is what it writes. Raw HTML in a note shows as text.
- Only `http(s)` links are clickable to the web, opening in a new tab with no referrer. `javascript:`, `data:` and other schemes are plain text. Links to notes and images stay inside the folder.
- Images come from the folder through `ws.files` as `blob:` URLs. The page's CSP allows `img-src 'self' blob:` only.

## Code

- `js/markdown.js`: Markdown to safe HTML, and a note's title, tags, links and headings. No DOM.
- `js/model.js`: paths and name rules, the index (backlinks, tags, missing links), search, the tree, and link rewriting for renames and moves. No DOM.
- `js/templates.js`, `js/applinks.js`, `js/offers.js`, `js/history.js`, `js/vault.js`, `js/summary-cards.js`: templates and today's note, `ws:` links, action items and wins, history, importing a folder, and Notes' summary. Pure.
- `js/data.js`: loading, saving (with history), outside changes and images through `ws.files`.
- `js/pickup.js`: captures from Home and the Dispatch hub.
- `js/export.js`: Copy for wiki (images embedded, and HTML for visual editors).
- `js/view.js`: HTML for the sidebar, header, side panel and dialogs.
- `js/main.js`: the page: editor, autosave, conflicts, the `[[` picker, renames, sending, history, import, keys.

Tests: `node --test "test/*.test.mjs"`.

### Files from Workshop

These are exact copies of Workshop files, listed in `workshop-files.json` with the Workshop commit they came from: `shared/` (the SDK, themes, fonts, the top bar, pairing), `icons/`, and the test helpers and data contract schemas in `test/workshop/`. Notes keeps them so it runs on its own, and so inside Workshop it reads and writes data exactly as Workshop's other apps do.

- **Never edit them here.** Change the file in Workshop, then run `node scripts/sync-workshop.mjs --update` to copy the latest and pin that commit.
- CI runs `node scripts/sync-workshop.mjs --check`, which fails if any copy differs from the pinned commit.

### Deploying

`npx wrangler deploy` publishes this repo to the `notes` Cloudflare Worker at https://notes.alexisdavidson.org (`wrangler.jsonc`; `.assetsignore` keeps tests and scripts off the site). Workshop reaches it through a service binding to that Worker, so keep the Worker's name. The data id stays `notes`: existing files keep working.

### Releasing

Actions, **Release**, Run workflow. The tag is `v<version>` from `app.json`. Bump `app.json` and `sw.js` together.

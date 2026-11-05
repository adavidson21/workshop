# Notes

Markdown notes in your Workshop folder, like a small Obsidian. Plan: `claude/notes-v1-plan.md` in the Workshop project (WS15).

- **Folder tree:** notes and folders under `<Workshop folder>/notes/`. New note (`N`), new folder, rename or move (`F2`, the folder's `⋯`, or drag onto a folder), and trash. Folders with no notes are not kept.
- **Editor:** Edit, Split or Preview (`Ctrl+E` cycles). Saves on its own a moment after you stop typing (`Ctrl+S` saves now).
- **Links:** standard relative Markdown links, `[Deploy](runbooks/deploy.md)`, so the files work in any Markdown tool and in the company wiki. Typing `[[` opens a note picker that inserts one. `[[wikilinks]]` written elsewhere are read and shown too. A link to a note that does not exist yet is marked; click it to make the note.
- **Backlinks:** the side panel lists every note that links to this one, with the line around the link.
- **Tags:** `#tag` in the text, or `tags: [a, b]` in frontmatter. Nested tags with `/` (`#team/platform`). Click a tag to search for it.
- **Search:** `/` or `Ctrl+Shift+F`. Words match titles, paths and text; `tag:ops` and `path:runbooks` filter. Arrow keys and `Enter` open a result at its line.
- **Images:** paste or drop an image into the editor. It is saved under `notes/attachments/` and linked with `![name](attachments/...)`. PNG, JPEG, GIF and WebP. Remote images (`https://...`) are never loaded.
- **Export:** **Copy for wiki** puts the note on the clipboard twice over, with its images inside: as Markdown with each image embedded as a `data:image/...;base64` URL, and as HTML for a visual editor. Paste into the wiki's visual editor or its Markdown box. Links to other notes become plain text in the HTML (they lead nowhere outside Workshop) and stay as written in the Markdown. **Copy** is the Markdown only, image links as they are; **Download** saves the `.md`. Nothing is published or shared anywhere.
- **Quick Notes:** notes captured on Home (`n ...` in quick capture) are added to one note, `quick-notes.md`, newest first under a heading for each day. It is pinned at the top of the sidebar. Trash or rename it and the next capture makes a new one. If it has unsaved edits, captures wait until it saves. Notes captured in the Dispatch hub still become their own note in `inbox/`.
- **Other apps' files are never shown.** Notes lists, reads and searches only its own folder. Rapport's 1:1 notes and goals stay in Rapport (and Rapport marks its files private, so other apps can't read them either; see `privateFiles` in [docs/app-manifest.md](../../docs/app-manifest.md)).

## Files

```
<Workshop folder>/notes/
  guide.md
  runbooks/deploy.md
  attachments/screen-shot-20261103-093015.png
```

Notes reads and writes only through `ws.files`, so it works with Workshop running on this computer and in browser mode on a folder you chose. File names follow Workshop's name rules ([docs/data-format.md](../../docs/data-format.md), Names): lowercase letters, digits and `-`, at most 3 folders deep. The file name comes from the title (`Deploy Runbook` becomes `deploy-runbook.md`); the title shown is the note's first `# heading` or its frontmatter `title`. Files with other names (capitals, spaces) are ignored by Workshop, so an existing Obsidian vault needs its names lowercased before Notes sees them.

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
- `js/data.js`: loading, saving, outside changes and images through `ws.files`.
- `js/export.js`: Copy for wiki (images embedded, and HTML for visual editors).
- `js/view.js`: HTML for the sidebar, header, side panel and dialogs.
- `js/main.js`: the page: editor, autosave, conflicts, the `[[` picker, renames, keys.

Tests: `node --test apps/notes/test/*.test.mjs`. The browser flow is in `tests/e2e.py` (parts 1 and 6).

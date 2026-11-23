# Knowledge base

What Tandem (eng-agents) needs to know about your products, your team and your voice, kept once in your data folder and read by agents in one call. Plan and as-built notes: the Workshop project doc `claude/knowledge-base-v1-plan.md`.

Version: Knowledge base V1 (Settings 7.0.0, Notes 4.9.0, Chat 3.1.0, opencode connector 1.19.0, Tandem Core 4.7.0).

## One home for each fact

| What | Home | Edited in | Tandem reads it with |
| --- | --- | --- | --- |
| Products: names, other names, repos, area paths, change order, entry points, external systems, processes, docs folder | `settings/products.json` ([products.md](products.md)) | Settings, Knowledge, Products | The repo map, `Get-Knowledge.ps1` |
| Glossary | `settings/glossary.json` ([glossary.md](glossary.md)) | Settings, Knowledge, Glossary | The repo map, `Get-Knowledge.ps1` |
| What each repo is | `settings/repos.json` (Settings' own, below) | Settings, Knowledge, Repo map | The repo map |
| Owners and who to ask | `settings/people.json`, People's Owns ([people.md](people.md)) | Settings, People | `Get-Knowledge.ps1` |
| Product prose: summary, business rules, gotchas, decisions, links | `folio/products/<slug>.md` | Notes | `Get-Knowledge.ps1` |
| Team process: sprints, work item states, pull requests, releases, definition of done | `folio/team/handbook.md` | Notes | `Get-Knowledge.ps1` |
| Your voice | `settings/writing.json`, exported to `settings/voice.md` ([writing.md](writing.md)) | Settings, Writing voice | The writer agent |
| Code facts | `<repo>/AGENTS.local.md` (the repo guide) | The repo guide | As before |
| Tandem's edits to repo guides and global rules | Logged in `folio/tandem/changes.md` | Notes' review list | n/a |

**Split rule.** A fact that would still be true after the code was rewritten goes in the product note, or in the handbook when it is about the team rather than one product. A fact about one codebase goes in that repo guide. Never both. Who owns what lives only in People; product notes name no owners.

## The repo map

The workspace repo map, `<workspace>/AGENTS.md`, is loaded by opencode in every session. Workshop writes it from Settings: products, the glossary, `settings.repos` and what each repo guide says (its `Stack:` line). Nothing in it is typed by hand any more.

- **Marker.** A map Workshop wrote starts with `<!-- Written by Workshop -->`. Workshop never overwrites a file without it until you import it (below).
- **Shape.** The same as eng-agents' `company/repo-map.template.md`, so agents read it as before: `## Repos` (Folder, What it is, Stack, Shared?), `## Products` (one `###` block each: Also called, Note, Area paths, a repo table, Usually change together, Change order, Entry points, External systems, Business processes, Product docs, Owners), `## Glossary` (Word, In the code, Product) and `## Knowledge` (where the rest lives, and the `Get-Knowledge.ps1` line). `shared/knowledge.js` `buildRepoMap` writes it; its tests pin the shape.
- **Shared?** is Yes for a repo in two or more products.
- **What it is** comes from `settings.repos`; a repo not there keeps the text the map had (so a row the opencode connector's `repo.add` put in survives), else the repo guide's purpose, else `TODO(you)`.
- **When.** Settings writes it on **Write it now**, and after a save on Products, Glossary or Repo map while **Keep it up to date** is on (`meta.autoWrite` in `settings.repos`, on by default). Only when the map is missing or already Workshop's.
- **Import.** A hand-written map is read once with `parseRepoMap` (the template's format). Settings shows what it would add (new products, repos on existing products, glossary words, repo descriptions), adds what you accept, and leaves everything already in Settings alone. The first write after that keeps your file beside it as `AGENTS.md.hand-written.md`.

### settings.repos

Settings' own collection `repos` (`settings.repos` v1), not read by other apps. Items: `{id: "r_<slug of folder>", updatedAt, folder, about}`. `meta.autoWrite` (boolean, default true) and `meta.writtenAt` (ms, the last write).

### opencode connector actions

| Action | Write | What |
| --- | --- | --- |
| `knowledge.repos` | no | Each workspace repo: `{folder, guide, stack, purpose, remembered[]}`. `guide` is the repo guide's file name or `null`; `remembered` the lines of its `## Remembered`. |
| `knowledge.map.read` | no | `{path, exists, generated, text}` for `<workspace>/AGENTS.md`. |
| `knowledge.map.write` | yes | `{text}`. Refuses text that does not start with the marker. When the current file is not Workshop's, it is kept once as `AGENTS.md.hand-written.md` (never overwritten). Returns `{path, kept}`. |
| `knowledge.draft` | yes | `{product}`. Starts `/product-notes draft <product>` in a new session (Tandem reads the product's READMEs, docs and docs folder and writes note lines with sources, for you to review in Notes). |

## Get-Knowledge.ps1

`Get-Knowledge.ps1 -Product <name>` (Tandem Core 4.7.0) prints one block: the product's Settings fields, its glossary words (and words for any product), its owners from People (name, role, what they own), its product note without frontmatter, and the team handbook. `-Handbook` prints only the handbook. A product is found by name, another name or slug, case ignored. Missing parts are skipped with one line saying so; nothing is an error. Over about 400 lines, the handbook is cut first and the output says so.

Agents call it once, after matching work to a product in the repo map, instead of reading the map block and then the note. The hub and chat agents cannot run scripts, so they read the same files with `Get-Content`.

## Notes Tandem may write

Through `Set-ProductNote.ps1` only, with a snapshot first and `tandem-changed` set, so each shows in Notes' review list ([Notes' README](../apps/notes/README.md), "Tandem and product notes"):

- `products/<slug>.md`, as before.
- `team/handbook.md`: Notes makes it once from its built-in template, like product notes.
- `tandem/changes.md`: one line per change Tandem makes to a repo guide's `## Remembered` or to the global rules (`memory.md`), so you review those in the same place. Kept to the newest 100 lines.

## Freshness

- A product note or the handbook is **stale** when it was last reviewed (`reviewed:`) more than 90 days ago, or never reviewed and not changed for 90 days. Notes shows **Stale** with **Still right** (marks it reviewed); `is:stale` finds them.
- When Tandem finds a line the code contradicts but cannot confirm the right value, it flags it: `Set-ProductNote.ps1 -Flag "<line text>" -Reason "<why>" -Source <where>` adds `(check: <why>, <date>, <source>)` to the line. A flagged line also counts as stale.

## Checks

Settings, Knowledge, Checks lists what is kept twice or missing (`shared/knowledge.js` `checks`): a workspace repo in no product; a product repo not in the workspace; a glossary word listed twice; a product note whose People section still lists owners the directory has (`Name: owns ...`, as older Notes versions copied them in); the same line in a product note and a repo guide's `## Remembered`; a hand-written repo map while products exist. Each finding links to where it is fixed.

## Citations

Hub and chat answers end with a `Sources:` list of the files they used, one per line, as code spans. Chat turns that list into chips: a Notes note opens in Notes (with **That's wrong**, which opens it to fix the line), a Settings file opens its Knowledge tab, anything else is shown as a path.

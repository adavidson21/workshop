# `.work` file format

Version: **`work: 1`**, matching eng-agents at commit `e2d202a` (core 2.1.0, Dashboard 1.6.1).

eng-agents writes these files; the opencode connector (WS3) and the Agents app (WS6) read them. This document is the contract between the two repos. It lives in Workshop for now because eng-agents is frozen until WS8. Any change to the wording below, in either repo, is a contract change ([README.md](README.md), Changing a contract).

The rules here describe what eng-agents' parser (`core/scripts/dashboard/New-Dashboard.ps1`) and its commands do today. Where the parser has a quirk, it is listed under Known quirks, not fixed. A JavaScript port (WS3, later) must produce the same results; the regexes below are written in JavaScript syntax for that port.

An example workspace is in [examples/work/](examples/work/). It is synthetic. `tests/contract/work-format.test.mjs` parses it with the regexes in this file and compares the result to [examples/work/expected.json](examples/work/expected.json).

## Folders

The work root is `.work/` in the workspace (the folder that holds the repos). Each direct subfolder is one item:

| Folder name | Kind | Notes |
| --- | --- | --- |
| `<id>-<name>` (regex `itemFolder`) | `item`: an ADO work item in the pipeline | `<id>` is digits. `<name>` is a short slug. |
| `spike-<name>`, `docs-<name>`, `tsd-<name>` (regex `notesFolder`) | `spike`, `docs`, `tsd` | Light treatment: title, state and a next step only. |
| starts with `_` or `.` (regex `ignoredFolder`) | ignored | `_dashboard/` belongs to the opencode connector (session links, autopilot state). |
| anything else | `other` | Listed by name only. |

`.work/dashboard.html` is written by the static dashboard. Nothing reads it for pipeline state.

To find an item by id, list `.work/` and match the one folder that starts with `<id>-`.

## Files in an item folder

| File | Written by | What is read from it |
| --- | --- | --- |
| `workitem.md` | `/start` (from `Get-WorkItem.ps1` or pasted) | Title line, `Type`, `State`, `Link`, `ADO`, `Fetched` |
| `repos.md` | `/start` | `Lane`, the repo table |
| `spec.md` | `/spec` | `Status:` gate |
| `plan.md` | `/plan` | `Status:` gate |
| `bug.md` | `/bug` | `Status:` gate |
| `tasks.md` | `/tasks`, `/bug`, `/review` fixes | Task headings with checkboxes, `Repo:` per task |
| `review.md` | `/review` | `Verdict:` |
| `pr.md` | `/pr` | One section per repo: `Branch`, `Title`, `Description` |
| `paused.md` | `/pause`, `/resume` | `Status:` (`PAUSED` or `RESUMED`), `Paused`, `Reason`, `In progress`, sections |
| `progress.md` | every command (append only) | Entries: heading, `Did`, `Verify`, `Notes`, `Next` |
| `findings.md` | `/spike` (spike folders) | Title, sections |
| `tsd.md`, `check.md` | `/tsd`, `/check-docs` (tsd folders) | Title, `Status:`, wrong or outdated rows |

Files are UTF-8 Markdown with LF or CRLF line ends. A file that does not exist means "not reached yet", which is different from a file without the expected line.

## Lines

### Labeled fields

`- Label: value` or `Label: value` at the start of a line, case-insensitive, first match wins (regex `field`, with `{label}` replaced by the escaped label).

A value is cleaned before use: trimmed, one pair of surrounding backticks removed (regex `backticked`), and treated as empty if it is a template placeholder like `<state>` (regex `placeholder`).

| File | Labels |
| --- | --- |
| `workitem.md` | `Type`, `State`, `Link`, `ADO`, `Fetched` |
| `repos.md` | `Lane` (`feature`, `bug` or `spike`; lower-cased) |
| `paused.md` | `Paused`, `Reason`, `In progress` |

`ADO` is written by `Get-WorkItem.ps1` as `<connection> (<collection>/<project>)` (regex `adoLine`). The project part is optional.

### Title

From `workitem.md`: `# Work item <id>: <title>` (regex `title`). If missing, from `progress.md`: `# Progress: <id> <title>` (regex `progressTitle`). If both are missing, the folder slug with `-` replaced by spaces.

### Gates (`Status:` lines)

`spec.md`, `plan.md`, `bug.md` and `tsd.md` each have one `Status:` line (regex `gate`). The value is upper-cased.

| Value | Meaning |
| --- | --- |
| file missing | `null`: not written yet |
| `DRAFT` | Written, waiting for the engineer |
| `APPROVED` | Approved by the engineer (`/approve`, `/publish`, or by editing the line). Only those two commands, run by the engineer, set it. |
| `PUBLISHED` | `tsd.md` only, see Known quirks |
| no matching line | `UNKNOWN` |

`paused.md` uses a looser match (regex `pausedStatus`): `PAUSED` means the item is on hold; `RESUMED` means it is not.

### Sections

`## <Heading>` up to the next `## ` heading or the end of the file, with HTML comments removed (regexes `section`, `comment`). A section that is empty or only a placeholder counts as missing. Used for `paused.md` (`Work in progress`, `Waiting on`) and `findings.md` (`Short answer`, `Recommendation`, `Next step`).

### Repo table (`repos.md`)

Every Markdown table row (regex `repoRow`) with at least 3 cells, skipping the header row (first cell `Order`) and the separator row. Cells are trimmed and backticks removed. Columns: `Order`, `Repo folder`, `Branch`, `Shared?` (`yes` if it starts with `y`), `Why it is involved`. Rows whose folder is empty or a placeholder are skipped.

### Tasks (`tasks.md`)

One heading per task: `## [ ] Task <n>: <title>` or `## [x] Task <n>: <title>` (regex `task`; `x` or `X` means done). A heading whose title is a placeholder is skipped. The first `- Repo: <folder>` line after a heading is that task's repo (regex `taskRepo`).

### Review verdict (`review.md`)

`Verdict: <value>` (regex `verdict`), upper-cased: `READY` or `CHANGES NEEDED`. A `review.md` without the line reads `UNKNOWN`. Any value containing `CHANGES` means changes are needed.

### Progress entries (`progress.md`)

Each entry starts with `## <yyyy-mm-dd[ hh:mm]> | /<command> | <agent>` (regex `progressEntry`; the agent part is optional). Inside an entry, `- Did:`, `- Verify:`, `- Notes:` and `- Next:` lines are read (regex `progressField`). If there is no `Did:` line, the first bullet (regex `progressBullet`) is used instead. `Notes: none` counts as no notes. Any other `## ` heading ends the entry.

**Blocked:** the item is blocked when the last entry's command contains `do-task` and either its `Verify` matches `blockedFail` or its `Did`, `Notes` or `Verify` text matches `blockedWord`.

### PR text (`pr.md`)

HTML comments are removed, then the file is split at `## ` headings (regex `prSplit`). Each section's heading is the repo folder. In each section: `Branch: <branch> -> <target>` (regex `prBranch`; `=>`, `to` and `→` also work), `**Title:** <title>` (regex `prTitle`), and everything after `**Description:**` (regex `prDescription`), with lines of only `---` removed.

### Notes folders

- `spike-*`: title from `# Spike findings: <topic>` in `findings.md` (regex `spikeTitle`). State is "Findings written" if `findings.md` exists, else "In progress".
- `tsd-*`: title from `# Technical spec: <name>` in `tsd.md` (regex `tsdTitle`). `check.md` rows with `| Wrong |` or `| Outdated |` are counted (regex `tsdCheckBad`).
- `docs-*`: "Fact-checked" if `check.md` exists, else "Written, not checked yet".

## Regexes

JavaScript syntax. `{label}` and `{heading}` are replaced with the escaped label or heading. The test reads this block, so keep one regex per line, as `name /pattern/flags`.

```regex
itemFolder     /^(\d+)-(.*)$/
notesFolder    /^(spike|docs|tsd)-(.+)$/
ignoredFolder  /^[_.]/
title          /^#\s+Work item\s+\d+\s*:\s*(.+?)\s*$/m
progressTitle  /^#\s+Progress:\s*\d+\s+(.+?)\s*$/m
field          /^\s*(?:-\s*)?{label}\s*:[ \t]*(.*?)\s*$/im
placeholder    /^<.*>$/
backticked     /^`([^`]*)`$/
adoLine        /^(\S+)\s*\(([^/)]+)(?:\/([^)]+))?\)/
gate           /^\s*Status:\s*([A-Za-z ]+?)\s*$/im
pausedStatus   /^\s*Status:\s*(\w+)/im
section        /^##\s+{heading}[^\r\n]*\r?$([\s\S]*?)(?=^##\s|(?![\s\S]))/m
comment        /<!--[\s\S]*?-->/g
repoRow        /^\s*\|(.+)\|\s*$/
task           /^##\s*\[([ xX])\]\s*Task\s+(\d+)\s*:\s*(.+?)\s*$/
taskRepo       /^\s*-\s*Repo:\s*(.+)$/
verdict        /^\s*Verdict:\s*(.+?)\s*$/im
progressEntry  /^##\s+(\d{4}-\d{2}-\d{2}[^|]*?)\s*\|\s*(\S+)\s*(?:\|\s*(.*?))?\s*$/
progressField  /^\s*-\s*(Did|Verify|Notes|Next)\s*:\s*(.*)$/
progressBullet /^\s*-\s+(.+)$/
blockedFail    /\bFAIL/i
blockedWord    /\bblocked\b/i
prSplit        /^##[ \t]+/m
prBranch       /^\s*(?:-\s*)?(?:\*\*)?Branch:(?:\*\*)?\s*`?([^`\s]+)`?\s*(?:->|=>|to|→)\s*`?([^`\s]+)`?/im
prTitle        /^\s*(?:\*\*)?Title:(?:\*\*)?[ \t]*(.+?)\s*$/im
prDescription  /^\s*(?:\*\*)?Description:(?:\*\*)?[ \t]*\n?([\s\S]*)$/im
spikeTitle     /^#\s+Spike findings:\s*(.+?)\s*$/m
tsdTitle       /^#\s+Technical spec:\s*(.+?)\s*$/m
tsdCheckBad    /\|\s*(Wrong|Outdated)\s*\|/gi
```

`repoRow`, `task`, `taskRepo`, `progressEntry`, `progressField` and `progressBullet` are applied line by line.

## Lane

`Lane` from `repos.md`, lower-cased. If missing, it is guessed from `Type` in `workitem.md`: `bug` if it contains "bug" (any case), else `feature`, and the item is marked `laneGuessed`.

## Next step

The first matching rule wins. This mirrors `commands/status.md` in eng-agents and `Get-NextStep` in `New-Dashboard.ps1`.

| # | Condition | Stage | Command | Needs the engineer |
| --- | --- | --- | --- | --- |
| 1 | No `repos.md` | `start` | `/start <id> <lane>` | no |
| 2 | Lane `feature`, no `spec.md` | `spec` | `/spec <id>` | no |
| 3 | `spec.md` is `DRAFT` | `spec` | `/approve <id>` (action: "Review spec.md") | yes |
| 4 | Lane `feature`, no `plan.md` | `plan` | `/plan <id>` | no |
| 5 | `plan.md` is `DRAFT` | `plan` | `/approve <id>` (action: "Review plan.md") | yes |
| 6 | Lane `bug`, no `bug.md` | `bug` | `/bug <id>` | no |
| 7 | `bug.md` is `DRAFT` | `bug` | `/approve <id>` (action: "Review bug.md and tasks.md") | yes |
| 8 | No tasks and no `tasks.md` | `tasks` (`bug` in the bug lane) | `/tasks <id>` | no |
| 9 | An unchecked task exists, and the item is blocked | `build` | `/do-task <id> <first unchecked n>` | yes |
| 10 | An unchecked task exists | `build` | `/do-task <id> <first unchecked n>` | no |
| 11 | No `review.md`, or `tasks.md` was modified after `review.md` | `review` | `/review <id>` | no |
| 12 | Verdict contains `CHANGES` | `review` | none (action: "Pick which review.md findings become fix tasks, then /do-task them") | yes |
| 13 | No `pr.md` | `pr` | `/pr <id>` | no |
| 14 | Otherwise | `ship` | none (action: "Push the branches and open the PRs (text is in pr.md)") | no |

A paused item (`paused.md` with `Status: PAUSED`) keeps its computed next step, but goes in the `paused` bucket and its resume command is `/resume <id>`.

Buckets: `paused` if paused, else `needs` if the next step needs the engineer, else `ship` if the stage is `ship`, else `active`. Notes folders and `other` folders are in `notes`.

Stages: `start`, `spec`, `plan`, `bug`, `tasks`, `build`, `review`, `pr`, `ship`.

## Step words

Shells show a step in plain words instead of the command. These are the only words; change them only here and in eng-agents together.

| Command | Words |
| --- | --- |
| `start` | Set up the repos and branches |
| `spec` | Write the spec |
| `plan` | Write the plan |
| `tasks` | Split the plan into tasks |
| `bug` | Analyze the bug |
| `review` | Review the changes |
| `pr` | Write the PR text |
| `resume` | Resume this item |
| `approve` | Approve |
| `do-task <id> <n>` | Task `<n>`: `<task title>` |

When a step has an action (rules 3, 5, 7, 9, 12, 14), the action text is shown instead of the words.

## Known quirks

These are current behavior. A port must reproduce them until a contract change says otherwise.

1. `/publish` writes `Status: PUBLISHED to <path> on <date>`. The `gate` regex allows only letters and spaces, so that line reads as `UNKNOWN`, not `PUBLISHED`. The static dashboard's TSD state treats `PUBLISHED` and `APPROVED` as published, so a published TSD shows as a draft there.
2. Rule 11 compares file modification times, so touching `tasks.md` without changing it asks for a new review.
3. `field` matches the first line with that label anywhere in the file, including inside a description that happens to start a line with `Type:`.

## Connector-owned files

The opencode connector owns `.work/_dashboard/` (`sessions.json`: which opencode session belongs to which item; `autopilot.json`). Their format is internal to the connector and not part of this contract. eng-agents commands never read or write them.

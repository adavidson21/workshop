# `.work` file format

Version: **`work: 1`**, matching eng-agents at commit `e2d202a` (core 2.1.0, Dashboard 1.6.1), with the quick lane (`quick.md`, Tandem Core 2.25.0) added.

eng-agents (Tandem) writes these files; the opencode connector and Dispatch read them. This document is the contract between the two repos. Any change to the wording below, in either repo, is a contract change ([README.md](README.md), Changing a contract).

The rules here describe what eng-agents' parser (`core/scripts/dashboard/New-Dashboard.ps1`) and its commands do today. Where the parser has a quirk, it is listed under Known quirks, not fixed. A JavaScript port (WS3, later) must produce the same results; the regexes below are written in JavaScript syntax for that port.

An example workspace is in [examples/work/](examples/work/). It is synthetic. `tests/contract/work-format.test.mjs` parses it with the regexes in this file and compares the result to [examples/work/expected.json](examples/work/expected.json).

## Folders

The work root is `.work/` in the workspace (the folder that holds the repos). Each direct subfolder is one item:

| Folder name | Kind | Notes |
| --- | --- | --- |
| `<id>-<name>` (regex `itemFolder`) | `item`: an ADO work item in the pipeline | `<id>` is digits. `<name>` is a short slug. |
| `spike-<name>`, `docs-<name>`, `tsd-<name>`, `scope-<name>`, `pr-<id>` (regex `notesFolder`) | `spike`, `docs`, `tsd`, `scope`, `pr` | Light treatment: title, state and a next step only. `pr` also carries the parsed review (`prReview`). |
| starts with `_` or `.` (regex `ignoredFolder`) | ignored | `_dashboard/` belongs to the opencode connector (session links, autopilot state, the PR review queue). |
| anything else | `other` | Listed by name only. |

`.work/dashboard.html` is written by the static dashboard. Nothing reads it for pipeline state.

To find an item by id, list `.work/` and match the one folder that starts with `<id>-`.

## Files in an item folder

| File | Written by | What is read from it |
| --- | --- | --- |
| `workitem.md` | `/start` (from `Get-WorkItem.ps1` or pasted); the `ADO item` line by the opencode connector (1.22.0) | Title line, `Type`, `State`, `Link`, `ADO`, `Fetched`; `ADO item` (`<n>`, `unlinked` or `unlinked (was <n>)`: whether the item is linked to ADO, eng-agents pipeline guide "Who links to ADO"); a story from an approved breakdown (Core 4.10.0, `/backlog <scope> local`): `Epic`, `Story`, `Depends on`, `Repos`, `Areas`, `Breakdown` (the item's `story`, only when `Epic` is there); a product's trial run: `Trial` (the item's `trial`) |
| `_onboarding/<product>.md` | Tandem's `Set-Onboarding.ps1` (`/onboard-product`, Core 4.10.0) | `Product`, `Scan` (`done <date> \| <repos>`), `Trial` (local id), `Live` (date): the model's `onboarding` list, only when there is one |
| `repos.md` | `/start` | `Lane`, the repo table |
| `brief.md` | `/start` (skipped with `--cold`) | Nothing is parsed: shown as Markdown for the person (Tandem Core 2.7.0 and later) |
| `spec.md` | `/spec` | `Status:` gate |
| `plan.md` | `/spec` (eng-agents Core 4.0.0), or `/plan` | `Status:` gate |
| `bug.md` | `/bug` | `Status:` gate |
| `quick.md` | `/quick` (quick lane, Tandem Core 2.25.0 and later) | `Status:` gate |
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
| `repos.md` | `Lane` (`feature`, `bug`, `quick` or `spike`; lower-cased) |
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

Every Markdown table row (regex `repoRow`) with at least 3 cells, skipping the header row (first cell `Order`) and the separator row. Cells are trimmed and backticks removed. Columns: `Order`, `Repo folder`, `Branch`, `Shared?` (`yes` if it starts with `y`), `Why it is involved`, `Base`, and since eng-agents Core 4.8.0 an optional `Path`: a git worktree, `.worktrees/<work folder>/<repo>`, where the work happens when the repo folder was busy. A Path that does not start with `.worktrees/` or contains `..` is ignored. When there is one, the opencode connector reads the repo's git state from it and emits `path` on the repo (left out otherwise, so older readers and the parity test see no change). Rows whose folder is empty or a placeholder are skipped.

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

- `spike-*`: title from `# Spike findings: <topic>` in `findings.md` (regex `spikeTitle`). An error log diagnosis (eng-agents Core 4.3.0, `/spike <folder> --log`) has `log.md` in the folder (`fromLog: true`) and a `Fix type:` line in `findings.md` (`fixType`: Configuration, Data, Infrastructure or Code); both keys are left out when missing. State is "Closed" if `findings.md` and `closed.md` exist (Loom writes `closed.md` when you pick a path at the findings: `Closed: <what next>` on its first line, which is the next text), "Findings written" if `findings.md` exists, else "In progress".
- `tsd-*`: title from `# Technical spec: <name>` in `tsd.md` (regex `tsdTitle`). `check.md` rows with `| Wrong |` or `| Outdated |` are counted (regex `tsdCheckBad`).
- `docs-*`: "Saved" if `saved.md` exists (Loom's Save to Folio) or `sources.md` has a `Status: SAVED ...` line (`/publish docs-<name>`, eng-agents Core 4.2.0); the rest of that line, or `saved.md`'s first line, is the next text. Otherwise "Fact-checked" if `check.md` exists, else "Written, not checked yet". `sources.md` names the doc on a `Doc: <path from the workspace>` line (Core 4.2.0), which the connector's `docs.doc` reads.
- `scope-*`: title from `Epic: <name>` in `epics.md`. State follows the `Status:` lines of `stories.md` and `milestones.md`, then `backlog.csv` or `published.md`.
- `pr-*`: a first-pass review of someone else's pull request (`/pr-review`). Title from `# Pull request <id>: <title>` in `context.md`; `Source commit:`, `Link:`, `Author:` and `- Repo: <name> (folder \`<folder>\`)` from the same file. `review.md` gives `Reviewed commit:`, `Recommendation:`, `Risk:`, the `## Summary` section, and one comment per `### C<n>` block under `## Comments` (`- File:`, `- Line:`, `- Severity:` (`blocking`, `should-fix` or `optional`), `- Why:`, and the comment as `>` quote lines). State is "Fetching" with no `context.md`, "Reviewing" with no `review.md`, "<recommendation>, <n> comments" once reviewed, and "Review is for an older commit" when `Reviewed commit:` is not the start of `Source commit:`.

## Regexes

JavaScript syntax. `{label}` and `{heading}` are replaced with the escaped label or heading. The test reads this block, so keep one regex per line, as `name /pattern/flags`.

```regex
itemFolder     /^(\d+)-(.*)$/
notesFolder    /^(spike|docs|tsd|scope|pr)-(.+)$/
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
| 3a | `spec.md` and `plan.md` are both `DRAFT` (one feature gate, eng-agents Core 4.0.0: `/spec` drafts spec, plan and tasks; checked before rule 3) | `plan` | `/approve <id>` (action: "Review spec.md, plan.md and tasks.md") | yes |
| 3 | `spec.md` is `DRAFT` | `spec` | `/approve <id>` (action: "Review spec.md") | yes |
| 4 | Lane `feature`, no `plan.md` | `plan` | `/plan <id>` | no |
| 5 | `plan.md` is `DRAFT` | `plan` | `/approve <id>` (action: "Review plan.md") | yes |
| 6 | Lane `bug`, no `bug.md` | `bug` | `/bug <id>` | no |
| 7 | `bug.md` is `DRAFT` | `bug` | `/approve <id>` (action: "Review bug.md and tasks.md") | yes |
| 8 | Lane `quick`, no `quick.md` | `quick` | `/quick <id>` | no |
| 9 | `quick.md` is `DRAFT` | `quick` | `/approve <id>` (action: "Review quick.md and tasks.md") | yes |
| 10 | No tasks and no `tasks.md` | `tasks` (`bug` in the bug lane) | `/tasks <id>` | no |
| 11 | An unchecked task exists, and the item is blocked | `build` | `/do-task <id> <first unchecked n>` | yes |
| 12 | An unchecked task exists | `build` | `/do-task <id> <first unchecked n>` | no |
| 13 | No `review.md`, or `tasks.md` was modified after `review.md` | `review` | `/review <id>` | no |
| 14 | Verdict contains `CHANGES` | `review` | none (action: "Pick which review.md findings become fix tasks, then /do-task them") | yes |
| 15 | No `pr.md` | `pr` | `/pr <id>` | no |
| 16 | Otherwise | `ship` | none (action: "Push the branches and open the PRs (text is in pr.md)") | no |

A paused item (`paused.md` with `Status: PAUSED`) keeps its computed next step, but goes in the `paused` bucket and its resume command is `/resume <id>`.

Buckets: `paused` if paused, else `needs` if the next step needs the engineer, else `ship` if the stage is `ship`, else `active`. Notes folders and `other` folders are in `notes`.

Stages: `start`, `spec`, `plan`, `bug`, `quick`, `tasks`, `build`, `review`, `pr`, `ship`.

In the quick lane, `/quick` writes both `quick.md` and `tasks.md`, so rule 10 never fires there. When `/quick` finds the work too big it sets `Lane: feature` in `repos.md` and the item follows the feature rules from then on.

## Step words

Shells show a step in plain words instead of the command. These are the only words; change them only here and in eng-agents together.

| Command | Words |
| --- | --- |
| `start` | Set up the repos and branches |
| `spec` | Write the spec |
| `plan` | Write the plan |
| `tasks` | Split the plan into tasks |
| `bug` | Analyze the bug |
| `quick` | Write the quick plan |
| `review` | Review the changes |
| `pr` | Write the PR text |
| `resume` | Resume this item |
| `approve` | Approve |
| `do-task <id> <n>` | Task `<n>`: `<task title>` |

When a step has an action (rules 3, 5, 7, 9, 11, 14, 16), the action text is shown instead of the words.

## Known quirks

These are current behavior. A port must reproduce them until a contract change says otherwise.

1. `/publish` writes `Status: PUBLISHED to <path> on <date>`. The `gate` regex allows only letters and spaces, so that line's gate value reads as `UNKNOWN`, not `PUBLISHED`. Since eng-agents dashboard 1.7.1 the TSD's state also checks for the word `PUBLISHED` on its Status line, so a published TSD shows as Published (before, it showed as a draft).
2. Rule 11 compares file modification times, so touching `tasks.md` without changing it asks for a new review.
3. `field` matches the first line with that label anywhere in the file, including inside a description that happens to start a line with `Type:`.

## Observations (`observations.md`)

Since eng-agents Core 4.8.0, `.work/observations.md` holds what agents noticed out of scope (core rule 5), written only by eng-agents' `Add-Observation.ps1`, one line each and never edited:

```
- O<n> | <yyyy-mm-dd> | <kind> | <repo or -> | <source or -> | <text>
```

`kind` is `bug`, `debt`, `docs`, `tests` or `idea` (anything else reads as `idea`); `-` reads as none. Ids are never reused (`.work/.observation-ids`). Other lines are skipped. The opencode connector shows the open ones in Loom (Noticed); what you did with each is kept in `.work/_dashboard/observations.json`, never in this file.

## Knowledge gaps (`gaps.md`)

Since eng-agents Core 4.9.0, `.work/gaps.md` holds what agents needed to know and could not find (core rule 3), written only by eng-agents' `Add-Gap.ps1` (new lines) and `Close-Gap.ps1` (the last cell):

```
- G<n> | <yyyy-mm-dd> | <kind> | <product or -> | <source or -> | <question> | <assumed or -> | open
- G<n> | <yyyy-mm-dd> | <kind> | <product or -> | <source or -> | <question> | <assumed or -> | answered <yyyy-mm-dd>: <where it was written>
```

`kind` is `fact`, `term`, `repo` or `process` (anything else reads as `fact`). `assumed` is `-` when the agent had no safe assumption and stopped the step; `source` is then the work item id. Ids are never reused (`.work/.gap-ids`). The opencode connector shows open ones as Teach cards; answering runs `/teach`.

## Factory settings (`factory.json`) and UI checks (`ui/`)

Since connector 1.21.0, the opencode connector writes `.work/factory.json` (Settings, Factory) on every start: `{version: 1, taskFileCap, quickTasks, retries, autoFix, reviewRounds, uiChecks, worktrees}`. eng-agents commands read it (Core 4.9.0) and never write it.

An item folder's `ui/` holds UI check results, written only by eng-agents' `Test-Ui.ps1`: `results-<name>.json` (`before` from `/start`, `after` from `/review`: `{version: 1, name, at, url, verdict: pass|fail|skipped, reason, pages: [{path, width, file, status, error, consoleErrors, failedRequests, a11y, diff}], problems, changed}`), the screenshots in `<name>/` and changed-pixel images in `diff/`.

## Connector-owned files

The opencode connector owns `.work/_dashboard/` (`sessions.json`: which opencode session belongs to which item; `autopilot.json`; `pr-queue.json`: Review all and the nightly PR review; `observations.json`: what you did with each observation; `gaps.json`: answers sent to `/teach`; `published.json`: what Publish pushed). Their format is internal to the connector and not part of this contract. eng-agents commands never read or write them.

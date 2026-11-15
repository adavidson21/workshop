# Tandem health

Version: **`version: 1`**, from Tandem (eng-agents) Core 2.26.0.

Loom's Health tab has a **Tandem** section that answers "is Tandem helping?". The opencode connector's read action `tandem.health` builds it on this computer from `.work`, Tandem's install record and the eval results. Nothing is stored and nothing leaves the machine.

This document is the contract between the two repos for the parts that come from `.work`. Any change to the wording below, in either repo, is a contract change ([README.md](README.md), Changing a contract).

## The action

`tandem.health` (read, no confirm). Arguments: `since` (optional, `YYYY-MM-DD`): only work items whose `/start` (else first `progress.md` entry) is on or after that day; review rounds written before it are left out of `findings`.

The answer:

| Field | What | Source |
| --- | --- | --- |
| `version` | `1` | |
| `pipeline` | Time to PR, gates, review rounds, rework, per item and summed up | `.work`, as eng-agents' `core/scripts/stats/Get-PipelineStats.ps1 -AsJson` (without `generated`) |
| `findings` | Every review finding with its category, and patterns that repeat | `.work`, as eng-agents' `core/scripts/stats/Get-ReviewFindings.ps1 -AsJson` |
| `evals` | The newest two eval result files, per case, or `null` | `<eng-agents clone>/evals/results/*.json` ([evals/README.md](https://github.com/adavidson21/eng-agents/blob/main/evals/README.md)) |
| `setup` | Installed Tandem version and commit, the workspace, repo guides | `~/.config/opencode/eng-agents/manifest.json` (written by `install.ps1`), the workspace folders |

## What `.work` gives (`pipeline` and `findings`)

The connector's `lib/tandem-health.mjs` and the two eng-agents scripts read the same files the same way. An example is [examples/work/](examples/work/) with [examples/work/expected-health.json](examples/work/expected-health.json): every file given the same modification time, both must give exactly that. `connectors/opencode/test/tandem-health.test.mjs` checks the connector and eng-agents' `Test-HealthFormat.ps1` checks the scripts.

### Work items

Folders named `<id>-<name>` where `<id>` is digits or `L` and digits (regex `/^(\d+|L\d+)-(.+)$/`). Everything else (scope, spike, triage, `_dashboard` and so on) is skipped.

| Item field | From |
| --- | --- |
| `lane` | `Lane:` in `repos.md`, lower-cased; without one, `bug` if `Type:` in `workitem.md` contains "bug", else `feature` (as [work-format.md](work-format.md), Lane) |
| `repos` | Rows of `repos.md` that start with `\| <number> \|`, or `null` without `repos.md` |
| `started` | The day of the first `/start` entry in `progress.md`, else the first entry |
| `prDrafted`, `daysToPr` | The first `/pr` entry, and whole days from `started` |
| `phases` | The day each of `start`, `spec`, `bug`, `quick`, `plan`, `tasks`, `do-task`, `review`, `pr` first ran |
| `rounds` | How many entries `spec`, `plan`, `bug`, `quick` and `review` each have |
| `gates` | One per `/approve` entry: `file` and `result` from its Stats line (`gate=`, `file=`, lower-cased, `.md` dropped), `unknown` when missing |
| `questions`, `assumptions` | Sums of the Stats values, or `null` when no entry has one |
| `doTaskRuns`, `verifyFails`, `fullSuiteFails` | `/do-task` entries; a failure is `Verify: ... -> FAIL` or `verify=FAIL`; `full=FAIL` (any case) |
| `tasksTotal`, `tasksDone`, `tasksAdded` | Task headings in `tasks.md`; added is total minus the last `tasks=` Stats value of a `/tasks`, `/bug` or `/quick` entry (`null` without one) |
| `quickEscalated` | A `/quick` entry with `escalated=1` |
| `retro` | `retro.md` exists |
| `verdict`, `findings`, `categories` | `review.md`: `Verdict:`, and the rows of its findings table by severity and category |

`progress.md` entries are headings `## <yyyy-mm-dd>[ <time>] | /<command> | <agent>` (regex `/^##\s+(\d{4}-\d{2}-\d{2})[^|]*\|\s*`?\/?([A-Za-z][\w-]*)/`). The Stats line is `- Stats: key=value key=value` (keys lower-cased, values up to a space, comma or semicolon, backticks dropped).

### Summary and gates

Medians use the middle value (the mean of the two middle values for an even count) and round half away from zero to one decimal. Rates are whole percents, rounded half away from zero, and `null` when there is nothing to divide by.

| Field | What |
| --- | --- |
| `summary.medianDaysToPr` | Over items that reached `/pr` |
| `summary.medianReviewRounds`, `multiReviewRate` | Over items with a review; the rate of those with 2 or more |
| `summary.verifyFailRate` | Failed verifies over all `/do-task` runs |
| `gates.<file>.unchangedRate` | `unchanged` over `unchanged + edited` approvals of that gate file; `no-hash` and `unknown` count as `noHash` |

Gate files are listed in the order `spec`, `plan`, `bug`, `stories`, `milestones`, `refine`, `quick`, `unknown`, only when they have approvals.

### Findings

From `review.md` and every `history/review-*.md` (earlier rounds) in each work item folder. A finding is a table row whose first cell is a number and whose second is `Blocker`, `Should fix` or `Nit`. With 6 or more cells the third is the category; with 5 there is no category (`uncategorized`). The repo is the first folder of the location. A pattern is one repo and one category; it `repeats` when it shows up in 2 or more work items (rounds of one item count once).

## Showing it

Loom shows four parts: **Pipeline** (tiles, gates with a "rubber stamp?" mark at 80% as written over 5 or more approvals, recent items linking to their run), **Learning loop** (repeating patterns, findings by category, retro coverage), **Prompts** (latest eval run per case, change against the one before, drops marked) and **Setup**. Each says what to run when it has nothing to show.

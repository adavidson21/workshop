# Bench

Version: **Bench 2**. Results `version: 1` to `4`, from Tandem (eng-agents) Core 4.1.0 and opencode connector 1.14.0.

Bench is the test suite for Tandem's commands and agents. It answers "is Tandem helping?", "which commands fail or changed?", "what does each cost?" and "is this prompt change better or worse?". It reads Tandem's eval cases, results, prompt sizes and experiments from the eng-agents clone Tandem was installed from, and starts runs and improve-loop scripts in a terminal window you can see. Its only data of its own is its `settings` collection: the test, judge and suggestion models and the run budget.

This document is the contract between the Bench app, the opencode connector and eng-agents' evals. Changing a field below, in any of the three, is a contract change ([README.md](README.md), Changing a contract).

## Where things are

| What | Where |
| --- | --- |
| The eng-agents clone | `source` in `~/.config/opencode/eng-agents/manifest.json` (written by eng-agents' `install.ps1`) |
| Cases | `<clone>/evals/cases/<name>.json` ([evals/README.md](https://github.com/adavidson21/eng-agents/blob/main/evals/README.md)) |
| Results | `<clone>/evals/results/*.json`, one file per `Invoke-Evals.ps1` run |
| The runner | `<clone>/evals/Invoke-Evals.ps1` |
| Prompt sizes and file hashes | `<clone>/evals/commands.json` (`Get-PromptSize.ps1 -Write`, checked in CI) |
| Agent guards | `<clone>/evals/guards/expected.json` (`Test-AgentGuards.ps1`, in CI, no model) |
| Writing rubrics | `<clone>/evals/rubrics/<name>.json` with `good.md` and `bad.md` |
| Experiments | `<clone>/evals/experiments/<id>/experiment.json` and `overlay/` (not committed) |
| Bench's settings | `<dataDir>/bench/settings.json`: schema `bench.settings`, one item `prefs` with `testModel`, `judgeModel`, `suggestModel` (each `provider/model` or empty) and `maxRuns` (1 to 500, default 30) |

## Bench's pages

| Page | What |
| --- | --- |
| **Overview** | The lift card (when a run had both arms), coverage (commands with cases, agents guarded), and one row per command: state in words (Failing, Prompt changed, Not run yet, No cases, Passing), cases, pass rate, every run passed, tokens per run, prompt size. What needs you comes first. A row opens the command: its cases, files and hash, Run its cases, Suggest trims. |
| **Improve** | What fails: failed checks across each failing case's latest run, grouped, with Suggest a fix per case (needs a suggestion model). Experiments: before and after (pass rate, tokens), with Test it, Keep and Drop. |
| **History** | Every results file; tick two to compare (as Bench 1). |
| **Run** | Run kinds: Affected (cases whose prompts changed, worked out the same way as `-Affected`), Release, Lift, Pick cases; runs, models (several = the model matrix), the judge, auto-approve; Run in a terminal or Copy command; Models compared; Settings. |

A case's "prompt changed" state: its current files hash (sha256 of its commands' hashes from `commands.json`, joined by commas, first 12 hex) differs from the `filesHash` of its latest tandem results. Bench and `Get-CaseFilesHash` work it out the same way.

## Arms and the lift

- **tandem**: the case's Tandem command, or its `steps` (several commands in one workspace, gates approved by the runner between them, like autopilot).
- **baseline**: the case's `baseline.prompt` as one plain prompt, with opencode started on a config folder made for the run: your `opencode.json` without `instructions`, `agent`, `command` and `mode`. Same model, providers and permissions; none of Tandem's rules, memory, agents or commands; no `.work` files.
- Both arms get the same workspace, repo map and repo guide, so the **lift** (Tandem's pass rate minus the baseline's, in points) measures Tandem's phases, not its knowledge files.
- A case takes part in the baseline arm only if it has a `baseline.prompt`. Lift cases are graded on the outcome only (files, tests, scope), never on Tandem's own files.

## Results file

Version 4 (Core 4.1.0) adds top-level `models`, `kind` (`custom`, `affected`, `release`, `lift`, `experiment`), `label`, `overlay`, `judge` and `compareTo`, and per case entry `model` and `filesHash` (tandem arm only). Lift rows are per case and model. An experiment's file (`overlay` set) is never the latest result of a case and never what later runs compare against.

Core 4.16.0 adds, within version 4, `answered` per run, and `answered` and `stillAsking` per step that has scripted answers (case field `answers`; eng-agents evals/README.md, Commands that ask). Bench shows an **answers N** tag on such cases and the answers sent on each step.

Version 3 (Core 3.2.0) adds usage to version 2, read from `opencode run --format json`: per case `usageKnown`, `meanTokens`, `meanCost`, `tokensPerPass`, `costPerPass`, `meanQuestions`, `meanToolCalls`, `meanVerifyFails` and `promptTokens`; per run `tokens`, `cost`, `toolCalls`, `questions`, `verifyFails`, `usageKnown`; per step `tokens` and `cost`. When `usageKnown` is false the connector passes the usage numbers on as `null`, never 0. Free models report a cost of 0: compare them on tokens.

Version 2 (Core 3.1.0), shown below without the version 3 fields. Version 1 files have no `arms`, no `arm` per case, no `passAll`, `meanSeconds` or `steps`; read them as the tandem arm, work out `passAll` as `passes == total` and `meanSeconds` from the runs.

```json
{
  "version": 2, "tandem": "3.1.0", "installed": "3.1.0", "model": "opencode/some-free-model",
  "runsPerCase": 3, "autoApprove": true, "arms": ["tandem", "baseline"], "date": "2026-11-15T10:00:00",
  "cases": [
    { "case": "feature-outcome", "arm": "tandem", "passes": 2, "total": 3, "rate": 67, "passAll": false, "meanSeconds": 410,
      "runs": [ { "run": 1, "pass": true, "seconds": 402, "timedOut": false,
                  "steps": [ { "step": "/spec L1 auto", "ok": true, "seconds": 61, "timedOut": false },
                             { "step": "approve spec.md", "ok": true, "seconds": 0, "timedOut": false } ],
                  "failed": [], "checks": 5, "log": "/tmp/eval-logs-1a2b/feature-outcome-tandem-1.log", "workspace": null } ] },
    { "case": "feature-outcome", "arm": "baseline", "passes": 0, "total": 3, "rate": 0, "passAll": false, "meanSeconds": 95, "runs": [] },
    { "case": "do-task", "arm": "tandem", "skipped": "needs dotnet", "runs": [] }
  ]
}
```

`rate` is a whole percent of runs that passed (pass@1 over the runs). `passAll` is true when every run passed (pass^k with k = `runsPerCase`). Never compare a rate with a best-of-N number.

## Connector actions

All on the opencode connector ([connectors/opencode/README.md](../connectors/opencode/README.md), Actions). Each needs Tandem's install record; without it they answer 409 with what to do.

| Action | Write | Args | Result |
| --- | --- | --- | --- |
| `evals.cases` | no | | `{source, cases: [{name, description, command, steps, lift, needs, answers}]}`, sorted by name. `lift` is true when the case has a baseline prompt. `answers` (connector 1.31.0) is how many scripted answers the case and its steps carry (eng-agents Core 4.16.0, a command that stops to ask). |
| `evals.results` | no | | `{source, results}`: every results file summed up, newest first by `date` (at most 200): `{file, version, date, tandem, model, runsPerCase, autoApprove, arms, cases: [{case, arm, passes, total, rate, passAll, meanSeconds, skipped, usageKnown, meanTokens, meanCost, tokensPerPass, costPerPass, meanQuestions, meanVerifyFails, promptTokens}], lift: [{case, tandem, baseline, lift, tandemAll, baselineAll}]}`. A file of another version is `{file, version, unsupported: true}`. |
| `evals.result` | no | `file` (a file name, no folders) | The same summary, with each case's `runs: [{run, pass, seconds, timedOut, tokens, cost, questions, verifyFails, answered, failed: [{check, detail}], steps: [{step, ok, seconds, timedOut, tokens, answered?, stillAsking?}], log}]` (`answered` and `stillAsking`, connector 1.31.0: answers sent to a command that asked, and whether it still ended asking). 404 for a missing file. |
| `evals.command` | no | as `evals.run` | `{command, folder}`: the line to paste into a terminal in `folder`. |
| `evals.run` | yes | `preset` (`custom`, `affected`, `release`, `lift`), `cases` (existing case names; needed for `custom`), `arm` (`tandem`, `baseline` or `both`), `runs` (1 to 10), `model` or `models` (up to 4, `provider/model`), `autoApprove`, `judge` (`provider/model`), `maxRuns` (1 to 500), `experiment` (an id under `evals/experiments/`) | Opens a terminal window (Windows: PowerShell; macOS: Terminal) in the clone running `Invoke-Evals.ps1` with those arguments, each checked first: a case must be an existing case file, `both` and `baseline` need a case with a baseline prompt, an experiment must exist. `release` ignores `cases` and `arm`; `lift` defaults to every case with a baseline prompt. `{ok, command}`. 501 on other systems (copy the command instead). |
| `evals.commands` | no | | `{source, commands: [{command, agent, tokens, readTokens, hash, files}], guards: {agents: [{agent, rows}]} or null}` from `commands.json` and `guards/expected.json`. Empty when the clone has none (older Tandem). |
| `evals.experiments` | no | | `{source, experiments: [{id, kind, command, file, reason, case, created, status, results}]}`, newest first. |
| `evals.script.command` | no | as `evals.script` | `{command, folder}` to copy. |
| `evals.script` | yes | `script`: `suggest` (`file`, `case`, `model`), `trim` (`command`) or `keep` (`id`, optional `drop`) | Opens a terminal running `Suggest-Fix.ps1`, `Suggest-Trim.ps1` or `Keep-Experiment.ps1` with checked arguments. Keep copies the experiment's file into the clone's `core/` (no git: you commit). |

The connector runs no model and no git. `evals.run` puts the command in a window in front of you, as if you had typed it, like Settings' Update button.

Loom's Health > Tandem keeps showing the tandem arm only ([tandem-health.md](tandem-health.md)) and links to Bench for the lift.

## Validate it on your own computer

Do this on a personal computer first, with made-up code only. Everything below uses eng-agents' own sample workspace; nothing touches your repos, ADO or company code. About 1 to 2 hours the first time, most of it waiting on runs.

### 1. Install what it needs (15 minutes)

1. PowerShell 7 (`pwsh`). macOS: `brew install --cask powershell`. Windows already has Windows PowerShell 5.1, which also works.
2. .NET 8 SDK (the sample workspace is a small .NET library). macOS: `brew install --cask dotnet-sdk`. Check with `dotnet --version` (8.x or later).
3. git, Node 20 or later, and opencode (`opencode --version`).
4. Workshop on this computer (README, Get started, Personal computer) with the opencode connector on.
5. eng-agents: clone it, then from its folder run `./install.ps1`. Check that `~/.config/opencode/eng-agents/manifest.json` exists and names that folder as `source`.

**Pass when:** `pwsh -v`, `dotnet --version`, `opencode --version` and `git --version` all print a version.

### 2. Pick one model and keep it (5 minutes)

1. Run `opencode models` and pick one free model. Write its `provider/model` name down.
2. Run `opencode run --model <provider/model> "Say hi"` from any folder.

**Pass when:** it answers. Use this same model for every run you compare. A different model is a different experiment.

### 3. Check the checkers, no model (5 minutes)

From your eng-agents folder:

```
pwsh -NoProfile -File evals/Test-Graders.ps1
pwsh -NoProfile -File evals/Test-Harness.ps1
pwsh -NoProfile -File evals/Test-Fixtures.ps1
```

**Pass when:** each ends with "all checks passed". These prove the graders tell good output from bad, the runner runs steps in order with Tandem left out of the baseline, and the sample code behaves as the cases assume. If one fails, stop: results from a broken checker mean nothing.

Also run, still with no model:

```
pwsh -NoProfile -File evals/Test-AgentGuards.ps1
pwsh -NoProfile -File evals/Test-Judge.ps1
pwsh -NoProfile -File evals/Get-PromptSize.ps1 -Check
```

**Pass when:** every agent's guard rows pass, the rubrics are well formed, and `commands.json` is up to date.

### 4. Open Bench and set it up (5 minutes)

1. Open Workshop, then **Bench** on the rail. (Settings, Apps if it is off.)
2. Overview shows coverage (about 17 of 36 commands with cases, 11 of 11 agents guarded) and every command as Not run yet or No cases.
3. Run, Settings: put your free model in **Test model**. Leave Judge and Suggestion empty for now, or put the same free model in both. Save.

**Pass when:** Overview lists every command and Run, Pick cases shows your eng-agents folder path under "From". If it says to turn on the opencode connector or install Tandem, do that and press Refresh.

### 5. One small run (10 to 20 minutes)

1. In Bench, Run, **Pick cases**: tick only `feature-outcome`. Arms **Both: show the lift**, Runs **1**, auto-approve on.
2. Press **Run in a terminal**, read the confirm (it should say 2 model runs), and confirm.
3. A terminal opens in your eng-agents folder and starts. Leave it running. On a system where no terminal opens, press **Copy command** and paste it into one.
4. When it finishes it prints two tables and `Results: ...json`.

**Pass when:**
- The terminal's line `Baseline arm: opencode config without Tandem in ...` is there.
- Its first table has a `tandem` row and a `baseline` row for `feature-outcome`, and the second table shows the lift.
- In Bench, press Refresh: Lift shows the same two rates and the same points as the terminal. Bench's notes warn that 1 run is too few.
- On version 3 results, Lift shows tokens per run for both arms and tokens per passing run under the bars.
- Open **See every run**: the Tandem run lists 6 or more steps (`/spec`, `approve spec.md`, `/plan`, `approve plan.md`, `/tasks`, `/do-task` per task); the plain prompt run lists one. Failed runs name the checks that failed.

### 6. Make sure the baseline really is plain (5 minutes)

1. On the result page, use **Copy log path** on the plain prompt run and open that file.
2. Its `=== opencode run ...` line has no `--command`.
3. Optional, stronger: run `./evals/Invoke-Evals.ps1 -Case feature-outcome -Arm baseline -Runs 1 -KeepWorkspaces -Model <provider/model> -AutoApprove`, open the kept workspace and check it has no `.work` folder.

**Pass when:** both hold. If the plain run used Tandem commands, the lift is meaningless: stop and report it.

### 7. The real run (1 to 2 hours, unattended)

1. Cases: `feature-outcome`, Both, Runs **3** (or 5 for a stronger answer), your model, auto-approve on. Run in a terminal and leave it.
2. When it finishes, Refresh Bench.

**Pass when:** Lift shows a verdict without the "too few runs" note, and History lists this run. Read it like this:
- **+20 points or more**, with "Every run passed" Yes for Tandem: strong evidence Tandem helps this model.
- **+1 to +19**: a small edge; run 5 per case before you claim it.
- **0 or below**: Tandem is not helping this model on this task. Open the failed Tandem runs: the step that failed is where to work.

### 8. Keep the baseline (2 minutes)

In your eng-agents folder, commit the results file the terminal printed (`evals/results/<version>-<time>.json`). Every later run is compared with the newest file in that folder, and History keeps them all.

### 9. The whole suite once (1 to 3 hours, unattended)

1. Run, **Release**, 3 runs. Confirm; it states the run count (about 70: 23 cases, 3 runs each). Raise Most runs per click in Settings if it refuses.
2. When it finishes, Refresh. Overview now has a state for every covered command.

**Pass when:** every covered command shows Passing, Failing or Prompt changed (none Not run yet), and History lists a `release` run. Commit its results file as your suite baseline.

### 10. A prompt change and Affected (15 minutes)

1. In eng-agents, change one line in `core/commands/tsd.md`, then `./evals/Get-PromptSize.ps1 -Write` and `./install.ps1`.
2. Refresh Bench: `/tsd` shows **Prompt changed**, and Run, Affected says 1 case.
3. Run Affected. Refresh when it finishes.

**Pass when:** only `tsd-draft` ran, and `/tsd` is no longer Prompt changed. Undo the line afterwards (and `-Write`, `./install.ps1` again).

### 11. The judge (20 minutes)

1. In eng-agents: `./evals/Test-Judge.ps1 -Model <your judge model>`.
2. If it passes, put that model in Bench's Settings as Judge model, then Run, Pick cases: `spike-findings`, `triage-words`, `tsd-draft`, with **Grade writing with the judge** on, 1 run.

**Pass when:** Test-Judge passes every good example and fails every bad one, and each writing case's run page lists the judge's yes and no answers. If Test-Judge fails, that model cannot tell good writing from bad: try another before trusting its grades.

### 12. Your first improve cycle (1 to 2 hours each)

1. Improve, What fails: pick the biggest group, and press **Suggest a fix** on one of its cases (needs a suggestion model).
2. When the terminal finishes, Refresh: an experiment appears with its reason. Press **Test it**. Refresh when that finishes.
3. Keep it only if it says **Better** or **Same passes, fewer tokens**; otherwise Drop.
4. For a heavy command (Overview's Prompt column), open it and press **Suggest trims**, test one or two, and keep a trim that does not drop.
5. After a Keep: review and commit the change in eng-agents, `./install.ps1`, then Run, Affected.

**Pass when:** you can show an experiment marked Better (or cheaper) that you kept, and the Affected run after it with no drops. That is a prompt improvement with proof.

## Keeping it working

- **Graders are tested.** Every case has a good and a bad golden output (`evals/goldens/`); CI fails if a grader stops telling them apart. A new case needs both before it is trusted.
- **The runner is tested.** `evals/Test-Harness.ps1` runs `Invoke-Evals.ps1` against a fake opencode in CI, including the baseline's config without Tandem.
- **The fixtures are tested.** `evals/Test-Fixtures.ps1` (CI, with dotnet) checks the sample code: the correct version passes the hidden tests, the planted bug fails them.
- **Guards are tested.** `evals/Test-AgentGuards.ps1` (CI, no model) checks every agent's permissions; a new agent without rows fails.
- **The judge is tested.** Every rubric has good and bad examples; `Test-Judge.ps1 -Model` must pass before a judge model's grades count.
- **Prompt sizes stay current.** CI fails when `evals/commands.json` is out of date, so Bench's Prompt changed state is always right.
- **The contract is tested.** `connectors/opencode/test/evals.test.mjs` reads versions 1 to 4, refuses bad run and script arguments; `apps/bench/test/` checks Bench's numbers (including that its files hash matches eng-agents') and pages.
- **Coverage is visible.** Overview's "commands with cases" number shows at once when a new command has no case.
- **Results are history.** Commit a results file after each release-worthy run. A model change gets its own baseline; never compare across models.
- **Add your own cases** the way evals/README.md, Adding a case, says, with made-up code only. For a lift case, grade the outcome only and give the plain prompt the same information the work item gives Tandem.

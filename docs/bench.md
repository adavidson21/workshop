# Bench

Version: results **`version: 1` to `3`**, from Tandem (eng-agents) Core 3.2.0 and opencode connector 1.13.0.

Bench answers "is Tandem helping?" and "is this prompt change better or worse?". It reads Tandem's eval cases and results from the eng-agents clone Tandem was installed from, and starts a run in a terminal window you can see. It stores nothing of its own.

This document is the contract between the Bench app, the opencode connector and eng-agents' evals. Changing a field below, in any of the three, is a contract change ([README.md](README.md), Changing a contract).

## Where things are

| What | Where |
| --- | --- |
| The eng-agents clone | `source` in `~/.config/opencode/eng-agents/manifest.json` (written by eng-agents' `install.ps1`) |
| Cases | `<clone>/evals/cases/<name>.json` ([evals/README.md](https://github.com/adavidson21/eng-agents/blob/main/evals/README.md)) |
| Results | `<clone>/evals/results/*.json`, one file per `Invoke-Evals.ps1` run |
| The runner | `<clone>/evals/Invoke-Evals.ps1` |

## Arms and the lift

- **tandem**: the case's Tandem command, or its `steps` (several commands in one workspace, gates approved by the runner between them, like autopilot).
- **baseline**: the case's `baseline.prompt` as one plain prompt, with opencode started on a config folder made for the run: your `opencode.json` without `instructions`, `agent`, `command` and `mode`. Same model, providers and permissions; none of Tandem's rules, memory, agents or commands; no `.work` files.
- Both arms get the same workspace, repo map and repo guide, so the **lift** (Tandem's pass rate minus the baseline's, in points) measures Tandem's phases, not its knowledge files.
- A case takes part in the baseline arm only if it has a `baseline.prompt`. Lift cases are graded on the outcome only (files, tests, scope), never on Tandem's own files.

## Results file

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
| `evals.cases` | no | | `{source, cases: [{name, description, command, steps, lift, needs}]}`, sorted by name. `lift` is true when the case has a baseline prompt. |
| `evals.results` | no | | `{source, results}`: every results file summed up, newest first by `date` (at most 200): `{file, version, date, tandem, model, runsPerCase, autoApprove, arms, cases: [{case, arm, passes, total, rate, passAll, meanSeconds, skipped, usageKnown, meanTokens, meanCost, tokensPerPass, costPerPass, meanQuestions, meanVerifyFails, promptTokens}], lift: [{case, tandem, baseline, lift, tandemAll, baselineAll}]}`. A file of another version is `{file, version, unsupported: true}`. |
| `evals.result` | no | `file` (a file name, no folders) | The same summary, with each case's `runs: [{run, pass, seconds, timedOut, tokens, cost, questions, verifyFails, failed: [{check, detail}], steps: [{step, ok, seconds, timedOut, tokens}], log}]`. 404 for a missing file. |
| `evals.command` | no | as `evals.run` | `{command, folder}`: the line to paste into a terminal in `folder`. |
| `evals.run` | yes | `cases` (existing case names), `arm` (`tandem`, `baseline` or `both`), `runs` (1 to 10), `model` (`provider/model`, optional), `autoApprove` | Opens a terminal window (Windows: PowerShell; macOS: Terminal) in the clone running `Invoke-Evals.ps1` with those arguments, each checked first: a case must be an existing case file, `both` and `baseline` need a case with a baseline prompt. `{ok, command}`. 501 on other systems (copy the command instead). |

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

### 4. Open Bench (2 minutes)

1. Open Workshop, then **Bench** on the rail. (Settings, Apps if it is off.)
2. Lift says "No lift yet". History says "No results yet" unless you have older runs. Cases lists Tandem's cases, with `feature-outcome` marked `lift`.

**Pass when:** Cases shows your eng-agents folder path under "From" and the cases. If it says to turn on the opencode connector or install Tandem, do that and press Refresh.

### 5. One small run (10 to 20 minutes)

1. In Bench, Cases: tick only `feature-outcome`. Arms **Both: show the lift**, Runs **1**, Model your model, auto-approve on.
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

### 9. Your first optimize cycle (1 to 2 hours each)

1. Open the failed Tandem runs in Bench and group them by the failed check or step.
2. Change one prompt in eng-agents (`core/commands/` or `core/agents/`) aimed at the biggest group. One change per cycle.
3. `./install.ps1`, then run the same cases, arms, runs and model again.
4. In History, tick the old run and the new one. Keep the change only if the Tandem arm went up and no Tandem case dropped (Bench calls drops out).
5. Every few cycles, also run the other cases (`-Arm tandem`, all cases) so a gain on one task did not break another.

**Pass when:** you can show a History compare where a prompt change moved the Tandem arm up with no drops. That compare is your proof.

## Keeping it working

- **Graders are tested.** Every case has a good and a bad golden output (`evals/goldens/`); CI fails if a grader stops telling them apart. A new case needs both before it is trusted.
- **The runner is tested.** `evals/Test-Harness.ps1` runs `Invoke-Evals.ps1` against a fake opencode in CI, including the baseline's config without Tandem.
- **The fixtures are tested.** `evals/Test-Fixtures.ps1` (CI, with dotnet) checks the sample code: the correct version passes the hidden tests, the planted bug fails them.
- **The contract is tested.** `connectors/opencode/test/evals.test.mjs` reads version 1 and 2 files and refuses bad run arguments; `apps/bench/test/` checks Bench's numbers and pages.
- **Results are history.** Commit a results file after each release-worthy run. A model change gets its own baseline; never compare across models.
- **Add your own cases** the way evals/README.md, Adding a case, says, with made-up code only. For a lift case, grade the outcome only and give the plain prompt the same information the work item gives Tandem.

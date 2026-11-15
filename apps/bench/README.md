# Bench

The test suite for Tandem's commands and agents. Bench shows, from your eng-agents folder: which commands pass, fail or changed since they last ran, what each costs, how much of Tandem has cases and guards, the lift over a plain prompt on the same model, the history of every run, and an improve loop that suggests prompt fixes and trims, tests them on a scratch copy of Tandem, and keeps the ones that help. Runs and scripts start in a terminal window you can see.

Results, cases and experiments live in your eng-agents folder (commit the results you keep as baselines). Bench keeps only its settings: test, judge and suggestion models and the run budget.

## Sections

| Section | What |
| --- | --- |
| Overview | The lift card, coverage, and every command with its state in words, cases, pass rate, every run passed, tokens and prompt size; what needs you first. A command opens its cases, files, Run its cases and Suggest trims. |
| Improve | Failed checks grouped across the latest failing runs, Suggest a fix per case, and experiments with before and after, Test it, Keep and Drop. |
| History | Every results file, newest first; tick two to compare. A file opens every run: steps, tokens, questions asked, failed checks and the log path. |
| Run | Run kinds (Affected, Release, Lift, Pick cases), runs, models (the model matrix), the writing judge, auto-approve; Models compared; Settings. |

## How it works

Everything goes through the opencode connector's `evals.*` actions ([docs/bench.md](../../docs/bench.md)). The connector finds your eng-agents clone from Tandem's install record, reads its cases and results, and for a run opens a terminal running `evals/Invoke-Evals.ps1` with checked arguments. Workshop itself runs no model and no git.

Without Workshop on this computer (browser mode), or with the opencode connector off, Bench says what to turn on.

## Tests

```
node --test "apps/bench/test/*.test.mjs"
```

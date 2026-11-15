# Bench

Is Tandem helping, and is a prompt change better or worse? Bench shows Tandem's eval results from your eng-agents folder: the lift over a plain prompt on the same model, the history of every run, a compare of any two, and each run's steps and failed checks. It can start a run in a terminal window you can see.

Bench stores nothing of its own. The results files live in `evals/results/` in your eng-agents folder; commit the ones you want to keep as baselines.

## Sections

| Section | What |
| --- | --- |
| Lift | The newest run with both arms: Tandem's pass rate minus the plain prompt's, in points, with a verdict in words, both bars, and a table per case (pass rate, every run passed, average time). Notes say when there are too few runs to trust it. |
| History | Every results file, newest first: Tandem version, model, arms, Tandem pass rate, lift. Tick two to compare them case by case; drops in the Tandem arm are called out. |
| Cases | Tandem's eval cases (`lift` marks those with a plain-prompt arm), and the run form: arms, runs per case, model, auto-approve. **Run in a terminal** opens a terminal in your eng-agents folder (Windows and macOS); **Copy command** gives the same line to paste anywhere. |
| A results file | From Lift or History: every case, arm and run, pass or fail in words, each step's time, failed checks and the log path. |

## How it works

Everything goes through the opencode connector's `evals.*` actions ([docs/bench.md](../../docs/bench.md)). The connector finds your eng-agents clone from Tandem's install record, reads its cases and results, and for a run opens a terminal running `evals/Invoke-Evals.ps1` with checked arguments. Workshop itself runs no model and no git.

Without Workshop on this computer (browser mode), or with the opencode connector off, Bench says what to turn on.

## Tests

```
node --test "apps/bench/test/*.test.mjs"
```

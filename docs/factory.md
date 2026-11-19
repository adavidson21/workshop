# The software factory

Since Workshop's opencode connector 1.21.0, Loom 6.2.0 and eng-agents (Tandem) Core 4.9.0. Plan and decisions: Workshop project doc `claude/software-factory-v1-plan.md`. Vision: `claude/workshop-vision-v2.md`.

You touch a work item twice:

1. **Approve the plan** (Loom's **Approve**). The build starts on its own.
2. **Publish the PR** (Loom's **Publish**, or **Publish all ready**). Workshop pushes every branch, never force, and opens the PR pages.

In between, autopilot runs the tasks, the review and its fix tasks, the UI checks and the PR text. It stops only for a lane step-up, a step that still fails after its retries and one fresh session, a knowledge gap with no safe assumption, or a merge conflict it cannot resolve.

## Settings, Factory

Saved in the opencode connector's config (`autopilot`, `factory`) and written to `.work/factory.json`, which Tandem reads.

| Setting | Default | Means |
| --- | --- | --- |
| Builds at once | 2 (up to 5) | More start queued. |
| Every project gets a turn | on | A free slot goes first to a project with nothing running, then by project order. |
| Files per task | 6 | Test files do not count. |
| Tasks in a Quick change | 3 | More steps up to a feature. |
| Tries before it stops | 3 | Then one fresh session, then it waits. |
| Review findings fixed on their own | Blockers and Should fix | Nits never become tasks. |
| Review rounds | 2 | Then a review that is still not ready waits for you. |
| UI checks with screenshots | on | Needs a `## UI checks` table in the repo guide and Playwright in the repo. |
| Regression tests | on | Needs a `## Regression tests` table in the repo guide. |
| Worktrees | every build | Every build in its own git worktree. |

## UI checks

Tandem's `Test-Ui.ps1` starts the app from the repo guide's `## UI checks` table (start command, URL, ready path, pages, UI file patterns, optional seed), opens each page at 1280 and 640 pixels in headless Chromium, and stops the app. `/start` takes **before** shots; `/review` takes **after** shots when the change touches UI files. Load errors, console errors, failed requests to the app and new accessibility problems (images with no alt text, unnamed buttons or links, unlabeled inputs) are Blockers that become fix tasks. Pages that changed are listed for you; Loom shows Before, After and What changed. An app that cannot start without real services, a missing Playwright or no table: skipped, never a stop.

## Regression tests

Since connector 1.26.0, Loom 6.8.0 and Tandem Core 4.14.0 (Workshop project doc `claude/test-suite-v1-plan.md`). The factory replaces manual regression testing and manual testing of new features.

- **New features:** every acceptance criterion a person can see or click gets an end-to-end test (Playwright, APIs mocked) titled with `[AC-n]`. The tests are committed to the repo and go out in the PR, so they become the team's suite. A task whose criteria are covered writes `Covered by tests` instead of a manual click-through.
- **Regression:** Tandem's `Test-Suite.ps1` runs the repo's whole suite from the repo guide's `## Regression tests` table (Command, Runner, Folder) at `/start` (before), `/review` (after, whatever the change touched) and `/pr` after a rebase. A test that passed before and fails now is a Blocker whose fix task fixes the code, not the test. A test that already failed before is only noted. A test that passes on its retry is flaky: a Nit that never blocks.
- **Publish:** shows passed, new tests and the criteria they cover, flaky and any failures. Publish all ready skips a build whose tests fail.
- **On the floor:** each card shows its suite once it has run: failing, flaky, or how many tests the build added.
- **Backfill:** **Add regression tests** in Loom (under the drop box) or Settings, Products (optional area) runs `/cover`, which adds the table where missing and makes one local Quick change per UI repo that tests what the pages do today, with no product code change. Its cards are marked **Tests**. Each builds hands-off; you publish its PR.

## Teach

When an agent needs a fact the knowledge base does not have, it logs a gap (`.work/gaps.md`) and keeps going on a safe assumption. Loom's **Teach** chip lists them. One answer runs `/teach`, which writes it to the product note, the team handbook or the repo guide (the knowledge base split rule) and closes the gap. A build that had no safe assumption waits on its gap and carries on when you answer.

After each build, `/pr` runs `Find-Repeats.ps1`: a review finding or a gap that comes back in 3 items becomes one suggestion in Folio's review list.

## Projects side by side

Every build has its own worktree, so two projects can build in the same repo. When a plan is approved and its tasks change files another active build also changes, Loom offers **Approve, build after it**: it waits until the other build's PR text is ready. Otherwise both build, and each catches up with main (rebase) before its review and its PR text; a conflict becomes a fix task.

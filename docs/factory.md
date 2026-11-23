# The software factory

Since Workshop's opencode connector 1.21.0, Loom 6.2.0 and eng-agents (Tandem) Core 4.9.0. Plan and decisions: Workshop project doc `claude/software-factory-v1-plan.md`. Vision: `claude/workshop-vision-v2.md`.

You touch a work item twice:

1. **Approve the plan** (Loom's **Approve**). The build starts on its own.
2. **Review and publish** (Loom's **Review the code**, then **Approve and publish**; or **Publish all ready**). Workshop pushes every branch, never force, and opens the PR pages. **Send back** instead turns your comments into fix tasks.

In between, autopilot runs the tasks (each checking its own pages), the review and its fix tasks, the UI checks and the PR text. It stops only for a lane step-up, a step that still fails after its retries and one fresh session, a knowledge gap with no safe assumption, or a merge conflict it cannot resolve. After Publish, Workshop follows each PR until it merges (see After Publish).

## When the model fails

Since connector 1.34.0. A build is meant to run for hours without you, so a model hiccup does not end it:

- **A model or connection error** (the model server restarted, a VPN blip, a 500): autopilot runs the same step again in a fresh session, 1 minute and then 5 minutes later. Loom's card says so with the time of the next try. After the third failure it waits for you: check the model server (`workshop doctor`), then **Resume**.
- **A stalled step** (no word from opencode for the stall time, and no permission prompt or question waiting on you): the step is stopped and handled like a model error.
- **Workshop restarts** (an update, a reboot, `workshop restart`) mid-build: the build carries on once opencode is connected, from the step it was on. A step still running in opencode's own service is waited for, not started twice.
- **Long steps** (over 5 minutes, usual on a local model) no longer stop the build with "fetch failed".
- **Resume** after a failed **Approve** approves the plan again, then builds.
- `workshop doctor` asks each local model server for its model list: a server that does not answer fails doctor, and a model it does not have is a warning.

## Settings, Factory

Saved in the opencode connector's config (`autopilot`, `factory`) and written to `.work/factory.json`, which Tandem reads.

| Setting | Default | Means |
| --- | --- | --- |
| Builds at once | 2 (up to 5) | More start queued. Always 1 while Local model is on ([local-models.md](local-models.md)). |
| Stalled after (minutes) | 30 (5 to 240) | A step with no word from the model this long is stopped and tried again. A step waiting on your answer never stalls. See When the model fails below. |
| Every project gets a turn | on | A free slot goes first to a project with nothing running, then by project order. |
| Files per task | 6 | Test files do not count. |
| Tasks in a Quick change | 3 | More steps up to a feature. |
| Tries before it stops | 3 | Then one fresh session, then it waits. |
| Review findings fixed on their own | Blockers and Should fix | Nits never become tasks. |
| Review rounds | 2 | Then a review that is still not ready waits for you. |
| UI checks with screenshots | on | Needs a `## UI checks` table in the repo guide and Playwright in the repo. |
| UI check in every task | on | Each task that changes UI files opens its pages before it commits. Same table. |
| The model can see images | off | Also hands the per-task screenshot to the model. It reads the page as text either way. |
| When you publish | Open a PR | **Merge, no PR**: for your own repos on a personal computer (see Merge without a PR). |
| Merge only these repos | blank (every repo) | With Merge, no PR: the repo folders that merge. A build touching any other repo opens PRs. |
| Regression tests | on | Needs a `### UI check in every task

Since connector 1.28.0, Loom 6.9.0 and Tandem Core 4.15.0 (Workshop project doc `claude/build-self-check-v1-plan.md`). A task that changes UI files starts the app once for the build (`Start-UiApp.ps1`, the record in `.work/<item>/ui/app.json`) and runs `Test-Ui.ps1 -Quick` before it commits: one width (1280), the pages its files touch, and each page's accessibility tree as text. The task confirms what it promised is on the page and fixes a load error, console error or new accessibility problem in the same task, so the review round finds fewer. The model sees the screenshot too only with **The model can see images** on. The app stops before the review's full check (`Stop-UiApp.ps1`).

### Try it

While a build runs or waits at Publish, Loom's **Try it** opens the build's app in a new tab: the connector asks opencode to run `Start-UiApp.ps1` (opencode's shell, so Workshop's agent still starts no program) and opens the address once it answers. **Stop** stops it. An app nothing has used for 30 minutes stops on its own.

## Code review at Publish

Since connector 1.28.0, Loom 6.9.0 and Tandem Core 4.15.0 (Workshop project doc `claude/publish-review-v1-plan.md`). **Review the code** on a ready build opens the code review screen: every repo's diff in reading order (each task's files in task order, tests after the code they test, generated and lock files folded), each file marked with the task that changed it, and Tandem's own review findings at their lines (fixed or open). Comment on a line, a file or the whole change.

- **Approve and publish** publishes, the same as Publish.
- **Send back** starts autopilot with `/revise <id> auto`: each comment becomes a fix task (`- From comment:`), a comment marked **Make it a rule** goes to the repo guide's `## Remembered`, and the build goes through the usual fix round, review, UI check and PR text before it comes back to Publish as the next revision. A comment Tandem cannot act on without you (`revise.md`, `- Status: HOLD`) waits on Loom with its question.
- **Publish all ready** skips a build with draft comments.

## After Publish

Since connector 1.28.0, ADO connector 1.16.0, GitHub connector 1.4.0, Loom 6.9.0 and Tandem Core 4.15.0 (Workshop project doc `claude/after-publish-v1-plan.md`). Every 5 minutes Workshop's agent asks the opencode connector which published PRs to watch, asks the ADO or GitHub connector where each stands (`pr.status`: CI and its checks, reviews, comments, conflicts, merged or abandoned) and hands the answer back. The card moves to **In transit** on the floor with what its PR waits on.

- **CI fails** and the same check passes on the target branch: Workshop saves the failed checks and the end of their logs (`ci/failure-<n>.md`) and runs `/pr-fix <id> ci auto`. Tandem commits a fix on the branch; Loom shows **Push fix** and you push it (never force). At most 2 rounds per PR. A check that fails on the target branch too is marked **Not caused by this change**.
- **Conflicts with its base:** `/pr-fix <id> conflict auto` merges the base into the branch (never a rebase: the branch is published). Push fix the same way.
- **Teammates' comments:** counted on the card and shown in the code review screen beside the code, where you can send any back to Tandem.
- **Merged:** the card leaves the line for **Delivered today**. Workshop removes the build's worktrees (the work folder stays) and runs `/retro <id> auto`. A linked ADO item offers **Resolve in ADO**. Notifications: a fix ready to push and a merge, when Workshop is out of sight.
- **Abandoned:** the build is back at Publish.

## Merge without a PR

Since connector 1.29.0 and Loom 6.10.0, for your own repos on a personal computer: Settings, Factory, **When you publish**: **Merge, no PR**. Publish then reads **Merge into main** (the target in `pr.md`), and the code review's button **Approve and merge**.

- Workshop merges each branch into its target without checking anything out (`git merge-tree`, git 2.38 or later), as one merge commit per repo (undo a whole build with `git revert -m 1`), and pushes the target, never forced. If the target moved meanwhile, it merges again once. The branch itself is not pushed.
- Every repo is merged before any is pushed: a conflict in one pushes nothing. Workshop writes `ci/conflict-<n>.md` and runs `/pr-fix <id> conflict auto` (Tandem merges the target into the branch, as after Publish); the Publish block says when it is done, and you publish again.
- A merge is the end: the card goes to **Delivered today**, the worktrees are removed and `/retro <id> auto` runs. There is no PR to follow, so nothing is watched.
- There is no team review and no CI before the merge: the factory's own review, UI checks and regression tests have run. Leave it on Open a PR for anything a team shares. A repo needs an `origin` remote.

## Regression tests` table in the repo guide. |
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

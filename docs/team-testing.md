# Team testing: prerequisites

Before anyone on a team tests Workshop with real work data (work items, repos, review notes), every item below must be done. The point is that work data never leaves the tester's computer, and the code that can read it changes only when the tester chooses to update. If an item is not done, test with sample data only.

## 1. Owner, once (before the first tester)

- [ ] **Release tags exist** in all three repos: `workshop`, `docket` and `eng-agents` (for example `v1.0.0`). Work mode installs and updates by tag, so testers never run untagged code. Tag only commits whose CI is green.
- [ ] **Accounts that can change the code are locked down:** two-factor authentication (a hardware key or authenticator app) on the GitHub and Cloudflare accounts, and branch protection on `main` in all three repos (changes only through pull requests).
- [ ] **The approved AI provider is known:** the opencode provider id your company allows (for example the id in its model names, `provider/model`). Testers enter it in step 2.
- [ ] **Nothing in the repos names real people or teams**, including examples, fixtures and placeholders.

## 2. Each tester, on their work computer

1. **Install in work mode, at the release tags.** Either way below gives the same result.
   - By hand (preferred, nothing is piped from a website): clone `workshop` and `docket` at the release tags side by side, run `scripts/install.ps1` (or `scripts/install.sh`), then `node workshop.mjs install --work-mode` and `node workshop.mjs pin`. Full steps: [README.md](../README.md), Work mode.
   - One-line installer: set `WORKSHOP_WORK_MODE=1`, `WORKSHOP_TAG`, `TANDEM_TAG` and `DOCKET_TAG` before running it. Without the tags it installs the newest code and says so: stop and set them.
2. **Open Workshop from your computer**, at the address `workshop start` or `workshop open` prints (`http://127.0.0.1:...`), not from the website. Settings should say "Work mode is on" and show the release tags.
3. **Set the approved AI provider.** In Settings, under the opencode connector, set **Approved AI providers** to the provider from step 1. Add `"enabled_providers": ["<that provider>"]` to your global opencode config (`~/.config/opencode/opencode.json`), so opencode cannot use any other provider, even one with a key in an environment variable.
4. **Keep the data folder on company storage**, for example a OneDrive folder your company manages (Settings, Data folder). It is your backup; Workshop never uploads it.
5. **ADO:** the personal access token has only the scopes you need (Work Items Read, plus Code Read for pull requests) and a short expiry, and lives in an environment variable, never in a file.
6. **Keep work data off personal devices.** Do not use the Docket Android app or the website for work tasks.
7. **Run `workshop doctor`** and continue only when it ends with `Result: all good.` It checks the pinned copy file by file and that opencode can use only the approved provider.

## 3. Updating during testing

- Update only to a release tag: `workshop update` lists them, `workshop update --tag <tag> --docket-tag <tag>` moves to them and rebuilds the pinned copy. Restart Workshop, then run `workshop doctor` again.
- Never run `workshop update --pull` on a work computer: that is the newest code, not a release.
- If doctor reports that a pinned file changed, stop using Workshop with work data and run `workshop pin` again from the release; tell the owner.

## Why these and not more

What work mode covers, and what it leaves to the items above, is in [security.md](security.md), Work mode. In short: work mode stops the website and anyone who can change it from reaching your data; the release tags and locked-down accounts make sure the installed release is the code that was reviewed; the provider check covers the one place work data is sent on purpose (the AI model that Dispatch's agents use).

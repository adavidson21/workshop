# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: open the repo's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and the version (`workshop version`, or the release tag).

You will get an answer within a week. Fixes are released as a new release tag, and the release notes say what was fixed once users have had a chance to update.

## Supported versions

The newest release tag, and `main`. Work mode users update with `workshop update --tag <tag>`.

## Scope

In scope: the agent (`agent/`), connectors (`connectors/`), the hub and apps served from this repo, the installers (`scripts/`) and the Cloudflare Worker (`worker/`). Docket, Receipts and Tandem have their own repos.

What Workshop stores, where it sends data and the checks behind each claim: [docs/security.md](docs/security.md). A short version for a company security review: [docs/for-security-teams.md](docs/for-security-teams.md).

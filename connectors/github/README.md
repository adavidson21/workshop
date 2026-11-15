# GitHub connector

Issues assigned to you and pull requests waiting on your review, for Docket and Loom. It answers in the same shapes as the [ADO connector](../ado/README.md), so apps treat both trackers alike. Read only: nothing here changes GitHub. Node standard library only. It calls only the API URL in its settings.

How ADO concepts map to GitHub, and what is planned next: the GitHub tracker plan in the project docs.

## Settings

`connectors.github.config` in `~/.workshop/config.json`, edited in Settings (the form comes from `configSchema` in `index.mjs`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `connections[]` | required | `name`, `apiUrl` (`https://api.github.com`, or `https://<server>/api/v3` for Enterprise Server), `tokenEnv` (`GITHUB_PAT`), `tokenExpires` (optional `YYYY-MM-DD`). |
| `defaultConnection` | first one | Used when nothing else decides. |
| `repos` | `[]` | `owner/repo` list. Only these count for your issues and reviews. Empty means every repo you can see. |
| `types` | `Issue, Bug, Story` | Issue types to sync. A type comes from a label: `epic`, `feature`, `story` (or `user story`), `bug`, `task`. An issue with none of them is an `Issue`. |
| `areaLabelPrefix` | `area:` | A label like `area: billing` puts an issue in the area `owner/repo/billing`. With no area label, the repo is the area. |
| `prs` | `true` | Sync pull requests waiting on your review. |
| `prTeams` | `[]` | `org/team` slugs (or team names) that count as yours. Empty means every team you are on. |
| `prNotNeeded` | `{teamOnly: true, canMerge: true, approvals: 2}` | PRs left out (a known one comes back gone with reason `notneeded`). Never for blocking PRs. `teamOnly`: only your team was asked. `canMerge`: GitHub's review decision is Approved. `approvals`: at least this many others approved (0 off). |

### The token

1. On GitHub: Settings, Developer settings, **Fine-grained tokens**, Generate. Pick the repos (or all repos), and give it **Issues: Read** and **Pull requests: Read**. For team reviews, also **Members: Read** under the organization's permissions. A classic token with `repo` and `read:org` also works.
2. Run `workshop pat GITHUB_PAT` and paste it. It is not shown and does not land in shell history.
3. In Settings, add the connection (or paste any GitHub link into **Paste any link from GitHub**), then try the Test field with an issue such as `owner/repo#12`.

The token lives only in that environment variable. The connector reads it through `ctx.env`, sends it only in the `Authorization` header, and never logs, returns or emits it.

Status says when the variable is not set (`error`), when GitHub answered 401 to it (the message stays until the variable holds a different value or a call succeeds), and when it expires within 14 days. The expiry date comes from **Token expires** or, when GitHub sends it, the `github-authentication-token-expiration` header, so most people never type it. `status().details` carries `tokensMissing`, `tokensExpiring` and `tokensRejected`, never a value.

## Actions

| Action | Args | Result |
| --- | --- | --- |
| `sync` | `known` (issue ids on the board), `knownPrs` (PR keys), `prs` (default `true`) | `{items, gone, syncedAt, prs?, prError?}`, the ADO connector's `sync` shape. An item: `{id: "owner/repo#12", number, title, type, state ("Open" or "Closed"), project (owner/repo), assignedTo, priority (1 to 4 from a `P1` or `priority: 1` label, else null), due (the milestone's due date), changed, url, labels}`. A gone item has `reason`: `closed`, `removed` (closed as not planned or duplicate), `reassigned` (with `assignedTo`), `filtered` (now another type, or outside `repos`) or `missing`. |
| `sync.prs` | `knownPrs` | `{items, gone, notes, notNeeded}`, the ADO connector's shape. Keys are `<web url>|owner/repo|<number>`. |
| `areas.mine` | optional `connection` | `{connection, areas: [{path, count}]}`: the areas of your open issues, most first, up to 50. |
| `workitem.get` | `id` (`owner/repo#12`, or a number with `repo`; with one repo in `repos`, a bare number is enough), `details`, `extras`, `comments`, `connection` | `{id, number, title, type, state, rev (updated_at), project, connection, url, reason}`. `details` adds `area`, `iteration` (milestone title), `tags` (labels), `description`, `acceptanceCriteria` and `reproSteps` (from `## Acceptance criteria` and `## Repro steps` sections of the body, or `### `), `related` (empty), `parent` (the sub-issue parent, `{id, title, url, state, type}`, or null), `children` (`{total, done}`) and `milestone`. `comments` adds `comments` (oldest first, at most 200). |
| `connection.resolve` | `connection` | Which connection would be used and whether its token is set. Calls nothing. Setup action. |
| `config.fromUrl` | `url`: any GitHub link | `{config, notes}`: the settings with that host's connection added and the repo added to `repos` when `repos` is not empty. Saves nothing. Setup action. |

### Pull request tiers

GitHub has no per-person required reviewer and no "Waiting for author" vote, so:

| Tier | When |
| --- | --- |
| `blocking` | You were asked by name, you are the only reviewer still asked, and the PR needs a review to merge (`reviewDecision: REVIEW_REQUIRED`). `lastBlocker` when someone else already approved. |
| `asked` | You were asked by name. |
| `pool` | Only one of your teams was asked. |

GitHub drops your review request once you review. Your latest review then decides: **Changes requested** keeps a known PR on you as `waiting` (like ADO's Waiting for author); **Approved** or **Commented** makes it `reviewed`. A team PR a teammate reviewed is `covered`.

### Calls it makes

| Call | For |
| --- | --- |
| `GET /user` | Who you are |
| `GET /issues?filter=assigned&state=open` | Your open issues, every repo |
| `GET /repos/{owner}/{repo}/issues/{n}` | A known issue that dropped off; `workitem.get` |
| `GET /repos/{owner}/{repo}/issues/{n}/comments` | `workitem.get` with `comments` |
| `GET /user/teams` | Your teams, for team reviews |
| GraphQL `search` (`review-requested:@me`, `reviewed-by:@me`) | PRs waiting on you |
| GraphQL `repository { pullRequest }` | Known PRs neither search found (one call, up to 50) |
| GraphQL `repository { issue { parent subIssuesSummary } }` | `workitem.get` with `details` |

## Tests

```
node --test "connectors/github/test/*.test.mjs"
```

`test/fake-github.mjs` is a fake GitHub API on 127.0.0.1 with synthetic data. `issues.test.mjs` covers the library; `connector.test.mjs` runs it through the mock and real agent, including that the token never shows up in responses, errors or logs.

# GitHub connector

Issues assigned to you and pull requests waiting on your review, for Tasks and Builds, and roadmaps for Roadmaps. It answers in the same shapes as the [ADO connector](../ado/README.md), so apps treat both trackers alike. Read only except `workitem.update` and `workitem.create`, which the agent runs only with `confirm: true` from a person's click (Builds' Publish, Delegate, Post questions, Close and Resolve). Node standard library only. It calls only the API URL in its settings.

How ADO concepts map to GitHub, and what is planned next: the GitHub tracker plan in the project docs.

## Settings

`connectors.github.config` in `~/.workshop/config.json`, edited in Settings (the form comes from `configSchema` in `index.mjs`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `connections[]` | required | `name`, `apiUrl` (`https://api.github.com`, or `https://<server>/api/v3` for Enterprise Server), `tokenEnv` (`GITHUB_PAT`), `tokenSecret` (optional: a secret in this computer's store, which wins over the variable), `tokenExpires` (optional `YYYY-MM-DD`). |
| `defaultConnection` | first one | Used when nothing else decides. |
| `repos` | `[]` | `owner/repo` list. Only these count for your issues and reviews. Empty means every repo you can see. |
| `types` | `Issue, Bug, Story` | Issue types to sync. A type comes from a label: `epic`, `feature`, `story` (or `user story`), `bug`, `task`. An issue with none of them is an `Issue`. |
| `areaLabelPrefix` | `area:` | A label like `area: billing` puts an issue in the area `owner/repo/billing`. With no area label, the repo is the area. |
| `prs` | `true` | Sync pull requests waiting on your review. |
| `prTeams` | `[]` | `org/team` slugs (or team names) that count as yours. Empty means every team you are on. |
| `prNotNeeded` | `{teamOnly: true, canMerge: true, approvals: 2}` | PRs left out (a known one comes back gone with reason `notneeded`). Never for blocking PRs. `teamOnly`: only your team was asked. `canMerge`: GitHub's review decision is Approved. `approvals`: at least this many others approved (0 off). |

### The token

1. On GitHub: Settings, Developer settings, **Fine-grained tokens**, Generate. Pick the repos (or all repos), and give it **Issues: Read** and **Pull requests: Read**. For team reviews, also **Members: Read** under the organization's permissions. A classic token with `repo` and `read:org` also works.
2. In Settings, GitHub, click **Add token** on the connection and paste it (Settings, Manager, Tokens & sign-ins lists them all). It goes into this computer's secret store and the connection's **Token** is filled in for you.
3. In Settings, add the connection (or paste any GitHub link into **Paste any link from GitHub**), then try the Test field with an issue such as `owner/repo#12`.

From a terminal instead: `workshop secret set github --expires <its expiry date>`, then put `github` in the connection's **Token**. Either way Tandem's GitHub scripts read GitHub through Workshop (`api.get`, `graphql.query` below), so no variable needs it. A `GITHUB_PAT` variable still works when **Token** is empty.

With a variable, the token lives only in that environment variable. The connector reads it through `ctx.env`, sends it only in the `Authorization` header, and never logs, returns or emits it.

Status says when the variable is not set (`error`), when GitHub answered 401 to it (the message stays until the variable holds a different value or a call succeeds), and when it expires within 14 days. The expiry date comes from **Token expires** or, when GitHub sends it, the `github-authentication-token-expiration` header, so most people never type it. `status().details` carries `tokensMissing`, `tokensExpiring` and `tokensRejected`, never a value.

## Actions

| Action | Args | Result |
| --- | --- | --- |
| `sync` | `known` (issue ids on the board), `knownPrs` (PR keys), `prs` (default `true`) | `{items, gone, syncedAt, prs?, prError?}`, the ADO connector's `sync` shape. An item: `{id: "owner/repo#12", number, title, type, state ("Open" or "Closed"), project (owner/repo), assignedTo, priority (1 to 4 from a `P1` or `priority: 1` label, else null), due (the milestone's due date), changed, url, labels}`. A gone item has `reason`: `closed`, `removed` (closed as not planned or duplicate), `reassigned` (with `assignedTo`), `filtered` (now another type, or outside `repos`) or `missing`. |
| `api.get` (agent) | `path`, `connection` | A GitHub REST GET, for Tandem's scripts: `/user`, or `/repos/<owner>/<repo>/issues/<n>` (and `/comments`), `/repos/<owner>/<repo>/pulls/<n>` (and `/comments`, `/reviews`, `/files`, `/commits`), with only `page` and `per_page` added. The parsed answer. Anything else is refused. |
| `graphql.query` (agent) | `query`, `variables`, `connection` | A GitHub GraphQL query, for Tandem's scripts. A mutation or subscription is refused. The `data`. |
| `sync.prs` | `knownPrs` | `{items, gone, notes, notNeeded}`, the ADO connector's shape. Keys are `<web url>|owner/repo|<number>`. |
| `areas.mine` | optional `connection` | `{connection, areas: [{path, count}]}`: the areas of your open issues, most first, up to 50. |
| `workitem.get` | `id` (`owner/repo#12`, or a number with `repo`; with one repo in `repos`, a bare number is enough), `details`, `extras`, `comments`, `connection` | `{id, number, title, type, state, rev (updated_at), project, connection, url, reason}`. `details` adds `area`, `iteration` (milestone title), `tags` (labels), `description`, `acceptanceCriteria` and `reproSteps` (from `## Acceptance criteria` and `## Repro steps` sections of the body, or `### `), `related` (empty), `parent` (the sub-issue parent, `{id, title, url, state, type}`, or null), `children` (`{total, done}`) and `milestone`. `comments` adds `comments` (oldest first, at most 200). |
| `roadmap` | `areas` (required: `owner/repo`, or `owner/repo/<area>` for an area label; backslashes work too), `includeClosed`, `stories`, `fields`, `connection` | The ADO connector's `roadmap` shape, for Roadmaps: `{connection, items, total, truncated, childrenTruncated, fetchedAt}`. Epics are milestones (`targetDate` is the due date), Features are issues labeled `feature` (`parentId` is their milestone; with no date of their own their `targetDate` is the milestone's; `storiesTotal` and `storiesDone` come from sub-issue progress), and with `stories` their open sub-issues come too as `User Story` or `Issue` (closed ones with `includeClosed`). Ids are GitHub's numeric database ids, so Roadmaps keys them like ADO's; `ref` is the readable name (`acme/web#12`, `acme/web milestone v2.1`). Each item's `custom` has the `fields` asked for, all set to the Feature's `## Release note` section. A whole repo brings every milestone; an area brings only the milestones its Features sit in. |
| `iterations.list` | `project`, `connection` | With a repo as `connection`, the repo's open milestones as sprints (the next one due is `current`); otherwise none. |
| `backlog` | `areas` (required: `owner/repo` or `owner/repo/<area>`, `github:` prefix allowed), optional `types`, `connection` | For Builds: open issues under the areas, newest change first, at most 500, in the ADO connector's backlog shape. `id` is the issue number and `connection` the repo; `parentId` is the sub-issue parent's number, or the milestone as a negative number (an Epic); `rev` is the last change time in milliseconds (used by `workitem.update`'s conflict check); `state` is `Open` or `Resolved` (a `resolved` label). |
| `workitem.find` | `id` (a number) | The number in every repo in **Repos**: `{id, matches: [{id, title, type, state, project, connection, url, area, rev}], failed}`. With no repos listed, a note in `failed`. |
| `workitem.prs` | `id`, `connection` (the repo), `children` (default true) | PRs that close the issue (GitHub's closing references) and, with `children`, its sub-issues, in the ADO connector's `workitem.prs` shape. Status per PR: `active`, `completed` (merged) or `abandoned` (closed). |
| `workitem.update` (write) | `id`, `rev`, `changes`, `connection` (the repo) | One PATCH, then a comment when asked. `changes`: `title`, `description` and `acceptance` (body sections; repro steps and release note kept), `state` (Closed, Done: closed as completed; Removed, Won't do: closed as not planned; Resolved: a `resolved` label on the open issue; anything else reopens), `assignedTo` (a GitHub login, `""` unassigns; an email is refused), `priority` (swaps the `P1` to `P4` label), `iteration` (the milestone by title; `""` clears), `area` (swaps the area label), `tagsAdd`, `tagsRemove`, `comment`, `related` (a comment listing them). `startDate` and `targetDate` are refused: issues have none. A negative id is an Epic (milestone): `title`, `description`, `targetDate` (its due date), `state`. With `rev` and a newer change on GitHub: `409 conflict`, nothing sent. |
| `workitem.create` (write) | `type`, `title`, `connection` (the repo) or `project`, `parent`, `fields: {description, acceptance, area, iteration, assignedTo, priority, tags, custom}` | An issue with its type label (`story`, `feature`, `bug`, `task`; none for Issue), area and priority labels, and a body of Description, `## Acceptance criteria` and (from a `custom` field whose name has "release" in it) `## Release note`. `type: Epic` makes a milestone instead (id is its number, negative). A positive `parent` adds the new issue as its sub-issue; a negative one (an Epic) sets the milestone. |
| `pr.status` | `remote` (the repo's git remote), `branch`, optional `logs` | Since 1.4.0, for Workshop's after-Publish watcher (Workshop project doc `claude/after-publish-v1-plan.md`): the open or last PR whose head branch is `branch`, in the ADO connector's `pr.status` shape. CI is the head commit's check runs and statuses; review is each person's latest review. With `logs` and failed CI: each failed check's output and annotations as its `log` (job logs live on another host, so they are not read), and `baseFailing` when the same check fails on the target branch. |
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
| `GET /repos/{owner}/{repo}/milestones`, `GET /repos/{owner}/{repo}/issues?labels=feature`, `GET /repos/{owner}/{repo}/issues/{n}/sub_issues` | `roadmap` |

## Tests

```
node --test "connectors/github/test/*.test.mjs"
```

`test/fake-github.mjs` is a fake GitHub API on 127.0.0.1 with synthetic data. `issues.test.mjs` covers the library; `connector.test.mjs` runs it through the mock and real agent, including that the token never shows up in responses, errors or logs.

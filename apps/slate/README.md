# Slate

Your team's Azure DevOps backlog, from an enhancement request to a decision: **delegate it**, or **build it yourself**. Tandem's agents (eng-agents Core 2.12.0 or later) do each step's legwork, and nothing moves until you click.

Four tabs: **Board** (the two lanes below), **Roadmaps** (Runway), **Sprints** and **Health**.

## The board's two lanes

**PM lane:** New, Triage, Waiting on requester, Define, Publish, Who builds it?, Delegated.

1. **New.** Open ADO items in your team's area paths (the ADO connector's `backlog` action, areas from People), plus requests you add with **New request** (with who asked) or send from a Runway item. An ADO item is stored in Slate only once you act on it.
2. **Triage** runs `/triage`: a summary, the products and repos it touches, questions for the requester, a size and a suggested route. It never posts.
3. **Waiting on requester.** **Copy questions and wait** puts the questions on the clipboard. Paste the answers back and **Save answers and triage again** writes `answers.md` next to `triage.md` and runs triage again.
4. **Define.** One story or bug: `/refine` writes `refine.md` (description and Gherkin acceptance criteria). Bigger: `/scope`, then `/slice`. Read the draft in the panel, **Edit** it, **Approve** it, or **Revise with my edits**.
5. **Publish to ADO** shows every create and update first, then sends them with one confirm. A refined story on an existing ADO item updates its description and acceptance criteria; anything else is created, parents first, tagged `slate`. If a run stops part way, the next one skips what was already made.
6. **Who builds it?** **Delegate**: pick someone from People. The owners of what the item touches (People, **Owns**, matched against triage's products and repos and the ADO area) come first, with what they own. Slate can run `/handoff` for a brief, assign the item in ADO (needs their ADO identity in People) and add a "waiting on" task to Docket. **Do it myself** moves the card to the Dev lane.

Every card shows how many days it has been in its column; past a limit (3 days in New, Triage or Who builds it?, 5 waiting on the requester, 7 in Define, 2 in Publish) it is marked **Stale** and shows on Home's Needs you.

**Dev lane:** Ready, Spec and plan, Build, Review and PR, Done. Only what you chose to build yourself, with its Tandem stage. **Start** runs Tandem on the ADO item; after that the panel offers the run's next step, or **Open in Dispatch**, where every run, prompt and review lives. When an agent asks you something, the card says **Waiting on you** and **Answer in Dispatch** opens it.

**Moving back.** To pause and revise, pick an earlier stage under the panel and **Move back**. The choices are the stages the item went through (New always). It keeps its triage, drafts and history, and stays put until you act: back in New, a finished triage does not move it on; back in Define, an approved draft offers **Revise with my edits** or **Keep it approved** instead of going to Publish. Delegated and the Dev lane go back to Who builds it?. Off while an agent is running on the item. Moving back changes nothing in ADO, Docket or Tandem; the confirm says what stays.

**When work closes.** When a delegated or own item leaves the open backlog, Slate reads it from ADO; closed means done. A delegated one offers Rapport a win about the person (an ordinary offer you accept there).

**Decision log.** Each decision (delegated, building it myself, defined and published) adds a note to Notes' inbox with a link back to the item. Nothing is posted anywhere.

## Fields

Cards and the panel show what ADO has for each item. **Fields** (top bar) picks which.

- **Cards** (from the backlog read): Assigned to, Iteration, Area path, Tags, Priority and Story points are on; Comment count is off.
- **Panel** (read from ADO when it opens, again when the item changes there): state, assigned to, iteration, area path and tags always, then each level's fields. Defaults: Epic: description, priority, links, comments. Feature: description, release notes, priority, links, comments. Story: description, acceptance criteria, priority, story points, links, comments. Bug: repro steps, system info, priority, severity, story points, links, comments. An empty field says **Empty in ADO**. Comments show as a count, with **Show comments** to read them.
- **Custom fields** per level, by reference name (`Custom.Risk`), shown under their own name.
- **Field names in your ADO**: release notes has no standard field, so set its reference name (default `Custom.ReleaseNotes`); story points tries `Microsoft.VSTS.Scheduling.StoryPoints`, then `Microsoft.VSTS.Scheduling.Effort`.

Saved in `items`' `meta.fields`, so they follow your Workshop folder.

## Roadmaps

Runway, inside Slate. Slate's manifest hosts Runway (`"hosts": [{"app": "runway", "path": "roadmaps"}]`, Workshop docs/app-manifest.md, Hosted apps): while Slate is on, Runway has no rail button and `#/runway/...` opens here. Draft roadmaps with no ADO items at all, or follow ADO's Epics and Features; both work as they do in Runway. Slate stands in for the shell for Runway's frame (`js/host.js`), so Runway's own routes stay in the tab, and its **Open in Slate** button opens the roadmap item here (`#/slate/runway/<map>/<item>`), made the first time. Runway keeps its own site.

## Sprints

ADO items Slate knows (published, delegated or yours), by sprint: the current and next sprints, then Not in a sprint, with load per person. Move an item to a sprint or assign it with the selects; each change goes to ADO after a confirm (`workitem.update`). Sprints come from the ADO connector's `iterations.list`.

## Health

Where requests sit (items, median days and stale count per column), the median days from request to decision, what has waited longest, delegated work by person, and Runway's team reports (sprint health from ADO) below.

## Data

- `items` (`slate.items` v1): the Fields settings in `meta.fields`, and one record per item you acted on: title, level (`epic`, `feature`, `story`, `bug`), stage, the ADO item (`id`, `rev`, `url`), the Runway item, the `.work` folders and Tandem sessions for triage, define and handoff, the route, who it is delegated to, what Publish created, a stage history, and `reopened` (the stage you moved it back to, until you act).
- `handoffs` (`slate.handoffs` v1): offers to Runway (an idea, from **Add to roadmap**), Docket (a waiting-on task, from **Delegate**), Notes (the decision log) and Rapport (a win when delegated work closes), as Workshop `docs/handoffs.md` describes. All but the win are accepted offers.
- `summary` (`slate.summary` v1, Workshop docs/summaries.md): `needs` (Home's Needs you), `delegated` (Rapport's 1:1 prep), `done-week` (Home's weekly status) and `ado` (Dispatch's From Slate link).

The `.work` files stay in your workspace; Slate reads them with the opencode connector's `file.read` and writes only through `file.write` (Workshop `connectors/opencode/README.md`, Slate).

## What it needs

| For | Needs |
| --- | --- |
| The board and New request | Nothing: it works in every mode, with data in your Workshop folder or this browser. |
| Your ADO backlog, Publish, assigning | Workshop on this computer with the ADO connector on, your team's area paths in People, and a PAT with Work Items (Read & Write) for Publish. |
| Triage, define, handoff, the Dev lane | Workshop on this computer with the opencode connector on, and eng-agents Core 2.12.0 or later installed in opencode. |

## Files

| File | What |
| --- | --- |
| `js/model.js` | Pure: stages and columns, the Fields settings and what cards and the panel show from ADO, the parsers for `triage.md`, `refine.md` and `milestones.md` (as eng-agents' `Export-Backlog.ps1` reads it), the publish plan, handoff offers. |
| `js/data.js` | The collections, and calls to the ADO and opencode connectors. |
| `js/view.js` | HTML for the board, panel and dialogs. |
| `js/host.js` | The stand-in shell for Runway, in Roadmaps and Health. |
| `js/health.js` | HTML for the Health and Sprints tabs. |
| `js/main.js` | The page: state, refreshing, and what each button does. |

Tests: `node --test "apps/slate/test/*.test.mjs"`; the browser checks are in `tests/e2e.py` (Slate).

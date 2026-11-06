# Slate

Your team's Azure DevOps backlog and your own ideas, from a rough request to a decision: **delegate it**, or **build it yourself**. Tandem's agents (eng-agents Core 2.12.0 or later; 2.16.0 for the interview) do each step's legwork, and nothing moves until you click.

Four tabs: **Board** (the three lanes below), **Roadmaps** (Runway), **Sprints** and **Health**.

## The board's three lanes

**Shape lane:** New, Triage, Waiting on requester, Interview, Brief. Every item starts here.

1. **New.** Open ADO items in your team's area paths (the ADO connector's `backlog` action, areas from People), requests you add with **New request** (with who asked) or send from a Runway item, your own ideas from **New idea**, and the ideas waiting on Runway's Pending assignment list (marked **From Runway**; Home's `p ...` quick capture lands there). ADO items and Runway ideas are stored in Slate only once you act on one. **Hide from Slate** hides a Runway idea here only.
2. **Triage** runs `/triage`: a summary, the products and repos it touches, questions for the requester, a size and a suggested route. It never posts.
3. **Waiting on requester.** **Copy questions and wait** puts the questions on the clipboard. Paste the answers back and **Save answers and triage again** writes `answers.md` next to `triage.md` and runs triage again.
4. **Interview.** **Shape it** (your ideas) or **Interview me** (a request, before or after triage) runs `/shape`: an agent asks you up to 5 questions a round, each with options and a recommendation, and keeps a running **What the agent understands** you can edit (your lines win). Pick an option, write your own under Other, or Skip; add notes; **Send answers** writes the round to `answers.md` and runs the next round. **Use the recommendations** fills in what you have not picked. **Write the brief now** stops the questions (prominent from round 4). The card says **Your turn** when a round is waiting.
5. **Brief.** The agent wrote `brief.md` (problem, goals, MVP line, rules, risks, Level and Size). **Edit** it, **Keep going** (another round, with what to dig into), or **Send to Define**: it runs `/scope shape-<name>` (or `/refine shape-<name>` for one story or bug), which asks only what the brief leaves open, and the card moves to the PM lane.

**Already shaped: who builds it?** on any item in Shape or Define skips straight to Who builds it? in one click (the same as Skip ahead below). Nothing changes in ADO; the history line says it skipped, and **Move back** undoes it.

**PM lane:** Define, Publish, Who builds it?, Delegated.

1. **Define.** One story or bug: `/refine` writes `refine.md` (description and Gherkin acceptance criteria). Bigger: `/scope`, then `/slice`. Read the draft in the panel, **Edit** it, **Approve** it, or **Revise with my edits**.
2. **Publish to ADO** shows every create and update first, then sends them with one confirm. A refined story on an existing ADO item updates its description and acceptance criteria; anything else is created, parents first, tagged `slate`. If a run stops part way, the next one skips what was already made.
3. **Who builds it?** **Delegate**: pick someone from People. The owners of what the item touches (People, **Owns**, matched against triage's products and repos and the ADO area) come first, with what they own. Slate can run `/handoff` for a brief, assign the item in ADO (needs their ADO identity in People) and add a "waiting on" task to Docket. **Do it myself** moves the card to the Dev lane.

Every card shows how many days it has been in its column; past a limit (3 days in New, Triage, Brief or Who builds it?, 5 waiting on the requester or in Interview, 7 in Define, 2 in Publish; your own ideas can wait in New) it is marked **Stale** and shows on Home's Needs you.

**Area paths.** The board's **Area** select shows one area path and everything under it, so you are not looking at the whole backlog at once. It lists your team's area paths from People and every sub-area your cards sit in, as a tree with counts; requests not in ADO yet are under **No area path**. Your choice is remembered in this browser, and a new request you publish goes to the area you are looking at.

**Dev lane:** Ready, Spec and plan, Build, Review and PR, Done. Only what you chose to build yourself, with its Tandem stage. **Start** runs Tandem on the ADO item; after that the panel offers the run's next step, or **Open in Dispatch**, where every run, prompt and review lives. When an agent asks you something, the card says **Waiting on you**.

**Answering the agent.** When any of an item's agents asks you something (a triage, shape, define or handoff session, or its Tandem run in the Dev lane), the panel shows it at the top: **Allow once**, **Always allow** or **Reject** for a permission prompt, and the options plus a text box for a question, then **Answer** or **Dismiss**. Below that, **Agent** shows what the item's current session last said, with a reply box once it stops, for a question asked in plain text (Ctrl+Enter sends). Answers and replies go through the opencode connector's `answer` and `reply` actions, with a confirm. What you tick and type survives refreshes. **Open in Dispatch** is still there for the whole session.

**More room.** **Expand** in the panel's header widens it (the board stays beside it, narrower); **Narrow** goes back. Slate remembers which you chose.

**Moving a card.** Under the panel, pick a stage and **Move**.

**Skip ahead** is for work already done elsewhere, like a feature whose stories are already in ADO: from New, Triage, Waiting, Interview, Brief, Define or Publish, a card can go straight to **Define** or **Who builds it?**. Nothing is triaged, drafted or published on the way, and nothing changes in ADO. Works on ADO items you have not acted on yet too.

**Moving back** is to pause and revise: pick an earlier stage. The choices are the stages the item went through (New always). It keeps its triage, drafts and history, and stays put until you act: back in New, a finished triage does not move it on; back in Define, an approved draft offers **Revise with my edits** or **Keep it approved** instead of going to Publish. Delegated and the Dev lane go back to Who builds it?. A brief can go back to Interview, and Define to Brief or Triage, whichever it came through. Off while an agent is running on the item. Moving back changes nothing in ADO, Docket or Tandem; the confirm says what stays.

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

- `items` (`slate.items` v1): the Fields settings in `meta.fields`, the Runway ideas you hid in `meta.dismissed`, and one record per item you acted on: title, level (`epic`, `feature`, `story`, `bug`), `kind` (`idea` for your own ideas), stage (`new`, `triaged`, `waiting`, `shaping`, `brief`, `defining`, `ready`, `decide`, `delegated`, `dev`, `done`), the ADO item (`id`, `rev`, `url`), the Runway item, `runwayPending` (the Runway pending idea it came from), the `.work` folders and Tandem sessions for triage, shape, define and handoff, the route, who it is delegated to, what Publish created, a stage history (a line with `skipped: true` for Already shaped), and `reopened` (the stage you moved it back to, until you act).
- `handoffs` (`slate.handoffs` v1): offers to Runway (an idea, from **Add to roadmap**), Docket (a waiting-on task, from **Delegate**), Notes (the decision log) and Rapport (a win when delegated work closes), as Workshop `docs/handoffs.md` describes. All but the win are accepted offers.
- `summary` (`slate.summary` v1, Workshop docs/summaries.md): `needs` (Home's Needs you), `shaping` (Runway pending ideas Slate has taken, which Runway marks **Shaping in Slate**), `delegated` (Rapport's 1:1 prep), `done-week` (Home's weekly status) and `ado` (Dispatch's From Slate link).

The `.work` files stay in your workspace; Slate reads them with the opencode connector's `file.read` and writes only through `file.write` (Workshop `connectors/opencode/README.md`, Slate).

## What it needs

| For | Needs |
| --- | --- |
| The board and New request | Nothing: it works in every mode, with data in your Workshop folder or this browser. |
| Your ADO backlog, Publish, assigning | Workshop on this computer with the ADO connector on, your team's area paths in People, and a PAT with Work Items (Read & Write) for Publish. |
| Triage, define, handoff, the Dev lane | Workshop on this computer with the opencode connector on, and eng-agents Core 2.12.0 or later installed in opencode. |
| The interview (Shape it, Interview me) | The same, with eng-agents Core 2.16.0 or later. |
| Runway's pending ideas in New | Runway on (it publishes them in its summary, Runway 1.12.0). |

## Files

| File | What |
| --- | --- |
| `js/model.js` | Pure: stages, lanes and columns, the Fields settings and what cards and the panel show from ADO, the parsers for `triage.md`, the interview's `questions.md` and `brief.md` and the `answers.md` writer, `refine.md` and `milestones.md` (as eng-agents' `Export-Backlog.ps1` reads it), the publish plan, handoff offers. |
| `js/data.js` | The collections, and calls to the ADO and opencode connectors. |
| `js/view.js` | HTML for the board, panel and dialogs. |
| `js/host.js` | The stand-in shell for Runway, in Roadmaps and Health. |
| `js/health.js` | HTML for the Health and Sprints tabs. |
| `js/main.js` | The page: state, refreshing, and what each button does. |

Tests: `node --test "apps/slate/test/*.test.mjs"` (model, view, host); the browser checks are in `tests/e2e.py` (Slate).

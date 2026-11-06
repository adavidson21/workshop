# Slate

Your Azure DevOps backlog as a board, from an enhancement request to a decision: **delegate it**, or **build it yourself**. Tandem's agents (eng-agents Core 2.12.0 or later) do each step's legwork, and nothing moves until you click.

## The two lanes

**PM lane:** New, Triage, Waiting on requester, Define, Publish, Who builds it?, Delegated.

1. **New.** Open ADO items in your team's area paths (the ADO connector's `backlog` action, areas from People), plus requests you add with **New request** or send from a Runway item. An ADO item is stored in Slate only once you act on it.
2. **Triage** runs `/triage`: a summary, the products and repos it touches, questions for the requester, a size and a suggested route. It never posts.
3. **Waiting on requester.** **Copy questions and wait** puts the questions on the clipboard. Paste the answers back and **Save answers and triage again** writes `answers.md` next to `triage.md` and runs triage again.
4. **Define.** One story or bug: `/refine` writes `refine.md` (description and Gherkin acceptance criteria). Bigger: `/scope`, then `/slice`. Read the draft in the panel, **Edit** it, **Approve** it, or **Revise with my edits**.
5. **Publish to ADO** shows every create and update first, then sends them with one confirm. A refined story on an existing ADO item updates its description and acceptance criteria; anything else is created, parents first, tagged `slate`. If a run stops part way, the next one skips what was already made.
6. **Who builds it?** **Delegate**: pick someone from People; Slate can run `/handoff` for a brief, assign the item in ADO (needs their ADO identity in People) and add a "waiting on" task to Docket. **Do it myself** moves the card to the Dev lane.

**Dev lane:** Ready, Spec and plan, Build, Review and PR, Done. Your items, plus every Tandem run from Dispatch or the terminal. **Start** runs Tandem on the ADO item; after that the panel offers the run's next step, or **Open in Dispatch**. When an agent asks you something, the card says **Waiting on you** and **Answer in Dispatch** opens it.

## Roadmap tab

Runway, inside Slate: its outline and timeline, with your roadmaps. Slate stands in for the shell for Runway's frame (`js/host.js`), so Runway's own routes stay in the tab, and its **Work item** button opens the item here (`#/slate/runway/<map>/<item>`), made from the roadmap item the first time. Runway keeps its own place on the rail and its own site.

## Data

- `items` (`slate.items` v1): one record per item you acted on: title, level (`epic`, `feature`, `story`, `bug`), stage, the ADO item (`id`, `rev`, `url`), the Runway item, the `.work` folders and Tandem sessions for triage, define and handoff, the route, who it is delegated to, what Publish created, and a stage history.
- `handoffs` (`slate.handoffs` v1): offers to Runway (an idea, from **Add to roadmap**) and Docket (a waiting-on task, from **Delegate**), as Workshop `docs/handoffs.md` describes. Both are accepted offers.

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
| `js/model.js` | Pure: stages and columns, the parsers for `triage.md`, `refine.md` and `milestones.md` (as eng-agents' `Export-Backlog.ps1` reads it), the publish plan, handoff offers. |
| `js/data.js` | The collections, and calls to the ADO and opencode connectors. |
| `js/view.js` | HTML for the board, panel and dialogs. |
| `js/host.js` | The Roadmap tab's stand-in shell for Runway. |
| `js/main.js` | The page: state, refreshing, and what each button does. |

Tests: `node --test "apps/slate/test/*.test.mjs"`; the browser checks are in `tests/e2e.py` (Slate).

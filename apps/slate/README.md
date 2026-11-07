# Slate

Your team's Azure DevOps backlog and your own ideas, from a rough request to a decision (**delegate it** or **build it yourself**), then built, merged, resolved and closed. One card per piece of work, wherever it started. Tandem's agents (eng-agents Core 2.12.0 or later; 2.16.0 for the interview) do each step's legwork, and nothing moves until you click.

Two tabs: **Board** (one board, six columns) and **Health** (with **Sprints** inside it). Roadmaps are in Runway, on its own rail button (Slate hosted it until 2.0.0; old `#/slate/roadmaps` links open Runway).

## The board

One board, left to right. A card's chip names the step it is at inside its column.

| Column | Steps (chip) |
| --- | --- |
| **Inbox** | New requests, your ideas, open ADO items in your team's area paths, Runway's pending ideas (**From Runway**) |
| **Shape** | **Triage**, **Waiting on requester**, **Interview** (**Your turn** when a round waits), **Brief ready** |
| **Define** | Drafting, then **Approved: not in ADO** until it is published |
| **Who builds it?** | Delegate it, or build it yourself |
| **In flight** | **With <name>** (delegated), or your own build: **Not started**, **Spec**, **Plan**, **Build**, **Waiting on you**, **Review and PR**, **Merged**. Waiting on you first, then your builds, then delegated work. |
| **Resolved** | Merged to main and waiting for a release, grouped by area path |

**Buttons.** Each step shows its main button and at most two others. Everything else is in the panel's **More** menu: **Move to** (skip ahead or move back, one list), **Build it myself** when it is a skip ahead, **Add to roadmap**, **Hide from Slate**, **Open in ADO**, **Mark closed** and **Remove from Slate**.

**Cards** show the ADO work item type (Issue, User Story) when there is one, else the level. **Your notes** (the note typed with `#1234 <note>` in quick capture, say) show under Details on every card, and Triage sends them along with the ADO id (Tandem Core 2.18.0 keeps them in `note.md`).

**The panel.** The next step (or the agent's question) at the top, then the agent's last words while there is a session, then the current step's file open (triage, the understanding and brief, the draft). Earlier steps' files are there, closed. **Details** (ADO fields, the request, owners, who asked, days in the stage) and **Timeline** start closed; Slate remembers in this browser whether you opened them.

## The steps

**Inbox and Shape:**

1. **Inbox.** Open ADO items in your team's area paths (the ADO connector's `backlog` action, areas from Settings, People and teams), requests you add with **New request** (with who asked) or send from a Runway item, your own ideas from **New idea**, and the ideas waiting on Runway's Pending assignment list (marked **From Runway**; Home's `p ...` quick capture lands there), and requests captured on Home or in the Dispatch hub with `s <text>`, `s #1234 <note>` or a line starting with `#1234` (an accepted `request` handoff, Workshop docs/handoffs.md). A captured `#1234` goes to that item's card, with the note added to its description, or makes one titled `#1234` until Slate reads the item's title from ADO. ADO items and Runway ideas are stored in Slate only once you act on one. A request shows **Triage** and **Interview me**; **Define now** (skip triage) is in More. An idea shows **Shape it**.
2. **Triage** runs `/triage`: a summary, the products and repos it touches, questions for the requester, a size and a suggested route. It never posts. When triage sizes it L or XL, Define scopes and slices it instead of refining one story, and Define's pick step says so.
3. **Waiting on requester.** On an ADO item, **Post on #1234** adds the questions to the item's Discussion as a comment (the confirm shows the text), so whoever asked can answer there; in Waiting, **Read replies from #1234** brings in the comments posted since and puts them in the answers box for you to check. **Copy questions and wait** puts the questions on the clipboard instead. Paste the answers back and **Save answers and triage again** writes `answers.md` next to `triage.md` and runs triage again.
4. **Interview.** **Shape it** (your ideas) or **Interview me** (a request, before or after triage) runs `/shape`: an agent asks you up to 5 questions a round, each with options and a recommendation, and keeps a running **What the agent understands** you can edit (your lines win). Pick an option, write your own under Other, or Skip; add notes; **Send answers** writes the round to `answers.md` and runs the next round. **Use the recommendations** fills in what you have not picked. **Write the brief now** stops the questions (prominent from round 4).
5. **Brief ready.** The agent wrote `brief.md` (problem, goals, MVP line, rules, risks, Level and Size). **Edit** it, **Keep going** (another round, with what to dig into), or **Send to Define**: it runs `/scope shape-<name>` (or `/refine shape-<name>` for one story or bug), which asks only what the brief leaves open, and the card moves to Define.

**Skip ahead** (More, Move to) takes any card in Inbox, Shape or Define straight to **Define** or **Who builds it?**, for work already shaped elsewhere. Nothing changes in ADO; the history line says it skipped, and Move back undoes it. **Build it myself** is also in More from Inbox, Shape and Define: on an ADO item it starts Tandem on it; with no ADO item it is **Build it myself, skip ADO** (local work, below).

**Define and Who builds it?:**

1. **Define.** One story or bug: `/refine` writes `refine.md` (description and Gherkin acceptance criteria). Bigger: `/scope`, then `/slice`. Read the draft in the panel, **Edit** it, then **Approve and publish** (the draft is approved, and as soon as it is, Slate shows the publish list to confirm) or **Revise with my edits**; **Approve, publish and build it myself** and **Approve only** are in More. Stories from `/scope` are approved with a plain **Approve**, then sliced.
2. **Publish** is an action, not a column. An approved draft not in ADO yet stays in Define marked **Approved: not in ADO**, with **Publish to ADO** and **Publish and build it myself** (**Build it myself, skip ADO** is in More). Publish shows every create and update first, then sends them with one confirm. A refined story on an existing ADO item updates its description and acceptance criteria; anything else is created, parents first, tagged `slate`. If a run stops part way, the next one skips what was already made. When a scope is published from a card whose own ADO item (an Issue, say) is not the epic, the list has one more line, **Link #1234**: that item gets a Related link to the new epic (or first feature) and a comment saying where the work went, and the card then follows the new item, keeping the first one as its source (Timeline: Came from #1234).
3. **Who builds it?** **Delegate**: pick someone from People. The owners of what the item touches (People, **Owns**, matched against triage's products and repos and the ADO area) come first, with what they own. Slate can run `/handoff` for a brief, assign the item in ADO (needs their ADO identity in People) and add a "waiting on" task to Docket. **Build it myself** moves the card to In flight and starts Tandem on the ADO item in the same click (no ADO item: local work).

Every card shows how many days it has been in its step; past a limit (3 days in Inbox, triage, Brief or Who builds it?, 5 waiting on the requester or in the interview, 7 in Define, 2 approved but not published; your own ideas can wait in New) it is marked **Stale** and shows on Home's Needs you.

**Area paths.** The board's **Area** select shows one area path and everything under it, so you are not looking at the whole backlog at once. It lists your team's area paths from People and every sub-area your cards sit in, as a tree with counts; requests not in ADO yet are under **No area path**. Your choice is remembered in this browser, and a new request you publish goes to the area you are looking at.

**In flight and Resolved** for everything you build yourself, however it started, and resolved work (yours or delegated). Delegated work sits in In flight too, marked **With <name>**, with **Take it back**.

1. **Building** (In flight). The card names where its Tandem run is: **Not started**, **Spec**, **Plan**, **Build**, or **Waiting on you**. **Start** runs Tandem on the ADO item, or as local work when there is none; after that the panel offers the run's next step, or **Open in Dispatch**, where every run, prompt and code review lives.
2. **Review and PR** (In flight). Review the code, push and create the PR in Dispatch (Ship). The card says how many linked pull requests merged; **Check pull requests** reads them now, **Mark merged** (More) is for work Slate cannot follow.
3. **Merged** (In flight). Every pull request linked to the ADO item (and to its child items) is completed, read with the ADO connector's `workitem.prs` (read only) every 15 minutes while Slate is open. **Mark resolved** sets the ADO item to Resolved after a confirm; **Not merged yet** undoes Merged.
4. **Resolved** (its own column). Merged to main and waiting for a release. Grouped by area path, each group with **Copy release notes** (titles, ADO links, and each item's release notes field, as Markdown) and **Close as released** (every ADO item in the group to Closed, one at a time after one confirm; a failure stops there and says what closed). Resolved cards never go stale and never drop off by time.

**Closed means gone.** When an item's ADO state is Closed, Done or Removed, its card leaves the board (Health still counts it; Move back brings it back). **Mark closed** in the panel does the same without changing ADO.

**Work started in Dispatch** gets a card too. Dispatch's Start work (Describe it, or an ADO work item) and Research's **Start work from this** send Slate an accepted `work` handoff (Workshop docs/handoffs.md); Slate adds a card in In flight (Building) marked **From Dispatch**, or moves the card it belongs to (same run folder or ADO id) there.

**Build it myself, skip ADO.** Local work in Tandem (`start.local`) from the brief, triage or request, with no ADO item. The card shows **No ADO item** from Review and PR on, and the panel's **Link ADO item** looks one up (title, type, project) and saves it on the card after a confirm. Nothing changes in ADO.

**Without Tandem** (the opencode connector off, as in work mode without Dispatch), the agent steps' buttons stay in place, disabled, with the reason as their tooltip, and the step says so. Move to (More), Delegate, Publish and the ADO steps still work.

**Answering the agent.** When any of an item's agents asks you something (a triage, shape, define or handoff session, or its Tandem run while it is In flight), the panel shows it at the top: **Allow once**, **Always allow** or **Reject** for a permission prompt, and the options plus a text box for a question, then **Answer** or **Dismiss**. Below that, **Agent** shows what the item's current session last said, with a reply box once it stops, for a question asked in plain text (Ctrl+Enter sends). Answers and replies go through the opencode connector's `answer` and `reply` actions, with a confirm. What you tick and type survives refreshes. **Open in Dispatch** is still there for the whole session.

**More room.** **Expand** in the panel's header widens it (the board stays beside it, narrower); **Narrow** goes back. Slate remembers which you chose.

**Moving a card.** In More, pick a stage under **Move to** and **Move**.

**Skip ahead** is for work already done elsewhere, like a feature whose stories are already in ADO: from Inbox, Shape or Define, a card can go straight to **Define** or **Who builds it?**. Nothing is triaged, drafted or published on the way, and nothing changes in ADO. Works on ADO items you have not acted on yet too.

**Moving back** is to pause and revise: pick an earlier stage. The choices are the stages the item went through (Inbox always). It keeps its triage, drafts and history, and stays put until you act: back in Inbox, a finished triage does not move it on; back in Define, an approved draft offers **Revise with my edits** or **Keep it approved** instead of going to Publish. Delegated work and your own builds go back to Who builds it?. A brief can go back to Interview, and Define to Brief or Triage, whichever it came through. Off while an agent is running on the item. Moving back changes nothing in ADO, Docket or Tandem; the confirm says what stays.

**When work resolves or closes.** Slate reads the state of every delegated, own and resolved item that is not in the open backlog (which leaves out Resolved and Closed), up to 15 a refresh, oldest checked first. Resolved moves it to Resolved; a delegated one offers Rapport a win about the person (an ordinary offer you accept there). Closed takes it off the board.

**Timeline.** The panel's Timeline is the whole journey, oldest first: captured (or started in Dispatch), triage, interview, brief, define, published (ADO link), who builds it, the Tandem run's stage (opens it in Dispatch), each pull request (link), merged, resolved, closed.

**Decision log.** Each decision (delegated, building it myself, defined and published) adds a note to Notes' inbox with a link back to the item. Nothing is posted anywhere.

## Fields

Cards and the panel show what ADO has for each item. **Fields** (top bar) picks which.

- **Cards** (from the backlog read): Assigned to, Priority and Tags are on by default; Iteration, Area path, Story points and Comment count are off (Slate 2.0.0; a choice you saved before is kept).
- **Panel** (read from ADO when it opens, again when the item changes there): state, assigned to, iteration, area path and tags always, then each level's fields. Defaults: Epic: description, priority, links, comments. Feature: description, release notes, priority, links, comments. Story: description, acceptance criteria, priority, story points, links, comments. Bug: repro steps, system info, priority, severity, story points, links, comments. An empty field says **Empty in ADO**. Comments show as a count, with **Show comments** to read them.
- **Custom fields** per level, by reference name (`Custom.Risk`), shown under their own name.
- **Field names in your ADO**: release notes has no standard field, so set its reference name (default `Custom.ReleaseNotes`); story points tries `Microsoft.VSTS.Scheduling.StoryPoints`, then `Microsoft.VSTS.Scheduling.Effort`.

Saved in `items`' `meta.fields`, so they follow your Workshop folder.

## Health

Where requests sit (items, median days and stale count per board column), the median days from request to decision and from request to resolved, what has waited longest, delegated work by person, then **Sprints**, then Runway's team reports (sprint health from ADO, Runway's page framed by `js/host.js`).

**Sprints** (`#/slate/sprints` opens Health there): ADO items Slate knows (published, delegated or yours), by sprint: the current and next sprints, then Not in a sprint, with load per person. Move an item to a sprint or assign it with the selects; each change goes to ADO after a confirm (`workitem.update`). Sprints come from the ADO connector's `iterations.list`.

## Roadmaps

In Runway, on its own rail button. Runway's **Open in Slate** button still opens the roadmap item here (`#/slate/runway/<map>/<item>`), made the first time from Runway's `roadmap-item` offer (Runway 1.15.0, `docs/handoffs.md`). Slate never reads Runway's roadmaps. Runway's Pending ideas that Slate sent are left out of Inbox by the row's `from` (titles only for older rows).

## Data

- `items` (`slate.items` v1): the Fields settings in `meta.fields`, the Runway ideas you hid in `meta.dismissed`, and `meta.handled` (the `work` and `request` handoffs taken, by sender and id), and one record per item you acted on: title, level (`epic`, `feature`, `story`, `bug`), `kind` (`idea` for your own ideas), stage (`new`, `triaged`, `waiting`, `shaping`, `brief`, `defining`, `ready`, `decide`, `delegated`, `dev`, `resolved`, `done` for closed), `run` (the Tandem run's folder and local id, for local work and runs from Dispatch), `merged` (the day) and `mergedHow` (`prs` or `manual`), `prs` (the last pull request check), `after` (`publish` or `build`: what Approve and publish does once the draft is approved), the ADO item (`id`, `rev`, `url`), the Runway item, `runwayPending` (the Runway pending idea it came from), the `.work` folders and Tandem sessions for triage, shape, define and handoff, the route, who it is delegated to, what Publish created, a stage history (a line with `skipped: true` for Already shaped), `reopened` (the stage you moved it back to, until you act), `source` (the ADO item the work came from, once Publish linked it to the new items) and `asked` (when the triage questions were posted on the ADO item).
- `handoffs` (`slate.handoffs` v1): offers to Runway (an idea, from **Add to roadmap**), Docket (a waiting-on task, from **Delegate**), Notes (the decision log) and Rapport (a win when delegated work closes), as Workshop `docs/handoffs.md` describes. All but the win are accepted offers.
- `summary` (`slate.summary` v1, Workshop docs/summaries.md): `needs` (Home's Needs you), `shaping` (Runway pending ideas Slate has taken, which Runway marks **Shaping in Slate**), `delegated` (Rapport's 1:1 prep), `done-week` (Home's weekly status), `ado` (Dispatch's From Slate link, by ADO id; kept for one release) and `runs` (every run Slate tracks, by ADO id or run folder, flagged when merged: Dispatch's From Slate link and Ship's Merged group) and `tracked` (every ADO item on the board with its column, plus sources Publish linked: Docket's In Slate chip).

The `.work` files stay in your workspace; Slate reads them with the opencode connector's `file.read` and writes only through `file.write` (Workshop `connectors/opencode/README.md`, Slate).

## What it needs

| For | Needs |
| --- | --- |
| The board and New request | Nothing: it works in every mode, with data in your Workshop folder or this browser. |
| Your ADO backlog, Publish, assigning, Merged (pull requests, needs Code (Read) on the PAT), Resolved and Close as released | Workshop on this computer with the ADO connector on, your team's area paths in People, and a PAT with Work Items (Read & Write) for Publish. |
| Triage, define, handoff, building in Tandem, Build it myself (skip ADO) | Workshop on this computer with the opencode connector on, and eng-agents Core 2.12.0 or later installed in opencode. |
| The interview (Shape it, Interview me) | The same, with eng-agents Core 2.16.0 or later. |
| Runway's pending ideas in Inbox | Runway on (it publishes them in its summary, Runway 1.12.0). |

## Files

| File | What |
| --- | --- |
| `js/model.js` | Pure: stages, steps and the six board columns, the Fields settings and what cards and the panel show from ADO, the parsers for `triage.md`, the interview's `questions.md` and `brief.md` and the `answers.md` writer, `refine.md` and `milestones.md` (as eng-agents' `Export-Backlog.ps1` reads it), the publish plan, handoff offers. |
| `js/data.js` | The collections, and calls to the ADO and opencode connectors. |
| `js/view.js` | HTML for the board, the panel (next step, More, folding sections) and dialogs. |
| `js/host.js` | The stand-in shell for Runway's team reports in Health. |
| `js/health.js` | HTML for the Health tab and its Sprints section. |
| `js/main.js` | The page: state, refreshing, and what each button does. |

Tests: `node --test "apps/slate/test/*.test.mjs"` (model, view, host); the browser checks are in `tests/e2e.py` (Slate).

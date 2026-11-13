# Loom

**Loom 4.0.0** folds Dispatch into Slate: one app (id `slate`, so the board's data stays where it was) with five tabs, **Inbox**, **Board**, **Health**, **Chat** and **Reviews**. The board is Slate's (below); the Inbox, Chat, Reviews, run pages and **All runs** (Dispatch's Work tab, opened from the board's toolbar) are Dispatch's ("the runs half", `js/dispatch/`, last section). `js/loom.js` is the seam: one SDK connection, the tab bar, routes to the half that owns them, one `summary` (both halves' cards merged) and one rail badge. Each half's stylesheet is scoped to its part of the page (`dispatch.css` under `#runs-root`, `slate.css` under `#board-root`, `loom.css` for the page). Old `#/agents/...` addresses and dispatch.alexisdavidson.org open Loom.

**Every run is a card (4.1.0).** A Tandem run that no stored card holds gets a card of its own on the board (`model.js` `runCards`, not stored until you act on it): a work item run in **Build**, an investigation, technical spec, doc or epic plan in **Shape** with its kind on the chip (**Investigate**, **Technical spec**). A card's panel holds its run (**Run**, drawn by the runs half, `pages.js` `runCardHtml`): at a gate, the file to read and **Approve and build**, **Approve only** and **Send back**; otherwise its step and main button; **Open the run** opens its full page. In Needs you, a run waiting on you that has a card opens the card (`loom.js` `mergeCards`). Plan: `claude/slate-run-panel-v1-plan.md` in the Workshop project.


Your team's Azure DevOps backlog and your own ideas, from a rough request to a decision (**delegate it** or **build it yourself**), then built, merged, resolved and closed. One card per piece of work, wherever it started. Tandem's agents (eng-agents Core 2.12.0 or later; 2.16.0 for the interview) do each step's legwork, and nothing moves until you click.

The board half has **Board** (one board, four lanes since 3.1.0) and **Health** (with **Sprints** inside it). Since 3.0.0 Slate uses Workshop's look (`shared/themes.css`: Schibsted Grotesk headings, Atkinson Hyperlegible Next text, Slate's own slate grey since Workshop 6.46.0): the tab names are the headline, columns are soft lanes with white cards, labels are sentence case, and the panel is one white sheet. Plan: `claude/slate-redesign-v1-plan.md` in the Workshop project. Roadmaps are in Runway, on its own rail button (Slate hosted it until 2.0.0; old `#/slate/roadmaps` links open Runway).

## The board

One board of four lanes, left to right (3.1.0; it had six columns before). A card's chip names the step it is at inside its lane. Plan: `claude/slate-run-panel-v1-plan.md` in the Workshop project.

| Lane | Steps (chip) |
| --- | --- |
| **Shape** | **New** (requests, your ideas, open ADO items in your team's area paths, Runway's pending ideas), **Triage**, **Waiting on requester**, **Interview** (**Your turn** when a round waits), **Brief ready** |
| **Decide** | **Define**, then **Not in ADO** until it is published, **Who builds it?**, **With <name>** (delegated) |
| **Build** | Your own build: **Not started**, **Spec**, **Plan**, **Build**, **Waiting on you**, **Review and PR**, **Merged**. Waiting on you first. |
| **Done** | Merged to main and waiting for a release (Resolved), grouped by area path |

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
2. **Publish** is an action, not a column. An approved draft not in ADO yet stays in Define marked **Approved: not in ADO**, with **Publish to ADO** and **Publish and build it myself** (**Build it myself, skip ADO** is in More). Publish shows every create and update first, then sends them with one confirm. A refined story on an existing ADO item updates its description and acceptance criteria; anything else is created, parents first, tagged `slate`. A feature's release note (`#### Release note` in `milestones.md`) goes to the **Release notes field** in Fields settings (default `Custom.ReleaseNotes`; leave it empty to send none). A story's "Notes for the builder" never go to ADO: features and stories stay light so engineering decides how. If a run stops part way, the next one skips what was already made. When a scope is published from a card whose own ADO item (an Issue, say) is not the epic, the list has one more line, **Link #1234**: that item gets a Related link to the new epic (or first feature) and a comment saying where the work went, and the card then follows the new item, keeping the first one as its source (Timeline: Came from #1234).
3. **Who builds it?** **Delegate**: pick someone from People. The owners of what the item touches (People, **Owns**, matched against triage's products and repos and the ADO area) come first, with what they own. Slate can run `/handoff` for a brief, add a "waiting on" task to Docket and, only if you tick **Also assign it to them in Azure DevOps** (off by default; needs their ADO identity in People), assign the item in ADO. **Build it myself** moves the card to In flight and starts Tandem on the ADO item in the same click. With no ADO item it is **Build it myself, skip ADO** (local work), or **Publish and build it myself** when the draft is approved (it publishes first, after a confirm).

Every card shows how many days it has been in its step; past a limit (3 days in Inbox, triage, Brief or Who builds it?, 5 waiting on the requester or in the interview, 7 in Define, 2 approved but not published; your own ideas can wait in New) it is marked **Stale** and shows on Home's Needs you.

**Area paths.** The board's **Area** select shows one area path and everything under it, so you are not looking at the whole backlog at once. It lists your team's area paths from People and every sub-area your cards sit in, as a tree with counts; requests not in ADO yet are under **No area path**. Your choice is remembered in this browser, and a new request you publish goes to the area you are looking at.

**In flight and Resolved** for everything you build yourself, however it started, and resolved work (yours or delegated). Delegated work sits in In flight too, marked **With <name>**, with **Take it back**.

1. **Building** (In flight). The card names where its Tandem run is: **Not started**, **Spec**, **Plan**, **Build**, or **Waiting on you**. **Start** runs Tandem on the ADO item, or as local work when there is none; after that the panel offers the run's next step, or **Open in Dispatch**, where every run, prompt and code review lives.
2. **Review and PR** (In flight). Review the code, push and create the PR in Dispatch (the run's Ship step). The card says how many linked pull requests merged; **Check pull requests** reads them now, **Mark merged** (More) is for work Slate cannot follow.
3. **Merged** (In flight). Every pull request linked to the ADO item (and to its child items) is completed, read with the ADO connector's `workitem.prs` (read only) every 15 minutes while Slate is open. **Mark resolved** sets the ADO item to Resolved after a confirm; **Not merged yet** undoes Merged.
4. **Resolved** (its own column). Merged to main and waiting for a release. Grouped by area path, each group with **Copy release notes** (titles, ADO links, and each item's release notes field, as Markdown) and **Close as released** (every ADO item in the group to Closed, one at a time after one confirm; a failure stops there and says what closed). Resolved cards never go stale and never drop off by time.

**Closed means gone.** When an item's ADO state is Closed, Done or Removed, its card leaves the board (Health still counts it; Move back brings it back). **Mark closed** in the panel does the same without changing ADO.

**Work started in Dispatch** gets a card too. Dispatch's Start work (Build a feature, Fix a bug or Quick change) and a spike's **Start work from this** send Slate an accepted `work` handoff (Workshop docs/handoffs.md); Slate adds a card in In flight (Building) marked **From Dispatch**, or moves the card it belongs to (same run folder or ADO id) there.

**Build it myself, skip ADO.** Local work in Tandem (`start.local`) from the brief, triage or request, with no ADO item. The card shows **No ADO item** from Review and PR on, and the panel's **Link ADO item** looks one up (title, type, project) and saves it on the card after a confirm. Nothing changes in ADO.

**Without Dispatch** (no opencode connector, as in work mode), one note above the board says so, with **How to set it up**. Agent buttons stay in place, disabled, with the reason as their tooltip. A request in Inbox offers **Write it myself** and **Who builds it?** instead.

**Write it myself.** In Define, **Write one story** or **Write an epic with stories** opens the same file an agent would write (`refine.md`, or `milestones.md` with `stories.md` already approved) as a template in the editor, prefilled with the title and your notes. It is kept in Slate's own data (`manual` on the item), never in `.work`. **Approve** (or **Approve and publish** with Azure DevOps) works exactly as for an agent's draft, Publish included. With Dispatch on, both are in More at Define's pick step.

**Without Azure DevOps** Slate is a local board. A note says so once (**Got it** hides it on this device); search, column hints and the panel drop the ADO words; an approved draft goes to **Who builds it?**; delegated and merged work has **Mark resolved** here, and Resolved work **Mark closed**.

**Answering the agent.** When any of an item's agents asks you something (a triage, shape, define or handoff session, or its Tandem run while it is In flight), the panel shows it at the top: **Allow once**, **Always allow** or **Reject** for a permission prompt, and the options plus a text box for a question, then **Answer** or **Dismiss**. Below that, **Agent** shows what the item's current session last said, with a reply box once it stops, for a question asked in plain text (Ctrl+Enter sends). Answers and replies go through the opencode connector's `answer` and `reply` actions, with a confirm. What you tick and type survives refreshes. **Open in Dispatch** is still there for the whole session.

**More room.** **Expand** in the panel's header widens it (the board stays beside it, narrower); **Narrow** goes back. Slate remembers which you chose.

**Moving a card.** In More, pick a stage under **Move to** and **Move**.

**Skip ahead** is for work already done elsewhere, like a feature whose stories are already in ADO: from Inbox, Shape or Define, a card can go straight to **Define** or **Who builds it?**. Nothing is triaged, drafted or published on the way, and nothing changes in ADO. Works on ADO items you have not acted on yet too.

**Moving back** is to pause and revise: pick an earlier stage. The choices are the stages the item went through (Inbox always). It keeps its triage, drafts and history, and stays put until you act: back in Inbox, a finished triage does not move it on; back in Define, an approved draft offers **Revise with my edits** or **Keep it approved** instead of going to Publish. Delegated work and your own builds go back to Who builds it?. A brief can go back to Interview, and Define to Brief or Triage, whichever it came through. Off while an agent is running on the item. Moving back changes nothing in ADO, Docket or Tandem; the confirm says what stays.

**When work resolves or closes.** Slate reads the state of every delegated, own and resolved item that is not in the open backlog (which leaves out Resolved and Closed), up to 15 a refresh, oldest checked first. Resolved moves it to Resolved; a delegated one offers Rapport a win about the person (an ordinary offer you accept there). Closed takes it off the board.

**Timeline.** The panel's Timeline is the whole journey, oldest first: captured (or started in Dispatch), triage, interview, brief, define, published (ADO link), who builds it, the Tandem run's stage (opens it in Dispatch), each pull request (link), merged, resolved, closed.

**Decision log.** Each decision (delegated, building it myself, defined and published) adds a note to Notes' inbox with a link back to the item. Nothing is posted anywhere.

## Two collections

If your team's area paths are in more than one Azure DevOps collection (Settings, People & teams, Team area paths: a connection per path), Slate reads each collection's backlog on its own connection and keeps the connection on every card. Work item ids repeat across collections, so a bare `#1234` (quick capture `s #1234`, or **Link ADO item**) is looked up on every connection (`workitem.find`): found once, it is used; found in more than one, the card says **Which collection?** and the panel has a button per match. New items from Publish go to the connection of the area they are made in, and the publish dialog names it.

## Fields

Cards and the panel show what ADO has for each item. **Fields** (top bar) picks which.

- **Cards** (from the backlog read): Assigned to, Priority and Tags are on by default; Iteration, Area path, Story points and Comment count are off (Slate 2.0.0; a choice you saved before is kept).
- **Panel** (read from ADO when it opens, again when the item changes there): state, assigned to, iteration, area path and tags always, then each level's fields. Defaults: Epic: description, priority, links, comments. Feature: description, release notes, priority, links, comments. Story: description, acceptance criteria, priority, story points, links, comments. Bug: repro steps, system info, priority, severity, story points, links, comments. An empty field says **Empty in ADO**. Comments show as a count, with **Show comments** to read them.
- **Custom fields** per level, by reference name (`Custom.Risk`), shown under their own name.
- **Field names in your ADO**: release notes has no standard field, so set its reference name (default `Custom.ReleaseNotes`); story points tries `Microsoft.VSTS.Scheduling.StoryPoints`, then `Microsoft.VSTS.Scheduling.Effort`.

Saved in `items`' `meta.fields`, so they follow your Workshop folder.

## Health

Where requests sit (items, median days and stale count per board column), the median days from request to decision and from request to resolved, what has waited longest, delegated work by person, then **Sprints**, then a button that opens Runway's team reports (sprint health from ADO) in Runway. Slate embedded that page until 2.5.0.

**Sprints** (`#/slate/sprints` opens Health there): ADO items Slate knows (published, delegated or yours), by sprint: the current and next sprints, then Not in a sprint, with load per person. Move an item to a sprint or assign it with the selects; each change goes to ADO after a confirm (`workitem.update`). Sprints come from the ADO connector's `iterations.list`.

## Roadmaps

In Runway, on its own rail button. Runway's **Open in Slate** button still opens the roadmap item here (`#/slate/runway/<map>/<item>`), made the first time from Runway's `roadmap-item` offer (Runway 1.15.0, `docs/handoffs.md`). Slate never reads Runway's roadmaps. Runway's Pending ideas that Slate sent are left out of Inbox by the row's `from` (titles only for older rows).

## Data

- `items` (`slate.items` v1): the Fields settings in `meta.fields`, the Runway ideas you hid in `meta.dismissed`, and `meta.handled` (the `work` and `request` handoffs taken, by sender and id), and one record per item you acted on: title, level (`epic`, `feature`, `story`, `bug`), `kind` (`idea` for your own ideas), stage (`new`, `triaged`, `waiting`, `shaping`, `brief`, `defining`, `ready`, `decide`, `delegated`, `dev`, `resolved`, `done` for closed), `run` (the Tandem run's folder and local id, for local work and runs from Dispatch), `merged` (the day) and `mergedHow` (`prs` or `manual`), `prs` (the last pull request check), `after` (`publish` or `build`: what Approve and publish does once the draft is approved), the ADO item (`id`, `rev`, `url`), the Runway item, `runwayPending` (the Runway pending idea it came from), the `.work` folders and Tandem sessions for triage, shape, define and handoff, the route, who it is delegated to, what Publish created, a stage history (a line with `skipped: true` for Already shaped), `reopened` (the stage you moved it back to, until you act), `source` (the ADO item the work came from, once Publish linked it to the new items), `manual` (a draft you wrote yourself: its folder name and files) and `asked` (when the triage questions were posted on the ADO item).
- `handoffs` (`slate.handoffs` v1): offers to Runway (an idea, from **Add to roadmap**), Docket (a waiting-on task, from **Delegate**), Notes (the decision log) and Rapport (a win when delegated work closes), as Workshop `docs/handoffs.md` describes. All but the win are accepted offers.
- `summary` (`slate.summary` v1, Workshop docs/summaries.md): `needs` (Home's Needs you), `shaping` (Runway pending ideas Slate has taken, which Runway marks **Shaping in Slate**), `delegated` (Rapport's 1:1 prep), `done-week` (Home's weekly status), `ado` (Dispatch's From Slate link, by ADO id; kept for one release) and `runs` (every run Slate tracks, by ADO id or run folder, flagged when merged: Dispatch's From Slate link and Merged on a run at Ship) and `tracked` (every ADO item on the board with its column, plus sources Publish linked: Docket's In Slate chip).

The `.work` files stay in your workspace; Slate reads them with the opencode connector's `file.read` and writes only through `file.write` (Workshop `connectors/opencode/README.md`, Slate).

## What changes Azure DevOps

Only buttons with the **ADO** mark (an arrow leaving a box) change anything in Azure DevOps: **Post on #n**, **Approve and publish**, **Publish to ADO**, **Publish and build it myself**, **Mark resolved** on an ADO item, **Close as released**, Delegate's **Also assign it to them in Azure DevOps**, and the sprint and person pickers in **Sprints**. Each one opens a confirm with the same banner (**Changes Azure DevOps.**) that lists what changes, and only that confirm's button, which carries the mark too, sends it. Everything else (moving cards, skip ahead, Remove, triage, drafts, Docket tasks) stays on this computer. The mark and the confirm are shared with Runway and Dispatch (`shared/outside.js`).

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
| `js/health.js` | HTML for the Health tab and its Sprints section. |
| `js/main.js` | The page: state, refreshing, and what each button does. |

Tests: `node --test "apps/slate/test/*.test.mjs"` (model, view); the browser checks are in `tests/e2e.py` (Slate).

## The runs half (was Dispatch)

The eng-agents live dashboard as a Workshop app: your `.work` items, where each stands, the opencode agents working on them, and a button for the next step. It replaces the Dashboard pane, which framed the eng-agents page from `127.0.0.1:4300`.

### How it works

- **Data:** the opencode connector's `state` action ([connectors/opencode/README.md](../../connectors/opencode/README.md)). The app fetches it again after the connector's events (`model`, `live`, `autopilot`, `agent.waiting`, `agent.done`) and when the connector's status changes. No polling.
- **Buttons:** the connector's actions. Write actions (`run`, `start`, `start.local`, `spike`, `repo.add`, `repo.guide`, `reply`, `answer`, `abort`, `remove`, `push`, `autopilot`, `file.write`) send `confirm: true`, only from the click that says what will happen.
- **Documents:** `.work` files (plan.md, spec.md, review.md...) open in a sheet with **Preview** and **Edit** (`js/dispatch/doc.js`). Save (or `Ctrl+S`) writes through `file.write` with the text the sheet read, so a change Tandem made meanwhile is never overwritten: the sheet says so and offers *Load the new version* or *Copy my text*. Edit is off while Tandem or autopilot works on the item. Closing with unsaved changes asks first. **Open in Notebook** opens the same file in the Notes app's Tandem section (`#/notes/tandem/<folder>/<file>`), the full editor. Approving is still the step's button, not an edit.
- **Shell:** `#/slate/<id>` opens that item (a work item id or any `.work` folder opens its page; `pr-<id>` opens Reviews at that review). `#/slate/<tab>` opens a tab, `#/slate/work/<id>` a run's page (Dispatch 2.x's `runs/`, `ship/` and `research/<folder>` still work), `#/slate/chat/<session>` a conversation. The rail badge counts what is in the Inbox. A notification, if allowed, when an agent waits for you or finishes while the app is out of sight. **Refresh work items** is in the `Ctrl+K` palette.
- **Theme:** the page loads `shared/themes.css`, Workshop's look (Schibsted Grotesk headings, Atkinson Hyperlegible Next text; Dispatch's own teal from `data-app="agents"` since Workshop 6.46.0), and `shared/theme.js`; the SDK applies theme changes. Inside the shell, the shell owns the theme and the name; opened on its own (`/apps/slate/`), the page has both.

**Flows** (Dispatch 3.0, `js/dispatch/flows.js`; plan: `claude/dispatch-flows-v1-plan.md` in the Workshop project). A flow is a named recipe that follows eng-agents' suggested flows (README, Daily use): its steps, which ones stop for you, the file each writes, and whether Tandem can run the middle hands-off. `flows.js` is the one place that defines them; Start work, the run page, the Inbox and Work all read it. A run's flow is not stored: it follows from the `.work` folder (a work item's lane, or the folder's kind).

| Flow | Steps (you = stops for you) | Starts with |
| --- | --- | --- |
| Build a feature | Set up, Spec (you), Plan (you), Tasks, Build, Review, PR text, Ship (you) | `start` (ADO item) or `start.local` |
| Fix a bug | Set up, Root cause (you), Fix, Review, PR text, Ship (you) | `start` or `start.local` |
| Quick change | Feature or bug steps, no ADO item | `start.local` |
| Investigate | Investigate, Read the findings (you) | `spike` |
| Plan an epic | Scope, Approve stories (you), Slice, Approve milestones (you), Backlog | `scope.start` |
| Write docs | Draft (you), Fact-check, Fix (you) | `docs.start` |
| Technical spec | Draft (you), Fact-check, Revise (you), Publish (you) | `tsd.start` |

Shape, Triage, Refine and Handoff stay in Slate; Work leaves their folders out.

**Tabs** (`js/dispatch/pages.js`). Four tabs, one job each, full width. The header has the tabs, the Live pill, **Start work**, and the menu (Refresh, alerts, the opencode TUI, Projects, Repos, opencode settings). Since 4.0.0 the tab names are the page's headline (each page keeps its heading for screen readers only), lists are rows inside one white surface, what needs you is a raised card, and state is a dot and words rather than a colored bar. Plan: `claude/dispatch-redesign-v1-plan.md` in the Workshop project.

- **Inbox** (the default): everything waiting on you, and only here. **Agents asking you**: every permission and question from any session, answered in place, each with where it came from and **Open**. **Ready for your review**: runs at a gate (a spec, plan or bug write-up to approve, autopilot waiting, an epic's stories or milestones, a TSD to revise or publish), each a card with whose turn it is, the flow so far, the file you are approving (the first part; **Read all** for the rest), its buttons (**Approve and build**, **Approve only**, **Approve**, **Publish**), **Send back** and **Open**. **Code reviews to do** (with **Review**), **Stopped or blocked**, and one line for teammates' PRs with no review yet. **Go through them** shows one row at a time, full width, with keys: `A` the main button, `S` send back, `N` skip, `P` previous, `O` open, `Esc` stop; a row you act on leaves the list. With nothing waiting it says so and shows **Pick up here**. The getting-set-up checklist shows here until done.
- **Chat:** see [Conversations](#conversations) below.
- **Work:** everything else in flight, every flow, as rows (status dot, flow, title, the step it is at, whose turn, its main button). A line at the top says how many things wait in the Inbox. Filters: by flow, and by project. Groups: **Starting** (a spike, epic, doc or TSD session before its folder exists, and repo guides, with the agent's questions and a reply box until dismissed), **Tandem working**, **Up next**, **Shipping** (runs at Ship whose code review is done or with the agent; Slate's merged runs first, with Remove), **Paused**, **Done** (findings to read, published specs, backlogs made).
- **Reviews:** teammates' PRs (see To review below).

**A run's page** is driven by its flow. The step track is the navigation: done steps are checked, the step it is at is filled, later ones are faint, and a ring marks the steps that stop for you. Every step is a button. The step in view (the current one by default) shows what it does, then: at the current step, autopilot, the next step and its buttons, **Send back with a note** at a gate, the PR box at Ship, the tasks at Build, the file to read (rendered, with **Open** and **Edit**), the agent session with its reply box, and where it left off; at a done step, what it wrote (the brief, spec, plan, bug write-up, review, findings), read through `file.read`; at a later step, whether it stops for you. **Repos, files and activity** are folded at the bottom. A spike's page has **Start work from this** and **Save as note**; a doc at its fact-check takes the doc's path when `/docs` did not say it; a TSD at Revise has **Edit tsd.md** and **Publish**.

**Send back with a note** (a spec, plan or bug write-up, an epic's stories or milestones): your note goes under the file's **Open questions** (written over the text just read, so nothing Tandem wrote is lost), then the step runs again (`/spec`, `/plan`, `/bug`, `/scope` or `/slice`): docs/pipeline.md, Gates. The click is the approval for both writes.

**Projects** come from the connector (`state.projects`; `project.create`, `project.update`, `project.delete`, `run.assign`). Once you have one, Work shows a filter (All projects, then each project with its count) and each run a chip that moves it. Runs with no project are in the built-in project, shown as **No project**. The filter is kept in this browser (`localStorage` key `dispatch.view`, `js/dispatch/local.js`); Dispatch 1.x's `dispatch.sidebar` key (folders and pins) is removed on load. **Projects** in the menu lists them with Edit and New project. Start work starts in the project filtered to. With an older connector that has no projects, the project controls are hidden.

**Slate tracks every run.** Starting work (Build a feature, Fix a bug, Quick change, or **Start work from this** on a spike's page) sends Slate an accepted `work` handoff (`js/dispatch/slate-handoff.js`, Workshop docs/handoffs.md), so the run has a card on Slate's board from Building to Resolved. Investigate, Plan an epic, Write docs and Technical spec do not. Each run shows **From Slate** when Slate knows it, by ADO id or run folder. Starting a spike from Chat or the hub, or an action the hub suggests, needs only its button: the click is the approval (no second confirm).

**Using Dispatch on its own** (no Docket, no terminal):

- **Getting set up:** after Workshop connects, a checklist shows until three things are done: an AI model connected to opencode (from `opencode.ai`; it shows the `opencode auth login` command and how to use Claude with an Anthropic API key), a repo in the workspace, and a first piece of work. If the AI step cannot be checked (an opencode that does not say), it is not counted as missing.
- **Start work:** pick a flow, then fill it in. Build a feature and Fix a bug take an ADO work item by number when Tandem has ADO connections (*ADO work item*), or a description (*Describe it*, the `start.local` action, no tracker); Quick change is always described. The others take one line: what to investigate, the idea, what to document, or the product or repos.
- **Repos** (menu): inside Workshop, Settings > Repos. On its own page, a sheet: repos with work in progress, *Add a repo* (clones by URL into the workspace and lists it in the repo map, `repo.add`, then offers *Draft its guide*, `repo.guide`, `/onboard-repo`) and *Draft guide* for every repo.
- Spikes, epics, docs, TSDs and repo guides started here show on Work under **Starting**, with the agent's questions and a reply box, until their folder exists or you dismiss them.

**Pull requests** (`js/dispatch/pr-reviews.js`): **Reviews** (the tab) is teammates' PRs; your own runs' PRs are on each run's Ship step, with their code reviews in the Inbox.

**To review (the Reviews tab):** first-pass reviews of your team's pull requests by Tandem's pr-reviewer agent (eng-agents `/pr-review`, Core 2.6.0). One column, no side panels.

- **Review a link:** the button in the page header (and the palette's **Review a pull request**) shows a box for any ADO PR link; the opencode connector's `pr.review` action runs `/pr-review <link>`. The repo must be cloned in the workspace. The agent reads the PR through git without checking it out.
- **Waiting on you:** the ADO connector's `sync.prs` (read-only), checked when Dispatch connects, when the page opens (if older than five minutes) and from *Check again*. One entry per PR: its review card in place once a review exists (with the PR's tier), else a row with *Review*. Reviews still starting (no `pr-<id>` folder yet) are at the top. Without the ADO connector the page says how to turn it on; review by link still works.
- **Earlier reviews:** reviews of PRs no longer waiting on you, or reviewed by link. With no inbox (ADO off or failing) the list is called Reviews.
- The **Inbox** lists the reviewer agent's questions with the rest, with **Open** to the review.
- **Review all:** queues every PR waiting on you that needs a first pass (not Waiting for author, not already reviewed at its latest commit, which `sync.prs` now sends). The opencode connector runs them one at a time, even with Dispatch closed (`pr.reviewAll`). A panel above the inbox shows progress, the PR being reviewed, and which ones were reviewed, need you, or failed, with Stop, Resume and Dismiss.
- **Nightly review:** set a time under opencode settings, PR reviews. Each check of the inbox hands the list to the connector (`pr.inbox.save`), and at that time it reviews the list, so drafts are ready when you sit down. The line under the inbox says when it runs. See the connector's README for the rules.
- **Reviews:** one card per `.work/pr-<id>`: recommendation, risk, and the draft comments (file, line, severity, why) each with *Copy comment*. A review of an older commit says so and offers *Review the new commits*. **Nothing is posted**: you paste the comments you agree with into the PR yourself.
- Reviews are not runs: they are left out of Work, projects and the run counts. The Reviews tab count is PRs waiting on you with no review yet (gate colored when the reviewer is asking you something). `#/slate/pr-<id>` opens the page at that review.

**Your runs' PRs (the Ship step):** a run at Ship with a `pr.md` has its Pull requests box on its page (code review link, title and description to copy, Create PR). Where its code review stands (`mineState`): review before you push or a revision that needs you puts it in the Inbox (**Code reviews to do**); revising, approved or pushed puts it on Work under **Shipping**. **Remove** cleans up once the PR merges.

Before the connector is ready, the page says what is wrong: browser mode, the connector off (with a button to Settings), starting, or its error message. The hub's capture box sits under it, so captures work without Tandem.

### Focus hours

With focus hours on (Settings, Focus hours; docs/focus.md) the shell hides the rail badge during focus and lunch, except the number of pull requests blocked on you during focus. Agent alerts are counted instead of shown, in Dispatch's `held` summary card, except a blocking PR's review during focus. After a focus span ends, **While you were focused** sits on top of the Inbox (or the setup page with the connector off): what every app held, runs waiting on you, and PR reviews that finished during the span, blocking ones first. Rules only (`js/dispatch/digest.js`). One card per day; Dismiss hides it until tomorrow.

### Conversations

The **Chat** tab ([docs/chat.md](../../docs/chat.md)), laid out like ChatGPT since 4.1.0: a sidebar of chats (New chat, search, grouped by Today, Yesterday, Previous 7 days and Older; rename and remove on hover; it collapses, and on a phone it is a drawer) and one chat in view, with the composer pinned at the bottom. **New chat** is the hub's box ([docs/hub.md](../../docs/hub.md)): a capture comes back as rows to accept right there, and anything else becomes a chat in the sidebar and opens, with Tandem's answer as the first turn. When Tandem asks something in a chat, it is answered right there (and it is in the Inbox too). Plan: `claude/chat-layout-v1-plan.md` in the Workshop project.

### Code review

`review.html` is a read-only, VS Code style review of one repo of a work item, for the step before Push. The reviewer reads the diff, comments on lines, and approves or sends every comment to the agent as one revision. Data: the opencode connector's `review.session`, `review.file` and `review.submit` actions and its `review` event ([connectors/opencode/README.md](../../connectors/opencode/README.md), Code review).

- **Open it:** `review.html?id=<work item id>&repo=<repo folder>`; with no `repo`, the first repo in `pr.md`. `review.html?mock=1` is a sample review with no agent (`js/dispatch/review-api.js` `mockReviewApi`, data in `js/dispatch/review-fixture.js`); it also plays the agent, so Request changes comes back as revision 2.
- **From Dispatch:** a ready-to-ship item's PR card shows **Review** where Push used to be, for each repo whose branch is not pushed, with where its review stands (`state.reviews`): not started, revision N, the agent is revising (or needs you), or approved. Dispatch has no Push button of its own while connected, so nothing is pushed before Approve, and Approve itself pushes nothing. Not connected, the card still shows the push command to copy.
- **Layout:** files on the left (status badge, +/- counts, draft comment count), the Monaco diff in the middle (side by side or inline; inline on small screens), the Review panel on the right (collapsible). The top bar has the title, branch, base, revision, file count, a repo switcher when `pr.md` has more than one repo, and Back to Dispatch.
- **Comments:** hover a line number for **+**; click it, shift-click another, or drag, to pick lines on one side of one file; `C` comments on the cursor line or selection. The box opens under the last line: type (Must fix, the default; Suggestion; Question), text, and Suggest change, which prefills the selected lines to edit. `Ctrl`/`Cmd`+`Enter` saves, `Esc` cancels. Saved comments are cards under their lines (click to open, edit or delete) with a marker in the gutter. The hash names the selection: `#file=src/x.ts&L=12-18`, plus `&side=old` for removed code. In the inline view, comments go on the new code.
- **Drafts:** kept in `localStorage` per work item, repo and revision (`dispatch.review.<id>.<repo>.r<n>`), so a refresh loses nothing. If the browser will not save them, the panel says so.
- **Submit:** Request changes needs a comment or a summary and sends one `ReviewFeedback`. `quotedCode` is read from the files at the reviewed commits when you submit, so it always matches what the agent will see. **Approve** records the verdict (no line comments; with drafts open it asks before discarding them) and pushes nothing. **Push to origin** (with the **git** mark) then asks first in the shared outside confirm (**Changes the git remote.**, the repo and branch, Cancel focused) and only its **Push** runs the connector's `push`. If the push fails, the verdict stays and **Push to origin** tries again. A `conflict` (the branch moved, or the review changed) keeps the draft and reloads.
- **Round 2 and later:** the last round's comments show dimmed in the panel with the agent's answer (Fixed, Declined, Answered) and its note, and a link to their lines. **Changes since last review** shows only what the agent committed since then.
- **Monaco:** a trimmed copy of 0.57 in `vendor/monaco/` (5.7 MB; see its README), loaded only by this page and precached with the app. `scripts/vendor-monaco.mjs` writes it and the `files` list in `app.json`. No language services: syntax colors only, so there are no error squiggles from code with no project around it.

### Files

| File | What |
| --- | --- |
| `js/dispatch/flows.js` | The flows: their steps, which stop for you, where a run is, what waits on you, whose turn, sending a draft back. HTML strings, tested in Node. |
| `js/dispatch/pages.js` | The tabs (Inbox and Go through them, Work, a run's page) and the tab bar. HTML strings, tested in Node. |
| `js/dispatch/view.js` | The header, sheets and the pieces the tabs draw (track, next step, agent box, PR box), as HTML strings, from the state. Ported from eng-agents `core/scripts/dashboard/dashboard.template.html` at `e2d202a` (Dashboard 1.6.1, live mode). No DOM, so it is tested in Node. |
| `js/dispatch/doc.js` | The `.work` file sheet: a safe Markdown renderer for Preview, the read-only reason while Tandem works, and the Notebook route. No DOM. |
| `js/dispatch/main.js` | SDK connection, fetching, painting, clicks, alerts, focus. |
| `js/dispatch/state.js` | The state the view reads. |
| `js/dispatch/projects.js` | Projects: the filter, the project chip, run status, and the project, Projects and move sheets. HTML strings, tested in Node. |
| `js/dispatch/pr-reviews.js` | Reviews (link box, Review all, Waiting on you, Earlier reviews) and where your runs' PRs stand. HTML strings, tested in Node (`test/pr-reviews.test.mjs`). |
| `js/dispatch/hub.js`, `js/dispatch/hub-model.js` | The hub, Chat's New chat box ([docs/hub.md](../../docs/hub.md)). A message that is not a capture or go becomes a chat ([docs/chat.md](../../docs/chat.md)). |
| `js/dispatch/chat.js` | The Chat tab: the sidebar of chats, one chat in view, and New chat (the hub's element). Its own element, moved into the page by `main.js` so typing survives repaints. |
| `js/dispatch/thread.js` | Turns, the last answer, the sidebar's day groups and search, and keeping focus through a repaint. Tested in Node. |
| `js/dispatch/local.js` | The project filter in this browser: clean, load, save, prune. |
| `js/dispatch/slate-handoff.js` | The `work` handoff to Slate for a started run: the offer (tested in Node) and the write to Dispatch's `handoffs`. |
| `agents.css` | The template's styles, minus the theme block and update checks. |
| `review.html`, `review.css` | The code review page and its styles. |
| `js/dispatch/review.js` | Code review: SDK connection, Monaco, line selection, comment boxes, drafts, submit. |
| `js/dispatch/review-state.js` | Code review logic with no DOM: the hash, selection, drafts, the payload, the file tree. Tested in Node. |
| `js/dispatch/review-view.js` | Code review HTML strings: top bar, files, banners, comment boxes, the panel. Tested in Node. |
| `js/dispatch/review-api.js`, `js/dispatch/review-fixture.js` | The connector calls, and `mockReviewApi` with its three-file sample. |
| `js/dispatch/review-monaco.js` | Loads `vendor/monaco` once, with a same-origin editor worker (the page's CSP refuses Monaco's `blob:` worker). |

What changed from the template: live mode only (eng-agents' `/dashboard static` keeps the static page); no update checks (connectors make none); no theme menu or brand inside the shell; files open in the app instead of a `/files/` link; links that are not `http(s)` are not links.

### Tests

```
node --test "apps/agents/test/*.test.mjs"
python tests/e2e.py
python tests/review-e2e.py
```

- `test/view.test.mjs`: the page-only items from [connectors/opencode/PARITY.md](../../connectors/opencode/PARITY.md), on `test/fixtures/state.json`, a `state` result from the connector for `docs/examples/work` (synthetic).
- `test/flows.test.mjs`: the presets against eng-agents' flows, where each kind of folder is, what waits in the Inbox, the file to read at a gate, sending back with a note, docs' fact-check, whose turn, and Go through them.
- `test/projects.test.mjs`: the project filter, chips, run status, starting in a project, the sheets, and the browser-only filter.
- `test/review.test.mjs`: the code review's logic, HTML and mock API.
- `tests/review-e2e.py`: the code review page in Chromium against the mock, under the page's real CSP: ranges, the box, markers, the panel, drafts after a refresh, the payload, revision 2, a stale head, approve, deep links, theme.
- `test/fixture.mjs`: a synthetic workspace and a fake opencode for `tests/e2e.py` part 5, which runs the app against the real agent and connector: the tabs, the Inbox with its files and Go through them, the run page, prompts in the Inbox, Push, Remove, the flow picker, deep links, theme, projects, and Prioritizer's stages and Start.

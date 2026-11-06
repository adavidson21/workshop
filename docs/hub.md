# Hub

The hub is one input for everything: capture a task, receipt, note or roadmap idea, ask a question about your repos or your work, go to an app, or start an action. It lives on Dispatch's Chat tab (Ask or capture) and is answered by Tandem's `/hub` command (eng-agents Core 2.9.0) through the opencode connector. Home has a quick capture box that needs no AI and sends questions to the hub. The same box opens from any app as the shell's **Capture** bar (the top bar's Capture button, or `Ctrl+.`; `shell/capture.js`): it is Home's quick capture, saved to `home.handoffs`, and its questions open the hub here.

This contract covers the two files Workshop and Tandem pass between them, `request.md` and `route.json`, and how captures reach other apps.

Version: `route.json` is version 1.

## Flow

1. The person types in the hub and presses Enter. Enter counts as the click for `confirm: true`.
2. Dispatch calls the opencode connector's `hub.run` (`write: true`, it starts an agent). The connector writes `request.md` in its own folder, `<Workshop home>/data/_connectors/opencode/hub/<id>/`, never in the workspace or `.work`, and runs `/hub <path to request.md>` in a new session.
3. Tandem's **hub** agent writes `route.json` next to it. For a question it goes on to answer and writes `answer.md`.
4. Dispatch reads both through `hub.result`, checks `route.json` against [schemas/hub-route.schema.json](schemas/hub-route.schema.json), and shows the result. Anything that does not match is dropped, never acted on.

Both connector actions refuse unless the opencode connector's **Hub** setting (`hub` in its config, off by default) is on. Connector settings can only be changed from Workshop on this computer, never from a hosted page. Details: `connectors/opencode/README.md`.

## request.md

Plain Markdown that Tandem reads. Written by the connector from what Dispatch sends.

```
# Hub request

Date: 2026-11-03

## Message

dont forget about the onboarding doc for person one

## People

- p_one: Person One @person (report, on my team)
- p_mgr: Person Two @two (manager)
- g_lead: Leadership @leadership (group: Person One, Person Two)

## Docket lists

- Inbox
- This sprint
```

| Section | Holds |
| --- | --- |
| `Date` | Today, `YYYY-MM-DD`. |
| `Message` | What the person typed, up to 4000 characters. |
| `People` | The people directory ([people.md](people.md)): id, name, handle, and relation and team for people or members for groups. Archived items left out. |
| `Docket lists` | Docket's list names, so a capture can name one. From the `targets` card with `capture: "task"` in Docket's summary ([summaries.md](summaries.md)). |

Sections with nothing in them say `None.` Nothing else goes in: no Rapport entries, task bodies or ADO content. Product and repo names come from the workspace repo map, which Tandem already loads.

## route.json

Written by the hub agent. Schema: [schemas/hub-route.schema.json](schemas/hub-route.schema.json). Examples: [examples/hub-route.capture.json](examples/hub-route.capture.json), [examples/hub-route.ask.json](examples/hub-route.ask.json), [examples/hub-route.clarify.json](examples/hub-route.clarify.json).

```json
{
  "version": 1,
  "intent": "capture",
  "proposals": [
    {
      "to": "prioritizer",
      "text": "Onboarding doc for Person One",
      "payload": {"kind": "task", "title": "Onboarding doc for Person One", "who": ["p_one"], "value": 3},
      "confidence": 0.8,
      "reason": "A reminder about a report, no date given"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1`. |
| `intent` | `capture`, `ask`, `go`, `act` or `clarify`. Only the field for that intent is read. |
| `proposals` | `capture`: 1 to 20 items, each in the shape of a handoff to that app ([handoffs.md](handoffs.md), Receivers): `to` (`prioritizer`, `receipts` or `notes`), `text`, `payload`, plus `confidence` (0 to 1) and a short `reason`. |
| `ask` | `ask`: `repos`, the repo folders it looked in (may be empty for a question about Workshop data or `.work`). The answer is `answer.md`. |
| `go` | `go`: `{app, path?}`, same as the SDK's `ws.open`. |
| `act` | `act`: `{connector, action, args, label}`. Shown as a button with its confirm. Never run on its own. |
| `clarify` | `clarify`: `{question, choices}`, up to 4 short choices. |

## answer.md

Markdown: the short answer first, then lines marked **Confirmed** (with a file and line) or **Suspected**, then a confidence. Agent text is untrusted: Dispatch escapes it and makes only `http(s)` links clickable.

## Captures

The person reviews each proposal in the hub (or quick capture on Home) and accepts it with Enter, a click, or Accept all. Each accepted proposal is written to the capturing app's own `handoffs` collection (`agents.handoffs` or `home.handoffs`) with `accepted: true` ([handoffs.md](handoffs.md), rule 4). Docket, Rapport, Notes and Runway add it when they next load. No app writes another app's data.

Roadmap ideas (`p <text>`, or `p <roadmap>: <text>` to name one of Runway's roadmaps) are rules only: Tandem does not propose them. A named roadmap gets the idea in its Unscheduled tray; anything else waits on Runway's Pending assignment list.

Notes go to Quick Notes (Home) or Notes' `inbox/` (Dispatch). `n <folder>: <text>` with one of Notes' folders makes a new note in that folder, and `n today: <text>` adds the text under `## Notes` in today's note. The folder names come from Notes' `targets` card ([summaries.md](summaries.md)); case and a dash versus a space don't matter, and the start of exactly one folder name is enough. A name no folder has is part of the text, so `n Remember: call the vendor` stays as typed. The review line says where it goes (`Notes · runbooks/ · new note "..."`, `Notes · today's note`).

### Which app takes a capture

Each capture kind (`task`, `waiting`, `receipt`, `note`, `idea`) goes to the app whose manifest lists it in `capture` ([app-manifest.md](app-manifest.md)), first by `order`. Quick capture and the hub find them with `ws.apps.list()` ([sdk.md](sdk.md)). The parsing rules for each kind stay in `shared/capture.js`; an app takes a kind by accepting that payload as a handoff ([handoffs.md](handoffs.md), Receivers). When no app takes a kind, its prefix is not recognized and the line is a task. Outside Workshop's site (no app list) the built-in targets are used: `task` and `waiting` to Docket, `receipt` to Rapport, `note` to Notes, `idea` to Runway.

`> <place>` matches an app's `id`, `name` or one of its `aliases`.

## Rules

1. **Local only.** A capture fills fields on a record inside Workshop. Nothing in the hub assigns, creates or changes anything in Azure DevOps, git or a running agent by itself. `act` is a button the person clicks, and the action it calls keeps its own `confirm: true`.
2. **Read-only agent.** The hub agent may write only `route.json` and `answer.md` in the request folder, cannot fetch web pages, and runs only read-only shell commands.
3. **Repair, validate, then show.** Dispatch first drops what the schema does not have (unknown fields, fields for another intent, proposals that do not fit) and reads `"version": "1"` as `1`; the connector reads `route.json` inside a code fence. It never changes an intent, target, connector or action. What still fails the schema is not acted on: the card shows `answer.md`, or what the session last said, and that the routing did not match. A hub session that stops with an error shows it on its card; one that asks you something is answered on the card or in Dispatch's Inbox.
4. **Follow-ups are conversations.** Replies under a hub card go to Tandem's read-only chat agent in the same session ([chat.md](chat.md)).
5. **Escape everything.** Proposal text, reasons, questions, choices and answers are user or agent text.

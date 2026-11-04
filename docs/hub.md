# Hub

The hub is one input for everything: capture a task, receipt or note, ask a question about your repos or your work, go to an app, or start an action. It lives on the Dispatch page and is answered by Tandem's `/hub` command (eng-agents Core 2.9.0) through the opencode connector. Home has a quick capture box that needs no AI and sends questions to the hub.

This contract covers the two files Workshop and Tandem pass between them, `request.md` and `route.json`, and how captures reach other apps.

Version: `route.json` is version 1.

## Flow

1. The person types in the hub and presses Enter. Enter counts as the click for `confirm: true`.
2. Dispatch calls the opencode connector's `hub.run` (`write: true`, it starts an agent). The connector writes `request.md` in its own folder, `<Workshop home>/data/_connectors/opencode/hub/<id>/`, never in the workspace or `.work`, and runs `/hub <path to request.md>` in a new session.
3. Tandem's **hub** agent writes `route.json` next to it. For a question it goes on to answer and writes `answer.md`.
4. Dispatch reads both through `hub.result`, checks `route.json` against [schemas/hub-route.schema.json](schemas/hub-route.schema.json), and shows the result. Anything that does not match is dropped, never acted on.

Both connector actions refuse unless the local-only setting `features.hubAI` is on (off by default). Details: `connectors/opencode/README.md`.

## request.md

Plain Markdown that Tandem reads. Written by the connector from what Dispatch sends.

```
# Hub request

Date: 2026-11-03

## Message

dont forget about the onboarding doc for person one

## People

- p_one: Person One (report, on my team)
- p_mgr: Person Two (manager)

## Docket lists

- Inbox
- This sprint

## Queue areas

- Project\Team
```

| Section | Holds |
| --- | --- |
| `Date` | Today, `YYYY-MM-DD`. |
| `Message` | What the person typed, up to 4000 characters. |
| `People` | The people directory ([people.md](people.md)): id, name, relation, team. Archived people left out. |
| `Docket lists` | Docket's list names, so a capture can name one. |
| `Queue areas` | Queue's team area paths. |

Sections with nothing in them say `None.` Nothing else goes in: no Receipts entries, task bodies or ADO content. Product and repo names come from the workspace repo map, which Tandem already loads.

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
      "payload": {"kind": "task", "title": "Onboarding doc for Person One", "people": ["Person One"], "value": 3},
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

The person reviews each proposal in the hub (or quick capture on Home) and accepts it with Enter, a click, or Accept all. Each accepted proposal is written to the capturing app's own `handoffs` collection (`agents.handoffs` or `home.handoffs`) with `accepted: true` ([handoffs.md](handoffs.md), rule 4). Docket, Receipts and Notes add it when they next load. No app writes another app's data.

## Rules

1. **Local only.** A capture fills fields on a record inside Workshop. Nothing in the hub assigns, creates or changes anything in Azure DevOps, git or a running agent by itself. `act` is a button the person clicks, and the action it calls keeps its own `confirm: true`.
2. **Read-only agent.** The hub agent may write only `route.json` and `answer.md` in the request folder, cannot fetch web pages, and runs only read-only shell commands.
3. **Validate, then show.** `route.json` that fails the schema shows as "The hub could not read the answer" with a link to the session in Dispatch.
4. **Escape everything.** Proposal text, reasons, questions, choices and answers are user or agent text.

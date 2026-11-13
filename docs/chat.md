# Conversations with Tandem (hub threads and the Chat tab)

Dispatch lets you talk to Tandem (eng-agents on opencode) directly: follow up on a hub answer, or start a chat. Both use Tandem's read-only **chat** agent (eng-agents Core 2.14.0) through the opencode connector's `chat.*` actions. Plan: `claude/conversations-v1-plan.md` in the Workshop project.

## Where they show

- **Chat tab** (routes `#/agents/chat` for New chat, `#/agents/chat/<session>` for one chat), laid out like ChatGPT since Dispatch 4.1.0. A sidebar of chats: **New chat**, search (titles), the list grouped by Today, Yesterday, Previous 7 days and Older, with Rename and Remove on each row. The sidebar collapses (kept in this browser as `dispatch.chatSide`); on a phone it is a drawer. One chat in view, messages in a centered column, the composer pinned at the bottom.
- **New chat** is the hub's box. Every first message goes through `/hub`, so one box still captures: a capture (or go) is handled right there and is not listed. Anything else (a question, a suggested action, a choice, or a run that ended without a route) becomes a chat: listed in the sidebar right away and opened, with the hub's answer as Tandem's first turn. Follow-ups go to the hub message's own opencode session, so Tandem keeps the context. Chats started before Dispatch 2.0 are listed too. Automated work (runs, PR reviews) never shows here.
- **Questions in a thread.** When Tandem asks a permission or a question in a hub card's or a conversation's session, it is answered right there, with the same controls as Dispatch's Inbox (which lists it too).

## Rules

1. **Read only.** Every message names `agent: "chat"`. The chat agent cannot write any file, fetch web pages, or run anything but read-only commands (`git log`, `git show`, `git grep`, `git ls-files`, `rg`, listing and reading files). Without the agent name opencode would use its default agent, which can edit code.
2. **One AI switch.** Every `chat.*` action is refused unless the opencode connector's **Hub** setting is on (the sparkle button on the hub).
3. **Starting work is a button.** Make it a spike asks for a confirm and calls `spike`; Save as note goes to Notes as a handoff ([handoffs.md](handoffs.md)).
4. **Only Dispatch's conversations.** `chat.send` and `chat.messages` refuse sessions the connector did not start as a hub message or a chat.
5. **Escape everything.** Your turns render as text; Tandem's as escaped Markdown with code, bold, lists, headings and http(s) links only.

## Connector actions

| Action | Write | Args | Result |
| --- | --- | --- | --- |
| `chat.start` | yes | `text` | `{session}`: a new session, first message to the chat agent. Dispatch 2.0 starts conversations from the hub instead; the action stays for other callers |
| `chat.send` | yes | `session`, `text` | `{ok}`. 409 while Tandem is still answering |
| `chat.messages` | no | `session` | `{session, from, title, busy, waiting, error?, turns: [{role: "you" \| "tandem", text, at}]}`. Text only; a hub thread leaves out the /hub run itself |
| `chat.list` | no | optional `hubs` | `{items}`: chats and every hub message that is not a capture or go (since connector 1.9.0; before, only followed-up hub threads), newest activity first; with `hubs: true`, the 12 newest hub threads |
| `chat.remove` | no | `session` | Stops listing it in the Chat tab. The opencode session is kept |
| `chat.rename` | no | `session`, `title` | `{ok, title}`: renames it in the Chat tab's list (since 1.9.0). The opencode session keeps its own title |

The list lives in `<Workshop home>/data/_connectors/opencode/chats.json` (mode 0600, newest 100). Each hub entry keeps its intent once `hub.result` reads the route (older entries: read from the request's `route.json`), so captures and go stay out of the list. The turns stay in opencode.

# Conversations with Tandem (hub threads and the Chat tab)

Dispatch lets you talk to Tandem (eng-agents on opencode) directly: follow up on a hub answer, or start a chat. Both use Tandem's read-only **chat** agent (eng-agents Core 2.14.0) through the opencode connector's `chat.*` actions. Plan: `claude/conversations-v1-plan.md` in the Workshop project.

## Where they show

- **Hub threads.** A hub card that is not a capture gets a reply box. Follow-ups go to the hub message's own opencode session, so Tandem keeps the context; the turns show under the answer. Asks come back after a reload; captures do not, so nothing is accepted twice.
- **Chat tab** (Dispatch sidebar, Conversations, Chat; route `#/agents/chat/<session>`). Chats you started (**You started**) and hub threads you followed up on (**From the hub**). Automated work (runs, PR reviews, the hub's routing) never shows here.

## Rules

1. **Read only.** Every message names `agent: "chat"`. The chat agent cannot write any file, fetch web pages, or run anything but read-only commands (`git log`, `git show`, `git grep`, `git ls-files`, `rg`, listing and reading files). Without the agent name opencode would use its default agent, which can edit code.
2. **One AI switch.** Every `chat.*` action is refused unless the opencode connector's **Hub** setting is on (the sparkle button on the hub).
3. **Starting work is a button.** Make it a spike asks for a confirm and calls `spike`; Save as note goes to Notes as a handoff ([handoffs.md](handoffs.md)).
4. **Only Dispatch's conversations.** `chat.send` and `chat.messages` refuse sessions the connector did not start as a hub message or a chat.
5. **Escape everything.** Your turns render as text; Tandem's as escaped Markdown with code, bold, lists, headings and http(s) links only.

## Connector actions

| Action | Write | Args | Result |
| --- | --- | --- | --- |
| `chat.start` | yes | `text` | `{session}`: a new session, first message to the chat agent |
| `chat.send` | yes | `session`, `text` | `{ok}`. 409 while Tandem is still answering |
| `chat.messages` | no | `session` | `{session, from, title, busy, waiting, error?, turns: [{role: "you" \| "tandem", text, at}]}`. Text only; a hub thread leaves out the /hub run itself |
| `chat.list` | no | optional `hubs` | `{items}`: chats and followed-up hub threads, newest activity first; with `hubs: true`, the 12 newest hub threads |
| `chat.remove` | no | `session` | Stops listing it in the Chat tab. The opencode session is kept |

The list lives in `<Workshop home>/data/_connectors/opencode/chats.json` (mode 0600, newest 100). The turns stay in opencode.

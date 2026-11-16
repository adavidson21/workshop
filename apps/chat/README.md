# Chat

Ask Tandem about your repos and work, or capture a task, receipt or note in plain words. One box: a capture comes back as rows to accept, a place opens the app, and anything else becomes a chat in the sidebar. Tandem's `chat` agent is read only: it reads code, repo guides, product notes and `.work`, and changes nothing. Starting work is a button with a confirm.

**Chat 1.0.0** moves Loom's Chat tab and the hub into their own app on the rail (Loom 4.8.0). Contracts: [docs/chat.md](../../docs/chat.md) and [docs/hub.md](../../docs/hub.md). Captures go to this app's own `handoffs` collection; Docket, Rapport, Folio, Runway and Loom add them when they next load ([docs/handoffs.md](../../docs/handoffs.md)). When Tandem asks you something in a chat, Loom's Inbox has it.

The top bar's **Capture** is the quick add (rules only, no AI); Chat is where you ask.

## Routes

- `#/chat`: New chat
- `#/chat/hub/<text>`: ask or capture `<text>` (Capture's "ask" and Loom's old `hub/<text>` route land here)
- `#/chat/<session>` or `#/chat/chat/<session>`: one chat

## Tests

```
node --test "apps/chat/test/*.test.mjs"
```

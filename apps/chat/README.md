# Chat

opencode with a better screen. **Chat 2.0.0** works like the opencode TUI, so you can use it instead of opening opencode: pick any agent (Tab cycles them) and model, `/` for commands (yours and Tandem's), `@` for workspace files, `!` for a shell command, undo and redo, compact, and every opencode session in the workspace under **All sessions**. Tool calls, diffs, thinking and to-dos show in the thread, and permission prompts are answered right there. opencode's own permission settings decide what an agent may do, as in the terminal. Since **Chat 2.2.0** there is no separate AI switch: Chat works whenever the opencode connector is on (turn the connector off in Settings to stop it). Contract: [docs/chat.md](../../docs/chat.md).

The **Hub** agent (first in New chat's list) is the one box that asks Tandem or captures a task, receipt or note in plain words: a capture comes back as rows to accept, a place opens the app, and anything else becomes a chat. A hub thread's follow-ups go to Tandem's read-only `chat` agent unless you pick another.

**Chat 1.0.0** moves Loom's Chat tab and the hub into their own app on the rail (Loom 4.8.0). Contracts: [docs/chat.md](../../docs/chat.md) and [docs/hub.md](../../docs/hub.md). Captures go to this app's own `handoffs` collection; Docket, Rapport, Folio, Runway and Loom add them when they next load ([docs/handoffs.md](../../docs/handoffs.md)). When opencode asks you something in a chat, answer it in the chat (Loom's Inbox lists it too).

**Chat 1.1.0** adds **Rewrite a draft** (moved from Settings, Writing): paste a draft, pick the audience and reader, get one version in your voice, then say Sent as is, I changed it or Didn't use. Your samples, style guide and rules stay in Settings, Writing; your answers go to this app's `writing-feedback` collection and Settings learns from them ([docs/writing.md](../../docs/writing.md)).

**Chat 2.2.0** makes Rewrite a draft part of New chat instead of a screen of its own: pick **Rewrite** in the composer's agent picker (after Hub; Tab cycles to it), or use the Rewrite a draft command or `#/chat/rewrite`. Your drafts and their rewrites show as turns, For and Reader sit in the composer's bar, and each rewrite has its own Copy and feedback. New chat goes back to chatting.

**Chat 2.3.0** is a cleaner page. The sidebar is New chat, search with an **All** toggle (every opencode session), and the list. Under the last answer, one **Start work...** button opens the flow cards and Save as note. Your messages name the agent only when it changed. Hub uses the same composer at the bottom as every agent (Tab cycles out of it), with its captures just above the box. The key hints show only in New chat.

The top bar's **Capture** is the quick add (rules only, no AI); Chat is where you ask.

## Routes

- `#/chat`: New chat
- `#/chat/hub/<text>`: ask or capture `<text>` (Capture's "ask" and Loom's old `hub/<text>` route land here)
- `#/chat/rewrite`: New chat on Rewrite
- `#/chat/<session>` or `#/chat/chat/<session>`: one chat, or any opencode session in the workspace

## Tests

```
node --test "apps/chat/test/*.test.mjs"
```

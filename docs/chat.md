# Chat: opencode in Workshop

The Chat app (`apps/chat`, its own rail app since Loom 4.8.0; before that Loom's Chat tab) is opencode with a better screen. Since **Chat 2.0.0** (opencode connector 1.15.0) it works like the opencode TUI and can replace opening opencode in a terminal: any agent and model, slash commands, `@` files, `!` shell commands, undo and redo, compact, every session in the workspace, and tool calls, diffs, thinking, to-dos and permission prompts right in the thread. The **Hub** agent keeps the one box that asks Tandem or captures a task, receipt or note ([hub.md](hub.md)). Plans: `claude/conversations-v1-plan.md` and `claude/chat-opencode-v1-plan.md` in the Workshop project.

## Where things are

- **Sidebar.** New chat, search (titles), the list grouped by Today, Yesterday, Previous 7 days and Older, with Rename and Remove on each row. **Chats** lists the chats you started, hub threads, and sessions you continued from All sessions. **All sessions** adds every top-level opencode session in the workspace (runs, PR reviews, the terminal), like the TUI's `/sessions`; open one and send a message to continue it there, which lists it under Chats. The sidebar collapses (`dispatch.chatSide` in this browser); on a phone it is a drawer.
- **The chat in view.** Turns in a centered column. Your turns show the agent they went to and any attached files. opencode's answer is one block per turn: text as Markdown (code blocks with Copy, tables, lists), **Thinking** folded, each tool call as a line you can open (output, or the diff for edits; diffs and failures open by default), to-dos as a checklist, a subagent's call with **Open** to read its session. Under it: agent, model, tokens and cost. The header has Undo, Redo (after an undo), Compact, Open in the opencode terminal, and Stop while it works, plus the context size and cost by the composer.
- **The composer.** An **agent** picker and a **model** picker (Default model leaves it to the agent or opencode). Pickers remember your last choice in this browser and each chat keeps its own.
- **New chat.** The same composer. Its agent list starts with **Hub**, which swaps in the hub's box: a capture (or go) is handled right there and is not listed; anything else becomes a chat with the hub's answer as the first turn. The top bar's Capture "ask" (`#/chat/hub/<text>`) always opens on the Hub.

## Keys and what you can type

| Type or press | Does |
| --- | --- |
| Enter, Shift+Enter | Send, new line |
| Tab, Shift+Tab | Next or previous agent (as in the TUI) |
| `/` | Commands: Chat's own (`/new`, `/undo`, `/redo`, `/compact`, `/models`, `/agents`, `/sessions`, `/export`, `/terminal`, `/details`, `/help`) and every opencode command (yours and Tandem's). `//` sends a message that starts with `/` |
| `@` | Workspace files (opencode's file search); picked files go with the message |
| `!command` | A shell command run through opencode in the workspace (its shell mode) |
| Up (empty box) | Your last message |
| Esc twice | Stop opencode |

A message sent while opencode is working waits in a queue under the thread and goes when it is done (Stop clears the queue). Undo takes back your last message and its file changes and puts its text back in the box; the turns stay hidden until Redo, and your next message drops them, as in the TUI.

## Rules

1. **opencode decides what an agent may do.** Chat sends each message to the agent you picked (none named: opencode's default agent) with the model you picked. opencode's own permission settings apply exactly as in the terminal; when it asks, the prompt shows in the chat (Allow once, Always allow, Reject) and in Loom's Inbox. Questions from an agent are answered in the chat too. Subagents' prompts show in their parent chat.
2. **Hub threads stay read only by default.** A hub thread's follow-ups go to Tandem's read-only `chat` agent (eng-agents Core 2.14.0) unless you pick another agent.
3. **Nothing happens on its own.** opencode acts only on a message, a command or a click. Make it a spike asks for a confirm; Save as note goes to Notes as a handoff ([handoffs.md](handoffs.md)).
4. **One AI switch.** Every `chat.*` action is refused unless the opencode connector's **Hub** setting is on (the sparkle button on the Hub's box). With it off, New chat is the Hub's box, which still captures with simple rules.
5. **Workspace only.** Sessions are the workspace's; `@` files must be inside the workspace (the connector checks). Long tool output is cut (start and end kept) and workspace paths are shown relative to it.
6. **Escape everything.** Your turns render as text; opencode's as escaped Markdown (`apps/chat/js/md.js`) with code, bold, italics, lists, tables, quotes and http(s) links only.

## Connector actions

| Action | Write | Args | Result |
| --- | --- | --- | --- |
| `chat.options` | no | | `{kind, version, agents, subagents, models, defaults, commands, can: {shell, undo, compact, files}}`. Agents are opencode's primary agents (hidden ones left out); models are those of connected providers |
| `chat.start` | yes | `text`, optional `agent`, `model: {provider, id}`, `files` | `{session}`: a new session with its first message |
| `chat.send` | yes | `session`, `text`, optional `agent`, `model`, `files` | `{ok}`. 409 while opencode is still working (Chat queues instead). Any session in the workspace; sending in one from All sessions lists it |
| `chat.command` | yes | `name`, optional `session`, `args`, `agent`, `model` | `{session}`: runs `/name args`, in a new chat when there is no session. Returns at once; an error from opencode shows on the chat |
| `chat.shell` | yes | `command`, optional `session`, `agent`, `model` | `{session}`: `!command` through opencode, as above |
| `chat.undo` | yes | `session` | `{ok, text}`: reverts the last message not yet undone (and its file changes); `text` is that message |
| `chat.redo` | yes | `session` | `{ok}`: brings back what undo took back |
| `chat.compact` | yes | `session`, optional `model` | `{ok}`: opencode summarizes the session (the chat's last model when none is given) |
| `chat.files` | no | `query` | `{files}`: up to 50 workspace paths for `@` |
| `chat.messages` | no | `session` | `{session, from, title, listed, busy, waiting, prompts, activity, revert, parent, agent, model, totals: {cost, context}, error?, turns}`. Each turn: `{id, role: "you" \| "tandem", text, at, agent, model, tokens, cost, error, parts}` (parts: `connectors/opencode/lib/chat-parts.mjs`). A hub thread leaves out the /hub run itself. `prompts` are the permission prompts and questions of the session and its subagents, answered with the connector's `answer` action |
| `chat.list` | no | optional `hubs`, `all` | `{items}`: chats, hub messages that are not a capture or go, and continued sessions, newest activity first; with `all: true` also every other top-level session in the workspace (`from: "opencode"`); with `hubs: true`, the 12 newest hub threads |
| `chat.remove` | no | `session` | Stops listing it. The opencode session is kept |
| `chat.rename` | no | `session`, `title` | `{ok, title}`: renames it in Chat's list. The opencode session keeps its own title |

Stop is the connector's `abort` action, and Open in the opencode terminal its `terminal` action. The list lives in `<Workshop home>/data/_connectors/opencode/chats.json` (mode 0600, newest 100). Each hub entry keeps its intent once `hub.result` reads the route (older entries: read from the request's `route.json`), so captures and go stay out of the list. The turns stay in opencode.

## opencode versions

Everything above is built on opencode 1.x's server API (`opencode serve`): `prompt_async` with `agent`, `model` and file parts, `/command`, `/shell`, `/revert`, `/unrevert`, `/summarize`, `/find/file`, `/agent` and `/provider`. The 2.x background service adapter reads the same things from its `/api` routes where they are known, and reads messages loosely; any 2.x route it does not have shows opencode's own error in the chat.

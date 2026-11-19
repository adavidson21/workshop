# Chat: opencode in Workshop

The Chat app (`apps/chat`, its own rail app since Loom 4.8.0; before that Loom's Chat tab) is opencode with a better screen. Since **Chat 2.0.0** (opencode connector 1.15.0) it works like the opencode TUI and can replace opening opencode in a terminal: any agent and model, slash commands, `@` files, `!` shell commands, undo and redo, compact, every session in the workspace, and tool calls, diffs, thinking, to-dos and permission prompts right in the thread. The **Hub** agent keeps the one box that asks Tandem or captures a task, receipt or note ([hub.md](hub.md)). Since **Chat 4.0.0** (opencode connector 1.27.0) it also has the workspace basics Claude's desktop app keeps beside a conversation, in a **workbench** panel: a real **Terminal**, **Files** to browse and edit the workspace, and **Side chats** that use the chat's context without adding to it; and you can paste or drop **pictures** into a message. Plans: `claude/conversations-v1-plan.md`, `claude/chat-opencode-v1-plan.md` and `claude/chat-workbench-v1-shipped.md` in the Workshop project.

## Where things are

- **Sidebar.** New chat, search (titles), the list grouped by Today, Yesterday, Previous 7 days and Older, with Rename and Remove on each row. **Chats** lists the chats you started, hub threads, and sessions you continued from All sessions. The **All** toggle beside search (All sessions) adds every top-level opencode session in the workspace (runs, PR reviews, the terminal), like the TUI's `/sessions`; open one and send a message to continue it there, which lists it under Chats. The sidebar collapses (`dispatch.chatSide` in this browser); on a phone it is a drawer.
- **The workbench.** Three buttons at the right of the header (Terminal, Files, Side chat) open a panel beside the chat (`js/bench.js`); its tabs switch between them, and its left edge drags to resize it. Open or closed, the tab and the width are kept in this browser. In half a screen (under 1100px) the chat list steps aside while it is open; on a phone it covers the chat. See The workbench below.
- **The chat in view.** Turns in a centered column. Your turns show the agent they went to and any attached files. opencode's answer is one block per turn: text as Markdown (code blocks with Copy, tables, lists), **Thinking** folded, each tool call as a line you can open (output, or the diff for edits; diffs and failures open by default), to-dos as a checklist, a subagent's call with **Open** to read its session. Under it: agent, model, tokens and cost. The header has Undo, Redo (after an undo), Compact, Open in the opencode terminal, and Stop while it works, plus the context size and cost by the composer.
- **The composer.** An **agent** picker and a **model** picker (Default model leaves it to the agent or opencode). Pickers remember your last choice in this browser and each chat keeps its own.
- **New chat.** The same composer. Its agent list starts with **Hub**, which swaps in the hub's box: a capture (or go) is handled right there and is not listed; anything else becomes a chat with the hub's answer as the first turn. The top bar's Capture "ask" (`#/chat/hub/<text>`) always opens on the Hub.

## Keys and what you can type

| Type or press | Does |
| --- | --- |
| Enter, Shift+Enter | Send, new line |
| Tab, Shift+Tab | Next or previous agent (as in the TUI) |
| `/` | Commands: Chat's own (`/new`, `/undo`, `/redo`, `/compact`, `/models`, `/agents`, `/sessions`, `/export`, `/terminal [command]`, `/files [path]`, `/side <question>`, `/tui`, `/details`, `/help`) and every opencode command (yours and Tandem's). `//` sends a message that starts with `/`. `/terminal` opens the Terminal (and runs the command in it, when you give one), `/files` opens Files (and the file), `/side` asks in a side chat, `/tui` opens the chat in opencode's own terminal window |
| `@` | Workspace files (opencode's file search); picked files go with the message |
| `!command` | A shell command run through opencode in the workspace (its shell mode) |
| Up (empty box) | Your last message |
| Esc twice | Stop opencode |
| Paste or drop a picture | It goes with the message (Pictures below) |
| Ctrl+` | Open or close the Terminal beside the chat |
| Ctrl+S (in Files) | Save the file |

Your message shows in the thread as soon as you send it, even before opencode has stored it (opencode takes prompts asynchronously, so its first reads can miss it); a New chat shows it with Starting... while the session is made (Chat 2.4.0). A message sent while opencode is working waits in a queue under the thread and goes when it is done (Stop clears the queue). Undo takes back your last message and its file changes and puts its text back in the box; the turns stay hidden until Redo, and your next message drops them, as in the TUI.

## Rules

1. **opencode decides what an agent may do.** Chat sends each message to the agent you picked (none named: opencode's default agent) with the model you picked. opencode's own permission settings apply exactly as in the terminal; when it asks, the prompt shows in the chat (Allow once, Always allow, Reject) and in Loom's Inbox. Questions from an agent are answered in the chat too. Subagents' prompts show in their parent chat.
2. **Hub threads stay read only by default.** A hub thread's follow-ups go to Tandem's read-only `chat` agent (eng-agents Core 2.14.0) unless you pick another agent.
3. **Nothing happens on its own.** opencode acts only on a message, a command or a click. Make it a spike asks for a confirm; Save as note goes to Notes as a handoff ([handoffs.md](handoffs.md)).
4. **opencode is always on.** Since Chat 2.2.0 (connector 1.17.0) there is no separate AI switch: Chat, the hub and Writing work whenever the opencode connector is on and ready. Turning the connector off in Settings is the off switch. While it is off or not ready, New chat is the Hub's box, which still captures with simple rules, and a line under it says why.
5. **Workspace only.** Sessions are the workspace's; `@` files must be inside the workspace (the connector checks). Long tool output is cut (start and end kept) and workspace paths are shown relative to it.
6. **Escape everything.** Your turns render as text; opencode's as escaped Markdown (`apps/chat/js/md.js`) with code, bold, italics, lists, tables, quotes and http(s) links only.

## The workbench (Chat 4.0.0)

What Claude's desktop app keeps beside a conversation, so nothing sends you out of Chat. It is one element that the chat's drawing never touches, so a running terminal or a file you are editing keeps its state while answers stream in.

### Terminal

Real shells in the workspace (`js/terminal.js`, the connector's `lib/pty.mjs`). **opencode runs them**, through its own terminal API (`/pty`, as its desktop app does): Workshop's agent still runs no program. The connector holds each terminal's WebSocket to opencode on this computer and passes what the shell prints to the page as `term.out` events; keys go back with `term.input`. xterm.js draws it (`apps/chat/vendor/xterm`, loaded the first time the Terminal opens).

- Up to 4 terminals, as tabs (+ for a new one). The first opens by itself the first time you open the Terminal. Ctrl+Shift+C and Ctrl+Shift+V copy and paste; Ctrl+C is an interrupt, as in any terminal.
- Terminals keep running when the page closes. Reopen Chat and they are there with the last part of what they printed (the connector keeps the last 120,000 characters of each; opencode keeps more, and a connector restart replays what it kept). A shell that exits stays readable, marked **ended**, until you close its tab. Closing a running terminal ends its shell.
- **opencode window** in the Terminal's bar (and `/tui`) still opens the chat in opencode's own terminal window, as Open in terminal did before.
- Opening a terminal is a change (`term.open`, `write: true`, in Activity). What you type in it is not logged, as in any terminal: the activity log never holds arguments, and a line per key would bury everything else. No terminal action is marked for agents, so Tandem's agents cannot reach them through `/api/tools`.
- Needs opencode 1.x with terminals (1.19 has them). With an opencode that has none, the Terminal says so and offers opencode's window.

### Files

Browse and edit the workspace (`js/files.js`, the connector's `lib/workfiles.mjs`): a tree on the left (hide it with the button at the top left), **Go to file** (opencode's file search, as `@` uses), tabs for open files, and Monaco as the editor (`shared/monaco.js`, the same copy Loom's code review uses). **+** makes a new file: type its path and press Enter.

- **Open** beside a tool call that read, wrote or edited a file, a file in a **Changed** line, and an `@` file on your message open it here.
- **Saving only writes over the version you opened** (Ctrl+S). If an agent or another editor changed the file since, nothing is written and a bar asks: **Use the file on disk**, or **Keep mine and save**. A deleted file offers **Save it again**.
- A file you have not changed follows the disk: open files are checked every 4 seconds while Files shows, and when an agent finishes a turn. A tab with unsaved changes has a dot; closing it asks first, and the page warns before it closes with unsaved files.
- Paths stay in the workspace, through links too (their real path is checked), and Git's own `.git` folder is never listed, read or written. Files over 900 KB, and files that are not UTF-8 text, open with a note instead of the text. A byte order mark and line endings are kept as they are.
- Saving is a change (`files.write`, `write: true`, in Activity). Reading and listing are not.

### Side chats

A question about the chat in view that should not land in it (`js/side.js`, the connector's `chat.side`). The first question copies the chat so far (opencode's fork) and asks in the copy; later ones go to the same side chat, which keeps its own thread. **Nothing is added to the chat itself.** **Start over** forgets the side chat, and the next question copies the chat as it is then. Each chat keeps one side chat, across reloads.

- Tandem's read-only `chat` agent answers unless you pick another in the side chat's own picker (opencode's `plan` agent when Tandem is not installed), so a side question does not change files by accident. Its permission prompts and questions are answered in the side chat.
- Works while the chat is busy: the copy has everything up to that moment.
- Side chats stay out of the Chat list and All sessions. The copy is an opencode session titled "Side chat: <chat>", kept in opencode like any other.
- `/side <question>` in the chat's composer asks one without opening the panel first.

### Pictures

Paste (Ctrl+V) or drop a PNG, JPEG, GIF or WebP on the composer (`js/images.js`), in a chat or a side chat. It shows above the box with an x to take it out, and goes with the message as a file part opencode passes to the model. Up to 4 per message.

- Workshop's agent takes 1 MB per request, so a big picture is shrunk in the page first: at most 2000 pixels on its long side, then smaller or as a JPEG until it fits (about 880 KB of base64 for all of a message's pictures). A paste that also carries text (copying from a document) pastes the text.
- Pictures show in the thread; click one to see it full size. The turns never carry them: the page asks for each one once with `chat.image`.
- Pictures go with a message, not a `/command` or `!shell` line. With an opencode 2.x background service, Chat says it cannot send them.

## Sources

When an answer ends with a `Sources:` list (Tandem's hub and chat agents always add one), Chat shows it as chips under the answer (`js/sources.js`, [knowledge.md](knowledge.md), Citations): a Folio note has **Open** and **That's wrong** (both open it in Folio, the second with a reminder to fix the line there), a Settings file opens its page, and anything else is shown as a path. Only a list at the very end counts; the text is escaped like the rest of the answer.

## Connector actions

| Action | Write | Args | Result |
| --- | --- | --- | --- |
| `chat.options` | no | | `{kind, version, agents, subagents, models, defaults, commands, can: {shell, undo, compact, files, images, side, terminal}}`. Agents are opencode's primary agents (hidden ones left out); models are those of connected providers |
| `chat.start` | yes | `text`, optional `agent`, `model: {provider, id}`, `files`, `images` | `{session}`: a new session with its first message |
| `chat.send` | yes | `session`, `text`, optional `agent`, `model`, `files`, `images` | `{ok}`. 409 while opencode is still working (Chat queues instead). Any session in the workspace; sending in one from All sessions lists it. `images`: up to 4 `{name, mime, data}` (base64; PNG, JPEG, GIF or WebP, checked against their first bytes), at most 920,000 characters together |
| `chat.side` | yes | `session`, `text`, optional `side`, `agent`, `model`, `images` | `{side}`: asks in the chat's side chat. Without `side`, copies the chat first (opencode's fork). Default agent: Tandem's `chat`, else `plan` |
| `chat.image` | no | `session`, `message`, `part` | `{mime, data}`: one pasted picture of a turn (`parts` mark them `image: true` with their `part`) |
| `term.list` | no | | `{can, max, terms: [{id, title, status: "running" \| "exited", exitCode, cursor, live}]}`: the terminals Chat opened, attached again after a restart |
| `term.open` | yes | optional `title`, `rows`, `cols` | A new terminal in the workspace (up to 4 running) |
| `term.read` | no | `id`, optional `from` | The terminal and `{from, data}`: what it printed from `from` (as much as is kept). Positions count characters since the shell started |
| `term.input` | no | `id`, `data` | `{ok}`: keys or pasted text (up to 64 KB). 409 once the shell exited |
| `term.resize` | no | `id`, `rows`, `cols` | `{ok}` |
| `term.close` | no | `id` | `{ok}`: ends the shell if it runs, and forgets the terminal |
| `files.tree` | no | optional `dir` | `{dir, items: [{name, path, dir}], more}`: one folder, folders first (up to 2,000) |
| `files.read` | no | `path` | `{path, mtime, size, content}`, or `binary: true` or `tooBig: true` (over 900 KB) instead of `content` |
| `files.write` | yes | `path`, `content`, optional `mtime`, `create`, `force` | `{ok: true, path, mtime, size}`, or `{ok: false, conflict: "changed" \| "gone" \| "exists", mtime}` and nothing written |
| `files.stat` | no | `paths` (up to 50) | `{mtimes: {path: mtime \| null}}` |
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

Stop is the connector's `abort` action, and **opencode window** (`/tui`) its `terminal` action. Events for the Terminal, on `/api/events` as `connector` events: `term.out` `{id, at, data}` (at most 8,000 characters each; a page that sees `at` past what it has calls `term.read`), `term.exit` `{id, exitCode}` and `term.gone` `{id}`. The list lives in the data folder, `<dataDir>/chat/chats.json` (mode 0600, newest 100), so it stays with your data if Workshop is removed. Connector 1.18.0 copies it there once from `<Workshop home>/data/_connectors/opencode/chats.json` and keeps the old file. Each hub entry keeps its intent once `hub.result` reads the route (older entries: read from the request's `route.json`), so captures and go stay out of the list. The turns stay in opencode.

## opencode versions

Everything above is built on opencode 1.x's server API (`opencode serve`): `prompt_async` with `agent`, `model` and file parts (pictures as `data:` URLs), `/command`, `/shell`, `/revert`, `/unrevert`, `/summarize`, `/find/file`, `/agent` and `/provider`; the workbench adds `/session/:id/fork`, `/session/:id/message/:messageID`, `PATCH /session/:id` (the side chat's title) and the terminal API (`/pty`, `/pty/:id`, and its WebSocket `/pty/:id/connect` with `cursor`), checked against opencode 1.19.6. Files reads and writes the workspace itself, so it works with any opencode. The 2.x background service adapter reads the same things from its `/api` routes where they are known, and reads messages loosely; any 2.x route it does not have shows opencode's own error in the chat. It has no terminals, side chats or pictures yet: `chat.options` says so in `can` (`terminal`, `side`, `images`) and the workbench explains.

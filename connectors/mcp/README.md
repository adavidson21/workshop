# MCP servers connector

Remote MCP servers you add in Settings, reached through Workshop. Tandem uses their tools (through `/api/mcp`, as `<server>__<tool>`, and through `/api/tools`) and never sees a token: tokens live in this computer's secret store and only this connector, inside the Workshop agent, sends them. Off until you turn it on. Node standard library only. It calls only the server URLs in its settings.

## Add a server

1. Save its token, if it needs one: `workshop secret set <name> --expires <date>` (for example `github-mcp`). It goes into the macOS Keychain, Windows Credential Manager or the Secret Service, never a file or a variable.
2. Settings, MCP servers: turn it on, add the server: an **Id** (short, lowercase: `github`), a **Name**, its **Server URL** (Streamable HTTP; https only, except on this computer) and the **Token** secret name. Most servers take the token as `Authorization: Bearer <token>`; change **Header** and **Before the token** under Advanced if yours does not.
3. Use the Test field with the server id to list its tools. Settings, Manager, All connections shows each server, its host, its secret and how many tools are read-only.

Servers that only offer OAuth sign-in are not supported yet: use a server that takes a token.

## What Tandem can do

- **Read-only tools** (the server marks them `readOnlyHint`) run at once. Turn **Run tools the server marks read-only without asking** off for a server you do not trust to mark them honestly: then every call asks.
- **Every other tool** is a change: the call becomes a request in Settings, Manager, Approvals, showing the server, the tool, its description and the exact arguments. Nothing reaches the server until you approve it, or until an always-allow rule covers that tool (tick "Always allow" when you approve; the rule's scope is `<server>/<tool>`).
- Every call from Tandem, and every change, is in Activity.

Tool descriptions come from the server and reach Tandem as written: add servers you trust.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `servers[].id` | required | Short, lowercase. Tools show as `<id>__<tool>`; always-allow scopes are `<id>/<tool>`. |
| `servers[].name` | required | Shown in Approvals and Activity. |
| `servers[].url` | required | Streamable HTTP address. https, or http on 127.0.0.1 or localhost. |
| `servers[].tokenSecret` | none | Secret name (`x-workshop-secret`). Settings shows whether it is saved and when it expires. |
| `servers[].header`, `servers[].prefix` | `Authorization`, `Bearer ` | How the token is sent (Advanced). |
| `servers[].trustReadOnly` | `true` | Run tools marked read-only without asking. |
| `servers[].enabled` | `true` | Off: its tools are not offered. |

## Actions

| Action | Agent | Args | Result |
| --- | --- | --- | --- |
| `servers.list` | yes | none | `[{id, name, host, ok, tools, readOnly, error?}]` (a setup action: works while a server fails) |
| `tools.list` | yes | `server` | `[{name, title, description, inputSchema, readOnly}]`, cached five minutes |
| `catalog` | yes | none | Every tool on every server, with its server (what `/api/mcp` lists) |
| `tools.read` | yes | `server`, `tool`, `arguments` | Runs a read-only tool: `{isError, text, structured?}`. Any other tool is refused here. |
| `tools.call` | asks (write) | `server`, `tool`, `arguments` | Any tool, after approval. Same result. |

## Tests

```
node --test "connectors/mcp/test/*.test.mjs"
```

They run against a fake MCP server (JSON and event-stream answers); nothing reaches the network.

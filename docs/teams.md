# Teams

The Azure DevOps area paths your team works in, kept once and read by every app that pulls work items: Runway's ADO roadmaps, the Dispatch hub. It lives in Settings' folder, like the people directory ([people.md](people.md)), and is edited in Settings, on the Team area paths page.

Version: the `settings.teams` collection is version 1.

## The collection

Settings keeps one collection named `teams`, so its schema is `settings.teams`, stored at `<dataDir>/settings/teams.json` in the usual envelope ([data-format.md](data-format.md)). Each item is one team. Schema: [schemas/team.schema.json](schemas/team.schema.json). Example: [examples/team.mine.json](examples/team.mine.json).

```json
{
  "id": "t_mine",
  "updatedAt": 1793736000000,
  "name": "My team",
  "areas": ["Project\\Team", "Other\\Team"],
  "connection": "",
  "areaConnections": { "Other\\Team": "second" }
}
```

| Field | Meaning |
| --- | --- |
| `id` | `t_` and then letters, digits, `_` or `-`. Version 1 has one team, `t_mine`. |
| `name` | Display name. |
| `areas` | Area paths, up to 20, as Azure DevOps writes them. |
| `connection` | Optional. The ADO connector connection to use (its name in the connector's settings); empty means the default. |
| `areaConnections` | Optional. Area path to connection name, for a team whose area paths are in more than one collection. An area path not listed (or listed as `""`) uses `connection`. Keys are area paths exactly as in `areas`; entries for paths not in `areas` are ignored. |

`meta` is not used in version 1.

## Rules

1. **Written only through `ws.teams`** ([sdk.md](sdk.md), Teams), which Settings' Team area paths page uses. Other apps read it with `ws.data.get('teams', {app: 'settings'})`.
2. **Missing means not set up.** Apps leave area paths empty (Runway asks for them in its dialog) and never write it themselves.
3. **One read per connection.** An app that reads ADO by area path groups `areas` by connection (`areaConnections`, then `connection`) and reads each group on its own connection. Work item ids are unique only within a collection, so with more than one connection an id alone does not name an item: keep the connection with the id, and when only an id is known, look it up on every connection (the ADO connector's `workitem.find`) and ask when more than one has it.
4. **Not secret.** Area paths and connection names only. PATs stay in environment variables ([security.md](security.md)).

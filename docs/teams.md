# Teams

The Azure DevOps area paths your team works in, kept once and read by every app that pulls work items: Runway's ADO roadmaps, the Dispatch hub. Settings owns it, like the people directory ([people.md](people.md)).

Version: the `settings.teams` collection is version 1.

## The collection

Settings keeps one collection named `teams`, so its schema is `settings.teams`, stored at `<dataDir>/settings/teams.json` in the usual envelope ([data-format.md](data-format.md)). Each item is one team. Schema: [schemas/team.schema.json](schemas/team.schema.json). Example: [examples/team.mine.json](examples/team.mine.json).

```json
{
  "id": "t_mine",
  "updatedAt": 1793736000000,
  "name": "My team",
  "areas": ["Project\\Team"],
  "connection": ""
}
```

| Field | Meaning |
| --- | --- |
| `id` | `t_` and then letters, digits, `_` or `-`. Version 1 has one team, `t_mine`. |
| `name` | Display name. |
| `areas` | Area paths, up to 20, as Azure DevOps writes them. |
| `connection` | Optional. The ADO connector connection to use (its name in the connector's settings); empty means the default. |

`meta` is not used in version 1.

## Rules

1. **Only Settings writes it.** Other apps read it with `ws.data.get('teams', {app: 'settings'})`.
2. **Missing means not set up.** Apps leave area paths empty (Runway asks for them in its dialog) and never write it themselves.
3. **Not secret.** Area paths and connection names only. PATs stay in environment variables ([security.md](security.md)).

# App settings

Simple on/off switches an app declares in its manifest, shown under that app on Settings' **Apps** tab, and read by the app through the SDK. For choices a person makes once for the whole app (Docket's **Use sprints**), not for data the app edits all day, which stays in the app's own collections.

Version: the `settings.app-settings` collection is version 1. Bundle 2.7.0.

## Declaring them

In `app.json` ([app-manifest.md](app-manifest.md)), `settings` is a list of up to 20 switches:

```json
{
  "settings": [
    {"id": "sprints", "type": "boolean", "title": "Use sprints", "description": "Plan days by sprint day and add every-sprint tasks. Off: Day templates are by weekday.", "default": true}
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Starts with a lowercase letter, then letters, digits or `-`, up to 40. Unique in the list. |
| `type` | `boolean`. The only type in version 1. |
| `title` | The switch's label in Settings. Up to 80 characters. |
| `description` | Optional. One or two sentences under the title. Up to 300 characters. |
| `default` | The value until someone changes it. |

## The collection

Settings keeps one collection named `app-settings`, so its schema is `settings.app-settings`, stored at `<dataDir>/settings/app-settings.json` in the usual envelope ([data-format.md](data-format.md)). Each item is one app, with the app's id as its id. Schema: [schemas/app-setting.schema.json](schemas/app-setting.schema.json). Example: [examples/app-setting.prioritizer.json](examples/app-setting.prioritizer.json).

```json
{"id": "prioritizer", "updatedAt": 1793736000000, "values": {"sprints": false}}
```

Only values someone changed are saved. `meta` is not used in version 1.

## Rules

1. **Written only through `ws.appSettings`** ([sdk.md](sdk.md), App settings). An app changes only its own values; Settings changes any app's.
2. **Missing means the default.** `ws.appSettings.get()` fills in each declared `default`, then what is saved. Values saved for a setting the manifest no longer declares are kept and still returned, so removing one from a manifest loses nothing.
3. **On an app's own site** there is no registry, so `get()` returns only saved values and the app applies its own default. An app that also keeps the choice in its own data (to work on its own site) should treat Workshop's value as the one that counts inside Workshop and keep its copy in step, so both places agree.
4. **Not secret.** Booleans only.
5. **Order of releases.** An app whose manifest has `settings` fails the manifest schema of a Workshop older than bundle 2.7.0, and that Workshop leaves the app out. Update Workshop before releasing an app that declares settings.

# Turning apps on and off

Every app except Needs you (`home`) and Settings has an on/off switch: **Settings, Apps**, or the `workshop apps` command. An app that is off leaves the rail. In work mode it also leaves the pinned copy, so it is not served at all.

## The command

```
workshop apps                  list the apps and whether each is on
workshop apps on <app>         turn one on
workshop apps off <app>        turn one off
```

`<app>` is the app's name (`roadmaps`, `docket`, `notes`, `dispatch`) or its id.

In work mode, `workshop apps on` for an app in its own repo (Tasks, Roadmaps) downloads it first if it is not on this computer: it clones the repo into a folder named after it next to Workshop (`roadmaps` next to `workshop`) and moves it to its newest release tag, or leaves it on its newest code when it has no release yet. Then it rebuilds the pinned copy. Outside work mode nothing is downloaded: the site serves every app.

## Settings

The Apps tab has the same switches. Changes come from Workshop on this computer only; a paired site sees them read only.

- **Work mode:** a switch saves the change and rebuilds the pinned copy from what is already on this computer, then offers **Reload Workshop**. If an app in its own repo is not downloaded yet, the switch is saved and Settings shows the one command to run (`workshop apps on roadmaps`), with a Copy button. If it is downloaded but its `app.json` is not a valid manifest (`problem` in the response), the pinned copy leaves it out of the rail; Settings, `workshop apps` and `workshop pin` say why instead of "not in the pinned copy yet". The agent itself never downloads anything or runs git (docs/security.md, Outbound hosts).
- **Hosted mode:** the switches change the rail.
- **Browser mode (no agent):** the switches are kept in this browser and change its rail.

## Areas

An area turns a whole kind of work on or off at once, so a personal computer is not cluttered with work things. They are switches at the top of **Settings, Apps**, or `workshop apps on|off <area>`. Every area is on by default. What each one covers is in `shared/areas.js`:

| Area | Apps | Settings pages | Connectors (Status) | App parts |
| --- | --- | --- | --- | --- |
| Management (`management`) | People | Directory (People & groups, Team area paths) | none | Tasks' Handed off view |
| Work (`work`) | Roadmaps | Azure DevOps (Connections, Work items, Pull requests) | Azure DevOps | none |

The area wins: while it is off, its apps are off whatever their own switch says (their switch is disabled and says "Off with Management"; `PUT /api/app-switches/<id>` with `{"on": true}` answers `400`). Turning the area back on brings back each app's own switch. Settings pages and connectors are only hidden: an area page still opens from its route, and a connector's config and on/off state are kept. Turn Azure DevOps off on its page first if you don't want it syncing.

Apps learn which areas are off from `ws.areas` ([sdk.md](sdk.md)), as the shell saw them when the app opened; changes show after Workshop reloads.

## Rail order

Drag an app's button on the rail to move it. From the keyboard, focus the button (Tab) and press `Alt+Shift+Up` or `Alt+Shift+Down` (`Left` and `Right` on a phone's bottom bar; `Home` and `End` move it to the ends); a screen reader hears where it went. *Reset the rail order* in `Ctrl+K` goes back to the usual order (each app's `order`, [app-manifest.md](app-manifest.md)).

- `Alt+1` to `Alt+9` follow the rail as it is shown: the third button is always `Alt+3`. Each button's tooltip says its key.
- The first app on the rail is where Workshop opens (the plain address), as before.
- An app the order does not name (a new app, or one turned on for the first time) goes right after the app before it in the usual order. An app turned off keeps its place in the saved order and comes back there.
- A pop-out window has no rail and does not change the order.

The order is kept in Settings' `rail` collection (`settings.rail`, version 1, `<dataDir>/settings/rail.json`), written by the shell, so it follows your data: this browser in browser mode, files on your computer when Workshop is installed (and in exports and backups). The collection has no items; `meta.order` lists app ids:

```json
{"schema": "settings.rail", "version": 1, "rev": 3, "items": [], "meta": {"updatedAt": 1795372800000, "order": ["notes", "tasks", "builds", "people", "roadmaps", "bench", "chat", "settings"]}}
```

Up to 100 ids, each an app id; anything else is dropped when read. No collection, or an empty `order`, is the usual order. The shell also keeps a copy in `localStorage` (`workshop.railOrder`) so the rail draws in your order before the data is read; the data wins. The rules are in `shared/rail-order.js`.

## Where it is kept

`~/.workshop/apps.json` (or `WORKSHOP_HOME`), a file of its own so the command and the running agent never overwrite each other's `config.json`:

```json
{"off": ["notes", "roadmaps"], "areasOff": ["management"]}
```

No file means every app and area is on. Browser mode keeps the areas in `localStorage` (`workshop.areasOff`). Needs you (`home`) and Settings are never turned off, even if the file lists them. `workshop pin` and `workshop update` leave out the apps that are off.

## API

`GET /api/app-switches` lists every app with its switch, and the areas; `PUT /api/app-switches/<id>` with `{"on": true}` or `{"on": false}` changes one app, and `PUT /api/app-areas/<id>` one area (Workshop on this computer only). See [agent-api.md](agent-api.md).

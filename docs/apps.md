# Turning apps on and off

Every app except Needs you (`home`) and Settings has an on/off switch: **Settings, Apps**, or the `workshop apps` command. An app that is off leaves the rail. In work mode it also leaves the pinned copy, so it is not served at all.

## The command

```
workshop apps                  list the apps and whether each is on
workshop apps on <app>         turn one on
workshop apps off <app>        turn one off
```

`<app>` is the app's name (`runway`, `docket`, `notes`, `dispatch`) or its id.

In work mode, `workshop apps on` for an app in its own repo (Docket, Runway) downloads it first if it is not on this computer: it clones the repo into a folder named after it next to Workshop (`runway` next to `workshop`) and moves it to its newest release tag, or leaves it on its newest code when it has no release yet. Then it rebuilds the pinned copy. Outside work mode nothing is downloaded: the site serves every app.

## Settings

The Apps tab has the same switches. Changes come from Workshop on this computer only; a paired site sees them read only.

- **Work mode:** a switch saves the change and rebuilds the pinned copy from what is already on this computer, then offers **Reload Workshop**. If an app in its own repo is not downloaded yet, the switch is saved and Settings shows the one command to run (`workshop apps on runway`), with a Copy button. If it is downloaded but its `app.json` is not a valid manifest (`problem` in the response), the pinned copy leaves it out of the rail; Settings, `workshop apps` and `workshop pin` say why instead of "not in the pinned copy yet". The agent itself never downloads anything or runs git (docs/security.md, Outbound hosts).
- **Hosted mode:** the switches change the rail.
- **Browser mode (no agent):** the switches are kept in this browser and change its rail.

## Areas

An area turns a whole kind of work on or off at once, so a personal computer is not cluttered with work things. They are switches at the top of **Settings, Apps**, or `workshop apps on|off <area>`. Every area is on by default. What each one covers is in `shared/areas.js`:

| Area | Apps | Settings pages | Connectors (Status) | App parts |
| --- | --- | --- | --- | --- |
| Management (`management`) | Rapport | People & teams (People & groups, Team area paths) | none | Docket's People place |
| Work (`work`) | Runway | Azure DevOps (Connections, Work items, Pull requests) | Azure DevOps | none |

The area wins: while it is off, its apps are off whatever their own switch says (their switch is disabled and says "Off with Management"; `PUT /api/app-switches/<id>` with `{"on": true}` answers `400`). Turning the area back on brings back each app's own switch. Settings pages and connectors are only hidden: an area page still opens from its route, and a connector's config and on/off state are kept. Turn Azure DevOps off on its page first if you don't want it syncing.

Apps learn which areas are off from `ws.areas` ([sdk.md](sdk.md)), as the shell saw them when the app opened; changes show after Workshop reloads.

## Where it is kept

`~/.workshop/apps.json` (or `WORKSHOP_HOME`), a file of its own so the command and the running agent never overwrite each other's `config.json`:

```json
{"off": ["notes", "runway"], "areasOff": ["management"]}
```

No file means every app and area is on. Browser mode keeps the areas in `localStorage` (`workshop.areasOff`). Needs you (`home`) and Settings are never turned off, even if the file lists them. `workshop pin` and `workshop update` leave out the apps that are off.

## API

`GET /api/app-switches` lists every app with its switch, and the areas; `PUT /api/app-switches/<id>` with `{"on": true}` or `{"on": false}` changes one app, and `PUT /api/app-areas/<id>` one area (Workshop on this computer only). See [agent-api.md](agent-api.md).

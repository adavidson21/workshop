# Workspace repo map

Agents: use this file to choose repos for a work item.

## Repos

One row per repo folder in this workspace.

| Folder | What it is (one line) | Stack | Shared? |
|---|---|---|---|
| shared-lib | Domain models and validation | .NET | Yes |
| Platform/portal-api | Portal API | .NET | No |
| Platform/portal-ui | Portal screens | Angular | No |
| new-repo | TODO(you): what it is, in one line | | No |

## Products

### Sample Portal

Also called: Portal, SP

| Repo | What lives here for this product | Typical changes |
|---|---|---|
| shared-lib | Order models | New fields |
| Platform/portal-api | Endpoints | API changes |
| Platform/portal-ui | Screens | UI changes |

- Usually change together: Platform/portal-api + Platform/portal-ui
- Change order: shared-lib, then Platform/portal-api, then Platform/portal-ui
- Entry points: `Platform/portal-api/src/Api/OrdersController.cs`
- External systems: Payment gateway REST API, nightly reporting job
- Business processes: Place an order, Issue a refund
- Product docs: `product-docs/portal`

### TODO(you) Product name

Also called: TODO(you)

## Glossary

| Work item term | Name in code | Product | Where it shows up |
|---|---|---|---|
| Member | `Subscriber` | Sample Portal | `shared-lib/src/Domain/Subscriber.cs` |
| (example) Customer | `Account` | (example) Orders | (example) `x` |

## Do not touch

- Generated clients in `portal-ui/src/app/api/generated/`.

## Local environment notes

- TODO(you) (example: all tests run without a database)

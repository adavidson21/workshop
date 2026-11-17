# Workspace repo map

<!--
HOW TO USE THIS TEMPLATE (delete this comment when done)
1. Copy this file to C:\src\work\AGENTS.md on the work PC. Never commit the filled-in copy.
2. Replace every TODO(you) and every (example) row. Agents warn you while any TODO(you) is left.
3. Delete a section only if it truly does not apply. Keep it short and accurate: a wrong map produces wrong plans.
4. After editing, start a new opencode session. No reinstall needed.
-->

Agents: use this file to choose repos for a work item. First match the work item to a product (Products and Glossary), then use that product's repo table, then apply the change order. `/tsd <product>` also uses each product block to know which repos belong together.

## Repos

One row per repo folder in this workspace.

| Folder | What it is (one line) | Stack | Shared? |
|---|---|---|---|
| shared-lib | (example) Domain models and validation used by several products | .NET, TypeScript | Yes |
| product-docs | (example) Product docs: user guides, overviews, release notes. One folder per product. | Markdown | No |
| TODO(you) | | | |

## Products

One block per product. A product can span several repos, and one repo can belong to several products.

### TODO(you) Product name

Also called: TODO(you) (other names people use in work items, for example an old name or an abbreviation)

Note: (optional) the product note in Workshop's Notes app, for example `products/orders.md`. Leave it out when the note's name is the product name in lowercase with `-` between words.

| Repo | What lives here for this product | Typical changes |
|---|---|---|
| shared-lib | (example) Order models, pricing rules | (example) New fields, rule changes |
| orders-api | (example) Order endpoints, EF Core | (example) API and DB changes |
| orders-ui | (example) Order and catalog screens | (example) UI changes |

- Usually change together: TODO(you) (example: shared-lib + orders-api)
- Change order: TODO(you) (example: shared-lib, then orders-api, then orders-ui)
- Entry points: TODO(you) (example: `orders-api\src\Api\Controllers\OrdersController.cs`)
- External systems: TODO(you) (example: a partner SFTP drop, a payment gateway REST API, an email notification service, a nightly reporting job. Systems outside these repos that this product talks to.)
- Business processes: TODO(you) (example: place an order, cancel an order, issue a refund. Used by `/tsd` for BPMN-style diagrams.)
- Product docs: TODO(you) (example: `product-docs\orders\`. Read these for user-facing behavior.)

<!-- Copy the block above for each product. -->

## Glossary

Words from work items mapped to what they are called in code. Include words that differ between business and code.

| Work item term | Name in code | Product | Where it shows up |
|---|---|---|---|
| (example) Customer | `Account` | (example) Orders | (example) `shared-lib\src\Domain\Account.cs` |
| TODO(you) | | | |

## Which repos for which kind of work

Shortcuts for common work that does not fit cleanly under one product.

| If the work item is about... | Usually involves |
|---|---|
| (example) A new field shown on a screen | shared-lib, the product's API repo, the product's UI repo |
| (example) Login or permissions | TODO(you) |
| TODO(you) | |

## How the repos depend on each other

All cross-repo references are relative paths, so every repo stays cloned directly in this folder.

| Repo | Depends on | How | Example reference |
|---|---|---|---|
| orders-api | shared-lib | (example) ProjectReference | (example) `..\..\shared-lib\src\Lib\Lib.csproj` |
| TODO(you) | | | |

Rule: change a shared repo first, then run the tests of every dependent repo the work item touches.

## Do not touch

- TODO(you) (example: generated clients in `orders-ui\src\app\api\generated\`. Regenerate them instead of editing.)
- Never point anything at a shared or production environment.

## Local environment notes

- TODO(you) (example: all tests run without a database)

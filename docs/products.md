# Products

The products you work on, set up once in Settings, on the Products page. Notes makes each product's note (`products/<slug>.md`, Notes' README "Tandem and product notes"), which you then edit in Notes and Tandem reads and adds to. It lives in Settings' folder, like the people directory ([people.md](people.md)) and team area paths ([teams.md](teams.md)).

Version: the `settings.products` collection is version 1. The fields from `changeOrder` down were added in Settings 7.0.0 (Knowledge base V1); they are optional, so older readers keep them unchanged (data-format.md, Migrations, rules 1 and 2).

Products are one of the sources Workshop writes the workspace repo map from, and that `Get-Knowledge.ps1` reads ([knowledge.md](knowledge.md)).

## The collection

Settings keeps one collection named `products`, so its schema is `settings.products`, stored at `<dataDir>/settings/products.json` in the usual envelope ([data-format.md](data-format.md)). Each item is one product. Schema: [schemas/product.schema.json](schemas/product.schema.json). Examples: [examples/product.full.json](examples/product.full.json), [examples/product.minimal.json](examples/product.minimal.json).

```json
{
  "id": "p_sample-portal",
  "updatedAt": 1793736000000,
  "name": "Sample Portal",
  "slug": "sample-portal",
  "alsoCalled": ["Portal", "SP"],
  "repos": ["Platform/Sample Portal/portal-ui"],
  "areas": ["Project\\Team\\Portal"]
}
```

| Field | Meaning |
| --- | --- |
| `id` | `p_` and then the slug the product was added with. Never changes. |
| `name` | Display name, unique (case ignored). Renaming changes only this. |
| `slug` | Lower case letters, digits and `-`, up to 40, unique. Made from the name when the product is added and never changed after, so the note and Tandem's lookups do not move. Notes' note is `products/<slug>.md`. |
| `alsoCalled` | Optional. Other names people use for it, up to 20. |
| `repos` | Optional. Workspace repo folders as Settings' Repos page lists them (`repo` or `Category/repo`), up to 30. |
| `areas` | Optional. Azure DevOps area paths, up to 20, as ADO writes them. |
| `changeOrder` | Optional. Repos in the order a change goes through them, shared ones first, up to 30. |
| `together` | Optional. Repos that usually change together, one group per entry (`portal-api + portal-ui`), up to 20. |
| `entryPoints` | Optional. Files to start reading from, workspace-relative, up to 20. |
| `external` | Optional. Systems outside these repos the product talks to (a payment gateway, a nightly job), up to 20. |
| `processes` | Optional. Business processes (place an order, issue a refund), up to 20. `/tsd` draws them. |
| `docsFolder` | Optional. Workspace-relative folder with the product's user-facing docs. |
| `archived` | Optional, `true` when archived. Archived products are kept and can be restored; they are never deleted from the UI. |

`meta` is not used in version 1. `shared/products.js` has the reader (`list`), the form rules (`fieldsOf`, `problem`, `upsert`) and `ownersOf` (people whose People "Owns" names the product, another name, a repo or an area path), and the product filter Builds, Roadmaps, Tasks and Notes share: `belongsTo(product, {productId, areas, repos, text})` (true when the thing names the product, sits under one of its area paths, touches one of its repos, or says its name or another name as a whole word), `picked` and `filterOptions`.

## Rules

1. **Written only by Settings**, on its Products page, through `ws.data`. Other apps read it with `ws.data.get('products', {app: 'settings'})` and never write it.
2. **Missing means not set up.** No products is not an error anywhere.
3. **Notes makes each note once.** For an active product it has not handled, Notes writes `products/<slug>.md` from your product template, prefilled with the name, other names, repos and area paths. Owners are not copied in since Knowledge base V1: they stay in People ([knowledge.md](knowledge.md)). If the file is already there (made by hand), Notes leaves it alone. It records what it handled in its own data, so a note you trash is not made again. Later changes in Settings, and archiving, never change or trash the note.
4. **Not secret.** Names, repo folders and area paths only. Real product names live only in your data folder, never in a repo.

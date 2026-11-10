# Products

The products you work on, set up once in Settings, on the Products page. Folio makes each product's note (`products/<slug>.md`, Folio's README "Tandem and product notes"), which you then edit in Folio and Tandem reads and adds to. It lives in Settings' folder, like the people directory ([people.md](people.md)) and team area paths ([teams.md](teams.md)).

Version: the `settings.products` collection is version 1.

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
| `slug` | Lower case letters, digits and `-`, up to 40, unique. Made from the name when the product is added and never changed after, so the note and Tandem's lookups do not move. Folio's note is `products/<slug>.md`. |
| `alsoCalled` | Optional. Other names people use for it, up to 20. |
| `repos` | Optional. Workspace repo folders as Settings' Repos page lists them (`repo` or `Category/repo`), up to 30. |
| `areas` | Optional. Azure DevOps area paths, up to 20, as ADO writes them. |
| `archived` | Optional, `true` when archived. Archived products are kept and can be restored; they are never deleted from the UI. |

`meta` is not used in version 1. `shared/products.js` has the reader (`list`), the form rules (`fieldsOf`, `problem`, `upsert`) and `ownersOf` (people whose People "Owns" names the product, another name, a repo or an area path).

## Rules

1. **Written only by Settings**, on its Products page, through `ws.data`. Other apps read it with `ws.data.get('products', {app: 'settings'})` and never write it.
2. **Missing means not set up.** No products is not an error anywhere.
3. **Folio makes each note once.** For an active product it has not handled, Folio writes `products/<slug>.md` from your product template, prefilled with the name, other names, repos, area paths and owners. If the file is already there (made by hand), Folio leaves it alone. It records what it handled in its own data, so a note you trash is not made again. Later changes in Settings, and archiving, never change or trash the note.
4. **Not secret.** Names, repo folders and area paths only. Real product names live only in your data folder, never in a repo.

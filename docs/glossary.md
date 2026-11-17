# Glossary

Words people use in work items, mapped to what the code calls them, kept once in Settings (Knowledge, Glossary). Workshop writes them into the workspace repo map, and Tandem's `Get-Knowledge.ps1` prints the ones for the product it works on ([knowledge.md](knowledge.md)).

Version: the `settings.glossary` collection is version 1.

## The collection

Settings keeps one collection named `glossary`, so its schema is `settings.glossary`, stored at `<dataDir>/settings/glossary.json` in the usual envelope ([data-format.md](data-format.md)). Each item is one word. Schema: [schemas/glossary-term.schema.json](schemas/glossary-term.schema.json). Examples: [examples/glossary-term.product.json](examples/glossary-term.product.json), [examples/glossary-term.any.json](examples/glossary-term.any.json).

```json
{
  "id": "g_member",
  "updatedAt": 1793736000000,
  "term": "Member",
  "code": "Subscriber",
  "where": "shared-lib/src/Domain/Subscriber.cs",
  "productId": "p_sample-portal"
}
```

| Field | Meaning |
| --- | --- |
| `id` | `g_` and then lower case letters, digits and `-`. Never changes. |
| `term` | The word people use, up to 120 characters. Unique per product, case ignored. |
| `code` | What the code calls it (a class, a table, a field), up to 200 characters. |
| `where` | Optional. Where it shows up in the code (a file or folder), up to 300 characters. |
| `productId` | Optional. The product it belongs to ([products.md](products.md)). Missing: any product. |

`shared/glossary.js` has the reader (`list`), the form rules (`rowsOf`, `problem`, `replaceAll`) and `forProduct`. At most 500 words.

## Rules

1. **Written only by Settings**, on its Knowledge, Glossary page, through `ws.data`. Other apps read it with `ws.data.get('glossary', {app: 'settings'})` and never write it.
2. **Missing means none.** No glossary is not an error anywhere.
3. **A word whose product is archived or gone** still shows, as "any product", until you change it.
4. **Not secret**, like products: words and code names only. Real names live only in your data folder, never in a repo.

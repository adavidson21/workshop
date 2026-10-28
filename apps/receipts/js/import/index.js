/* Receipts: the Importer interface. Interface only in V1; nothing imports yet.

   An importer suggests entries; it never writes them. You accept or dismiss each suggestion, and only an
   accepted one is saved as an entry.

     suggest({person, range}) -> Promise<entry drafts>

     person   a config person
     range    {start: 'yyyy-mm-dd', end: 'yyyy-mm-dd'}

   Each draft is an entry without id or updatedAt, with `source` (for example 'ado', 'prioritizer', 'agents')
   and `sourceRef` (a stable reference in that source). Receipts skips drafts whose source and sourceRef are
   already on an entry, so suggesting twice never doubles an entry. Planned for V1.1: notable metric details
   (for example a large work item closed) become drafts. */

/** Importers in V1: none. V1.1 adds {id, name, suggest} objects here. */
export const IMPORTERS = [];

/** Drafts not already logged: drops those whose source and sourceRef match an existing entry, and duplicates. */
export function newDrafts(drafts, entries) {
  const key = d => `${d.source}\u0000${d.sourceRef}`;
  const have = new Set(entries.filter(e => e.source && e.sourceRef).map(key));
  const out = [];
  for (const d of drafts) {
    if (!d || !d.source || d.source === 'manual' || !d.sourceRef) continue;
    if (have.has(key(d))) continue;
    have.add(key(d)); out.push(d);
  }
  return out;
}

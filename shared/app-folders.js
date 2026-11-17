// The folder each app keeps its data in, inside the data folder (docs/data-format.md, App folders). Plain data,
// no imports: the agent, the SDK's folder store and the workshop command all read it.
//
// App ids are internal and stay as they were; folders use the names people see, so the data folder makes sense
// without Workshop. An app not listed here uses its id as its folder.
export const APP_FOLDERS = Object.freeze({
  prioritizer: 'docket',
  receipts: 'rapport',
  slate: 'loom',
  notes: 'folio',
});

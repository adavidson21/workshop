/* Docket and Slate: the In Slate chip (Workshop claude/request-intake-v1-plan.md, follow-up 7).

   An ADO item assigned to you comes to Docket by ADO sync and may also be on Slate's board (shaped, defined or
   built there). Slate's summary (slate.summary, list card `tracked`: rows whose `id` is the ADO id, `note` the
   board column, `route` the Slate item) says which, so a task shows where the item stands in Slate and opens it.
   Titles and routes only; Docket never reads Slate's items. Inside Workshop only.

   slateAbout is pure (test/slate-link.test.mjs); startSlateLink keeps the summary fresh. */

/** Where an ADO item is on Slate's board: {column, route} or null, from Slate's summary envelope (or null). */
export function slateAbout(env, adoId) {
  if (!env || env.schema !== 'slate.summary' || !Array.isArray(env.items) || adoId === undefined || adoId === null) return null;
  const card = env.items.find(c => c && c.id === 'tracked' && c.kind === 'list' && Array.isArray(c.rows));
  if (!card) return null;
  const want = String(adoId);
  const r = card.rows.find(x => x && String(x.id) === want && typeof x.route === 'string');
  return r ? { column: typeof r.note === 'string' ? r.note.slice(0, 80) : '', route: r.route } : null;
}

/** The chip's words: "In Slate: Shape", or "In Slate" when the column is unknown. */
export const slateLabel = (s) => s ? `In Slate${s.column ? ': ' + s.column : ''}` : '';

let env = null;
/** Read Slate's summary now and on every change. onChange: called after each read. Inside Workshop only. */
export function startSlateLink(ws, embedded, onChange = () => {}) {
  if (!ws || !embedded) return;
  const read = () => ws.data.get('summary', { app: 'slate' }).then(e => { env = e; onChange(); }, () => {});
  read();
  try { ws.data.subscribe('summary', read, { app: 'slate' }); } catch { /* no data backend */ }
}
/** Where a task's ADO item is in Slate, from the summary read last. */
export const slateFor = (adoId) => slateAbout(env, adoId);

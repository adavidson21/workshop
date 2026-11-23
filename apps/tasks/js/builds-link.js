/* Tasks and Builds: the In Builds chip (Workshop claude/request-intake-v1-plan.md, follow-up 7).

   An ADO item assigned to you comes to Tasks by ADO sync and may also be on Builds' board (shaped, defined or
   built there). Builds' summary (builds.summary, list card `tracked`: rows whose `id` is the ADO id, `note` the
   board column, `route` the Builds item) says which, so a task shows where the item stands in Builds and opens it.
   Titles and routes only; Tasks never reads Builds' items. Inside Workshop only.

   buildsAbout is pure (test/builds-link.test.mjs); startSlateLink keeps the summary fresh. */

/** Where an ADO item is on Builds' board: {column, route} or null, from Builds' summary envelope (or null). */
export function buildsAbout(env, adoId) {
  if (!env || env.schema !== 'builds.summary' || !Array.isArray(env.items) || adoId === undefined || adoId === null) return null;
  const card = env.items.find(c => c && c.id === 'tracked' && c.kind === 'list' && Array.isArray(c.rows));
  if (!card) return null;
  const want = String(adoId);
  const r = card.rows.find(x => x && String(x.id) === want && typeof x.route === 'string');
  return r ? { column: typeof r.note === 'string' ? r.note.slice(0, 80) : '', route: r.route } : null;
}

/** The chip's words: "In Builds: Shape", or "In Builds" when the column is unknown. */
export const buildsLabel = (s) => s ? `In Builds${s.column ? ': ' + s.column : ''}` : '';

let env = null;
/** Read Builds' summary now and on every change. onChange: called after each read. Inside Workshop only. */
export function startSlateLink(ws, embedded, onChange = () => {}) {
  if (!ws || !embedded) return;
  const read = () => ws.data.get('summary', { app: 'builds' }).then(e => { env = e; onChange(); }, () => {});
  read();
  try { ws.data.subscribe('summary', read, { app: 'builds' }); } catch { /* no data backend */ }
}
/** Where a task's ADO item is in Builds, from the summary read last. */
export const buildsFor = (adoId) => buildsAbout(env, adoId);

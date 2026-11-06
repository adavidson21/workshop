/* Runway: its summary for other apps (Workshop docs/summaries.md). Two cards:
     roadmaps  the roadmaps, as targets for capture "idea", so Home's quick capture and the Dispatch hub can name one
               without reading Runway's index.
     pending   the ideas on the Pending assignment list (newest first, up to 50), so Slate can show them in its Shape
               lane's New column. Rows: {id, title, due: the day it came in, note: its description, route}.
   main.js writes it with the shared writer (shared/summary.js) whenever the roadmap list or Pending changes. */
export const roadmapsCard = list => ({
  id: 'roadmaps', kind: 'targets', title: 'Roadmaps', capture: 'idea',
  rows: (Array.isArray(list) ? list : []).slice(0, 200).map(r => ({ id: r.id, title: String(r.title || 'Untitled roadmap').slice(0, 120) }))
});

const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** The Pending assignment list as a `list` card (p: pending.v). */
export const pendingCard = p => {
  const items = (p && Array.isArray(p.items) ? p.items : []);
  const rows = items.slice(0, 50).map(x => {
    const r = { id: String(x.id), title: String(x.title || 'Idea').slice(0, 200), route: 'pending' };
    if (isDay(x.date)) r.due = x.date;
    const note = String(x.notes || '').trim();
    if (note) r.note = note.slice(0, 1000);
    return r;
  });
  return { id: 'pending', kind: 'list', title: 'Pending assignment', count: items.length, route: 'pending', rows };
};

/** Every card, or null while the list is not loaded or is read-only (v: the store's view, p: pending.v). The
    pending card is left out until Pending has loaded (or when it is read-only), so a reader never sees it empty
    by mistake. */
export const buildSummary = (v, p = null) => {
  if (!(v && v.loaded && !v.readOnly && !v.waiting)) return null;
  const cards = [roadmapsCard(v.list)];
  if (p && p.loaded && !p.readOnly) cards.push(pendingCard(p));
  return cards;
};

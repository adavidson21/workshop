/* Runway: its summary for other apps (Workshop docs/summaries.md). Three cards:
     roadmaps  the roadmaps, as targets for capture "idea", so Home's quick capture and the Loom hub can name one
               without reading Runway's index.
     pending   the ideas on the Pending assignment list (newest first, up to 50), so Slate can show them in its Shape
               lane's New column. Rows: {id, title, due: the day it came in, note: its description, route, from: the
               sender's app id, when known (Runway 1.15.0)}.
     upcoming  milestones and goals in the next 14 days across roadmaps (Home's Coming up), from each roadmap's
               `soon` in the index (Runway 1.16.0). Rows: {id, title, due, note: the roadmap's name, route: its id}.
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
    if (/^[a-z][a-z0-9-]{0,39}$/.test(String(x.app || ''))) r.from = x.app;
    return r;
  });
  return { id: 'pending', kind: 'list', title: 'Pending assignment', count: items.length, route: 'pending', rows };
};

/** Every roadmap's `soon` within 14 days of `day`, soonest first, as a `list` card. */
export const upcomingCard = (list, day) => {
  const until = new Date(new Date(day + 'T12:00:00').getTime() + 14 * 864e5);
  const end = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`;
  const rows = [];
  for (const r of Array.isArray(list) ? list : []) {
    for (const s of Array.isArray(r.soon) ? r.soon : []) {
      if (!s || !isDay(s.date) || s.date < day || s.date > end) continue;
      rows.push({ id: `${r.id}:${s.kind}:${s.date}:${rows.length}`, title: String(s.title).slice(0, 200), due: s.date, note: `${s.kind === 'goal' ? 'Goal' : 'Milestone'}, ${String(r.title || 'Roadmap').slice(0, 60)}`, route: r.id });
    }
  }
  rows.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return { id: 'upcoming', kind: 'list', title: 'Coming up', count: rows.length, rows: rows.slice(0, 20) };
};

/** Every card, or null while the list is not loaded or is read-only (v: the store's view, p: pending.v). The
    pending card is left out until Pending has loaded (or when it is read-only), so a reader never sees it empty
    by mistake. */
export const buildSummary = (v, p = null, day = '') => {
  if (!(v && v.loaded && !v.readOnly && !v.waiting)) return null;
  const cards = [roadmapsCard(v.list)];
  if (isDay(day)) cards.push(upcomingCard(v.list, day));
  if (p && p.loaded && !p.readOnly) cards.push(pendingCard(p));
  return cards;
};

/* Runway: its summary for other apps (Workshop docs/summaries.md). One card: the roadmaps, as targets for
   capture "idea", so Home's quick capture and the Dispatch hub can name one without reading Runway's index.
   main.js writes it with the shared writer (shared/summary.js) whenever the roadmap list changes. */
export const roadmapsCard = list => ({
  id: 'roadmaps', kind: 'targets', title: 'Roadmaps', capture: 'idea',
  rows: (Array.isArray(list) ? list : []).slice(0, 200).map(r => ({ id: r.id, title: String(r.title || 'Untitled roadmap').slice(0, 120) }))
});

/** Every card, or null while the list is not loaded or is read-only (v: the store's view). */
export const buildSummary = v => (v && v.loaded && !v.readOnly && !v.waiting ? [roadmapsCard(v.list)] : null);

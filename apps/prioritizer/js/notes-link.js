/* Docket and Notes (plan 1, claude/notes-plan-1-app-links.md).

   - Copy link: a task as a Markdown link Notes shows as a chip, [Title](ws:prioritizer/task/<id>). L, or the drawer's
     Copy link button.
   - Notes about this: the notes that link to a task, from Notes' summary (notes.summary, list card `mentions`,
     rows whose `note` is 'prioritizer/task/<id>'). Titles and paths only; Docket never reads Notes' files. Inside
     Workshop only: on Docket's own site there is no Notes data, so the drawer shows just Copy link.

   taskLink and notesAbout are pure (test/notes-link.test.mjs); startNotesLink keeps the summary fresh. */

/* Brackets would end the link text early. */
const linkText = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/\[/g, '(').replace(/\]/g, ')').slice(0, 200) || 'Task';

/** The Markdown link for a task. */
export const taskLink = (t) => `[${linkText(t.title)}](ws:prioritizer/task/${t.id})`;

/** The notes that link to a task, newest first: [{title, route}], from Notes' summary envelope (or null). */
export function notesAbout(env, taskId) {
  if (!env || env.schema !== 'notes.summary' || !Array.isArray(env.items)) return [];
  const card = env.items.find(c => c && c.id === 'mentions' && c.kind === 'list' && Array.isArray(c.rows));
  if (!card) return [];
  const want = `prioritizer/task/${taskId}`, seen = new Set();
  return card.rows.filter(r => r && r.note === want && typeof r.route === 'string' && typeof r.title === 'string' && !seen.has(r.route) && seen.add(r.route))
    .map(r => ({ title: r.title, route: r.route }));
}

/** At most `max` titles to show, and how many more there are. */
export const shown = (list, max = 3) => ({ list: list.slice(0, max), more: Math.max(0, list.length - max) });

let env = null;
/** Read Notes' summary now and on every change. onChange: called after each read. Inside Workshop only. */
export function startNotesLink(ws, embedded, onChange = () => {}) {
  if (!ws || !embedded) return;
  const read = () => ws.data.get('summary', { app: 'notes' }).then(e => { env = e; onChange(); }, () => {});
  read();
  ws.data.subscribe('summary', read, { app: 'notes' });
}
/** Notes about a task, from the summary read last. */
export const notesFor = (taskId) => notesAbout(env, taskId);

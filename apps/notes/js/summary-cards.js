/* Notes' summary for other apps (Workshop docs/summaries.md): titles and paths only, never note text.

   - `count` (id `notes`): how many notes there are.
   - `list` (id `recent`): the 10 notes changed last, each opening that note.
   - `list` (id `mentions`): notes that link to another app's record with a ws: link (applinks.js), newest 20.
     Each row's `note` is the record, '<app>/<route>' (for example 'prioritizer/task/t_k2f9'), so that app can
     show "Notes about this" by matching it. Its title is the note's title; `route` opens the note.
   Templates are left out. Pure: no DOM and no SDK. */
import { appRefs } from './applinks.js';
import { TEMPLATES } from './templates.js';

const RECENT = 10;
const MENTIONS = 20;

/** The cards for an index (model.js buildIndex) and the notes' facts. */
export function notesCards(index) {
  const notes = [...index.notes.values()].filter(n => !n.path.startsWith(`${TEMPLATES}/`));
  const byTime = [...notes].sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.path.localeCompare(b.path));
  const refs = appRefs(new Map(notes.map(n => [n.path, { links: n.appLinks || [] }])));
  const mentions = [];
  for (const [key, list] of refs) for (const r of list) mentions.push({ key, from: r.from });
  const mtime = (p) => index.notes.get(p)?.mtime || 0;
  mentions.sort((a, b) => mtime(b.from) - mtime(a.from) || a.key.localeCompare(b.key));
  const seen = new Set();
  const rows = [];
  for (const m of mentions) {
    const id = `${m.key}|${m.from}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id: id.slice(0, 200), title: index.notes.get(m.from).title.slice(0, 200), route: m.from, note: m.key.slice(0, 200) });
    if (rows.length === MENTIONS) break;
  }
  return [
    { id: 'notes', kind: 'count', title: 'Notes', count: notes.length },
    { id: 'recent', kind: 'list', title: 'Recent notes', count: notes.length,
      rows: byTime.slice(0, RECENT).map(n => ({ id: n.path, title: n.title.slice(0, 200), route: n.path })) },
    { id: 'mentions', kind: 'list', title: 'Notes about other apps', count: seen.size, rows }
  ];
}

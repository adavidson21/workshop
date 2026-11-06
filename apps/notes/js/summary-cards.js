/* Notes' summary for other apps (Workshop docs/summaries.md): titles and paths only, never note text.

   - `count` (id `notes`): how many notes there are.
   - `list` (id `recent`): the 10 notes changed last, each opening that note.
   - `list` (id `mentions`): notes that link to another app's record with a ws: link (applinks.js): each record's
     newest 3 notes, then the rest newest first, up to 50.
     Each row's `note` is the record, '<app>/<route>' (for example 'prioritizer/task/t_k2f9'), so that app can
     show "Notes about this" by matching it. Its title is the note's title; `route` opens the note.
   - `count` (id `review`): product notes Tandem changed since your last review (products.js); `route` is
     `review`, which opens that list.
   - `targets` (id `folders`, capture `note`): where quick capture can put a note: a `today` row (today's note),
     then folders with notes in them, most recently used first, up to 199 (Workshop's "n <folder>: ..."). Leaves out
     templates/, daily/, history/ and attachments/.
   Templates are left out. Pure: no DOM and no SDK. */
import { appRefs } from './applinks.js';
import { DAILY, TEMPLATES } from './templates.js';
import { toReview } from './products.js';

const RECENT = 10;
const FOLDERS = 199;
const NOT_CAPTURE = new Set([TEMPLATES, DAILY, 'history', 'attachments']);

/* [{id, title}]: `today`, then each folder (and parent folder) of a note by its newest note, newest first. */
function captureFolders(notes) {
  const used = new Map();
  for (const n of notes) {
    const segs = n.path.split('/').slice(0, -1);
    if (!segs.length || NOT_CAPTURE.has(segs[0])) continue;
    for (let i = 1; i <= segs.length; i++) {
      const f = segs.slice(0, i).join('/');
      used.set(f, Math.max(used.get(f) || 0, n.mtime || 0));
    }
  }
  const folders = [...used].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, FOLDERS).map(([f]) => ({ id: f, title: f }));
  return [{ id: 'today', title: 'today' }, ...folders];
}
const MENTIONS = 50;
const PER_RECORD = 3;

/** The cards for an index (model.js buildIndex) and the notes' facts. */
export function notesCards(index) {
  const notes = [...index.notes.values()].filter(n => !n.path.startsWith(`${TEMPLATES}/`));
  const byTime = [...notes].sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.path.localeCompare(b.path));
  const refs = appRefs(new Map(notes.map(n => [n.path, { links: n.appLinks || [] }])));
  const mentions = [];
  for (const [key, list] of refs) for (const r of list) mentions.push({ key, from: r.from });
  const mtime = (p) => index.notes.get(p)?.mtime || 0;
  mentions.sort((a, b) => mtime(b.from) - mtime(a.from) || a.key.localeCompare(b.key));
  // Each record's newest PER_RECORD notes first, so an app showing "notes about this" sees them even when many
  // notes link to other things; then the rest, newest first, up to MENTIONS.
  const unique = [];
  const seen = new Set();
  for (const m of mentions) { const id = `${m.key}|${m.from}`; if (!seen.has(id)) { seen.add(id); unique.push({ ...m, id }); } }
  const per = new Map();
  const first = unique.filter(m => { const n = per.get(m.key) || 0; per.set(m.key, n + 1); return n < PER_RECORD; });
  const firstIds = new Set(first.map(m => m.id));
  const order = [...first, ...unique.filter(m => !firstIds.has(m.id))].slice(0, MENTIONS);
  order.sort((a, b) => mtime(b.from) - mtime(a.from) || a.key.localeCompare(b.key));
  const rows = order.map(m => ({ id: m.id.slice(0, 200), title: index.notes.get(m.from).title.slice(0, 200), route: m.from, note: m.key.slice(0, 200) }));
  return [
    { id: 'notes', kind: 'count', title: 'Notes', count: notes.length },
    { id: 'recent', kind: 'list', title: 'Recent notes', count: notes.length,
      rows: byTime.slice(0, RECENT).map(n => ({ id: n.path, title: n.title.slice(0, 200), route: n.path })) },
    { id: 'mentions', kind: 'list', title: 'Notes about other apps', count: unique.length, rows },
    { id: 'folders', kind: 'targets', title: 'Notes folders', capture: 'note', rows: captureFolders(notes) },
    { id: 'review', kind: 'count', title: 'Product notes to review', count: toReview(index).filter(n => !n.path.startsWith(`${TEMPLATES}/`)).length, route: 'review' }
  ];
}

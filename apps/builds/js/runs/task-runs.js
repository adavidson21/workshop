/* Tasks and its agents (Builds 6.23.0): which runs were started from a task in Tasks, and where each one is.

   A task stays a to-do: you may send all of it, or only a part (a step, a question), to the agents, as many times as
   you like, and the task is done when you say so. Builds keeps the link in its own collection `task-runs`
   (builds.task-runs v1): items {id: <run key>, task: <Tasks task id>, part: <what was sent, first line>, folder,
   session, at}. The summary's `tasks` card tells Tasks where each run is: one row per run, {id: <task id>, title:
   <the part>, note: "<station> · <state>", route: <Builds address>, flag: 'urgent' when it waits on you, station,
   state, file: <the document to preview>, folder}. No DOM: tested in Node. */

export const COLLECTION = 'task-runs';
export const SCHEMA = 'builds.task-runs';
export const VERSION = 1;
export const MAX_LINKS = 300;
export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

const TASK = /^[A-Za-z0-9_-]{1,64}$/;
/** A task id from a route's query (`?task=<id>`), or ''. */
export const cleanTask = v => (TASK.test(String(v || '')) ? String(v) : '');

/** The links, newest first. */
export function linksOf(env) {
  if (!env || !readable(env)) return [];
  return env.items.filter(i => i && cleanTask(i.task)).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** A copy with a new link for a run started from a task, from what the start answered ({id, folder, session}). */
export function withRun(env, { task, part, res, now = Date.now() }) {
  const t = cleanTask(task);
  if (!t) return null;
  const r = res || {};
  const folder = typeof r.folder === 'string' ? r.folder : '';
  const session = typeof r.session === 'string' ? r.session : '';
  const id = folder || (session ? 'session:' + session : (r.id != null ? 'id:' + r.id : 't:' + now));
  const next = structuredClone(env || blank());
  next.items = next.items.filter(i => i.id !== id);
  next.items.push({ id, task: t, part: String(part || '').split('\n')[0].trim().slice(0, 160), folder, session, ...(r.id != null ? { itemId: String(r.id) } : {}), at: now });
  if (next.items.length > MAX_LINKS) next.items = next.items.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, MAX_LINKS);
  return next;
}

/** A link's folder: its own, else the folder its session made, else the item with its ADO or local id. */
export function folderOf(link, { sessions = {}, items = [] } = {}) {
  if (link.folder) return link.folder;
  const s = link.session && sessions[link.session];
  if (s && s.folder) return s.folder;
  if (link.itemId) { const it = items.find(x => String(x.id) === link.itemId); if (it) return it.folder; }
  return '';
}

const WORD = { run: 'Working', gate: 'Waiting on you', stuck: 'Pulled off the line', idle: 'Waiting', done: 'Done', starting: 'Starting' };
/**
 * The `tasks` card's rows. `where`: folder or 'session:<id>' -> {station, state, file} from the floor; `done`: folders
 * finished. A run the floor no longer has and that never finished drops out after a day.
 */
export function taskRows(links, { where = new Map(), done = new Set(), sessions = {}, items = [], now = Date.now() } = {}) {
  const rows = [];
  for (const l of links) {
    const folder = folderOf(l, { sessions, items });
    const w = (folder && where.get(folder)) || (l.session && where.get('session:' + l.session)) || null;
    const finished = !!folder && done.has(folder);
    if (!w && !finished && now - (l.at || 0) > 864e5) continue;
    const state = finished ? 'done' : w ? w.state : 'starting';
    const station = finished ? 'Done' : w ? w.station : 'Starting';
    rows.push({ id: l.task, title: l.part || 'Agent run', note: [station, WORD[state]].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ').slice(0, 80),
      route: folder || '', ...(state === 'gate' ? { flag: 'urgent' } : {}), station: String(station || '').slice(0, 40), state, folder, file: (w && w.file) || '', at: l.at || 0 });
  }
  return rows.slice(0, 100);
}

/* A task's agent work (Tasks 13.0.0; Builds 6.23.0 task-runs.js): the runs started from a task, where each is on the
   agents' floor, and its document, shown on the task so you don't switch apps.

   A task stays a to-do. Sending it to the agents is optional, you can send only a part of it (a step, a question),
   as often as you like, and the task is done when you mark it done: a run finishing never completes it.

   Builds' summary card `tasks` has one row per run: {id: <task id>, title: <the part sent>, note, route, flag, station,
   state, folder, file}. runsOf is pure (test/agent-runs.test.mjs); the drawer and rows call runsFor. */
import { docHtml } from '../../../shared/doc-html.js';

const STATES = new Set(['run', 'gate', 'stuck', 'idle', 'done', 'starting']);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** task id -> its runs, newest first, from Builds' summary envelope (or null). */
export function runsOf(env) {
  const out = new Map();
  if (!env || env.schema !== 'builds.summary' || !Array.isArray(env.items)) return out;
  const card = env.items.find(c => c && c.id === 'tasks' && c.kind === 'list' && Array.isArray(c.rows));
  if (!card) return out;
  for (const r of card.rows.slice(0, 100)) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    const run = { title: str(r.title, 160) || 'Agent run', note: str(r.note, 80), route: str(r.route, 200), station: str(r.station, 40),
      state: STATES.has(r.state) ? r.state : 'idle', folder: str(r.folder, 200), file: /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/.test(r.file || '') ? r.file : '', at: Number(r.at) || 0 };
    if (!out.has(r.id)) out.set(r.id, []);
    out.get(r.id).push(run);
  }
  for (const list of out.values()) list.sort((a, b) => b.at - a.at);
  return out;
}

/** The one-line summary for a task's row: the run that needs you first, else the one working, else the newest. */
export function chipOf(runs) {
  if (!runs || !runs.length) return null;
  const pick = runs.find(r => r.state === 'gate') || runs.find(r => r.state === 'stuck') || runs.find(r => r.state === 'run') || runs[0];
  const more = runs.length - 1;
  return { state: pick.state, text: pick.state === 'done' ? 'Agents done' : pick.station || 'Agents', tip: `${pick.title}: ${pick.note || pick.station}${more ? ` (and ${more} more run${more === 1 ? '' : 's'})` : ''}` };
}

let runs = new Map();
/** Read from the Builds summary envelope (agent-queue.js passes every read here). */
export function setRunsEnv(env) { runs = runsOf(env); }
export const runsFor = id => runs.get(id) || [];

/* Previews: a run's document, read through the opencode connector's file.read (the same action Builds and Notes use)
   when you open it, and kept for the page. */
const docs = new Map(); // folder/file -> {text, error, loading}
export function docFor(ws, folder, file, onChange) {
  if (!folder || !file) return null;
  const k = folder + '/' + file;
  const d = docs.get(k);
  if (d) return d;
  const next = { text: null, error: '', loading: true };
  docs.set(k, next);
  if (!ws || !ws.connectors) { next.loading = false; next.error = 'Open Tasks inside Workshop to read it.'; return next; }
  ws.connectors.call('opencode', 'file.read', { folder, file })
    .then(r => { next.text = String((r && r.text) || ''); }, e => { next.error = (e && e.message) || 'Could not read it.'; })
    .finally(() => { next.loading = false; onChange(); });
  return next;
}
export const forgetDoc = (folder, file) => docs.delete(folder + '/' + file);
export const docBody = d => !d || d.loading ? '<p class="soft">Loading.</p>' : d.error ? `<p class="soft">${String(d.error).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>` : d.text.trim() ? `<div class="doc">${docHtml(d.text)}</div>` : '<p class="soft">This file is empty.</p>';

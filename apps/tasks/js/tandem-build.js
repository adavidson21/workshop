/* Build with Tandem (Tasks 12.4.0): any open task can go to Builds' agents, not only one linked to an ADO item.
   The button in a task's details (or B on a selected task) opens Builds' drop box filled in with the task, its kind
   guessed there (a build, an error log to diagnose, a question to look into), and Builds starts it once Tandem is
   ready (Builds' start/go route). The click or key is the approval. Without Tandem Builds keeps it filled in and says
   what works instead (Hand it off). Inside Workshop only, while Builds is on. An ADO-linked task keeps Start as
   feature or bug (eng.js), which keeps the link.

   buildText is pure (test/tandem-build.test.mjs). */
import { taskLink } from './notes-link.js';

const LOOM = 'builds';
const MAX = 8000; // Builds' drop box description cap

/** What the drop box gets for a task: its title, first step and notes, then a link back to the task. With `part`
 *  (Tasks 13.0.0), only that part goes: the part first, then the task it belongs to as context. */
export function buildText(t, part = '') {
  if (!t) return '';
  const title = String(t.title || '').trim();
  if (!title) return '';
  const p = String(part || '').trim();
  if (p) return [p, `Part of the task: ${title}`, `From Tasks: ${taskLink(t)}`].join('\n\n').slice(0, MAX);
  const parts = [title];
  const first = String(t.firstStep || '').trim();
  if (first) parts.push(`First step: ${first}`);
  const notes = String(t.notes || '').trim();
  if (notes) parts.push(notes);
  parts.push(`From Tasks: ${taskLink(t)}`);
  return parts.join('\n\n').slice(0, MAX);
}

/** Builds' address for it: the drop box, filled in and started. */
export const buildPath = (t, part = '') => 'start/go/' + encodeURIComponent(buildText(t, part)) + (t && t.id ? '?task=' + encodeURIComponent(t.id) : '');

/** Can this task go to Tandem from here: open, inside Workshop, Builds on, and not an ADO item (that has its own Start). */
export function canBuild(t, { embedded, buildsOn, adoItem }) {
  return !!(t && !t.done && embedded && buildsOn && !adoItem && String(t.title || '').trim());
}

let buildsKnown = null; // null until known
/** Whether Builds is on this Workshop site (ws.apps.list, as Capture routes), read once per page. */
export function watchLoom(ws, onChange = () => {}) {
  if (!ws || !ws.apps) return;
  ws.apps.list().then(list => {
    const on = Array.isArray(list) && list.some(a => a && a.id === LOOM);
    if (on !== buildsKnown) { buildsKnown = on; onChange(); }
  }).catch(() => {});
}
export const buildsOn = () => buildsKnown === true;

/** Send it: open Builds on the filled-in drop box. Returns false when it could not go. */
export function sendToTandem(ws, t, part = '') {
  const text = buildText(t, part);
  if (!ws || !text) return false;
  ws.open({ app: LOOM, path: buildPath(t, part) }).catch(() => {});
  return true;
}

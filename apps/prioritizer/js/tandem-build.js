/* Build with Tandem (Docket 12.4.0): any open task can go to Loom's agents, not only one linked to an ADO item.
   The button in a task's details (or B on a selected task) opens Loom's drop box filled in with the task, its kind
   guessed there (a build, an error log to diagnose, a question to look into), and Loom starts it once Tandem is
   ready (Loom's start/go route). The click or key is the approval. Without Tandem Loom keeps it filled in and says
   what works instead (Hand it off). Inside Workshop only, while Loom is on. An ADO-linked task keeps Start as
   feature or bug (eng.js), which keeps the link.

   buildText is pure (test/tandem-build.test.mjs). */
import { taskLink } from './notes-link.js';

const LOOM = 'slate';
const MAX = 8000; // Loom's drop box description cap

/** What the drop box gets for a task: its title, first step and notes, then a link back to the task. */
export function buildText(t) {
  if (!t) return '';
  const title = String(t.title || '').trim();
  if (!title) return '';
  const parts = [title];
  const first = String(t.firstStep || '').trim();
  if (first) parts.push(`First step: ${first}`);
  const notes = String(t.notes || '').trim();
  if (notes) parts.push(notes);
  parts.push(`From Docket: ${taskLink(t)}`);
  return parts.join('\n\n').slice(0, MAX);
}

/** Loom's address for it: the drop box, filled in and started. */
export const buildPath = (t) => 'start/go/' + encodeURIComponent(buildText(t));

/** Can this task go to Tandem from here: open, inside Workshop, Loom on, and not an ADO item (that has its own Start). */
export function canBuild(t, { embedded, loomOn, adoItem }) {
  return !!(t && !t.done && embedded && loomOn && !adoItem && String(t.title || '').trim());
}

let loom = null; // null until known
/** Whether Loom is on this Workshop site (ws.apps.list, as Capture routes), read once per page. */
export function watchLoom(ws, onChange = () => {}) {
  if (!ws || !ws.apps) return;
  ws.apps.list().then(list => {
    const on = Array.isArray(list) && list.some(a => a && a.id === LOOM);
    if (on !== loom) { loom = on; onChange(); }
  }).catch(() => {});
}
export const loomOn = () => loom === true;

/** Send it: open Loom on the filled-in drop box. Returns false when it could not go. */
export function sendToTandem(ws, t) {
  const text = buildText(t);
  if (!ws || !text) return false;
  ws.open({ app: LOOM, path: buildPath(t) }).catch(() => {});
  return true;
}

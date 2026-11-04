/* Notes: captures from Home and the Dispatch hub (docs/handoffs.md, docs/hub.md).

   A note captured in Home's quick capture or the Dispatch hub arrives as an offer in that app's own `handoffs`
   collection, addressed to `notes` with payload.kind 'note' and accepted: true. The person already accepted it
   where they typed it, so Notes writes it as a new note in `inbox/` the next time it loads, with no second click.

   Notes records each capture it handled in its own collection `taken` (notes.taken v1; items {id: '<app>:<offer
   id>', path}), never in the sender's. A capture is written once: a note deleted later does not come back.

   acceptedNotes and noteFile are pure (apps/notes/test/pickup.test.mjs); startPickup does the reading and writing. */
import { freePath, newNoteText, slugify } from './model.js';

export const SENDERS = { home: 'Home', agents: 'Dispatch' };
export const INBOX = 'inbox';
const VERSION = 1;
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Accepted note offers from one sender that Notes has not taken. taken: Set of '<app>:<id>'. */
export function acceptedNotes(app, env, taken = new Set()) {
  if (!env || env.schema !== `${app}.handoffs` || env.version !== VERSION || !Array.isArray(env.items)) return [];
  return env.items.filter(h => h && typeof h.id === 'string' && h.id && h.to === 'notes' && h.accepted === true && isDay(h.date)
      && h.payload && h.payload.kind === 'note' && typeof h.text === 'string' && h.text.trim() && !taken.has(`${app}:${h.id}`))
    .map(h => {
      const text = h.text.trim().slice(0, 20000);
      const first = text.split('\n')[0].trim();
      const title = (typeof h.payload.title === 'string' && h.payload.title.trim() ? h.payload.title.trim() : first).replace(/\s+/g, ' ').slice(0, 120) || 'Captured note';
      return { key: `${app}:${h.id}`, app, from: SENDERS[app] || app, id: h.id, date: h.date, title, text };
    });
}

/* The file for one capture: a free path in inbox/ and its Markdown. paths: Set of every path Notes has. */
export function noteFile(o, paths) {
  const path = freePath(paths, INBOX, slugify(o.title, 'captured'), 'md');
  const body = o.text === o.title ? '' : o.text + '\n';
  return { path, content: newNoteText(o.title) + body + `\nCaptured in ${o.from} on ${o.date}.\n` };
}

/* Read the senders, write what is new, record it. notes: the data layer (createNotes), for the paths it knows.
   Returns the number of notes written. Safe to call often: one run at a time. */
export function startPickup(ws, notes, { onAdded = () => {} } = {}) {
  let running = false, again = false;

  async function taken() {
    const env = await ws.data.get('taken');
    if (env && (env.schema !== 'notes.taken' || env.version !== VERSION)) return null; // a newer Notes: do nothing
    return env || { schema: 'notes.taken', version: VERSION, rev: 0, items: [], deleted: {} };
  }

  async function run() {
    if (running) { again = true; return 0; }
    running = true;
    let added = 0;
    try {
      const env = await taken();
      if (!env) return 0;
      const done = new Set([...env.items.map(i => i.id), ...Object.keys(env.deleted || {})]);
      const todo = [];
      for (const app of Object.keys(SENDERS)) {
        let src = null;
        try { src = await ws.data.get('handoffs', { app }); } catch (e) { src = null; }
        todo.push(...acceptedNotes(app, src, done));
      }
      if (!todo.length) return 0;
      const paths = new Set(notes.files ? notes.files.keys() : []);
      const written = [];
      for (const o of todo) {
        const f = noteFile(o, paths);
        try { await ws.files.write(f.path, f.content, { create: true }); }
        catch (e) {
          if (e.code !== 'conflict') throw e;
          paths.add(f.path);
          const g = noteFile(o, paths);
          await ws.files.write(g.path, g.content, { create: true });
          f.path = g.path;
        }
        paths.add(f.path);
        written.push({ id: o.key, path: f.path });
      }
      const before = env, after = structuredClone(env);
      after.items.push(...written);
      ws.data.stamp(before, after);
      try { await ws.data.put('taken', after); }
      catch (e) {
        if (e.code !== 'conflict' || !e.current) throw e;
        await ws.data.put('taken', ws.data.merge(after, e.current));
      }
      added = written.length;
      if (added) onAdded(written, todo[0].from);
    } catch (e) {
      // Waiting for the folder, or a write failed: try again on the next change.
    } finally {
      running = false;
      if (again) { again = false; setTimeout(run, 0); }
    }
    return added;
  }

  for (const app of Object.keys(SENDERS)) ws.data.subscribe('handoffs', run, { app });
  return { run };
}

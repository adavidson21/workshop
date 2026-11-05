/* Notes: captures from Home and the Dispatch hub (docs/handoffs.md, docs/hub.md).

   A note captured in Home's quick capture or the Dispatch hub arrives as an offer in that app's own `handoffs`
   collection, addressed to `notes` with payload.kind 'note' and accepted: true. The person already accepted it
   where they typed it, so Notes adds it the next time it loads, with no second click:
     - from Home: a bullet in the one Quick Notes note (`quick-notes.md`, pinned in the sidebar), newest first
       under a heading for its day. A Quick Notes that was trashed or renamed is made again on the next capture.
     - from Dispatch: a new note in `inbox/`.

   Notes records each capture it handled in its own collection `taken` (notes.taken v1; items {id: '<app>:<offer
   id>', path}), never in the sender's. A capture is written once: a note deleted later does not come back.

   acceptedNotes, noteFile, quickEntry and addToQuick are pure (apps/notes/test/pickup.test.mjs); startPickup does the reading and writing. */
import { freePath, newNoteText, slugify } from './model.js';

export const SENDERS = { home: 'Home', agents: 'Dispatch' };
/* Who sends Notes captures, from the manifests on this site (ws.apps.list(); docs/handoffs.md, Senders): every app
   whose handoffs.sends lists notes, added to the built-in list. Reading an app that is not there finds nothing. */
export function sendersFrom(apps, self = 'notes', fallback = SENDERS) {
  const found = (Array.isArray(apps) ? apps : []).filter(a => a && a.id !== self && a.handoffs && Array.isArray(a.handoffs.sends) && a.handoffs.sends.includes(self));
  return { ...fallback, ...Object.fromEntries(found.map(a => [a.id, a.name || a.id])) };
}
export const INBOX = 'inbox';
export const QUICK = 'quick-notes.md';
export const QUICK_TITLE = 'Quick Notes';
export const QUICK_FROM = new Set(['home']);
const QUICK_HEAD = `# ${QUICK_TITLE}\n\nNotes you capture on Home land here, newest first.\n`;
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
      return { key: `${app}:${h.id}`, app, from: SENDERS[app] || app, id: h.id, date: h.date, at: typeof h.createdAt === 'string' ? h.createdAt : '', title, text };
    });
}

/* The file for one capture: a free path in inbox/ and its Markdown. paths: Set of every path Notes has. */
export function noteFile(o, paths) {
  const path = freePath(paths, INBOX, slugify(o.title, 'captured'), 'md');
  const body = o.text === o.title ? '' : o.text + '\n';
  return { path, content: newNoteText(o.title) + body + `\nCaptured in ${o.from} on ${o.date}.\n` };
}

/* One capture as a Markdown bullet. Later lines are indented so they stay in the bullet. */
export function quickEntry(o) {
  const lines = o.text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return '- ' + lines.map((l, i) => (i && l ? '  ' + l : l)).join('\n');
}

/* Quick Notes with captures added. content: the note as it is ('' or null when there is none). entries: oldest
   first. Each goes at the top of the list under its day's `## YYYY-MM-DD` heading; a missing day heading is put
   above the first `## ` heading (so newer days come first), or at the end when there is none. */
export function addToQuick(content, entries) {
  let lines = (content && content.trim() ? content.replace(/\r\n?/g, '\n') : QUICK_HEAD).split('\n');
  for (const o of entries) {
    const head = `## ${o.date}`;
    const bullet = quickEntry(o).split('\n');
    let at = lines.findIndex(l => l.trim() === head);
    if (at >= 0) {
      let i = at + 1;
      while (i < lines.length && !lines[i].trim()) i++;
      lines.splice(at + 1, i - at - 1, '', ...bullet);
      continue;
    }
    const first = lines.findIndex(l => /^## /.test(l));
    if (first >= 0) lines.splice(first, 0, head, '', ...bullet, '');
    else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push('', head, '', ...bullet);
    }
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

/* Read the senders, write what is new, record it. notes: the data layer (createNotes), for the paths it knows.
   hold(path): true while the person has unsaved edits in that note, so Quick Notes waits (run again after a save).
   Returns the number of captures added. Safe to call often: one run at a time. */
export function startPickup(ws, notes, { onAdded = () => {}, hold = () => false } = {}) {
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
      const quick = hold(QUICK) ? [] : todo.filter(o => QUICK_FROM.has(o.app));
      const files = todo.filter(o => !QUICK_FROM.has(o.app));
      if (!quick.length && !files.length) return 0;
      const paths = new Set(notes.files ? notes.files.keys() : []);
      const written = [];
      if (quick.length) {
        quick.sort((a, b) => (a.date + a.at + a.id < b.date + b.at + b.id ? -1 : 1));
        for (let tries = 0; ; tries++) {
          const cur = await ws.files.read(QUICK);
          const content = addToQuick(cur ? cur.content : '', quick);
          try { await ws.files.write(QUICK, content, cur ? { mtime: cur.mtime } : { create: true }); break; }
          catch (e) { if (e.code !== 'conflict' || tries >= 2) throw e; }
        }
        paths.add(QUICK);
        written.push(...quick.map(o => ({ id: o.key, path: QUICK })));
      }
      for (const o of files) {
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
      if (added) onAdded(written, (quick[0] || files[0]).from);
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

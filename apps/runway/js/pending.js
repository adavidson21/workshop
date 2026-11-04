/* Pending: ideas captured elsewhere that wait for a roadmap. No DOM, so Node tests drive it with a fake `ws`.

   Home's quick capture or the Dispatch hub (Workshop, docs/hub.md) sends a feature, bug or other thought for a roadmap as an offer
   in that app's own `handoffs` collection: to 'runway', payload {kind: 'idea', map?: <roadmap id>}, accepted: true.
   The person accepted it where they typed it, so Runway takes it with no second click:
     - with a `map` that is in the roadmap list: a new unscheduled item in that roadmap (its Unscheduled tray).
     - otherwise: an idea on the Pending page, until it is assigned to a roadmap, a lane and optionally an item
       to sit under (it then becomes an ordinary item there, unscheduled), or removed.

   Collections (version 1, docs/data-format.md):
     pending   ideas: {id, title, notes, date, from}
     taken     captures already handled: {id: '<app>:<offer id>', to: 'pending' | <roadmap id>}. A capture is
               taken once: an idea removed later does not come back.
   Runway never writes another app's data. */
import { APP, VERSION, cleanItem, newId, nextOrder, parentChoices, validMapId } from './model.js';

export const SENDERS = { home: 'Home', agents: 'Dispatch' };
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const blank = (name) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {} });

/** Accepted idea offers from one sender that Runway has not taken. taken: Set of '<app>:<id>'. */
export function acceptedIdeas(app, env, taken = new Set()) {
  if (!env || env.schema !== `${app}.handoffs` || env.version !== 1 || !Array.isArray(env.items)) return [];
  return env.items.filter(h => h && typeof h.id === 'string' && h.id && h.to === APP && h.accepted === true && isDay(h.date)
      && h.payload && h.payload.kind === 'idea' && typeof h.text === 'string' && h.text.trim() && !taken.has(`${app}:${h.id}`))
    .map(h => {
      const text = h.text.trim().slice(0, 4000);
      const [first, ...rest] = text.split('\n');
      return {
        key: `${app}:${h.id}`, app, from: SENDERS[app] || app, date: h.date, at: typeof h.createdAt === 'string' ? h.createdAt : '',
        title: first.trim().replace(/\s+/g, ' ').slice(0, 200) || 'Idea', notes: rest.join('\n').trim(),
        map: validMapId(h.payload.map) ? h.payload.map : null
      };
    });
}

/** An idea as a roadmap item: unscheduled, in `lane`, under `parent` when that is allowed. */
export function ideaToItem(doc, idea, { lane = null, parent = null } = {}) {
  const it = cleanItem({ id: newId('i'), kind: 'item', lane, order: nextOrder(doc, lane), title: idea.title, notes: idea.notes });
  if (parent && parentChoices(doc, null, lane).some(x => x.id === parent)) it.parent = parent;
  return it;
}

/**
 * The Pending page's data. addToMap(mapId, idea, {lane, parent}) adds an item to a roadmap (main.js uses the
 * store for the open roadmap, writeToMap for the others); hasMap(id) says whether a roadmap is in the list.
 */
export function createPending(ws, { onChange = () => {}, addToMap, hasMap = () => false } = {}) {
  const v = { items: [], loaded: false, readOnly: false };
  let env = null;
  let running = false, again = false;

  async function read(name) {
    const e = await ws.data.get(name);
    if (e && (e.schema !== `${APP}.${name}` || e.version > VERSION)) return null; // a newer Runway: leave it alone
    return e || blank(name);
  }

  /** Write a collection: stamp against what was read, put, and merge on a conflict. Resolves what was stored. */
  async function write(name, before, after) {
    ws.data.stamp(before, after);
    try { const r = await ws.data.put(name, after); return { ...after, rev: r.rev }; }
    catch (e) {
      if (e.code !== 'conflict' || !e.current) throw e;
      const merged = ws.data.merge(after, e.current);
      const r = await ws.data.put(name, merged);
      return { ...merged, rev: r.rev };
    }
  }

  const show = (e) => {
    env = e;
    v.items = (e.items || []).filter(x => x && x.id && x.title)
      .map(x => ({ id: x.id, title: String(x.title).slice(0, 200), notes: String(x.notes || '').slice(0, 4000), date: isDay(x.date) ? x.date : '', from: String(x.from || '') }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    onChange(v);
  };

  async function load() {
    const e = await read('pending');
    if (!e) { v.readOnly = true; v.loaded = true; onChange(v); return; }
    v.loaded = true;
    show(e);
  }

  async function change(fn) {
    const before = (await read('pending')) || env;
    if (!before || v.readOnly) return;
    const after = structuredClone(before);
    fn(after);
    show(await write('pending', before, after));
  }

  /** Take new captures: to their roadmap, or to Pending. Safe to call often: one run at a time. */
  async function pickup() {
    if (running) { again = true; return 0; }
    running = true;
    let n = 0;
    try {
      const taken = await read('taken');
      if (!taken) return 0;
      const done = new Set([...taken.items.map(i => i.id), ...Object.keys(taken.deleted || {})]);
      const todo = [];
      for (const app of Object.keys(SENDERS)) {
        let src = null;
        try { src = await ws.data.get('handoffs', { app }); } catch { src = null; }
        todo.push(...acceptedIdeas(app, src, done));
      }
      if (!todo.length) return 0;
      todo.sort((a, b) => (a.at + a.key < b.at + b.key ? -1 : 1));
      const record = [];
      const toPending = [];
      for (const o of todo) {
        if (o.map && hasMap(o.map) && addToMap) {
          await addToMap(o.map, o, {});
          record.push({ id: o.key, to: o.map });
        } else {
          toPending.push(o);
          record.push({ id: o.key, to: 'pending' });
        }
      }
      if (toPending.length) await change(e => { for (const o of toPending) e.items.push({ id: newId('p'), title: o.title, notes: o.notes, date: o.date, from: o.from }); });
      const after = structuredClone(taken);
      after.items.push(...record);
      await write('taken', taken, after);
      n = record.length;
    } catch {
      // Waiting for the folder, or a write failed: try again on the next change.
    } finally {
      running = false;
      if (again) { again = false; setTimeout(pickup, 0); }
    }
    return n;
  }

  return {
    v, load, pickup,
    /** Assign an idea to a roadmap: it becomes an unscheduled item there, and leaves Pending. */
    async assign(id, mapId, { lane = null, parent = null } = {}) {
      const idea = v.items.find(x => x.id === id);
      if (!idea || !addToMap) return false;
      await addToMap(mapId, idea, { lane, parent });
      await change(e => { e.items = e.items.filter(x => x.id !== id); });
      return true;
    },
    async remove(id) { await change(e => { e.items = e.items.filter(x => x.id !== id); }); },
    async rename(id, title) {
      const t = String(title || '').trim().slice(0, 200);
      if (t) await change(e => { const x = e.items.find(i => i.id === id); if (x) x.title = t; });
    }
  };
}

/** Add an idea to a roadmap that is not open, straight to its collection (maps/<id>), merging on a conflict. */
export async function writeToMap(ws, mapId, fromEnvelope, idea, opts) {
  const name = `maps/${mapId}`;
  const before = await ws.data.get(name);
  if (before && before.version > VERSION) throw Object.assign(new Error('That roadmap was saved by a newer Runway.'), { code: 'newer' });
  const base = before || { schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {}, meta: { updatedAt: 0 } };
  const doc = fromEnvelope(base);
  const it = ideaToItem(doc, idea, opts);
  const after = structuredClone(base);
  after.items.push(it);
  ws.data.stamp(base, after);
  try { await ws.data.put(name, after); }
  catch (e) {
    if (e.code !== 'conflict' || !e.current) throw e;
    await ws.data.put(name, ws.data.merge(after, e.current));
  }
  return it;
}

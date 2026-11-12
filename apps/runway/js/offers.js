/* Runway's offers to other apps (Workshop docs/handoffs.md), in its own `handoffs` collection (version 1).

   One kind: `roadmap-item`, to the app that manages work items (Workshop's Slate), sent when you click Work item
   on a roadmap item. It carries what Slate needs to make its card (title, notes, level, the ADO link), so Slate
   never reads Runway's roadmaps. accepted: true, because the click is the person's own (handoffs rule 4).
   No DOM, so Node tests drive it with a fake `ws`. */
import { APP } from './model.js';

const LEVELS = ['epic', 'feature', 'story', 'story'];
const KEEP_DAYS = 60;
const pad = n => String(n).padStart(2, '0');
const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const blank = () => ({ schema: `${APP}.handoffs`, version: 1, rev: 0, items: [], deleted: {} });

/** The offer for item `itemId` of roadmap `mapId` (doc: the open roadmap), to app `to`; null when the item is gone. */
export function roadmapItemOffer(doc, mapId, itemId, to, now = new Date()) {
  const items = (doc && Array.isArray(doc.items)) ? doc.items : [];
  const it = items.find(x => x && x.id === itemId && x.kind === 'item');
  if (!it || !to) return null;
  let depth = 0, p = it;
  while (p && p.parent && depth < 4) { p = items.find(x => x.id === p.parent); depth++; }
  const title = String(it.title || 'Untitled').slice(0, 300);
  const notes = String(it.notes || '').slice(0, 4000);
  const payload = { kind: 'roadmap-item', map: mapId, item: itemId, title, notes, level: LEVELS[depth] || 'story' };
  if (it.ado && Number.isInteger(it.ado.id)) {
    payload.ado = { id: it.ado.id, rev: Number(it.ado.rev) || 0, type: String(it.ado.type || ''), url: String(it.ado.url || ''), connection: String(it.ado.connection || ''), state: String(it.ado.state || '') };
  }
  return {
    id: `h_${mapId}_${itemId}_${to}`.slice(0, 120), to, date: day(now), createdAt: now.toISOString(),
    text: (notes ? `${title}\n${notes}` : title).slice(0, 2000), accepted: true, payload, source: { app: APP, id: itemId }
  };
}

/** Write `offer` to Runway's handoffs: the same id replaces the old one; offers older than 60 days drop off. */
export async function sendOffer(ws, offer, now = new Date()) {
  const cut = day(new Date(now.getTime() - KEEP_DAYS * 864e5));
  const build = (before) => {
    const after = structuredClone(before);
    after.items = after.items.filter(x => x && x.id !== offer.id && (!x.date || x.date >= cut));
    after.items.push({ ...offer });
    return ws.data.stamp(before, after);
  };
  let before = null;
  try { before = await ws.data.get('handoffs'); } catch (e) { if (e && e.code !== 'not_found') throw e; }
  if (!before || before.schema !== `${APP}.handoffs`) before = blank();
  if (before.version > 1) throw new Error('Runway\'s offers were saved by a newer Runway. Update Runway first.');
  const after = build(before);
  try { await ws.data.put('handoffs', after); }
  catch (e) {
    if (!(e && e.code === 'conflict' && e.current)) throw e;
    await ws.data.put('handoffs', build(e.current));
  }
}

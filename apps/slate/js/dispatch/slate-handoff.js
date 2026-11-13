/* Dispatch: tell Slate about work started here (Workshop docs/handoffs.md, Receivers: slate, kind `work`), so every
   run has a card on Slate's board from start to resolved. The person's Start click is the acceptance (rule 4), so the
   offer is `accepted: true` and Slate adds it when it next loads. Loom's `handoffs` collection is shared with the
   hub's captures (shared/capture-box.js); both stamp against what they read and merge on a conflict, so neither
   loses the other's offers. Pure parts (workOffer) are tested in Node. */

const KEEP_DAYS = 60; // docs/handoffs.md, rule 1
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/**
 * The offer for one started run. `r` is what Start sent and got back: {action, args, res, from}. `start` (an ADO
 * work item) has no folder yet, so Slate links it by ADO id; `start.local` has its folder and local id. Spikes are
 * not work and get no offer (null).
 */
export function workOffer(r, now = new Date()) {
  if (!r || !r.args || (r.action !== 'start' && r.action !== 'start.local')) return null;
  const a = r.args, res = r.res || {};
  const folder = typeof res.folder === 'string' && FOLDER.test(res.folder) ? res.folder : '';
  const ado = r.action === 'start' && /^\d{1,10}$/.test(String(a.id || '')) ? Number(a.id) : null;
  if (!folder && !ado) return null;
  const title = String(a.title || (ado ? `#${ado}` : folder)).replace(/\s+/g, ' ').trim().slice(0, 300);
  const key = folder || `ado-${ado}`;
  const payload = { kind: 'work', title, lane: a.lane === 'bug' ? 'bug' : 'feature' };
  if (folder) payload.folder = folder;
  if (res.id) payload.id = String(res.id).slice(0, 20);
  if (ado) payload.ado = ado;
  if (a.description) payload.description = String(a.description).slice(0, 4000);
  if (a.project) payload.project = String(a.project).slice(0, 80);
  if (r.from && FOLDER.test(r.from)) payload.from = r.from;
  const day = now.toISOString().slice(0, 10);
  return { id: `h_work_${key}`.slice(0, 200), to: 'slate', date: day, createdAt: now.toISOString(), text: title || key, accepted: true, payload, source: { app: 'slate', id: key.slice(0, 200) } };
}

/** Add the offer to Dispatch's `handoffs` collection (same id replaces), keeping 60 days. Throws if it cannot. */
export async function sendWork(ws, offer, now = new Date()) {
  if (!offer) return;
  const blank = { schema: 'slate.handoffs', version: 1, rev: 0, items: [], deleted: {} };
  const before = (await ws.data.get('handoffs')) || blank;
  if (before.schema !== 'slate.handoffs' || before.version !== 1) return; // a newer Loom wrote it: leave it alone
  const cut = now.getTime() - KEEP_DAYS * 864e5;
  const after = structuredClone(before);
  after.items = after.items.filter(i => i.id !== offer.id && !(Date.parse(i.createdAt) < cut));
  after.items.push({ ...offer, updatedAt: now.getTime() });
  ws.data.stamp(before, after);
  try { await ws.data.put('handoffs', after); }
  catch (e) {
    if (e.code !== 'conflict' || !e.current) throw e;
    await ws.data.put('handoffs', ws.data.merge(after, e.current));
  }
}

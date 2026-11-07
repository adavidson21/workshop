/* Slate: everything that leaves the page. Its own collections through ws.data, ADO through the ADO connector,
   and Tandem through the opencode connector (connectors/opencode, lib/slate.mjs). No DOM.

   Writes stamp against what was read and merge on a conflict (docs/data-format.md), so two windows, or Slate and
   a Workshop data import, never lose each other's changes. */
import { APP, VERSION, applyWork, cleanItem, cleanPrefs, sentIdeaTitles } from './model.js';

const blank = (name) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {} });

export function createStore(ws, { onChange = () => {} } = {}) {
  const v = { items: [], prefs: cleanPrefs(), dismissed: [], loaded: false, readOnly: false, error: '' };
  const env = { items: null, handoffs: null };

  async function read(name) {
    const e = await ws.data.get(name);
    if (e && (e.schema !== `${APP}.${name}` || e.version > VERSION)) return null; // a newer Slate wrote it: leave it alone
    return e || blank(name);
  }

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

  const show = () => {
    v.items = ((env.items && env.items.items) || []).filter(x => x && x.id).map(cleanItem);
    v.prefs = cleanPrefs(env.items && env.items.meta && env.items.meta.fields);
    const d = env.items && env.items.meta && env.items.meta.dismissed;
    v.dismissed = Array.isArray(d) ? d.filter(x => typeof x === 'string' && x.length <= 80).slice(-500) : [];
    v.sentIdeas = sentIdeaTitles(env.handoffs);
    onChange(v);
  };

  async function load() {
    v.error = '';
    try {
      env.items = await read('items');
      if (!env.items) { v.readOnly = true; env.items = blank('items'); v.error = 'A newer version of Slate saved these items. Update Workshop to change them.'; }
      env.handoffs = (await read('handoffs')) || blank('handoffs');
      v.loaded = true;
    } catch (e) {
      v.error = e && e.message ? e.message : 'Slate could not read its items.';
    }
    show();
  }

  /** Change items: fn(items array, as plain records) may add, edit or remove. Resolves the stored items. */
  async function change(fn) {
    if (v.readOnly) throw Object.assign(new Error('A newer version of Slate saved these items. Update Workshop to change them.'), { code: 'unsupported' });
    const before = (await read('items')) || env.items;
    const after = structuredClone(before);
    fn(after.items);
    after.items = after.items.map(cleanItem);
    env.items = await write('items', before, after);
    show();
    return v.items;
  }

  /** Save the field settings (items' meta.fields), keeping anything else in meta. */
  async function savePrefs(prefs) {
    if (v.readOnly) throw Object.assign(new Error('A newer version of Slate saved these items. Update Workshop to change them.'), { code: 'unsupported' });
    const before = (await read('items')) || env.items;
    const after = structuredClone(before);
    after.meta = { ...(after.meta || {}), fields: cleanPrefs(prefs) };
    env.items = await write('items', before, after);
    show();
    return v.prefs;
  }

  /** Hide a Runway pending idea from New (items' meta.dismissed), keeping anything else in meta. */
  async function dismiss(id) {
    if (v.readOnly) throw Object.assign(new Error('A newer version of Slate saved these items. Update Workshop to change them.'), { code: 'unsupported' });
    const before = (await read('items')) || env.items;
    const after = structuredClone(before);
    const was = Array.isArray(after.meta && after.meta.dismissed) ? after.meta.dismissed : [];
    after.meta = { ...(after.meta || {}), dismissed: [...was.filter(x => x !== id), String(id)].slice(-500) };
    env.items = await write('items', before, after);
    show();
  }

  /**
   * Work started in Dispatch (handoffs to Slate, kind `work`): add or link a card for each offer not handled yet,
   * and record its id in items' `meta.handled` (docs/handoffs.md, rule 2) in the same write. Returns the ids added.
   */
  async function takeWork(offers) {
    if (v.readOnly || !v.loaded) return [];
    const was = new Set(Array.isArray(env.items && env.items.meta && env.items.meta.handled) ? env.items.meta.handled : []);
    const key = (o) => `${(o.source && o.source.app) || ''}:${o.id}`.slice(0, 200);
    const fresh = offers.filter(o => o && o.id && !was.has(key(o)));
    if (!fresh.length) return [];
    const before = (await read('items')) || env.items;
    const after = structuredClone(before);
    const handled = Array.isArray(after.meta && after.meta.handled) ? after.meta.handled.filter(x => typeof x === 'string') : [];
    const done = new Set(handled);
    const added = [];
    for (const o of fresh) {
      if (done.has(key(o))) continue;
      const id = applyWork(after.items, o);
      if (id) added.push(id);
      handled.push(key(o));
      done.add(key(o));
    }
    after.items = after.items.map(cleanItem);
    after.meta = { ...(after.meta || {}), handled: handled.slice(-500) };
    env.items = await write('items', before, after);
    show();
    return added;
  }

  /** Change one item by id. Returns the item as stored. */
  async function update(id, fn) {
    let out = null;
    await change(list => { const it = list.find(x => x.id === id); if (it) { fn(it); out = it; } });
    return out && v.items.find(x => x.id === id);
  }

  /** Offer something to another app (docs/handoffs.md): an idea to Runway, a task to Docket. Same id = same offer. */
  async function offer(item) {
    const before = (await read('handoffs')) || env.handoffs;
    const after = structuredClone(before);
    after.items = after.items.filter(x => x.id !== item.id);
    after.items.push({ ...item, updatedAt: Date.now() });
    // Keep 60 days of offers (rule 1).
    const cut = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    after.items = after.items.filter(x => !x.date || x.date >= cut);
    env.handoffs = await write('handoffs', before, after);
    show();
  }

  /** Rewrite Slate's summary (Workshop docs/summaries.md): the cards replace what was there. Skipped when unchanged. */
  let lastSummary = '';
  async function writeSummary(cards) {
    if (v.readOnly) return;
    const key = JSON.stringify(cards.map(c => ({ ...c, updatedAt: 0 })));
    if (key === lastSummary) return;
    const before = (await read('summary')) || blank('summary');
    const after = { ...structuredClone(before), items: cards };
    await write('summary', before, after);
    lastSummary = key;
  }

  ws.data.subscribe('items', () => load().catch(() => {}));
  return { v, load, change, update, savePrefs, dismiss, offer, writeSummary, takeWork };
}

/* ---------- connectors ---------- */

/**
 * Offers to Slate from every sender (`senders`: {app id: name}, from the manifests): accepted `work` items only.
 * A sender with no collection, or one Slate cannot read, has none.
 */
export async function readWorkOffers(ws, senders) {
  const out = [];
  for (const app of Object.keys(senders)) {
    let e = null;
    try { e = await ws.data.get('handoffs', { app }); } catch { e = null; }
    if (!e || e.schema !== `${app}.handoffs` || e.version !== 1 || !Array.isArray(e.items)) continue;
    for (const o of e.items) if (o && o.to === APP && o.accepted === true && o.payload && o.payload.kind === 'work' && o.source && o.source.app === app) out.push(o);
  }
  return out;
}

/** Which connectors are ready: {ado, opencode} as true or the reason they are not. */
export async function connectorState(ws) {
  if (ws.backend !== 'agent') return { ado: 'Connect Workshop on this computer to use Azure DevOps.', opencode: 'Connect Workshop on this computer to use Tandem.' };
  let list = [];
  try { list = await ws.connectors.list(); } catch { list = []; }
  const one = (id, name) => {
    const c = list.find(x => x.id === id);
    if (!c) return `The ${name} connector is not installed.`;
    if (!c.enabled) return `Turn on the ${name} connector in Settings.`;
    if (!c.status || c.status.state !== 'ready') return (c.status && c.status.message) || `The ${name} connector is not ready.`;
    return true;
  };
  return { ado: one('ado', 'Azure DevOps'), opencode: one('opencode', 'opencode') };
}

export const ado = (ws, action, args = {}, opts) => ws.connectors.call('ado', action, args, opts);
export const tandem = (ws, action, args = {}, opts) => ws.connectors.call('opencode', action, args, opts);

/** The define folder's gate files, read through the opencode connector: {name: text}. Missing files are left out. */
export async function readFiles(ws, folder, names) {
  const out = {};
  await Promise.all(names.map(async (file) => {
    try { out[file] = (await tandem(ws, 'file.read', { folder, file })).text; } catch { /* not written yet */ }
  }));
  return out;
}

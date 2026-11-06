/* Slate: everything that leaves the page. Its own collections through ws.data, ADO through the ADO connector,
   and Tandem through the opencode connector (connectors/opencode, lib/slate.mjs). No DOM.

   Writes stamp against what was read and merge on a conflict (docs/data-format.md), so two windows, or Slate and
   a Workshop data import, never lose each other's changes. */
import { APP, VERSION, cleanItem } from './model.js';

const blank = (name) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {} });

export function createStore(ws, { onChange = () => {} } = {}) {
  const v = { items: [], loaded: false, readOnly: false, error: '' };
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
  }

  ws.data.subscribe('items', () => load().catch(() => {}));
  return { v, load, change, update, offer };
}

/* ---------- connectors ---------- */

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

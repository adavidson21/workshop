/* Roadmap: loading, saving and ADO calls through the SDK, with no DOM, so Node tests can drive it with a fake
   `ws`. main.js owns the page and repaints through onChange.

   ADO is the source of truth for Epics and Features. The app keeps five collections of its own (all version 1):
     products  items: {id, name, areas[]}; meta: settings (model.js DEFAULT_SETTINGS)
     cadence   items: ceremonies {id, name, dueDay, last, minutes, planKind, role}
     seen      {id, rev} per Epic or Feature: the ADO revision you last looked at
     snapshot  the last roadmap result, replaced on every refresh, so the roadmap opens fast and shows while ADO
               or Workshop is unreachable. meta also caches sprint dates per project.
     handoffs  offers to Docket (workshop docs/handoffs.md): one every-sprint task per ceremony
   It reads, never writes: queue.settings (area paths, connection), and Docket's dayplan/settings (the sprint) and
   dayplan/recurring (which ceremonies Docket accepted). ADO is only read. */
import { APP, DOCKET, DOCKET_VERSION, VERSION, areasToFetch, cleanCeremony, cleanProduct, cleanSettings, docketSprint, projectOf, queueInfo, readable, syncOffers, todayOf } from './model.js';

const ADO = 'ado';
const COLLECTIONS = ['products', 'cadence', 'seen', 'snapshot', 'handoffs'];
const blank = (name, meta) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {}, ...(meta ? { meta: { updatedAt: 0, ...meta } } : {}) });

export function createPm(ws, { onChange = () => {}, now = () => Date.now() } = {}) {
  const v = {
    loaded: false,
    waiting: false,               // the browser's folder store needs Allow
    newer: '',                    // a collection saved by a newer Roadmap: read only
    settings: cleanSettings({}),
    products: [],
    cadence: [],
    seen: {},
    items: [],
    snap: { fetchedAt: null, connection: '', total: 0, truncated: false, childrenTruncated: false, iterations: {}, areas: [] },
    offers: [],                   // pm.handoffs items
    queue: { areas: [], connection: '' },
    docket: { state: 'unset', sprint: null },
    recurring: [],                // Docket's every-sprint items, to see which ceremonies it accepted
    ado: { state: 'loading', message: '' },  // 'ready' | 'off' | 'browser' | 'loading'
    refreshing: false,
    refreshError: ''
  };
  const env = {};
  const changed = () => onChange(v);

  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  async function read(name) {
    const e = await ws.data.get(name);
    if (e && e.version > VERSION) { v.newer = name; env[name] = e; return e; }
    env[name] = e || blank(name, name === 'products' || name === 'snapshot' ? {} : undefined);
    return env[name];
  }

  /* The write loop from the data format: stamp, put, and on a conflict merge with what is stored and put again. */
  async function save(name, mutate, { replace = false } = {}) {
    if (v.waiting) { const e = new Error('Allow Workshop to use your folder first.'); e.code = 'unavailable'; throw e; }
    if (v.newer === name) { const e = new Error('This was saved by a newer Roadmap. Update Workshop to change it.'); e.code = 'downgrade'; throw e; }
    const before = env[name];
    const after = structuredClone(before);
    mutate(after);
    if (!replace) ws.data.stamp(before, after);
    try {
      const r = await ws.data.put(name, after);
      env[name] = { ...after, rev: r.rev, updatedAt: r.updatedAt };
    } catch (err) {
      if (waitFor(err)) { changed(); throw err; }
      if (err.code !== 'conflict' || !err.current) throw err;
      // The snapshot is a cache: the newer refresh wins outright. Everything else merges.
      const next = replace ? { ...after, rev: err.current.rev } : ws.data.merge(after, err.current);
      const r = await ws.data.put(name, next);
      env[name] = { ...next, rev: r.rev, updatedAt: r.updatedAt };
    }
  }

  const strip = ({ updatedAt, ...x }) => x;
  function fromEnvelopes() {
    v.settings = cleanSettings(env.products.meta);
    v.products = (env.products.items || []).map(cleanProduct).filter(Boolean);
    v.cadence = (env.cadence.items || []).map(cleanCeremony).filter(Boolean);
    v.seen = Object.fromEntries((env.seen.items || []).map(x => [Number(x.id), Number(x.rev) || 0]));
    const m = env.snapshot.meta || {};
    v.snap = {
      fetchedAt: m.fetchedAt || null, connection: m.connection || '', total: m.total || 0, truncated: !!m.truncated,
      childrenTruncated: !!m.childrenTruncated, iterations: m.iterations && typeof m.iterations === 'object' ? m.iterations : {}, areas: Array.isArray(m.areas) ? m.areas : []
    };
    v.items = (env.snapshot.items || []).map(it => ({ ...strip(it), id: Number(it.id) }));
    v.offers = (env.handoffs.items || []).map(h => ({ ...h }));
  }

  async function loadData() {
    try {
      await Promise.all(COLLECTIONS.map(read));
      fromEnvelopes();
      v.loaded = true;
    } catch (e) {
      if (!waitFor(e)) throw e;
    }
    await loadOthers();
    changed();
  }

  /** Other apps' collections this app reads: Queue's settings and Docket's sprint and every-sprint items. */
  async function loadOthers() {
    const quiet = p => p.catch(() => null);
    const [q, sp, rec] = await Promise.all([
      quiet(ws.data.get('settings', { app: 'queue' })),
      quiet(ws.data.get('dayplan/settings', { app: DOCKET })),
      quiet(ws.data.get('dayplan/recurring', { app: DOCKET }))
    ]);
    v.queue = queueInfo(q);
    v.docket = docketSprint(sp);
    v.recurring = readable(rec, 'prioritizer.dayplan/recurring', DOCKET_VERSION) ? rec.items : [];
  }

  async function checkConnectors() {
    if (ws.backend !== 'agent') { v.ado = { state: 'browser', message: '' }; return changed(); }
    try {
      const list = await ws.connectors.list();
      const c = list.find(x => x.id === ADO);
      if (!c) v.ado = { state: 'off', message: 'The ADO connector is not installed.' };
      else if (c.status.state === 'disabled') v.ado = { state: 'off', message: 'The ADO connector is off. Turn it on in Settings.' };
      else if (c.status.state !== 'ready') v.ado = { state: 'off', message: c.status.message || 'The ADO connector is not ready yet.' };
      else v.ado = { state: 'ready', message: '' };
    } catch {
      v.ado = { state: 'off', message: "Couldn't reach Workshop on this computer." };
    }
    changed();
  }

  const areas = () => areasToFetch(v.products, v.queue.areas, v.settings);
  const connection = () => v.settings.connection || v.queue.connection;
  const call = (action, args) => ws.connectors.call(ADO, action, { ...(connection() ? { connection: connection() } : {}), ...args });

  /** Sprint dates per project, for items placed by their iteration. Failures keep what was cached. */
  async function sprints(items, list) {
    const iterations = { ...v.snap.iterations };
    const projects = new Set([...items.map(i => projectOf(i.iteration)), ...list.map(projectOf)].filter(Boolean));
    await Promise.all([...projects].map(async project => {
      try { iterations[project] = (await call('iterations.list', { project })).iterations; } catch { /* keep */ }
    }));
    return iterations;
  }

  /** Fetch the roadmap from ADO and replace the snapshot. Read only. */
  async function refresh() {
    if (v.refreshing || v.waiting) return;
    const list = areas();
    if (v.ado.state !== 'ready' || !list.length) return;
    v.refreshing = true; v.refreshError = ''; changed();
    try {
      const r = await call('roadmap', { areas: list });
      const iterations = await sprints(r.items, list);
      v.items = r.items;
      v.snap = { fetchedAt: r.fetchedAt, connection: r.connection, total: r.total, truncated: r.truncated, childrenTruncated: !!r.childrenTruncated, iterations, areas: list };
      const stamp = now();
      await save('snapshot', e => {
        e.items = r.items.map(it => ({ ...it, id: String(it.id), updatedAt: stamp }));
        e.deleted = {};
        e.meta = { updatedAt: stamp, ...v.snap };
      }, { replace: true }).catch(() => { /* the roadmap still shows; the next refresh saves again */ });
      // First refresh: everything counts as seen, so nothing shows as changed.
      if (!Object.keys(v.seen).length && r.items.length) await markSeen(r.items).catch(() => {});
    } catch (e) {
      v.refreshError = e && e.message ? e.message : "Couldn't reach ADO.";
    } finally {
      v.refreshing = false;
      changed();
    }
  }

  /** Remember the revision of these items as seen. Items no longer on the roadmap are forgotten. */
  async function markSeen(items) {
    const list = items.filter(i => v.seen[i.id] !== i.rev);
    if (!list.length) return;
    for (const i of list) v.seen[i.id] = i.rev;
    changed();
    await save('seen', e => {
      for (const i of list) {
        const at = e.items.findIndex(x => x.id === String(i.id));
        if (at >= 0) e.items[at] = { ...e.items[at], rev: i.rev }; else e.items.push({ id: String(i.id), rev: i.rev, updatedAt: 0 });
      }
      const keep = new Set(v.items.map(i => String(i.id)));
      e.items = e.items.filter(x => keep.has(x.id));
    });
  }

  async function saveSettings({ products, settings }) {
    const clean = products.map(cleanProduct).filter(Boolean);
    const s = cleanSettings(settings);
    const before = areas().join('\n') + '|' + connection();
    await save('products', e => {
      e.meta = { ...(e.meta || {}), ...s };
      const old = new Map(e.items.map(x => [x.id, x]));
      e.items = clean.map(p => ({ ...(old.get(p.id) || {}), ...p }));
    });
    v.products = clean; v.settings = s;
    changed();
    if (areas().join('\n') + '|' + connection() !== before) await refresh();
  }

  async function saveCadence(list) {
    const clean = [];
    for (const c of list.map(cleanCeremony).filter(Boolean)) if (!clean.some(x => x.id === c.id)) clean.push(c);
    await save('cadence', e => {
      const old = new Map(e.items.map(x => [x.id, x]));
      e.items = clean.map(c => ({ ...(old.get(c.id) || {}), ...c }));
    });
    v.cadence = clean;
    changed();
  }

  /** Offer every ceremony to Docket as an every-sprint task. Writes only this app's handoffs. Resolves how many. */
  async function sendToDocket() {
    const t = new Date(now());
    await save('handoffs', e => { e.items = syncOffers(e.items, v.cadence, { today: todayOf(t.getTime()), createdAt: t.toISOString() }); });
    v.offers = (env.handoffs.items || []).map(h => ({ ...h }));
    changed();
    return v.cadence.length;
  }

  /** Another window wrote one of our collections, or it changed on disk. */
  async function reload(name) {
    try {
      await read(name);
      fromEnvelopes();
      changed();
    } catch (e) { waitFor(e); }
  }

  async function reloadOthers() {
    await loadOthers();
    changed();
  }

  async function loadAll() {
    v.waiting = false;
    await loadData();
    await checkConnectors();
  }

  ws.on('online', p => { if (p && p.online) loadAll().then(refresh); });

  return { v, areas, loadAll, loadData, checkConnectors, refresh, markSeen, saveSettings, saveCadence, sendToDocket, reload, reloadOthers, COLLECTIONS };
}

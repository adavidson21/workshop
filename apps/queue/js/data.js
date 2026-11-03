/* Queue: loading, saving and ADO calls through the SDK, with no DOM, so Node tests can drive it with a fake
   `ws`. main.js owns the page and repaints through onChange.

   ADO is the source of truth for work items. The app keeps four collections of its own (all version 1):
     settings  meta: team areas, people, types, refresh minutes, stale days (model.js DEFAULT_SETTINGS)
     views     saved views: {id, name, base, filters, sort}
     snapshot  the last queue.list result, replaced on every refresh, so the queue opens fast and shows
               while ADO or Workshop is unreachable. meta also caches state categories and sprints.
     seen      {id, rev} per work item: the ADO revision you last opened, for "changed since you looked".
   Writes to ADO go through the ADO connector's write actions with confirm: true, and only from a click
   (main.js shows what will change first). */
import { APP, VERSION, cleanSettings, cleanFilters, projectOf } from './model.js';

const ADO = 'ado';
const OC = 'opencode';
const blank = (name, meta) => ({ schema: `${APP}.${name}`, version: VERSION, rev: 0, items: [], deleted: {}, ...(meta ? { meta: { updatedAt: 0, ...meta } } : {}) });

export function createQueue(ws, { onChange = () => {}, now = () => Date.now() } = {}) {
  const v = {
    loaded: false,
    waiting: false,               // the browser's folder store needs Allow
    settings: cleanSettings({}),
    views: [],
    items: [],
    snap: { fetchedAt: null, connection: '', me: null, total: 0, truncated: false, categories: {}, iterations: {}, currentIterations: [] },
    seen: {},
    ado: { state: 'loading', message: '' },  // 'ready' | 'off' | 'browser' | 'loading'
    dispatch: false,              // opencode connector ready: "Start in Dispatch" is offered
    refreshing: false,
    refreshError: '',
    newer: '',                    // a collection saved by a newer Queue: read-only
  };
  const env = {};
  const changed = () => onChange(v);

  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  async function read(name, meta) {
    const e = await ws.data.get(name);
    if (e && e.version > VERSION) { v.newer = name; env[name] = e; return e; }
    env[name] = e || blank(name, meta);
    return env[name];
  }

  /* The write loop from the data format: stamp, put, and on a conflict merge with what is stored and put again. */
  async function save(name, mutate, { replace = false } = {}) {
    if (v.waiting) { const e = new Error('Allow Workshop to use your folder first.'); e.code = 'unavailable'; throw e; }
    if (v.newer === name) { const e = new Error('This was saved by a newer Queue. Update Workshop to change it.'); e.code = 'downgrade'; throw e; }
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

  function fromEnvelopes() {
    v.settings = cleanSettings(env.settings.meta);
    v.views = (env.views.items || []).map(x => ({ id: x.id, name: String(x.name || 'View').slice(0, 60), base: x.base || 'all', filters: cleanFilters(x.filters), sort: x.sort || 'changed' }));
    const m = env.snapshot.meta || {};
    v.snap = {
      fetchedAt: m.fetchedAt || null, connection: m.connection || '', me: m.me || null, total: m.total || 0, truncated: !!m.truncated,
      categories: m.categories || {}, iterations: m.iterations || {}, currentIterations: Array.isArray(m.currentIterations) ? m.currentIterations : []
    };
    v.items = (env.snapshot.items || []).map(({ updatedAt, ...it }) => ({ ...it, id: Number(it.id), tags: Array.isArray(it.tags) ? it.tags : [] }));
    v.seen = Object.fromEntries((env.seen.items || []).map(x => [Number(x.id), Number(x.rev) || 0]));
  }

  async function loadData() {
    try {
      await Promise.all([read('settings', cleanSettings({})), read('views'), read('snapshot', {}), read('seen')]);
      fromEnvelopes();
      v.loaded = true;
    } catch (e) {
      if (!waitFor(e)) throw e;
    }
    changed();
  }

  async function checkConnectors() {
    if (ws.backend !== 'agent') { v.ado = { state: 'browser', message: '' }; v.dispatch = false; return changed(); }
    try {
      const list = await ws.connectors.list();
      const c = list.find(x => x.id === ADO);
      if (!c) v.ado = { state: 'off', message: 'The ADO connector is not installed.' };
      else if (c.status.state === 'disabled') v.ado = { state: 'off', message: 'The ADO connector is off. Turn it on in Settings.' };
      else if (c.status.state !== 'ready') v.ado = { state: 'off', message: c.status.message || 'The ADO connector is not ready yet.' };
      else v.ado = { state: 'ready', message: '' };
      const o = list.find(x => x.id === OC);
      v.dispatch = !!(o && o.status.state === 'ready');
    } catch {
      v.ado = { state: 'off', message: "Couldn't reach Workshop on this computer." };
    }
    changed();
  }

  const call = (action, args, opts) => ws.connectors.call(ADO, action, { ...(v.settings.connection ? { connection: v.settings.connection } : {}), ...args }, opts);

  /** State categories per type, and sprints per project. Failures leave what was cached. */
  async function lookups(items) {
    const categories = { ...v.snap.categories };
    const iterations = { ...v.snap.iterations };
    const pairs = new Map();
    for (const i of items) if (i.project && i.type) pairs.set(`${i.project}\n${i.type}`, [i.project, i.type]);
    const projects = new Set([...items.map(i => i.project), ...v.settings.areas.map(projectOf)].filter(Boolean));
    await Promise.all([
      ...[...pairs.values()].filter(([, t]) => !categories[t]).map(async ([project, type]) => {
        try {
          const r = await call('workitem.states', { project, type });
          categories[type] = Object.fromEntries(r.states.map(s => [s.name, s.category]));
        } catch { /* keep what we had */ }
      }),
      ...[...projects].map(async project => {
        try { iterations[project] = (await call('iterations.list', { project })).iterations; } catch { /* keep */ }
      })
    ]);
    const currentIterations = Object.values(iterations).flat().filter(x => x.current).map(x => x.path);
    return { categories, iterations, currentIterations };
  }

  /** Fetch the queue from ADO and replace the snapshot. */
  async function refresh() {
    if (v.refreshing || v.waiting) return;
    if (v.ado.state !== 'ready' || !v.settings.areas.length) return;
    v.refreshing = true; v.refreshError = ''; changed();
    try {
      const r = await call('queue.list', { areas: v.settings.areas, ...(v.settings.types.length ? { types: v.settings.types } : {}) });
      const look = await lookups(r.items);
      v.items = r.items;
      v.snap = { fetchedAt: r.fetchedAt, connection: r.connection, me: r.me, total: r.total, truncated: r.truncated, ...look };
      const stamp = now();
      await save('snapshot', e => {
        e.items = r.items.map(it => ({ ...it, id: String(it.id), updatedAt: stamp }));
        e.deleted = {};
        e.meta = { updatedAt: stamp, fetchedAt: r.fetchedAt, connection: r.connection, me: r.me, total: r.total, truncated: r.truncated, ...look };
      }, { replace: true }).catch(() => { /* the queue still shows; the next refresh saves again */ });
      // First refresh: everything counts as seen, so nothing shows as changed.
      if (!Object.keys(v.seen).length && r.items.length) await markSeen(r.items).catch(() => {});
    } catch (e) {
      v.refreshError = e && e.message ? e.message : "Couldn't reach ADO.";
    } finally {
      v.refreshing = false;
      changed();
    }
  }

  async function markSeen(items) {
    const list = items.filter(i => v.seen[i.id] !== i.rev);
    if (!list.length) return;
    for (const i of list) v.seen[i.id] = i.rev;
    await save('seen', e => {
      for (const i of list) {
        const at = e.items.findIndex(x => x.id === String(i.id));
        const row = { id: String(i.id), rev: i.rev, updatedAt: 0 };
        if (at >= 0) e.items[at] = { ...e.items[at], rev: i.rev }; else e.items.push(row);
      }
      // Forget items no longer in the queue, so the collection does not grow forever.
      const keep = new Set(v.items.map(i => String(i.id)));
      e.items = e.items.filter(x => keep.has(x.id));
    });
  }

  /** Full details for the detail pane. Marks the item seen. */
  async function details(item) {
    const d = await call('workitem.get', { id: item.id, details: true, html: true, pullRequests: true, comments: true, history: true });
    markSeen([item]).catch(() => {});
    changed();
    return d;
  }

  function replaceItem(next) {
    const at = v.items.findIndex(i => i.id === next.id);
    if (at >= 0) v.items[at] = next; else v.items.unshift(next);
    const stamp = now();
    save('snapshot', e => {
      const row = { ...next, id: String(next.id), updatedAt: stamp };
      const k = e.items.findIndex(x => x.id === row.id);
      if (k >= 0) e.items[k] = row; else e.items.unshift(row);
    }, { replace: true }).catch(() => {});
    v.seen[next.id] = next.rev;
    markSeen([next]).catch(() => {});
  }

  /**
   * Change fields of a work item. Call only after the person confirmed. Resolves {ok: true, item} or
   * {conflict: true, before, after} (after is null if the item left the queue). Other errors reject.
   */
  async function update(item, changes) {
    try {
      const next = await call('workitem.update', { id: item.id, rev: item.rev, changes }, { confirm: true });
      replaceItem(next);
      changed();
      return { ok: true, item: next };
    } catch (e) {
      if (e.code !== 'conflict') throw e;
      await refresh();
      return { conflict: true, before: item, after: v.items.find(i => i.id === item.id) || null };
    }
  }

  async function comment(item, text) {
    const r = await call('workitem.comment', { id: item.id, text }, { confirm: true });
    // A comment raises the item's revision; refresh that item's rev so the next write does not conflict.
    try { await refresh(); } catch { /* shown on the next refresh */ }
    return r;
  }

  async function create(fields) {
    const next = await call('workitem.create', fields, { confirm: true });
    replaceItem(next);
    changed();
    return next;
  }

  async function startInDispatch(item) {
    return ws.connectors.call(OC, 'start', { id: String(item.id), lane: item.type === 'Bug' ? 'bug' : 'feature' }, { confirm: true });
  }

  async function saveSettings(next) {
    const clean = cleanSettings(next);
    await save('settings', e => { e.meta = { ...(e.meta || {}), ...clean }; });
    const areasChanged = clean.areas.join('\n') !== v.settings.areas.join('\n') || clean.types.join('\n') !== v.settings.types.join('\n') || clean.connection !== v.settings.connection;
    v.settings = clean;
    changed();
    if (areasChanged) await refresh();
  }

  async function saveView(view) {
    const row = { id: view.id || `v_${now().toString(36)}`, name: String(view.name || 'View').trim().slice(0, 60) || 'View', base: view.base || 'all', filters: cleanFilters(view.filters), sort: view.sort || 'changed', updatedAt: 0 };
    await save('views', e => {
      const at = e.items.findIndex(x => x.id === row.id);
      if (at >= 0) e.items[at] = row; else e.items.push(row);
    });
    fromViews();
    changed();
    return row;
  }

  async function deleteView(id) {
    await save('views', e => { e.items = e.items.filter(x => x.id !== id); });
    fromViews();
    changed();
  }

  function fromViews() {
    v.views = (env.views.items || []).map(x => ({ id: x.id, name: x.name, base: x.base || 'all', filters: cleanFilters(x.filters), sort: x.sort || 'changed' }));
  }

  /** Another window wrote one of our collections, or it changed on disk. */
  async function reload(name) {
    try {
      await read(name, name === 'settings' ? cleanSettings({}) : name === 'snapshot' ? {} : undefined);
      fromEnvelopes();
      changed();
    } catch (e) { waitFor(e); }
  }

  async function loadAll() {
    const was = v.waiting;
    v.waiting = false;
    await loadData();
    await checkConnectors();
    if (was && !v.waiting) changed();
  }

  ws.on('online', p => { if (p && p.online) loadAll().then(refresh); });

  return { v, loadAll, loadData, checkConnectors, refresh, details, update, comment, create, startInDispatch, saveSettings, saveView, deleteView, reload, markSeen };
}

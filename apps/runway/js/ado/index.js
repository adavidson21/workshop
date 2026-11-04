/* Runway's link to Azure DevOps, through Workshop's ADO connector. The only module in Runway that calls a
   connector. main.js loads it with a dynamic import() only when Runway uses Workshop on this computer; with no
   Workshop, no connector or the connector off, Runway works the same without it and shows no ADO controls.
   Read only: it uses the connector's `roadmap` and `iterations.list` actions and never writes to ADO. */
import { applyLive, cleanSource, mergeLinked, projectsOf, pulled, roadmapArgs } from './model.js';

export * from './model.js';

const ADO = 'ado';

export function createAdo(ws, { onChange = () => {} } = {}) {
  const state = { ready: false, message: '', checked: false };

  async function check() {
    try {
      const list = await ws.connectors.list();
      const c = list.find(x => x.id === ADO);
      const s = c && c.status ? c.status.state : 'missing';
      state.ready = s === 'ready';
      state.message = !c ? 'The ADO connector is not installed in Workshop.'
        : s === 'disabled' ? 'The ADO connector is off. Turn it on in Workshop Settings.'
          : s !== 'ready' ? ((c.status && c.status.message) || 'The ADO connector is not ready yet.') : '';
    } catch (e) {
      state.ready = false;
      state.message = "Couldn't reach Workshop on this computer.";
    }
    state.checked = true;
    onChange(state);
    return state;
  }

  const unsub = ws.connectors.onStatus ? ws.connectors.onStatus(ADO, () => { check(); }) : () => {};

  /** Area paths and connection from Queue's settings, to fill in the dialog. Missing or newer: nothing. */
  async function defaults() {
    try {
      const q = await ws.data.get('settings', { app: 'queue' });
      if (!q || q.version !== 1 || !q.meta) return { areas: [], connection: '' };
      const areas = Array.isArray(q.meta.areas) ? q.meta.areas.filter(a => typeof a === 'string') : [];
      return { areas, connection: typeof q.meta.connection === 'string' ? q.meta.connection : '' };
    } catch (e) { return { areas: [], connection: '' }; }
  }

  /** Read from ADO for a source: {result, data}. Sprint dates that fail to load are left out. */
  async function pull(source) {
    const src = cleanSource(source);
    if (!src) throw Object.assign(new Error('Add at least one area path.'), { code: 'bad_request' });
    const call = (action, args) => ws.connectors.call(ADO, action, { ...(src.connection ? { connection: src.connection } : {}), ...args });
    const result = await call('roadmap', roadmapArgs(src));
    const iterations = {};
    await Promise.all(projectsOf(result.items || [], src.areas).map(async project => {
      try { iterations[project] = (await call('iterations.list', { project })).iterations; } catch (e) { /* placed by own dates only */ }
    }));
    return { src, result, data: pulled(result, iterations, src) };
  }

  /** Refresh a doc from ADO by its meta.ado. Resolves {doc, added, updated, differs, missing}. */
  async function refresh(doc, source = doc.meta.ado) {
    const { src, result, data } = await pull(source);
    if (src.mode === 'live') return { doc: applyLive(doc, data, src, result), added: 0, updated: 0, differs: 0, missing: 0 };
    return mergeLinked(doc, data, src, result);
  }

  return { state, check, defaults, pull, refresh, close: unsub };
}

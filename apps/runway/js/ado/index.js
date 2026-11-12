/* Runway's link to Azure DevOps, through Workshop's ADO connector. The only module in Runway that calls a
   connector. main.js loads it with a dynamic import() only when Runway uses Workshop on this computer; with no
   Workshop, no connector or the connector off, Runway works the same without it and shows no ADO controls.
   Reads with the connector's `roadmap` and `iterations.list` actions. The one write is Publish (publish.js):
   `workitem.update`, sent with `confirm: true` only after a person clicks Publish and confirms its preview. */
import { applyLive, cleanSource, mergeLinked, projectsOf, pulled, roadmapArgs } from './model.js';
import { sendPlan } from './publish.js';

/** {areas, connection} from Workshop's settings.teams v1 (docs/teams.md): the first team with area paths, or null. */
export function teamDefaults(env) {
  if (!env || env.schema !== 'settings.teams' || env.version !== 1 || !Array.isArray(env.items)) return null;
  const t = env.items.find(x => x && Array.isArray(x.areas) && x.areas.some(a => typeof a === 'string' && a.trim()));
  if (!t) return null;
  return { areas: t.areas.filter(a => typeof a === 'string' && a.trim()).slice(0, 20), connection: typeof t.connection === 'string' ? t.connection : '' };
}

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

  /** Area paths and connection to fill in the dialog: your team in Workshop's People app (settings.teams, Workshop
      docs/teams.md). Missing: nothing. */
  async function defaults() {
    try { return teamDefaults(await ws.data.get('teams', { app: 'settings' })) || { areas: [], connection: '' }; }
    catch (e) { return { areas: [], connection: '' }; }
  }

  /** Read from ADO for a source: {src, result, data, iterations}. Sprint dates that fail to load are left out. `dir` is Workshop's
      people directory, for owners from Assigned To (model.js ownersOf); null leaves owners as they are. */
  async function pull(source, { dir = null } = {}) {
    const src = cleanSource(source);
    if (!src) throw Object.assign(new Error('Add at least one area path.'), { code: 'bad_request' });
    const call = (action, args) => ws.connectors.call(ADO, action, { ...(src.connection ? { connection: src.connection } : {}), ...args });
    const result = await call('roadmap', roadmapArgs(src));
    const iterations = {};
    await Promise.all(projectsOf(result.items || [], src.areas).map(async project => {
      try { iterations[project] = (await call('iterations.list', { project })).iterations; } catch (e) { /* placed by own dates only */ }
    }));
    return { src, result, data: pulled(result, iterations, src, { dir }), iterations };
  }

  /** Refresh a doc from ADO by its meta.ado. Resolves {doc, added, updated, differs, missing}. */
  async function refresh(doc, source = doc.meta.ado, { dir = null } = {}) {
    const { src, result, data } = await pull(source, { dir });
    if (src.mode === 'live') return { doc: applyLive(doc, data, src, result), added: 0, updated: 0, differs: 0, missing: 0 };
    return mergeLinked(doc, data, src, result);
  }

  /** Publish a plan (publish.js planPublish) the person confirmed: one workitem.update per item, each with
      confirm: true. Resolves the per-item results (publish.js sendPlan). */
  function publish(plan, opts) {
    return sendPlan((action, args) => ws.connectors.call(ADO, action, args, { confirm: true }), plan, opts);
  }

  return { state, check, defaults, pull, refresh, publish, close: unsub };
}

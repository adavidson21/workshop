/* Roadmaps' link to Azure DevOps and GitHub, through Workshop's ADO and GitHub connectors. The only module in Roadmaps
   that calls a connector. A source's `system` ('ado' or 'github', meta.ado.system) says which connector reads it;
   GitHub is read only (no sprints, no Publish).
 main.js loads it with a dynamic import() only when Roadmaps uses Workshop on this computer; with no
   Workshop, no connector or the connector off, Roadmaps works the same without it and shows no ADO controls.
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
export const SYSTEMS = { ado: 'Azure DevOps', github: 'GitHub' };
const sysOf = src => (src && src.system === 'github' ? 'github' : ADO);

export function createAdo(ws, { onChange = () => {} } = {}) {
  // ready: any tracker connector is ready. systems: the ready ones, in SYSTEMS order. message: why none is.
  const state = { ready: false, message: '', checked: false, systems: [] };

  async function check() {
    try {
      const list = await ws.connectors.list();
      const ready = id => { const c = list.find(x => x.id === id); return !!(c && c.status && c.status.state === 'ready'); };
      state.systems = Object.keys(SYSTEMS).filter(ready);
      state.ready = state.systems.length > 0;
      const c = list.find(x => x.id === ADO);
      const s = c && c.status ? c.status.state : 'missing';
      state.message = state.ready ? ''
        : !c ? 'No tracker connector is ready. Turn one on in Workshop Settings.'
          : s === 'disabled' ? 'The tracker connectors are off. Turn one on in Workshop Settings.'
            : ((c.status && c.status.message) || 'The ADO connector is not ready yet.');
    } catch (e) {
      state.ready = false;
      state.systems = [];
      state.message = "Couldn't reach Workshop on this computer.";
    }
    state.checked = true;
    onChange(state);
    return state;
  }
  /** Whether the connector a source reads from is ready. */
  const readyFor = src => state.systems.includes(sysOf(src));

  const subs = ws.connectors.onStatus ? Object.keys(SYSTEMS).map(id => ws.connectors.onStatus(id, () => { check(); })) : [];
  const unsub = () => subs.forEach(u => { if (typeof u === 'function') u(); });

  /** Area paths and connection to fill in the dialog: your team in Workshop's Directory (Settings) (settings.teams, Workshop
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
    const system = sysOf(src);
    const call = (action, args) => ws.connectors.call(system, action, { ...(src.connection ? { connection: src.connection } : {}), ...args });
    const result = await call('roadmap', roadmapArgs(src));
    const iterations = {};
    // GitHub has no sprints outside Projects: items are placed by their own dates (a Feature takes its milestone's).
    if (system === ADO) await Promise.all(projectsOf(result.items || [], src.areas).map(async project => {
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
    if (plan && plan.system === 'github') return Promise.reject(Object.assign(new Error('GitHub roadmaps are read only for now.'), { code: 'bad_request' }));
    return sendPlan((action, args) => ws.connectors.call(ADO, action, args, { confirm: true }), plan, opts);
  }

  return { state, check, readyFor, defaults, pull, refresh, publish, close: unsub };
}

// A fake Workshop SDK for Roadmap tests: in-memory collections with revisions and conflicts, the real merge and
// stamp rules, other apps' collections (read only), and a scripted ADO connector that records every call.
import { data as rules } from '../../../shared/workshop-sdk.js';

export const unavailable = () => Object.assign(new Error('Allow Workshop to use the folder.'), { code: 'unavailable' });

export const epic = (id, extra = {}) => ({
  id, rev: 2, type: 'Epic', title: `Synthetic version ${id}`, state: 'Active', area: 'Web App\\Team A', iteration: 'Web App\\Sprint 12',
  parentId: null, targetDate: null, startDate: null, changed: '2026-10-14T15:30:00Z', url: `https://ado.example.com/Main/Web%20App/_workitems/edit/${id}`, ...extra
});
export const feature = (id, parentId, extra = {}) => ({ ...epic(id), type: 'Feature', title: `Synthetic feature ${id}`, parentId, storiesTotal: 4, storiesDone: 1, ...extra });

export const SPRINT = { anchor: '2026-10-26', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], holidays: ['2026-11-04'], dayStart: '09:00', dayEnd: '17:00' };

export function fakeWs({ backend = 'agent', items = [epic(701, { startDate: '2026-10-01', targetDate: '2026-12-15' }), feature(711, 701), feature(712, 701, { state: 'New' })], stored = {}, others = {}, ado = 'ready' } = {}) {
  const store = structuredClone(stored);
  const other = structuredClone(others);
  const ws = {
    backend, embedded: true, allowed: true, calls: [], puts: [],
    adoItems: structuredClone(items),
    on() { return () => {}; },
    data: {
      async get(name, o) {
        if (!ws.allowed) throw unavailable();
        if (o && o.app) return other[`${o.app}/${name}`] ? structuredClone(other[`${o.app}/${name}`]) : null;
        return store[name] ? structuredClone(store[name]) : null;
      },
      async put(name, env) {
        if (!ws.allowed) throw unavailable();
        const cur = store[name];
        if ((cur ? cur.rev : 0) !== env.rev) throw Object.assign(new Error('conflict'), { code: 'conflict', current: structuredClone(cur) });
        store[name] = { ...structuredClone(env), rev: env.rev + 1, updatedAt: '2026-11-03T12:00:00.000Z' };
        ws.puts.push(name);
        return { rev: env.rev + 1, updatedAt: store[name].updatedAt };
      },
      merge: rules.merge,
      stamp: rules.stamp,
      subscribe() { return () => {}; }
    },
    store,
    other,
    connectors: {
      async list() { return ado ? [{ id: 'ado', status: { state: ado === 'ready' ? 'ready' : ado, message: ado === 'error' ? 'ADO_PAT is not set.' : null } }] : []; },
      async call(id, action, args = {}, opts = {}) {
        ws.calls.push({ id, action, args: structuredClone(args), confirm: !!opts.confirm });
        if (backend !== 'agent') throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        if (ws.fail && ws.fail[action]) throw ws.fail[action];
        switch (action) {
          case 'roadmap': return { connection: 'main', items: structuredClone(ws.adoItems), total: ws.adoItems.length, truncated: false, childrenTruncated: false, fetchedAt: '2026-11-03T12:00:00Z' };
          case 'iterations.list': return { iterations: [{ path: 'Web App', name: 'Web App', current: false }, { path: 'Web App\\Sprint 12', name: 'Sprint 12', start: '2026-10-07', finish: '2026-10-20', current: false }] };
          default: throw new Error('unknown action ' + action);
        }
      },
      on() { return () => {}; },
      onStatus() { return () => {}; }
    }
  };
  return ws;
}

export const products = (items = [{ id: 'p_product-a', name: 'Product A', areas: ['Web App\\Team A'], updatedAt: 1 }], meta = {}) =>
  ({ schema: 'pm.products', version: 1, rev: 1, items, deleted: {}, meta: { updatedAt: 1, ...meta } });
export const queueSettings = (meta = {}) => ({ schema: 'queue.settings', version: 1, rev: 1, items: [], deleted: {}, meta: { updatedAt: 1, areas: ['Web App\\Team B'], connection: 'main', ...meta } });
export const dayplanSettings = (sprint = SPRINT, version = 1) => ({ schema: 'prioritizer.dayplan/settings', version, rev: 1, items: [], deleted: {}, meta: { updatedAt: 1, sprint } });

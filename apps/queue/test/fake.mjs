// A fake Workshop SDK for Queue tests: an in-memory data store with revisions and conflicts, the real merge
// and stamp rules, and a scripted ADO connector that records every call (and whether it carried confirm).
import { data as rules } from '../../../shared/workshop-sdk.js';

export const unavailable = () => Object.assign(new Error('Allow Workshop to use the folder.'), { code: 'unavailable' });

export const ME = { name: 'Engineer A', email: 'engineer.a@example.com' };
export const DEV1 = { name: 'Dev One', email: 'dev.one@example.com' };

export const item = (id, extra = {}) => ({
  id, rev: 3, type: 'Bug', title: `Synthetic item ${id}`, state: 'Active', reason: '', assignee: null, priority: 2,
  iteration: 'Web App\\Sprint 12', area: 'Web App\\Team A', project: 'Web App', tags: [], created: '2026-10-01T09:00:00Z',
  changed: '2026-10-14T15:30:00Z', stateChanged: null, connection: 'main', url: `https://ado.example.com/Main/Web%20App/_workitems/edit/${id}`, ...extra
});

export function fakeWs({ backend = 'agent', items = [item(501, { assignee: ME }), item(502), item(503, { assignee: DEV1, state: 'New' })], stored = {}, others = {}, ado = 'ready', opencode = false } = {}) {
  const handlers = {};
  const store = structuredClone(stored);
  const ws = {
    backend, embedded: true, allowed: true, calls: [], puts: [],
    adoItems: structuredClone(items),
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return () => {}; },
    emit(ev, p) { for (const fn of handlers[ev] || []) fn(p); },
    data: {
      async get(name, o) {
        if (!ws.allowed) throw unavailable();
        if (o && o.app) return others[`${o.app}/${name}`] ? structuredClone(others[`${o.app}/${name}`]) : null;
        return store[name] ? structuredClone(store[name]) : null;
      },
      async put(name, env) {
        if (!ws.allowed) throw unavailable();
        const cur = store[name];
        if ((cur ? cur.rev : 0) !== env.rev) throw Object.assign(new Error('conflict'), { code: 'conflict', current: structuredClone(cur) });
        store[name] = { ...structuredClone(env), rev: env.rev + 1, updatedAt: '2026-10-15T12:00:00.000Z' };
        ws.puts.push(name);
        return { rev: env.rev + 1, updatedAt: store[name].updatedAt };
      },
      merge: rules.merge,
      stamp: rules.stamp,
      subscribe() { return () => {}; }
    },
    store,
    others,
    connectors: {
      async list() {
        return [
          ...(ado ? [{ id: 'ado', status: { state: ado === 'ready' ? 'ready' : ado, message: ado === 'error' ? 'ADO_PAT is not set.' : null } }] : []),
          ...(opencode ? [{ id: 'opencode', status: { state: 'ready' } }] : [])
        ];
      },
      async call(id, action, args = {}, opts = {}) {
        ws.calls.push({ id, action, args: structuredClone(args), confirm: !!opts.confirm });
        if (backend !== 'agent') throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        if (ws.fail && ws.fail[action]) throw ws.fail[action];
        if (id === 'opencode') return { ok: true };
        switch (action) {
          case 'queue.list': return { connection: 'main', me: ME, items: structuredClone(ws.adoItems), total: ws.adoItems.length, truncated: false, fetchedAt: '2026-10-15T12:00:00Z' };
          case 'workitem.states': return { states: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Closed', category: 'Completed' }] };
          case 'iterations.list': return { iterations: [{ path: 'Web App', name: 'Web App', current: false }, { path: 'Web App\\Sprint 12', name: 'Sprint 12', start: '2026-10-07', finish: '2026-10-20', current: true }] };
          case 'workitem.get': return { id: args.id, title: 'x', html: { description: '<p>d</p>' }, comments: [], history: [], related: [], pullRequests: [] };
          case 'workitem.update': {
            const it = ws.adoItems.find(i => i.id === args.id);
            if (it.rev !== args.rev) throw Object.assign(new Error('Work item changed in ADO.'), { code: 'conflict' });
            const c = args.changes;
            if (c.state) it.state = c.state;
            if (c.assignedTo !== undefined) it.assignee = c.assignedTo ? { name: c.assignedTo.split(' <')[0], email: (/<(.+)>/.exec(c.assignedTo) || [, c.assignedTo])[1] } : null;
            if (c.priority) it.priority = c.priority;
            if (c.iteration) it.iteration = c.iteration;
            if (c.tagsAdd) it.tags = [...it.tags, ...c.tagsAdd];
            if (c.tagsRemove) it.tags = it.tags.filter(t => !c.tagsRemove.includes(t));
            it.rev++;
            return structuredClone(it);
          }
          case 'workitem.comment': { const it = ws.adoItems.find(i => i.id === args.id); it.rev++; return { id: args.id, comment: { id: 1, text: args.text } }; }
          case 'workitem.create': { const it = item(9000, { title: args.title, type: args.type, rev: 1 }); ws.adoItems.push(it); return structuredClone(it); }
          default: throw new Error('unknown action ' + action);
        }
      },
      on() { return () => {}; },
      onStatus() { return () => {}; }
    }
  };
  return ws;
}

export const settings = (meta = {}) => ({ schema: 'queue.settings', version: 1, rev: 1, items: [], deleted: {}, meta: { updatedAt: 1, areas: ['Web App\\Team A'], people: [ME, DEV1], ...meta } });

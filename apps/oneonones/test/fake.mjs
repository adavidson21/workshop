// A fake Workshop SDK and synthetic envelopes for 1:1s tests. Everything here is made up.
import { data as rules } from '../../../shared/workshop-sdk.js';

export const TODAY = '2026-11-03';
export const NOW = new Date(2026, 10, 3, 15, 0, 0).getTime();

const envOf = (schema, version, items, meta) => ({ schema, version, rev: 1, items, deleted: {}, ...(meta ? { meta: { updatedAt: 1, ...meta } } : {}) });

export const docketTasks = (items, version = 3) => envOf('prioritizer.tasks', version, items, { capacity: 20 });
export const docketPeople = names => envOf('prioritizer.people', 1, names.map(n => ({ id: n.toLowerCase(), updatedAt: 1, name: n })));
export const receiptsEntries = (items, version = 1) => envOf('receipts.entries', version, items);
export const receiptsPeopleEnv = items => envOf('receipts.people', 1, items);
export const queueSettings = (meta = {}) => envOf('queue.settings', 1, [], { people: [{ name: 'Dev One', email: 'dev.one@example.com' }], staleDays: 7, ...meta });
export const queueSnapshot = (items, meta = {}) => envOf('queue.snapshot', 1, items.map(i => ({ ...i, updatedAt: 1 })), { fetchedAt: '2026-11-03T12:00:00Z', categories: { Bug: { New: 'Proposed', Active: 'InProgress' } }, ...meta });

export const task = (id, extra = {}) => ({ id, updatedAt: 1, title: `Synthetic task ${id}`, listId: 'l_main', people: [], done: false, waiting: false, nudgeOn: null, due: null, ...extra });
export const entry = (id, extra = {}) => ({ id, updatedAt: 1, about: 'p_r1', kind: 'win', date: '2026-10-30', text: `Synthetic entry ${id}`, ...extra });
export const item = (id, extra = {}) => ({ id: String(id), rev: 3, type: 'Bug', title: `Synthetic item ${id}`, state: 'Active', assignee: { name: 'Dev One', email: 'dev.one@example.com' }, changed: '2026-11-01T10:00:00Z', ...extra });

export const PERSON = { id: 'p_abc1', name: 'Dev One', links: { docket: 'DevA', receipts: 'p_r1', queue: 'dev.one@example.com' }, cadenceDays: 7, archived: false };

/** In-memory data and files, with revisions and conflicts like the agent, and a scripted opencode connector. */
export function fakeWs({ backend = 'agent', stored = {}, others = {}, files = {}, opencode = 'ready' } = {}) {
  const store = structuredClone(stored);
  const disk = structuredClone(files); // path -> {content, mtime}
  let clock = 1000;
  const ws = {
    backend, embedded: true, calls: [], puts: [], allowed: true,
    on() { return () => {}; },
    data: {
      async get(name, o) {
        if (!ws.allowed) throw Object.assign(new Error('Allow'), { code: 'unavailable' });
        if (o && o.app && o.app !== 'oneonones') return others[`${o.app}.${name}`] ? structuredClone(others[`${o.app}.${name}`]) : null;
        return store[name] ? structuredClone(store[name]) : null;
      },
      async put(name, env) {
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
    files: {
      async list(folder) { return Object.keys(disk).filter(p => p.startsWith(folder + '/')).sort().map(p => ({ path: p, mtime: disk[p].mtime, size: disk[p].content.length })); },
      async read(p) { return disk[p] ? { app: 'oneonones', path: p, ...structuredClone(disk[p]) } : null; },
      async write(p, content, o = {}) {
        const cur = disk[p];
        if ((o.create && cur) || (!o.create && (!cur || cur.mtime !== o.mtime))) throw Object.assign(new Error('conflict'), { code: 'conflict', current: cur ? { path: p, ...structuredClone(cur) } : null });
        disk[p] = { content, mtime: ++clock };
        return { app: 'oneonones', path: p, mtime: disk[p].mtime, size: content.length };
      },
      subscribe() { return () => {}; }
    },
    store, disk,
    connectors: {
      async list() { return opencode ? [{ id: 'opencode', status: { state: opencode } }] : []; },
      async call(id, action, args = {}, opts = {}) {
        ws.calls.push({ id, action, args: structuredClone(args), confirm: !!opts.confirm });
        if (backend !== 'agent') throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        if (action === 'oneonone.draft') return { session: 'ses_1', folder: `${args.personId}-${args.date}` };
        if (action === 'oneonone.result') return { state: 'done', text: '## Wins to recognize\n\n- One' };
        throw new Error('unknown action ' + action);
      },
      onStatus() { return () => {}; }
    }
  };
  return ws;
}

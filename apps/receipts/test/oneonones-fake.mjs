// A fake Workshop SDK and synthetic envelopes for Rapport's 1:1s tests. Everything here is made up.
import { data as rules } from '../../../shared/workshop-sdk.js';
import { directory } from '../../../shared/people.js';

export const TODAY = '2026-11-03';
export const NOW = new Date(2026, 10, 3, 15, 0, 0).getTime();

const envOf = (schema, version, items, meta) => ({ schema, version, rev: 1, items, deleted: {}, ...(meta ? { meta: { updatedAt: 1, ...meta } } : {}) });

// Docket's summary with a `people` card: rows {id, open, waiting} (Workshop docs/summaries.md).
export const docketSummary = (rows, version = 1) => envOf('prioritizer.summary', version, [{ id: 'people', kind: 'people', updatedAt: 1, rows }]);
export const receiptsEntries = (items, version = 1) => envOf('receipts.entries', version, items);
// The people directory (shared/people.js): a report, the manager, a peer and a group.
export const DIR = directory(envOf('settings.people', 2, [
  { id: 'p_r1', kind: 'person', updatedAt: 1, name: 'Dev One', handle: 'dev', relation: 'report' },
  { id: 'p_r2', kind: 'person', updatedAt: 1, name: 'Dev Two', handle: 'two', relation: 'report', archived: true },
  { id: 'p_mgr', kind: 'person', updatedAt: 1, name: 'Boss Person', handle: 'boss', relation: 'manager' },
  { id: 'p_peer', kind: 'person', updatedAt: 1, name: 'Peer Three', handle: 'peer', relation: 'peer' },
  { id: 'g_lead', kind: 'group', updatedAt: 1, name: 'Leadership', handle: 'leadership', members: ['p_r1', 'p_mgr'] }
]));

export const task = (id, extra = {}) => ({ id, title: `Synthetic task ${id}`, due: '', nudgeOn: '', via: '', ...extra });
export const entry = (id, extra = {}) => ({ id, updatedAt: 1, about: 'p_r1', kind: 'win', date: '2026-10-30', text: `Synthetic entry ${id}`, ...extra });

// A 1:1s person as page.js hands it to the model: linked to the report p_r1 (withDirectory).
export const PERSON = { id: 'p_abc1', personId: 'p_r1', name: 'Dev One', cadenceDays: 7, archived: false, relation: 'report', handle: 'dev', linked: true };

/** In-memory data and files, with revisions and conflicts like the agent, and a scripted opencode connector.
    The app is Rapport (`receipts`). `others` holds other apps' collections by `<app>.<name>`, the old 1:1s app
    included; `otherFiles` other apps' files by `<app>:<path>`. */
export function fakeWs({ backend = 'agent', stored = {}, others = {}, files = {}, otherFiles = {}, opencode = 'ready' } = {}) {
  const store = structuredClone(stored);
  const disk = structuredClone(files); // path -> {content, mtime}
  const away = structuredClone(otherFiles); // '<app>:<path>' -> {content, mtime}
  const mine = o => !o || !o.app || o.app === 'receipts';
  let clock = 1000;
  const ws = {
    backend, embedded: true, calls: [], puts: [], allowed: true,
    on() { return () => {}; },
    data: {
      async get(name, o) {
        if (!ws.allowed) throw Object.assign(new Error('Allow'), { code: 'unavailable' });
        if (!mine(o)) return others[`${o.app}.${name}`] ? structuredClone(others[`${o.app}.${name}`]) : null;
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
      async list(folder, o) {
        if (!mine(o)) return Object.keys(away).filter(k => k.startsWith(`${o.app}:${folder}/`)).sort().map(k => ({ path: k.slice(o.app.length + 1), mtime: away[k].mtime, size: away[k].content.length }));
        return Object.keys(disk).filter(p => p.startsWith(folder + '/')).sort().map(p => ({ path: p, mtime: disk[p].mtime, size: disk[p].content.length }));
      },
      async read(p, o) {
        if (!mine(o)) { const f = away[`${o.app}:${p}`]; return f ? { app: o.app, path: p, ...structuredClone(f) } : null; }
        return disk[p] ? { app: 'receipts', path: p, ...structuredClone(disk[p]) } : null;
      },
      async write(p, content, o = {}) {
        const cur = disk[p];
        if ((o.create && cur) || (!o.create && (!cur || cur.mtime !== o.mtime))) throw Object.assign(new Error('conflict'), { code: 'conflict', current: cur ? { path: p, ...structuredClone(cur) } : null });
        disk[p] = { content, mtime: ++clock };
        return { app: 'receipts', path: p, mtime: disk[p].mtime, size: content.length };
      },
      subscribe() { return () => {}; }
    },
    store, disk, away,
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

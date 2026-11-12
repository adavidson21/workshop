// A fake Workshop SDK for Runway tests: an in-memory data and files store with revisions and conflicts, and the
// real merge and stamp rules from the SDK.
import { data as rules } from '../../../shared/workshop-sdk.js';

export function fakeWs({ backend = 'agent', stored = {} } = {}) {
  const store = structuredClone(stored);
  const files = {};
  const ws = {
    backend, embedded: true, allowed: true, puts: [],
    store,
    data: {
      async get(name) {
        if (!ws.allowed) throw Object.assign(new Error('Allow'), { code: 'unavailable' });
        return store[name] ? structuredClone(store[name]) : null;
      },
      async put(name, env) {
        if (!ws.allowed) throw Object.assign(new Error('Allow'), { code: 'unavailable' });
        if (ws.failNext) { const e = ws.failNext; ws.failNext = null; throw e; }
        const cur = store[name];
        if ((cur ? cur.rev : 0) !== env.rev) throw Object.assign(new Error('conflict'), { code: 'conflict', current: structuredClone(cur) });
        if (env.schema !== `runway.${name}`) throw Object.assign(new Error('bad schema'), { code: 'bad_request' });
        store[name] = { ...structuredClone(env), rev: env.rev + 1, updatedAt: '2026-11-03T12:00:00.000Z' };
        ws.puts.push(name);
        return { rev: env.rev + 1, updatedAt: store[name].updatedAt };
      },
      merge: rules.merge,
      stamp: rules.stamp,
      subscribe() { return () => {}; }
    },
    files: {
      async read(path) { return files[path] ? { ...files[path], path } : null; },
      async write(path, content, o = {}) {
        const cur = files[path];
        if (o.create ? !!cur : (!cur || cur.mtime !== o.mtime)) throw Object.assign(new Error('conflict'), { code: 'conflict', current: cur ? { ...cur, path } : null });
        files[path] = { content, mtime: (cur ? cur.mtime : 0) + 1 };
        return { app: 'runway', path, mtime: files[path].mtime, size: content.length };
      }
    }
  };
  ws._files = files;
  return ws;
}

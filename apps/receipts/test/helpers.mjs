// Test helpers: the SDK's real folder store (shared/workshop-sdk.js) on an in-memory folder (shared/test/fake-dir.mjs),
// wrapped as the ws.data and ws.files that Receipts gets from connect(). So these tests run Receipts against the
// same rev, conflict, nested-name and files rules as the browser's folder backend and the agent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _internals, data as sdkData } from '../../../shared/workshop-sdk.js';
import { FakeFolder } from '../../../shared/test/fake-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const fixture = name => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8'));
export const clone = v => JSON.parse(JSON.stringify(v));
export const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/** A folder and a way to open "windows" on it: each window is {data, files} for the receipts app. */
export function workshop(app = 'receipts') {
  const folder = new FakeFolder('Workshop');
  let n = 0;
  const open = () => {
    const s = _internals.makeFolderStore({ clientId: 'w-' + (++n) }, folder.root, { timers: false, channel: null });
    return {
      store: s,
      data: {
        get: c => s.get(app, c), put: (c, env) => s.put(app, c, env), subscribe: (c, fn) => s.subscribe(app, c, fn),
        merge: sdkData.merge, stamp: sdkData.stamp
      },
      files: {
        list: f => s.files.list(app, f), read: p => s.files.read(app, p),
        write: (p, content, opts) => s.files.write(app, p, content, opts), trash: (p, opts) => s.files.trash(app, p, opts),
        subscribe: (t, fn) => s.files.subscribe(app, t, fn)
      }
    };
  };
  return { folder, open };
}

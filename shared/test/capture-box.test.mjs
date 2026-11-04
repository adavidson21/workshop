import test from 'node:test';
import assert from 'node:assert/strict';
import { data as sdkData } from '../workshop-sdk.js';
import { KEEP_DAYS, createCaptureStore } from '../capture-box.js';
import { parseCapture } from '../capture.js';

// A fake ws with one in-memory collection and the SDK's real stamp and merge.
function fakeWs({ fail = null, start = null } = {}) {
  const box = { env: start, puts: 0 };
  return {
    box,
    data: {
      stamp: sdkData.stamp, merge: sdkData.merge,
      async get(name) { if (fail) throw fail; assert.equal(name, 'handoffs'); return box.env && structuredClone(box.env); },
      async put(name, env) {
        if (fail) throw fail;
        if (box.env && env.rev !== box.env.rev) { const e = new Error('conflict'); e.code = 'conflict'; e.current = structuredClone(box.env); throw e; }
        box.puts++; box.env = { ...structuredClone(env), rev: (env.rev || 0) + 1 }; return { rev: box.env.rev };
      }
    }
  };
}
const ctx = { today: '2026-11-03', people: [{ id: 'p_one', name: 'Person One', relation: 'report' }] };

test('send writes accepted handoffs to the app own collection', async () => {
  const ws = fakeWs();
  const s = createCaptureStore(ws, { sender: 'home', now: () => new Date('2026-11-03T12:00:00Z') });
  await s.load();
  const sent = await s.send([parseCapture('t budget fri', ctx), parseCapture('r person shipped it', ctx), parseCapture('a question?', ctx)]);
  assert.equal(sent.length, 2, 'questions are not sent');
  assert.equal(ws.box.env.schema, 'home.handoffs');
  assert.equal(ws.box.env.items.length, 2);
  assert.ok(ws.box.env.items.every(i => i.accepted === true && i.source.app === 'home' && i.updatedAt));
  assert.deepEqual(s.state().recent.map(i => i.to).sort(), ['prioritizer', 'receipts']);
});

test('withdraw leaves a tombstone', async () => {
  const ws = fakeWs();
  const s = createCaptureStore(ws, { sender: 'agents' });
  await s.load();
  const [h] = await s.send([parseCapture('n idea', ctx)]);
  await s.withdraw(h.id);
  assert.equal(ws.box.env.items.length, 0);
  assert.ok(ws.box.env.deleted[h.id]);
});

test('a write from another window is merged, not lost', async () => {
  const ws = fakeWs();
  const a = createCaptureStore(ws, { sender: 'home' }), b = createCaptureStore(ws, { sender: 'home' });
  await a.load(); await b.load();
  await a.send([parseCapture('one', ctx)]);
  await b.send([parseCapture('two', ctx)]);
  assert.deepEqual(ws.box.env.items.map(i => i.text).sort(), ['One', 'Two']);
});

test('old offers are dropped after KEEP_DAYS', async () => {
  const old = { id: 'c_old', updatedAt: 1, to: 'notes', date: '2026-08-01', createdAt: '2026-08-01T00:00:00Z', text: 'x', payload: { kind: 'note' }, source: { app: 'home' }, accepted: true };
  const ws = fakeWs({ start: { schema: 'home.handoffs', version: 1, rev: 3, items: [old], deleted: {} } });
  const s = createCaptureStore(ws, { sender: 'home', now: () => new Date('2026-11-03T00:00:00Z') });
  await s.load();
  await s.send([parseCapture('new one', ctx)]);
  assert.equal(KEEP_DAYS, 60);
  assert.deepEqual(ws.box.env.items.map(i => i.id).filter(id => id === 'c_old'), []);
});

test('waiting for the folder and a newer version refuse to write', async () => {
  const unavailable = Object.assign(new Error('x'), { code: 'unavailable' });
  const s = createCaptureStore(fakeWs({ fail: unavailable }), { sender: 'home' });
  assert.equal((await s.load()).waiting, true);
  await assert.rejects(s.send([parseCapture('x', ctx)]), { code: 'unavailable' });
  const n = createCaptureStore(fakeWs({ start: { schema: 'home.handoffs', version: 2, rev: 1, items: [], deleted: {} } }), { sender: 'home' });
  assert.equal((await n.load()).newer, true);
  await assert.rejects(n.send([parseCapture('x', ctx)]), { code: 'downgrade' });
});

// Dispatch tells Slate about work started here (docs/handoffs.md, Receivers: slate, kind `work`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWork, workOffer } from '../js/slate-handoff.js';

const NOW = new Date('2026-11-06T12:00:00Z');

test('workOffer: local work carries its folder and id; an ADO start its id; spikes get none', () => {
  const local = workOffer({ action: 'start.local', args: { title: 'Fix  the\nexport', lane: 'bug', description: 'Why', project: 'p_1' }, res: { id: 'L3', folder: 'L3-fix-the-export' }, from: 'spike-export' }, NOW);
  assert.equal(local.id, 'h_work_L3-fix-the-export');
  assert.equal(local.to, 'slate');
  assert.equal(local.accepted, true);
  assert.deepEqual(local.payload, { kind: 'work', title: 'Fix the export', lane: 'bug', folder: 'L3-fix-the-export', id: 'L3', description: 'Why', project: 'p_1', from: 'spike-export' });
  assert.deepEqual(local.source, { app: 'agents', id: 'L3-fix-the-export' });
  const ado = workOffer({ action: 'start', args: { id: '41207', lane: 'feature' }, res: {} }, NOW);
  assert.deepEqual([ado.id, ado.payload.ado, ado.payload.title], ['h_work_ado-41207', 41207, '#41207']);
  assert.equal(workOffer({ action: 'spike', args: { topic: 'x' }, res: {} }), null);
  assert.equal(workOffer({ action: 'start.local', args: { title: 'x' }, res: { folder: '../bad' } }), null);
});

test('sendWork adds the offer to agents.handoffs, replacing the same id and keeping captures', async () => {
  let env = { schema: 'agents.handoffs', version: 1, rev: 1, items: [{ id: 'cap1', to: 'notes', createdAt: '2026-11-05T00:00:00Z' }, { id: 'old', to: 'notes', createdAt: '2026-08-01T00:00:00Z' }], deleted: {} };
  const ws = { data: { get: async () => env, stamp: (b, a) => a, put: async (name, after) => { env = after; return { rev: 2 }; }, merge: (a) => a } };
  const offer = workOffer({ action: 'start.local', args: { title: 'A', lane: 'feature' }, res: { id: 'L1', folder: 'L1-a' } }, NOW);
  await sendWork(ws, offer, NOW);
  await sendWork(ws, offer, NOW);
  assert.deepEqual(env.items.map(i => i.id), ['cap1', 'h_work_L1-a']);
});

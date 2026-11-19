// Dispatch's summary for other apps, and the Slate links it reads (js/summary.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { slateLinks, summaryCards } from '../js/dispatch/summary.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');

test('needs: agents asking and PRs waiting; done-week: runs that reached PR or shipped this week', () => {
  const items = [
    { kind: 'item', id: '41207', folder: '41207-login', title: 'Login timeout', bucket: 'active', modifiedMs: NOW - 864e5, next: { stage: 'ship' } },
    { kind: 'item', id: '41300', folder: '41300-export', title: 'Export retry', bucket: 'done', modifiedMs: NOW - 2 * 864e5 },
    { kind: 'item', id: '41400', folder: '41400-old', title: 'Old', bucket: 'done', modifiedMs: NOW - 9 * 864e5 },
    { kind: 'spike', folder: 'spike-x', title: 'Spike', modifiedMs: NOW }
  ];
  const [needs, week] = summaryCards({ items, prompts: [{ folder: '41207-login' }], prs: [{ title: 'Add cache' }, { title: 'Mine', waiting: true }], now: NOW });
  assert.deepEqual(needs.rows.map(r => [r.title, r.flag || '']), [['#41207 Login timeout', 'urgent'], ['1 pull request waiting for your review', '']]);
  assert.deepEqual(week.rows.map(r => [r.title, r.note]), [['#41207 Login timeout', 'PR ready'], ['#41300 Export retry', 'Shipped']]);
  assert.equal(needs.kind, 'list');
});

test('Slate links: only a readable slate.summary with an ado card', () => {
  const env = { schema: 'slate.summary', version: 1, items: [{ id: 'ado', kind: 'list', rows: [{ id: '41207', title: 'Login', route: 'item/w_1', note: 'Asked by Finance' }, { id: 'x' }] }] };
  const m = slateLinks(env);
  assert.deepEqual([...m.keys()], ['41207']);
  assert.equal(m.get('41207').route, 'item/w_1');
  assert.equal(slateLinks({ ...env, version: 2 }).size, 0);
  assert.equal(slateLinks(null).size, 0);
});

test('slateLinks reads the runs card by ADO id and run folder, with merged', () => {
  const env = { schema: 'slate.summary', version: 1, items: [
    { id: 'ado', kind: 'list', rows: [{ id: '41207', route: 'item/w_1', title: 'Login' }] },
    { id: 'runs', kind: 'list', rows: [{ id: 'L3-local', folder: 'L3-local', route: 'item/w_2', title: 'Local' }, { id: '41300', route: 'item/w_3', title: 'Export', flag: 'done' }] }
  ] };
  const m = slateLinks(env);
  assert.equal(m.get('L3-local').route, 'item/w_2');
  assert.equal(m.get('41300').merged, true);
  assert.equal(m.get('41207').merged, false);
});

test('Loom 6.2.0: the agents card is the factory queue for Docket (answer, teach, approve, publish)', async () => {
  const { agentQueue } = await import('../js/dispatch/summary.js');
  const items = [
    { kind: 'item', id: '1', folder: '1-a', title: 'Asking', next: { stage: 'build' } },
    { kind: 'item', id: 'L2', folder: 'L2-b', title: 'Plan', next: { stage: 'plan', command: '/approve L2', needsYou: true } },
    { kind: 'item', id: '3', folder: '3-c', title: 'Ready', next: { stage: 'ship' } },
    { kind: 'item', id: '4', folder: '4-d', title: 'Published', next: { stage: 'ship' } },
    { kind: 'item', id: '5', folder: '5-e', title: 'Paused', paused: {}, next: { stage: 'plan', command: '/approve 5', needsYou: true } }
  ];
  const rows = agentQueue({
    items,
    asking: new Map([['1-a', 1]]),
    publish: { '3-c': { ready: true, published: null }, '4-d': { ready: true, published: { at: 'x' } } },
    gaps: [{ id: 'G1', question: 'Who approves?', assumed: 'The EM' }, { id: 'G2', question: 'Refund cap?', assumed: null }, { id: 'G3', question: 'Sent', sent: 'x' }]
  });
  assert.deepEqual(rows.map(r => [r.id, r.note]), [
    ['1-a', 'Answer Tandem'], ['gap:G2', 'Teach Tandem: a build waits on this'], ['gap:G1', 'Teach Tandem'], ['L2-b', 'Approve the plan'], ['3-c', 'Ready to publish']
  ]);
  assert.equal(rows[1].route, 'teach');
  assert.equal(rows[3].route, 'L2');
  assert.ok(rows.every(r => !('kind' in r)));
  const cards = summaryCards({ items, prompts: [], prs: [], now: NOW, publish: { '3-c': { ready: true } } });
  const agents = cards.find(c => c.id === 'agents');
  assert.equal(agents.kind, 'list');
  assert.deepEqual(agents.rows.map(r => r.id), ['L2-b', '3-c']);
});

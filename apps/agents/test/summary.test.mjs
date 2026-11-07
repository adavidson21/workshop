// Dispatch's summary for other apps, and the Slate links it reads (js/summary.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { slateLinks, summaryCards } from '../js/summary.js';

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

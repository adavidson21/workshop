import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestCard, digestHtml } from '../js/digest.js';

const span = { key: '2026-11-09T09:00', start: '09:00', end: '12:00' };
const ms = [new Date(2026, 10, 9, 9).getTime(), new Date(2026, 10, 9, 12).getTime()];
const h = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const held = [{ app: 'prioritizer', name: 'Docket', count: 3, label: '3 new ADO items', route: 'today' }, { app: 'agents', name: 'Dispatch', count: 2, label: '2 Dispatch updates waiting', route: 'inbox' }];

test('digest from fake summaries: held parts, runs waiting, reviews finished in the span (blocking first)', () => {
  const reviews = [
    { folder: 'pr-5', title: 'Small fix', modifiedMs: ms[0] + 60e3 },
    { folder: 'pr-7', title: '<b>Login</b>', modifiedMs: ms[0] + 120e3 },
    { folder: 'pr-9', title: 'Before', modifiedMs: ms[0] - 60e3 }
  ];
  const c = digestCard({ span, held, waiting: 1, reviews, blocking: new Set(['7']), date: '2026-11-09', spanMs: ms });
  assert.deepEqual(c.lines.map(l => l.text), ['Blocking PR review ready: <b>Login</b>', 'PR review ready: Small fix', '1 run waiting on you', 'Docket: 3 new ADO items']);
  const html = digestHtml(c, h);
  assert.match(html, /While you were focused/);
  assert.match(html, /&lt;b&gt;Login/);
  assert.match(html, /Until 12:00/);
});

test('one per day: a later span replaces it; dismiss hides it until tomorrow; another day shows nothing', () => {
  const later = { key: '2026-11-09T14:00', start: '14:00', end: '15:00' };
  assert.equal(digestCard({ span: later, held: [{ ...held[0], label: 'later' }], date: '2026-11-09' }).key, later.key);
  assert.equal(digestCard({ span, held, date: '2026-11-09', dismissed: '2026-11-09' }), null);
  assert.ok(digestCard({ span, held, date: '2026-11-09', dismissed: '2026-11-08' }));
  assert.equal(digestCard({ span, held, date: '2026-11-10' }), null);
  assert.equal(digestCard({ span: null, held, date: '2026-11-09' }), null);
});

test('works with the connector off: only what other apps report', () => {
  const c = digestCard({ span, held: held.slice(0, 1), date: '2026-11-09' });
  assert.deepEqual(c.lines.map(l => [l.app, l.route]), [['prioritizer', 'today']]);
  assert.equal(digestCard({ span, held: [], date: '2026-11-09' }), null, 'nothing to say: no card');
  assert.equal(digestCard({ span, held: held.slice(1), date: '2026-11-09' }).lines[0].text, '2 Dispatch updates waiting');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, findPeople, isCapture, nextKind, parseCapture, parseDay, parseLines, retarget, toHandoff } from '../capture.js';

const people = [
  { id: 'p_me', name: 'Sam Self', relation: 'self' },
  { id: 'p_one', name: 'Person One', relation: 'report' },
  { id: 'p_two', name: 'Jordan Two', relation: 'manager' },
  { id: 'p_old', name: 'Old Report', relation: 'report', archived: true },
  { id: 'p_a', name: 'Alex Aaa', relation: 'peer' },
  { id: 'p_b', name: 'Alex Bbb', relation: 'peer' }
];
const ctx = { today: '2026-11-03', people, lists: ['Inbox', 'This sprint'] }; // a Tuesday

test('parseDay: words, weekdays, dates', () => {
  assert.equal(parseDay('today', ctx.today), '2026-11-03');
  assert.equal(parseDay('tomorrow', ctx.today), '2026-11-04');
  assert.equal(parseDay('fri', ctx.today), '2026-11-06');
  assert.equal(parseDay('tuesday', ctx.today), '2026-11-10', 'the next one, not today');
  assert.equal(parseDay('11/14', ctx.today), '2026-11-14');
  assert.equal(parseDay('1/5', ctx.today), '2027-01-05', 'passed this year, so next year');
  assert.equal(parseDay('2026-12-01', ctx.today), '2026-12-01');
  assert.equal(parseDay('2026-02-30', ctx.today), null);
  assert.equal(parseDay('docs', ctx.today), null);
  assert.equal(parseDay('frank', ctx.today), null);
});

test('findPeople: full and unique first names, never self or archived', () => {
  assert.deepEqual(findPeople('onboarding doc for person', people).map(p => p.id), ['p_one']);
  assert.deepEqual(findPeople("Jordan's review", people).map(p => p.id), ['p_two']);
  assert.deepEqual(findPeople('ask alex', people), [], 'two Alexes: neither');
  assert.deepEqual(findPeople('ask alex bbb', people).map(p => p.id), ['p_b']);
  assert.deepEqual(findPeople('sam and old report', people), []);
});

test('plain text is a Docket task with filler removed and names cased', () => {
  const p = parseCapture('dont forget about the onboarding doc for person', ctx);
  assert.equal(p.kind, 'task');
  assert.equal(p.to, 'prioritizer');
  assert.equal(p.title, 'The onboarding doc for Person');
  assert.deepEqual(p.payload, { kind: 'task', title: 'The onboarding doc for Person', people: ['Person One'] });
});

test('task dates, urgency and lists', () => {
  const p = parseCapture('t send budget by fri ! #this', ctx);
  assert.deepEqual(p.payload, { kind: 'task', title: 'Send budget', due: '2026-11-06', urgent: true, list: 'This sprint' });
  assert.equal(parseCapture('call the vendor tomorrow!', ctx).payload.urgent, true);
  assert.equal(parseCapture('#nolist thing', ctx).payload.title, '#nolist thing', 'unknown list stays in the title');
});

test('waiting on', () => {
  const p = parseCapture('waiting on jordan for the API keys', ctx);
  assert.equal(p.kind, 'waiting');
  assert.equal(p.payload.waiting, true);
  assert.equal(p.payload.title, 'Waiting on Jordan for the API keys');
  assert.deepEqual(p.payload.people, ['Jordan Two']);
  assert.equal(parseCapture('w keys from IT', ctx).payload.waiting, true);
});

test('receipts and notes', () => {
  const r = parseCapture('r person shipped the migration early', ctx);
  assert.equal(r.to, 'receipts');
  assert.deepEqual(r.payload, { kind: 'win', impact: 0, about: 'p_one' });
  assert.equal(r.text, 'Person shipped the migration early');
  assert.equal(parseCapture('r growth: led the retro', ctx).payload.kind, 'growth');
  assert.equal(parseCapture('feedback: clearer PR descriptions', ctx).payload.kind, 'feedback');
  assert.equal(parseCapture('r about the manager jordan', ctx).payload.about, undefined, 'only reports are about someone');
  const n = parseCapture('note: retro ideas. More async standups', ctx);
  assert.equal(n.to, 'notes');
  assert.equal(n.payload.title, 'Retro ideas');
  assert.equal(n.text, 'retro ideas. More async standups');
});

test('questions and places', () => {
  assert.deepEqual(parseCapture('what version of .NET is the portal on?', ctx), { kind: 'ask', text: 'what version of .NET is the portal on?' });
  assert.equal(parseCapture('? where did I leave off', ctx).kind, 'ask');
  assert.deepEqual(parseCapture('> receipts', ctx), { kind: 'go', app: 'receipts', text: '> receipts' });
  assert.deepEqual(parseCapture('> 1:1s', ctx), { kind: 'go', app: 'receipts', path: '1on1s', text: '> 1:1s' }, '1:1s are part of Rapport');
  assert.deepEqual(parseCapture('> the rapport', ctx), { kind: 'go', app: 'receipts', text: '> the rapport' });
  assert.equal(parseCapture('> queue', ctx).kind, 'ask', 'Queue was removed');
  assert.equal(parseCapture('> docket', ctx).app, 'prioritizer');
  assert.equal(parseCapture('> somewhere odd', ctx).kind, 'ask');
  assert.equal(parseCapture('t is this a task?', ctx).kind, 'task', 'a prefix wins over the question mark');
  assert.equal(parseCapture('   ', ctx), null);
});

test('parseLines, retarget, nextKind, isCapture', () => {
  const ps = parseLines('one\n\nn two\nthree?', ctx);
  assert.deepEqual(ps.map(p => p.kind), ['task', 'note', 'ask']);
  assert.equal(isCapture(ps[0]), true);
  assert.equal(isCapture(ps[2]), false);
  const r = retarget(ps[0], 'receipt', ctx);
  assert.equal(r.to, 'receipts');
  assert.equal(nextKind('task'), 'waiting');
  assert.equal(nextKind('note'), 'task');
});

test('toHandoff: an accepted handoff in the docs/handoffs.md shape', () => {
  const p = parseCapture('t send budget fri', ctx);
  const h = toHandoff(p, { sender: 'home', id: 'c_x', now: new Date('2026-11-03T22:00:00Z') });
  assert.equal(h.id, 'c_x');
  assert.equal(h.to, 'prioritizer');
  assert.equal(h.accepted, true);
  assert.deepEqual(h.source, { app: 'home', id: 'c_x' });
  assert.equal(h.text, 'Send budget');
  assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(h.createdAt, '2026-11-03T22:00:00.000Z');
  assert.equal(toHandoff(p, {}), null, 'needs a sender');
  assert.equal(toHandoff({ kind: 'ask', text: 'x' }, { sender: 'home' }), null);
});

test('describe', () => {
  assert.equal(describe(parseCapture('w keys from jordan fri !', ctx)), 'Docket, waiting on · Jordan Two · due 2026-11-06 · urgent');
  assert.equal(describe(parseCapture('r growth: x', ctx)), 'Rapport, growth');
  assert.equal(describe(parseCapture('n x', ctx)), 'Notes');
});

test('handoff matches the docs schema', async () => {
  const { SchemaSet } = await import('../../tests/lib/schema.mjs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const schemas = SchemaSet.fromDir(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/schemas'));
  for (const line of ['t a fri', 'w b', 'r person did c', 'n d']) {
    const h = toHandoff(parseCapture(line, ctx), { sender: 'home' });
    h.updatedAt = 1;
    assert.deepEqual(schemas.validate('handoff-item', h), [], line);
  }
});

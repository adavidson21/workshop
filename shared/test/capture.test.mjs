import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, findMap, findPeople, isCapture, nextKind, parseCapture, parseDay, parseLines, retarget, toHandoff } from '../capture.js';

const people = [
  { id: 'p_me', kind: 'person', name: 'Sam Self', handle: 'sam', relation: 'self' },
  { id: 'p_one', kind: 'person', name: 'Person One', handle: 'person', relation: 'report' },
  { id: 'p_two', kind: 'person', name: 'Jordan Two', handle: 'jordan', relation: 'manager' },
  { id: 'p_old', kind: 'person', name: 'Old Report', handle: 'old', relation: 'report', archived: true },
  { id: 'p_a', kind: 'person', name: 'Alex Aaa', handle: 'alex', relation: 'peer' },
  { id: 'p_b', kind: 'person', name: 'Alex Bbb', handle: 'alex-bbb', relation: 'peer' },
  { id: 'g_lead', kind: 'group', name: 'Leadership', handle: 'leadership', members: ['p_two', 'p_a'] }
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
  assert.deepEqual(findPeople('ask @leadership and @alex.', people).map(p => p.id), ['p_a', 'g_lead'], 'handles, groups included');
  assert.deepEqual(findPeople('leadership offsite', people), [], 'a group needs its handle');
});

test('plain text is a Docket task with filler removed and names cased', () => {
  const p = parseCapture('dont forget about the onboarding doc for person', ctx);
  assert.equal(p.kind, 'task');
  assert.equal(p.to, 'prioritizer');
  assert.equal(p.title, 'The onboarding doc for Person');
  assert.deepEqual(p.payload, { kind: 'task', title: 'The onboarding doc for Person', who: ['p_one'] });
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
  assert.deepEqual(p.payload.who, ['p_two']);
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
  assert.deepEqual(parseCapture('> goals', ctx), { kind: 'go', app: 'receipts', path: 'goals', text: '> goals' }, 'Goals are part of Rapport');
  assert.deepEqual(parseCapture('> OKRs', ctx), { kind: 'go', app: 'receipts', path: 'goals', text: '> OKRs' });
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
  assert.equal(nextKind('note'), 'idea');
  assert.equal(nextKind('idea'), 'task');
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

test('p: a roadmap idea for Runway, to a named roadmap or Pending', () => {
  const c = { ...ctx, maps: [{ id: 'm-docs', title: 'Docs Portal' }, { id: 'm-plat', title: 'Platform Q1' }, { id: 'm-plat2', title: 'Platform Q2' }] };
  assert.deepEqual(parseCapture('p bug: search shows archived pages', c),
    { kind: 'idea', to: 'runway', text: 'Bug: search shows archived pages', title: 'Bug: search shows archived pages', payload: { kind: 'idea' } }, 'no roadmap called bug: Pending');
  const w = parseCapture('p docs portal: dark mode', c);
  assert.deepEqual(w.payload, { kind: 'idea', map: 'm-docs', mapTitle: 'Docs Portal' });
  assert.equal(w.text, 'Dark mode');
  assert.equal(parseCapture('idea: docs: offline reading', c).payload.map, 'm-docs', 'the start of one title matches');
  assert.equal(findMap('platform: x', c.maps), null, 'two titles start with it');
  assert.equal(parseCapture('p platform q2: x', c).payload.map, 'm-plat2');
  assert.equal(describe(w), 'Runway · Docs Portal, unscheduled');
  assert.equal(describe(parseCapture('p something', c)), 'Runway · Pending assignment');
  assert.equal(retarget(parseCapture('send the deck', c), 'idea', c).kind, 'idea');
  const h = toHandoff(w, { sender: 'home', id: 'c_x', now: new Date('2026-11-04T21:00:00Z') });
  assert.equal(h.to, 'runway'); assert.equal(h.accepted, true); assert.equal(h.payload.map, 'm-docs');
});

test('useApps: capture targets, names and places come from the manifests on this site', async () => {
  const C = await import('../capture.js');
  try {
    const apps = [
      { id: 'home', name: 'Home', order: 0, capture: [], aliases: [] },
      { id: 'prioritizer', name: 'Docket', order: 10, capture: ['task', 'waiting'], aliases: ['tasks', { name: 'today', path: 'today' }] },
      { id: 'receipts', name: 'Rapport', order: 30, capture: ['receipt'], aliases: [{ name: '1:1s', path: '1on1s' }] },
      { id: 'notes', name: 'Notes', order: 40, capture: ['note'], aliases: [] },
      { id: 'newapp', name: 'Ideas Box', order: 60, capture: ['idea'], aliases: ['box'] }
    ];
    C.useApps(apps);
    const ctx = { today: '2026-11-04' };
    assert.equal(C.parseCapture('p a new idea', ctx).to, 'newapp', 'a new app takes ideas from its manifest');
    assert.deepEqual(C.parseCapture('> box', ctx), { kind: 'go', app: 'newapp', text: '> box' });
    assert.deepEqual(C.parseCapture('> ideas box', ctx), { kind: 'go', app: 'newapp', text: '> ideas box' });
    assert.deepEqual(C.parseCapture('> today', ctx), { kind: 'go', app: 'prioritizer', path: 'today', text: '> today' });
    assert.equal(C.parseCapture('> runway', ctx).kind, 'ask', 'Runway is not on this site, so its place is gone');
    assert.equal(C.TARGET_NAMES.newapp, 'Ideas Box');

    C.useApps(apps.filter(a => a.id !== 'newapp'));
    const p = C.parseCapture('p a new idea', ctx);
    assert.equal(p.to, 'prioritizer', 'no app takes ideas: the line is a task');
    assert.equal(p.title, 'P a new idea');

    C.useApps([{ id: 'prioritizer', name: 'Docket', order: 10 }, { id: 'receipts', name: 'Rapport', order: 30 }]);
    assert.equal(C.parseCapture('t write it', ctx).to, 'prioritizer', 'built-in targets count for apps that are there');
    assert.equal(C.parseCapture('r shipped it', ctx).to, 'receipts');
    assert.equal(C.parseCapture('> 1:1s', ctx).path, '1on1s', 'built-in places too');
    assert.equal(C.parseCapture('n a note', ctx).to, 'prioritizer', 'Notes is not here');

    C.useApps([{ id: 'home', name: 'Home', order: 0 }]);
    assert.equal(C.parseCapture('write it', ctx).kind, 'ask', 'no app takes tasks: a question');
  } finally { C.useApps(null); }
  assert.equal(C.TARGETS.idea, 'runway', 'back to the defaults');
});

test('n <folder>: and n today: send a note to a Notes folder or today\'s note; other colons are just text', () => {
  const folders = [{ id: 'today', title: 'today' }, { id: 'runbooks', title: 'runbooks' }, { id: 'team-notes', title: 'team-notes' }, { id: 'team-notes/retros', title: 'team-notes/retros' }];
  const ctx = { today: '2026-11-06', folders };
  const a = parseCapture('n runbooks: rollback needs the feature flag off first', ctx);
  assert.deepEqual(a.payload, { kind: 'note', title: 'Rollback needs the feature flag off first', folder: 'runbooks' });
  assert.equal(a.text, 'rollback needs the feature flag off first');
  assert.match(describe(a), /^Notes · runbooks\/ · new note "Rollback needs the feature flag off first"$/);
  const t = parseCapture('n Today: Priya asked about the offsite', ctx);
  assert.equal(t.payload.daily, '2026-11-06');
  assert.equal(t.payload.folder, undefined);
  assert.equal(describe(t), "Notes · today's note");
  assert.equal(parseCapture('n team notes: async standups', ctx).payload.folder, 'team-notes', 'a space matches a dash');
  assert.equal(parseCapture('n run: x', ctx).payload.folder, 'runbooks', 'the start of exactly one folder');
  assert.equal(parseCapture('n team: x', ctx).payload.folder, undefined, 'the start of two folders: no folder');
  const plain = parseCapture('n Remember: call the vendor', ctx);
  assert.equal(plain.payload.folder, undefined);
  assert.equal(plain.text, 'Remember: call the vendor', 'no folder by that name: the colon is part of the text');
  assert.equal(describe(plain), 'Notes');
  assert.equal(parseCapture('n runbooks: x', {}).payload.folder, undefined, 'no folders known: as before');
  assert.equal(parseCapture('n runbooks:', ctx).text, 'runbooks:', 'nothing after the colon: the whole line');
});

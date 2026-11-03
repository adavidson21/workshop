// 1:1s model: packet sections, since-last date, follow-ups and wins, version checks, what the draft step
// gets (concerns left out unless asked), quick-add lines and Receipts offers. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as M from '../js/model.js';
import { NOW, PERSON, TODAY, docketPeople, docketTasks, entry, item, queueSettings, queueSnapshot, receiptsEntries, receiptsPeopleEnv, task } from './fake.mjs';

const notes = days => days.map(d => ({ day: d, path: M.notePath(PERSON.id, d), mtime: 1 }));

test('since last 1:1: the newest note before today, else cadence days ago', () => {
  assert.deepEqual(M.sinceDate({ notes: notes(['2026-11-03', '2026-10-27', '2026-10-20']), today: TODAY, cadenceDays: 7 }).since, '2026-10-27', "today's own note does not count");
  const none = M.sinceDate({ notes: [], today: TODAY, cadenceDays: 14 });
  assert.deepEqual([none.since, none.from, none.last], ['2026-10-20', 'cadence', null]);
  assert.equal(M.sinceDate({ notes: notes(['2026-11-03']), today: TODAY, cadenceDays: 7 }).from, 'cadence');
  assert.equal(M.addDays('2026-03-01', -1), '2026-02-28');
});

test('cadence: due when there is no note, or the last one is cadence days old', () => {
  assert.deepEqual(M.cadenceState([], TODAY, 7), { lastDay: '', days: null, due: true });
  assert.equal(M.cadenceState(notes(['2026-10-27']), TODAY, 7).due, true);
  assert.equal(M.cadenceState(notes(['2026-10-30']), TODAY, 7).due, false);
});

test('notes: one folder per person, following Workshop name rules', () => {
  assert.equal(M.noteFolder('p_mh3k9x2a'), 'notes/p-mh3k9x2a');
  assert.match(M.notePath('P_Odd.Id', TODAY), /^notes\/[a-z0-9][a-z0-9-]{0,39}\/2026-11-03\.md$/);
  const list = M.notesFor([{ path: 'notes/p-abc1/2026-10-27.md' }, { path: 'notes/p-abc1/2026-11-03.md' }, { path: 'notes/p-abc1/scratch.md' }, { path: 'notes/p-other/2026-11-01.md' }], 'p_abc1');
  assert.deepEqual(list.map(n => n.day), ['2026-11-03', '2026-10-27']);
});

test('follow-ups: unchecked task lines are open, checked are done, empty and fenced ones skipped', () => {
  const md = '# 1:1\n\n## Follow-ups\n\n- [ ] Send the design doc\n- [x] Book the demo\n* [ ]   Pair on   the flaky test \n- [ ] \n\n```\n- [ ] not a task\n```\n';
  assert.deepEqual(M.parseFollowUps(md), { open: ['Send the design doc', 'Pair on the flaky test'], done: ['Book the demo'] });
});

test('wins: bullet lines under the Wins heading only', () => {
  const md = '## Talking points\n\n- Not a win\n\n## Wins\n\n- Shipped the import fix\n- \n- [ ] a task, not a win\n\n### Detail\n\n- Still under Wins\n\n## Notes\n\n- Not a win either\n';
  assert.deepEqual(M.parseWins(md), ['Shipped the import fix', 'Still under Wins']);
});

test('version checks: unknown versions and schemas are unreadable, never empty', () => {
  assert.equal(M.readable(null, M.SOURCES.docketTasks).state, 'missing');
  assert.equal(M.readable(docketTasks([], 4), M.SOURCES.docketTasks).state, 'unreadable');
  assert.equal(M.readable({ ...docketTasks([]), schema: 'prioritizer.lists' }, M.SOURCES.docketTasks).state, 'unreadable');
  assert.equal(M.docketSection(docketTasks([task('t1', { people: ['DevA'] })], 2), 'DevA', TODAY).state, 'unreadable');
  assert.equal(M.receiptsSection(receiptsEntries([entry('r1')], 2), 'p_r1', '2026-10-27', TODAY).state, 'unreadable');
  assert.equal(M.queueSection({ ...queueSnapshot([item(1)]), version: 2 }, queueSettings(), 'dev.one@example.com', '2026-10-27', NOW).state, 'unreadable');
  assert.deepEqual(M.docketNames({ ...docketPeople(['DevA']), version: 2 }), []);
  assert.equal(M.docketSection(null, 'DevA', TODAY).state, 'missing');
  assert.equal(M.docketSection(docketTasks([]), '', TODAY).state, 'unlinked');
});

test('Docket: open tasks tagged with the person, waiting on them, nudges due', () => {
  const env = docketTasks([
    task('t1', { people: ['devA'], due: '2026-11-05' }),
    task('t2', { people: ['DevA', 'Engineer B'], waiting: true, nudgeOn: '2026-11-02' }),
    task('t3', { people: ['DevA'], waiting: true, nudgeOn: '2026-11-10' }),
    task('t4', { people: ['DevA'], done: true }),
    task('t5', { people: ['Engineer B'] })
  ]);
  const s = M.docketSection(env, 'DevA', TODAY);
  assert.deepEqual(s.open.map(t => t.id), ['t1']);
  assert.equal(s.open[0].due, '2026-11-05');
  assert.deepEqual(s.waiting.map(t => t.id), ['t2', 't3']);
  assert.deepEqual(s.nudges.map(t => t.id), ['t2']);
});

test('Receipts: entries about them in the period, grouped by kind', () => {
  const env = receiptsEntries([
    entry('r1', { kind: 'win', date: '2026-10-28' }),
    entry('r2', { kind: 'concern', date: '2026-10-29' }),
    entry('r3', { kind: 'odd', date: '2026-10-30' }),
    entry('r4', { kind: 'win', date: '2026-10-20' }),
    entry('r5', { about: 'me', date: '2026-10-30' }),
    entry('r6', { about: 'p_other', date: '2026-10-30' })
  ]);
  const s = M.receiptsSection(env, 'p_r1', '2026-10-27', TODAY);
  assert.equal(s.total, 3);
  assert.deepEqual(s.groups.win.map(e => e.id), ['r1']);
  assert.deepEqual(s.groups.concern.map(e => e.id), ['r2']);
  assert.deepEqual(s.groups.note.map(e => e.id), ['r3'], 'unknown kinds read as notes');
});

test("Queue: the person's items, with Queue's own rules for in progress, stale and changed", () => {
  const snap = queueSnapshot([
    item(1, { state: 'Active', changed: '2026-11-02T09:00:00Z' }),
    item(2, { state: 'New', changed: '2026-10-01T09:00:00Z' }),
    item(3, { assignee: { name: 'Engineer B', email: 'engineer.b@example.com' } }),
    item(4, { assignee: null })
  ]);
  const s = M.queueSection(snap, queueSettings({ staleDays: 10 }), 'dev.one@example.com', '2026-10-27', NOW);
  assert.deepEqual(s.open.map(i => i.id), ['1', '2']);
  assert.deepEqual(s.inProgress.map(i => i.id), ['1']);
  assert.deepEqual(s.stale.map(i => i.id), ['2']);
  assert.deepEqual(s.changed.map(i => i.id), ['1']);
  assert.equal(s.staleDays, 10);
  const byName = M.queueSection(queueSnapshot([item(5, { assignee: { name: 'Dev One', email: '' } })]), queueSettings(), 'Dev One', '2026-10-27', NOW);
  assert.deepEqual(byName.open.map(i => i.id), ['5'], 'no email: matched by name, as Queue does');
});

test('pickers read what each app keeps', () => {
  assert.deepEqual(M.docketNames(docketPeople(['DevB', 'DevA', 'deva'])), ['DevA', 'DevB']);
  assert.deepEqual(M.receiptsPeople(receiptsPeopleEnv([{ id: 'p_r1', updatedAt: 1, name: 'Engineer A' }, { id: 'p_r2', updatedAt: 1, name: 'Dev One', archived: true }])).map(p => [p.id, p.archived]), [['p_r2', true], ['p_r1', false]]);
  assert.deepEqual(M.queuePeople(queueSettings()), [{ key: 'dev.one@example.com', name: 'Dev One' }]);
});

test('people: cleaned with defaults', () => {
  const p = M.cleanPerson({ id: 'p_x', name: '  Engineer A ', links: { docket: 'DevA', queue: 'Dev.One@Example.com', receipts: '' }, cadenceDays: 500 });
  assert.deepEqual(p, { id: 'p_x', name: 'Engineer A', links: { docket: 'DevA', queue: 'dev.one@example.com' }, cadenceDays: 7, archived: false });
  assert.match(M.newPersonId(NOW, () => 0.5), /^p_[a-z0-9]+$/);
});

function fullPacket() {
  return M.buildPacket({
    person: PERSON, today: TODAY, now: NOW, notes: notes(['2026-10-27']),
    lastText: '## Follow-ups\n\n- [ ] Send the design doc\n- [x] Book the demo\n',
    src: {
      docketTasks: docketTasks([task('t1', { people: ['DevA'] })]),
      receiptsEntries: receiptsEntries([entry('r1'), entry('r2', { kind: 'concern', text: 'Missed two standups' })]),
      queueSnapshot: queueSnapshot([item(1)]),
      queueSettings: queueSettings()
    }
  });
}

test('the packet: every section, and the last open follow-ups', () => {
  const p = fullPacket();
  assert.equal(p.since, '2026-10-27');
  assert.equal(p.docket.open.length, 1);
  assert.equal(p.receipts.total, 2);
  assert.equal(p.queue.open.length, 1);
  assert.deepEqual(p.last, { state: 'ok', day: '2026-10-27', open: ['Send the design doc'] });
  assert.deepEqual(M.lastSection(null), { state: 'none' });
  assert.equal(M.lastSection({ day: '2026-10-27' }, null).state, 'unreadable');
});

test('a new note: template with summary, carried follow-ups, and the sections the app reads back', () => {
  const md = M.noteTemplate({ name: 'Dev One', day: TODAY, packet: fullPacket() });
  assert.match(md, /^# 1:1 with Dev One, 2026-11-03\n/);
  for (const h of ['## Since 2026-10-27', '## Talking points', '## Wins', '## Follow-ups', '## Notes']) assert.ok(md.includes(h), h);
  assert.ok(md.includes('- [ ] Send the design doc'), 'open follow-ups carry over');
  assert.deepEqual(M.parseFollowUps(md).open, ['Send the design doc']);
  assert.deepEqual(M.parseWins(md), []);
});

test('the draft packet leaves out the name, and concerns unless asked for this run', () => {
  const p = fullPacket();
  const without = M.packetMarkdown(p);
  assert.ok(!without.includes('Missed two standups'), 'concerns left out by default');
  assert.ok(!/concern/i.test(without), 'not even the heading');
  assert.ok(!without.includes('Dev One') && !without.includes('DevA'), 'no name');
  assert.ok(without.includes('Synthetic entry r1'));
  const withC = M.packetMarkdown(p, { includeConcerns: true });
  assert.ok(withC.includes('Missed two standups'));
  const big = { ...p, docket: { ...p.docket, open: Array.from({ length: 3000 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(40), due: '' })) } };
  assert.ok(M.packetMarkdown(big).length <= M.MAX_PACKET);
});

test('quick-add lines for Docket: @name only for a one-word name', () => {
  assert.deepEqual(M.quickAddLines(['Send  the doc', ''], 'DevA'), ['Follow up: Send the doc @DevA']);
  assert.deepEqual(M.quickAddLines(['Send the doc'], 'Dev One'), ['Follow up: Send the doc (Dev One)']);
  assert.deepEqual(M.quickAddLines(['Send the doc'], ''), ['Follow up: Send the doc']);
});

test('wins become Receipts offers about the linked report, with stable ids', () => {
  const a = M.winOffers({ person: PERSON, day: TODAY, wins: ['Shipped the import fix'], nowIso: '2026-11-03T20:00:00.000Z' });
  assert.equal(a.length, 1);
  assert.deepEqual({ to: a[0].to, date: a[0].date, payload: a[0].payload, source: a[0].source }, { to: 'receipts', date: TODAY, payload: { kind: 'win', about: 'p_r1' }, source: { app: 'oneonones', id: 'p_abc1' } });
  const b = M.winOffers({ person: PERSON, day: TODAY, wins: ['Shipped the import fix'], nowIso: 'later' });
  assert.equal(a[0].id, b[0].id, 'the same win reuses its id');
  assert.deepEqual(M.winOffers({ person: { ...PERSON, links: {} }, day: TODAY, wins: ['x'], nowIso: '' }), []);
  assert.deepEqual(M.keepRecent([{ date: '2026-08-01' }, { date: '2026-10-01' }], TODAY).map(h => h.date), ['2026-10-01']);
});

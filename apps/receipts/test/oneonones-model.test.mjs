// 1:1s model: packet sections, since-last date, follow-ups and wins, version checks, what the draft step
// gets (concerns left out unless asked), quick-add lines and Receipts offers. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as M from '../js/oneonones/model.js';
import { NOW, PERSON, TODAY, docketPeople, docketTasks, entry, receiptsEntries, receiptsPeopleEnv, task } from './oneonones-fake.mjs';

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

test('notes: one folder per person under oneonones/notes, following Workshop name rules (4 segments)', () => {
  assert.equal(M.noteFolder('p_mh3k9x2a'), 'oneonones/notes/p-mh3k9x2a');
  assert.match(M.notePath('P_Odd.Id', TODAY), /^oneonones\/notes\/[a-z0-9][a-z0-9-]{0,39}\/2026-11-03\.md$/);
  assert.equal(M.notePath('p_abc1', TODAY).split('/').length, 4, 'at most 4 segments');
  const list = M.notesFor([{ path: 'oneonones/notes/p-abc1/2026-10-27.md' }, { path: 'oneonones/notes/p-abc1/2026-11-03.md' }, { path: 'oneonones/notes/p-abc1/scratch.md' }, { path: 'oneonones/notes/p-other/2026-11-01.md' }, { path: 'notes/p-abc1/2026-11-02.md' }], 'p_abc1');
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

test('pickers read what each app keeps', () => {
  assert.deepEqual(M.docketNames(docketPeople(['DevB', 'DevA', 'deva'])), ['DevA', 'DevB']);
  assert.deepEqual(M.receiptsPeople(receiptsPeopleEnv([{ id: 'p_r1', updatedAt: 1, name: 'Engineer A' }, { id: 'p_r2', updatedAt: 1, name: 'Dev One', archived: true }])).map(p => [p.id, p.archived]), [['p_r2', true], ['p_r1', false]]);
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
      receiptsEntries: receiptsEntries([entry('r1'), entry('r2', { kind: 'concern', text: 'Missed two standups' })])
    }
  });
}

test('the packet: every section, and the last open follow-ups', () => {
  const p = fullPacket();
  assert.equal(p.since, '2026-10-27');
  assert.equal(p.docket.open.length, 1);
  assert.equal(p.receipts.total, 2);
  assert.equal(p.queue, undefined, 'no Queue section');
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

test('wins become receipts about the linked report, with stable ids', () => {
  const a = M.winEntries({ person: PERSON, day: TODAY, wins: ['Shipped the import fix'], nowIso: '2026-11-03T20:00:00.000Z' });
  assert.equal(a.length, 1);
  assert.deepEqual({ about: a[0].about, kind: a[0].kind, date: a[0].date, text: a[0].text, evidence: a[0].evidence }, { about: 'p_r1', kind: 'win', date: TODAY, text: 'Shipped the import fix', evidence: 'From a 1:1' });
  assert.match(a[0].id, /^o-p-abc1-2026-11-03-[a-z0-9]+$/);
  const b = M.winEntries({ person: PERSON, day: TODAY, wins: ['Shipped  the import fix'], nowIso: 'later' });
  assert.equal(a[0].id, b[0].id, 'the same win reuses its id');
  assert.deepEqual(M.winEntries({ person: { ...PERSON, links: {} }, day: TODAY, wins: ['x'], nowIso: '' }), []);
});

test('the old 1:1s app: envelopes get the new schema and rev 0; note paths move under oneonones/', () => {
  const old = { schema: 'oneonones.people', version: 1, rev: 9, items: [{ ...PERSON, updatedAt: 5 }], deleted: { p_gone: 4 } };
  const env = M.legacyEnvelope(old, 'people');
  assert.deepEqual({ schema: env.schema, version: env.version, rev: env.rev }, { schema: 'receipts.oneonones/people', version: 1, rev: 0 });
  assert.deepEqual(env.items, old.items);
  assert.deepEqual(env.deleted, { p_gone: 4 });
  assert.equal(M.legacyEnvelope({ ...old, version: 2 }, 'people'), null, 'unknown version is not copied');
  assert.equal(M.legacyEnvelope({ ...old, schema: 'other.people' }, 'people'), null);
  assert.equal(M.legacyEnvelope(null, 'people'), null);
  assert.equal(M.legacyEnvelope({ schema: 'oneonones.settings', version: 1, rev: 2, items: [], meta: { aiDraft: false } }, 'settings').meta.aiDraft, false);
  assert.equal(M.legacyNotePath('notes/p-abc1/2026-11-03.md'), 'oneonones/notes/p-abc1/2026-11-03.md');
  assert.equal(M.legacyNotePath('notes/p-abc1/scratch.md'), '');
  assert.equal(M.legacyNotePath('other/p-abc1/2026-11-03.md'), '');
  assert.equal(M.legacyNotePath('notes/../x/2026-11-03.md'), '');
});

test('Docket through its summary: names, sections and state; the raw collections only as the fallback', async () => {
  const M = await import('../js/oneonones/model.js');
  const summary = { schema: 'prioritizer.summary', version: 1, rev: 1, items: [{ id: 'people', kind: 'people', updatedAt: 1, rows: [
    { name: 'Person One', open: [{ id: 't1', title: 'Write the guide', due: '2026-11-06', nudgeOn: '' }], waiting: [{ id: 't2', title: 'Review', due: '', nudgeOn: '2026-11-03' }] },
    { name: 'person one', open: [], waiting: [] },
    { name: 'Person Two', open: [], waiting: [] }
  ] }] };
  assert.deepEqual(M.docketNames(null, summary), ['Person One', 'Person Two']);
  assert.equal(M.docketState(summary, null), 'ok');
  assert.equal(M.docketState(null, null), 'missing');
  const s = M.docketSection(null, 'PERSON ONE', '2026-11-04', summary);
  assert.deepEqual(s.open.map(t => t.id), ['t1']);
  assert.deepEqual(s.nudges.map(t => t.id), ['t2']);
  assert.deepEqual(M.docketSection(null, 'Nobody', '2026-11-04', summary), { state: 'ok', open: [], waiting: [], nudges: [] });
  const raw = { schema: 'prioritizer.tasks', version: 3, rev: 1, items: [{ id: 'r1', title: 'Raw task', people: ['Person One'] }] };
  assert.deepEqual(M.docketSection(raw, 'Person One', '2026-11-04', null).open.map(t => t.id), ['r1'], 'no summary: the tasks collection');
});

// 1:1s model: packet sections, since-last date, follow-ups and wins, version checks, what the draft step
// gets (concerns left out unless asked), quick-add lines and Receipts offers. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as M from '../js/oneonones/model.js';
import { DIR, NOW, PERSON, TODAY, docketSummary, entry, receiptsEntries, task } from './oneonones-fake.mjs';

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
  assert.equal(M.readable(null, M.SOURCES.docketSummary).state, 'missing');
  assert.equal(M.readable(docketSummary([], 2), M.SOURCES.docketSummary).state, 'unreadable');
  assert.equal(M.docketSection('p_r1', TODAY, docketSummary([], 2)).state, 'unreadable');
  assert.equal(M.receiptsSection(receiptsEntries([entry('r1')], 2), 'p_r1', '2026-10-27', TODAY).state, 'unreadable');
  assert.equal(M.docketSection('p_r1', TODAY, null).state, 'missing');
  assert.equal(M.docketSection('', TODAY, docketSummary([])).state, 'unlinked');
});

test('Docket: from its summary by person id, with tasks that reach them through a group', () => {
  const env = docketSummary([
    { id: 'p_r1', open: [task('t1', { due: '2026-11-05' }), task('t6', { via: 'g_lead' })], waiting: [task('t2', { nudgeOn: '2026-11-02' }), task('t3', { nudgeOn: '2026-11-10' })] },
    { id: 'p_peer', open: [task('t5')], waiting: [] }
  ]);
  const s = M.docketSection('p_r1', TODAY, env);
  assert.deepEqual(s.open.map(t => [t.id, t.via]), [['t1', ''], ['t6', 'g_lead']]);
  assert.equal(s.open[0].due, '2026-11-05');
  assert.deepEqual(s.waiting.map(t => t.id), ['t2', 't3']);
  assert.deepEqual(s.nudges.map(t => t.id), ['t2']);
  assert.deepEqual(M.docketSection('p_nobody', TODAY, env), { state: 'ok', open: [], waiting: [], nudges: [] });
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

test('pickers: anyone in People but you, reports first; an archived one only when already chosen', () => {
  assert.deepEqual(M.directoryChoices(DIR).map(p => p.id), ['p_r1', 'p_mgr', 'p_peer']);
  assert.deepEqual(M.directoryChoices(DIR, 'p_r2').map(p => p.id), ['p_r1', 'p_r2', 'p_mgr', 'p_peer']);
  assert.deepEqual(M.directoryChoices(null), []);
});

test('people: cleaned with defaults; an old report link becomes personId', () => {
  const p = M.cleanPerson({ id: 'p_x', name: '  Engineer A ', links: { docket: 'DevA', receipts: 'p_r1' }, cadenceDays: 500 });
  assert.deepEqual(p, { id: 'p_x', personId: 'p_r1', name: 'Engineer A', cadenceDays: 7, archived: false });
  assert.equal(M.cleanPerson({ id: 'p_y', personId: 'p_peer', links: { receipts: 'p_r1' } }).personId, 'p_peer');
  assert.equal(M.cleanPerson({ id: 'p_z', personId: 'nope' }).personId, '');
  assert.match(M.newPersonId(NOW, () => 0.5), /^p_[a-z0-9]+$/);
  const shown = M.withDirectory({ ...p, name: 'Old name' }, DIR);
  assert.deepEqual([shown.name, shown.relation, shown.handle, shown.linked], ['Dev One', 'report', 'dev', true]);
  assert.equal(M.withDirectory({ ...p, personId: '' }, DIR).linked, false);
});

function fullPacket() {
  return M.buildPacket({
    person: PERSON, today: TODAY, now: NOW, notes: notes(['2026-10-27']),
    lastText: '## Follow-ups\n\n- [ ] Send the design doc\n- [x] Book the demo\n',
    src: {
      docketSummary: docketSummary([{ id: 'p_r1', open: [task('t1')], waiting: [] }]),
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

test('quick-add lines for Docket carry the person\'s @handle', () => {
  assert.deepEqual(M.quickAddLines(['Send  the doc', ''], 'dev'), ['Follow up: Send the doc @dev']);
  assert.deepEqual(M.quickAddLines(['Send the doc'], 'Bad Handle'), ['Follow up: Send the doc']);
  assert.deepEqual(M.quickAddLines(['Send the doc'], ''), ['Follow up: Send the doc']);
});

test('wins become receipts about the linked report, with stable ids', () => {
  const a = M.winEntries({ person: PERSON, day: TODAY, wins: ['Shipped the import fix'], nowIso: '2026-11-03T20:00:00.000Z' });
  assert.equal(a.length, 1);
  assert.deepEqual({ about: a[0].about, kind: a[0].kind, date: a[0].date, text: a[0].text, evidence: a[0].evidence }, { about: 'p_r1', kind: 'win', date: TODAY, text: 'Shipped the import fix', evidence: 'From a 1:1' });
  assert.match(a[0].id, /^o-p-abc1-2026-11-03-[a-z0-9]+$/);
  const b = M.winEntries({ person: PERSON, day: TODAY, wins: ['Shipped  the import fix'], nowIso: 'later' });
  assert.equal(a[0].id, b[0].id, 'the same win reuses its id');
  assert.deepEqual(M.winEntries({ person: { ...PERSON, personId: '' }, day: TODAY, wins: ['x'], nowIso: '' }), []);
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

test('the packet: receipts are about a report by id and about your manager as up; others have none', () => {
  const env = receiptsEntries([entry('r1'), entry('u1', { about: 'up' })]);
  const pk = person => M.buildPacket({ person, today: TODAY, now: NOW, notes: [], lastText: null, src: { docketSummary: null, receiptsEntries: env } });
  assert.deepEqual(pk(PERSON).receipts.groups.win.map(e => e.id), ['r1']);
  assert.deepEqual(pk({ ...PERSON, personId: 'p_mgr', relation: 'manager' }).receipts.groups.win.map(e => e.id), ['u1']);
  assert.equal(pk({ ...PERSON, personId: 'p_peer', relation: 'peer' }).receipts.state, 'unlinked');
});

test('slateSection: what Slate delegated to the person, from its summary', () => {
  const env = { schema: 'slate.summary', version: 1, items: [{ id: 'delegated', kind: 'people', rows: [{ id: 'p_one', open: [{ id: 'w1', title: '#7 Export orders' }], waiting: [] }] }] };
  assert.deepEqual(M.slateSection('p_one', env), { state: 'ok', items: [{ id: 'w1', title: '#7 Export orders' }] });
  assert.deepEqual(M.slateSection('p_two', env), { state: 'ok', items: [] });
  assert.equal(M.slateSection('p_one', null).state, 'missing');
  assert.equal(M.slateSection('p_one', { ...env, version: 2 }).state, 'unreadable');
  assert.equal(M.slateSection('', env).state, 'unlinked');
  const md = M.packetMarkdown({ today: '2026-11-06', since: '2026-10-30', docket: { state: 'missing' }, slate: { state: 'ok', items: [{ id: 'w1', title: '#7 Export orders' }] }, receipts: { state: 'missing' }, last: { state: 'missing' } });
  assert.match(md, /## Delegated in Slate\n\n### With them now\n\n- #7 Export orders/);
});

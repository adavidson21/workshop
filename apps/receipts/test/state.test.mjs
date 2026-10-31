// npm test  (Node 22, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/state.js';

const NOW = new Date(2026, 9, 31); // Oct 31 2026
const e = (o) => R.cleanEntry({ id: o.id || R.newId('r'), about: 'me', kind: 'win', text: 'x', date: '2026-10-01', ...o });

test('periods: quarter, last quarter, cycle first when set', () => {
  const ps = R.periods({ cycleStart: '2026-04-01', cycleEnd: '2026-09-30' }, NOW);
  assert.equal(ps[0].key, 'cycle');
  const q = ps.find(p => p.key === 'quarter');
  assert.deepEqual([q.from, q.to], ['2026-10-01', '2026-12-31']);
  const lq = ps.find(p => p.key === 'last-quarter');
  assert.deepEqual([lq.from, lq.to], ['2026-07-01', '2026-09-30']);
  const jan = R.periods({}, new Date(2026, 0, 15)).find(p => p.key === 'last-quarter');
  assert.deepEqual([jan.from, jan.to], ['2025-10-01', '2025-12-31']);
  assert.equal(R.periods({}, NOW)[0].key, 'quarter');
});

test('cleanEntry drops junk and fixes types', () => {
  const c = R.cleanEntry({ id: 'a', kind: 'nope', impact: '7', sections: ['Goals', 5, ''], date: 'bad', star: 1, extra: 'x' });
  assert.equal(c.kind, 'note');
  assert.equal(c.impact, 0);
  assert.deepEqual(c.sections, ['Goals', '5']);
  assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.star, true);
  assert.equal('extra' in c, false);
});

test('filterEntries: about, period, section, star, search; newest first', () => {
  const list = [
    e({ id: '1', date: '2026-10-02', sections: ['Goals'], text: 'Shipped billing' }),
    e({ id: '2', date: '2026-10-20', star: true, text: 'Led incident review' }),
    e({ id: '3', date: '2026-06-01', text: 'Old one' }),
    e({ id: '4', about: 'p_a', date: '2026-10-05', text: 'Report win' }),
  ];
  const q = R.findPeriod({}, 'quarter', NOW);
  assert.deepEqual(R.filterEntries(list, { about: 'me', period: q }).map(x => x.id), ['2', '1']);
  assert.deepEqual(R.filterEntries(list, { about: 'me', section: 'Goals' }).map(x => x.id), ['1']);
  assert.deepEqual(R.filterEntries(list, { about: 'me', star: true }).map(x => x.id), ['2']);
  assert.deepEqual(R.filterEntries(list, { q: 'BILLING' }).map(x => x.id), ['1']);
});

test('buildReview: one home section per receipt, coverage counts every tag, gaps', () => {
  const list = [
    e({ id: 'a', sections: ['Teamwork', 'Goals'], impact: 1 }),
    e({ id: 'b', sections: ['Goals'], star: true }),
    e({ id: 'c', sections: [] }),
  ];
  const r = R.buildReview(list, { about: 'me', period: R.findPeriod({}, 'all'), sections: ['Goals', 'Teamwork', 'Initiative'] });
  assert.equal(r.total, 3);
  // A receipt's first tag is its home: 'a' shows under Teamwork only.
  assert.deepEqual(r.groups.find(g => g.section === 'Goals').items.map(x => x.id), ['b']);
  assert.deepEqual(r.groups.find(g => g.section === 'Teamwork').items.map(x => x.id), ['a']);
  assert.deepEqual(r.groups.find(g => g.section === 'Other').items.map(x => x.id), ['c']);
  assert.deepEqual(r.coverage.map(c => c.count), [2, 1, 0]);
  assert.deepEqual(r.gaps, ['Initiative']);
  const text = R.reviewText(r, { title: 'Self review', period: R.findPeriod({}, 'all'), withDates: false });
  assert.match(text, /^Self review\nAll time\n\nGoals\n- x\n\nTeamwork\n- x\n\nOther\n- x\n\nNo receipts yet for: Initiative\n$/);
});

test('bullet adds the metric once', () => {
  assert.equal(R.bullet(e({ text: 'Cut deploy time', metric: '-35%' })), 'Cut deploy time (-35%)');
  assert.equal(R.bullet(e({ text: 'Cut deploy time -35%', metric: '-35%' })), 'Cut deploy time -35%');
});

test('rosterRows: counts, staleness, archived hidden', () => {
  const ppl = [R.cleanPerson({ id: 'p_a', name: 'Person A' }), R.cleanPerson({ id: 'p_b', name: 'Person B' }), R.cleanPerson({ id: 'p_c', name: 'Person C', archived: true })];
  const list = [e({ about: 'p_a', date: '2026-10-25', kind: 'feedback' }), e({ about: 'p_b', date: '2026-08-01' })];
  const rows = R.rosterRows(ppl, list, R.findPeriod({}, 'quarter', NOW), { staleDays: 30 }, NOW);
  assert.deepEqual(rows.map(r => r.person.id), ['p_a', 'p_b']);
  assert.equal(rows[0].feedback, 1);
  assert.equal(rows[0].stale, false);
  assert.equal(rows[0].daysSince, 6);
  assert.equal(rows[1].total, 0);
  assert.equal(rows[1].stale, true);
});

test('toCsv: BOM, CRLF, quoting', () => {
  const csv = R.toCsv([e({ text: 'Said "hi", then left\nlater', star: true })], () => 'Me');
  assert.ok(csv.startsWith('﻿Date,Quarter,About'));
  assert.ok(csv.includes('"Said ""hi"", then left\nlater"'));
  assert.ok(csv.endsWith('TRUE\r\n'));
});

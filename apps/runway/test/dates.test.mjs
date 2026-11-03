// Scale math: weeks, sprints from an anchor, months, quarters, sizes and the year boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, firstPeriod, isDate, periodEnd, periodLabel, periodStart, periods, sizeEnd, sprintNumber, sprintOf, weekday } from '../js/dates.js';

const sprint = { anchor: '2027-01-06', weeks: 2 };   // a Wednesday

test('dates are checked as real calendar days', () => {
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2027-02-29'));
  assert.ok(!isDate('2027-13-01'));
  assert.ok(!isDate('27-01-01'));
});

test('weeks start on Monday', () => {
  assert.equal(weekday('2027-01-04'), 0);
  assert.equal(periodStart('week', '2027-01-10', sprint), '2027-01-04');
  assert.equal(periodEnd('week', '2027-01-04', sprint), '2027-01-10');
});

test('sprints count from any anchor, before it too', () => {
  assert.equal(periodStart('sprint', '2027-01-19', sprint), '2027-01-06');
  assert.equal(periodStart('sprint', '2027-01-20', sprint), '2027-01-20');
  assert.equal(periodStart('sprint', '2026-12-30', sprint), '2026-12-23');
  assert.equal(periodEnd('sprint', '2027-01-06', sprint), '2027-01-19');
});

test('S1 is the first sprint starting on or after the start date', () => {
  assert.equal(firstPeriod('sprint', '2027-01-04', sprint), '2027-01-06');
  assert.equal(firstPeriod('sprint', '2027-01-06', sprint), '2027-01-06');
  assert.equal(sprintNumber('2027-01-25', '2027-01-04', sprint), 2);
  assert.equal(sprintNumber('2026-12-24', '2027-01-04', sprint), 0);
});

test('months and quarters, across the year boundary', () => {
  assert.equal(periodStart('month', '2027-02-14', sprint), '2027-02-01');
  assert.equal(periodEnd('month', '2028-02-01', sprint), '2028-02-29');
  assert.equal(periodStart('quarter', '2027-05-14', sprint), '2027-04-01');
  assert.equal(periodEnd('quarter', '2026-10-01', sprint), '2026-12-31');
  assert.deepEqual(periods('month', '2026-11-15', '2027-02-02', sprint).map(p => p.start), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
  assert.deepEqual(periods('quarter', '2026-11-15', '2027-04-02', sprint).map(p => periodLabel('quarter', p.start)), ['Q4', 'Q1', 'Q2']);
});

test('sizes become inclusive end dates', () => {
  assert.equal(sizeEnd('2027-01-06', { n: 3, unit: 'sprint' }, sprint), '2027-02-16');
  assert.equal(sizeEnd('2027-01-01', { n: 2, unit: 'month' }, sprint), '2027-02-28');
  assert.equal(sizeEnd('2026-12-01', { n: 1, unit: 'quarter' }, sprint), '2027-02-28');
  assert.equal(sizeEnd('2027-01-04', { n: 1, unit: 'week' }, sprint), '2027-01-10');
  assert.equal(sizeEnd('2027-01-04', { n: 10, unit: 'day' }, sprint), '2027-01-13');
});

test('a map with no sprint setup counts two-week sprints from its start', () => {
  assert.deepEqual(sprintOf({ origin: '2027-03-01' }), { anchor: '2027-03-01', weeks: 2 });
  assert.deepEqual(sprintOf({ origin: '2027-03-01', sprint: { anchor: '2027-01-06', weeks: 3 } }), { anchor: '2027-01-06', weeks: 3 });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

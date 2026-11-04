// Runway's team reports (moved from Docket): computing every report from one synthetic `dataset` pull, the
// Workshop team fill, and the Excel workbook. Every name, id and date is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildWorkbook, compute, lines, sprintName, teamLines, usable } from '../js/ado/reports/model.js';
import { RENDER } from '../js/ado/reports/view.js';

const NOW = new Date('2026-11-04T15:00:00');
const it = (id, extra = {}) => ({ id, title: `Item ${id}`, url: `https://ado.example.test/_workitems/edit/${id}`, type: 'User Story', state: 'Active', priority: 3,
  area: 'Web\\Team A', iteration: 'Web\\Sprint 2', assignedTo: 'Dev One', assignedEmail: 'dev.one@example.test', created: '2026-10-01', createdBy: 'PM',
  effort: null, effortField: '', ...extra });
const DATA = () => ({
  schema: 1, days: 28, since: '2026-10-07', base: 'https://ado.example.test/Main', connection: 'main', generatedAt: '2026-11-04T14:00:00.000Z',
  areas: ['Web\\Team A'], people: ['dev.one@example.test', 'Dev Two'], truncated: false, scanned: 6,
  config: { highPriorities: [1, 2], escalationPriority: 1, bugTypes: ['Bug'], closedStates: ['Closed', 'Done'], removedStates: ['Removed'] },
  iterations: { 'Web\\Sprint 1': { start: '2026-10-12', finish: '2026-10-23' }, 'Web\\Sprint 2': { start: '2026-10-26', finish: '2026-11-06' } },
  items: [
    it(1, { priority: 1, created: '2026-09-20', effort: 8, effortField: 'RemainingWork' }),
    it(2, { area: 'Other\\Team Z', priority: 2 }),
    it(3, { assignedTo: 'Dev Two', assignedEmail: '', iteration: 'Web\\Sprint 1' }),
    it(4, { state: 'Closed' }),
    it(5, { type: 'Bug', created: '2026-10-28', priority: 2, assignedTo: '', assignedEmail: '' }),
    it(6, { assignedTo: '<b>Dev</b> Three', assignedEmail: 'x@example.test', title: '<img src=x onerror=alert(1)>' })
  ],
  events: [
    { id: 1, kind: 'priority', date: '2026-10-20T10:00:00Z', by: 'Exec A', from: 3, to: 1 },
    { id: 2, kind: 'priority', date: '2026-10-29T10:00:00Z', by: 'Exec A', from: 3, to: 2 },
    { id: 3, kind: 'iteration', date: '2026-10-27T10:00:00Z', by: 'PM', from: 'Web\\Sprint 1', to: 'Web\\Sprint 2' },
    { id: 3, kind: 'iteration', date: '2026-10-28T10:00:00Z', by: 'PM', from: 'Web\\Sprint 2', to: 'Web\\Sprint 1' },
    { id: 2, kind: 'assigned', date: '2026-10-15T10:00:00Z', by: 'PM', from: null, to: { name: 'Dev One', email: 'dev.one@example.test' } },
    { id: 4, kind: 'state', date: '2026-10-30T10:00:00Z', by: 'Dev One', from: 'Active', to: 'Closed' },
    { id: 5, kind: 'created', date: '2026-10-28T10:00:00Z', by: 'QA', priority: 2, iteration: 'Web\\Sprint 2', to: null }
  ]
});

test('usable and lines', () => {
  assert.equal(usable(DATA()), true);
  assert.equal(usable({ schema: 2 }), false);
  assert.deepEqual(lines(' A\\B \n\nC; D '), ['A\\B', 'C', 'D']);
  assert.equal(sprintName('Web\\Sprint 2'), 'Sprint 2');
});

test('priority churn and escalations', () => {
  const c = compute(DATA(), NOW);
  assert.equal(c.churn.list.length, 2);
  assert.equal(c.churn.raised, 2);
  assert.deepEqual(c.churn.escs.map(e => e.id), [1]);
  assert.equal(c.churn.escs[0].waited, 30, 'created Sep 20, escalated Oct 20');
  assert.deepEqual(c.churn.byWho, [['Exec A', 2]]);
  assert.equal(c.churn.perWeek.reduce((a, b) => a + b, 0), 2);
  assert.equal(c.weekLabels.length, 4);
});

test("other teams' work: assigned to your people outside your areas", () => {
  const o = compute(DATA(), NOW).other;
  assert.equal(o.can, true);
  assert.deepEqual(o.list.map(i => i.id), [2]);
  assert.equal(o.list[0].since, '2026-10-15');
  assert.deepEqual(o.byArea, [['Other\\Team Z', 1]]);
});

test('carryover, scope and load', () => {
  const c = compute(DATA(), NOW);
  assert.deepEqual(c.carry.list.map(i => [i.id, i.moves]), [[3, 2]]);
  assert.equal(c.carry.multi, 1);
  assert.deepEqual(c.carry.stuck.map(i => i.id), [3], 'open in Sprint 1, which has finished');
  assert.ok(c.scope.changes.some(ch => ch.id === 5 && ch.change === 'Created mid-sprint'));
  assert.ok(c.scope.changes.some(ch => ch.id === 3 && ch.change === 'Added mid-sprint'));
  const dev1 = c.load.rows.find(r => r.name === 'Dev One');
  assert.deepEqual([dev1.total, dev1.p[0], dev1.p[1], dev1.hours], [2, 1, 1, 8]);
  assert.ok(c.load.rows.find(r => r.name === 'Unassigned'));
  assert.equal(c.load.rows[c.load.rows.length - 1].name, 'Unassigned', 'Unassigned goes last');
});

test('aging, throughput and bugs', () => {
  const c = compute(DATA(), NOW);
  assert.deepEqual(c.aging.hp.map(i => i.id), [1, 2, 5]);
  assert.equal(c.aging.hours, 8);
  assert.equal(c.aging.noHours, 2);
  assert.equal(c.aging.closed.reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(c.bugs.map(b => b.id), [5]);
});

test('every tab renders, and ADO text is escaped', () => {
  const d = DATA(), c = compute(d, NOW);
  for (const [k, fn] of Object.entries(RENDER)) {
    const html = fn(c, d);
    assert.ok(html.length > 50, k);
    assert.ok(!html.includes('<img src=x') && !html.includes('<b>Dev</b>'), `${k} escapes ADO text`);
  }
  const bad = DATA(); bad.items[0].url = 'javascript:alert(1)';
  assert.ok(!RENDER.aging(compute(bad, NOW), bad).includes('href="javascript'), 'only http(s) links');
});

test('teamLines: active team members from Workshop People', () => {
  const env = { schema: 'settings.people', version: 1, items: [
    { id: 'a', name: 'Me', relation: 'self' },
    { id: 'b', name: 'Dev One', relation: 'report', adoIdentity: 'dev.one@example.test' },
    { id: 'c', name: 'Gone', relation: 'report', archived: true },
    { id: 'd', name: 'Boss', relation: 'manager' },
    { id: 'e', name: 'Peer', relation: 'peer', team: true }
  ] };
  assert.deepEqual(teamLines(env), ['Me', 'dev.one@example.test', 'Peer']);
  assert.deepEqual(teamLines({ schema: 'settings.people', version: 2, items: [] }), []);
  assert.deepEqual(teamLines(null), []);
});

test('the Excel workbook has every tab, with Summary formulas', () => {
  const XLSX = createRequire(import.meta.url)('../shared/vendor/xlsx.full.min.js');
  const wb = buildWorkbook(XLSX, DATA(), NOW);
  assert.deepEqual(wb.SheetNames, ['How To Use', 'Summary', 'Capacity', 'Priority Changes', 'Escalations', 'Out-of-Scope Work', 'Sprint Carryover',
    'Sprint Scope', 'Scope Changes', 'Assignment Changes', 'Load by Person', 'Priority Inventory', 'Throughput', 'Bugs Created', 'Risk Flags']);
  const sum = wb.Sheets.Summary;
  assert.equal(sum.B3.f, "COUNTA('Priority Changes'!A2:A5000)");
  assert.equal(sum.B3.v, 2);
  assert.equal(wb.Sheets.Capacity.A5.v, 'dev.one@example.test');
});

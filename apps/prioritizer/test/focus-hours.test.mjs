import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingCard, buildSummary, dayFocus } from '../js/summary.js';
import { cleanDayplan, freshDayplan } from '../js/dayplan-model.js';
import { heldLabel, heldNeeds } from '../js/focus-hours-model.js';
import { MANAGER_NAME, lunchOn, makerManagerSections, makerManagerTemplate, overlapsLunch } from '../js/maker-manager.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import * as F from '../../../shared/focus.js';

const TODAY = '2026-11-04';
const plan = sections => cleanDayplan(Object.assign(freshDayplan(), {
  sprint: {anchor: '2026-10-28', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], dayStart: '09:00', dayEnd: '17:00'},
  days: {[TODAY]: {id: TODAY, template: null, shift: 0, sections, slots: []}}
}));

test('day.focus and day.lunch from sections: kind in any case, missing fields and lost sections skipped', () => {
  const dp = plan([
    {id: 'a', name: 'Deep', kind: ' Focus ', around: '09:00', minutes: 120},
    {id: 'b', name: 'More', kind: 'focus', around: '14:00'},
    {id: 'c', name: 'Gone', kind: 'FOCUS', around: '16:00', minutes: 30, lost: true},
    {id: 'd', name: 'Eat', kind: 'Lunch', around: '12:00', minutes: 45},
    {id: 'e', name: 'Eat again', kind: 'lunch', around: '12:30', minutes: 30},
    {id: 'f', name: 'Meet', kind: 'meetings', around: '13:00', minutes: 60}
  ]);
  assert.deepEqual(dayFocus(dp, TODAY), {focus: [{start: '09:00', end: '11:00'}], lunch: {start: '12:00', end: '12:45'}});
  const day = buildSummary({board: {lists: [], tasks: []}, dp, log: null, today: TODAY})[1].days[TODAY];
  assert.deepEqual(day.focus, [{start: '09:00', end: '11:00'}]);
  assert.deepEqual(day.lunch, {start: '12:00', end: '12:45'});
  // A focus section that is lost: focus off that day (an empty array). No focus section: no focus field.
  assert.deepEqual(dayFocus(plan([{id: 'c', name: 'Gone', kind: 'focus', around: '16:00', minutes: 30, lost: true}]), TODAY), {focus: []});
  assert.deepEqual(dayFocus(plan([{id: 'f', name: 'Meet', kind: 'meetings', around: '13:00', minutes: 60}]), TODAY), {});
  // No Day plan: both omitted.
  const none = buildSummary({board: {lists: [], tasks: []}, dp: freshDayplan(), log: null, today: TODAY})[1].days[TODAY];
  assert.equal('focus' in none, false); assert.equal('lunch' in none, false);
  // What shared/focus.js reads from it.
  assert.deepEqual(F.dayplanOf(day), {focus: [{start: '09:00', end: '11:00'}], lunch: {start: '12:00', end: '12:45'}});
});

test('the blocking card lists PRs blocked on you, and the held card goes into the summary; cards match the schema', () => {
  const board = {lists: [{id: 'l1', name: 'PRs'}], tasks: [
    {id: 'p1', listId: 'l1', title: 'PR 7', rank: 2, pr: {id: 7, tier: 'blocking'}},
    {id: 'p2', listId: 'l1', title: 'PR 8', rank: 1, pr: {id: 8, tier: 'blocking', waiting: true}},
    {id: 'p3', listId: 'l1', title: 'PR 9', rank: 3, pr: {id: 9, tier: 'asked'}},
    {id: 'p4', listId: 'l1', title: 'PR 10', rank: 4, done: true, pr: {id: 10, tier: 'blocking'}}
  ]};
  assert.deepEqual(blockingCard(board).rows.map(r => [r.id, r.route, r.flag]), [['p1', 'task/p1', 'urgent']]);
  const held = {id: 'held', kind: 'held', block: `${TODAY}T09:00`, count: 3, label: '3 new ADO items', route: 'today'};
  const cards = buildSummary({board, dp: freshDayplan(), log: null, today: TODAY, held});
  assert.ok(cards.find(c => c.id === 'held'));
  const S = SchemaSet.fromDir(new URL('../../../docs/schemas/', import.meta.url).pathname);
  for (const c of cards) assert.deepEqual(S.validate('summary-card', Object.assign({updatedAt: 1}, c)), [], c.id);
  assert.equal(buildSummary({board, dp: freshDayplan(), log: null, today: TODAY}).some(c => c.id === 'held'), false);
});

test('Needs you during focus and lunch; the held label', () => {
  const n = {ado: 2, prs: [{id: 'p1'}], nudges: [{id: 'x'}], plan: 1};
  assert.deepEqual(heldNeeds(n, 'off'), {n, held: 0});
  assert.deepEqual(heldNeeds(n, 'focus'), {n: {ado: 0, prs: [{id: 'p1'}], nudges: [], plan: 0}, held: 4});
  assert.deepEqual(heldNeeds(n, 'lunch'), {n: {ado: 0, prs: [], nudges: [], plan: 0}, held: 5});
  assert.deepEqual(heldNeeds(n, 'dayDone'), {n: {ado: 0, prs: [], nudges: [], plan: 0}, held: 5}, "Day's done folds like lunch");
  assert.equal(heldLabel(5, {ado: 3, pickup: 2}), '3 new ADO items, 2 captures picked up');
  assert.equal(heldLabel(1, {pr: 1}), '1 PR to review');
  assert.equal(heldLabel(2, {}), '2 held in Docket');
});

test('Maker/Manager template from Settings times and from defaults; settings adds one to assign', () => {
  const d = makerManagerSections(null);
  assert.deepEqual(d.map(s => [s.name, s.kind, s.around, s.minutes]), [['Maker morning', 'focus', '09:00', 180], ['Lunch', 'lunch', '12:00', 60], [MANAGER_NAME, 'meetings', '13:00', 120], ['Reviews and admin', 'admin', '15:00', 120]]);
  const meta = F.defaults();
  meta.week.mon = [{start: '08:30', end: '11:30'}];
  meta.lunch.start = '11:45'; meta.lunch.minutes = 45;
  const s = makerManagerSections(meta);
  assert.deepEqual(s.map(x => [x.around, x.minutes]), [['08:30', 180], ['11:45', 45], ['12:30', 120], ['14:30', 120]]);
  const sp = {enabled: true, anchor: '2026-10-28', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5]};
  const first = makerManagerTemplate(sp, null, {assign: true});
  assert.equal(first.days.length, 10); assert.equal(first.last, true);
  const added = makerManagerTemplate(sp, null, {assign: false});
  assert.deepEqual([added.days, added.last, added.weekdays], [[], false, []]);
  const noSprint = makerManagerTemplate(Object.assign({}, sp, {enabled: false}), null, {assign: true});
  assert.deepEqual(noSprint.weekdays, [1, 2, 3, 4, 5]);
});

test('Overlaps lunch: another kind over the day lunch or Settings lunch warns; lunch itself does not', () => {
  const secs = [{id: 'l', kind: 'lunch', around: '12:00', minutes: 60}, {id: 'm', kind: 'meetings', around: '11:30', minutes: 60}, {id: 'k', kind: 'focus', around: '13:00', minutes: 60}];
  const lunch = lunchOn(secs, null, 3);
  assert.equal(overlapsLunch(secs[1], lunch), true);
  assert.equal(overlapsLunch(secs[0], lunch), false);
  assert.equal(overlapsLunch(secs[2], lunch), false);
  const fromSettings = lunchOn([secs[1]], F.defaults(), 3);
  assert.deepEqual([fromSettings.start, fromSettings.end], [720, 780]);
  assert.equal(lunchOn([secs[1]], Object.assign(F.defaults(), {enabled: false}), 3), null, 'focus hours off: no lunch');
  assert.equal(lunchOn([secs[1]], F.defaults(), 0), null, 'Sunday: no lunch');
});

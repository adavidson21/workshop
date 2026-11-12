// PR review groups (Blocking, Pending) planned into Day plan blocks by kind (dayplan-model.js planByKind,
// state.js cleanSlots and prGroup). PRs that don't need you are dropped by Workshop's ADO connector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/dayplan-model.js';

const clone = v => JSON.parse(JSON.stringify(v));
const sec = (id, kind, around = null, minutes = null) => ({id, name: id, kind, color: 'sage', around, minutes, capacity: null});
// Wednesday 2026-11-04 starts a two-week sprint; Monday 2026-11-09 is day 4.
const TEMPLATES = [{id: 'td', name: 'Day', days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], sections: [
  sec('rv1', 'reviews', '09:00', 30), sec('am', 'focus', '09:30', 120), sec('ad', 'admin', '13:00', 60), sec('rv2', 'reviews', '16:00', 30)]}];
const board = () => M.cleanDayplan(clone({sprint: {anchor: '2026-11-04', lengthWeeks: 2}, templates: TEMPLATES, days: {}}));
const at = (h, m = 0) => h * 60 + m;
const slotted = (dp, date, id) => { const r = dp.days[date]; const s = r && r.slots.find(x => x.taskId === id); return s ? s.sectionId : null; };

test('first block of the kind that has not ended, today', () => {
  const dp = board();
  assert.equal(M.planByKind(dp, 'a', 'reviews', '2026-11-09', at(8)).section.id, 'rv1');
  assert.equal(M.planByKind(dp, 'b', 'reviews', '2026-11-09', at(10)).section.id, 'rv2', 'the 9:00 block has ended');
  assert.equal(M.planByKind(dp, 'c', 'admin', '2026-11-09', at(10)).section.id, 'ad');
  assert.equal(slotted(dp, '2026-11-09', 'b'), 'rv2');
});

test('after the last block of the kind: the next work day, skipping the weekend', () => {
  const dp = board();
  const r = M.planByKind(dp, 'a', 'reviews', '2026-11-06', at(17));   // Friday, 5 PM
  assert.deepEqual([r.date, r.section.id], ['2026-11-09', 'rv1']);
});

test('no block of the kind, no kind, or no sprint start: not planned', () => {
  const dp = board();
  assert.equal(M.planByKind(dp, 'a', 'meetings', '2026-11-09', at(8)), null);
  assert.equal(M.planByKind(dp, 'a', '', '2026-11-09', at(8)), null);
  const none = M.cleanDayplan({sprint: {lengthWeeks: 2}, templates: TEMPLATES, days: {}});
  assert.equal(M.planByKind(none, 'a', 'reviews', '2026-11-09', at(8)), null);
});

test('a task planned by hand stays; a group change moves it from the old kind', () => {
  const dp = board();
  M.slotTask(dp, '2026-11-09', 'hand', 'am');
  assert.equal(M.planByKind(dp, 'hand', 'reviews', '2026-11-09', at(8), {from: 'admin'}), null);
  assert.equal(slotted(dp, '2026-11-09', 'hand'), 'am');
  M.planByKind(dp, 'p', 'admin', '2026-11-09', at(8));
  assert.equal(slotted(dp, '2026-11-09', 'p'), 'ad');
  assert.equal(M.planByKind(dp, 'p', 'reviews', '2026-11-09', at(8), {from: 'admin'}).section.id, 'rv1');
  assert.equal(slotted(dp, '2026-11-09', 'p'), 'rv1');
  assert.equal(M.planByKind(dp, 'p', 'reviews', '2026-11-09', at(8)), null, 'already planned');
});

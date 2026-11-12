process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formValue, historyText, metaToSave, previewText } from '../js/focus-model.js';
import * as F from '../../../shared/focus.js';

const now = new Date(2026, 10, 9, 8, 0);

test('defaults on first open; the saved hours after', () => {
  const first = formValue(null);
  assert.equal(first.saved, false);
  assert.deepEqual(first.value.week.mon, [{ start: '09:00', end: '12:00' }]);
  assert.deepEqual(first.value.week.sat, []);
  assert.deepEqual(first.value.lunch, { enabled: true, start: '12:00', minutes: 60, days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
  const env = { schema: 'settings.focus', version: 1, rev: 1, items: [], meta: Object.assign(F.defaults(), { enabled: false }) };
  const v = formValue(env);
  assert.equal(v.saved, true); assert.equal(v.value.enabled, false);
});

test('preview of today, from Settings or from the Day plan', () => {
  assert.equal(previewText(F.defaults(), null, now), 'Today: focus 09:00 to 12:00, lunch 12:00 to 13:00');
  assert.equal(previewText(F.defaults(), F.dayplanOf({ focus: [{ start: '13:00', end: '15:00' }], lunch: { start: '12:00', end: '12:45' } }), now), 'Today: focus 13:00 to 15:00, lunch 12:00 to 12:45 (from Day plan)');
  assert.equal(previewText(Object.assign(F.defaults(), { enabled: false }), null, now), 'Focus hours are off. Nothing is held.');
  assert.equal(previewText(F.defaults(), null, new Date(2026, 10, 8, 9)), 'Today: no focus, no lunch');
});

test('grid validation and the lunch warning come from shared/focus.js', () => {
  const m = F.defaults();
  m.week.tue = [{ start: '11:30', end: '12:30' }];
  const v = F.validateSettings(m);
  assert.equal(v.errors.length, 0);
  assert.deepEqual(v.warnings.map(w => w.day), ['tue']);
  m.lunch.minutes = 2;
  assert.equal(F.validateSettings(m).errors[0].day, 'lunch');
});

test('History table text, and what Save writes', () => {
  const rows = historyText([{ date: '2026-11-09', planned: 180, kept: 150, lunch: 'late', released: 7 }, { date: '2026-11-06', planned: 0, kept: 0, lunch: 'missed', released: 0 }]);
  assert.equal(rows[0].focus, '2h 30m of 3h');
  assert.equal(rows[0].lunch, 'Late');
  assert.equal(rows[0].released, '7');
  assert.equal(rows[1].focus, '');
  assert.equal(rows[1].lunch, 'Missed');
  assert.equal(rows[0].evening, '');
  assert.equal(historyText([{ date: '2026-11-10', planned: 0, kept: 0, lunch: '', released: 3, late: true }])[0].evening, 'Worked late');
  assert.equal(metaToSave(Object.assign(F.defaults(), { afterEnd: false })).afterEnd, false, 'After my day ends can be turned off');
  assert.equal(formValue(null).value.afterEnd, true, 'on by default');
  const meta = metaToSave(Object.assign(F.defaults(), { enabled: true }), 5);
  assert.equal(meta.updatedAt, 5); assert.equal(meta.enabled, true);
});

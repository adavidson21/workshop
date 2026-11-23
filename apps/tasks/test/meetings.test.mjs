// Meetings into a day (meetings-model.js): quick lines, .ics files, and placing them in time order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/dayplan-model.js';
import { addMeetings, parseIcs, parseQuick, parseQuickLine } from '../js/meetings-model.js';

test('quick lines: time, name, length', () => {
  assert.deepEqual(parseQuickLine('10:00 1:1 Brandon 30m'), {name: '1:1 Brandon', around: '10:00', minutes: 30});
  assert.deepEqual(parseQuickLine('9:30am Standup 15 min'), {name: 'Standup', around: '09:30', minutes: 15});
  assert.deepEqual(parseQuickLine('2pm-3:30pm Sprint review'), {name: 'Sprint review', around: '14:00', minutes: 90});
  assert.deepEqual(parseQuickLine('2-3pm Planning'), {name: 'Planning', around: '14:00', minutes: 60});
  assert.deepEqual(parseQuickLine('11 Design sync 1h'), {name: 'Design sync', around: '11:00', minutes: 60});
  assert.deepEqual(parseQuickLine('- 1:30 Interview'), {name: 'Interview', around: '13:30', minutes: 30});
  assert.equal(parseQuickLine('no time here'), null);
  assert.equal(parseQuickLine(''), null);
  assert.equal(parseQuick('9 A\n\nnope\n10 B 45m').length, 2);
});

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Standup
DTSTART:20261102T093000
DTEND:20261102T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
EXDATE:20261113T093000
END:VEVENT
BEGIN:VEVENT
SUMMARY:1:1 with Brandon\\, weekly
DTSTART:20261112T140000
DURATION:PT30M
END:VEVENT
BEGIN:VEVENT
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261112
END:VEVENT
BEGIN:VEVENT
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART:20261112T110000
END:VEVENT
BEGIN:VEVENT
SUMMARY:Every other week
DTSTART:20261105T160000
DTEND:20261105T170000
RRULE:FREQ=WEEKLY;INTERVAL=2
END:VEVENT
END:VCALENDAR`;

test('.ics: timed events on the day, repeats, skips all-day, cancelled and excluded dates', () => {
  assert.deepEqual(parseIcs(ICS, '2026-11-12'), [
    {name: 'Standup', around: '09:30', minutes: 15},
    {name: '1:1 with Brandon, weekly', around: '14:00', minutes: 30}
  ]);
  assert.deepEqual(parseIcs(ICS, '2026-11-13').map(m => m.name), []);
  assert.deepEqual(parseIcs(ICS, '2026-11-19').map(m => m.name), ['Standup', 'Every other week']);
  assert.deepEqual(parseIcs(ICS, '2026-11-14'), []);
});

test('.ics: UTC times become local', () => {
  const t = parseIcs('BEGIN:VEVENT\nSUMMARY:X\nDTSTART:20261112T150000Z\nDTEND:20261112T153000Z\nEND:VEVENT', '2026-11-12');
  const d = new Date(Date.UTC(2026, 10, 12, 15, 0));
  assert.equal(t[0].around, `${String(d.getHours()).padStart(2, '0')}:00`);
  assert.equal(t[0].minutes, 30);
});

test('meetings go in time order as meetings blocks, and twice adds nothing', () => {
  const sec = (id, around) => ({id, name: id, kind: 'focus', color: 'sage', around, minutes: 60});
  const dp = M.cleanDayplan({sprint: {anchor: '2026-11-04', lengthWeeks: 2}, templates: [{id: 't', name: 'T', days: [7], sections: [sec('am', '09:00'), sec('pm', '15:00')]}], days: {}});
  const list = parseQuick('10:00 Sync 30m\n16:00 Late 30m');
  assert.equal(addMeetings(dp, '2026-11-12', list), 2);
  const rec = dp.days['2026-11-12'];
  assert.deepEqual(rec.sections.map(s => s.name), ['am', 'Sync', 'pm', 'Late']);
  assert.equal(rec.sections[1].kind, 'meetings');
  assert.equal(addMeetings(dp, '2026-11-12', list), 0);
});

// Day plan (WS12): sprint day math, templates, every change the Day view makes, undo and redo, and saving the
// day plan through the same write loop as the board (two windows merging). Runs in Node; the Day view in a
// browser is covered by test/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { data as sdk } from '../shared/workshop-sdk.js';
import { SchemaSet } from './workshop/schema.mjs';
import * as M from '../js/dayplan-model.js';
import { dayplanFormat, dpEnvelopeFromBoard, dpEnvelopesFromBundle } from '../js/dayplan-format.js';
import { createStore } from '../js/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const schemas = SchemaSet.fromDir(path.join(HERE, 'workshop', 'schemas'));
const clone = v => JSON.parse(JSON.stringify(v));
const settle = () => new Promise(r => setTimeout(r, 15));
const POINTS = {XS: 1, S: 2, M: 3, L: 5, XL: 8};

// Wednesday 2026-11-04 starts a two-week sprint.
const SPRINT = {anchor: '2026-11-04', lengthWeeks: 2};
const sec = (id, name, kind, around = null, minutes = null, capacity = null) => ({id, name, kind, color: 'sage', around, minutes, capacity});
const TEMPLATES = [
  {id: 'tp', name: 'Planning', days: [1], sections: [sec('plan', 'Plan', 'meetings', '09:30', 120), sec('f1', 'Focus', 'focus', '12:00', 120, 5)]},
  {id: 'td', name: 'Sprint day', days: [2, 3, 4, 5, 6, 7, 8, 9], sections: [sec('am', 'Deep focus', 'focus', '09:00', 120, 5), sec('mt', 'Meetings', 'meetings', '13:00', 120), sec('ad', 'Admin', 'admin', '15:00', 60, 2)]},
  {id: 'tl', name: 'Last day', days: [], last: true, sections: [sec('rv', 'Review', 'review', '09:00', 120)]}
];
const board = (extra = {}) => M.cleanDayplan(clone({sprint: SPRINT, templates: TEMPLATES, days: {}, ...extra}));
const tasks = list => new Map(list.map((t, i) => [t.id, {rank: i + 1, done: false, effort: 'S', ...t}]));

/* ---------- sprint math ---------- */
test('sprint days: anchor on a Wednesday, two weeks, weekends off', () => {
  const sp = M.cleanSprint(SPRINT);
  const d1 = M.sprintInfo(sp, '2026-11-04');
  assert.equal(d1.day, 1); assert.equal(d1.total, 10); assert.equal(d1.start, '2026-11-04'); assert.equal(d1.end, '2026-11-17');
  assert.equal(M.sprintInfo(sp, '2026-11-06').day, 3);            // Friday
  assert.equal(M.sprintInfo(sp, '2026-11-07').off, true);         // Saturday
  assert.equal(M.sprintInfo(sp, '2026-11-07').day, null);
  assert.equal(M.sprintInfo(sp, '2026-11-09').day, 4);            // Monday
  const last = M.sprintInfo(sp, '2026-11-17');
  assert.equal(last.day, 10); assert.equal(last.last, true);
  assert.equal(M.sprintInfo(sp, '2026-11-18').day, 1);            // the next sprint
  assert.equal(M.sprintInfo(sp, '2026-11-18').index, 1);
});

test('a holiday takes no number and shortens the sprint; Last day still matches the final working day', () => {
  const dp = board({sprint: {...SPRINT, holidays: ['2026-11-11']}});
  assert.equal(M.sprintInfo(dp.sprint, '2026-11-11').off, true);
  assert.equal(M.sprintInfo(dp.sprint, '2026-11-11').holiday, true);
  assert.equal(M.sprintInfo(dp.sprint, '2026-11-12').day, 6);
  const last = M.sprintInfo(dp.sprint, '2026-11-17');
  assert.equal(last.total, 9); assert.equal(last.day, 9); assert.equal(last.last, true);
  // Day 9 is in "Sprint day" too, but Last day wins there and that is not a conflict.
  const r = M.templateFor(dp, '2026-11-17');
  assert.equal(r.template.id, 'tl'); assert.deepEqual(r.conflict, []);
  assert.equal(M.templateFor(dp, '2026-11-16').template.id, 'td');
});

test('dates before the anchor count backwards', () => {
  const sp = M.cleanSprint(SPRINT);
  const a = M.sprintInfo(sp, '2026-11-03');  // Tuesday before: last day of the previous sprint
  assert.equal(a.index, -1); assert.equal(a.start, '2026-10-21'); assert.equal(a.day, 10); assert.equal(a.last, true);
  assert.equal(M.sprintInfo(sp, '2026-10-21').day, 1);
  assert.equal(M.sprintInfo(sp, '2025-06-04').day, 1);         // far back, still on the two-week grid
});

test('sprint ids and day numbers across a year boundary', () => {
  const sp = M.cleanSprint(SPRINT);
  const dec = M.sprintInfo(sp, '2026-12-30');
  assert.equal(dec.start, '2026-12-30'); assert.equal(dec.day, 1);
  assert.equal(M.sprintInfo(sp, '2027-01-04').day, 4);          // Wed, Thu, Fri, then Monday
  assert.equal(M.sprintInfo(sp, '2027-01-04').id, dec.id);      // same sprint, id from the year it started
  assert.match(dec.id, /^2026-\d+$/);
  assert.equal(M.sprintInfo(sp, '2027-01-13').id, '2027-1');    // the first sprint starting in 2027
  assert.equal(M.sprintInfo(sp, '2027-01-27').id, '2027-2');
  assert.equal(M.sprintInfo({...sp, anchor: null}, '2027-01-27'), null);
});

/* ---------- templates ---------- */
test('template resolution: one match, overlap error, no match', () => {
  const dp = board();
  assert.equal(M.templateFor(dp, '2026-11-04').template.id, 'tp');
  assert.equal(M.templateFor(dp, '2026-11-05').template.id, 'td');
  assert.deepEqual(M.templateErrors(dp.templates, dp.sprint), []);
  const overlap = [...dp.templates, M.cleanTemplate({id: 'x', name: 'Extra', days: [3, 4], sections: []})];
  const errs = M.templateErrors(overlap, dp.sprint);
  assert.equal(errs.length, 2); assert.match(errs[0], /Day 3 is in "Sprint day" and "Extra"/);
  assert.equal(M.templateFor({...dp, templates: overlap}, '2026-11-06').conflict.length, 2);
  assert.match(M.templateErrors([...dp.templates, M.cleanTemplate({id: 'y', name: 'Also last', last: true})], dp.sprint)[0], /both for the last day/);
  const none = board({templates: [TEMPLATES[0]]});
  const v = M.dayView(none, '2026-11-05');
  assert.equal(v.template, null); assert.deepEqual(v.rec.sections, []);
  assert.deepEqual(M.parseDays('2-4, 7'), [2, 3, 4, 7]); assert.equal(M.parseDays('x'), null); assert.equal(M.formatDays([2, 3, 4, 7]), '2-4, 7');
});

test('a date with no record renders from its template; the first edit writes it; Reset removes the edits', () => {
  const dp = board(), d = '2026-11-05', byId = tasks([{id: 'a'}]);
  const v = M.dayView(dp, d);
  assert.equal(v.saved, false); assert.deepEqual(v.rec.sections.map(s => s.id), ['am', 'mt', 'ad']);
  assert.equal(dp.days[d], undefined);
  M.slotTask(dp, d, 'a', 'mt');
  assert.equal(M.dayView(dp, d).saved, true);
  assert.deepEqual(dp.days[d].slots, [{taskId: 'a', sectionId: 'mt', order: null}]);
  M.updateSection(dp, d, 'mt', {name: 'Standup <and> sync'});
  assert.equal(dp.templates[1].sections[1].name, 'Meetings', 'the template is never changed from a day');
  assert.equal(M.resetDay(dp, d), true);
  assert.equal(M.dayView(dp, d).saved, false);
  assert.equal(M.sectionTasks(M.dayView(dp, d).rec, 'mt', byId).length, 0);
});

/* ---------- slotting and order ---------- */
test('slots keep rank order by default; manual order within a block is kept; deleted tasks drop out; done tasks stay', () => {
  const dp = board(), d = '2026-11-05';
  const byId = tasks([{id: 'a'}, {id: 'b'}, {id: 'c'}]);
  M.slotTask(dp, d, 'c', 'am'); M.slotTask(dp, d, 'a', 'am'); M.slotTask(dp, d, 'b', 'am');
  const ids = () => M.sectionTasks(dp.days[d], 'am', byId).map(x => x.task.id);
  assert.deepEqual(ids(), ['a', 'b', 'c']);
  M.moveInSection(dp, d, 'c', -1, byId);
  assert.deepEqual(ids(), ['a', 'c', 'b']);
  M.slotTask(dp, d, 'b', 'am', 0, byId);
  assert.deepEqual(ids(), ['b', 'a', 'c']);
  byId.get('a').done = true;
  assert.deepEqual(ids(), ['b', 'a', 'c']);
  byId.delete('c');
  assert.deepEqual(ids(), ['b', 'a']);
  M.slotTask(dp, d, 'b', 'mt');
  assert.equal(dp.days[d].slots.filter(s => s.taskId === 'b').length, 1, 'a task is in one block at a time');
  M.unslotTask(dp, d, 'b');
  assert.equal(M.slotOf(dp.days[d], 'b'), undefined);
});

test('capacity warning when a block holds more points than its capacity', () => {
  const dp = board(), d = '2026-11-05';
  const byId = tasks([{id: 'a', effort: 'M'}, {id: 'b', effort: 'S'}]);
  M.slotTask(dp, d, 'a', 'ad');
  const s = M.sectionOf(dp.days[d], 'ad');
  assert.equal(M.sectionLoad(dp.days[d], 'ad', byId, POINTS), 3);
  assert.equal(M.overCapacity(s, 3), true);
  M.unslotTask(dp, d, 'a'); M.slotTask(dp, d, 'b', 'ad');
  assert.equal(M.overCapacity(s, M.sectionLoad(dp.days[d], 'ad', byId, POINTS)), false);
  assert.equal(M.overCapacity(M.sectionOf(dp.days[d], 'mt'), 99), false, 'no capacity, no warning');
});

/* ---------- rearranging ---------- */
test('lost this block: to the next open block today, or back to the tray when none is left', () => {
  const dp = board(), d = '2026-11-05';
  const byId = tasks([{id: 'a'}, {id: 'b'}, {id: 'c', done: true}]);
  ['a', 'b', 'c'].forEach(id => M.slotTask(dp, d, id, 'am'));
  const r = M.loseSection(dp, d, 'am', 'next', byId);
  assert.equal(r.section.id, 'mt'); assert.equal(r.count, 2);
  assert.equal(M.sectionOf(dp.days[d], 'am').lost, true);
  assert.deepEqual(M.sectionTasks(dp.days[d], 'mt', byId).map(x => x.task.id), ['a', 'b']);
  assert.deepEqual(M.sectionTasks(dp.days[d], 'am', byId).map(x => x.task.id), ['c'], 'done tasks stay where they were');
  M.loseSection(dp, d, 'ad', 'next', byId);
  const r2 = M.loseSection(dp, d, 'mt', 'next', byId);
  assert.equal(r2.section, null); assert.equal(r2.count, 2);
  assert.equal(M.slotOf(dp.days[d], 'a'), undefined, 'no open block left today: back to the tray');
  M.restoreSection(dp, d, 'mt');
  assert.equal(M.sectionOf(dp.days[d], 'mt').lost, undefined);
});

test('lost this block: to the next working day\'s first block of the same kind, skipping the weekend', () => {
  const dp = board(), d = '2026-11-06';  // Friday, day 3
  const byId = tasks([{id: 'a'}]);
  M.slotTask(dp, d, 'a', 'mt');
  const r = M.loseSection(dp, d, 'mt', 'tomorrow', byId);
  assert.equal(r.date, '2026-11-09');
  assert.equal(r.section.id, 'mt');
  assert.equal(M.slotOf(dp.days['2026-11-09'], 'a').sectionId, 'mt');
  assert.equal(M.slotOf(dp.days[d], 'a'), undefined);
  // No block of that kind tomorrow: its first open block.
  const dp2 = board(); M.slotTask(dp2, '2026-11-04', 'a', 'plan');
  const r2 = M.loseSection(dp2, '2026-11-04', 'plan', 'tomorrow', byId);
  assert.equal(r2.section.id, 'mt', 'meetings exists on day 2');
  const dp3 = board(); M.slotTask(dp3, '2026-11-16', 'a', 'ad');
  const r3 = M.loseSection(dp3, '2026-11-16', 'ad', 'tomorrow', byId);
  assert.equal(r3.date, '2026-11-17'); assert.equal(r3.section.id, 'rv', 'last day has no admin: its first block');
});

test('shift the rest of the day; add, rename, recolor, reorder and remove blocks for one day', () => {
  const dp = board(), d = '2026-11-05';
  assert.equal(M.shiftDay(dp, d, 30, 'mt'), 2);
  assert.deepEqual(dp.days[d].sections.map(s => s.around), ['09:00', '13:30', '15:30']);
  M.shiftDay(dp, d, -15);
  assert.deepEqual(dp.days[d].sections.map(s => s.around), ['08:45', '13:15', '15:15']);
  assert.equal(dp.days[d].shift, 15);
  assert.equal(M.restFrom(dp.days[d], 14 * 60), 'mt', 'the rest of the day starts at the block not over yet');
  const s = M.addSection(dp, d, {name: 'Lunch walk', kind: 'break', color: 'sky'});
  M.updateSection(dp, d, s.id, {name: 'Walk', color: 'peach'});
  assert.equal(M.sectionOf(dp.days[d], s.id).color, 'peach');
  M.moveSection(dp, d, s.id, -1);
  assert.deepEqual(dp.days[d].sections.map(x => x.id).slice(-2), [s.id, 'ad']);
  M.placeSection(dp, d, s.id, 0);
  assert.equal(dp.days[d].sections[0].id, s.id);
  M.slotTask(dp, d, 'a', s.id);
  M.removeSection(dp, d, s.id);
  assert.equal(M.slotOf(dp.days[d], 'a'), undefined, 'removing a block sends its tasks to the tray');
  assert.equal(M.fromMin(-30), '23:30');
});

test('undo and redo across mixed actions', () => {
  const dp = board(), d = '2026-11-05', t = '2026-11-06', byId = tasks([{id: 'a'}, {id: 'b'}]);
  const h = M.createHistory();
  h.run(dp, [d], () => M.slotTask(dp, d, 'a', 'am'));
  h.run(dp, [d], () => M.shiftDay(dp, d, 30));
  h.run(dp, [d, t], () => M.loseSection(dp, d, 'am', 'tomorrow', byId));
  h.run(dp, [d], () => M.slotTask(dp, d, 'b', 'mt'));
  assert.equal(M.slotOf(dp.days[t], 'a').sectionId, 'am');
  h.undo(dp); assert.equal(M.slotOf(dp.days[d], 'b'), undefined);
  h.undo(dp); assert.equal(dp.days[t], undefined, 'undo removes the record the action created');
  assert.equal(M.slotOf(dp.days[d], 'a').sectionId, 'am');
  h.undo(dp); assert.equal(dp.days[d].sections[0].around, '09:00');
  h.undo(dp); assert.equal(dp.days[d], undefined);
  assert.equal(h.canUndo, false);
  h.redo(dp); h.redo(dp); h.redo(dp);
  assert.equal(dp.days[d].sections[0].lost, true); assert.equal(M.slotOf(dp.days[t], 'a').sectionId, 'am');
  h.run(dp, [d], () => M.dismissCarry(dp, d));
  assert.equal(h.canRedo, false, 'a new action clears redo');
  for (let i = 0; i < 25; i++) h.run(dp, [d], () => M.shiftDay(dp, d, 5));
  let n = 0; while (h.undo(dp)) n++;
  assert.ok(n >= 20, 'at least 20 steps');
  h.run(dp, [d], () => M.slotTask(dp, d, 'zz', 'nope'));
  assert.equal(h.canUndo, false, 'a change that changed nothing is not recorded');
});

/* ---------- carry over ---------- */
test('carry over skips weekends and holidays, and moves into the same blocks or the tray', () => {
  const dp = board({sprint: {...SPRINT, holidays: ['2026-11-09']}});
  const byId = tasks([{id: 'a'}, {id: 'b'}, {id: 'c', done: true}]);
  M.slotTask(dp, '2026-11-06', 'a', 'mt'); M.slotTask(dp, '2026-11-06', 'b', 'ad'); M.slotTask(dp, '2026-11-06', 'c', 'am');
  // Monday the 9th is a holiday, so Tuesday the 10th looks back to Friday the 6th.
  const c = M.carryCandidates(dp, '2026-11-10', byId);
  assert.equal(c.prev, '2026-11-06');
  assert.deepEqual(c.items.map(x => x.taskId), ['a', 'b']);
  assert.equal(M.carryPending(dp, '2026-11-10', byId), true);
  assert.equal(M.carryOver(dp, '2026-11-10', 'sections', byId), 2);
  assert.equal(M.slotOf(dp.days['2026-11-10'], 'a').sectionId, 'mt');
  assert.equal(M.slotOf(dp.days['2026-11-10'], 'b').sectionId, 'ad');
  assert.equal(M.carryPending(dp, '2026-11-10', byId), false);
  const dp2 = board(); M.slotTask(dp2, '2026-11-06', 'a', 'mt');
  M.carryOver(dp2, '2026-11-09', 'tray', byId);
  assert.deepEqual(dp2.days['2026-11-09'].carry.tray, ['a']);
  assert.equal(M.slotOf(dp2.days['2026-11-09'], 'a'), undefined);
});

test('current and next block by rough time', () => {
  const rec = M.dayView(board(), '2026-11-05').rec;
  assert.equal(M.currentSection(rec, 9 * 60 + 30).current.id, 'am');
  assert.equal(M.currentSection(rec, 9 * 60 + 30).next.id, 'mt');
  assert.equal(M.currentSection(rec, 12 * 60).current, null);
  assert.equal(M.currentSection(rec, 12 * 60).next.id, 'mt');
  assert.equal(M.currentSection(rec, 18 * 60).next, null);
});

/* ---------- storage ---------- */
function backend(){
  const files = {}, subs = [];
  return {
    files,
    client(id){
      return {
        async get(col){ return files[col] ? clone(files[col]) : null; },
        async put(col, env){
          await null;
          assert.equal(env.schema, `prioritizer.${col}`);
          assert.deepEqual(schemas.validate('data-envelope', env), [], `put ${col} is a valid envelope`);
          const stored = files[col], rev = stored ? stored.rev : 0;
          if ((env.rev || 0) !== rev) throw Object.assign(new Error('conflict'), {code: 'conflict', current: clone(stored)});
          const next = clone(env); next.rev = rev + 1; next.updatedAt = new Date().toISOString();
          files[col] = next;
          for (const s of subs) if (s.id !== id && s.col === col) setTimeout(() => s.fn({}), 1);
          return {rev: next.rev, updatedAt: next.updatedAt};
        },
        subscribe(col, fn){ const s = {id, col, fn}; subs.push(s); return () => subs.splice(subs.indexOf(s), 1); },
        merge: sdk.merge, stamp: sdk.stamp
      };
    }
  };
}
async function win(be, id){
  const w = {dp: M.freshDayplan()};
  w.store = createStore({data: be.client(id), board: () => w.dp, applied: () => M.cleanDayplan(w.dp), timers: globalThis,
    format: dayplanFormat(['dayplan/settings', 'dayplan/templates', 'dayplan/recurring', 'dayplan/days/2026'])});
  await w.store.load(); w.store.start();
  return w;
}

test('the day plan saves as dayplan collections; tasks are not touched', async () => {
  const be = backend(), a = await win(be, 'a');
  a.dp.sprint = M.cleanSprint(SPRINT); a.dp.templates = board().templates;
  M.slotTask(a.dp, '2026-11-05', 'a', 'am');
  await a.store.flushAll();
  assert.deepEqual(Object.keys(be.files).sort(), ['dayplan/days/2026', 'dayplan/settings', 'dayplan/templates']);
  assert.equal(be.files['dayplan/settings'].meta.sprint.anchor, '2026-11-04');
  assert.equal(be.files['dayplan/templates'].items.length, 3);
  assert.deepEqual(be.files['dayplan/days/2026'].items.map(i => i.id), ['2026-11-05']);
  assert.equal(be.files['dayplan/days/2026'].version, 1);
  const b = await win(be, 'b');
  assert.equal(b.dp.days['2026-11-05'].slots[0].taskId, 'a');
  await b.store.addCollection('dayplan/days/2027');
  M.slotTask(b.dp, '2027-01-05', 'x', 'am');
  await b.store.flushAll();
  assert.deepEqual(be.files['dayplan/days/2027'].items.map(i => i.id), ['2027-01-05']);
});

test('two windows editing the same day merge per day, later edit wins; different days both stay', async () => {
  const be = backend(), a = await win(be, 'a');
  a.dp.sprint = M.cleanSprint(SPRINT); a.dp.templates = board().templates;
  await a.store.flushAll();
  const b = await win(be, 'b');
  M.slotTask(a.dp, '2026-11-05', 'a', 'am');
  M.slotTask(b.dp, '2026-11-06', 'b', 'mt');
  a.store.schedule(); b.store.schedule();
  await a.store.flushAll(); await b.store.flushAll();
  await settle(); await a.store.idle(); await b.store.idle(); await settle();
  for (const w of [a, b]) assert.deepEqual(Object.keys(w.dp.days).sort(), ['2026-11-05', '2026-11-06']);
  // Same day in both: the later edit of that day wins.
  M.slotTask(a.dp, '2026-11-05', 'c', 'mt');
  await a.store.flushAll();
  await new Promise(r => setTimeout(r, 5));
  M.slotTask(b.dp, '2026-11-05', 'd', 'ad');
  await b.store.flushAll();
  await settle(); await a.store.idle(); await b.store.idle(); await settle();
  const ids = w => w.dp.days['2026-11-05'].slots.map(s => s.taskId).sort();
  assert.deepEqual(ids(a), ids(b));
  assert.ok(ids(b).includes('d'));
  // Reset (deleting a record) travels as a tombstone.
  M.resetDay(a.dp, '2026-11-06');
  await a.store.flushAll();
  await settle(); await b.store.idle(); await settle();
  assert.equal(b.dp.days['2026-11-06'], undefined);
});

test('unknown fields are kept and day plan collections come back from a backup', () => {
  const dp = board();
  dp.days['2026-11-05'] = M.cleanRecord({id: '2026-11-05', sections: [{id: 's', name: 'X', future: 1}], slots: [], extra: 'keep'});
  assert.equal(dp.days['2026-11-05'].extra, 'keep');
  assert.equal(dp.days['2026-11-05'].sections[0].future, 1);
  const env = dpEnvelopeFromBoard('dayplan/days/2026', dp, null);
  const bundle = {schema: 'workshop.bundle', version: 1, collections: [{app: 'prioritizer', collection: 'dayplan/days/2026', envelope: env}, {app: 'other', collection: 'x', envelope: {}}]};
  assert.deepEqual(Object.keys(dpEnvelopesFromBundle(bundle)), ['dayplan/days/2026']);
  assert.throws(() => dpEnvelopesFromBundle({collections: [{app: 'prioritizer', collection: 'dayplan/templates', envelope: {schema: 'prioritizer.dayplan/templates', version: 9, items: []}}]}), /newer Workshop/);
});

test('saved day plan items match the JSON Schemas in schemas/', () => {
  const ds = SchemaSet.fromDir(path.join(HERE, '..', 'schemas'));
  const no0 = (name, v) => assert.deepEqual(ds.validate(name, v), [], name);
  no0('dayplan-settings.schema.json', M.cleanSprint({enabled: false}));
  no0('dayplan-template.schema.json', M.cleanTemplate({name: 'Weekdays', weekdays: [1, 2, 3]}));
  const dp = board({sprint: {...SPRINT, holidays: ['2026-11-11']}}), byId = tasks([{id: 'a'}, {id: 'b'}]);
  M.slotTask(dp, '2026-11-05', 'a', 'am'); M.loseSection(dp, '2026-11-05', 'am', 'next', byId); M.shiftDay(dp, '2026-11-05', 15);
  M.carryOver(dp, '2026-11-06', 'tray', byId); M.moveInSection(dp, '2026-11-05', 'a', 1, byId);
  const no = (name, v) => assert.deepEqual(ds.validate(name, v), [], name);
  no('dayplan-settings.schema.json', dpEnvelopeFromBoard('dayplan/settings', dp, null).meta.sprint);
  for (const t of dpEnvelopeFromBoard('dayplan/templates', dp, null).items) no('dayplan-template.schema.json', t);
  for (const d of dpEnvelopeFromBoard('dayplan/days/2026', dp, null).items) no('dayplan-day.schema.json', d);
  dp.recurring = [M.cleanRecurring({title: 'Refinement', dueDay: 4, made: ['2026-11-04']}), M.cleanRecurring({title: 'Check logs', repeat: 'weekly', weekday: 1, at: '09:15', made: ['2026-11-09']})];
  for (const r of dpEnvelopeFromBoard('dayplan/recurring', dp, null).items) no('dayplan-recurring.schema.json', r);
});

/* ---------- sprints off ---------- */
test('sprints off: on by default; off, templates match weekdays and keep their sprint days', () => {
  assert.equal(M.cleanSprint({}).enabled, true, 'on by default');
  assert.equal(M.cleanSprint({enabled: 'no'}).enabled, true);
  assert.equal(M.sprintsOn(M.cleanSprint({enabled: false})), false);
  assert.equal(M.dayReady(M.cleanSprint({})), false, 'sprints on with no start date: not ready');
  assert.equal(M.dayReady(M.cleanSprint({enabled: false})), true, 'sprints off: ready without a start date');
  const wk = [
    {id: 'mt', name: 'Mon to Thu', days: [2, 3], weekdays: [1, 2, 3, 4], sections: [sec('f', 'Focus', 'focus', '09:00', 120)]},
    {id: 'fr', name: 'Friday', days: [], last: true, weekdays: [5], sections: [sec('w', 'Wrap', 'review', '15:00', 60)]}
  ];
  const dp = M.cleanDayplan(clone({sprint: {enabled: false, holidays: ['2026-11-11']}, templates: wk, days: {}}));
  assert.equal(M.templateFor(dp, '2026-11-05').template.id, 'mt', 'Thursday');
  assert.equal(M.templateFor(dp, '2026-11-06').template.id, 'fr', 'Friday');
  assert.equal(M.templateFor(dp, '2026-11-07').template, null, 'Saturday is off');
  const hol = M.dayInfo(dp.sprint, '2026-11-11');
  assert.equal(hol.off, true); assert.equal(hol.holiday, true); assert.equal(hol.id, null);
  assert.deepEqual(M.dayView(dp, '2026-11-05').rec.sections.map(s => s.id), ['f']);
  assert.deepEqual(M.templateErrors(dp.templates, dp.sprint), []);
  assert.match(M.templateErrors([...dp.templates, {name: 'Again', days: [], weekdays: [5]}].map(M.cleanTemplate), dp.sprint)[0], /Friday is in "Friday" and "Again"/);
  // Turning sprints back on uses the sprint days the templates kept.
  dp.sprint = M.cleanSprint({...dp.sprint, enabled: true, anchor: '2026-11-04'});
  assert.equal(M.templateFor(dp, '2026-11-05').template.id, 'mt', 'sprint day 2');
  assert.equal(M.templateFor(dp, '2026-11-17').template.id, 'fr', 'last day');
});

test('sprints off: every-sprint items make nothing and are kept; daily and weekly ones still repeat', () => {
  const dp = board({recurring: [{id: 'ref', title: 'Backlog refinement', dueDay: 4}, {id: 'log', title: 'Check logs', repeat: 'workdays'}]});
  assert.deepEqual(M.recurDue(dp, '2026-11-04').map(d => d.item.id), ['ref', 'log']);
  dp.sprint = M.cleanSprint({...dp.sprint, enabled: false});
  assert.deepEqual(M.recurDue(dp, '2026-11-04').map(d => d.item.id), ['log']);
  assert.equal(dp.recurring.length, 2, 'kept');
  dp.sprint = M.cleanSprint({...dp.sprint, enabled: true});
  assert.deepEqual(M.recurDue(dp, '2026-11-04').map(d => d.item.id), ['ref', 'log'], 'back on: they resume');
});

/* ---------- every-sprint tasks ---------- */
test('every-sprint tasks: made on day 1, due on their sprint day, once per sprint, never after the due day', () => {
  const dp = board({recurring: [{id: 'ref', title: 'Backlog refinement', dueDay: 4}, {id: 'rel', title: 'Release', last: true, value: 3, effort: 'M'}, {id: 'p', title: 'Paused', paused: true}]});
  assert.equal(dp.recurring[0].value, 2, 'Low value by default'); assert.equal(dp.recurring[0].effort, 'S');
  assert.deepEqual(M.recurDue(dp, '2026-11-03').map(d => d.id), ['r_rel_2026-10-21'], 'the 3rd is the previous sprint\'s last day: only its release is still ahead');
  const due = M.recurDue(dp, '2026-11-04');
  assert.deepEqual(due.map(d => [d.id, d.due]), [['r_ref_2026-11-04', '2026-11-09'], ['r_rel_2026-11-04', '2026-11-17']], 'day 4 is Monday of week 2');
  due.forEach(d => d.item.made.push(d.start));
  assert.deepEqual(M.recurDue(dp, '2026-11-05'), [], 'once per sprint');
  // Opened late, after refinement was due: only the release is still ahead.
  const late = board({recurring: dp.recurring.map(r => ({...r, made: []}))});
  assert.deepEqual(M.recurDue(late, '2026-11-10').map(d => d.item.id), ['rel']);
  // The next sprint makes fresh ones with new ids.
  assert.deepEqual(M.recurDue(dp, '2026-11-18').map(d => d.id), ['r_ref_2026-11-18', 'r_rel_2026-11-18']);
  // Weekend day 1: nothing until the first working day. A holiday pushes the due date along.
  const hol = board({sprint: {...SPRINT, holidays: ['2026-11-05']}, recurring: [{id: 'ref', title: 'R', dueDay: 4}]});
  assert.equal(M.recurDue(hol, '2026-11-04')[0].due, '2026-11-10');
  assert.equal(M.sprintDayDate(hol.sprint, '2026-11-04', 40), '2026-11-17', 'past the end: the last working day');
  assert.equal(M.cleanRecurring({title: '  '}), null);
});

/* ---------- daily and weekly repeats ---------- */
test('daily, workday and weekly repeats: one task a matching day, due that day, no sprint needed', () => {
  const dp = board({sprint: {...SPRINT, holidays: ['2026-11-11']}, recurring: [
    {id: 'logs', title: 'Check logs', repeat: 'workdays', at: '09:15'}, {id: 'any', title: 'Journal', repeat: 'daily'},
    {id: 'wk', title: 'Weekly notes', repeat: 'weekly', weekday: 5}, {id: 'old', title: 'Refinement', dueDay: 4, made: ['2026-11-04']}]});
  assert.equal(dp.recurring[3].repeat, 'sprint', 'items saved before repeat existed are every-sprint');
  assert.deepEqual(M.recurDue(dp, '2026-11-06').map(d => [d.id, d.due, d.day]),
    [['r_logs_2026-11-06', '2026-11-06', '2026-11-06'], ['r_any_2026-11-06', '2026-11-06', '2026-11-06'], ['r_wk_2026-11-06', '2026-11-06', '2026-11-06']], 'Friday: all three');
  assert.deepEqual(M.recurDue(dp, '2026-11-07').map(d => d.item.id), ['any'], 'Saturday: only every day');
  assert.deepEqual(M.recurDue(dp, '2026-11-11').map(d => d.item.id), ['any'], 'a holiday is not a workday');
  const mon = M.recurDue(dp, '2026-11-09'); mon.forEach(d => d.item.made.push(d.start));
  assert.deepEqual(M.recurDue(dp, '2026-11-09'), [], 'once a day');
  const noSprint = board({sprint: {}, recurring: [{id: 'logs', title: 'Check logs', repeat: 'workdays'}, {id: 'old', title: 'R', dueDay: 1}]});
  assert.deepEqual(M.recurDue(noSprint, '2026-11-10').map(d => d.item.id), ['logs'], 'without a sprint, only the daily one');
  assert.equal(M.cleanRecurring({title: 'x', repeat: 'hourly', at: '9am'}).repeat, 'sprint');
  assert.equal('at' in M.cleanRecurring({title: 'x', at: '9am'}), false, 'at is saved as HH:MM only');
  assert.equal(M.repeatLabel(dp.recurring[0]), 'Every workday at 9:15 AM');
  assert.equal(M.repeatLabel(dp.recurring[2]), 'Fridays');
  assert.equal(M.repeatLabel(dp.recurring[3]), 'Every sprint, day 4');
});

test('a repeating task with a time goes into the block on at that time', () => {
  const dp = board({recurring: [{id: 'logs', title: 'Check logs', repeat: 'workdays', at: '13:30'}, {id: 'early', title: 'E', repeat: 'daily', at: '07:00'}, {id: 'late', title: 'L', repeat: 'daily', at: '20:00'}]});
  assert.equal(M.autoPlan(dp, dp.recurring[0], 'r_logs_2026-11-05', '2026-11-05').id, 'mt', '1:30 PM is in Meetings');
  assert.equal(M.autoPlan(dp, dp.recurring[1], 'r_early_2026-11-05', '2026-11-05').id, 'am', 'before the first block: the next one');
  assert.equal(M.autoPlan(dp, dp.recurring[2], 'r_late_2026-11-05', '2026-11-05'), null, 'after the last block: not planned');
});

test('times: typed on a 12-hour clock, saved as HH:MM, shown with AM or PM', () => {
  const cases = {'9:30 am': '09:30', '9:30a': '09:30', '9pm': '21:00', '930': '09:30', '21:15': '21:15', '09:00': '09:00',
    '1:30': '13:30', '12': '12:00', '12am': '00:00', '12:15 PM': '12:15', '7': '07:00', '13:61': null, '13pm': null, 'soon': null, '': null};
  for (const [v, want] of Object.entries(cases)) assert.equal(M.parseTime(v), want, v);
  assert.equal(M.fmt12('09:05'), '9:05 AM'); assert.equal(M.fmt12('00:30'), '12:30 AM'); assert.equal(M.fmt12('12:00'), '12:00 PM');
  assert.equal(M.fmt12('17:45'), '5:45 PM'); assert.equal(M.fmt12(null), '');
});

test('automatic Day planning: an every-sprint task goes into its kind of block on its due day, once', () => {
  const dp = board({recurring: [{id: 'ref', title: 'Refinement', dueDay: 4, planKind: 'meetings'}, {id: 'x', title: 'Odd', dueDay: 5, planKind: 'nope'}, {id: 'n', title: 'None', dueDay: 2}]});
  const [ref, odd, none] = M.recurDue(dp, '2026-11-04');
  assert.equal(M.autoPlan(dp, ref.item, ref.id, ref.due).id, 'mt');
  assert.equal(M.slotOf(dp.days['2026-11-09'], ref.id).sectionId, 'mt');
  assert.equal(M.autoPlan(dp, ref.item, ref.id, ref.due), null, 'already planned that day');
  assert.equal(M.autoPlan(dp, odd.item, odd.id, odd.due).id, 'am', 'no block of that kind: the first open block');
  assert.equal(M.autoPlan(dp, none.item, none.id, none.due), null, 'no kind: not planned');
  assert.equal(dp.days[none.due], undefined);
  const lost = board({recurring: [{id: 'r', title: 'R', dueDay: 2, planKind: 'focus'}]});
  M.loseSection(lost, '2026-11-05', 'am', 'next', tasks([]));
  const [r] = M.recurDue(lost, '2026-11-04');
  assert.equal(M.autoPlan(lost, r.item, r.id, r.due).id, 'mt', 'a lost block is skipped');
});

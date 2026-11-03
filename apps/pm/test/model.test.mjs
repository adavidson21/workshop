// Roadmap rules: lanes, date placement and its fallbacks, progress, stale and changed, the sprint strip (a copy of
// Docket's sprint math), ceremonies as every-sprint offers, and version checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areasToFetch, axisRange, barPos, bucketOf, buildLanes, ceremonyOffer, ceremonyStatus, changedSinceSeen, cleanCeremony,
  cleanSettings, docketSprint, effortFor, isStale, iterationIndex, monthTicks, parseProducts, placeEpic, placeItem, productsText,
  progress, queueInfo, readable, releaseHealth, sprintDayDate, sprintInfo, sprintStrip, syncOffers
} from '../js/model.js';

const epic = (id, extra = {}) => ({ id, rev: 2, type: 'Epic', title: `Version ${id}`, state: 'Active', area: 'Web App\\Team A', iteration: 'Web App', parentId: null, targetDate: null, startDate: null, changed: '2026-10-14T00:00:00Z', url: `https://ado.example.com/${id}`, ...extra });
const feature = (id, parentId, extra = {}) => ({ ...epic(id), type: 'Feature', title: `Feature ${id}`, parentId, storiesTotal: 4, storiesDone: 1, ...extra });

test('products parse from "Name: area, area" lines and print back', () => {
  const p = parseProducts('Product A: Web App\\Team A, Web App\\Team B\nno colon here\nProduct B:  \nProduct C: Web App\\Team C');
  assert.deepEqual(p.map(x => [x.id, x.name, x.areas]), [['p_product-a', 'Product A', ['Web App\\Team A', 'Web App\\Team B']], ['p_product-c', 'Product C', ['Web App\\Team C']]]);
  assert.equal(productsText(p), 'Product A: Web App\\Team A, Web App\\Team B\nProduct C: Web App\\Team C');
});

test('area paths to fetch: products plus Queue\'s, once each, Queue\'s only when on', () => {
  const products = parseProducts('Product A: Web App\\Team A');
  assert.deepEqual(areasToFetch(products, ['web app\\team a', 'Web App\\Team B'], cleanSettings({})), ['Web App\\Team A', 'Web App\\Team B']);
  assert.deepEqual(areasToFetch(products, ['Web App\\Team B'], cleanSettings({ useQueueAreas: false })), ['Web App\\Team A']);
});

test('lanes: one per product, longest area path wins, Features under their Epic, the rest loose or Other', () => {
  const products = parseProducts('Product A: Web App\\Team A\nProduct B: Web App\\Team A\\Sub');
  const items = [epic(1), epic(2, { area: 'Web App\\Team A\\Sub\\Deep' }), feature(11, 1), feature(12, 99), epic(3, { area: 'Elsewhere' })];
  const lanes = buildLanes(items, { products, queueAreas: [] });
  assert.deepEqual(lanes.map(l => l.name), ['Product A', 'Product B', 'Other']);
  assert.deepEqual(lanes[0].epics.map(r => [r.epic.id, r.features.map(f => f.id)]), [[1, [11]]]);
  assert.deepEqual(lanes[0].loose.map(f => f.id), [12]);
  assert.deepEqual(lanes[1].epics.map(r => r.epic.id), [2]);
  assert.deepEqual(lanes[2].epics.map(r => r.epic.id), [3]);
  // No products: one lane per Queue area path, named by its last part.
  assert.deepEqual(buildLanes([epic(1)], { products: [], queueAreas: ['Web App\\Team A'] }).map(l => l.name), ['Team A']);
});

const ITERS = iterationIndex({ 'Web App': [{ path: 'Web App\\Sprint 12', start: '2026-10-07', finish: '2026-10-20' }, { path: 'Web App\\Backlog' }] });

test('placement: own dates first, then the sprint, then none (the board)', () => {
  assert.deepEqual(placeItem(epic(1, { startDate: '2026-10-01', targetDate: '2026-12-15' }), ITERS), { start: '2026-10-01', end: '2026-12-15', from: 'dates' });
  assert.deepEqual(placeItem(epic(1, { startDate: '2026-12-15', targetDate: '2026-10-01' }), ITERS), { start: '2026-10-01', end: '2026-12-15', from: 'dates' }, 'swapped dates still make a bar');
  // Only a target date: starts at its sprint start when that is earlier, else 14 days before.
  assert.deepEqual(placeItem(epic(1, { targetDate: '2026-10-18', iteration: 'Web App\\Sprint 12' }), ITERS), { start: '2026-10-07', end: '2026-10-18', from: 'dates' });
  assert.deepEqual(placeItem(epic(1, { targetDate: '2026-11-20' }), ITERS), { start: '2026-11-06', end: '2026-11-20', from: 'dates' });
  assert.deepEqual(placeItem(epic(1, { startDate: '2026-11-01' }), ITERS), { start: '2026-11-01', end: '2026-11-15', from: 'dates' });
  assert.deepEqual(placeItem(epic(1, { iteration: 'web app\\sprint 12' }), ITERS), { start: '2026-10-07', end: '2026-10-20', from: 'sprint' }, 'paths ignore case');
  assert.deepEqual(placeItem(epic(1, { iteration: 'Web App\\Backlog' }), ITERS), { start: null, end: null, from: null }, 'a sprint with no dates does not place');
  assert.equal(placeItem(epic(1, { targetDate: 'soon' }), ITERS).from, null);
});

test('an Epic with no dates of its own spans its placed Features', () => {
  const row = { epic: epic(1), features: [feature(11, 1, { targetDate: '2026-11-20', startDate: '2026-11-01' }), feature(12, 1, { iteration: 'Web App\\Sprint 12' }), feature(13, 1)] };
  assert.deepEqual(placeEpic(row, ITERS), { start: '2026-10-07', end: '2026-11-20', from: 'features' });
  assert.equal(placeEpic({ epic: epic(2), features: [feature(14, 2)] }, ITERS).from, null);
});

test('Now, Next, Later for items with no dates', () => {
  assert.equal(bucketOf(epic(1, { state: 'Active' })), 'now');
  assert.equal(bucketOf(epic(1, { state: 'New', iteration: 'Web App\\Sprint 13' })), 'next');
  assert.equal(bucketOf(epic(1, { state: 'New', iteration: 'Web App' })), 'later');
  assert.equal(bucketOf(epic(1, { state: 'Proposed', iteration: '' })), 'later');
});

test('the axis: whole months around the spans and today, at least 3 months; bars are clipped to it', () => {
  const r = axisRange([{ start: '2026-10-07', end: '2026-10-20' }], '2026-11-03');
  assert.deepEqual(r, { start: '2026-10-01', end: '2027-01-01', days: 92 });
  assert.deepEqual(monthTicks(r).map(t => t.label), ['Oct 2026', 'Nov', 'Dec']);
  const wide = axisRange([{ start: '2020-01-01', end: '2030-01-01' }], '2026-11-03');
  assert.deepEqual([wide.start, wide.end], ['2026-05-01', '2028-05-01'], 'at most 24 months, around today');
  const pos = barPos({ start: '2026-10-01', end: '2026-10-31', from: 'dates' }, r);
  assert.equal(pos.left, 0);
  assert.equal(pos.width, Math.round(31 / 92 * 10000) / 100);
  assert.equal(barPos({ start: '2027-02-01', end: '2027-03-01', from: 'dates' }, r), null);
  assert.equal(barPos({ start: '2026-09-01', end: '2026-10-10', from: 'dates' }, r).clipped, true);
  assert.equal(barPos({ from: null }, r), null);
});

test('progress: done over total stories, none when there are no stories; bad counts are clamped', () => {
  assert.deepEqual(progress(feature(1, null, { storiesTotal: 4, storiesDone: 1 })), { done: 1, total: 4, pct: 25 });
  assert.deepEqual(progress([feature(1, null, { storiesTotal: 2, storiesDone: 2 }), feature(2, null, { storiesTotal: 2, storiesDone: 0 })]), { done: 2, total: 4, pct: 50 });
  assert.deepEqual(progress(feature(1, null, { storiesTotal: 0, storiesDone: 0 })), { done: 0, total: 0, pct: null });
  assert.deepEqual(progress(feature(1, null, { storiesTotal: 3, storiesDone: 9 })), { done: 3, total: 3, pct: 100 });
  assert.deepEqual(progress(epic(1)), { done: 0, total: 0, pct: null });
});

test('stale after N days, changed since seen, and release health sorts changed and stale first', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(isStale(feature(1, null, { changed: '2026-10-20T12:00:00Z' }), 14, now), true);
  assert.equal(isStale(feature(1, null, { changed: '2026-10-21T12:00:01Z' }), 14, now), false);
  const items = [epic(1, { rev: 5 }), feature(11, 1, { rev: 3 }), feature(12, 1, { rev: 1 })];
  assert.deepEqual([...changedSinceSeen(items, { 1: 5, 11: 2 })], [11], 'items never seen are not changed');
  const row = { epic: items[0], features: [feature(12, 1, { title: 'A', rev: 1, changed: '2026-11-01T00:00:00Z' }), feature(13, 1, { title: 'B', changed: '2026-10-01T00:00:00Z' }), feature(11, 1, { title: 'C', rev: 3, changed: '2026-11-02T00:00:00Z' })] };
  const h = releaseHealth(row, { seen: { 1: 5, 11: 2, 12: 1, 13: 2 }, staleDays: 14, now });
  assert.deepEqual(h.features.map(f => f.id), [11, 13, 12]);
  assert.deepEqual([h.stale, h.changed, h.epicChanged], [1, 1, false]);
});

// Docket's sprint math: 2 week sprints from Monday 2026-10-26, Mon to Fri, with a holiday on Wednesday 2026-11-04.
const SP = { anchor: '2026-10-26', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], holidays: ['2026-11-04'], dayStart: '09:00', dayEnd: '17:00' };

test('sprint math matches Docket: day numbers skip weekends and holidays, Last day is the final working day', () => {
  const info = sprintInfo(SP, '2026-11-03');
  assert.deepEqual(info, { index: 0, id: '2026-22', start: '2026-10-26', end: '2026-11-08', day: 7, total: 9, off: false, last: false, holiday: false });
  assert.equal(sprintInfo(SP, '2026-11-04').off, true);
  assert.equal(sprintInfo(SP, '2026-11-04').holiday, true);
  assert.equal(sprintInfo(SP, '2026-10-31').day, null, 'Saturday is off');
  assert.equal(sprintInfo(SP, '2026-11-09').start, '2026-11-09', 'the next sprint');
  assert.equal(sprintInfo(SP, '2026-10-25').index, -1, 'dates before the anchor work');
  assert.equal(sprintDayDate(SP, '2026-10-26', 8), '2026-11-05', 'the holiday shifts later days');
  assert.equal(sprintDayDate(SP, '2026-10-26', 1, true), '2026-11-06');
  assert.equal(sprintDayDate(SP, '2026-10-26', 12), '2026-11-06', 'a day past the end is the last working day');
  assert.equal(sprintInfo({ ...SP, anchor: null }, '2026-11-03'), null);
});

test('the sprint strip puts each ceremony on its day and marks weekends, holidays and today', () => {
  const cer = [cleanCeremony({ id: 'cer_plan', name: 'Planning', dueDay: 1, minutes: 120 }), cleanCeremony({ id: 'cer_ref', name: 'Refinement', dueDay: 8 }), cleanCeremony({ id: 'cer_retro', name: 'Retro', last: true })];
  const s = sprintStrip(SP, '2026-11-03', cer);
  assert.equal(s.days.length, 14);
  assert.deepEqual(s.days.filter(d => d.off).map(d => [d.date, d.holiday]), [['2026-10-31', false], ['2026-11-01', false], ['2026-11-04', true], ['2026-11-07', false], ['2026-11-08', false]]);
  const on = Object.fromEntries(s.days.filter(d => d.ceremonies.length).map(d => [d.date, d.ceremonies.map(c => c.name)]));
  assert.deepEqual(on, { '2026-10-26': ['Planning'], '2026-11-05': ['Refinement'], '2026-11-06': ['Retro'] });
  assert.equal(s.days.find(d => d.today).date, '2026-11-03');
  assert.equal(s.days.find(d => d.today).day, 7);
  assert.equal(sprintStrip({ anchor: null }, '2026-11-03', cer), null);
  // Weekends as workdays: a 7 day week has 14 working days.
  assert.equal(sprintStrip({ ...SP, workdays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, '2026-11-03').info.total, 14);
});

test('ceremonies are cleaned and map to every-sprint offers for Docket', () => {
  assert.equal(cleanCeremony({ name: '  ' }), null);
  const c = cleanCeremony({ id: 'cer_ref', name: 'Backlog refinement', dueDay: 4, minutes: 60, planKind: 'Meetings', role: 'Facilitator', extra: 1 });
  assert.deepEqual(c, { id: 'cer_ref', name: 'Backlog refinement', dueDay: 4, last: false, minutes: 60, planKind: 'meetings', role: 'Facilitator' });
  assert.deepEqual(cleanCeremony({ name: 'X', dueDay: 99, minutes: -5 }), { id: 'cer_x', name: 'X', dueDay: 1, last: false, minutes: null, planKind: '', role: '' });
  assert.deepEqual(ceremonyOffer(c, { date: '2026-11-03', createdAt: '2026-11-03T13:40:00.000Z' }), {
    id: 'h_cer_ref', to: 'prioritizer', date: '2026-11-03', createdAt: '2026-11-03T13:40:00.000Z', text: 'Backlog refinement',
    payload: { kind: 'every-sprint', title: 'Backlog refinement', dueDay: 4, value: 2, effort: 'M', planKind: 'meetings', notes: 'Role: Facilitator. 60 minutes.' },
    source: { app: 'pm', id: 'cer_ref' }
  });
  const last = ceremonyOffer(cleanCeremony({ id: 'cer_retro', name: 'Retro', last: true, dueDay: 3 }), { date: '2026-11-03', createdAt: 'x' });
  assert.deepEqual(last.payload, { kind: 'every-sprint', title: 'Retro', last: true, value: 2, effort: 'XS' }, 'last: true instead of dueDay; no notes or kind when empty');
  assert.deepEqual([0, 15, 16, 30, 45, 60, 90, 120, 121].map(effortFor), ['XS', 'XS', 'S', 'S', 'M', 'M', 'L', 'L', 'XL']);
});

test('Send to Docket keeps unchanged offers as they were, replaces changed ones, withdraws removed ones', () => {
  const ref = cleanCeremony({ id: 'cer_ref', name: 'Refinement', dueDay: 4 });
  const retro = cleanCeremony({ id: 'cer_retro', name: 'Retro', last: true });
  const first = syncOffers([], [ref, retro], { today: '2026-11-03', createdAt: 'T1' });
  assert.deepEqual(first.map(h => h.id), ['h_cer_ref', 'h_cer_retro']);
  const stored = first.map(h => ({ ...h, updatedAt: 5 }));
  const other = { id: 'h_x', to: 'receipts', date: '2026-11-01', createdAt: 'T0', text: 'x', source: { app: 'pm' }, updatedAt: 1 };
  const again = syncOffers([...stored, other], [{ ...ref, dueDay: 5 }], { today: '2026-11-04', createdAt: 'T2' });
  assert.deepEqual(again.map(h => h.id), ['h_x', 'h_cer_ref'], 'Retro was withdrawn; other receivers are kept');
  assert.equal(again[1].payload.dueDay, 5);
  assert.equal(again[1].createdAt, 'T2');
  const same = syncOffers(stored, [ref, retro], { today: '2026-11-05', createdAt: 'T3' });
  assert.deepEqual(same, stored, 'nothing changed: the same items, so Docket does not see them again');
  const late = syncOffers(stored, [ref], { today: '2027-02-01', createdAt: 'T4' });
  assert.equal(late[0].date, '2027-02-01', 'an offer older than 60 days is made fresh');
});

test('ceremony status reads Docket\'s every-sprint items and this app\'s offers', () => {
  const ref = cleanCeremony({ id: 'cer_ref', name: 'Refinement', dueDay: 4 });
  const offers = syncOffers([], [ref], { today: '2026-11-03', createdAt: 'T' });
  assert.equal(ceremonyStatus(ref, [], []), 'new');
  assert.equal(ceremonyStatus(ref, offers, []), 'offered');
  assert.equal(ceremonyStatus({ ...ref, dueDay: 6 }, offers, []), 'changed');
  const rec = [{ id: 'abc', title: 'Refinement', from: { app: 'pm', id: 'cer_ref' } }];
  assert.equal(ceremonyStatus(ref, offers, rec), 'accepted');
  assert.equal(ceremonyStatus({ ...ref, name: 'Refinement 2' }, offers, rec), 'changed');
  assert.equal(ceremonyStatus(ref, offers, [{ from: { app: 'other', id: 'cer_ref' } }]), 'offered');
});

test('version checks: other apps\' collections are read only at the version this app knows', () => {
  const sp = { schema: 'prioritizer.dayplan/settings', version: 1, rev: 3, items: [], meta: { sprint: SP } };
  assert.equal(docketSprint(sp).state, 'ok');
  assert.equal(docketSprint(sp).sprint.anchor, '2026-10-26');
  assert.equal(docketSprint({ ...sp, version: 2 }).state, 'newer');
  assert.equal(docketSprint({ ...sp, meta: { sprint: { anchor: null } } }).state, 'unset');
  assert.equal(docketSprint(null).state, 'unset');
  const q = { schema: 'queue.settings', version: 1, items: [], meta: { areas: ['Web App\\Team A', ''], connection: 'main' } };
  assert.deepEqual(queueInfo(q), { areas: ['Web App\\Team A'], connection: 'main' });
  assert.deepEqual(queueInfo({ ...q, version: 2 }), { areas: [], connection: '' });
  assert.equal(readable({ schema: 'pm.cadence', version: 1, items: [] }, 'pm.cadence', 1), true);
  assert.equal(readable({ schema: 'pm.cadence', version: 2, items: [] }, 'pm.cadence', 1), false);
  assert.equal(readable(null, 'pm.cadence', 1), false);
});

test('settings are cleaned with defaults', () => {
  assert.deepEqual(cleanSettings({}), { connection: '', useQueueAreas: true, staleDays: 14, refreshMinutes: 30 });
  assert.deepEqual(cleanSettings({ staleDays: 0, refreshMinutes: 9999, useQueueAreas: false, connection: ' main ' }), { connection: 'main', useQueueAreas: false, staleDays: 14, refreshMinutes: 30 });
});

// Focus: the active task, the day's activity log, re-entry breadcrumbs and the switch counter, and saving the log
// through the same write loop as the board. Runs in Node; the browser side is covered by test/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { data as sdk } from '../../../shared/workshop-sdk.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import * as F from '../js/focus-model.js';
import { focusEnvelopeFromBoard, focusEnvelopesFromBundle, focusFormat } from '../js/focus-format.js';
import { createStore } from '../js/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const schemas = SchemaSet.fromDir(path.join(HERE, '..', '..', '..', 'docs', 'schemas'));
const clone = v => JSON.parse(JSON.stringify(v));
const D = '2026-11-03';
let tick = 0;
const at = () => new Date(Date.UTC(2026, 10, 3, 14, 0, tick++)).toISOString();

test('starting, switching, finishing: one active task, switches only when an unfinished task is left', () => {
  const log = F.freshLog(), done = new Set();
  const open = id => !done.has(id);
  assert.equal(F.activeOf(log, D), null);
  assert.deepEqual(F.startTask(log, D, 'a', at(), open), {left: null, switched: false});
  assert.equal(F.activeOf(log, D), 'a');
  assert.deepEqual(F.startTask(log, D, 'a', at(), open), {left: null, switched: false}, 'starting the active task again does nothing');
  assert.deepEqual(F.startTask(log, D, 'b', at(), open), {left: 'a', switched: true});
  assert.equal(F.activeOf(log, D), 'b');
  done.add('b'); assert.equal(F.taskClosed(log, D, 'b', at()), true);
  assert.equal(F.activeOf(log, D), null);
  assert.deepEqual(F.startTask(log, D, 'c', at(), open), {left: null, switched: false}, 'finishing first is not a switch');
  done.add('c');
  assert.deepEqual(F.startTask(log, D, 'a', at(), open), {left: null, switched: false}, 'leaving a finished active task is not a switch');
  assert.equal(F.taskClosed(log, D, 'zzz', at()), false);
  assert.equal(F.stopActive(log, D, at()), 'a');
  assert.equal(F.stopActive(log, D, at()), null);
  const ev = F.addEvent(log, D, {at: at(), type: 'interrupt'});
  F.addEvent(log, D, {at: at(), type: 'interrupt'});
  assert.deepEqual(F.dayCounts(log, D), {switches: 1, interrupts: 2, started: 3, wrapped: false});
  assert.equal(F.dropEvent(log, D, log.days[D].events.at(-1)), true);
  assert.equal(F.dayCounts(log, D).interrupts, 1);
  assert.ok(ev);
  assert.deepEqual(F.touchedOn(log, D), ['a', 'b', 'c']);
});

test('the active task never carries over to the next day, and shutdown stops it', () => {
  const log = F.freshLog();
  F.startTask(log, D, 'a', at());
  assert.equal(F.activeOf(log, '2026-11-04'), null);
  assert.ok(F.activeSince(log, D));
  F.shutdown(log, D, at());
  assert.equal(F.activeOf(log, D), null);
  assert.equal(F.dayCounts(log, D).wrapped, true);
  assert.equal(log.days[D].events.at(-2).why, 'shutdown');
});

test('cleaning drops bad events and keeps the newest ones in time order', () => {
  const log = F.cleanLog({days: {[D]: {events: [
    {at: '2026-11-03T15:00:00.000Z', type: 'interrupt'},
    {at: '2026-11-03T14:00:00.000Z', type: 'start', taskId: 'a', switch: 'yes'},
    {at: 'nope', type: 'start', taskId: 'a'}, {at: '2026-11-03T14:00:00.000Z', type: 'start'},
    {at: '2026-11-03T14:00:00.000Z', type: 'dance'}, {at: '2026-11-03T16:00:00.000Z', type: 'stop', taskId: 'a', why: 'lunch'}
  ]}, junk: {}}});
  assert.deepEqual(Object.keys(log.days), [D]);
  assert.deepEqual(log.days[D].events.map(e => e.type), ['start', 'interrupt', 'stop']);
  assert.equal(log.days[D].events[0].switch, false);
  assert.equal(log.days[D].events[2].why, 'pause');
  const big = F.freshLog();
  for (let i = 0; i < F.MAX_EVENTS + 20; i++) F.addEvent(big, D, {at: at(), type: 'interrupt'});
  assert.equal(big.days[D].events.length, F.MAX_EVENTS);
});

test('breadcrumbs: blank adds nothing, text is tidied, the newest ten are kept', () => {
  const t = {id: 'a'};
  assert.equal(F.addCrumb(t, '   ', at()), false);
  assert.equal(F.lastCrumb(t), null);
  assert.equal(F.addCrumb(t, '  tests pass\n except   the date edge case ', at()), true);
  assert.equal(F.lastCrumb(t).text, 'tests pass except the date edge case');
  for (let i = 0; i < 15; i++) F.addCrumb(t, `step ${i}`, at());
  assert.equal(t.crumbs.length, F.MAX_CRUMBS);
  assert.equal(F.lastCrumb(t).text, 'step 14');
  assert.equal(F.addCrumb(t, 'x'.repeat(900), at()), true);
  assert.equal(F.lastCrumb(t).text.length, F.CRUMB_LEN);
  assert.deepEqual(F.cleanCrumbs([{at: 'bad', text: 'x'}, {at: at(), text: ''}, null, 'x']), []);
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
  const w = {log: F.freshLog()};
  w.store = createStore({data: be.client(id), board: () => w.log, applied: () => F.cleanLog(w.log), timers: globalThis,
    format: focusFormat(['focus/days/2025', 'focus/days/2026'])});
  await w.store.load(); w.store.start();
  return w;
}

test('the log saves as focus/days/<yyyy>, and a second window sees the same active task', async () => {
  const be = backend(), a = await win(be, 'a');
  F.startTask(a.log, D, 'a', at());
  a.store.schedule();
  await a.store.flushAll();
  assert.deepEqual(Object.keys(be.files), ['focus/days/2026']);
  assert.equal(be.files['focus/days/2026'].version, 1);
  const b = await win(be, 'b');
  assert.equal(F.activeOf(b.log, D), 'a');
  const env = be.files['focus/days/2026'];
  const bundle = {collections: [{app: 'prioritizer', collection: 'focus/days/2026', envelope: env}, {app: 'prioritizer', collection: 'tasks', envelope: {}}]};
  assert.deepEqual(Object.keys(focusEnvelopesFromBundle(bundle)), ['focus/days/2026']);
  assert.throws(() => focusEnvelopesFromBundle({collections: [{app: 'prioritizer', collection: 'focus/days/2026', envelope: {schema: 'prioritizer.focus/days/2026', version: 9, items: []}}]}), /newer Workshop/);
});

test('saved focus records match schemas/focus-day.schema.json', () => {
  const ds = SchemaSet.fromDir(path.join(HERE, '..', 'schemas'));
  const log = F.freshLog();
  F.startTask(log, D, 'a', at()); F.startTask(log, D, 'b', at()); F.addEvent(log, D, {at: at(), type: 'interrupt'});
  F.taskClosed(log, D, 'b', at()); F.shutdown(log, D, at());
  for (const r of focusEnvelopeFromBoard('focus/days/2026', log, null).items) assert.deepEqual(ds.validate('focus-day.schema.json', r), []);
});

test('handoffs: a finished task offered to Receipts once per day, updated in place, withdrawn, and pruned after 60 days', async () => {
  const log = F.freshLog();
  const h = F.offerReceipt(log, 't1', D, '  Shipped   the guide ', 'growth', at());
  assert.equal(h.id, 'h_t1_2026-11-03'); assert.equal(h.to, 'receipts'); assert.equal(h.text, 'Shipped the guide');
  assert.deepEqual(h.payload, {kind: 'growth', impact: 0, about: 'me'});
  assert.deepEqual(h.source, {app: 'prioritizer', id: 't1'});
  const first = h.createdAt;
  F.offerReceipt(log, 't1', D, 'Shipped the onboarding guide', 'nope', at());
  assert.equal(log.handoffs.length, 1, 'same task and day: same offer');
  assert.equal(log.handoffs[0].text, 'Shipped the onboarding guide'); assert.equal(log.handoffs[0].payload.kind, 'win'); assert.equal(log.handoffs[0].createdAt, first);
  assert.equal(F.offerReceipt(log, 't2', D, '   ', 'win', at()), null, 'blank text offers nothing');
  assert.ok(F.receiptOffer(log, 't1', D));
  assert.equal(F.withdrawOffer(log, F.receiptId('t1', D)), true);
  assert.equal(F.receiptOffer(log, 't1', D), null);
  F.offerReceipt(log, 'old', '2026-08-01', 'Old', 'win', at()); F.offerReceipt(log, 'new', '2026-10-01', 'New', 'win', at());
  assert.equal(F.pruneHandoffs(log, D), 1);
  assert.deepEqual(log.handoffs.map(x => x.source.id), ['new']);
  assert.equal(F.cleanLog({handoffs: [{id: 'x', to: 'Receipts', date: D, createdAt: at(), text: 'x', source: {app: 'prioritizer'}}]}).handoffs.length, 0, 'bad receiver id');
  // Saved as prioritizer.handoffs v1, each item valid against Workshop's docs/schemas/handoff-item.schema.json shape.
  const be = backend(), a = await (async () => { const w = {log: F.freshLog()};
    w.store = createStore({data: be.client('a'), board: () => w.log, applied: () => F.cleanLog(w.log), timers: globalThis, format: focusFormat(['focus/days/2026', 'handoffs'])});
    await w.store.load(); w.store.start(); return w; })();
  F.offerReceipt(a.log, 't9', D, 'Ran the release', 'win', at());
  a.store.schedule(); await a.store.flushAll();
  const env = be.files.handoffs;
  assert.equal(env.schema, 'prioritizer.handoffs'); assert.equal(env.version, 1);
  const it = env.items[0];
  for (const k of ['id', 'updatedAt', 'to', 'date', 'createdAt', 'text', 'source']) assert.ok(k in it, k);
  assert.ok(it.updatedAt > 0);
  assert.deepEqual(Object.keys(focusEnvelopesFromBundle({collections: [{app: 'prioritizer', collection: 'handoffs', envelope: env}]})), ['handoffs']);
});

test('wrap-up for Notes: the lines tell the day in four short lines', () => {
  const lines = F.wrapLines({done: ['Fix login', 'Review PR'], leftOff: [{title: 'Q4 draft', crumb: 'outline Q1'}, {title: 'Docs', crumb: ' '}],
    tomorrow: ['Q4 draft', '1:1 prep'], counts: {switches: 1, interrupts: 2}});
  assert.deepEqual(lines, ['Done: Fix login, Review PR.', 'Left off: Q4 draft (next: outline Q1), Docs.', 'Tomorrow: Q4 draft, 1:1 prep.', 'Day: 2 tasks done, 1 switch, 2 interruptions.']);
  assert.deepEqual(F.wrapLines({}), ['Done: nothing marked done.', 'Day: 0 tasks done, 0 switches, 0 interruptions.']);
});

test('wrap-up for Notes: one accepted note offer per day, replaced by a later wrap-up, valid as a handoff', () => {
  const log = F.freshLog();
  const a = F.offerWrapNote(log, '2026-11-06', ['Done: A.'], '2026-11-06T21:00:00.000Z');
  assert.equal(a.to, 'notes');
  assert.equal(a.accepted, true);
  assert.deepEqual(a.payload, {kind: 'note', daily: '2026-11-06', section: 'Wrap-up', lines: ['Done: A.']});
  assert.deepEqual(schemas.validate('handoff-item', {...a, updatedAt: 1}), []);
  F.offerReceipt(log, 't1', '2026-11-06', 'A', 'win', '2026-11-06T21:00:00.000Z');
  const b = F.offerWrapNote(log, '2026-11-06', ['Done: A, B.'], '2026-11-06T22:30:00.000Z');
  assert.notEqual(a.id, b.id, 'a new id, so Notes takes the later wrap-up too');
  assert.deepEqual(log.handoffs.filter(h => h.to === 'notes').map(h => h.id), [b.id]);
  assert.equal(F.wrapNote(log, '2026-11-06'), b);
  assert.equal(F.withdrawWrapNote(log, '2026-11-06'), true);
  assert.equal(F.wrapNote(log, '2026-11-06'), null);
  assert.equal(log.handoffs.length, 1, "Rapport's receipt offer stays");
});

// Every-sprint offers from other apps (Workshop docs/handoffs.md, Receivers): reading only offers for Docket,
// accepting (add, or update the item from the same source), dismissing, the handled list in Docket's own data,
// and that saved items still match the schema. Runs in Node; the settings sheet is covered by test/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import * as M from '../js/dayplan-model.js';
import { dpApplyEnvelope, dpEnvelopeFromBoard } from '../js/dayplan-format.js';
import { HANDLED_MAX, applyOffer, cleanOffer, markHandled, matchFor, offerKey, pendingOffers } from '../js/offers-model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const clone = v => JSON.parse(JSON.stringify(v));

// The shape of Workshop's docs/examples/handoff-item.every-sprint.json.
const OFFER = {
  id: 'h_cer_refinement', updatedAt: 1793736000000, to: 'prioritizer', date: '2026-11-03', createdAt: '2026-11-03T13:40:00.000Z',
  text: 'Backlog refinement', payload: {kind: 'every-sprint', title: 'Backlog refinement', dueDay: 4, planKind: 'meetings', value: 2, effort: 'S'},
  source: {app: 'example-app', id: 'cer_refinement'}
};
const env = (items, extra = {}) => ({schema: 'example-app.handoffs', version: 1, rev: 3, items, deleted: {}, ...extra});

test('only every-sprint offers addressed to Docket are read, from a handoffs collection at version 1', () => {
  const items = [
    OFFER,
    {...OFFER, id: 'h_receipt', to: 'receipts'},
    {...OFFER, id: 'h_win', payload: {kind: 'win'}},
    {...OFFER, id: 'h_nodue', payload: {kind: 'every-sprint', title: 'No day'}},
    {...OFFER, id: 'h_last', text: 'Retro from text', payload: {kind: 'every-sprint', last: true, value: 9, effort: 'XXL', planKind: '  Meetings '}, date: '2026-11-01'},
    {...OFFER, id: 'h_bad_date', date: 'soon'},
    null
  ];
  const list = pendingOffers('example-app', env(items));
  assert.deepEqual(list.map(o => o.id), ['h_last', 'h_cer_refinement'], 'oldest first');
  const last = list[0];
  assert.deepEqual([last.title, last.last, last.value, last.effort, last.planKind, last.from], ['Retro from text', true, 2, 'S', 'meetings', 'example-app'], 'text is the title fallback; bad value and effort get defaults');
  const ref = list[1];
  assert.deepEqual([ref.title, ref.dueDay, ref.last, ref.sourceId, ref.app], ['Backlog refinement', 4, false, 'cer_refinement', 'example-app']);
  assert.deepEqual(pendingOffers('example-app', env(items, {version: 2})), [], 'a newer version reads as nothing offered');
  assert.deepEqual(pendingOffers('example-app', env(items, {schema: 'other.handoffs'})), []);
  assert.deepEqual(pendingOffers('example-app', null), [], 'no collection, no offers');
});

test('handled offers do not show again until the sender changes them', () => {
  const key = offerKey('example-app', OFFER);
  assert.deepEqual(pendingOffers('example-app', env([OFFER]), [key]), []);
  const changed = {...OFFER, payload: {...OFFER.payload, dueDay: 5}};
  assert.notEqual(offerKey('example-app', changed), key);
  assert.equal(offerKey('example-app', {...OFFER, updatedAt: 1, createdAt: '2026-11-04T00:00:00.000Z', date: '2026-11-04'}), key, 'only text and payload count');
  assert.deepEqual(pendingOffers('example-app', env([changed]), [key]).map(o => o.dueDay), [5]);
  const many = Array.from({length: HANDLED_MAX + 5}, (_, i) => `k${i}`);
  const kept = markHandled(many, ['k3', 'new']);
  assert.equal(kept.length, HANDLED_MAX);
  assert.deepEqual(kept.slice(-2), ['k3', 'new'], 'newest last, capped');
});

test('accepting adds an every-sprint item marked with where it came from', () => {
  const o = cleanOffer('example-app', OFFER);
  const {recurring, item, updated} = applyOffer([], o, {id: 'r1', listId: 'l1'});
  assert.equal(updated, false);
  assert.deepEqual(item, {id: 'r1', listId: 'l1', paused: false, made: [], title: 'Backlog refinement', dueDay: 4, last: false, planKind: 'meetings', value: 2, effort: 'S', notes: '', from: {app: 'example-app', id: 'cer_refinement'}});
  const clean = M.cleanRecurring(recurring[0]);
  assert.deepEqual(clean.from, {app: 'example-app', id: 'cer_refinement'}, 'from survives cleaning');
  assert.equal(M.cleanRecurring({title: 'x', from: {app: 'Bad App'}}).from, undefined, 'a bad from is dropped');
  assert.deepEqual(M.cleanRecurring({title: 'x', from: {app: 'example-app', id: 7}}).from, {app: 'example-app'});
});

test('an offer from the same source updates that item, keeping its id, list, pause and made sprints', () => {
  const mine = M.cleanRecurring({id: 'r1', title: 'Old name', dueDay: 2, listId: 'l9', paused: true, made: ['2026-10-21'], from: {app: 'example-app', id: 'cer_refinement'}});
  const other = M.cleanRecurring({id: 'r2', title: 'Release', last: true});
  const o = cleanOffer('example-app', {...OFFER, payload: {...OFFER.payload, title: 'Refinement', dueDay: 6, effort: 'M', notes: 'Role: Facilitator.'}});
  assert.equal(matchFor([mine, other], o), mine);
  const {recurring, item, updated} = applyOffer([mine, other], o, {id: 'unused', listId: 'l1'});
  assert.equal(updated, true);
  assert.equal(recurring.length, 2);
  assert.deepEqual([item.id, item.title, item.dueDay, item.effort, item.listId, item.paused, item.made, item.notes], ['r1', 'Refinement', 6, 'M', 'l9', true, ['2026-10-21'], 'Role: Facilitator.']);
  assert.equal(recurring[1], other);
  // Last day keeps the old due day number underneath.
  const last = applyOffer([mine], cleanOffer('example-app', {...OFFER, payload: {kind: 'every-sprint', title: 'R', last: true}}), {id: 'x'}).item;
  assert.deepEqual([last.last, last.dueDay], [true, 2]);
  // Another sender with the same source id does not match.
  assert.equal(matchFor([mine], {...o, app: 'other'}), null);
  assert.equal(matchFor([mine], {...o, sourceId: null}), null);
});

test('handled keys are saved in dayplan/settings meta, only once there are any, and read back', () => {
  const dp = M.cleanDayplan({sprint: {anchor: '2026-11-04'}});
  assert.equal('handled' in dpEnvelopeFromBoard('dayplan/settings', dp, null).meta, false, 'a board with no offers saves as before');
  dp.handled = ['example-app:h_a:1'];
  const e = dpEnvelopeFromBoard('dayplan/settings', dp, null);
  assert.deepEqual(e.meta.handled, ['example-app:h_a:1']);
  assert.equal(e.meta.sprint.anchor, '2026-11-04');
  const back = M.cleanDayplan({});
  dpApplyEnvelope('dayplan/settings', clone(e), back);
  assert.deepEqual(M.cleanDayplan(back).handled, ['example-app:h_a:1']);
  dp.handled = [];
  assert.deepEqual(dpEnvelopeFromBoard('dayplan/settings', dp, e).meta.handled, [], 'cleared stays written');
  assert.deepEqual(M.cleanDayplan({handled: ['a', 3, 'a', 'b']}).handled, ['a', 'b']);
});

test('an accepted item matches the recurring schema', () => {
  const ds = SchemaSet.fromDir(path.join(HERE, '..', 'schemas'));
  const {item} = applyOffer([], cleanOffer('example-app', OFFER), {id: 'r1', listId: null});
  const dp = M.cleanDayplan({recurring: [item]});
  for (const r of dpEnvelopeFromBoard('dayplan/recurring', dp, null).items) assert.deepEqual(ds.validate('dayplan-recurring.schema.json', r), []);
});

/* ---------- accepted tasks from Home and the Dispatch hub (Workshop docs/handoffs.md, rule 4) ---------- */
import { SENDERS, acceptedTasks, cleanTaskOffer, listFor, taskFromOffer } from '../js/offers-model.js';

// The shape of Workshop's docs/examples/handoff-item.task-accepted.json.
const TASK = {
  id: 'hub_k3m9q2', updatedAt: 1793736000000, to: 'prioritizer', date: '2026-11-03', createdAt: '2026-11-03T22:15:00.000Z',
  text: 'Onboarding doc for Person One', payload: {kind: 'task', title: 'Onboarding doc for Person One', who: ['p_one'], value: 3},
  source: {app: 'agents', id: 'hub_k3m9q2'}, accepted: true
};
const hubEnv = (items, app = 'agents') => ({schema: `${app}.handoffs`, version: 1, rev: 1, items, deleted: {}});

test('Home and Dispatch are senders', () => {
  assert.equal(SENDERS.home, 'Home');
  assert.equal(SENDERS.agents, 'Dispatch');
});

test('only accepted task offers for Docket are picked up', () => {
  const items = [
    TASK,
    {...TASK, id: 'not_accepted', accepted: false},
    {...TASK, id: 'no_flag', accepted: undefined},
    {...TASK, id: 'other_app', to: 'receipts'},
    {...TASK, id: 'other_kind', payload: {kind: 'every-sprint', title: 'x', dueDay: 1}},
    {...TASK, id: 'from_text', payload: {kind: 'task'}, text: 'Title from @text ^tomorrow'}
  ];
  const got = acceptedTasks('agents', hubEnv(items));
  assert.deepEqual(got.map(o => o.id), ['from_text', 'hub_k3m9q2']);
  assert.equal(got[0].title, 'Title from @text ^tomorrow', 'never parsed as Quick add syntax');
  assert.deepEqual(acceptedTasks('agents', hubEnv([TASK], 'home')), [], 'the schema must name the sender');
  assert.deepEqual(acceptedTasks('agents', {...hubEnv([TASK]), version: 2}), [], 'an unknown version reads as nothing');
});

test('handled keys and tasks already added are skipped', () => {
  const [o] = acceptedTasks('agents', hubEnv([TASK]));
  assert.deepEqual(acceptedTasks('agents', hubEnv([TASK]), [o.key]), []);
  assert.deepEqual(acceptedTasks('agents', hubEnv([TASK]), [], [{id: 't1', from: {app: 'agents', id: 'hub_k3m9q2'}}]), [], 'even after the handled list was trimmed');
});

test('fields are cleaned', () => {
  const o = cleanTaskOffer('home', {...TASK, payload: {kind: 'task', title: '  Keys  ', who: ['p_a', 'p_a', 'Name', 3, 'g_t'], waiting: true, due: '2026-11-06', urgent: true, value: 9, effort: 'XXL', list: 'This sprint', notes: ' n '}});
  assert.deepEqual({title: o.title, who: o.who, waiting: o.waiting, due: o.due, urgent: o.urgent, value: o.value, effort: o.effort, list: o.list, notes: o.notes},
    {title: 'Keys', who: ['p_a', 'g_t'], waiting: true, due: '2026-11-06', urgent: true, value: null, effort: null, list: 'This sprint', notes: 'n'});
  assert.equal(cleanTaskOffer('home', {...TASK, payload: {kind: 'task', due: '11/6'}}).due, null);
});

test('the list is matched by name, else the fallback', () => {
  const lists = [{id: 'main', name: 'Main'}, {id: 'sp', name: 'This sprint', parentId: 'main'}];
  assert.equal(listFor({list: 'this SPRINT'}, lists, 'main'), 'sp');
  assert.equal(listFor({list: 'Nope'}, lists, 'main'), 'main');
  assert.equal(listFor({list: ''}, lists, 'main'), 'main');
});

test('taskFromOffer builds a Docket task that remembers where it came from', () => {
  const [o] = acceptedTasks('agents', hubEnv([TASK]));
  const t = taskFromOffer(o, {id: 't9', listId: 'main', rank: 4, color: 'sage', today: '2026-11-03'});
  assert.deepEqual(t.from, {app: 'agents', id: 'hub_k3m9q2'});
  assert.equal(t.value, 3);
  assert.equal(t.urgentFlag, false);
  assert.equal(t.waiting, false);
  assert.deepEqual(t.who, ['p_one']);
  assert.equal(t.createdAt, '2026-11-03');
});

test('sendersFrom: senders come from manifests, with the built-in list as the fallback', async () => {
  const { sendersFrom, SENDERS } = await import('../js/offers-model.js');
  const apps = [
    { id: 'home', name: 'Home', handoffs: { sends: ['prioritizer', 'notes'] } },
    { id: 'agents', name: 'Dispatch', handoffs: { sends: ['prioritizer'] } },
    { id: 'notes', name: 'Notes', handoffs: { sends: [] } },
    { id: 'prioritizer', name: 'Docket', handoffs: { sends: ['prioritizer'] } },
    { id: 'newapp', name: 'New app', handoffs: { sends: ['prioritizer'] } }
  ];
  assert.deepEqual(sendersFrom(apps), { home: 'Home', agents: 'Dispatch', newapp: 'New app' });
  assert.deepEqual(sendersFrom([{ id: 'other', name: 'Other', handoffs: { sends: ['prioritizer'] } }]), { home: 'Home', agents: 'Dispatch', other: 'Other' }, 'added to the built-in list');
  assert.deepEqual(sendersFrom([]), SENDERS);
  assert.deepEqual(sendersFrom(null), SENDERS);
});

test("Rapport's 1:1 follow-ups: a delegated one becomes a waiting task on the person, a plain one is yours", () => {
  // The shape Rapport 4.1.0 sends from Log follow-ups (Workshop docs/handoffs.md, Senders). Docket gives a
  // waiting task its follow-up date on pickup (offers.js), so the payload carries no nudgeOn.
  const base = {updatedAt: 1, to: 'prioritizer', date: '2026-11-03', createdAt: '2026-11-03T20:00:00.000Z', accepted: true,
    source: {app: 'receipts', id: 'oneonones/notes/p-abc1/2026-11-03.md'}};
  const env = hubEnv([
    {...base, id: 'h_p-abc1-2026-11-03_a1', text: 'Share the runbook', payload: {kind: 'task', title: 'Share the runbook', notes: 'From your 1:1', waiting: true, who: ['p_r1']}},
    {...base, id: 'h_p-abc1-2026-11-03_b2', text: 'Book the room', payload: {kind: 'task', title: 'Book the room', notes: 'From your 1:1'}}
  ], 'receipts');
  const [del, mine] = acceptedTasks('receipts', env);
  assert.deepEqual([del.who, del.waiting, mine.who, mine.waiting], [['p_r1'], true, [], false]);
  const t = taskFromOffer(del, {id: 't1', listId: 'l1', rank: 1, color: '#000', today: '2026-11-03'});
  assert.deepEqual([t.waiting, t.who, t.from], [true, ['p_r1'], {app: 'receipts', id: 'h_p-abc1-2026-11-03_a1'}]);
  assert.deepEqual(acceptedTasks('receipts', env, [del.key, mine.key]), [], 'handled once');
});

// Publish: what changed on linked items, what can be sent to ADO (owners as Assigned To, a sprint move), what is a
// conflict, and the workitem.update calls through a fake connector. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSource, mergeLinked, pulled } from '../js/ado/model.js';
import { localChanges, planPublish, publishCount, sendPlan, sprintFor, updateArgs } from '../js/ado/publish.js';
import { createAdo } from '../js/ado/index.js';
import { directory } from '../shared/people.js';
import { blankDoc, toEnvelopeParts } from '../js/model.js';
import { publishDialog, publishResultsDialog } from '../js/view.js';

const URL = id => `https://ado.example.test/Sample/_workitems/edit/${id}`;
const w = (id, title, extra = {}) => ({ id, rev: 3, type: 'Feature', title, state: 'Active', area: 'Sample\\Team', iteration: 'Sample\\Team\\Sprint 1', parentId: null, startDate: null, targetDate: null, url: URL(id), ...extra });
const ITER = { Sample: [
  { path: 'Sample\\Team\\Sprint 1', start: '2027-01-06', finish: '2027-01-19' },
  { path: 'Sample\\Team\\Sprint 2', start: '2027-01-20', finish: '2027-02-02' },
  { path: 'Sample\\Other\\Sprint 2', start: '2027-01-20', finish: '2027-02-02' },
  { path: 'Sample\\Other\\Sprint 3', start: '2027-02-03', finish: '2027-02-16' },
  { path: 'Sample\\Else\\Sprint 3', start: '2027-02-03', finish: '2027-02-16' }
] };
const SRC = cleanSource({ areas: 'Sample\\Team', mode: 'linked' });
const result = items => ({ connection: 'main', items, total: items.length, truncated: false, fetchedAt: '2026-11-05T12:00:00Z' });
const DIR = directory({ schema: 'settings.people', version: 2, rev: 1, deleted: {}, items: [
  { id: 'p_one', kind: 'person', updatedAt: 1, name: 'Dev One', handle: 'one', relation: 'report', adoIdentity: 'dev.one@example.test' },
  { id: 'p_two', kind: 'person', updatedAt: 1, name: 'Dev Two', handle: 'two', relation: 'report', adoIdentity: 'dev.two@example.test' },
  { id: 'p_none', kind: 'person', updatedAt: 1, name: 'No Identity', handle: 'none', relation: 'peer' },
  { id: 'g_team', kind: 'group', updatedAt: 1, name: 'Team', handle: 'team', members: ['p_one', 'p_two'] }
] });
const ONE = { name: 'Dev One', email: 'dev.one@example.test' };

const ITEMS = () => [
  w(11, 'Sprint placed', { assignee: ONE }),
  w(12, 'Own dates', { startDate: '2027-01-04', targetDate: '2027-02-20', assignee: ONE }),
  w(13, '<img src=x onerror=alert(1)>', { assignee: null })
];
function linkedDoc(items = ITEMS()) {
  const r = result(items);
  const doc = mergeLinked(blankDoc('Plan'), pulled(r, ITER, SRC, { dir: DIR }), SRC, r).doc;
  return { doc, get: id => doc.items.find(i => i.ado.id === id) };
}

test('pulled records where ADO keeps the dates: sprint, project, own dates', () => {
  const { get } = linkedDoc();
  assert.deepEqual([get(11).ado.iteration, get(11).ado.project, get(11).ado.ownDates], ['Sample\\Team\\Sprint 1', 'Sample', false]);
  assert.equal(get(12).ado.ownDates, true);
  assert.deepEqual([get(11).start, get(11).end], ['2027-01-06', '2027-01-19']);
});

test('the new ado fields pass the item schema', async () => {
  const { SchemaSet } = await import('./workshop/schema.mjs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const schemas = SchemaSet.fromDir(join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas'));
  for (const it of toEnvelopeParts(linkedDoc().doc).items.filter(i => i.kind === 'item')) assert.deepEqual(schemas.validate('map-item', it), []);
});

test('localChanges: only fields that differ from what the last refresh brought', () => {
  const { doc, get } = linkedDoc();
  assert.deepEqual(doc.items.map(localChanges), [[], [], []]);
  get(11).title = 'Renamed'; get(11).who = ['p_two'];
  assert.deepEqual(localChanges(get(11)).map(c => c.field), ['title', 'who']);
  assert.deepEqual(localChanges(get(11))[1], { field: 'who', from: ['p_one'], to: ['p_two'] });
  // Owners do not count when the last refresh brought none.
  delete get(12).ado.base.who; get(12).who = ['p_two'];
  assert.deepEqual(localChanges(get(12)), []);
  assert.deepEqual(localChanges({ kind: 'item', title: 'ad hoc' }), []);
});

test('publishCount: owners and sprint moves count, titles and own dates do not; only linked roadmaps', () => {
  const { doc, get } = linkedDoc();
  assert.equal(publishCount(doc), 0);
  get(11).title = 'Renamed'; get(12).start = '2027-01-11';
  assert.equal(publishCount(doc), 0, 'a title or own dates alone can not be sent');
  get(11).start = '2027-01-20'; get(11).end = '2027-02-02';
  get(13).who = ['p_one'];
  assert.equal(publishCount(doc), 2);
  get(13).ado.missing = true;
  assert.equal(publishCount(doc), 1, 'an item ADO no longer has is not counted');
  assert.equal(publishCount({ ...doc, meta: { ...doc.meta, ado: { ...doc.meta.ado, mode: 'live' } } }), 0);
  assert.equal(publishCount({ ...doc, meta: { ...doc.meta, ado: undefined } }), 0);
});

test('sprintFor: exact sprint dates in the project, the one beside the current sprint when several share them', () => {
  const it = (start, end, iteration = 'Sample\\Team\\Sprint 1') => ({ start, end, ado: { project: 'Sample', iteration } });
  assert.equal(sprintFor(it('2027-01-20', '2027-02-02'), ITER).sprint.path, 'Sample\\Team\\Sprint 2', 'the sibling of the current sprint');
  assert.match(sprintFor(it('2027-02-03', '2027-02-16'), ITER).why, /More than one/);
  assert.match(sprintFor(it('2027-01-21', '2027-02-02'), ITER).why, /exactly one sprint/);
  assert.match(sprintFor(it(null, null), ITER).why, /Unscheduled/);
  assert.match(sprintFor(it('2027-01-20', '2027-02-02'), {}).why, /did not load/);
  assert.equal(sprintFor({ start: '2027-01-20', end: '2027-02-02', ado: { project: 'Elsewhere', iteration: '' } }, ITER).why, "ADO's sprint list for this project did not load.");
});

test('planPublish: what is sent, what is not and why', () => {
  const { doc, get } = linkedDoc();
  get(11).who = ['p_two']; get(11).start = '2027-01-20'; get(11).end = '2027-02-02'; get(11).title = 'Renamed'; get(11).status = 'done';
  get(12).start = '2027-01-11'; get(12).who = [];
  get(13).who = ['g_team'];
  const plan = planPublish(doc, { dir: DIR, iterations: ITER });
  assert.equal(plan.send, 2);
  const row = id => plan.rows.find(r => r.adoId === id);
  assert.deepEqual(row(11).changes, { assignedTo: 'dev.two@example.test', iteration: 'Sample\\Team\\Sprint 2' });
  assert.deepEqual(row(11).fields.map(f => [f.label, f.sent]), [['Assigned To', true], ['Sprint', true], ['Title', false], ['Status', false]]);
  assert.equal(row(11).fields[0].from, 'Dev One (dev.one@example.test)');
  assert.deepEqual(row(12).changes, { assignedTo: '' }, 'no owner unassigns; own dates are not sent');
  assert.match(row(12).fields.find(f => f.label === 'Dates').why, /own start or target date/);
  assert.equal(row(13).status, 'skip');
  assert.match(row(13).fields[0].why, /group/);
  assert.deepEqual(plan.rows.map(r => r.status), ['send', 'send', 'skip'], 'items to send come first');
  assert.deepEqual(updateArgs(row(11)), { id: 11, rev: 3, connection: 'main', changes: { assignedTo: 'dev.two@example.test', iteration: 'Sample\\Team\\Sprint 2' } });
});

test('planPublish: owners that can not be Assigned To', () => {
  const { doc, get } = linkedDoc();
  const why = who => { get(11).who = who; return planPublish(doc, { dir: DIR, iterations: ITER }).rows[0].fields[0]; };
  assert.match(why(['p_one', 'p_two']).why, /one Assigned To/);
  assert.match(why(['p_none']).why, /no ADO identity/);
  assert.match(why(['p_gone']).why, /does not have/);
  get(11).who = ['p_two'];
  assert.match(planPublish(doc, { dir: null, iterations: ITER }).rows[0].fields[0].why, /not loaded/);
  // Already Assigned To that person in ADO: nothing to send.
  get(11).ado.assignee = { name: 'Dev Two', email: 'dev.two@example.test' };
  assert.equal(planPublish(doc, { dir: DIR, iterations: ITER }).rows[0].status, 'skip');
});

test('conflicts: an item ADO changed too is skipped, never sent; so is one ADO no longer has', () => {
  const { doc, get } = linkedDoc();
  get(11).who = ['p_two'];
  // ADO changed the assignee too: the next refresh marks it as differing.
  const changed = ITEMS(); changed[0] = { ...changed[0], rev: 4, assignee: { name: 'Dev Three', email: 'dev.three@example.test' } };
  const after = mergeLinked(doc, pulled(result(changed), ITER, SRC, { dir: DIR }), SRC, result(changed)).doc;
  const plan = planPublish(after, { dir: DIR, iterations: ITER });
  assert.equal(plan.rows[0].status, 'conflict');
  assert.equal(plan.conflicts, 1);
  assert.equal(plan.send, 0);
  assert.deepEqual(plan.rows[0].changes, {});
  assert.ok(plan.rows[0].fields.every(f => !f.sent && !f.why), 'the row, not each field, says why');
  assert.match(plan.rows[0].why, /Changed in ADO too/);
  get(11).ado.missing = true;
  assert.equal(planPublish(doc, { dir: DIR, iterations: ITER }).rows[0].status, 'skip');
  // A link made before this version has no ownDates: refresh first.
  delete get(12).ado.ownDates; get(12).start = '2027-01-20'; get(12).end = '2027-02-02';
  assert.match(planPublish(doc, { dir: DIR, iterations: ITER }).rows.find(r => r.adoId === 12).fields[0].why, /Refresh from ADO first/);
});

test('planPublish ignores live roadmaps and ad hoc items', () => {
  const { doc, get } = linkedDoc();
  get(11).who = ['p_two'];
  doc.items.push({ id: 'x', kind: 'item', title: 'ad hoc', who: ['p_one'] });
  assert.equal(planPublish(doc, { dir: DIR, iterations: ITER }).rows.length, 1);
  doc.meta.ado.mode = 'live';
  assert.deepEqual(planPublish(doc, { dir: DIR, iterations: ITER }).rows, []);
});

/** A fake ADO connector: applies updates whose rev matches, refuses the rest with a conflict. */
function fakeConnector(items) {
  const calls = [];
  const byId = new Map(items.map(x => [x.id, { ...x }]));
  const call = async (action, args, opts = {}) => {
    calls.push({ action, args: structuredClone(args), confirm: opts.confirm });
    if (action !== 'workitem.update') throw Object.assign(new Error('unexpected'), { code: 'bad_request' });
    if (!opts.confirm) throw Object.assign(new Error('Needs confirm'), { code: 'forbidden' });
    const cur = byId.get(args.id);
    if (!cur) throw Object.assign(new Error(`Work item ${args.id} was not found.`), { code: 'not_found' });
    if (cur.rev !== args.rev) throw Object.assign(new Error(`Work item ${args.id} changed in ADO since you loaded it. Review the change and try again.`), { code: 'conflict' });
    cur.rev += 1;
    if ('assignedTo' in args.changes) cur.assignee = args.changes.assignedTo;
    if ('iteration' in args.changes) cur.iteration = args.changes.iteration;
    return { id: cur.id, rev: cur.rev, iteration: cur.iteration };
  };
  return { calls, byId, call };
}

test('sendPlan: one update per item to send, conflicts and failures reported, nothing else called', async () => {
  const { doc, get } = linkedDoc([...ITEMS(), w(14, 'Fourth', { assignee: ONE }), w(15, 'Fifth', { assignee: ONE })]);
  get(11).start = '2027-01-20'; get(11).end = '2027-02-02';
  get(12).who = ['p_two'];
  get(13).title = 'Only a title';
  get(14).who = ['p_two'];
  get(15).who = [];
  const plan = planPublish(doc, { dir: DIR, iterations: ITER });
  const fake = fakeConnector([{ id: 11, rev: 3 }, { id: 12, rev: 5 }, { id: 14, rev: 3 }]); // 12 changed in ADO; 15 is gone
  const progress = [];
  const out = await sendPlan((a, args) => fake.call(a, args, { confirm: true }), plan, { onProgress: n => progress.push(n) });
  const by = id => out.find(r => r.adoId === id);
  assert.equal(by(11).outcome, 'updated');
  assert.equal(fake.byId.get(11).iteration, 'Sample\\Team\\Sprint 2');
  assert.equal(by(12).outcome, 'conflict');
  assert.match(by(12).message, /changed in ADO/);
  assert.equal(fake.byId.get(12).rev, 5, 'a conflict changes nothing');
  assert.equal(by(14).outcome, 'updated');
  assert.equal(by(15).outcome, 'failed');
  assert.match(by(15).message, /not found/);
  assert.equal(by(13).outcome, 'skipped');
  assert.deepEqual(fake.calls.map(c => c.args.id), [11, 12, 14, 15], 'skipped items are never sent');
  assert.ok(fake.calls.every(c => c.action === 'workitem.update'));
  assert.equal(progress.length, 4);
});

test('createAdo().publish calls workitem.update on the ado connector with confirm: true', async () => {
  const { doc, get } = linkedDoc();
  get(11).who = ['p_two'];
  const fake = fakeConnector([{ id: 11, rev: 3 }]);
  const seen = [];
  const ws = { connectors: { list: async () => [{ id: 'ado', status: { state: 'ready' } }], call: async (id, action, args, opts) => { seen.push(id); return fake.call(action, args, opts); } }, data: { get: async () => null } };
  const ado = createAdo(ws);
  const out = await ado.publish(planPublish(doc, { dir: DIR, iterations: ITER }));
  assert.deepEqual(out.map(r => r.outcome), ['updated']);
  assert.deepEqual(seen, ['ado']);
  assert.deepEqual(fake.calls[0], { action: 'workitem.update', args: { id: 11, rev: 3, connection: 'main', changes: { assignedTo: 'dev.two@example.test' } }, confirm: true });
});

test('the preview and results escape every ADO text and only link http(s)', () => {
  const { doc, get } = linkedDoc();
  get(13).who = ['p_one'];
  get(13).ado.url = 'javascript:alert(1)';
  const plan = planPublish(doc, { dir: DIR, iterations: ITER });
  const html = publishDialog(plan);
  assert.ok(!html.includes('<img'), 'title escaped');
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /Publish 1</);
  assert.match(publishDialog({ rows: [], send: 0, conflicts: 0 }), /data-pub-confirm disabled/);
  const res = publishResultsDialog([{ itemId: 'a', adoId: 13, title: '<b>x</b>', outcome: 'failed', message: '<script>bad</script>' }]);
  assert.ok(!res.includes('<b>x') && !res.includes('<script>'));
  assert.match(res, /1 failed/);
});

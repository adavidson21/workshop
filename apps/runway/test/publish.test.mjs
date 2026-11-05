// Publish: what changed on linked items, what can be sent to ADO (owners as Assigned To, a sprint move), what is a
// conflict, and the workitem.update calls through a fake connector. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSource, mergeLinked, pulled } from '../js/ado/model.js';
import { applySent, localChanges, planPublish, publishCount, sendPlan, sprintFor, updateArgs } from '../js/ado/publish.js';
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

test('publishCount: titles, owners and dates count, status alone does not; only linked roadmaps', () => {
  const { doc, get } = linkedDoc();
  assert.equal(publishCount(doc), 0);
  get(11).status = 'done';
  assert.equal(publishCount(doc), 0, 'a status change alone can not be sent');
  get(11).title = 'Renamed'; get(12).start = '2027-01-11';
  get(13).who = ['p_one'];
  assert.equal(publishCount(doc), 3);
  get(13).ado.missing = true;
  assert.equal(publishCount(doc), 2, 'an item ADO no longer has is not counted');
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
  get(11).who = ['p_two']; get(11).start = '2027-01-20'; get(11).end = '2027-02-02'; get(11).title = '  Renamed   here '; get(11).status = 'done';
  get(12).start = '2027-01-11'; get(12).who = [];
  get(13).who = ['g_team'];
  const plan = planPublish(doc, { dir: DIR, iterations: ITER });
  assert.equal(plan.send, 2);
  const row = id => plan.rows.find(r => r.adoId === id);
  assert.deepEqual(row(11).changes, { assignedTo: 'dev.two@example.test', iteration: 'Sample\\Team\\Sprint 2', title: 'Renamed here' });
  assert.deepEqual(row(11).fields.map(f => [f.label, f.sent]), [['Assigned To', true], ['Title', true], ['Sprint', true], ['Status', false]]);
  assert.equal(row(11).fields[0].from, 'Dev One (dev.one@example.test)');
  assert.deepEqual([row(11).fields[1].from, row(11).fields[1].to], ['Sprint placed', 'Renamed here']);
  assert.deepEqual(row(12).changes, { assignedTo: '', startDate: '2027-01-11' }, 'no owner unassigns; only the moved end of own dates is sent');
  assert.deepEqual(row(12).fields.find(f => f.label === 'Start date'), { label: 'Start date', from: 'Jan 4, 2027', to: 'Jan 11, 2027', sent: true, why: '' });
  assert.equal(row(13).status, 'skip');
  assert.match(row(13).fields[0].why, /group/);
  assert.deepEqual(plan.rows.map(r => r.status), ['send', 'send', 'skip'], 'items to send come first');
  assert.deepEqual(updateArgs(row(12)), { id: 12, rev: 3, connection: 'main', changes: { assignedTo: '', startDate: '2027-01-11' } });
  assert.ok(plan.rows.every(r => !('area' in r.changes) && !('state' in r.changes)), 'never area or state');
});

test('own dates: both ends, clearing, a milestone, and values ADO already has', () => {
  const { doc, get } = linkedDoc();
  const plan = () => planPublish(doc, { dir: DIR, iterations: ITER }).rows.find(r => r.adoId === 12);
  get(12).start = '2027-02-01'; get(12).end = '2027-03-05';
  assert.deepEqual(plan().changes, { startDate: '2027-02-01', targetDate: '2027-03-05' });
  get(12).start = null; get(12).end = null;
  assert.deepEqual(plan().changes, { startDate: '', targetDate: '' }, 'unscheduled clears both');
  assert.deepEqual(plan().fields.map(f => f.to), ['none', 'none']);
  get(12).start = '2027-02-27'; get(12).end = '2027-02-27'; get(12).milestone = true;
  assert.deepEqual(plan().changes, { targetDate: '2027-02-27' }, 'a milestone sends its target date only');
  get(12).start = '2027-02-20'; get(12).end = '2027-02-20';
  assert.equal(plan().status, 'skip', 'nothing when ADO already has it');
  assert.equal(plan().fields[0].why, 'Already this in ADO.');
  // Only a target date in ADO: the bar's start came from the sprint or a default span. Moving only the end sends only it.
  const only = linkedDoc([w(21, 'Target only', { targetDate: '2027-02-20' })]);
  const t = only.get(21);
  assert.deepEqual([t.ado.startDate, t.ado.targetDate], [null, '2027-02-20']);
  t.end = '2027-02-27';
  assert.deepEqual(planPublish(only.doc, { dir: DIR, iterations: ITER }).rows[0].changes, { targetDate: '2027-02-27' });
});

test('sprint-placed items: a whole sprint moves the sprint, other dates become own dates for an Epic or Feature only', () => {
  const items = [w(31, 'Feature in a sprint'), w(32, 'Story in a sprint', { type: 'User Story', parentId: 31 }), w(33, 'Other feature')];
  const r0 = result(items);
  const src = cleanSource({ areas: 'Sample\\Team', mode: 'linked', types: ['Epic', 'Feature', 'User Story'] });
  const doc = mergeLinked(blankDoc('Plan'), pulled(r0, ITER, src, { dir: DIR }), src, r0).doc;
  const get = id => doc.items.find(i => i.ado.id === id);
  const feature = 33; // Feature 31 has its story shown, so it is not drawn itself
  get(feature).start = '2027-01-08'; get(feature).end = '2027-01-30';
  const r = planPublish(doc, { dir: DIR, iterations: ITER }).rows;
  assert.deepEqual(r[0].changes, { startDate: '2027-01-08', targetDate: '2027-01-30' });
  assert.equal(r[0].fields[0].from, 'none (from its sprint)');
  get(32).start = '2027-01-08'; get(32).end = '2027-01-30';
  const story = planPublish(doc, { dir: DIR, iterations: ITER }).rows.find(x => x.adoId === 32);
  assert.equal(story.status, 'skip');
  assert.match(story.fields[0].why, /exactly one sprint/);
});

test('titles: trimmed, at most 255, a story keeps its "Feature > " in Runway', () => {
  const items = [w(40, 'Parent feature', { type: 'Feature' }), w(41, 'Child story', { type: 'User Story', parentId: 40 })];
  const r = result(items);
  const src = cleanSource({ areas: 'Sample\\Team', mode: 'linked', types: ['Epic', 'Feature', 'User Story'] });
  const doc = mergeLinked(blankDoc('Plan'), pulled(r, ITER, src, { dir: DIR }), src, r).doc;
  const story = doc.items.find(i => i.ado.id === 41);
  assert.equal(story.title, 'Parent feature > Child story');
  assert.equal(story.ado.titlePrefix, 'Parent feature > ');
  const plan = () => planPublish(doc, { dir: DIR, iterations: ITER }).rows[0];
  story.title = 'Parent feature > Child story, renamed';
  assert.deepEqual(plan().changes, { title: 'Child story, renamed' });
  assert.deepEqual([plan().fields[0].from, plan().fields[0].to], ['Child story', 'Child story, renamed']);
  story.title = 'Renamed without its feature';
  assert.equal(plan().status, 'skip');
  assert.match(plan().fields[0].why, /Keep "Parent feature >"/);
  story.title = 'Parent feature > ';
  assert.match(plan().fields[0].why, /can't be empty/);
  delete story.ado.titlePrefix; story.title = 'Parent feature > Again';
  assert.match(plan().fields[0].why, /Refresh from ADO first/);
  const { doc: d2, get } = linkedDoc();
  get(11).title = 'x'.repeat(300);
  assert.equal(planPublish(d2, { dir: DIR, iterations: ITER }).rows[0].changes.title.length, 255);
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
    for (const k of ['title', 'startDate', 'targetDate']) if (k in args.changes) cur[k] = args.changes[k];
    return { id: cur.id, rev: cur.rev, iteration: cur.iteration };
  };
  return { calls, byId, call };
}

test('sendPlan: one update per item to send, conflicts and failures reported, nothing else called', async () => {
  const { doc, get } = linkedDoc([...ITEMS(), w(14, 'Fourth', { assignee: ONE }), w(15, 'Fifth', { assignee: ONE })]);
  get(11).start = '2027-01-20'; get(11).end = '2027-02-02';
  get(12).who = ['p_two'];
  get(13).status = 'done';
  get(14).who = ['p_two']; get(14).title = 'Fourth, renamed';
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
  assert.equal(fake.byId.get(14).title, 'Fourth, renamed');
  assert.equal(by(15).outcome, 'failed');
  assert.match(by(15).message, /not found/);
  assert.equal(by(13).outcome, 'skipped');
  assert.deepEqual(fake.calls.map(c => c.args.id), [11, 12, 14, 15], 'skipped items are never sent');
  assert.ok(fake.calls.every(c => c.action === 'workitem.update'));
  assert.equal(progress.length, 4);
});

test('applySent: an updated item takes the title as sent, so the next refresh does not see a difference', () => {
  const { doc, get } = linkedDoc();
  get(11).title = '  Spaced   out '; get(12).title = 'Not sent';
  const plan = planPublish(doc, { dir: DIR, iterations: ITER });
  applySent(doc, plan, [{ itemId: get(11).id, outcome: 'updated' }, { itemId: get(12).id, outcome: 'conflict' }]);
  assert.equal(get(11).title, 'Spaced out');
  assert.equal(get(12).title, 'Not sent', 'only items ADO updated');
  const after = ITEMS(); after[0] = { ...after[0], rev: 4, title: 'Spaced out' };
  const merged = mergeLinked(doc, pulled(result(after), ITER, SRC, { dir: DIR }), SRC, result(after)).doc;
  const it = merged.items.find(i => i.ado.id === 11);
  assert.ok(!it.ado.remote);
  assert.deepEqual(localChanges(it), []);
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

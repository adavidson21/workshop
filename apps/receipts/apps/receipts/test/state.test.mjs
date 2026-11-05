// npm test  (Node 22, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/state.js';

const NOW = new Date(2026, 9, 31); // Oct 31 2026
const e = (o) => R.cleanEntry({ id: o.id || R.newId('r'), about: 'me', kind: 'win', text: 'x', date: '2026-10-01', ...o });

test('periods: quarter, last quarter, cycle first when set', () => {
  const ps = R.periods({ cycleStart: '2026-04-01', cycleEnd: '2026-09-30' }, NOW);
  assert.equal(ps[0].key, 'cycle');
  const q = ps.find(p => p.key === 'quarter');
  assert.deepEqual([q.from, q.to], ['2026-10-01', '2026-12-31']);
  const lq = ps.find(p => p.key === 'last-quarter');
  assert.deepEqual([lq.from, lq.to], ['2026-07-01', '2026-09-30']);
  const jan = R.periods({}, new Date(2026, 0, 15)).find(p => p.key === 'last-quarter');
  assert.deepEqual([jan.from, jan.to], ['2025-10-01', '2025-12-31']);
  assert.equal(R.periods({}, NOW)[0].key, 'quarter');
});

test('cleanEntry drops junk and fixes types', () => {
  const c = R.cleanEntry({ id: 'a', kind: 'nope', impact: '7', sections: ['Results', 5, ''], date: 'bad', star: 1, extra: 'x' });
  assert.equal(c.kind, 'note');
  assert.equal(c.impact, 0);
  assert.deepEqual(c.sections, ['Results', '5']);
  assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.star, true);
  assert.equal('extra' in c, false);
});

test('filterEntries: about, period, section, star, search; newest first', () => {
  const list = [
    e({ id: '1', date: '2026-10-02', sections: ['Results'], text: 'Shipped billing' }),
    e({ id: '2', date: '2026-10-20', star: true, text: 'Led incident review' }),
    e({ id: '3', date: '2026-06-01', text: 'Old one' }),
    e({ id: '4', about: 'p_a', date: '2026-10-05', text: 'Report win' }),
  ];
  const q = R.findPeriod({}, 'quarter', NOW);
  assert.deepEqual(R.filterEntries(list, { about: 'me', period: q }).map(x => x.id), ['2', '1']);
  assert.deepEqual(R.filterEntries(list, { about: 'me', section: 'Results' }).map(x => x.id), ['1']);
  assert.deepEqual(R.filterEntries(list, { about: 'me', star: true }).map(x => x.id), ['2']);
  assert.deepEqual(R.filterEntries(list, { q: 'BILLING' }).map(x => x.id), ['1']);
});

test('buildReview: one home section per receipt, coverage counts every tag, gaps', () => {
  const list = [
    e({ id: 'a', sections: ['Collaboration', 'Results'], impact: 1 }),
    e({ id: 'b', sections: ['Results'], star: true }),
    e({ id: 'c', sections: [] }),
  ];
  const r = R.buildReview(list, { about: 'me', period: R.findPeriod({}, 'all'), sections: ['Results', 'Collaboration', 'Ownership'] });
  assert.equal(r.total, 3);
  // A receipt's first tag is its home: 'a' shows under Collaboration only.
  assert.deepEqual(r.groups.find(g => g.section === 'Results').items.map(x => x.id), ['b']);
  assert.deepEqual(r.groups.find(g => g.section === 'Collaboration').items.map(x => x.id), ['a']);
  assert.deepEqual(r.groups.find(g => g.section === 'Other').items.map(x => x.id), ['c']);
  assert.deepEqual(r.coverage.map(c => c.count), [2, 1, 0]);
  assert.deepEqual(r.gaps, ['Ownership']);
  const text = R.reviewText(r, { title: 'Self review', period: R.findPeriod({}, 'all'), withDates: false });
  assert.match(text, /^Self review\nAll time\n\nResults\n- x\n\nCollaboration\n- x\n\nOther\n- x\n\nNo receipts yet for: Ownership\n$/);
});

test('bullet adds the metric once', () => {
  assert.equal(R.bullet(e({ text: 'Cut deploy time', metric: '-35%' })), 'Cut deploy time (-35%)');
  assert.equal(R.bullet(e({ text: 'Cut deploy time -35%', metric: '-35%' })), 'Cut deploy time -35%');
});

test('rosterRows: counts, staleness, archived hidden', () => {
  const ppl = [R.cleanPerson({ id: 'p_a', name: 'Person A' }), R.cleanPerson({ id: 'p_b', name: 'Person B' }), R.cleanPerson({ id: 'p_c', name: 'Person C', archived: true })];
  const list = [e({ about: 'p_a', date: '2026-10-25', kind: 'feedback' }), e({ about: 'p_b', date: '2026-08-01' })];
  const rows = R.rosterRows(ppl, list, R.findPeriod({}, 'quarter', NOW), { staleDays: 30 }, NOW);
  assert.deepEqual(rows.map(r => r.person.id), ['p_a', 'p_b']);
  assert.equal(rows[0].feedback, 1);
  assert.equal(rows[0].stale, false);
  assert.equal(rows[0].daysSince, 6);
  assert.equal(rows[1].total, 0);
  assert.equal(rows[1].stale, true);
});

test('toCsv: BOM, CRLF, quoting', () => {
  const csv = R.toCsv([e({ text: 'Said "hi", then left\nlater', star: true })], () => 'Me');
  assert.ok(csv.startsWith('﻿Date,Quarter,About'));
  assert.ok(csv.includes('"Said ""hi"", then left\nlater"'));
  assert.ok(csv.endsWith('TRUE\r\n'));
});

test('default sections are Receipts\' own generic list, not a company form', () => {
  assert.deepEqual(R.DEFAULT_SECTIONS, ['Results', 'Craft', 'Ownership', 'Collaboration', 'Communication', 'Leadership', 'Growth']);
  assert.deepEqual(R.DEFAULT_CONFIG.sections, R.DEFAULT_SECTIONS);
});

test('unlistedSections: tags not in the list, most used first', () => {
  const list = [e({ sections: ['Old A', 'Results'] }), e({ sections: ['Old B'] }), e({ sections: ['Old B', 'Old A'] }), e({ sections: ['Old B'] })];
  assert.deepEqual(R.unlistedSections(list, R.DEFAULT_SECTIONS), ['Old B', 'Old A']);
  assert.deepEqual(R.unlistedSections([e({ sections: ['Results'] })], R.DEFAULT_SECTIONS), []);
});

test('toCsv: formula-looking cells get an apostrophe, plain numbers do not', () => {
  const csv = R.toCsv([e({ text: '=HYPERLINK("x")', metric: '-40% p95', evidence: '@cmd', people: '-3' })], () => 'Me');
  const row = csv.split('\r\n')[1];
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`), row);
  assert.ok(row.includes(",'-40% p95,"), row);
  assert.ok(row.includes(",'@cmd,"), row);
  assert.ok(row.includes(',-3,'), row);
});

test('offers from Docket: only ones addressed here, valid, unhandled; accepted ones become receipts about you', () => {
  const env = { schema: 'prioritizer.handoffs', version: 1, rev: 3, items: [
    { id: 'h_a_2026-10-30', updatedAt: 1, to: 'receipts', date: '2026-10-30', createdAt: '2026-10-30T21:00:00.000Z', text: ' Shipped the guide ', payload: { kind: 'growth', impact: 2 }, source: { app: 'prioritizer', id: 'a' } },
    { id: 'h_b_2026-10-31', updatedAt: 1, to: 'receipts', date: '2026-10-31', createdAt: '2026-10-31T21:00:00.000Z', text: 'Ran the release', payload: { kind: 'nope', impact: 9 }, source: { app: 'prioritizer' } },
    { id: 'h_c', updatedAt: 1, to: 'other-app', date: '2026-10-31', createdAt: '2026-10-31T21:00:00.000Z', text: 'Not for us', source: { app: 'prioritizer' } },
    { id: 'h_d', updatedAt: 1, to: 'receipts', date: 'bad', createdAt: '2026-10-31T21:00:00.000Z', text: 'Bad date', source: { app: 'prioritizer' } },
  ] };
  const got = R.pendingOffers('prioritizer', env);
  assert.deepEqual(got.map(o => [o.key, o.kind, o.impact, o.from]), [['prioritizer:h_b_2026-10-31', 'win', 0, 'Docket'], ['prioritizer:h_a_2026-10-30', 'growth', 2, 'Docket']]);
  assert.equal(got[1].text, 'Shipped the guide');
  assert.deepEqual(R.pendingOffers('prioritizer', env, ['prioritizer:h_b_2026-10-31']).map(o => o.key), ['prioritizer:h_a_2026-10-30']);
  assert.deepEqual(R.pendingOffers('prioritizer', { ...env, version: 2 }), [], 'unknown version: unreadable');
  assert.deepEqual(R.pendingOffers('prioritizer', null), []);
  assert.deepEqual(R.pendingOffers('prioritizer', { ...env, schema: 'prioritizer.tasks' }), []);
  const r = R.entryFromOffer(got[1], NOW);
  assert.equal(r.about, 'me'); assert.equal(r.kind, 'growth'); assert.equal(r.impact, 2); assert.equal(r.date, '2026-10-30');
  assert.equal(r.evidence, 'From Docket'); assert.equal(r.text, 'Shipped the guide');
  assert.equal(got[0].about, 'me', 'no payload.about: about you');
  assert.deepEqual(R.markHandled(['x', 'y'], ['y', 'z']), ['x', 'y', 'z']);
  assert.equal(R.markHandled(Array.from({ length: 600 }, (_, i) => `k${i}`), ['new']).length, R.HANDLED_MAX);
});

test('offers from 1:1s: about a report in your list becomes a receipt about them; anything else is about you', () => {
  assert.equal(R.SENDERS.oneonones, '1:1s');
  const env = { schema: 'oneonones.handoffs', version: 1, rev: 2, items: [
    { id: 'h_p_x1_2026-10-30_a', updatedAt: 1, to: 'receipts', date: '2026-10-30', createdAt: '2026-10-30T21:00:00.000Z', text: 'Led the incident review', payload: { kind: 'win', about: 'p_r1' }, source: { app: 'oneonones', id: 'p_x1' } },
    { id: 'h_p_x1_2026-10-30_b', updatedAt: 1, to: 'receipts', date: '2026-10-30', createdAt: '2026-10-30T21:00:00.000Z', text: 'Gone report', payload: { kind: 'win', about: 'p_gone' }, source: { app: 'oneonones' } },
    { id: 'h_p_x1_2026-10-30_c', updatedAt: 1, to: 'receipts', date: '2026-10-30', createdAt: '2026-10-30T21:00:00.000Z', text: 'Odd about', payload: { kind: 'win', about: 'up' }, source: { app: 'oneonones' } },
  ] };
  const got = R.pendingOffers('oneonones', env, [], ['p_r1']);
  assert.deepEqual(got.map(o => [o.text, o.about, o.from]), [['Gone report', 'me', '1:1s'], ['Led the incident review', 'p_r1', '1:1s'], ['Odd about', 'me', '1:1s']]);
  const r = R.entryFromOffer(got[1], NOW);
  assert.equal(r.about, 'p_r1');
  assert.equal(r.kind, 'win');
  assert.equal(r.evidence, 'From 1:1s');
  assert.equal(R.entryFromOffer({ ...got[1], about: undefined }, NOW).about, 'me', "'me' stays the default");
  assert.equal(R.offerAbout({ about: 'p_r1' }), 'me', 'a report not in your list is about you');
  assert.equal(R.offerAbout(null, ['p_r1']), 'me');
  assert.deepEqual(R.pendingOffers('oneonones', { ...env, version: 2 }, [], ['p_r1']), [], 'unknown version: unreadable');
});

/* ---------- Workshop's people directory (docs/people.md in workshop) ---------- */
const dirEnv = items => ({ schema: 'settings.people', version: 1, rev: 2, items, deleted: {} });

test('readDirectory: missing, other schema or unknown version means use our own people', () => {
  assert.equal(R.readDirectory(null), null);
  assert.equal(R.readDirectory({ ...dirEnv([]), version: 2 }), null);
  assert.equal(R.readDirectory({ ...dirEnv([]), schema: 'receipts.people' }), null);
  assert.deepEqual(R.readDirectory(dirEnv([])), { all: [], reports: [], manager: '' });
});

test('readDirectory: reports keep their ids, the active manager names Upward', () => {
  const d = R.readDirectory(dirEnv([
    { id: 'p_me', updatedAt: 1, name: 'Me', relation: 'self' },
    { id: 'p_r1', updatedAt: 1, name: 'Person One', relation: 'report', role: 'Engineer', since: '2025-03-01', adoIdentity: 'x@example.com' },
    { id: 'p_r2', updatedAt: 1, name: 'Person Two', relation: 'report', archived: true },
    { id: 'p_old', updatedAt: 1, name: 'Old Boss', relation: 'manager', archived: true },
    { id: 'p_boss', updatedAt: 1, name: 'Boss Person', relation: 'manager' },
    { id: 'p_peer', updatedAt: 1, name: 'Peer', relation: 'peer' },
  ]));
  assert.deepEqual(d.reports.map(p => [p.id, p.name, p.role, p.since, p.archived]), [['p_r1', 'Person One', 'Engineer', '2025-03-01', false], ['p_r2', 'Person Two', '', '', true]]);
  assert.equal(d.manager, 'Boss Person');
  assert.equal(d.all.length, 6);
  // The roster works on directory reports exactly as on Receipts' own people.
  const rows = R.rosterRows(d.reports, [{ ...R.blankEntry('p_r1', R.DEFAULT_CONFIG), id: 'e1', text: 'x', date: R.today() }], { key: 'all' }, R.DEFAULT_CONFIG);
  assert.deepEqual(rows.map(r => r.person.id), ['p_r1']);
});

test('accepted captures from Home and Dispatch are added with no click, once', () => {
  assert.equal(R.SENDERS.home, 'Home');
  assert.equal(R.SENDERS.agents, 'Dispatch');
  const h = { id: 'c_1', to: 'receipts', date: '2026-11-03', createdAt: '2026-11-03T22:00:00Z', text: 'Shipped it', payload: { kind: 'growth', about: 'p_one' }, source: { app: 'agents', id: 'c_1' }, accepted: true };
  const env = { schema: 'agents.handoffs', version: 1, rev: 1, deleted: {}, items: [h, { ...h, id: 'c_2', accepted: false }] };
  const got = R.acceptedOffers('agents', env, [], ['p_one']);
  assert.deepEqual(got.map(o => [o.id, o.kind, o.about]), [['c_1', 'growth', 'p_one']]);
  assert.deepEqual(R.pendingOffers('agents', env, [], ['p_one']).map(o => o.key), ['agents:c_2'], 'the tray shows only ordinary offers');
  const e = R.entryFromOffer(got[0]);
  assert.equal(e.id, R.offerEntryId('agents', 'c_1'));
  assert.equal(e.evidence, 'From Dispatch');
  assert.deepEqual(R.acceptedOffers('agents', env, ['agents:c_1'], ['p_one']), [], 'handled');
  assert.deepEqual(R.acceptedOffers('agents', env, [], ['p_one'], [e.id]), [], 'already an entry, or deleted');
  assert.equal(R.acceptedOffers('agents', env, [], [])[0].about, 'me', 'an unknown person is you');
});

test('sendersFrom: manifests add to the built-in senders, and the retired 1:1s app is always read', () => {
  const apps = [{ id: 'home', name: 'Home', handoffs: { sends: ['receipts', 'notes'] } }, { id: 'newapp', name: 'New app', handoffs: { sends: ['receipts'] } }, { id: 'receipts', name: 'Rapport', handoffs: { sends: ['receipts'] } }];
  const s = R.sendersFrom(apps);
  assert.equal(s.newapp, 'New app');
  assert.equal(s.home, 'Home');
  assert.equal(s.oneonones, '1:1s');
  assert.equal(s.receipts, undefined, 'never itself');
  assert.deepEqual(R.sendersFrom([]), R.SENDERS);
});

test('summaryCards: the receipts count for Home (Workshop docs/summaries.md)', () => {
  assert.deepEqual(R.summaryCards({ items: [{ id: 'a' }, { id: 'b' }] }), [{ id: 'entries', kind: 'count', title: 'Receipts', count: 2, route: 'me' }]);
  assert.equal(R.summaryCards(null)[0].count, 0);
});

test('summaryCards match the summary-card schema', async () => {
  const { SchemaSet } = await import('../../../test/workshop/schema.mjs');
  const schemas = SchemaSet.fromDir(new URL('../../../test/workshop/schemas/', import.meta.url).pathname);
  for (const c of R.summaryCards({ items: [{ id: 'a' }] })) assert.deepEqual(schemas.validate('summary-card', { ...c, updatedAt: 1 }), []);
});

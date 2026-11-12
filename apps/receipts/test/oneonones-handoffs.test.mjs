// 1:1 follow-ups to Docket as accepted task handoffs, and Tidy notes (Rapport 4.1.0). Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../js/oneonones/model.js';
import { createOneOnOnes } from '../js/oneonones/data.js';
import { logHtml, personHtml, tidyHtml } from '../js/oneonones/view.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import { NOW, PERSON, TODAY, fakeWs } from './oneonones-fake.mjs';

const schemas = SchemaSet.fromDir(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'schemas'));
const ME = { id: 'p_me', kind: 'person', name: 'Sam Lead', handle: 'sam', relation: 'self' };
const ISO = '2026-11-03T20:00:00.000Z';
const UNLINKED = { id: 'p_xyz9', personId: '', name: 'Pat Vendor', cadenceDays: 14, archived: false, relation: '', handle: '', linked: false };

/* ---------- owners ---------- */

test('owner defaults: @me, "I will" and your name are yours; their name, first name or @handle are theirs', () => {
  const own = t => M.followUpOwner(t, PERSON, ME);
  assert.equal(own('Send the rollout doc @me'), 'me');
  assert.equal(own('I will book the design review'), 'me');
  assert.equal(own("I'll ask finance"), 'me');
  assert.equal(own('Sam to check the budget'), 'me', 'your first name');
  assert.equal(own('Dev One to share the runbook'), 'them');
  assert.equal(own('Dev to share the runbook'), 'them', 'their first name');
  assert.equal(own('@dev shares the deck'), 'them');
  assert.equal(own('Sam to ask Dev about the budget'), 'me', 'the first mention wins');
  assert.equal(own('Dev to ask Sam about the budget'), 'them');
  assert.equal(own('Dev to send it @me'), 'me', '@me always wins');
  assert.equal(own('Book the room'), 'me', 'naming no one: yours');
  assert.equal(own('Develop the plan'), 'me', 'a longer word is not their name');
  assert.equal(own('Ping @devops about it'), 'me', 'a longer handle is not theirs');
  assert.equal(own('(them) Share notes'), 'them', "Tidy's mark");
  assert.equal(own('(me) Share notes with Dev'), 'me');
  assert.equal(M.followUpOwner('Sam to check', PERSON, null), 'me', 'no "you" in People: still yours by default');
});

test('titles drop the owner marks and @me, and show their @handle as their name', () => {
  assert.equal(M.followUpTitle('(them)  @dev shares the deck @me', PERSON), 'Dev One shares the deck');
  assert.equal(M.followUpTitle('Ping @devops', PERSON), 'Ping @devops');
});

/* ---------- handoffs ---------- */

test('a line for them is delegated (who, waiting); a line for you is a plain task; both accepted, valid items', () => {
  const [them, mine] = M.followUpHandoffs({ person: PERSON, day: TODAY, nowIso: ISO, lines: [{ text: 'Dev to share the runbook', owner: 'them' }, { text: 'Book the room @me', owner: 'me' }] });
  assert.deepEqual(them.payload, { kind: 'task', title: 'Dev to share the runbook', notes: `From your 1:1 with Dev One on ${TODAY} (Rapport).`, waiting: true, who: ['p_r1'] });
  assert.deepEqual(mine.payload, { kind: 'task', title: 'Book the room', notes: `From your 1:1 with Dev One on ${TODAY} (Rapport).` });
  for (const h of [them, mine]) {
    assert.equal(h.to, 'prioritizer');
    assert.equal(h.accepted, true);
    assert.equal(h.date, TODAY);
    assert.deepEqual(h.source, { app: 'receipts', id: M.notePath(PERSON.id, TODAY) });
    assert.match(h.id, /^h_p-abc1-2026-11-03_[a-z0-9]+$/);
    assert.equal('nudgeOn' in h.payload, false, "Docket sets the follow-up date from its own working days");
    assert.deepEqual(schemas.validate('handoff-item', { ...h, updatedAt: NOW }), []);
  }
});

test('ids are stable per note and line: owner, spacing, case and a Tidy mark do not change them', () => {
  const id = M.followUpId(PERSON.id, TODAY, 'Dev to share the runbook');
  assert.equal(M.followUpId(PERSON.id, TODAY, '  dev to share   the RUNBOOK '), id);
  assert.equal(M.followUpId(PERSON.id, TODAY, '(them) Dev to share the runbook'), id);
  const a = M.followUpHandoffs({ person: PERSON, day: TODAY, nowIso: ISO, lines: [{ text: 'Dev to share the runbook', owner: 'them' }] })[0];
  const b = M.followUpHandoffs({ person: PERSON, day: TODAY, nowIso: '2026-11-04T09:00:00.000Z', lines: [{ text: 'Dev to share the runbook', owner: 'me' }] })[0];
  assert.equal(a.id, b.id);
  assert.notEqual(M.followUpId(PERSON.id, '2026-11-10', 'Dev to share the runbook'), id, 'another note is another follow-up');
  assert.notEqual(M.followUpId('p_other', TODAY, 'Dev to share the runbook'), id);
});

test('no link to People: sent without people, still waiting, their name in the notes', () => {
  const [h] = M.followUpHandoffs({ person: UNLINKED, day: TODAY, nowIso: ISO, lines: [{ text: 'Pat to send the quote', owner: 'them' }] });
  assert.deepEqual(h.payload, { kind: 'task', title: 'Pat to send the quote', notes: `From your 1:1 with Pat Vendor on ${TODAY} (Rapport). Waiting on Pat Vendor.`, waiting: true });
  const html = logHtml({ followUps: [{ text: 'Pat to send the quote', owner: 'them', sent: false }], wins: [], canOffer: false, canSend: true, linked: false, name: 'Pat Vendor' });
  assert.match(html, /Pat Vendor is not linked to People, so their tasks go to Docket without a person/);
});

test('the envelope: missing is empty, a newer version is not written, old offers are trimmed after 60 days', () => {
  assert.deepEqual(M.readHandoffs(null), M.emptyHandoffs());
  assert.equal(M.readHandoffs({ schema: 'receipts.handoffs', version: 2, items: [] }), null);
  assert.equal(M.readHandoffs({ schema: 'notes.handoffs', version: 1, items: [] }), null);
  const now = Date.parse('2026-11-03T12:00:00Z');
  const env = { ...M.emptyHandoffs(), items: [{ id: 'old', createdAt: '2026-08-01T00:00:00.000Z' }, { id: 'keep', createdAt: '2026-10-20T00:00:00.000Z' }] };
  const next = M.withHandoffs(env, [{ id: 'keep', createdAt: ISO }, { id: 'new', createdAt: ISO }], now);
  assert.deepEqual(next.items.map(i => i.id), ['keep', 'new']);
  assert.equal(env.items.length, 2, 'the input is not changed');
});

test('sending twice, and again after a reopen, adds each follow-up once; Docket\'s data is never written', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  const lines = [{ text: 'Dev to share the runbook', owner: 'them' }, { text: 'Book the room', owner: 'me' }];
  const items = () => M.followUpHandoffs({ person: PERSON, day: TODAY, nowIso: ISO, lines });
  assert.equal(await d.sendHandoffs(items()), 2);
  assert.equal(await d.sendHandoffs(items()), 0, 'already sent');
  const reopened = createOneOnOnes(ws, { now: () => NOW });
  await reopened.loadAll();
  const sent = await reopened.sentHandoffs();
  assert.ok(items().every(i => sent.has(i.id)), 'a reopened Rapport knows they were sent');
  assert.equal(await reopened.sendHandoffs(items()), 0);
  const env = ws.store.handoffs;
  assert.equal(env.schema, 'receipts.handoffs');
  assert.equal(env.items.length, 2);
  assert.ok(env.items.every(i => i.updatedAt > 0), 'stamped');
  assert.deepEqual(ws.puts.filter(n => n === 'handoffs').length, 1);
  assert.ok(!ws.puts.some(n => n.includes('prioritizer') || n === 'tasks'), 'only Rapport\'s own collection');
});

test('a newer handoffs collection is refused, never written over', async () => {
  const ws = fakeWs({ stored: { handoffs: { schema: 'receipts.handoffs', version: 2, rev: 3, items: [], deleted: {} } } });
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  await assert.rejects(d.sendHandoffs(M.followUpHandoffs({ person: PERSON, day: TODAY, nowIso: ISO, lines: [{ text: 'x', owner: 'me' }] })), e => e.code === 'downgrade');
  assert.equal(ws.store.handoffs.version, 2);
});

/* ---------- the dialog ---------- */

test('the dialog: owner picker per line, Sent lines unticked, Copy as quick-add lines as a secondary button', () => {
  const html = logHtml({ followUps: [{ text: 'Dev to share', owner: 'them', sent: false }, { text: 'Book it', owner: 'me', sent: true }], wins: [], canOffer: true, canSend: true, linked: true, name: 'Dev One' });
  assert.match(html, /name="f" value="0" checked/);
  assert.match(html, /name="f" value="1">/);
  assert.match(html, /<option value="them" selected>Dev One's \(waiting on them\)<\/option>/);
  assert.match(html, /<option value="me" selected>Mine<\/option>/);
  assert.match(html, /class="sent soft small">Sent</);
  assert.match(html, /<button class="btn" value="copy" data-copy-lines>Copy as quick-add lines<\/button>/);
  assert.match(html, /<button class="btn primary" value="ok">Log<\/button>/);
  const away = logHtml({ followUps: [{ text: 'Book it', owner: 'me', sent: false }], wins: [], canOffer: false, canSend: false, name: 'Dev One' });
  assert.doesNotMatch(away, /data-copy-lines|<select/, 'outside Workshop, Log copies the lines');
  assert.match(away, /copied as Docket quick-add lines/);
});

/* ---------- Tidy notes ---------- */

test('Tidy is hidden without the connector, with the steps off, or with no note open', () => {
  const tidy = { state: 'idle', error: '', followUps: [], wins: [] };
  const note = { day: TODAY, path: 'x', text: '', mode: 'edit' };
  assert.equal(tidyHtml(tidy, { enabled: true, ready: false, note }), '');
  assert.equal(tidyHtml(tidy, { enabled: false, ready: true, note }), '');
  assert.equal(tidyHtml(tidy, { enabled: true, ready: true, note: null }), '');
  assert.match(tidyHtml(tidy, { enabled: true, ready: true, note }), /data-tidy>Tidy notes</);
  const page = (ready) => personHtml({ person: PERSON, packet: { docket: { state: 'unlinked' }, slate: { state: 'unlinked' }, receipts: { state: 'unlinked' }, last: { state: 'none' }, since: TODAY, sinceFrom: 'cadence' },
    note, notes: [], today: TODAY, ai: { state: 'idle' }, aiOpts: { enabled: true, ready }, tidy });
  assert.doesNotMatch(page(false), /data-tidy/);
  assert.match(page(true), /data-tidy/);
});

test('Tidy shows the proposal escaped, with unticked lines kept unticked', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = tidyHtml({ state: 'done', error: '', followUps: [{ text: bad, owner: 'them', use: false }], wins: [{ text: bad, use: true }] }, { enabled: true, ready: true, note: {}, name: bad });
  assert.ok(!html.includes('<img'));
  assert.match(html, /data-tidy-f="0" aria-label/);
  assert.match(html, /data-tidy-w="0" checked/);
  assert.match(html, /data-tidy-accept/);
});

test('what Tidy sends: no title, no Since summary, the person named "them"', () => {
  const note = `# 1:1 with Dev One, ${TODAY}\n\n## Since 2026-10-27\n\n- Docket: 2 open tasks\n\n## Notes\n\n- Dev One shipped the importer\n- dev wants to own the runbook, @dev to draft it\n- talked to Devon about it\n`;
  const sent = M.tidyInput(note, PERSON);
  assert.ok(!/Dev One|@dev\b|\bDev\b/.test(sent), sent);
  assert.match(sent, /them shipped the importer/);
  assert.match(sent, /them to draft it/);
  assert.match(sent, /Devon/, 'a longer name is someone else');
  assert.ok(!sent.includes('Docket: 2 open tasks') && !sent.includes('# 1:1 with'));
  assert.equal(M.tidyInput(`# 1:1 with Dev One\n\n## Since x\n\n- y\n`, PERSON), '');
});

test('parseTidy reads Follow-ups with owners and Wins; "Nothing in the notes." is nothing', () => {
  const md = '## Follow-ups\n\n- [ ] (them) Draft the runbook\n- [ ] (me) Book the review\n- [ ] Unmarked line\n\n## Wins\n\n- Shipped the importer\n\n## Other\n\n- [ ] (them) Not a follow-up\n';
  assert.deepEqual(M.parseTidy(md), { followUps: [{ text: 'Draft the runbook', owner: 'them' }, { text: 'Book the review', owner: 'me' }, { text: 'Unmarked line', owner: 'me' }], wins: ['Shipped the importer'] });
  assert.deepEqual(M.parseTidy('## Follow-ups\n\nNothing in the notes.\n\n## Wins\n\nNothing in the notes.\n'), { followUps: [], wins: [] });
});

test('accept writes only the chosen lines, under the note\'s own headings, before the empty placeholders', () => {
  const note = M.noteTemplate({ name: 'Dev One', day: TODAY, packet: { since: '2026-10-27', docket: { state: 'unlinked' }, slate: { state: 'unlinked' }, receipts: { state: 'unlinked' }, last: { state: 'none' } } })
    .replace('## Notes\n\n', '## Notes\n\n- rough line\n');
  const out = M.applyTidy(note, { followUps: [{ text: 'Draft the runbook', owner: 'them' }, { text: 'Book the review', owner: 'me' }], wins: ['Shipped the importer'] }, PERSON);
  assert.match(out, /## Wins\n\n- Shipped the importer\n- \n/);
  assert.match(out, /## Follow-ups\n\n- \[ \] Draft the runbook @dev\n- \[ \] Book the review @me\n- \[ \] \n/);
  assert.match(out, /## Notes\n\n- rough line\n/, 'the rest is unchanged');
  assert.equal(M.applyTidy(note, { followUps: [], wins: [] }, PERSON), note, 'nothing chosen: nothing written');
  assert.equal(M.applyTidy(out, { followUps: [{ text: 'Draft the runbook', owner: 'them' }], wins: [] }, PERSON), out, 'a line already there is not added twice');
  // The owners it writes are read back the same way by Log follow-ups.
  const open = M.parseFollowUps(out).open;
  assert.deepEqual(open.map(t => M.followUpOwner(t, PERSON, ME)), ['them', 'me']);
  // No headings: sections are added at the end; no handle: their name.
  const bare = M.applyTidy('Just text', { followUps: [{ text: 'Send it', owner: 'them' }], wins: ['Did it'] }, UNLINKED);
  assert.equal(bare, 'Just text\n\n## Wins\n\n- Did it\n\n## Follow-ups\n\n- [ ] Pat Vendor: Send it\n');
});

test('Tidy calls the opencode connector: tidy with confirm, result without', async () => {
  const ws = fakeWs();
  const calls = ws.connectors.call;
  ws.connectors.call = async (id, action, args, opts) => {
    if (action === 'oneonone.tidy') { ws.calls.push({ id, action, args: structuredClone(args), confirm: !!(opts && opts.confirm) }); return { session: 'ses_2', folder: `${args.personId}-${args.date}-tidy` }; }
    if (action === 'oneonone.tidyResult') { ws.calls.push({ id, action, args: structuredClone(args), confirm: !!(opts && opts.confirm) }); return { state: 'done', text: '## Follow-ups\n\n- [ ] (them) X\n' }; }
    return calls(id, action, args, opts);
  };
  const d = createOneOnOnes(ws, { now: () => NOW });
  await d.loadAll();
  await d.tidy(PERSON.id, TODAY, '- them to do X\n');
  assert.equal((await d.tidyResult(PERSON.id, TODAY)).state, 'done');
  assert.deepEqual(ws.calls.map(c => [c.id, c.action, c.confirm]), [['opencode', 'oneonone.tidy', true], ['opencode', 'oneonone.tidyResult', false]]);
  assert.deepEqual(ws.calls[0].args, { personId: PERSON.id, date: TODAY, notes: '- them to do X\n' });
  assert.equal(ws.store['oneonones/notes'], undefined, 'nothing written');
  assert.deepEqual(Object.keys(ws.disk), [], 'no note files written');
});

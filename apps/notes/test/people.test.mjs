// Plan 2: @people and kinds for Rapport, @people on Docket tasks, and person chips (offers.js, markdown.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directory } from '../shared/people.js';
import { forRapport, handlesIn, offerFor, offerId, rapportOffers, readable, whoOf, wins } from '../js/offers.js';
import { render } from '../js/markdown.js';
import { SchemaSet } from './workshop/schema.mjs';

const schemas = SchemaSet.fromDir(join(dirname(fileURLToPath(import.meta.url)), 'workshop', 'schemas'));
const DIR = directory({ schema: 'settings.people', version: 2, rev: 1, deleted: {}, items: [
  { id: 'p_me', kind: 'person', name: 'Alex Me', handle: 'me', relation: 'self', updatedAt: 1 },
  { id: 'p_priya', kind: 'person', name: 'Priya Raman', handle: 'priya', relation: 'report', updatedAt: 1 },
  { id: 'p_sam', kind: 'person', name: 'Sam Lee', handle: 'sam', relation: 'report', updatedAt: 1 },
  { id: 'p_jo', kind: 'person', name: 'Jo Park', handle: 'jo', relation: 'peer', updatedAt: 1 },
  { id: 'p_old', kind: 'person', name: 'Old Report', handle: 'old', relation: 'report', archived: true, updatedAt: 1 }] });
const NOTE = { path: 'meetings/sync.md', title: 'Sync' };
const DAY = '2026-11-06';

test('handles: after a space or at the start, not in emails, each once', () => {
  assert.deepEqual(handlesIn('@priya and (@Sam) paired, mail a@b.com, @priya again, @jo.'), ['priya', 'sam', 'jo']);
});

test('lines for Rapport: the four kinds, tags taken out, handles kept for who it is about', () => {
  const text = '# Sync\n\n- @priya unblocked the release #win\n- Clear incident summary #feedback @sam\n- learned the deploy flow #growth\n- worried about on-call load #concern\n- #winning is not a tag\n```\n- @priya in code #win\n```\n';
  assert.deepEqual(forRapport(text).map(r => [r.kind, r.text, r.handles]), [
    ['win', '@priya unblocked the release', ['priya']], ['feedback', 'Clear incident summary @sam', ['sam']],
    ['growth', 'learned the deploy flow', []], ['concern', 'worried about on-call load', []]]);
  assert.deepEqual(wins(text).map(w => w.text), ['@priya unblocked the release']);
});

test('who: reports, and people who are not reports; archived people are no one', () => {
  const w = whoOf(['priya', 'jo', 'old', 'nobody', 'me'], DIR);
  assert.deepEqual(w.reports.map(p => p.id), ['p_priya']);
  assert.deepEqual(w.others.map(p => p.id), ['p_jo']);
  assert.equal(readable('@priya and @jo, not @nobody', DIR), 'Priya Raman and Jo Park, not @nobody');
});

test('a line naming reports: one offer each with payload.about; otherwise one as your own', () => {
  const [both] = forRapport('- @priya and @sam shipped the cache #win');
  const offers = rapportOffers(NOTE, both, { day: DAY, dir: DIR });
  assert.deepEqual(offers.map(o => [o.who, o.offer.payload.about, o.offer.payload.kind]), [['Priya Raman', 'p_priya', 'win'], ['Sam Lee', 'p_sam', 'win']]);
  assert.equal(offers[0].offer.text, 'Priya Raman and Sam Lee shipped the cache');
  assert.notEqual(offers[0].offer.id, offers[1].offer.id, 'one id per person');
  for (const o of offers) assert.deepEqual(schemas.validate('handoff-item', { ...o.offer, updatedAt: 1 }), []);
  const [peer] = forRapport('- @jo gave great feedback #feedback');
  const mine = rapportOffers(NOTE, peer, { day: DAY, dir: DIR });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].who, 'You');
  assert.equal(mine[0].offer.payload.about, undefined, 'not a report: sent as your own');
  assert.equal(mine[0].offer.payload.kind, 'feedback');
  const [plain] = forRapport('- shipped it #win');
  assert.equal(rapportOffers(NOTE, plain, { day: DAY }).at(0).offer.id, offerId('win', NOTE.path, 'shipped it'), 'a line with no one keeps the id it had before');
});

test('an action item carries its @people to Docket as payload.who, with names in the title', () => {
  const t = offerFor('task', NOTE, 'Pair with @priya on the rollout', { day: DAY, dir: DIR });
  assert.deepEqual(t.payload.who, ['p_priya']);
  assert.equal(t.payload.title, 'Pair with Priya Raman on the rollout');
  assert.equal(t.id, offerId('task', NOTE.path, 'Pair with @priya on the rollout'));
  assert.equal(offerFor('task', NOTE, 'Plain task', { day: DAY }).payload.who, undefined);
});

test('the preview shows a known @handle as the person\'s name; unknown ones stay as typed', () => {
  const html = render('@priya and @nobody, a@b.com', { person: (h) => (h === 'priya' ? 'Priya Raman' : null) });
  assert.match(html, /<span class="person" title="@priya">Priya Raman<\/span> and @nobody, a@b\.com/);
});

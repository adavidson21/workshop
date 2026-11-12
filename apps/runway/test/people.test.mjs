// Owners of roadmap items: Workshop's people directory (js/people.js), the outline's `who:` part, the Markdown
// table and the owner filter. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directory } from '../../../shared/people.js';
import { mentionOf, namesOf, notFor, resolve, setDirectory } from '../js/people.js';
import { parse, reconcile, serialize } from '../js/outline.js';
import { markdown } from '../js/export.js';
import { blankDoc, cleanItem } from '../js/model.js';

const DIR = directory({ schema: 'settings.people', version: 2, rev: 1, items: [
  { id: 'p_sam', kind: 'person', updatedAt: 1, name: 'Sam Lee', handle: 'sam', relation: 'report' },
  { id: 'p_jo', kind: 'person', updatedAt: 1, name: 'Jo Park', handle: 'jo', relation: 'peer' },
  { id: 'g_lead', kind: 'group', updatedAt: 1, name: 'Leadership', handle: 'leadership', members: ['p_jo'] }
] });
setDirectory(DIR);

test('resolve: ids stay ids, handles and names become ids, new names are missing once each', () => {
  assert.deepEqual(resolve(['@sam', 'Leadership', 'p_gone', '@newbie', 'newbie', ' ']), { ids: ['p_sam', 'g_lead', 'p_gone'], missing: ['Newbie'] });
  assert.equal(mentionOf('g_lead'), '@leadership');
  assert.equal(mentionOf('p_gone'), 'p_gone', 'an id the directory lost stays an id');
  assert.deepEqual(namesOf(['p_sam', 'p_gone']), ['Sam Lee', 'Unknown']);
});

test('cleanItem keeps only person and group ids as owners', () => {
  assert.deepEqual(cleanItem({ id: 'i-1', title: 'x', who: ['p_sam', 'p_sam', 'Sam', 3, 'g_lead'] }).who, ['p_sam', 'g_lead']);
  assert.deepEqual(cleanItem({ id: 'i-2', title: 'x' }).who, []);
});

test('outline: who: round trips as @handles and keeps ids through reconcile', () => {
  const text = '# Plan\nscale: month\nstart: 2027-01-01\n\n## Lane\n- Search cutover | Jan 2027 | who: @sam, @leadership, @newbie\n';
  const parsed = parse(text, { today: '2027-01-01' });
  assert.deepEqual(parsed.entries[0].who, ['@sam', '@leadership', '@newbie']);
  const r = reconcile(blankDoc(), parsed, { resolve: t => resolve(t) });
  const it = r.doc.items.find(x => x.kind === 'item');
  assert.deepEqual(it.who, ['p_sam', 'g_lead']);
  assert.deepEqual(r.newPeople, [{ id: it.id, names: ['Newbie'] }], 'new names are for the caller to add');
  const back = serialize(r.doc, { mention: id => mentionOf(id) });
  assert.match(back, /- Search cutover \| Jan 2027 \| who: @sam, @leadership\n/);
  const again = reconcile(r.doc, parse(back, { today: '2027-01-01' }), { resolve: t => resolve(t) });
  assert.equal(again.doc.items.find(x => x.kind === 'item').id, it.id);
  assert.deepEqual(again.doc.items.find(x => x.kind === 'item').who, ['p_sam', 'g_lead']);
  assert.match(serialize(r.doc), /who: p_sam, g_lead/, 'without a directory, ids');
});

test('the owner filter dims items that are not theirs, counting groups', () => {
  const items = [{ id: 'a', kind: 'item', who: ['g_lead'] }, { id: 'b', kind: 'item', who: ['p_sam'] }, { id: 'c', kind: 'item', who: [] }];
  assert.deepEqual([...notFor(items, 'p_jo')].sort(), ['b', 'c'], 'Jo owns a through @leadership');
  assert.deepEqual([...notFor(items, '')], []);
});

test('Markdown table: an Owners column only when some item has owners', () => {
  const doc = reconcile(blankDoc(), parse('# P\nscale: month\nstart: 2027-01-01\n\n## L\n- One | Jan 2027 | who: @sam\n- Two | Feb 2027\n', { today: '2027-01-01' }), { resolve: t => resolve(t) }).doc;
  const md = markdown(doc, { table: true, mention: id => mentionOf(id), names: w => namesOf(w) });
  assert.match(md, /\| Lane \| Item \| Start \| End \| Status \| After \| Owners \| Description \|/);
  assert.match(md, /\| One \|[^\n]*\| Sam Lee \|/);
  const plain = markdown(reconcile(blankDoc(), parse('# P\n\n## L\n- Two | Feb 2027\n', { today: '2027-01-01' })).doc, { table: true });
  assert.ok(!plain.includes('Owners'));
});

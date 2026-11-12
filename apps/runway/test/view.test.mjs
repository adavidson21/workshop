// The roadmap page's HTML pieces that are pure: the Unscheduled list and What's getting done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankDoc } from '../js/model.js';
import { summary, shownNotes } from '../js/export.js';
import { detailsHtml, trayHtml, unsListHtml, unsMatch, unscheduled } from '../js/view.js';

const doc = () => {
  const d = blankDoc('Test');
  d.lanes = [{ id: 'l2', title: 'Second', order: 2 }, { id: 'l1', title: 'First', order: 1 }];
  const item = (id, title, lane, extra = {}) => ({ id, kind: 'item', lane, order: 0, parent: null, title, start: null, end: null, size: null, milestone: false, status: 'planned', color: '', notes: '', who: [], dependsOn: [], afterMissing: [], ...extra });
  d.items = [
    item('a', 'Search cutover', 'l1', { order: 2 }),
    item('b', 'Content <b>migration</b>', 'l1', { order: 1 }),
    item('c', 'Alerting', 'l2', { ado: { id: 4321, type: 'Feature', url: 'https://ado.example.test/_workitems/edit/4321' } }),
    item('d', 'Loose idea', null),
    item('e', 'Has dates', 'l1', { start: '2027-01-04', end: '2027-01-29', notes: 'Feature #9 · Active\nhttps://ado.example.test/_workitems/edit/9\nDelivers search.', ado: { id: 9, type: 'Feature', url: 'https://ado.example.test/_workitems/edit/9', releaseNotes: 'Search is <i>faster</i>' } })
  ];
  return d;
};

test('unscheduled: lane by lane in lane order, No lane last, items in order, scheduled ones left out', () => {
  const g = unscheduled(doc());
  assert.deepEqual(g.map(x => x.title), ['First', 'Second', 'No lane']);
  assert.deepEqual(g[0].items.map(i => i.id), ['b', 'a']);
  assert.ok(!g.flatMap(x => x.items).some(i => i.id === 'e'));
});

test('unscheduled filter: every word, across title, lane and ADO id', () => {
  const d = doc();
  assert.ok(unsMatch(d.items[0], 'First', 'search first'));
  assert.ok(!unsMatch(d.items[0], 'First', 'search second'));
  assert.ok(unsMatch(d.items[2], 'Second', '#4321'));
  assert.ok(unsMatch(d.items[2], 'Second', '4321'));
  const r = unsListHtml(d, undefined, { filter: 'alert' });
  assert.equal(r.shown, 1); assert.equal(r.total, 4);
  assert.match(r.html, /data-tray="c"/);
  assert.match(unsListHtml(d, undefined, { filter: 'zzz' }).html, /Nothing unscheduled matches/);
});

test('unscheduled tray: rows draggable, text escaped, folded when asked, empty when nothing is unscheduled', () => {
  const html = trayHtml(doc(), undefined, { open: false });
  assert.equal((html.match(/draggable="true" data-tray=/g) || []).length, 4);
  assert.ok(html.includes('Content &lt;b&gt;migration&lt;/b&gt;') && !html.includes('<b>migration'));
  assert.ok(!/<details[^>]*\sopen/.test(html));
  assert.match(html, /4 items/);
  const d = doc(); d.items = d.items.filter(i => i.start);
  assert.equal(trayHtml(d), '');
});

test("what's getting done: ADO title is the link, its URL line is dropped, release notes shown and escaped", () => {
  const d = doc();
  assert.equal(shownNotes(d.items[4]), 'Feature #9 · Active\nDelivers search.');
  const s = summary(d, { from: '2027-01-01', to: '2027-03-31' });
  assert.equal(s.items[0].url, 'https://ado.example.test/_workitems/edit/9');
  assert.equal(s.items[0].releaseNotes, 'Search is <i>faster</i>');
  const html = detailsHtml(d, { from: '2027-01-01', to: '2027-03-31' });
  assert.match(html, /<a class="dname" href="https:\/\/ado\.example\.test\/_workitems\/edit\/9" target="_blank"/);
  assert.ok(!html.includes('<p>Feature #9 · Active\nhttps://'));
  assert.match(html, /Release notes/);
  assert.ok(html.includes('Search is &lt;i&gt;faster&lt;/i&gt;'));
});

test("what's getting done: an item with only release notes is listed; one with neither is not", () => {
  const d = doc();
  d.items[4].notes = '';
  assert.equal(summary(d, { from: '2027-01-01', to: '2027-03-31' }).items.length, 1);
  d.items[4].ado.releaseNotes = '';
  assert.equal(summary(d, { from: '2027-01-01', to: '2027-03-31' }).items.length, 0);
});

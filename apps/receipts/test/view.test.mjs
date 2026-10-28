// The page as HTML strings (view.js): escaping of entry text, only http(s) links clickable, the five views,
// packet grouping, the waiting state and the blur marks. Clicks and the real browser are in tests/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEntry, peopleOf, settingsOf } from '../js/model.js';
import * as view from '../js/view.js';
import { fixture } from './helpers.mjs';

const cfg = fixture('config.json');
function state(extra = {}) {
  const settings = settingsOf(cfg, '2026-10-20');
  const people = peopleOf(cfg);
  const entries = Object.fromEntries(people.map(p => [p.id, []]));
  entries['jordan-lee'] = fixture('entries-jordan-lee-2026.json').items;
  return { today: '2026-10-20', view: 'log', status: 'saved', settings, people, entries, metrics: {}, cycle: settings.cycles[1], cycleId: '2026-h2',
    logPerson: 'jordan-lee', personId: 'jordan-lee', filter: {}, editing: null, packet: {}, readOnly: false, ...extra };
}
const EVIL = { id: 'r_evil', updatedAt: 1, date: '2026-10-01', kind: 'note', rubric: [], note: '<script>alert(1)</script><img src=x onerror=alert(2)>',
  bullet: '"><b>bold</b>', links: ['javascript:alert(3)', 'https://example.com/ok?a=1&b=<2>', 'data:text/html,hi'], metric: '<i>9</i>', category: '<u>c</u>' };

test('entry text is escaped: a <script> in a note renders as text', () => {
  const html = view.entryCard(state(), EVIL);
  assert.ok(!/<script/i.test(html) && !/<img/i.test(html) && !/<b>bold/.test(html) && !/<i>9/.test(html) && !/<u>c/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&quot;&gt;&lt;b&gt;bold&lt;/b&gt;'));
});

test('only http(s) links are clickable: javascript: and data: links render as text', () => {
  const html = view.entryCard(state(), EVIL);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, ['https://example.com/ok?a=1&amp;b=&lt;2&gt;']);
  assert.ok(html.includes('<span class="badlink">javascript:alert(3)</span>'));
  assert.ok(html.includes('<span class="badlink">data:text/html,hi</span>'));
  assert.ok(html.includes('rel="noopener noreferrer"') && html.includes('target="_blank"'));
  assert.deepEqual(cleanEntry(EVIL).links, ['https://example.com/ok?a=1&b=<2>'], 'and they are not even stored');
});

test('the edit form escapes what it puts back in fields', () => {
  const V = state();
  const html = view.entryForm(V, EVIL, V.people[1], { mode: 'edit' });
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('value="&lt;i&gt;9&lt;/i&gt;"'));
});

test('person and cycle names are escaped everywhere they appear', () => {
  const V = state();
  V.people = V.people.map(p => p.id === 'jordan-lee' ? { ...p, name: '<b>Jordan</b>' } : p);
  V.settings = { ...V.settings, cycles: V.settings.cycles.map(c => ({ ...c, name: '<i>H2</i>' })) };
  for (const fn of ['logView', 'personView', 'reviewView', 'teamView', 'packetView', 'settingsView']) {
    const html = view[fn]({ ...V, cycle: V.settings.cycles[1] });
    assert.ok(!html.includes('<b>Jordan</b>') && !html.includes('<i>H2</i>'), fn);
  }
});

test('the five views and settings render; the log form has the rubric and role categories', () => {
  const V = state();
  const log = view.logView(V);
  assert.ok(log.includes('data-form="log"') && (log.match(/data-chips="rubric"/g) || []).length === 1);
  assert.ok(log.includes('Performance and scaling'), 'Engineer IC categories for Jordan');
  const person = view.personView(V);
  assert.ok(person.includes('No entries yet for:</b> Collaboration, Leadership.'));
  assert.equal((person.match(/<article class="entry"/g) || []).length, 5, 'H2 entries only');
  const filtered = view.personView({ ...V, filter: { kind: 'win' } });
  assert.equal((filtered.match(/<article class="entry"/g) || []).length, 2);
  const review = view.reviewView(V);
  assert.deepEqual(view.reviewItems(V).map(i => i.entry.id), ['r_h2e', 'r_h2d', 'r_h2c'], 'newest first');
  assert.ok(review.includes('Needs a rubric section, a bullet'));
  const team = view.teamView(V);
  assert.ok(team.includes('data-person="jordan-lee"') && team.includes('data-person="sam-okafor" class="nudge"'), 'nobody logged for Sam: flagged');
  assert.ok(!team.includes('ado.closed'), 'no metric columns until metrics exist');
  const withMetrics = view.teamView({ ...V, metrics: { 'jordan-lee': { '2026-h2': [fixture('metrics-jordan-lee-2026-09.json')] } } });
  assert.ok(withMetrics.includes('<th scope="col" class="num">ado.closed</th>'), 'metric columns appear once metrics are written');
  const packet = view.packetView(V);
  assert.ok(packet.includes('Generate summary') && packet.includes('data-export="csv"'));
  const settings = view.settingsView(V);
  assert.ok(settings.includes('data-settings="people"') && settings.includes('data-settings="rubric"') && settings.includes('data-settings="cycles"'));
});

test('team: last entry and the nudge after nudgeDays', () => {
  const V = state({ today: '2026-11-10' });
  const rows = view.teamRows(V, V.settings.cycles[1]);
  const j = rows.find(r => r.person.id === 'jordan-lee');
  assert.equal(j.count, 5); assert.equal(j.wins, 2); assert.equal(j.concerns, 1);
  assert.equal(j.last, '2026-10-14'); assert.equal(j.idle, 27); assert.equal(j.nudge, true);
  assert.equal(view.teamRows(state(), V.settings.cycles[1]).find(r => r.person.id === 'jordan-lee').nudge, false, '6 days is fine');
});

test('the packet preview escapes Markdown content and builds headings and lists', () => {
  const html = view.mdPreview('# Title <x>\n\n## Results (1)\n\n- a <script>b</script>\n- c\n\nplain & text');
  assert.equal(html, '<h3>Title &lt;x&gt;</h3><h4>Results (1)</h4><ul><li>a &lt;script&gt;b&lt;/script&gt;</li><li>c</li></ul><p>plain &amp; text</p>');
  assert.equal(view.mdToText('# T\n## S\n- one\n- two'), 'T\nS\n• one\n• two');
});

test('waiting for the folder: no data, nothing to edit, points to Allow', () => {
  const V = state({ waiting: true });
  const head = view.header(V);
  assert.equal((head.match(/ disabled/g) || []).length, 6, 'five tabs and settings are disabled');
  assert.ok(view.waitingHtml(true).includes('in the bar at the top of Workshop'));
  assert.ok(!view.waitingHtml(true).includes('<form'));
});

test('blur marks names, notes and bullets as sensitive', () => {
  const html = view.entryCard(state(), fixture('entries-jordan-lee-2026.json').items[1], { person: { name: 'Jordan Lee' } });
  assert.ok(/class="who sensitive"/.test(html) && /class="bullet sensitive"/.test(html) && /class="note sensitive/.test(html));
  assert.ok(view.header(state({ blurred: true })).includes('aria-pressed="true"'));
});

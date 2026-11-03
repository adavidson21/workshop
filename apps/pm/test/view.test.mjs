// Roadmap HTML: everything from ADO, other apps or the person is escaped, links are only http(s), and the
// chart, health and cadence views show what the model says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCeremony, cleanSettings, sprintStrip } from '../js/model.js';
import { cadenceHtml, render, safeUrl, settingsHtml, stateClass, stripHtml } from '../js/view.js';
import { SPRINT, epic, feature } from './fake.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const EVIL = '<img src=x onerror=alert(1)>"\'&';
const ui = (extra = {}) => ({ tab: 'roadmap', open: new Set(), release: null, draft: null, ...extra });

const base = (extra = {}) => ({
  loaded: true, waiting: false, newer: '', settings: cleanSettings({}),
  products: [{ id: 'p_a', name: `Product ${EVIL}`, areas: ['Web App\\Team A'] }],
  cadence: [], seen: {}, items: [], offers: [], recurring: [],
  snap: { fetchedAt: '2026-11-03T11:00:00Z', connection: 'main', total: 0, truncated: false, childrenTruncated: false, iterations: {}, areas: ['Web App\\Team A'] },
  queue: { areas: [], connection: '' }, docket: { state: 'ok', sprint: SPRINT },
  ado: { state: 'ready', message: '' }, refreshing: false, refreshError: '', ...extra
});

const noRawTags = html => assert.equal(/<img|<script|onerror=alert\(1\)>/.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), false, 'no raw markup from data');

test('roadmap escapes titles, states, product names and URLs from ADO', () => {
  const v = base({
    items: [epic(701, { title: `Version ${EVIL}`, state: EVIL, startDate: '2026-10-01', targetDate: '2026-12-15', url: 'javascript:alert(1)' }),
      feature(711, 701, { title: `Feature ${EVIL}`, url: `https://ado.example.com/x?"${EVIL}` }), epic(702, { title: `Undated ${EVIL}`, iteration: 'Web App' })]
  });
  const html = render(v, ui({ open: new Set([701]) }), NOW, true);
  noRawTags(html);
  assert.match(html, /Product &lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  assert.equal(html.includes('javascript:'), false, 'only http(s) links');
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Feature &lt;img/);
  assert.match(html, /Undated &lt;img/);
});

test('release health escapes feature titles and shows progress, stale and changed', () => {
  const v = base({
    items: [epic(701, { title: EVIL }), feature(711, 701, { title: EVIL, rev: 5, changed: '2026-10-01T00:00:00Z', storiesTotal: 4, storiesDone: 3 })],
    seen: { 701: 2, 711: 3 }
  });
  const html = render(v, ui({ tab: 'releases' }), NOW, true);
  noRawTags(html);
  assert.match(html, /75%/);
  assert.match(html, /3\/4/);
  assert.match(html, /stale/);
  assert.match(html, /data-seen="701"/);
});

test('error and status text from ADO is escaped', () => {
  const html = render(base({ refreshError: EVIL, items: [epic(1)] }), ui(), NOW, true);
  noRawTags(html);
  const off = render(base({ ado: { state: 'off', message: EVIL } }), ui(), NOW, true);
  noRawTags(off);
});

test('cadence escapes ceremony names and roles, in the strip and the editor', () => {
  const c = cleanCeremony({ id: 'cer_x', name: `Demo ${EVIL}`, dueDay: 2, role: EVIL, planKind: EVIL });
  const v = base({ cadence: [c] });
  const html = cadenceHtml(v, ui({ tab: 'cadence' }), NOW);
  noRawTags(html);
  assert.match(html, /Sprint 2026-22/);
  assert.match(html, /Holiday/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /Not sent/);
  const strip = stripHtml(sprintStrip(SPRINT, '2026-11-03', [c]));
  assert.match(strip, /Demo &lt;img/);
});

test('settings escape product names, area paths and Queue\'s paths', () => {
  const html = settingsHtml(base({ queue: { areas: [`Web App\\${EVIL}`], connection: EVIL } }));
  noRawTags(html);
  assert.match(html, /Web App\\&lt;img/);
});

test('safeUrl and stateClass', () => {
  assert.equal(safeUrl('https://ado.example.com/1'), 'https://ado.example.com/1');
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl(null), '#');
  assert.deepEqual(['Active', 'New', 'Closed', 'Resolved', 'Proposed', 'In Progress'].map(s => stateClass({ state: s })), ['now', 'new', 'done', 'done', 'new', 'now']);
});

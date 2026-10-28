// Receipts' model: cycle math, coverage, review reasons, scores, names, migrations, and the collector and
// importer interfaces (interfaces only in V1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RUBRIC, SEGMENT, coverage, currentCycle, daysBetween, defaultCycles, entriesIn, kindOf, lastEntryDate, leverageScore,
  migrate, monthsOf, previousCycle, quarterOf, reviewReasons, reviewScore, settingsOf, slugify, summaryBase, summaryFile, validCycle, yearsToLoad
} from '../js/model.js';
import { COLLECTORS, emptyMetrics, validMetrics } from '../js/collect/index.js';
import { IMPORTERS, newDrafts } from '../js/import/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8'));
const settings = settingsOf(fixture('config.json'), '2026-10-20');
const entries = fixture('entries-jordan-lee-2026.json').items;

test('cycles: default halves, the current one, the one before, months, and years to load', () => {
  assert.deepEqual(defaultCycles(2026).map(c => [c.id, c.start, c.end, c.due]), [['2026-h1', '2026-01-01', '2026-06-30', '2026-07-14'], ['2026-h2', '2026-07-01', '2026-12-31', '2027-01-14']]);
  assert.equal(currentCycle(settings, '2026-10-20').id, '2026-h2');
  assert.equal(currentCycle(settings, '2026-06-30').id, '2026-h1', 'end day is inside');
  assert.equal(currentCycle(settings, '2027-02-01').id, '2026-h2', 'after every cycle: the latest one that started');
  assert.equal(currentCycle(settings, '2025-12-01').id, '2026-h1', 'before every cycle: the first');
  assert.equal(previousCycle(settings, settings.cycles[1]).id, '2026-h1');
  assert.equal(previousCycle(settings, settings.cycles[0]), null);
  assert.deepEqual(monthsOf({ start: '2026-11-15', end: '2027-02-02' }), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(yearsToLoad({ cycles: [{ start: '2025-07-01', end: '2026-06-30' }] }, '2026-10-20'), [2025, 2026]);
  assert.equal(validCycle({ id: '2027-h1', name: 'H1 2027', start: '2027-01-01', end: '2027-06-30' }), true);
  assert.equal(validCycle({ id: '2027-h1', name: 'H1 2027', start: '2027-07-01', end: '2027-06-30' }), false, 'start after end');
  assert.equal(validCycle({ id: 'H1', name: 'x', start: '2027-01-01', end: '2027-06-30' }), false, 'id is a lowercase segment');
  assert.equal(daysBetween('2026-10-01', '2026-10-15'), 14);
  assert.equal(quarterOf('2026-03-31'), 'Q1'); assert.equal(quarterOf('2026-10-01'), 'Q4');
});

test('entries in a cycle are sorted by date, then id; coverage counts every listed section and finds gaps', () => {
  const h2 = entriesIn(entries, settings.cycles[1]);
  assert.deepEqual(h2.map(e => e.id), ['r_h2a', 'r_h2b', 'r_h2c', 'r_h2d', 'r_h2e']);
  const c = coverage(h2, DEFAULT_RUBRIC);
  assert.equal(c.total, 5);
  assert.deepEqual(c.bySection, { results: 1, craft: 1, ownership: 2, collaboration: 0, communication: 1, leadership: 0, growth: 1 });
  assert.deepEqual(c.byKind, { win: 2, growth: 1, concern: 1, feedback: 1, note: 0 });
  assert.deepEqual(c.gaps, ['collaboration', 'leadership']);
  assert.equal(lastEntryDate(entries), '2026-10-14');
  assert.equal(lastEntryDate([]), null);
});

test('needs review: no rubric, no bullet, or marked', () => {
  const by = Object.fromEntries(entries.map(e => [e.id, reviewReasons(e)]));
  assert.deepEqual(by.r_h2a, []);
  assert.deepEqual(by.r_h2c, ['bullet']);
  assert.deepEqual(by.r_h2d, ['marked']);
  assert.deepEqual(by.r_h2e, ['rubric', 'bullet']);
});

test('scores follow TaskLedger: leverage is impact times visibility; review adds strategic, risk and effort', () => {
  const e = entries.find(x => x.id === 'r_h2a'); // impact 4, Org, strategic, risk 2, L
  assert.equal(leverageScore(e), 12);
  assert.equal(reviewScore(e), 4 * 2 + 2 + 2 + 3);
  assert.equal(leverageScore({}), 0);
  assert.equal(reviewScore({}), 1, 'effort defaults to S');
});

test('names: slugs are stable, unique segments; summary paths and kinds', () => {
  assert.equal(slugify('Jordan Lee'), 'jordan-lee');
  assert.equal(slugify('Jordan Lee', ['jordan-lee']), 'jordan-lee-2');
  assert.equal(slugify('Zoë  Ångström!'), 'zoe-angstrom');
  assert.equal(slugify('  '), 'person');
  assert.ok(SEGMENT.test(slugify('x'.repeat(80))));
  assert.equal(summaryFile('jordan-lee', '2026-h2'), 'summaries/jordan-lee/2026-h2.md');
  assert.equal(summaryBase('jordan-lee', '2026-h2', 3), 'summaries/jordan-lee/2026-h2-v3');
  assert.deepEqual(['config', 'entries/a/2026', 'metrics/a/2026-10', 'summaries/a/b'].map(kindOf), ['config', 'entries', 'metrics', 'summary']);
});

test('migrations: current version passes through; newer is read only; a step runs in order', () => {
  const env = fixture('entries-jordan-lee-2026.json');
  assert.deepEqual(migrate(env, 'entries/jordan-lee/2026'), { env, tooNew: false });
  assert.equal(migrate({ ...env, version: 2 }, 'entries/jordan-lee/2026').tooNew, true);
  const steps = { entries: { 0: e => ({ ...e, version: 1, items: e.items.map(i => ({ ...i, kind: i.kind || 'note' })) }) } };
  const old = { ...env, version: 0, items: [{ id: 'a', updatedAt: 1, note: 'x' }] };
  assert.deepEqual(migrate(old, 'entries/jordan-lee/2026', steps).env.items, [{ id: 'a', updatedAt: 1, note: 'x', kind: 'note' }]);
});

test('collector and importer interfaces: none in V1, and their checks', () => {
  assert.deepEqual(COLLECTORS, []);
  assert.deepEqual(IMPORTERS, []);
  const m = fixture('metrics-jordan-lee-2026-09.json');
  assert.equal(validMetrics(m, 'jordan-lee', '2026-09'), true);
  assert.equal(validMetrics(m, 'sam-okafor', '2026-09'), false, 'wrong person');
  assert.equal(validMetrics(emptyMetrics('jordan-lee', '2026-09', '2026-09-30T00:00:00.000Z'), 'jordan-lee', '2026-09'), true);
  const drafts = [
    { source: 'ado', sourceRef: 'wi/1', note: 'Closed WI 1' },
    { source: 'ado', sourceRef: 'wi/2', note: 'Closed WI 2' },
    { source: 'ado', sourceRef: 'wi/2', note: 'again' },
    { source: 'manual', sourceRef: 'x', note: 'not from an importer' }
  ];
  const have = [{ id: 'r1', source: 'ado', sourceRef: 'wi/1' }];
  assert.deepEqual(newDrafts(drafts, have).map(d => d.sourceRef), ['wi/2'], 'already logged and duplicate suggestions are skipped');
});

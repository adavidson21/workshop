// CSV and Excel export: BOM, CRLF, RFC 4180 quoting, columns, formula-safe cells, and an Excel round trip
// through the vendored SheetJS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CSV_COLUMNS, DEFAULT_CSV_COLUMNS, peopleOf, settingsOf } from '../js/model.js';
import { columnsOf, csvField, entryRows, exportName, safeCell, toCsv, toWorkbook } from '../js/export.js';
import { fixture } from './helpers.mjs';

const XLSX = createRequire(import.meta.url)('../../../shared/vendor/xlsx.full.min.js');
const cfg = fixture('config.json');
const settings = settingsOf(cfg, '2026-10-20');
const person = peopleOf(cfg).find(p => p.id === 'jordan-lee');
const entries = fixture('entries-jordan-lee-2026.json').items;

test('CSV: UTF-8 BOM, CRLF after every row, header first, one row per entry', () => {
  const csv = toCsv(entryRows(entries, person, settings), DEFAULT_CSV_COLUMNS);
  assert.ok(csv.startsWith('﻿EntryId,Date,Quarter,Year,Person,'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')), 'every line break outside quotes is CRLF');
  const header = csv.slice(1).split('\r\n')[0].split(',');
  assert.deepEqual(header, DEFAULT_CSV_COLUMNS);
  assert.ok(!header.includes('LeverageScore') && !header.includes('ReviewScore'), 'scores are opt-in, as in TaskLedger');
});

test('CSV quoting: commas, quotes and line breaks are quoted; quotes are doubled', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a, b'), '"a, b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField('cr\rhere'), '"cr\rhere"');
  const csv = toCsv(entryRows(entries, person, settings), ['EntryId', 'Note']);
  assert.ok(csv.includes('r_h2a,"Led the cache rollout for the reading list service.\nCut p95 latency on the list page."\r\n'));
});

test('CSV cells that would run as a formula get a leading apostrophe; plain numbers do not', () => {
  assert.equal(safeCell('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.equal(safeCell('+1+2'), "'+1+2");
  assert.equal(safeCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(safeCell('-40% p95'), "'-40% p95");
  assert.equal(safeCell('-40'), '-40');
  assert.equal(safeCell('3'), '3');
});

test('rows: names, rubric names, sorted by date, and the TaskLedger scores', () => {
  const rows = entryRows(entries, person, settings);
  assert.deepEqual(rows.map(r => r.EntryId), ['r_h1a', 'r_h2a', 'r_h2b', 'r_h2c', 'r_h2d', 'r_h2e']);
  const r = rows[1];
  assert.equal(r.Person, 'Jordan Lee'); assert.equal(r.Relation, 'Direct report'); assert.equal(r.Role, 'Engineer IC');
  assert.equal(r.Quarter, 'Q3'); assert.equal(r.Year, '2026'); assert.equal(r.Kind, 'Win');
  assert.equal(r.RubricPrimary, 'Results'); assert.equal(r.RubricSecondary, 'Craft');
  assert.equal(r.Strategic, 'TRUE'); assert.equal(r.LeverageScore, '12'); assert.equal(r.ReviewScore, '15');
  assert.equal(rows[5].NeedsReview, 'TRUE');
  assert.deepEqual(columnsOf(['Note', 'EntryId']), ['EntryId', 'Note'], 'chosen columns keep the standard order');
  assert.deepEqual(columnsOf(null), CSV_COLUMNS);
  assert.equal(exportName('jordan-lee', '2026-h2', 'csv'), 'receipts-jordan-lee-2026-h2.csv');
});

test('Excel: one sheet, the same columns and rows, every cell text', () => {
  const rows = entryRows(entries, person, settings);
  const wb = toWorkbook(XLSX, rows, CSV_COLUMNS, 'Jordan Lee: H2/2026?');
  assert.deepEqual(wb.SheetNames, ['Jordan Lee H2 2026']);
  const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const data = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, raw: true });
  assert.deepEqual(data[0], CSV_COLUMNS);
  assert.equal(data.length, rows.length + 1);
  assert.equal(data[2][CSV_COLUMNS.indexOf('Metric')], 'p95 latency -40%');
  assert.equal(typeof data[2][CSV_COLUMNS.indexOf('Impact')], 'string', 'numbers stay text, nothing becomes a formula');
});

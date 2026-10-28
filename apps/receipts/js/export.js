/* Receipts: CSV and Excel export of entries. CSV follows TaskLedger's rules: UTF-8 with a BOM (so Excel reads
   it as UTF-8), CRLF line endings, RFC 4180 quoting. Excel uses the vendored SheetJS (window.XLSX), passed in
   so tests can use it from Node too. No DOM here: main.js turns the results into downloads. */
import { CSV_COLUMNS, KINDS, RELATIONS, leverageScore, needsReview, quarterOf, reviewScore } from './model.js';

const kindName = id => (KINDS.find(k => k.id === id) || { name: id || '' }).name;
const relName = id => (RELATIONS.find(r => r.id === id) || { name: id || '' }).name;

/** One row per entry, as {column: string}. `person` is the config person; `settings` from settingsOf(). */
export function entryRows(entries, person, settings) {
  const rubricName = id => (settings.rubric.find(r => r.id === id) || { name: id }).name;
  const roleName = (settings.roles.find(r => r.id === person.role) || { name: person.role || '' }).name;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return sorted.map(e => ({
    EntryId: e.id,
    Date: e.date,
    Quarter: e.date ? quarterOf(e.date) : '',
    Year: e.date ? e.date.slice(0, 4) : '',
    Person: person.name || '',
    Relation: relName(person.relation),
    Role: roleName,
    Kind: kindName(e.kind),
    Category: e.category || '',
    RubricPrimary: e.rubric && e.rubric[0] ? rubricName(e.rubric[0]) : '',
    RubricSecondary: (e.rubric || []).slice(1).map(rubricName).join(', '),
    Visibility: e.visibility || '',
    Impact: e.impact != null ? String(e.impact) : '',
    Strategic: e.strategic ? 'TRUE' : 'FALSE',
    Effort: e.effort || '',
    RiskReduced: e.riskReduced != null ? String(e.riskReduced) : '',
    Metric: e.metric || '',
    MetricSource: e.metricSource || '',
    Collaborators: (e.collaborators || []).join(', '),
    Artifact: e.artifact || '',
    Links: (e.links || []).join(' '),
    Bullet: e.bullet || '',
    Note: e.note || '',
    Tags: (e.tags || []).join(', '),
    NeedsReview: needsReview(e) ? 'TRUE' : 'FALSE',
    Source: e.source || 'manual',
    LeverageScore: String(leverageScore(e)),
    ReviewScore: String(reviewScore(e))
  }));
}

/** The columns to export: the chosen ones in the standard order, or all defaults. */
export const columnsOf = chosen => CSV_COLUMNS.filter(c => !chosen || chosen.includes(c));

// A cell that starts with = + - @, a tab or a carriage return can run as a formula when the CSV is opened in
// a spreadsheet. Such cells get a leading apostrophe, unless the whole cell is a plain number.
const RISKY = /^[=+\-@\t\r]/;
const NUMBER = /^[-+]?\d+(\.\d+)?$/;
export function safeCell(v) {
  const s = String(v ?? '');
  return RISKY.test(s) && !NUMBER.test(s) ? "'" + s : s;
}

/** RFC 4180: quote a field holding a comma, quote, CR or LF, and double the quotes inside. */
export function csvField(v) {
  const s = safeCell(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** The CSV text: BOM, header row, one row per entry, CRLF after every row. */
export function toCsv(rows, columns) {
  const lines = [columns.join(','), ...rows.map(r => columns.map(c => csvField(r[c])).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** An Excel workbook with one sheet of entries. Cells are text, so nothing in them runs as a formula. */
export function toWorkbook(XLSX, rows, columns, sheetName = 'Entries') {
  const wb = XLSX.utils.book_new();
  const data = [columns, ...rows.map(r => columns.map(c => String(r[c] ?? '')))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = columns.map(c => ({ wch: c === 'Note' || c === 'Bullet' ? 50 : c === 'Links' ? 30 : Math.max(8, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, sheet, sheetName.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Entries');
  return wb;
}

/** A file name for an export: receipts-<person>-<cycle>.<ext>. */
export const exportName = (personId, cycleId, ext) => `receipts-${personId}-${cycleId}.${ext}`;

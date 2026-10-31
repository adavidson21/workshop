/* Receipts: pure logic, no DOM. Tested by test/state.test.mjs.

   Data lives in three collections of this app, in the Workshop envelope format (shared/workshop-sdk.js,
   docs in the workshop repo: data-format.md):
     entries  every receipt. `about` says whose: 'me', 'up' (your manager), or a person id ('p_...').
     people   your direct reports: {id, name, role, since, archived}.
     config   no items; meta holds settings: {sections, cycleStart, cycleEnd, upward, staleDays}.
   Nothing here talks to the network. */

export const APP = 'receipts';
export const VERSION = 1;

export const DEFAULT_SECTIONS = [
  'Goals',
  'Key Accomplishments',
  'Communication',
  'Work Quality & Time Management',
  'Technical Expertise',
  'Initiative',
  'Teamwork',
  'Adaptability',
  'Personal Growth',
];

export const DEFAULT_CONFIG = {
  sections: DEFAULT_SECTIONS,
  cycleStart: '',
  cycleEnd: '',
  upward: false,
  staleDays: 30,
};

// Kinds are shared across areas; the label changes with who the receipt is about.
export const KINDS = ['win', 'feedback', 'growth', 'concern', 'note'];
const KIND_LABELS = {
  me:     { win: 'Win', feedback: 'Feedback received', growth: 'Learned', concern: 'Blocker', note: 'Note' },
  report: { win: 'Win', feedback: 'Feedback given', growth: 'Growth area', concern: 'Concern', note: 'Note' },
  up:     { win: 'Support received', feedback: 'Feedback to share', growth: 'Ask', concern: 'Concern', note: 'Note' },
};
export const areaOf = about => (about === 'me' ? 'me' : about === 'up' ? 'up' : 'report');
export const kindLabel = (kind, about) => (KIND_LABELS[areaOf(about)] || KIND_LABELS.me)[kind] || 'Note';
export const kindOptions = about => KINDS.map(k => [k, kindLabel(k, about)]);

export const IMPACT = { 1: 'Small', 2: 'Medium', 3: 'Big' };

/* ---------- ids and dates ---------- */
export function newId(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}
const pad = n => String(n).padStart(2, '0');
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (now = new Date()) => isoDay(now);
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
export function quarterOf(day) {
  const d = parseDay(day);
  return d ? `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}` : '';
}
export function monthLabel(day) {
  const d = parseDay(day);
  return d ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'No date';
}
export function shortDate(day) {
  const d = parseDay(day);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}
export function daysBetween(a, b) {
  const x = parseDay(a), y = parseDay(b);
  return x && y ? Math.round((y - x) / 86400000) : null;
}

/* ---------- periods ----------
   A period is {key, label, from, to} with inclusive ISO days; from/to may be '' (open). */
export function periods(cfg, now = new Date()) {
  const y = now.getFullYear(), q = Math.floor(now.getMonth() / 3);
  const qStart = (yy, qq) => new Date(yy, qq * 3, 1);
  const qEnd = (yy, qq) => new Date(yy, qq * 3 + 3, 0);
  const lastQ = q === 0 ? [y - 1, 3] : [y, q - 1];
  const yearAgo = new Date(now); yearAgo.setFullYear(y - 1); yearAgo.setDate(yearAgo.getDate() + 1);
  const list = [];
  if (cfg && cfg.cycleStart) {
    list.push({ key: 'cycle', label: 'Review cycle', from: cfg.cycleStart, to: cfg.cycleEnd || '' });
  }
  list.push(
    { key: 'quarter', label: 'This quarter', from: isoDay(qStart(y, q)), to: isoDay(qEnd(y, q)) },
    { key: 'last-quarter', label: 'Last quarter', from: isoDay(qStart(...lastQ)), to: isoDay(qEnd(...lastQ)) },
    { key: 'ytd', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
    { key: '12m', label: 'Last 12 months', from: isoDay(yearAgo), to: isoDay(now) },
    { key: 'all', label: 'All time', from: '', to: '' },
  );
  return list;
}
export const findPeriod = (cfg, key, now) => periods(cfg, now).find(p => p.key === key) || periods(cfg, now).find(p => p.key === 'all');
export const inPeriod = (e, p) => (!p.from || e.date >= p.from) && (!p.to || e.date <= p.to);

/* ---------- entries ---------- */
export function blankEntry(about, cfg, now = new Date()) {
  return {
    id: newId('r'),
    updatedAt: 0,
    createdAt: now.toISOString(),
    date: today(now),
    about,
    kind: 'win',
    text: '',
    sections: [],
    impact: 0,
    evidence: '',
    metric: '',
    people: '',
    star: false,
  };
}

// Keep only known fields with sane types, so imported or hand-edited data can't break the page.
export function cleanEntry(e) {
  const s = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    id: s(e.id) || newId('r'),
    updatedAt: Number(e.updatedAt) || 0,
    createdAt: s(e.createdAt),
    date: parseDay(e.date) ? e.date : today(),
    about: s(e.about) || 'me',
    kind: KINDS.includes(e.kind) ? e.kind : 'note',
    text: s(e.text).trim(),
    sections: Array.isArray(e.sections) ? e.sections.map(s).filter(Boolean) : [],
    impact: [0, 1, 2, 3].includes(+e.impact) ? +e.impact : 0,
    evidence: s(e.evidence).trim(),
    metric: s(e.metric).trim(),
    people: s(e.people).trim(),
    star: !!e.star,
  };
}

export function sortEntries(list) {
  return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/* filter: {about, period, section, kind, star, q} */
export function filterEntries(entries, f) {
  const q = (f.q || '').trim().toLowerCase();
  return sortEntries(entries.filter(e =>
    (!f.about || e.about === f.about) &&
    (!f.period || inPeriod(e, f.period)) &&
    (!f.section || e.sections.includes(f.section)) &&
    (!f.kind || e.kind === f.kind) &&
    (!f.star || e.star) &&
    (!q || [e.text, e.evidence, e.metric, e.people, e.sections.join(' ')].join(' ').toLowerCase().includes(q))
  ));
}

export function groupByMonth(list) {
  const groups = [];
  for (const e of list) {
    const key = (e.date || '').slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, label: monthLabel(e.date), items: [] }; groups.push(g); }
    g.items.push(e);
  }
  return groups;
}

/* ---------- people ---------- */
export function cleanPerson(p) {
  const s = v => (typeof v === 'string' ? v.trim() : '');
  return { id: s(p.id) || newId('p'), updatedAt: Number(p.updatedAt) || 0, name: s(p.name), role: s(p.role), since: s(p.since), archived: !!p.archived };
}

// Roster rows for the Reports page: counts in the period and how long since the last receipt.
export function rosterRows(people, entries, period, cfg, now = new Date()) {
  const stale = (cfg && cfg.staleDays) || 30;
  const t = today(now);
  return people
    .filter(p => !p.archived)
    .map(p => {
      const mine = entries.filter(e => e.about === p.id);
      const inP = mine.filter(e => inPeriod(e, period));
      const last = sortEntries(mine)[0];
      const since = last ? daysBetween(last.date, t) : null;
      const count = k => inP.filter(e => e.kind === k).length;
      return {
        person: p,
        total: inP.length,
        wins: count('win'),
        feedback: count('feedback'),
        growth: count('growth'),
        concerns: count('concern'),
        lastDate: last ? last.date : '',
        daysSince: since,
        stale: since === null || since > stale,
      };
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
}

/* ---------- review builder ---------- */
const rank = e => (e.star ? 10 : 0) + (e.impact || 0);

// Groups receipts by rubric section for a review draft. A receipt tagged with several sections shows under
// its first one only, so the draft never repeats itself; untagged receipts land in "Other".
export function buildReview(entries, { about, period, sections }) {
  const list = filterEntries(entries, { about, period });
  const order = sections.slice();
  const bySection = new Map(order.map(s => [s, []]));
  const other = [];
  for (const e of list) {
    const home = e.sections.find(s => bySection.has(s));
    (home ? bySection.get(home) : other).push(e);
  }
  const groups = order.map(s => ({ section: s, items: bySection.get(s).sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date)) }));
  if (other.length) groups.push({ section: 'Other', items: other.sort((a, b) => rank(b) - rank(a)) });
  // Coverage counts every tag, not just the first, so a section isn't flagged empty when it has evidence.
  const coverage = order.map(s => ({ section: s, count: list.filter(e => e.sections.includes(s)).length }));
  const kinds = Object.fromEntries(KINDS.map(k => [k, list.filter(e => e.kind === k).length]));
  return { total: list.length, groups, coverage, gaps: coverage.filter(c => !c.count).map(c => c.section), kinds, starred: list.filter(e => e.star).length };
}

export function bullet(e) {
  let t = e.text.replace(/\s+/g, ' ').trim();
  if (e.metric && !t.includes(e.metric)) t += ` (${e.metric})`;
  return t;
}

// Plain text draft: one heading per section that has receipts, one bullet each.
export function reviewText(review, { title, period, withDates = true, withEvidence = false }) {
  const lines = [title, period.label + (period.from || period.to ? ` (${period.from || '...'} to ${period.to || 'today'})` : ''), ''];
  for (const g of review.groups) {
    if (!g.items.length) continue;
    lines.push(g.section);
    for (const e of g.items) {
      let line = `- ${bullet(e)}`;
      if (withDates) line += ` [${shortDate(e.date)}]`;
      if (withEvidence && e.evidence) line += ` Evidence: ${e.evidence}`;
      lines.push(line);
    }
    lines.push('');
  }
  if (review.gaps.length) lines.push(`No receipts yet for: ${review.gaps.join(', ')}`);
  return lines.join('\n').trim() + '\n';
}

/* ---------- export ---------- */
const CSV_COLS = ['Date', 'Quarter', 'About', 'Kind', 'Receipt', 'Sections', 'Impact', 'Metric', 'Evidence', 'People', 'Starred'];
const csvCell = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// UTF-8 BOM and CRLF so Excel on Windows opens it cleanly (same rules as the old TaskLedger digest).
export function toCsv(entries, nameOf) {
  const rows = [CSV_COLS];
  for (const e of sortEntries(entries)) {
    rows.push([e.date, quarterOf(e.date), nameOf(e.about), kindLabel(e.kind, e.about), e.text, e.sections.join('; '),
      IMPACT[e.impact] || '', e.metric, e.evidence, e.people, e.star ? 'TRUE' : 'FALSE']);
  }
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'receipts';

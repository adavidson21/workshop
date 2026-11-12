/* Receipts: pure logic, no DOM. Tested by test/state.test.mjs.

   Data lives in two collections of this app, in the Workshop envelope format (shared/workshop-sdk.js,
   docs in the workshop repo: data-format.md):
     entries  every receipt. `about` says whose: 'me', 'up' (your manager), or a person id ('p_...') from the
              people directory. Reports themselves are kept there (reportsFrom below), not here.
     config   no items; meta holds settings: {sections, cycleStart, cycleEnd, upward, staleDays}.
   Nothing here talks to the network. */

import { SITE } from '../../../shared/site.js';
import { sendersFrom as sharedSendersFrom } from '../../../shared/handoffs.js';

export const APP = 'receipts';
export const VERSION = 1;

// Receipts' own generic sections, written for Workshop. They are not any company's review form: type yours in
// Settings (they stay on your device). test/state.test.mjs checks this list.
export const DEFAULT_SECTIONS = [
  'Results',
  'Craft',
  'Ownership',
  'Collaboration',
  'Communication',
  'Leadership',
  'Growth',
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

/* ---------- Workshop's people directory ----------
   Your reports and your manager are in the people directory (ws.people; docs/people.md in the workshop repo).
   Entries keep `about: 'me'`, `'up'` or a directory person id. */
export const WORKSHOP_PEOPLE_URL = SITE.workshop + '/#/people';
/* Rapport 2.x kept your reports in its own `people` collection (receipts.people v1: {id, name, role, since,
   archived}) when Workshop had no directory yet. 3.0.0 reads only the directory, so those reports, and the
   receipts about them (`about` is their id), are copied into it once, keeping their ids (main.js). */
export const OLD_PEOPLE = 'people';
/** The old reports to copy, as directory people. [] for anything that is not that collection. */
export function oldReports(env) {
  if (!env || env.schema !== `${APP}.${OLD_PEOPLE}` || env.version !== 1 || !Array.isArray(env.items)) return [];
  return env.items
    .filter(p => p && typeof p.id === 'string' && /^p_/.test(p.id) && typeof p.name === 'string' && p.name.trim())
    .map(p => ({ id: p.id, name: p.name.trim(), relation: 'report', role: typeof p.role === 'string' ? p.role : '', since: typeof p.since === 'string' ? p.since : '', archived: !!p.archived }));
}

/** Reports from the directory, archived ones included: [{id, name, role, since, archived}], by name. */
export function reportsFrom(dir) {
  return (dir && Array.isArray(dir.people) ? dir.people : []).filter(p => p.relation === 'report')
    .map(p => ({ id: p.id, name: p.name, role: p.role || '', since: p.since || '', archived: !!p.archived }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

// Sections your receipts are tagged with that are not in your list (most used first), for example after you
// change your list or the defaults change. Receipts tagged only with these land in "Other" in a review.
export function unlistedSections(entries, sections) {
  const known = new Set(sections);
  const counts = new Map();
  for (const e of entries) for (const s of e.sections) if (!known.has(s)) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
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
// A cell that starts with = + - @, a tab or a carriage return can run as a formula when the CSV is opened in
// Excel, so it gets a leading apostrophe. Plain numbers (-3, -0.5) are left alone so they stay numbers.
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
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

/* ---------- offers from other apps (Workshop docs/handoffs.md) ----------
   Another app (Docket's Wrap up, the 1:1s app) writes offers to its own `handoffs` collection. Receipts reads
   them, shows the ones addressed here, and the person accepts or dismisses each. What was handled is kept in
   config.meta.handled (newest HANDLED_MAX ids), so Receipts never writes the other app's data.
   payload.about: 'me' (the default) or a report's person id ('p_...'). An offer about a report shows on that
   report's page and in Me. One about a person id that is not in your list is about you, so it is never lost. */
export const SENDERS = { prioritizer: 'Docket', oneonones: '1:1s', home: 'Home', agents: 'Dispatch' };
/* Retired senders Rapport still reads until their offers are handled (Workshop docs/handoffs.md, Senders). */
export const RETIRED_SENDERS = { oneonones: '1:1s' };
/* Who sends Rapport offers, from the manifests on this Workshop site (ws.apps.list()): every app whose
   handoffs.sends lists receipts, added to the built-in list (which keeps the retired senders, and any whose
   manifest does not say). Reading an app that is not there finds no offers. */
export function sendersFrom(apps, self = APP, fallback = SENDERS) {
  return { ...sharedSendersFrom(apps, self, fallback), ...RETIRED_SENDERS };
}

/* Rapport's summary for other apps (Workshop docs/summaries.md). Live entries only.
     entries    how many receipts are logged (Home's Get started)
     needs      1:1s that are due (Home's Needs you): a name and how long since the last one, nothing from the notes
     done-week  your own wins logged in the last 7 days (Home's weekly status). Never receipts about anyone else:
                feedback, growth and concerns about people stay in Rapport.
     upcoming   dated things in the next 14 days (Home's Coming up): when each 1:1 is due by cadence, and the review
                cycle's end. Names and days only.
   due: [{id, name, days, route}] and upcoming: [{id, name, due, route}] from the 1:1s page; cycleEnd: the review
   cycle's last day or ''; today: YYYY-MM-DD. */
export const summaryCards = (entriesEnv, { due = [], upcoming = [], cycleEnd = '', today = '' } = {}) => {
  const live = (entriesEnv && Array.isArray(entriesEnv.items) ? entriesEnv.items : []).filter(e => e && !e.deleted);
  const cards = [{ id: 'entries', kind: 'count', title: 'Receipts', count: live.length, route: 'me' }];
  cards.push({ id: 'needs', kind: 'list', title: '1:1s due', count: due.length, route: '1on1s',
    rows: due.slice(0, 20).map(d => ({ id: String(d.id), title: `1:1 with ${String(d.name || 'someone').slice(0, 180)}`, note: d.days == null ? 'No 1:1 yet' : `${d.days} days since the last one`, route: d.route || '1on1s', flag: 'waiting' })) });
  if (today) {
    const until = isoDay(new Date(new Date(today + 'T12:00:00').getTime() + 14 * 864e5));
    const soon = upcoming.filter(u => u && typeof u.due === 'string' && u.due >= today && u.due <= until)
      .map(u => ({ id: `1on1-${String(u.id)}`, title: `1:1 with ${String(u.name || 'someone').slice(0, 180)}`, due: u.due, note: '1:1', route: u.route || '1on1s' }));
    if (/^\d{4}-\d{2}-\d{2}$/.test(cycleEnd) && cycleEnd >= today && cycleEnd <= until) soon.push({ id: 'cycle-end', title: 'Review cycle ends', due: cycleEnd, note: 'Review', route: 'review' });
    soon.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    cards.push({ id: 'upcoming', kind: 'list', title: 'Coming up', count: soon.length, rows: soon.slice(0, 20) });
    const from = isoDay(new Date(new Date(today + 'T12:00:00').getTime() - 6 * 864e5));
    const wins = live.filter(e => (e.about || 'me') === 'me' && e.kind === 'win' && typeof e.date === 'string' && e.date >= from && e.date <= today)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    cards.push({ id: 'done-week', kind: 'list', title: 'Wins this week', count: wins.length,
      rows: wins.slice(0, 20).map(e => ({ id: String(e.id), title: String(e.text || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'A win', due: e.date, route: 'me' })) });
  }
  return cards;
};
export const HANDLED_MAX = 500;
const HANDOFF_VERSION = 1;

/* Who an offer is about: payload.about when it is a report in your list (known: their ids), else 'me'. */
export function offerAbout(payload, known = []) {
  const a = payload && typeof payload.about === 'string' ? payload.about : '';
  return /^p_[A-Za-z0-9_-]{1,80}$/.test(a) && known.includes(a) ? a : 'me';
}

/* Offers waiting here, newest day first. env: a sender's handoffs envelope, or null. known: your reports' ids.
   Unknown versions read as unreadable (nothing offered), never as a reason to write anything. */
export function pendingOffers(app, env, handled = [], known = []) {
  if (!env || env.schema !== `${app}.handoffs` || env.version !== HANDOFF_VERSION || !Array.isArray(env.items)) return [];
  const done = new Set(handled);
  return readOffers(app, env, handled, known).filter(o => !o.accepted)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.text.localeCompare(b.text)));
}
function readOffers(app, env, handled, known) {
  if (!env || env.schema !== `${app}.handoffs` || env.version !== HANDOFF_VERSION || !Array.isArray(env.items)) return [];
  const done = new Set(handled);
  return env.items.filter(h => h && typeof h.id === 'string' && h.to === APP && !done.has(`${app}:${h.id}`)
      && parseDay(h.date) && typeof h.text === 'string' && h.text.trim())
    .map(h => ({ key: `${app}:${h.id}`, app, id: h.id, from: SENDERS[app] || app, date: h.date, text: h.text.trim().slice(0, 2000),
      kind: h.payload && KINDS.includes(h.payload.kind) ? h.payload.kind : 'win',
      impact: h.payload && [0, 1, 2, 3].includes(h.payload.impact) ? h.payload.impact : 0,
      about: offerAbout(h.payload, known), accepted: h.accepted === true }));
}

/* Accepted offers (docs/handoffs.md in workshop, rule 4): a capture the person already accepted in Home or the
   Dispatch hub. Receipts adds these with no second click, for every kind. Each becomes an entry with a fixed id
   (offerEntryId), so the same capture is never added twice, even after the handled list is trimmed or the entry
   was deleted (its tombstone keeps the id). seen: entry ids that exist or were deleted. */
export const offerEntryId = (app, id) => ('h-' + app + '-' + String(id)).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120);
export function acceptedOffers(app, env, handled = [], known = [], seen = []) {
  const have = new Set(seen);
  return readOffers(app, env, handled, known).filter(o => o.accepted && !have.has(offerEntryId(o.app, o.id)));
}
/* The receipt an accepted offer becomes: about you, or about the report the offer names. */
export function entryFromOffer(o, now = new Date()) {
  return cleanEntry({ id: o.accepted ? offerEntryId(o.app, o.id) : newId('r'), about: o.about || 'me', kind: o.kind, text: o.text, date: o.date, impact: o.impact,
    evidence: `From ${o.from}`, createdAt: now.toISOString() });
}
/* The handled list with these keys added, newest last, capped. */
export function markHandled(handled, keys) {
  const set = [...(Array.isArray(handled) ? handled : []).filter(k => !keys.includes(k)), ...keys];
  return set.slice(-HANDLED_MAX);
}
